#!/usr/bin/env node
/*
 * mobile-probe.js — sonde CDP du WebView de l'APK mobile (validation rejouable).
 *
 * Se connecte au port adb-forwardé vers le socket devtools du WebView
 * (localabstract:webview_devtools_remote_<pid>), trouve la page xbox.com,
 * vérifie les marqueurs du build (BX_EXPOSED / BX_FETCH) et l'overlay
 * (bouton settings .bx-header-settings-button visible), puis — en mode
 * --cycle — rejoue le test panne → récupération :
 *   1. navigation vers https://www.xbox.com:444/ (port fermé → erreur
 *      réseau → page d'erreur « Connexion impossible »)
 *   2. retry auto à +5 s → retour sur /play avec l'overlay
 *
 * Usage : node bench/mobile-probe.js <port> [--cycle|--manual] [--wait-ms N]
 *   port    : port TCP adb-forwardé vers le WebView (mobile-probe.sh le
 *             calcule et fait le forward ; usage manuel possible)
 *   --cycle : test panne→récupération par le RETRY AUTO (+5 s)
 *   --manual: test panne→récupération par CLIC sur « Réessayer » (page
 *             d'erreur) — la récupération manuelle quand le réseau revient
 *   (défaut sans flag : sonde seule)
 *   exit 0 si tout passe, 1 sinon (message GATE ROUGE si un point échoue)
 */
"use strict";
const http = require("http");

