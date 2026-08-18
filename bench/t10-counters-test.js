#!/usr/bin/env node
/**
 * bench/t10-counters-test.js — contre-test T10 (auto-spoof UA) sur Chromium.
 * Navigue vers play.xbox.com, attend le chargement, puis vérifie :
 *   1. l'UA n'est PAS spoofée (T10 ne s'active que hors Chromium)
 *   2. l'overlay EvenBetterXcloud est présent
 *   3. le dialog "Votre navigateur ne prend pas en charge" est ABSENT
 * Usage : node bench/t10-counters-test.js [--port=9222]
 */
const PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "--port=9222").split("=")[1]);

(async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/json`);
  const targets = await r.json();
  const page = targets.find((t) => t.type === "page");
  if (!page) { console.error("pas de page ouverte"); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  await new Promise((res) => (ws.onopen = res));
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = (expr) => send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }).then((r2) => r2.result.value);

  const cur = await ev("location.href");
  if (!/xbox\.com/.test(cur)) {
    console.log("[nav] → play.xbox.com");
    await send("Page.navigate", { url: "https://play.xbox.com/" });
    await new Promise((r2) => setTimeout(r2, 18000));
  }

  const st = await ev(`(() => {
    const ua = navigator.userAgent;
    return {
      url: location.href,
      title: document.title,
      ua: ua.slice(0, 160),
      uaSpoofed: !/Edg\\//.test(ua),
      hasUserAgentData: !!navigator.userAgentData,
      bxExposed: !!window.BX_EXPOSED,
      overlay: !!document.querySelector('#bx-root, [id^=bx-]'),
      dialog: [...document.querySelectorAll('[role=dialog], h2, h1')]
        .map(e => (e.textContent || '').trim())
        .filter(t => /navigateur|Préparons|diffusion/i.test(t)).slice(0, 2),
      cards: [...document.querySelectorAll('a')].filter(a => a.href && a.href.includes('/products/')).length
    };
  })()`);

  console.log(JSON.stringify(st, null, 2));

  const ok = !st.uaSpoofed && st.bxExposed && st.dialog.length === 0;
  console.log(ok ? "\n[OK] Contre-test T10 : UA intacte, overlay présent, pas de dialog" :
    "\n[FAIL] Contre-test T10 : " + JSON.stringify({ uaSpoofed: st.uaSpoofed, bxExposed: st.bxExposed, dialog: st.dialog }));
  ws.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
