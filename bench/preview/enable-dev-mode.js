#!/usr/bin/env node
/* enable-dev-mode.js — active le mode développeur d'Edge (edge://extensions)
 * nécessaire à l'injection Tampermonkey (API userScripts, MV3).
 * Structure Edge : ROOT-APP → shadow → EXTENSIONS-MANAGER → shadow →
 * EXTENSIONS-TOOLBAR → shadow → #devMode.
 * Usage : node bench/preview/enable-dev-mode.js [port]
 */
"use strict";
const { chromium } = require("playwright");

(async () => {
  const port = process.argv[2] || "9222";
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  try {
    await page.goto("edge://extensions/", { timeout: 10000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    const result = await page.evaluate(() => {
      // remonte ROOT-APP → manager → toolbar → toggle
      const rootApp = document.querySelector("root-app");
      const mgr = rootApp && rootApp.shadowRoot && rootApp.shadowRoot.querySelector("extensions-manager");
      const toolbar = mgr && mgr.shadowRoot && mgr.shadowRoot.querySelector("extensions-toolbar");
      const troot = toolbar && toolbar.shadowRoot;
      const dev = troot && (troot.querySelector("#devMode") || troot.querySelector("cr-toggle#devMode") || troot.querySelector("[aria-label*=developer i]"));
      if (!dev) {
        const cands = troot
          ? [...troot.querySelectorAll("cr-toggle, button, input, [role=switch]")].map((e) => ({
              id: e.id, aria: e.getAttribute("aria-label") || "", cls: (typeof e.className === "string" ? e.className : "").slice(0, 40), tag: e.tagName,
            }))
          : [];
        return { found: false, cands: cands.slice(0, 12) };
      }
      const on = dev.getAttribute("aria-pressed") === "true" || dev.hasAttribute("checked");
      if (!on) { dev.click(); return { found: true, clicked: true }; }
      return { found: true, alreadyOn: true };
    });
    console.log("[devmode]", JSON.stringify(result));
    await page.waitForTimeout(2500);

    const after = await page.evaluate(() => {
      const rootApp = document.querySelector("root-app");
      const mgr = rootApp && rootApp.shadowRoot && rootApp.shadowRoot.querySelector("extensions-manager");
      const toolbar = mgr && mgr.shadowRoot && mgr.shadowRoot.querySelector("extensions-toolbar");
      const t = toolbar && toolbar.shadowRoot && (toolbar.shadowRoot.querySelector("#devMode") || toolbar.shadowRoot.querySelector("cr-toggle#devMode"));
      return t ? (t.getAttribute("aria-pressed") || (t.hasAttribute("checked") ? "on" : "off")) : "?";
    });
    console.log("[devmode] état après :", after);
  } catch (e) {
    console.log("[devmode] err:", e.message.split("\n")[0].slice(0, 80));
  } finally {
    await page.close().catch(() => {});
    await browser.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
