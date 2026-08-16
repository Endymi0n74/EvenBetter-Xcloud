#!/usr/bin/env node
/* probe-page.js — vérifie en direct (CDP 9222) si le hook userscript T6 est
 * actif sur la page play.xbox.com : window.fetch remplacé (BX_FETCH), marqueurs
 * BX_*, et l'état de session si un stream est en cours.
 *
 * Usage : node bench/preview/probe-page.js [port]
 */
"use strict";
const { chromium } = require("playwright");

(async () => {
  const port = process.argv[2] || "9222";
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const ctx = browser.contexts()[0];
    const page = ctx.pages().find((p) => p.url().includes("play.xbox.com"));
    if (!page) {
      console.log("aucune page play.xbox.com ouverte");
      return;
    }
    const res = await page.evaluate(() => {
      const out = { url: location.href };
      out.BX_FETCH = typeof window.BX_FETCH;
      out.BX_EXPOSED = typeof window.BX_EXPOSED;
      out.BX_FLAGS = typeof window.BX_FLAGS;
      out.BX_STREAM_SETTINGS = typeof window.BX_STREAM_SETTINGS;
      out.BX_CE = typeof window.BX_CE;
      // hook actif ? BX_FETCH = hook XcloudInterceptor posé (document-start). La
      // page peut ensuite ré-envelopper window.fetch (T5 keep-alive chaîné sur
      // BX_FETCH, ou wrapper du site) → ne PAS exiger window.fetch === BX_FETCH :
      // le signal fiable est la présence de BX_FETCH (le hook a été installé et
      // la chaîne fetch du SDK le traverse).
      out.hookActif = typeof window.BX_FETCH === "function";
      out.fetchEstEnveloppe = typeof window.fetch === "function" && window.fetch !== window.BX_FETCH;
      // état de session (best-effort)
      out.video = document.querySelector("video") ? { paused: document.querySelector("video").paused, readyState: document.querySelector("video").readyState } : null;
      out.headerClass = document.querySelector("header") ? document.querySelector("header").className : null;
      return out;
    });
    console.log(JSON.stringify(res, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
