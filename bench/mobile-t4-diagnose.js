#!/usr/bin/env node
/**
 * bench/mobile-t4-diagnose.js — diagnostic T4 (overlay preview) en WebView
 * Android, consolidé.
 *
 * Modes :
 *   default      — sonde FAB mobile (émulation 390x844) : wrapper injecté,
 *                  bouton stylé pilule, clic → dialog settings
 *   --desktop    — sonde le chemin desktop (top bar nav.col-container)
 *   --shell      — dump du shell mobile (top-level, navs, barres)
 *   --bottomnav  — structure de la mini-nav basse (nav.z-shell-bottom)
 *   --html       — innerHTML mini-nav + état page (connecté ?)
 *
 * Historique du diagnostic (19 août) : sur téléphone (<768 px) le shell
 * mobile de play.xbox.com n'a PAS nav.col-container ni <header> — T4 ne
 * trouvait aucune ancre → aucun bouton, aucun accès settings. Fix : FAB
 * fixe au-dessus de la mini-nav basse (build-preview.js T4, bx-mobile-fab).
 *
 * Usage : node bench/mobile-t4-diagnose.js [--port=9341] [--desktop|--shell|--bottomnav|--html]
 */
const PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "--port=9341").split("=")[1]);
const MODE = process.argv.includes("--desktop") ? "desktop"
  : process.argv.includes("--shell") ? "shell"
  : process.argv.includes("--bottomnav") ? "bottomnav"
  : process.argv.includes("--html") ? "html"
  : "fab";

(async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/json`);
  const page = (await r.json())[0];
  if (!page) { console.error("pas de page WebView"); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  await new Promise((res) => (ws.onopen = res));
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = (expr) => send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }).then((r2) => r2.result.value);

  if (MODE !== "desktop") {
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 9; SM-G998B Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.70 Mobile Safari/537.36" });
  }
  await send("Page.reload", { ignoreCache: true });
  await new Promise((res) => setTimeout(res, 15000));

  const EXPR = {
    fab: `(() => {
      const fab = document.querySelector('.bx-mobile-fab');
      if (!fab) return { fab: false, innerWidth: window.innerWidth };
      const btn = [...fab.querySelectorAll('button')].find(b => /bx-header-settings/.test(String(b.className)));
      if (!btn) return { fab: true, btn: false };
      const r2 = btn.getBoundingClientRect();
      const cs = getComputedStyle(btn);
      return { fab: true, btn: true, innerWidth: window.innerWidth, rect: Math.round(r2.x)+','+Math.round(r2.y)+' '+Math.round(r2.width)+'x'+Math.round(r2.height), radius: cs.borderRadius, text: (btn.textContent||'').trim().slice(0,20) };
    })()`,
    desktop: `(() => {
      const nav = document.querySelector('nav.col-container');
      const btn = [...document.querySelectorAll('button')].find(b => /bx-header-settings/.test(String(b.className)));
      const fab = document.querySelector('.bx-mobile-fab');
      const r2 = btn ? btn.getBoundingClientRect() : null;
      return { innerWidth: window.innerWidth, navCol: !!nav, desktopBtn: !!btn, btnRect: r2 ? Math.round(r2.x)+','+Math.round(r2.y)+' '+Math.round(r2.width)+'x'+Math.round(r2.height) : null, fab: !!fab };
    })()`,
    shell: `(() => {
      const top = [...document.querySelectorAll('body > *')].map(e => ({
        tag: e.tagName, cls: String(e.className || '').slice(0, 60),
        rect: (() => { const r2 = e.getBoundingClientRect(); return Math.round(r2.width)+'x'+Math.round(r2.height); })()
      })).filter(x => x.rect !== '0x0').slice(0, 8);
      const navs = [...document.querySelectorAll('nav')].map(n => ({ cls: String(n.className).slice(0, 60) }));
      return { innerWidth: window.innerWidth, top, navs };
    })()`,
    bottomnav: `(() => {
      const nav = document.querySelector('nav.z-shell-bottom');
      if (!nav) return { found: false };
      const row = nav.querySelector('[class*=mini-nav] [class*=flex-row]') || nav.querySelector('[class*=flex-row]');
      const kids = row ? [...row.children].map(c => ({ tag: c.tagName, cls: String(c.className||'').slice(0,50), text: (c.textContent||'').trim().slice(0,12) })) : [];
      return { found: true, row: !!row, kids };
    })()`,
    html: `(() => {
      const nav = document.querySelector('nav.z-shell-bottom');
      const hasLogin = [...document.querySelectorAll('a, button')].some(e => /(sign ?in|connecter|se connecter)/i.test((e.textContent || '')));
      const cards = [...document.querySelectorAll('a')].filter(a => a.href && a.href.includes('/products/')).length;
      return { innerWidth, hasLogin, cards, navHtml: nav ? nav.innerHTML.replace(/\\s+/g,' ').slice(0, 600) : null };
    })()`,
  };

  const st = await ev(EXPR[MODE]);
  console.log(`[${MODE}] ` + JSON.stringify(st, null, 2));

  if (MODE === "fab" && st.btn) {
    const clicked = await ev(`(() => { const b = [...document.querySelectorAll('.bx-mobile-fab button')].find(x => /bx-header-settings/.test(String(x.className))); if (!b) return false; b.click(); return true; })()`);
    await new Promise((res) => setTimeout(res, 1500));
    const dlg = await ev(`(() => !!document.querySelector('.bx-settings-dialog'))()`);
    console.log(`[clic FAB → dialog] ${dlg}`);
  }
  if (MODE === "desktop" && st.desktopBtn) {
    const clicked = await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /bx-header-settings/.test(String(x.className))); b.click(); return true; })()`);
    await new Promise((res) => setTimeout(res, 1200));
    const dlg = await ev(`(() => !!document.querySelector('.bx-settings-dialog'))()`);
    console.log(`[clic desktop → dialog] ${dlg}`);
  }

  ws.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
