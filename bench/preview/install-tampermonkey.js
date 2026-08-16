#!/usr/bin/env node
/*
 * install-tampermonkey.js — tente d'installer Tampermonkey depuis le Edge
 * Add-ons Store dans le profil connecté via CDP (nécessaire pour exécuter la
 * preview T6 : le profil edge-cdp n'a AUCUN gestionnaire d'userscripts).
 *
 * Usage : node bench/preview/install-tampermonkey.js [port]
 *   Sortie : INSTALLED / NEEDS-HELP / FAILED (+ état)
 */
"use strict";
const { chromium } = require("playwright");

const STORE_URL = "https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd";
const BTN = "#installButton-iikmkjmpaadaobahmlepeloendndfphd";

(async () => {
  const port = process.argv[2] || "9222";
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  try {
    console.log(`[install] navigation ${STORE_URL}`);
    await page.goto(STORE_URL, { timeout: 30000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // cookies (bandeau Edge store)
    for (const sel of ['button:has-text("Accepter")', 'button:has-text("Accept")', "button:has-text(\"J'accepte\")", '#acceptButton']) {
      const b = page.locator(sel).first();
      if (await b.waitFor({ timeout: 1500 }).then(() => true).catch(() => false)) {
        await b.click().catch(() => {});
        await page.waitForTimeout(1500);
        console.log("[install] cookies acceptés");
        break;
      }
    }

    const btn = page.locator(BTN).first();
    if (!(await btn.waitFor({ timeout: 8000 }).then(() => true).catch(() => false))) {
      console.log("[install] bouton #installButton introuvable");
      console.log("NEEDS-HELP");
      return;
    }
    console.log("[install] clic sur Obtenir");
    await btn.click();
    await page.waitForTimeout(5000);

    // Edge : confirmation d'ajout — parfois dans la page, parfois dialog système
    for (const sel of [
      'button:has-text("Ajouter l\\u2019extension")',
      'button:has-text("Ajouter")',
      'button:has-text("Add extension")',
      'button:has-text("Add")',
    ]) {
      const b = page.locator(sel).first();
      if (await b.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) {
        console.log("[install] confirmation trouvée :", sel);
        await b.click().catch(() => {});
        await page.waitForTimeout(4000);
        break;
      }
    }

    // vérification : la page options de Tampermonkey charge-t-elle ?
    let ok = false;
    try {
      const p2 = await ctx.newPage();
      await p2.goto("chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html", { timeout: 5000, waitUntil: "domcontentloaded" });
      const t2 = await p2.title().catch(() => "");
      ok = /tampermonkey/i.test(t2);
      console.log(`[install] page options TM : ${t2.slice(0, 50)}`);
      await p2.close().catch(() => {});
    } catch (e) {
      console.log(`[install] page options TM : ${e.message.split("\n")[0].slice(0, 70)}`);
    }
    console.log(ok ? "INSTALLED" : "NEEDS-HELP — confirmation d'ajout à cliquer à la main (dialog navigateur)");
  } finally {
    await page.close().catch(() => {});
    await browser.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