const port = process.argv[2] || "9341";
const DO_CYCLE = process.argv.includes("--cycle");
const DO_MANUAL = process.argv.includes("--manual");
const waitMs = parseInt(process.argv[process.argv.indexOf("--wait-ms") + 1], 10) || 60_000;
const BASE = `http://127.0.0.1:${port}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getJson = (path) =>
  new Promise((res, rej) => {
    http
      .get(`${BASE}${path}`, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => {
          try {
            res(JSON.parse(d));
          } catch (e) {
            rej(e);
          }
        });
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
    ws.onerror = (e) => rej(new Error("ws error"));
  });

const evalJs = (cdp, expression) =>
  cdp
    .send("Runtime.evaluate", { expression, returnByValue: true })
    // Réponse CDP : { id, result: { result: { type, value } } } — send() rend
    // m.result, donc la valeur est à r.result.value.
    .then((r) => (r && r.result && r.result.value !== undefined ? r.result.value : undefined));

// Sonde de l'overlay : marqueurs du build + bouton settings visible.
const PROBE_JS = `(() => {
  const btn = document.querySelector('.bx-header-settings-button');
  const visible = btn ? (() => {
    const s = getComputedStyle(btn);
    const r = btn.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  })() : false;
  return {
    pathname: location.pathname,
    title: document.title,
    readyState: document.readyState,
    BX_EXPOSED: typeof window.BX_EXPOSED,
    BX_FETCH: typeof window.BX_FETCH,
    BX_CE: typeof window.BX_CE,
    bxElements: document.querySelectorAll('[class*="bx-"]').length,
    settingsBtn: !!btn,
    settingsBtnVisible: visible,
  };
})()`;

// Page d'erreur (MainActivity.showErrorPage) : titre « Connexion impossible ».
const ERROR_JS = `(() => {
  const t = document.title || '';
  const txt = (document.body && document.body.innerText) || '';
  return {
    isErrorPage: t.includes('Connexion impossible') || txt.includes('Connexion impossible'),
    title: t,
    pathname: location.pathname,
  };
})()`;

// Clic sur « Réessayer » (le bouton est un lien absolu vers START_URL,
// https://www.xbox.com/play — buildErrorHtml dans MainActivity).
const CLICK_RETRY_JS = `(() => {
  const a = document.querySelector('a[href*="xbox.com/play"]');
  if (!a) return false;
  a.click();
  return true;
})()`;

let failures = 0;
const gate = (name, ok, detail) => {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

// Poll une expression jusqu'à ce que le prédicat passe (ou timeout).
// La page peut être lente à charger (émulateur) : on n'exige jamais un état
// au premier essai, on attend qu'il arrive (retry auto, rendu de l'overlay…).
const waitFor = async (cdp, expression, predicate, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evalJs(cdp, expression).catch(() => null);
    if (predicate(last)) return last;
    await sleep(1000);
  }
  return last;
};

async function main() {
  // Attendre que le WebView réponde (socket devtools encore en chaud au boot).
  let targets = [];
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    try {
      targets = await getJson("/json");
      if (targets.length > 0) break;
    } catch {}
    await sleep(1000);
  }
  if (targets.length === 0) {
    console.error("❌ GATE ROUGE : aucun target CDP sur :" + port + " (WebView pas démarré ?)");
    process.exit(1);
  }

  const page = targets.find(
    (t) => t.type === "page" && (t.url.includes("xbox.com") || t.url.includes("play.xbox.com"))
  );
  if (!page) {
    const urls = targets.filter((t) => t.type === "page").map((t) => t.url);
    console.error("❌ GATE ROUGE : aucune page xbox.com dans le WebView — " + JSON.stringify(urls));
    process.exit(1);
  }
  console.log(`[probe] page : ${page.url}`);

  const cdp = await attach(page);
  try {
    await cdp.send("Page.enable").catch(() => {});
    await cdp.send("Runtime.enable").catch(() => {});

    // ---- Phase 1 : sonde overlay ----
    // La page peut démarrer blanche (émulateur lent) : attendre d'abord que le
    // script soit injecté (BX_EXPOSED) sur /play, puis que le bouton soit rendu.
    const p = await waitFor(
      cdp,
      PROBE_JS,
      (r) => r && r.pathname.includes("/play") && r.BX_EXPOSED === "object" && r.settingsBtnVisible,
      waitMs,
      "page prête + overlay"
    );
    gate("page prête (pathname /play + BX_EXPOSED)", p && p.pathname.includes("/play") && p.BX_EXPOSED === "object", p && p.pathname);
    gate("BX_FETCH=function", p && p.BX_FETCH === "function", String(p && p.BX_FETCH));
    gate("BX_CE=function", p && p.BX_CE === "function", String(p && p.BX_CE));
    gate("bouton settings présent", p && p.settingsBtn, String(p && p.settingsBtn));
    gate("bouton settings visible", p && p.settingsBtnVisible, String(p && p.settingsBtnVisible));
    console.log(`[probe] ${JSON.stringify(p)}`);

    if (!DO_CYCLE && !DO_MANUAL) {
      if (failures === 0) {
        console.log("SONDE OK");
        process.exit(0);
      }
      console.error(`\n❌ GATE ROUGE : ${failures} échec(s)`);
      process.exit(1);
    }

    // ---- Phase 2 : panne → récupération (auto ou manuelle) ----
    const mode = DO_MANUAL ? "manual" : "cycle";
    console.log(`\n[${mode}] panne — navigation vers www.xbox.com:444 (port fermé)…`);
    await cdp.send("Page.navigate", { url: "https://www.xbox.com:444/" });

    let err = null;
    const errDeadline = Date.now() + 15_000;
    while (Date.now() < errDeadline) {
      err = await evalJs(cdp, ERROR_JS).catch(() => null);
      if (err && err.isErrorPage) break;
      await sleep(500);
    }
    gate("page d'erreur affichée", err && err.isErrorPage, err && (err.title || err.pathname));
    console.log(`[${mode}] erreur : ${JSON.stringify(err)}`);

    if (DO_MANUAL) {
      // Récupération MANUELLE : clic sur « Réessayer » (lien vers START_URL).
      // Le clic doit se faire avant le retry auto (+5 s) pour prouver que la
      // voie manuelle suffit — la page d'erreur apparaît en ~1 s.
      const clicked = await evalJs(cdp, CLICK_RETRY_JS).catch(() => false);
      gate("clic « Réessayer »", clicked === true, String(clicked));
      console.log("[manual] clic « Réessayer » envoyé — attente du retour…");
    } else {
      // Récupération AUTO : retry backoff +5 s.
      console.log("[cycle] attente du retry auto (+5 s)…");
    }

    // Retour sur /play avec l'overlay (lent sur émulateur : attendre).
    const rec = await waitFor(
      cdp,
      PROBE_JS,
      (r) => r && r.pathname.includes("/play") && r.BX_EXPOSED === "object" && r.settingsBtnVisible,
      30_000,
      "retour /play + overlay"
    );
    gate("récupération sur /play", rec && rec.pathname.includes("/play"), rec && rec.pathname);
    gate("overlay de retour", rec && rec.settingsBtnVisible, String(rec && rec.settingsBtnVisible));
    console.log(`[${mode}] récupéré : ${JSON.stringify(rec)}`);
  } finally {
    cdp.close();
  }

  if (failures > 0) {
    console.error(`\n❌ GATE ROUGE : ${failures} point(s) en échec`);
    process.exit(1);
  }
  console.log(`\n✅ MOBILE PROBE OK (sonde + panne→récupération ${DO_MANUAL ? "manuelle (Réessayer)" : "auto (+5 s)"})`);
  // exit explicite : le handle WS/HTTP keep-alive du mock peut garder le
  // process vivant (le child du test attendrait alors un kill timeout).
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ GATE ROUGE : " + e.message);
  process.exit(1);
});
