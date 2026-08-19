#!/usr/bin/env node
/*
 * mobile-regions-probe.js — sonde doc-start + état session + régions du
 * WebView de l'APK (validation mobile rejouable, BlueStacks ou téléphone).
 *
 * Usage :
 *   node bench/mobile-regions-probe.js <port> [--wait-ms N]
 *     port : port TCP adb-forwardé vers le socket devtools du WebView
 *            (localabstract:webview_devtools_remote_<pid>)
 *
 *   Flux complet (APK preview, après install) :
 *     adb shell am force-stop com.bxperf.preview
 *     adb shell am start -n com.bxperf.preview/com.bxperf.app.MainActivity
 *     adb shell "cat /proc/net/unix | grep webview_devtools"   # → PID
 *     adb forward tcp:9342 localabstract:webview_devtools_remote_<PID>
 *     node bench/mobile-regions-probe.js 9342
 *
 * Vérifie : __EBX_INJECTED__ (doc-start), BX_EXPOSED/BX_FETCH (hook),
 * window.STATES (patch 23), nombre de régions, isSignedIn, overlay.
 * Les régions se peuplent AU LOGIN (interception du POST /v2/login/user par
 * XcloudInterceptor.handleLogin) → il faut une session authentifiée (le
 * téléphone), sinon nbRegions=0 attendu. exit 0 si doc-start + marqueurs OK.
 */
"use strict";
const http = require("http");

const port = process.argv[2] || "9342";
const waitIdx = process.argv.indexOf("--wait-ms");
const waitMs = waitIdx >= 0 ? parseInt(process.argv[waitIdx + 1], 10) : 8000;
const BASE = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getJson = (p) =>
  new Promise((res, rej) => {
    http.get(`${BASE}${p}`, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });

const attach = (t) =>
  new Promise((res, rej) => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    };
    ws.onopen = () =>
      res({
        send: (method, params = {}) =>
          new Promise((resolve) => {
            const i = ++id;
            pending.set(i, resolve);
            ws.send(JSON.stringify({ id: i, method, params }));
          }),
        close: () => ws.close(),
      });
    ws.onerror = () => rej(new Error("ws error"));
  });

const evalJs = async (cdp, expression) => {
  const m = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
  if (m.result && m.result.exceptionDetails) {
    throw new Error("exception: " + JSON.stringify(m.result.exceptionDetails).slice(0, 300));
  }
  return m.result && m.result.result ? m.result.result.value : undefined;
};

const PROBE = `(() => {
  const S = window.STATES;
  const out = {};
  out.ebxInjected = !!window.__EBX_INJECTED__;
  out.bxExposed = typeof window.BX_EXPOSED === 'object' && !!window.BX_EXPOSED;
  out.bxFetch = typeof window.BX_FETCH === 'function';
  out.hasStates = !!S;
  out.nbRegions = (S && S.serverRegions && S.serverRegions.length) || 0;
  out.selectedRegion = (S && S.selectedRegion) || null;
  out.isSignedIn = !!(S && S.isSignedIn);
  out.gsToken = !!(S && S.gsToken);
  out.xbcUser = (typeof window.xbcUser === 'object' && window.xbcUser)
    ? { isSignedIn: !!window.xbcUser.isSignedIn, gamerTag: window.xbcUser.gamerTag || null } : null;
  out.settingsBtn = !!document.querySelector('.bx-header-settings-button');
  out.settingsBtns = document.querySelectorAll('.bx-header-settings-button').length;
  out.fabBtn = !!document.querySelector('.bx-fab');
  out.url = location.href;
  return out;
})()`;

(async () => {
  const targets = await getJson("/json");
  const page = targets.find((t) => t.type === "page" && t.url.includes("xbox.com"))
    || targets.find((t) => t.type === "page");
  if (!page) { console.log("❌ aucune page trouvée sur le port " + port); process.exit(1); }
  const cdp = await attach(page);
  await sleep(Math.min(waitMs, 2000));

  const r = await evalJs(cdp, PROBE);
  console.log("=== Sonde mobile doc-start / régions ===");
  console.log(JSON.stringify(r, null, 2));

  const ok = r.ebxInjected && r.bxExposed && r.bxFetch && r.hasStates && r.settingsBtn === true && r.settingsBtns === 1;
  console.log(ok ? "\n✅ GATE VERT — doc-start + hook + STATES + overlay (idempotent)"
                 : "\n❌ GATE ROUGE — un marqueur doc-start manque");
  if (r.isSignedIn) {
    console.log(`ℹ️ Session authentifiée : ${r.nbRegions} régions (selected=${JSON.stringify(r.selectedRegion)}).`);
  } else {
    console.log("⚠️ Pas de session Xbox dans ce WebView — les régions se peuplent au LOGIN (POST /v2/login/user intercepté). Rejouer sur un device connecté (téléphone).");
  }
  cdp.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
