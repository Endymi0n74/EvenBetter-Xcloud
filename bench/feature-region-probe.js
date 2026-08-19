#!/usr/bin/env node
/**
 * bench/feature-region-probe.js — validation CDP de la feature
 * « ⚡ Appliquer la meilleure région » (v1.12.0) sur www.xbox.com/play :
 *   1. BX_REGION_APPLY + BX_LATENCY_TEST présents (script injecté)
 *   2. ouverture du dialog settings (bouton header bx-header-settings)
 *   3. groupe SERVER rendu : bouton « Appliquer la meilleure région » présent,
 *      désactivé tant qu'aucun test de latence n'a tourné
 *   4. simulation des résultats du test (BX_LATENCY_TEST.lastResults) +
 *      refresh → le bouton s'active et affiche la meilleure région
 *   5. clic « Appliquer » → getGlobalPref("server.region") = clé de la
 *      meilleure région + persistance localStorage (debounce ~100 ms)
 *   6. refresh → « déjà appliquée ✅ », bouton désactivé
 *   7. restauration de la valeur d'origine (le probe ne laisse aucune trace)
 *
 * Note : on ne déclenche PAS le vrai test latence (pings gssv, jusqu'à 30 s)
 * — on pose lastResults directement, ce qui valide le chemin
 * résultats → bouton → pref. Le hook réel (lastResults rempli par run()) est
 * couvert par le gate vm feature-region.test.js.
 *
 * Usage : node bench/feature-region-probe.js [--port=9225]
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
      await new Promise((res) => setTimeout(res, 400));
    }
    return null;
  };

  let failures = 0;
  const check = (label, cond, extra) => {
    console.log((cond ? "  ✓ " : "  ✗ ") + label + (extra ? " :: " + extra : ""));
    if (!cond) failures++;
  };

  // 1. script présent + features
  let st = await ev(`(() => ({
    url: location.href,
    bxExposed: !!window.BX_EXPOSED,
    region: typeof window.BX_REGION_APPLY,
    latency: typeof window.BX_LATENCY_TEST
  }))()`);
  console.log("[script] " + JSON.stringify(st));
  check("BX_EXPOSED présent", st.bxExposed);
  check("BX_REGION_APPLY défini", st.region === "object");
  check("BX_LATENCY_TEST présent (dépendance)", st.latency === "object");

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

  // 3. groupe SERVER : bouton présent, désactivé (pas de résultats encore)
  st = await ev(`(() => {
    const dlg = document.querySelector(".bx-settings-dialog");
    const applyBtn = dlg ? dlg.querySelector(".bx-region-apply") : null;
    const status = dlg ? dlg.querySelector(".bx-region-status") : null;
    return { dialog: !!dlg, apply: !!applyBtn, disabled: applyBtn ? applyBtn.disabled : null, status: status ? (status.textContent || "").trim().slice(0, 90) : null };
  })()`);
  console.log("[settings] " + JSON.stringify(st, null, 1));
  check("dialog settings ouvert", st.dialog);
  check("bouton Appliquer la meilleure région rendu", st.apply);
  check("bouton désactivé sans résultats", st.disabled === true, String(st.disabled));
  check("statut d'attente affiché", !!st.status && /d'abord/.test(st.status), String(st.status));

  // 4. simulation des résultats du test latence + refresh
  await ev(`(() => {
    window.BX_LATENCY_TEST.lastResults = [
      { key: "UKS", code: "🇬🇧 UKS", label: "UK South", ms: 43, isDefault: true },
      { key: "CSE", code: "🇸🇬 CSE", label: "Central Singapore", ms: 30, isDefault: false },
      { key: "JPN", code: "🇯🇵 JPN", label: "Japan East", ms: 804, isDefault: false }
    ];
    window.BX_REGION_APPLY.refresh();
    return true;
  })()`);
  st = await ev(`(() => {
    const dlg = document.querySelector(".bx-settings-dialog");
    const applyBtn = dlg ? dlg.querySelector(".bx-region-apply") : null;
    const status = dlg ? dlg.querySelector(".bx-region-status") : null;
    return { disabled: applyBtn ? applyBtn.disabled : null, status: status ? (status.textContent || "").trim().slice(0, 120) : null };
  })()`);
  console.log("[après simulation] " + JSON.stringify(st));
  check("meilleure région affichée (CSE 30 ms)", !!st.status && /CSE/.test(st.status) && /30 ms/.test(st.status), String(st.status));
  check("bouton activé", st.disabled === false, String(st.disabled));

  // Valeur d'origine pour restauration en fin de probe
  const regionBefore = await waitFor(`(() => {
    try { if (typeof getGlobalPref !== "function") return null; return getGlobalPref("server.region"); } catch (e) { return null; }
  })()`, 10000);

  // 5. clic « Appliquer » → pref posée + persistée
  const clicked = await ev(`(() => {
    const btn = document.querySelector(".bx-settings-dialog .bx-region-apply");
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await new Promise((res) => setTimeout(res, 500));
  check("clic Appliquer", clicked);
  const applied = await waitFor(`(() => {
    try { if (typeof getGlobalPref !== "function") return null; return getGlobalPref("server.region") === "CSE"; } catch (e) { return false; }
  })()`, 8000);
  check("server.region = CSE (meilleure région)", !!applied);
  const persist = await waitFor(`(() => {
    try { const s = JSON.parse(localStorage.getItem("BetterXcloud") || "{}"); return s["server.region"] === "CSE"; }
    catch { return false; }
  })()`, 6000);
  check("persisté localStorage (server.region = CSE)", !!persist);

  // 6. refresh → déjà appliquée, bouton désactivé
  await ev(`window.BX_REGION_APPLY.refresh(); true`);
  st = await ev(`(() => {
    const dlg = document.querySelector(".bx-settings-dialog");
    const applyBtn = dlg ? dlg.querySelector(".bx-region-apply") : null;
    const status = dlg ? dlg.querySelector(".bx-region-status") : null;
    return { disabled: applyBtn ? applyBtn.disabled : null, status: status ? (status.textContent || "").trim().slice(0, 90) : null };
  })()`);
  console.log("[après application] " + JSON.stringify(st));
  check("statut « déjà appliquée ✅ »", !!st.status && /déjà appliquée/.test(st.status), String(st.status));
  check("bouton désactivé (déjà appliquée)", st.disabled === true, String(st.disabled));

  // 7. restauration de la valeur d'origine (aucune trace laissée)
  if (regionBefore !== null && regionBefore !== undefined) {
    await ev(`setGlobalPref("server.region", ${JSON.stringify(regionBefore)}, "ui"); true`);
    const restored = await waitFor(`(() => {
      try { return getGlobalPref("server.region") === ${JSON.stringify(regionBefore)}; } catch (e) { return false; }
    })()`, 6000);
    check("valeur d'origine restaurée (" + regionBefore + ")", !!restored);
  } else {
    console.log("[restauration] valeur d'origine inconnue — probe laisse " + "server.region=CSE" + " (prévenir si anomalie)");
  }

  console.log(failures === 0 ? "\nFeature Region : validation OK" : `\n${failures} échec(s)`);
  ws.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
