#!/usr/bin/env node
/*
 * inject-preview.js — injecte better-xcloud-preview.user.js par CDP sur chaque
 * page play.xbox.com du navigateur connecté, en MONDE PRINCIPAL, avant tout
 * script page (équivalent @run-at document-start + @grant none).
 *
 * POURQUOI CDP brut et pas addInitScript : Playwright exécute addInitScript
 * dans un contexte V8 isolé — ses globaux sont visibles du monde principal
 * (BX_CE apparaît) mais ses wrappers DOM sont liés au realm : le preview
 * (BxSelectElement.ensureObserver) crash en « MutationObserver: parameter 1
 * is not of type Node » en observant document.documentElement. L'API CDP
 * Page.addScriptToEvaluateOnNewDocument SANS worldName s'exécute dans le
 * MONDE PRINCIPAL — pas de problème de realm, comme un vrai userscript.
 *
 * POURQUOI injecter du tout : le profil edge-cdp ne peut pas exécuter
 * d'userscript — Tampermonkey (MV3, API userScripts) exige le mode développeur
 * d'Edge, non activable ici (edge://extensions ne se rend pas en CDP, Edge ne
 * persiste pas la préférence). Dans le navigateur réel de l'utilisateur, la
 * preview s'installe normalement dans Tampermonkey.
 *
 * Usage : node bench/preview/inject-preview.js [port] [chemin-user-js]
 *   Reste en vie (watcher) : injecte aussi les futures pages.
 */
"use strict";
const fs = require("fs");
const { chromium } = require("playwright");

(async () => {
  const port = process.argv[2] || "9222";
  const userJs = process.argv[3] || "better-xcloud-preview.user.js";
  const src = fs.readFileSync(userJs, "utf8");

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0];

  const inject = async (page) => {
    try {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: src });
      console.log(`[inject] ${new Date().toLocaleTimeString("fr-FR", { hour12: false })} script posé (monde principal) sur ${page.url().slice(0, 60)}`);
    } catch (e) {
      console.log(`[inject] échec sur ${page.url().slice(0, 50)} : ${e.message.split("\n")[0].slice(0, 70)}`);
    }
  };

  ctx.on("page", (p) => {
    p.on("domcontentloaded", () => { if (p.url().includes("play.xbox.com")) inject(p); });
  });

  for (const p of ctx.pages()) if (p.url().includes("play.xbox.com")) inject(p);
  console.log(`[inject] watcher actif sur :${port} — ${src.length} octets, monde principal (Ctrl+C pour arrêter)`);

  setInterval(() => {}, 60000);
  process.on("SIGINT", () => process.exit(0));
})().catch((e) => { console.error(e.message); process.exit(1); });
