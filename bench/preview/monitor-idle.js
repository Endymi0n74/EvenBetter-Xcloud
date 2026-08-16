#!/usr/bin/env node
/*
 * monitor-idle.js — validation P1 en session réelle : surveille la page stream
 * (console + réseau + état vidéo) pendant une fenêtre AFK pour vérifier que le
 * WarningForBeingIdle est intercepté par la preview T6 (log « BX keep-alive:
 * idle warning intercepted ») et que la session survit au countdown.
 *
 * Signaux :
 *   - console info « BX keep-alive: idle warning intercepted (secondsUntilKick:…) »
 *     → P1 INTERCEPTÉ (module patché par installKeepAliveIdle)
 *   - console info « Warning for being idle; secondsUntilKick:… » (sans préfixe
 *     BX) → P1 NON actif (hook inactif ou module non patché) — compte à rebours
 *     natif → risque de kick
 *   - requêtes réseau …/keepalive (heartbeat natif, toutes les ~60 s) → la
 *     connexion de session reste vivante (n'apparaît PAS l'activité utilisateur)
 *   - état vidéo (readyState/paused) + navigation → la session survit
 *
 * Usage : node bench/preview/monitor-idle.js [--port=9222] [--duration=600]
 *         [--url=play.xbox.com]   (Ctrl+C pour arrêter tôt ; rapport à la fin)
 */
"use strict";
const { chromium } = require("playwright");

const port = (process.argv.find((a) => a.startsWith("--port=")) || "--port=9222").slice(7);
const duration = parseInt((process.argv.find((a) => a.startsWith("--duration=")) || "--duration=600").slice(11), 10);
const urlFilter = (process.argv.find((a) => a.startsWith("--url=")) || "--url=play.xbox.com").slice(6);

const ts = () => new Date().toLocaleTimeString("fr-FR", { hour12: false });

(async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().includes(urlFilter));
  if (!page) { console.error(`aucune page ${urlFilter} ouverte`); process.exit(1); }

  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");

  const events = [];
  const log = (kind, msg) => { const line = `[${ts()}] ${kind} : ${msg}`; events.push(line); console.log(line); };

  cdp.on("Runtime.consoleAPICalled", (p) => {
    const txt = (p.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    if (/keep-alive|idle|Warning|disconnect|secondsUntilKick/i.test(txt)) log("console", `(${p.type}) ${txt.slice(0, 200)}`);
  });
  cdp.on("Log.entryAdded", (p) => {
    const t = p.entry && p.entry.text;
    if (t && /keep-alive|idle|Warning|disconnect|secondsUntilKick/i.test(t)) log("log", `${p.entry.level} ${t.slice(0, 200)}`);
  });
  cdp.on("Network.requestWillBeSent", (p) => {
    const u = p.request && p.request.url;
    if (u && /\/keepalive|WarningForBeingIdle/.test(u)) log("net", u.slice(0, 120));
  });

  console.log(`== monitor-idle : ${page.url()} — fenêtre AFK ${duration}s (${ts()}) ==`);
  console.log("  ATTENTION : ne touche à RIEN (souris/clavier/manette) pendant la fenêtre — tout input reset le timer d'idle.\n");

  const start = Date.now();
  let lastVideo = null;
  let survived = true;
  while (Date.now() - start < duration * 1000) {
    // état vidéo toutes les 15 s
    const s = await page.evaluate(() => {
      const v = document.querySelector("video");
      return { ready: v ? v.readyState : -1, paused: v ? v.paused : null, url: location.href };
    }).catch(() => null);
    if (s && JSON.stringify(s) !== JSON.stringify(lastVideo)) {
      lastVideo = s;
      log("video", `readyState=${s.ready} paused=${s.paused} ${s.url.slice(0, 60)}`);
      if (!s.url.includes(urlFilter) || (s.ready >= 0 && s.paused)) survived = false;
    }
    await new Promise((r) => setTimeout(r, 15000));
  }

  console.log("\n== RAPPORT monitor-idle ==");
  if (events.length === 0) console.log("  aucun signal (ni BX keep-alive ni Warning natif) — le warning d'idle n'est pas parti dans la fenêtre, ou l'utilisateur a bougé");
  const patched = events.some((e) => e.includes("BX keep-alive: idle warning intercepted"));
  const unpatched = events.some((e) => e.includes("Warning for being idle;"));
  console.log(`  - log P1 intercepté (BX keep-alive) : ${patched ? "✅ OUI" : "❌ non"}`);
  console.log(`  - warning natif non patché : ${unpatched ? "❌ OUI — P1 inactif" : "non"}`);
  console.log(`  - session vivante à la fin : ${survived ? "✅ OUI" : "❌ NON (kick/navigation)"}`);
  console.log(`  - heartbeat natif (/keepalive) vu : ${events.some((e) => e.startsWith("[") && e.includes("/keepalive")) ? "✅ oui" : "non vu dans la fenêtre"}`);
  console.log(`  - verdict : ${patched && survived ? "P1 VALIDÉ ✅ — warning intercepté, session survit" : "à re-tenter (voir signaux ci-dessus)"}`);
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
