#!/usr/bin/env node
/**
 * bench/page-probe.js — sonde générique de la page xbox (session, jeux, DOM)
 * Usage : node bench/page-probe.js [--port=9225]
 */
const CDP_PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "--port=9225").split("=")[1]);
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
  const st = await ev(`(() => {
    const cards = [...document.querySelectorAll('a')].filter(a => a.href && a.href.includes('/products/'));
    return {
      url: location.href,
      title: document.title,
      bx: !!window.BX_EXPOSED,
      cards: cards.slice(0, 10).map(a => ({ href: a.href, text: (a.textContent || '').trim().slice(0, 40) })),
      buttons: [...document.querySelectorAll('button')].slice(0, 20).map(b => (b.textContent || '').trim().slice(0, 40)).filter(Boolean),
    };
  })()`);
  console.log(JSON.stringify(st, null, 2));
  ws.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
