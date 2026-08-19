#!/usr/bin/env node
/**
 * bench/feature-sound-probe.js — validation CDP de la feature « 🔊 Son »
 * (v1.13.0) sur www.xbox.com/play :
 *   1. BX_SOUND_PRESETS présent (script injecté) + features précédentes intactes
 *   2. ouverture du dialog settings + bascule sur l'onglet stream (le groupe
 *      « Son » natif vit dans TAB_DISPLAY_ITEMS, pas l'onglet global)
 *   3. groupe « Son » rendu avec les 4 presets (🔇 Muet / 🔉 Doux /
 *      🔊 Normal / 📢 Boost) + statut « Actuel — »
 *   4. cycle complet des 4 presets : clic → prefs attendues (poll du flush
 *      debounce) → statut reflète le preset
 *   5. persistance localStorage (audio.volume survivra au reload)
 *
 * Blindage (session du 18 août, fausse alarme « clics morts ») :
 *   - **Preset déjà actif** : les prefs PERSISTENT entre les runs
 *     (localStorage). Si l'état courant == le preset à tester, un clic est un
 *     no-op attendu → la probe force d'abord une transition vers un AUTRE
 *     preset, puis clique la cible : le clic testé est toujours une vraie
 *     transition d'état.
 *   - **Debounce saveSettings (~100 ms)** : après un clic, la probe POLLE les
 *     prefs jusqu'à la valeur attendue (au lieu d'un sleep fixe 700 ms) — le
 *     flush du debounce est couvert même si la machine est lente.
 *   - **Matching des boutons** par `textContent.includes(label)` (au lieu
 *     d'une regex construite) : les labels contiennent des emojis et des
 *     parenthèses (« 🔊 Normal (défaut) ») — une regex les échapperait mal.
 *
 * Usage : node bench/feature-sound-probe.js [--port=9225]
 */
const PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "--port=9225").split("=")[1]);

