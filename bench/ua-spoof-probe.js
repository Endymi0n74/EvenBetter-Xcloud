#!/usr/bin/env node
/**
 * bench/ua-spoof-probe.js — teste le gate « navigateur non supporté » de
 * play.xbox.com en simulant une UA Firefox via CDP (Emulation).
 *
 * Usage : node bench/ua-spoof-probe.js [--port=9222] [--firefox-ua="..."]
 * Sortie : JSON { dialogPresent, dialogText, url, bx, gateInfo }.
 */
const CDP_PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "--port=9222").split("=")[1]);
const FIREFOX_UA = (process.argv.find((a) => a.startsWith("--firefox-ua=")) || "--firefox-ua=Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0").split("=").slice(1).join("=");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
  const targets = await r.json();
  const page = targets.find((t) => t.type === "page" && /xbox\.com|about:blank/.test(t.url)) || targets.find((t) => t.type === "page");
  if (!page) { console.error("pas de page"); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  await new Promise((res) => (ws.onopen = res));
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = (expr) => send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }).then((r2) => r2.result.value);

  // 1. Simuler l'UA Firefox (et un userAgentData cohérent minimaliste)
  await send("Emulation.setUserAgentOverride", {
    userAgent: FIREFOX_UA,
    platform: "Win32",
    userAgentMetadata: {
      platform: "Windows",
      platformVersion: "10.0.0",
      architecture: "x86",
      model: "",
      mobile: false,
      brands: [{ brand: "Firefox", version: "130" }],
      fullVersionList: [{ brand: "Firefox", version: "130.0" }],
    },
  });
  console.log("[ua] UA Firefox simulée");

  // 2. Naviguer sur play.xbox.com
  await send("Page.navigate", { url: "https://play.xbox.com" });
  await sleep(15000);

  // 3. Chercher le dialog + le gate
  const out = await ev(`(() => {
    const body = document.body ? document.body.innerText : "";
    const dialog = (() => {
      const els = [...document.querySelectorAll('[role="dialog"], dialog, [class*="dialog"], [class*="modal"]')];
      for (const el of els) {
        if (/prend pas en charge|doesn't support|not supported|not support/i.test(el.innerText || "")) return { text: (el.innerText || "").slice(0, 300) };
      }
      return null;
    })();
    const unsupported = /prend pas en charge|doesn't support|not supported/i.test(body) ? body.slice(0, 300) : null;
    return {
      url: location.href,
      ua: navigator.userAgent,
      bx: !!window.BX_EXPOSED,
      dialog,
      unsupportedText: unsupported,
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
  ws.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
