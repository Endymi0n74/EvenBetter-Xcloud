#!/usr/bin/env node
/*
 * inject-preview.js — injecte better-xcloud-preview.user.js par CDP sur chaque
 * page play.xbox.com du navigateur connecté, en MONDE PRINCIPAL, avant tout
 * script page (équivalent @run-at document-start + @grant none).
 *
 * POURQUOI WS BRUT et pas newCDPSession (corrigé 18 août) : sur Edge 152,
 * `Page.addScriptToEvaluateOnNewDocument` envoyé via `ctx.newCDPSession(page)`
 * (Playwright connectOverCDP) est accepté mais NE S'APPLIQUE PAS aux nouveaux
 * documents (vérifié au micro-test : `window.__BX_TEST__` jamais posé). Le CDP
 * brut sur le webSocketDebuggerUrl de la target fonctionne, lui. Le watcher
 * poll donc /json et attache un WS par target play.xbox.com.
 *
 * POURQUOI monde principal et pas addInitScript : Playwright exécute
 * addInitScript dans un contexte V8 isolé — ses wrappers DOM sont liés au
 * realm : le preview (BxSelectElement.ensureObserver) crash en
 * « MutationObserver: parameter 1 is not of type Node ».
 *
 * POURQUOI injecter du tout : le profil edge-cdp ne peut pas exécuter
 * d'userscript — Tampermonkey (MV3, API userScripts) exige le mode développeur
 * d'Edge, non activable ici. Dans le navigateur réel de l'utilisateur, la
 * preview s'installe normalement dans Tampermonkey.
 *
 * ⚠️ Le script exige un VRAI document-start : injecté sur une page déjà
 * chargée, `class HeaderSection` entre en collision avec le global React du
 * site (ReferenceError: Cannot access 'HeaderSection' before initialization).
 * Le watcher ne fait donc PAS d'éval sur les pages déjà ouvertes — il
 * enregistre le script pour les documents suivants (reload/ouverture).
 *
 * Usage : node bench/preview/inject-preview.js [port] [chemin-user-js]
 *   Reste en vie (watcher) : injecte aussi les futures pages.
 */
"use strict";
const fs = require("fs");
const http = require("http");

const port = process.argv[2] || "9222";
const userJs = process.argv[3] || "better-xcloud-preview.user.js";
const BASE = `http://127.0.0.1:${port}`;

/*
 * Wrapper IIFE (18 août) : `Page.addScriptToEvaluateOnNewDocument` évalue le
 * script dans le scope global PARTAGÉ avec les bundles classiques du site —
 * les déclarations top-level du build (`class KeyHelper`, `class HeaderSection`,
 * `class BxSelectElement`…) entraient en collision avec celles du site
 * (`SyntaxError: Identifier 'KeyHelper' has already been declared` dans
 * index.client-*.js → boot du site cassé). Tampermonkey enveloppe les
 * userscripts dans une closure ; on fait pareil. Expositions window.*
 * (BX_CE / BX_EXPOSED / BX_FETCH) restent visibles pour probe-page.js.
 */
const src = `(function(){\n${fs.readFileSync(userJs, "utf8")}\n})();\n//# sourceURL=bx-preview-injected.js`;

const getTargets = () =>
  new Promise((res, rej) => {
    http
      .get(`${BASE}/json`, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => res(JSON.parse(d)));
      })
      .on("error", rej);
  });

const attach = (target) =>
  new Promise((res, rej) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m.result || m.error);
        pending.delete(m.id);
      }
    };
    ws.onopen = async () => {
      const send = (method, params = {}) =>
        new Promise((resolve) => {
          const i = ++id;
          pending.set(i, resolve);
          ws.send(JSON.stringify({ id: i, method, params }));
        });
      await send("Page.enable").catch(() => {});
      const reg = await send("Page.addScriptToEvaluateOnNewDocument", {
        source: src,
      }).catch((e) => ({ error: e }));
      if (reg && reg.error) {
        console.log(`[inject] échec registration sur ${target.url.slice(0, 50)} : ${String(reg.error).slice(0, 70)}`);
      } else {
        console.log(
          `[inject] ${new Date().toLocaleTimeString("fr-FR", { hour12: false })} script posé (monde principal) sur ${target.url.slice(0, 60)}`
        );
      }
      res();
    };
    ws.onerror = (e) => rej(new Error("ws error"));
  });

(async () => {
  const seen = new Set();
  console.log(`[inject] watcher actif sur :${port} — ${src.length} octets, monde principal (Ctrl+C pour arrêter)`);
  console.log(`[inject] ${userJs} — document-start requis (pas d'éval sur pages déjà ouvertes : collision HeaderSection)`);
  for (;;) {
    let targets;
    try {
      targets = await getTargets();
    } catch (e) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    for (const t of targets) {
      if (t.type !== "page") continue;
      if (!t.url.includes("play.xbox.com")) continue;
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      attach(t).catch((e) => console.log(`[inject] ws échec ${t.url.slice(0, 40)} : ${e.message}`));
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
