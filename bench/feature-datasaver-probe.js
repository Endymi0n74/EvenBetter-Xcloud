#!/usr/bin/env node
/**
 * bench/feature-datasaver-probe.js — validation CDP de la feature « 📊 Données »
 * (v1.11.0) sur www.xbox.com/play :
 *   1. BX_DATA_SAVER présent (script injecté)
 *   2. ouverture du dialog settings (bouton header bx-header-settings)
 *   3. groupe « 📊 Données » rendu (titre + 3 presets + statut actuel)
 *   4. clic « ⚖️ Équilibré » → prefs posées (maxBitrate 10240000, res auto)
 *   5. clic « 🌱 Économe » → prefs posées (maxBitrate 5120000, res 720p) +
 *      statut mis à jour
 *   6. reload → les prefs survivent (persistance localStorage)
 *   7. ré-ouverture des settings + restauration du preset Max (15360000 =
 *      illimité — forme persistée du slider natif, 0 n'est que le défaut)
 *
 * Usage : node bench/feature-datasaver-probe.js [--port=9225]
 */
const PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "--port=9225").split("=")[1]);

(async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/json`);
  const targets = await r.json();
  const page = targets.find((t) => t.type === "page" && /xbox\.com/.test(t.url));
  if (!page) { console.error("pas de page xbox.com"); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  await new Promise((res) => (ws.onopen = res));
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = (expr) => send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }).then((r2) => r2.result.value);
  const waitFor = async (expr, timeoutMs = 25000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { const v = await ev(expr); if (v) return v; } catch {}
      await new Promise((res) => setTimeout(res, 500));
    }
    return null;
  };

  let failures = 0;
  const check = (label, cond, extra) => {
    console.log((cond ? "  ✓ " : "  ✗ ") + label + (extra ? " :: " + extra : ""));
    if (!cond) failures++;
  };

  // 1. script présent + feature
  let st = await ev(`(() => ({
    url: location.href,
    bxExposed: !!window.BX_EXPOSED,
    dataSaver: typeof window.BX_DATA_SAVER,
    latency: typeof window.BX_LATENCY_TEST
  }))()`);
  console.log("[script] " + JSON.stringify(st));
  check("BX_EXPOSED présent", st.bxExposed);
  check("BX_DATA_SAVER défini", st.dataSaver === "object");
  check("BX_LATENCY_TEST toujours présent (régression)", st.latency === "object");

  // 2. ouvrir les settings
  const openSettings = `(() => {
    const btn = [...document.querySelectorAll("button")].find(b => /bx-header-settings/.test(String(b.className)));
    if (!btn) return false;
    btn.click();
    return true;
  })()`;
  const opened = await ev(openSettings);
  await new Promise((res) => setTimeout(res, 1500));
  check("bouton settings cliqué", opened);

  // 3. groupe Données dans le dialog
  st = await ev(`(() => {
    const dlg = document.querySelector(".bx-settings-dialog");
    const groups = dlg ? [...dlg.querySelectorAll("h2, h3, [class*=group-title], [class*=section-title]")].map(e => (e.textContent || "").trim()).filter(Boolean) : [];
    const dataSection = dlg ? [...dlg.querySelectorAll("div")].find(d => /📊 Données/.test(d.textContent || "") && d.children.length > 3) : null;
    const presets = dlg ? [...dlg.querySelectorAll("button")].filter(b => /🚀 Max|⚖️ Équilibré|🌱 Économe/.test(b.textContent || "")).map(b => (b.textContent || "").trim().slice(0, 60)) : [];
    const statusText = dlg ? [...dlg.querySelectorAll("div")].map(d => (d.textContent || "").trim()).find(t => /^Actuel —/.test(t)) : null;
    return { dialog: !!dlg, groups: groups.slice(0, 12), dataSection: !!dataSection, presets, statusText };
  })()`);
  console.log("[settings] " + JSON.stringify(st, null, 1));
  check("dialog settings ouvert", st.dialog);
  check("groupe 📊 Données rendu", st.dataSection);
  check("3 presets présents", st.presets.length === 3, "n=" + st.presets.length);
  check("statut « Actuel — » présent", !!st.statusText);

  const clickPreset = (label) => `(() => {
    const btn = [...document.querySelectorAll(".bx-settings-dialog button")].find(b => /${label}/.test(b.textContent || ""));
    if (!btn) return false;
    btn.click();
    return true;
  })()`;

  // 4. clic « Équilibré » → prefs posées. L'écriture localStorage est
  // débouncée (saveSettings ~100 ms) → on POLLE le stocké jusqu'à
  // l'atterrissage au lieu d'une lecture immédiate (flake potentiel).
  const clicked = await ev(clickPreset("⚖️ Équilibré"));
  await new Promise((res) => setTimeout(res, 800));
  check("clic preset Équilibré", clicked);
  st = await ev(`(() => ({
    br: getGlobalPref("stream.video.maxBitrate"),
    res: getGlobalPref("stream.video.resolution")
  }))()`);
  console.log("[prefs après Équilibré] " + JSON.stringify(st));
  check("maxBitrate = 10240000 (10 Mbps)", st.br === 10240000, String(st.br));
  check("resolution = auto", st.res === "auto", String(st.res));
  const persist4 = await waitFor(`(() => {
    try { const s = JSON.parse(localStorage.getItem("BetterXcloud") || "{}"); return s["stream.video.maxBitrate"] === 10240000; }
    catch { return false; }
  })()`, 6000);
  check("persisté localStorage (10240000)", !!persist4);

  // 5. clic « Économe » → 5 Mbps + 720p + statut mis à jour
  const clickedEco = await ev(clickPreset("🌱 Économe"));
  await new Promise((res) => setTimeout(res, 800));
  check("clic preset Économe", clickedEco);
  st = await ev(`(() => {
    const br = getGlobalPref("stream.video.maxBitrate");
    const res = getGlobalPref("stream.video.resolution");
    const status = [...document.querySelectorAll(".bx-settings-dialog div")].map(d => (d.textContent || "").trim()).find(t => /^Actuel —/.test(t));
    return { br, res, status };
  })()`);
  console.log("[prefs après Économe] " + JSON.stringify(st));
  check("maxBitrate = 5120000 (5 Mbps)", st.br === 5120000, String(st.br));
  check("resolution = 720p", st.res === "720p", String(st.res));
  check("statut mis à jour (720p affiché)", !!st.status && /720p/.test(st.status), String(st.status));
  const persist5 = await waitFor(`(() => {
    try { const s = JSON.parse(localStorage.getItem("BetterXcloud") || "{}"); return s["stream.video.maxBitrate"] === 5120000; }
    catch { return false; }
  })()`, 6000);
  check("persisté localStorage (5120000)", !!persist5);

  // 6. reload → persistance. Sur certains profils le reload peut rester figé
  // (readyState "loading" — flake réseau du site) : on attend une page
  // COMPLÈTE avec le script ; si le reload s'est pendu, on bascule sur une
  // navigation fraîche (test de persistance équivalent, et auto-réparation).
  await ev(`setTimeout(() => location.reload(), 0); true`).catch(() => {});
  let re = await waitFor(`(() => document.readyState === "complete" && !!(window.BX_EXPOSED && window.BX_DATA_SAVER))()`, 20000);
  if (!re) {
    console.log("[reload] page figée en reload — navigation fraîche de secours");
    await send("Page.navigate", { url: "https://www.xbox.com/fr-FR/play" });
    re = await waitFor(`(() => document.readyState === "complete" && !!(window.BX_EXPOSED && window.BX_DATA_SAVER))()`, 25000);
  }
  check("reload : page rechargée (script + feature)", !!re);
  // L'init du bundle est asynchrone (getGlobalPref n'est pas encore défini au
  // readyState complete) → on relit les prefs en polling jusqu'à disponibilité.
  st = await waitFor(`(() => {
    try {
      if (typeof getGlobalPref !== "function") return null;
      const br = getGlobalPref("stream.video.maxBitrate");
      const res = getGlobalPref("stream.video.resolution");
      const stored = JSON.parse(localStorage.getItem("BetterXcloud") || "{}");
      return { br, res, storedBr: stored["stream.video.maxBitrate"], storedRes: stored["stream.video.resolution"] };
    } catch (e) { return null; }
  })()`, 15000);
  console.log("[prefs après reload] " + JSON.stringify(st));
  check("maxBitrate = 5120000 après reload (persisté)", st.br === 5120000, String(st.br));
  check("resolution = 720p après reload (persistée)", st.res === "720p", String(st.res));
  check("localStorage.BetterXcloud.maxBitrate = 5120000 après reload", st.storedBr === 5120000, String(st.storedBr));

  // 7. ré-ouverture + restauration Max (15360000 = illimité). Le bouton est
  // re-injecté asynchronement après le reload — on attend sa présence au lieu
  // d'un sleep fixe.
  const btnBack = await waitFor(`(() => {
    const b = [...document.querySelectorAll("button")].find(x => /bx-header-settings/.test(String(x.className)));
    return !!b;
  })()`, 20000);
  check("bouton settings re-injecté après reload", !!btnBack);
  if (btnBack) {
    await ev(openSettings);
    await new Promise((res) => setTimeout(res, 1200));
    const dlg = await ev(`!!document.querySelector(".bx-settings-dialog")`);
    check("dialog settings rouvert après reload", dlg);
    await ev(clickPreset("🚀 Max"));
    await new Promise((res) => setTimeout(res, 700));
    const brMax = await ev(`getGlobalPref("stream.video.maxBitrate")`);
    const persist7 = await waitFor(`(() => {
      try { const s = JSON.parse(localStorage.getItem("BetterXcloud") || "{}"); return s["stream.video.maxBitrate"] === 15360000; }
      catch { return false; }
    })()`, 6000);
    const storedRaw = await ev(`JSON.parse(localStorage.getItem("BetterXcloud") || "{}")["stream.video.maxBitrate"]`);
    // Le max du slider (15360000) est la forme « illimité » ; setSetting
    // persiste la forme get (15360000) — le stocké 0 n'est que le défaut.
    check("restauration Max (15360000 = illimité)", brMax === 15360000 && !!persist7, JSON.stringify({ br: brMax, storedRaw }));
  }

  console.log(failures === 0 ? "\nFeature Data saver : validation OK" : `\n${failures} échec(s)`);
  ws.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
