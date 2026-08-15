#!/usr/bin/env node
/**
 * Éval complète de page (Edge via Playwright) — perf10 vs build courant.
 *
 * Le userscript est évalué au document-start (comme @run-at document-start) :
 *   - page servie sur http://127.0.0.1:<port>/en-us/play (le script exige
 *     pathname.match(/^\/[a-zA-Z]{2}-[a-zA-Z]{2}\/play/) — garde « Not xCloud page »)
 *   - window.BX_FLAGS = { SafariWorkaround: false } (garde de reload)
 *   - addInitScript + poll 1 ms jusqu'à document.documentElement (null ~18-25 ms
 *     au début de la navigation ; setTimeout(0) tire trop tôt)
 *   - about:blank ne convient pas (pas de localStorage)
 *
 * Dépend de Playwright + Edge (canal msedge). Sans Playwright local, installer :
 *   npm i -D playwright   (ou pointer NODE_PATH vers un install existant)
 *
 * Usage : node bench/page-eval.js <build-perf10.js> <build-courant.js>
 */
"use strict";

const fs = require("fs");
const http = require("http");

let chromium = null;
try {
  ({ chromium } = require("playwright"));
} catch {
  try {
    ({ chromium } = require("playwright-core"));
  } catch {
    console.error("Playwright introuvable. Installez-le (npm i -D playwright) ou pointez NODE_PATH vers un install existant.");
    process.exit(2);
  }
}

const [p10Path, p13Path] = process.argv.slice(2);
if (!p10Path || !p13Path) {
  console.error("Usage : node bench/page-eval.js <perf10.js> <build.js>");
  process.exit(1);
}

const p10 = fs.readFileSync(p10Path, "utf-8");
const p13 = fs.readFileSync(p13Path, "utf-8");
const RUNS = 20;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<!doctype html><html><head></head><body>bench</body></html>");
});

async function runOne(browser, code) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript((src) => {
    window.BX_FLAGS = { SafariWorkaround: false };
    const tryRun = () => {
      if (document.documentElement) {
        const t0 = performance.now();
        try {
          (0, eval)(src);
        } catch (e) {
          window.__bxError = String((e && e.stack) || e);
        }
        window.__bxLoadTime = performance.now() - t0;
      } else {
        setTimeout(tryRun, 1);
      }
    };
    tryRun();
  }, code);
  await page.goto(`http://127.0.0.1:${PORT}/en-us/play`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__bxLoadTime !== undefined, null, { timeout: 20000 });
  const t = await page.evaluate(() => window.__bxLoadTime);
  await ctx.close();
  return t;
}

let PORT = 0;

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  PORT = server.address().port;

  let browser;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
  } catch (e) {
    console.error("Impossible de lancer Edge (canal msedge) :", e.message);
    console.error("Installez Edge ou ajustez bench/page-eval.js (channel chromium + npx playwright install chromium).");
    process.exit(2);
  }

  const results = { perf10: [], build: [] };
  for (let i = 0; i < RUNS; i++) {
    results.perf10.push(await runOne(browser, p10));
    results.build.push(await runOne(browser, p13));
  }

  const stats = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    return {
      median: s[Math.floor(s.length / 2)],
      p95: s[Math.floor(s.length * 0.95)],
      min: s[0],
    };
  };
  const fmt = (o) => `médiane ${o.median.toFixed(1)} ms | p95 ${o.p95.toFixed(1)} ms | min ${o.min.toFixed(1)} ms`;
  const s10 = stats(results.perf10);
  const s13 = stats(results.build);
  console.log("=== Éval complète de page (Edge headless, document-start), 20 runs ===");
  console.log(`perf10 : ${fmt(s10)}`);
  console.log(`build  : ${fmt(s13)}`);
  console.log(`écart médiane : ${((s13.median / s10.median - 1) * 100).toFixed(1)} %`);

  await browser.close();
  server.close();
})();
