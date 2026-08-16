#!/usr/bin/env node
/*
 * install-userscript.js — installe better-xcloud-preview.user.js dans le
 * Tampermonkey du profil connecté (CDP) : navigation vers le fichier .user.js
 * (TM intercepte) → clic Install → vérification dashboard.
 *
 * Usage : node bench/preview/install-userscript.js [port] [--url=URL]
 *   (URL par défaut : https://127.0.0.1:8932/better-xcloud-preview.user.js —
 *    servie par un serveur HTTPS local (cert self-signed, erreurs ignorées via
 *    CDP) ; TM intercepte les .user.js en http(s) mais PAS en file:// sans
 *    accès aux fichiers, et le https évite le mixed-content de la page
 *    d'install TM hébergée sur tampermonkey.net.)
 */
"use strict";
const { chromium } = require("playwright");

(async () => {
  const port = process.argv[2] || "9222";
  const urlArg = (process.argv.find((a) => a.startsWith("--url=")) || "").slice(6);
  const installUrl = urlArg || "https://127.0.0.1:8932/better-xcloud-preview.user.js";

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0];
  // ignorer les erreurs de certificat (cert self-signed local) au niveau navigateur
  const bSession = await browser.newBrowserCDPSession();
  await bSession.send("Security.setIgnoreCertificateErrors", { ignore: true }).catch(() => {});
  const page = await ctx.newPage();
  try {
    console.log(`[install] navigation ${installUrl}`);
    await page.goto(installUrl, { timeout: 15000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const title = await page.title().catch(() => "");
    console.log(`[install] page : ${title.slice(0, 70)}`);

    // la page d'installation Tampermonkey (interceptée) — chercher le bouton Install
    const btn = page.locator("button, input[type=button]").filter({
      hasText: /^[\s]*(install|installer|instalar|安装|add)[\s]*$/i,
    }).first();
    if (await btn.waitFor({ timeout: 8000 }).then(() => true).catch(() => false)) {
      console.log("[install] bouton trouvé, clic");
      await btn.click();
      await page.waitForTimeout(3000);
    } else {
      // fallback : chercher large
      const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 400);
      console.log(`[install] bouton Install non trouvé — contenu : ${body.replace(/\s+/g, " ").slice(0, 250)}`);
      console.log("NEEDS-HELP");
      return;
    }

    // vérification : le dashboard Tampermonkey liste-t-il « Better xCloud Preview » ?
    await page.goto("chrome-extension://ocgfholiimhnfafjaldmcimghgnggfhk/options.html#nav=dashboard", { timeout: 8000, waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(2500);
    const body = await page.locator("body").innerText().catch(() => "");
    const found = /better xcloud preview/i.test(body);
    console.log(found ? "[install] INSTALLED ✅ — « Better xCloud Preview » dans le dashboard" : "[install] dashboard sans le script — NEEDS-HELP");
  } finally {
    await page.close().catch(() => {});
    await browser.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