// Les 4 presets (source de vérité : feature-sound.js, IMPL presets)
const PRESETS = [
  { label: "📢 Boost", v: 200, boost: true },
  { label: "🔊 Normal (défaut)", v: 100, boost: false },
  { label: "🔉 Doux", v: 50, boost: false },
  { label: "🔇 Muet", v: 0, boost: false },
];

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
  const ev = (expr) => send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }).then((r2) => {
    if (r2.exceptionDetails) throw new Error(r2.exceptionDetails.exception?.description || r2.exceptionDetails.text);
    return r2.result.value;
  });
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const waitFor = async (expr, timeoutMs = 20000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { const v = await ev(expr); if (v) return v; } catch {}
      await sleep(300);
    }
    return null;
  };

  let failures = 0;
  const check = (label, cond, extra) => {
    console.log((cond ? "  ✓ " : "  ✗ ") + label + (extra ? " :: " + extra : ""));
    if (!cond) failures++;
  };

  // ---- helpers prefs / presets ----
  const readPrefs = () => ev(`(() => {
    let vol = null, boost = null;
    try { vol = getStreamPref("audio.volume"); } catch (e) {}
    try { boost = getGlobalPref("audio.volume.booster.enabled"); } catch (e) {}
    return { vol, boost };
  })()`);
  const currentLabel = (s) => {
    if (s.vol === null || s.vol === undefined) return null;
    if (s.boost) return "📢 Boost";
    if (s.vol === 0) return "🔇 Muet";
    if (s.vol === 50) return "🔉 Doux";
    return "🔊 Normal (défaut)";
  };
  const waitForPrefs = (v, boost, timeoutMs = 6000) => waitFor(
    `(() => {
      let vol = null, b = null;
      try { vol = getStreamPref("audio.volume"); } catch (e) {}
      try { b = getGlobalPref("audio.volume.booster.enabled"); } catch (e) {}
      return vol === ${JSON.stringify(v)} && b === ${JSON.stringify(boost)};
    })()`, timeoutMs);
  const clickPreset = (label) => ev(`(() => {
    const btn = [...document.querySelectorAll(".bx-settings-dialog button")].find(b => (b.textContent || "").includes(${JSON.stringify(label)}));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  const statusText = () => ev(`(document.querySelector(".bx-sound-status") || {}).textContent?.trim() || null`);

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

  // 2. ouvrir les settings + onglet stream (avec waitFor : le shell peut être lent)
  const opened = await ev(`(() => {
    const btn = [...document.querySelectorAll("button")].find(b => /bx-header-settings/.test(String(b.className)));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  check("bouton settings cliqué", opened);
  const dialog = await waitFor(`!!document.querySelector(".bx-settings-dialog")`);
  check("dialog settings ouvert", !!dialog);
  const tabStream = await ev(`(() => {
    const svg = document.querySelector('.bx-settings-tabs svg[data-group="stream"]');
    if (!svg) return false;
    svg.dispatchEvent(new Event("click"));
    return true;
  })()`);
  check("onglet stream activé (groupe Son)", tabStream);

  // 3. groupe Son + presets (waitFor le rendu après la bascule d'onglet)
  st = await waitFor(`(() => {
    const dlg = document.querySelector(".bx-settings-dialog");
    if (!dlg) return null;
    const presets = [...dlg.querySelectorAll("button")].filter(b => /🔇 Muet|🔉 Doux|🔊 Normal|📢 Boost/.test(b.textContent || "")).map(b => (b.textContent || "").trim().slice(0, 40));
    if (presets.length < 4) return null;
    const status = (document.querySelector(".bx-sound-status") || {}).textContent?.trim() || null;
    const audioTitle = [...dlg.querySelectorAll("h2")].map(h => (h.textContent || "").trim()).find(t => /Son|audio/i.test(t));
    return { dialog: true, presets, status, audioTitle };
  })()`);
  if (!st) { console.error("groupe Son non rendu — abort"); process.exit(1); }
  console.log("[settings stream] " + JSON.stringify(st, null, 1));
  check("dialog settings ouvert", st.dialog);
  check("titre groupe Son rendu", !!st.audioTitle, String(st.audioTitle));
  check("4 presets présents", st.presets.length === 4, "n=" + st.presets.length);
  check("statut « Actuel — » présent", !!st.status, String(st.status));

  // 4. cycle complet des 4 presets — chaque clic doit être une VRAIE
  //    transition d'état (pas un no-op sur un preset déjà actif)
  const before = await readPrefs();
  console.log("[départ] prefs " + JSON.stringify(before) + " (preset actif : " + currentLabel(before) + ")");
  for (const p of PRESETS) {
    let cur = await readPrefs();
    const curLabel = currentLabel(cur);
    if (curLabel === p.label) {
      // État persistant d'un run précédent : on force une transition vers un
      // autre preset pour que le clic cible soit réellement testé.
      const other = PRESETS.find((q) => q.label !== p.label && (q.v !== cur.vol || q.boost !== cur.boost));
      console.log("  (⚠ " + p.label + " déjà actif — bascule forcée vers " + other.label + " avant le test)");
      const okOther = await clickPreset(other.label);
      check("bascule forcée " + other.label + " cliquée", okOther);
      const flushed = await waitForPrefs(other.v, other.boost);
      check("bascule forcée appliquée (vol=" + other.v + " boost=" + other.boost + ")", !!flushed);
      cur = await readPrefs();
      if (currentLabel(cur) === p.label) { check("état re-basculé vers " + p.label + " pour le test", false, JSON.stringify(cur)); continue; }
    }
    const clicked = await clickPreset(p.label);
    check("clic " + p.label, clicked);
    // Poll du flush debounce saveSettings (~100 ms) — pas de sleep fixe.
    const flushed = await waitForPrefs(p.v, p.boost);
    const after = await readPrefs();
    check(p.label + " appliqué (vol=" + p.v + " boost=" + p.boost + ")", !!flushed, JSON.stringify(after));
    // Statut live : doit refléter le preset cliqué (le handler refresh() est
    // synchrone, mais on attend le libellé par robustesse).
    const statusOk = await waitFor(`(() => {
      const t = (document.querySelector(".bx-sound-status") || {}).textContent || "";
      return t.includes(${JSON.stringify(p.label)}) ? t : null;
    })()`, 4000);
    check("statut reflète « " + p.label + " »", !!statusOk, String(statusOk).slice(0, 60));
  }

  // 5. persistance localStorage (le stocké survit au reload — lecture différée
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
