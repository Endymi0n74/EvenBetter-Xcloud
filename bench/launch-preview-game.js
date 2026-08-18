#!/usr/bin/env node
/**
 * bench/launch-preview-game.js — lance un jeu sur play.xbox.com (preview) et
 * attend le stream live. Usage : node bench/launch-preview-game.js [--port=9222]
 * [--product=https://play.xbox.com/products/9NG07QJNK38J] [--timeout=120]
 * Sortie : JSON { url, video: {readyState, w, h, t} }.
 */
const CDP_PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "--port=9222").split("=")[1]);
const PRODUCT = (process.argv.find((a) => a.startsWith("--product=")) || "--product=https://play.xbox.com/products/9NG07QJNK38J").split("=").slice(1).join("=");
const TIMEOUT = Number((process.argv.find((a) => a.startsWith("--timeout=")) || "--timeout=120").split("=")[1]);
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
  const evEx = async (expr) => {
    const rr = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (rr.exceptionDetails) throw new Error("EXCEPTION: " + (rr.exceptionDetails.exception?.description || JSON.stringify(rr.exceptionDetails)));
    return rr.result.value;
  };

  // 1. Aller sur la page produit
  await send("Page.navigate", { url: PRODUCT });
  console.log("[preview] navigation vers " + PRODUCT);

  // 2. Attendre le bouton Jouer puis cliquer
  const t0 = Date.now();
  let video = null;
  while (Date.now() - t0 < TIMEOUT * 1000) {
    const state = await ev(`(() => ({
      url: location.href,
      playBtns: [...document.querySelectorAll('button, a')].filter(b => /jouer|play now|^play$/i.test((b.textContent || '').trim()) && (b.textContent || '').trim().length < 40).map(b => (b.textContent || '').trim()),
      video: (() => { const v = [...document.querySelectorAll('video')].sort((a,b) => b.videoWidth - a.videoWidth)[0]; return v ? { readyState: v.readyState, w: v.videoWidth, h: v.videoHeight, t: v.currentTime } : null; })(),
    }))()`);
    if (state.video && state.video.readyState >= 3 && state.video.t > 0) { video = state.video; break; }
    if (state.url.includes("/stream/") && state.playBtns.length) {
      const clicked = await evEx(`(() => {
        const els = [...document.querySelectorAll('button, a')];
        const el = els.find(b => /jouer|play now|^play$/i.test((b.textContent || '').trim()) && (b.textContent || '').trim().length < 40);
        if (el) { el.click(); return (el.textContent || '').trim(); }
        return null;
      })()`);
      if (clicked) console.log("[preview] clic sur « " + clicked + " »");
    } else if (state.url.includes("/stream/") && !state.video) {
      // sur la page stream, la vidéo arrive
    }
    await sleep(3000);
  }
  if (!video) { console.error("timeout — stream non démarré"); process.exit(1); }
  console.log(JSON.stringify({ url: (await ev("location.href")), video }, null, 2));
  ws.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
