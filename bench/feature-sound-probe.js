#!/usr/bin/env node
/**
 * bench/feature-sound-probe.js — validation CDP de la feature « 🔊 Son »
 * (v1.13.0) sur www.xbox.com/play :
 *   1. BX_SOUND_PRESETS présent (script injecté) + features précédentes intactes
 *   2. ouverture du dialog settings + bascule sur l'onglet stream (le groupe
 *      « Son » natif vit dans TAB_DISPLAY_ITEMS, pas l'onglet global)
 *   3. groupe « Son » rendu avec les 4 presets (🔇 Muet / 🔉 Doux /
 *      🔊 Normal / 📢 Boost) + statut « Actuel — »
 *   4. clic « 🔉 Doux » → audio.volume = 50 + statut mis à jour
 *   5. clic « 📢 Boost » → booster activé + volume 200
 *   6. clic « 🔊 Normal » → volume 100 + booster désactivé (défaut)
 *   7. persistance localStorage (audio.volume survivra au reload)
 *
 * Usage : node bench/feature-sound-probe.js [--port=9225]
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
  const waitFor = async (expr, timeoutMs = 20000) => {
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
    sound: typeof window.BX_SOUND_PRESETS,
    latency: typeof window.BX_LATENCY_TEST,
    region: typeof window.BX_REGION_APPLY,
    dataSaver: typeof window.BX_DATA_SAVER
  }))()`);
  console.log("[script] " + JSON.stringify(st));
  check("BX_EXPOSED présent", st.bxExposed);
  check("BX_SOUND_PRESETS défini", st.sound === "object");
  check("BX_LATENCY_TEST présent (régression)", st.latency === "object");
  check("BX_REGION_APPLY présent (régression)", st.region === "object");
  check("BX_DATA_SAVER présent (régression)", st.dataSaver === "object");

  // 2. ouvrir les settings + onglet stream
  const openSettings = `(() => {
    const btn = [...document.querySelectorAll("button")].find(b => /bx-header-settings/.test(String(b.className)));
    if (!btn) return false;
    btn.click();
    return true;
  })()`;
  const opened = await ev(openSettings);
  await new Promise((res) => setTimeout(res, 1500));
  check("bouton settings cliqué", opened);
  const tabStream = await ev(`(() => {
    const svg = document.querySelector('.bx-settings-tabs svg[data-group="stream"]');
    if (!svg) return false;
    svg.dispatchEvent(new Event("click"));
    return true;
  })()`);
  await new Promise((res) => setTimeout(res, 800));
  check("onglet stream activé (groupe Son)", tabStream);

  // 3. groupe Son + presets
  st = await ev(`(() => {
    const dlg = document.querySelector(".bx-settings-dialog");
    if (!dlg) return { dialog: false };
    const presets = [...dlg.querySelectorAll("button")].filter(b => /🔇 Muet|🔉 Doux|🔊 Normal|📢 Boost/.test(b.textContent || "")).map(b => (b.textContent || "").trim().slice(0, 40));
    const status = (document.querySelector(".bx-sound-status") || {}).textContent?.trim() || null;
    const audioTitle = [...dlg.querySelectorAll("h2")].map(h => (h.textContent || "").trim()).find(t => /Son|audio/i.test(t));
    return { dialog: true, presets, status, audioTitle };
  })()`);
  console.log("[settings stream] " + JSON.stringify(st, null, 1));
  check("dialog settings ouvert", st.dialog);
  check("titre groupe Son rendu", !!st.audioTitle, String(st.audioTitle));
  check("4 presets présents", st.presets.length === 4, "n=" + st.presets.length);
  check("statut « Actuel — » présent", !!st.status, String(st.status));

  const clickPreset = (label) => `(() => {
    const btn = [...document.querySelectorAll(".bx-settings-dialog button")].find(b => /${label}/.test(b.textContent || ""));
    if (!btn) return false;
    btn.click();
    return true;
  })()`;

  // 4. clic « Doux » → volume 50
  const clickedDoux = await ev(clickPreset("🔉 Doux"));
  await new Promise((res) => setTimeout(res, 700));
  check("clic preset Doux", clickedDoux);
  let vol = await ev(`(() => { try { return getStreamPref("audio.volume"); } catch (e) { return "ERR:" + e.message; } })()`);
  console.log("[prefs après Doux] volume=" + vol);
  check("audio.volume = 50", vol === 50, String(vol));
  const statusDoux = await ev(`(document.querySelector(".bx-sound-status") || {}).textContent || null`);
  check("statut mis à jour (50 %)", !!statusDoux && /50/.test(statusDoux), String(statusDoux));

  // 5. clic « Boost » → booster + volume 200
  const clickedBoost = await ev(clickPreset("📢 Boost"));
  await new Promise((res) => setTimeout(res, 700));
  check("clic preset Boost", clickedBoost);
  st = await ev(`(() => {
    let vol = null, boost = null;
    try { vol = getStreamPref("audio.volume"); } catch (e) {}
    try { boost = getGlobalPref("audio.volume.booster.enabled"); } catch (e) {}
    return { vol, boost };
  })()`);
  console.log("[prefs après Boost] " + JSON.stringify(st));
  check("audio.volume = 200", st.vol === 200, String(st.vol));
  check("booster activé", st.boost === true, String(st.boost));

  // 6. clic « Normal » → volume 100 + booster off (défaut)
  const clickedNorm = await ev(clickPreset("🔊 Normal"));
  await new Promise((res) => setTimeout(res, 700));
  check("clic preset Normal", clickedNorm);
  st = await ev(`(() => {
    let vol = null, boost = null;
    try { vol = getStreamPref("audio.volume"); } catch (e) {}
    try { boost = getGlobalPref("audio.volume.booster.enabled"); } catch (e) {}
    return { vol, boost };
  })()`);
  console.log("[prefs après Normal] " + JSON.stringify(st));
  check("audio.volume = 100 (défaut)", st.vol === 100, String(st.vol));
  check("booster désactivé", st.boost === false, String(st.boost));

  // 7. persistance localStorage (le stocké survit au reload — lecture différée
  // car saveSettings est débouncée ~100 ms)
  const persist = await waitFor(`(() => {
    try {
      for (const k of Object.keys(localStorage)) {
        if (!/BetterXcloud/.test(k)) continue;
        const raw = localStorage.getItem(k);
        if (raw && raw.includes("audio.volume")) return { k, hit: true };
      }
      return null;
    } catch { return null; }
  })()`, 6000);
  check("audio.volume persisté dans localStorage (BetterXcloud.*)", !!persist, JSON.stringify(persist));

  console.log(failures === 0 ? "\nFeature Son : validation OK" : `\n${failures} échec(s)`);
  ws.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
