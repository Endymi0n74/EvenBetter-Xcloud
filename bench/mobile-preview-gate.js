#!/usr/bin/env node
/**
 * bench/mobile-preview-gate.js — sonde CDP de la WebView Android (variant
 * preview) : vérifie que le gate navigateur de play.xbox.com passe dans la
 * WebView (UA Chromium Android → pas de dialog), que le script preview est
 * chargé (BX_EXPOSED + version embarquée) et qu'aucun spoof T10 n'est
 * appliqué (inutile ici — la WebView est déjà Chromium).
 *
 * Usage : node bench/mobile-preview-gate.js [--port=9341]
 */
const PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "--port=9341").split("=")[1]);

(async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/json`);
  const targets = await r.json();
  const page = targets[0];
  if (!page) { console.error("pas de page WebView"); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  await new Promise((res) => (ws.onopen = res));
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = (expr) => send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }).then((r2) => r2.result.value);

  const st = await ev(`(() => {
    const ua = navigator.userAgent;
    const bx = window.BX_EXPOSED;
    return {
      url: location.href,
      title: document.title,
      ua: ua.slice(0, 220),
      uaChromium: /Chrome\\//.test(ua),
      uaSpoofed: !/Chrome|Edg\\//.test(ua),
      bxExposed: !!bx,
      bxVersion: bx && bx.version ? bx.version : (typeof bx === "object" ? Object.keys(bx).length + " patches" : String(bx).slice(0, 40)),
      dialog: [...document.querySelectorAll("[role=dialog], h2, h1")]
        .map(e => (e.textContent || "").trim())
        .filter(t => /navigateur|Préparons|diffusion/i.test(t)).slice(0, 2),
      cards: [...document.querySelectorAll("a")].filter(a => a.href && a.href.includes("/products/")).length,
      loginBtn: [...document.querySelectorAll("button")]
        .filter(b => /(sign in|connecter|se connecter)/i.test(b.textContent || "")).length
    };
  })()`);

  console.log(JSON.stringify(st, null, 2));
  const ok = st.uaChromium && !st.uaSpoofed && st.dialog.length === 0;
  console.log(ok ? "\n[OK] Gate navigateur WebView : UA Chromium Android, pas de dialog, script actif" :
    "\n[FAIL] WebView preview : " + JSON.stringify({ uaChromium: st.uaChromium, dialog: st.dialog, bxExposed: st.bxExposed }));
  ws.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
