#!/usr/bin/env node
/**
 * bench/feature-datasaver-probe.js — validation CDP de la feature « 📊 Données »
 * (v1.11.0) sur www.xbox.com/play :
 *   1. BX_DATA_SAVER présent (script injecté)
 *   2. ouverture du dialog settings (bouton header bx-header-settings)
 *   3. groupe « 📊 Données » rendu (titre + 3 presets + statut actuel)
 *   4. clic sur « Équilibré » → prefs posées (maxBitrate 10240000,
 *      resolution auto) via getStreamPref + localStorage["BetterXcloud"]
 *   5. restauration du preset Max (0 / auto)
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
  const opened = await ev(`(() => {
    const btn = [...document.querySelectorAll("button")].find(b => /bx-header-settings/.test(String(b.className)));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
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

  // 4. clic « Équilibré » → prefs posées
  const clicked = await ev(`(() => {
    const btn = [...document.querySelectorAll(".bx-settings-dialog button")].find(b => /⚖️ Équilibré/.test(b.textContent || ""));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await new Promise((res) => setTimeout(res, 800));
  check("clic preset Équilibré", clicked);
  st = await ev(`(() => {
    const br = getGlobalPref("stream.video.maxBitrate");
    const res = getGlobalPref("stream.video.resolution");
    const stored = JSON.parse(localStorage.getItem("BetterXcloud") || "{}");
    return { br, res, storedBr: stored["stream.video.maxBitrate"], storedRes: stored["stream.video.resolution"] };
  })()`);
  console.log("[prefs après Équilibré] " + JSON.stringify(st));
  check("maxBitrate = 10240000 (10 Mbps)", st.br === 10240000, String(st.br));
  check("resolution = auto", st.res === "auto", String(st.res));
  check("persisté localStorage", st.storedBr === 10240000 && (st.storedRes === "auto" || st.storedRes === undefined));

  // 5. restauration Max (0 / auto)
  await ev(`(() => {
    const btn = [...document.querySelectorAll(".bx-settings-dialog button")].find(b => /🚀 Max/.test(b.textContent || ""));
    if (btn) btn.click();
    return true;
  })()`);
  await new Promise((res) => setTimeout(res, 600));
  st = await ev(`(() => {
    const stored = JSON.parse(localStorage.getItem("BetterXcloud") || "{}");
    return { br: getGlobalPref("stream.video.maxBitrate"), storedRaw: stored["stream.video.maxBitrate"] };
  })()`);
  // Le max du slider (15360000) est la forme « illimité » ; setSetting persiste
  // la forme get (15360000) — le stocké 0 n'est que le défaut initial.
  check("restauration Max (15360000 = illimité)", st.br === 15360000 && st.storedRaw === 15360000, JSON.stringify(st));

  console.log(failures === 0 ? "\nFeature Data saver : validation OK" : `\n${failures} échec(s)`);
  ws.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
