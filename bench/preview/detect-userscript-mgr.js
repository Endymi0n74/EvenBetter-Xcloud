#!/usr/bin/env node
/* detect-userscript-mgr.js — détecte un gestionnaire d'userscripts installé
 * dans le profil connecté via CDP (Tampermonkey / Violentmonkey / Tampermonkey
 * Beta / OrangeMonkey / UserScripts), en tentant de charger sa page options.
 *
 * Usage : node bench/preview/detect-userscript-mgr.js [port]
 */
"use strict";
const { chromium } = require("playwright");

const MANAGERS = [
  { id: "dhdgffkkebhmkfjojejmpbldmpobfkfo", name: "Tampermonkey" },
  { id: "jinjaccalgkegednnccohejagnlnfdagc", name: "Violentmonkey" },
  { id: "gcalenpjmijncebpfidmoetpkaodombi", name: "Tampermonkey Beta" },
  { id: "bekneemfbknljkogcjbmanlbbchcdgod", name: "OrangeMonkey" },
  { id: "ldinpeekobnhjjdofgkfgopflfbimled", name: "UserScripts" },
];

(async () => {
  const port = process.argv[2] || "9222";
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0];
  try {
    for (const m of MANAGERS) {
      const page = await ctx.newPage();
      try {
        const resp = await page.goto(`chrome-extension://${m.id}/options.html`, { timeout: 4000, waitUntil: "domcontentloaded" });
        const ok = resp && resp.ok() === false ? false : true;
        const title = await page.title().catch(() => "");
        console.log(`${ok ? "✅" : "❌"} ${m.name} (${m.id}) : ${title.slice(0, 40) || (resp ? resp.status() : "no-response")}`);
      } catch (e) {
        console.log(`❌ ${m.name} (${m.id}) : ${e.message.split("\n")[0].slice(0, 70)}`);
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
