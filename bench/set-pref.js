#!/usr/bin/env node
/**
 * bench/set-pref.js — pose une préférence EvenBetterXcloud (localStorage) puis recharge
 *
 * Usage : node bench/set-pref.js [--port=9225] '{"stream.video.maxBitrate":10240000}'
 *
 * Fusionne le JSON dans localStorage["BetterXcloud"] (objet plat de settings —
 * format lu par BaseSettingsStorage), recharge la page et attend que le bundle
 * soit de nouveau actif (window.BX_EXPOSED). Sortie : JSON { prefs, reloaded }.
 */
const CDP_PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "--port=9225").split("=")[1]);
const PREFS_JSON = process.argv.find((a) => a.startsWith("{")) || "{}";
const PREFS = JSON.parse(PREFS_JSON);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
  const targets = await r.json();
  const page = targets.find((t) => t.type === "page" && /xbox\.com/.test(t.url));
  if (!page) { console.error("pas de page xbox.com"); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  await new Promise((res) => (ws.onopen = res));
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = (expr) => send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }).then((r2) => r2.result.value);

  const before = await ev(`(() => { try { return JSON.parse(localStorage.getItem("BetterXcloud") || "{}"); } catch { return {}; } })()`);
  const merged = Object.assign({}, before, PREFS);
  await ev(`localStorage.setItem("BetterXcloud", ${JSON.stringify(JSON.stringify(merged))})`);
  await send("Page.reload", { ignoreCache: true });
  // attendre le bundle de retour
  let ok = false;
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    try {
      const bx = await ev(`!!window.BX_EXPOSED`);
      if (bx) { ok = true; break; }
    } catch {}
  }
  if (!ok) { console.error("bundle non revenu après reload"); process.exit(1); }
  console.log(JSON.stringify({ prefs: PREFS, before: before, merged: merged, reloaded: true }, null, 2));
  ws.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
