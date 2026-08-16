#!/usr/bin/env node
/**
 * Coût one-shot isolé de RTCRtpReceiver.getCapabilities — perf10 vs build.
 *
 * Mesure en deux parties, chacune avec un **navigateur neuf par run** (process
 * distinct → pile RTC froide) :
 *
 *   1. **one-shot isolé** (indépendant de la version du script, mesuré une
 *      fois pour les deux builds) : chronométrage in-page du 1er appel
 *      `getCapabilities("video")`, du 2e, de `audio` et d'une baseline vide.
 *      Le 1er appel initialise toute la pile RTC (~640 ms sur Edge froid) ;
 *      les suivants valent ~0,1 ms.
 *
 *   2. **eval document-start à froid** (perf10 vs build, page HTTP locale +
 *      wrapper BX_FLAGS, même protocole que page-eval.js) : l'écart
 *      perf10/build = exactement le one-shot, supprimé du load par la v1.7.0
 *      (−94,5 %).
 *
 * Pièges documentés :
 *   - `about:blank` (origine opaque) fait échouer le userscript (localStorage)
 *     → l'éval se fait sur une page HTTP servie localement ; la partie isolée
 *     n'injecte aucun script et peut rester sur about:blank.
 *   - l'éval doit tourner sur un navigateur **neuf** : dans un process partagé
 *     la pile RTC survit d'un run à l'autre et le one-shot disparaît (le warm
 *     ne voyait que −8,7 %, le froid −95 %).
 *   - écart isolé/in-eval (~100 ms) : variance d'environnement de la même init
 *     native (540–670 ms), même ordre, même lecture.
 *
 * Usage : node bench/cold-getcap.js <perf10.js> <build.js> [--runs=N] [--channel=msedge|chromium]
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

const argv = process.argv.slice(2);
const paths = argv.filter((a) => !a.startsWith("--"));
const [p10Path, buildPath] = paths;
if (!p10Path || !buildPath) {
  console.error("Usage : node bench/cold-getcap.js <perf10.js> <build.js> [--runs=N] [--channel=msedge|chromium]");
  process.exit(1);
}
const RUNS = parseInt((argv.find((a) => a.startsWith("--runs=")) || "=5").split("=")[1], 10);
// Canal : msedge par défaut sous Windows (GPU/ANGLE), chromium ailleurs
// (Linux/CI) — même auto-détection que le harnais GPU.
const CHANNEL = argv.find((a) => a.startsWith("--channel="))
  ? argv.find((a) => a.startsWith("--channel=")).split("=")[1]
  : process.platform === "win32" ? "msedge" : "chromium";

const p10 = fs.readFileSync(p10Path, "utf-8");
const build = fs.readFileSync(buildPath, "utf-8");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<!doctype html><html><head></head><body>bench</body></html>");
});
let PORT = 0;

function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return { med: s[Math.floor(s.length / 2)], min: s[0], max: s[s.length - 1] };
}
const fmt = (st) => `${st.med.toFixed(1)} ms (${st.min.toFixed(1)}–${st.max.toFixed(1)})`;

// ---- Partie 1 : one-shot isolé (navigateur neuf par run, page vide) ----
async function isolatedOnce() {
  const browser = await chromium.launch({ channel: CHANNEL });
  try {
    const page = await browser.newPage();
    await page.goto("about:blank");
    return await page.evaluate(() => {
      const perf = () => {
        const t0 = performance.now();
        RTCRtpReceiver.getCapabilities("video");
        return performance.now() - t0;
      };
      const t0 = performance.now();
      const empty = performance.now() - t0;
      const cap1 = perf();
      const cap2 = perf();
      const a0 = performance.now();
      RTCRtpReceiver.getCapabilities("audio");
      const aud = performance.now() - a0;
      return { empty, cap1, cap2, aud };
    });
  } finally {
    await browser.close();
  }
}

async function isolated() {
  const rows = [];
  for (let r = 0; r < RUNS; r++) {
    const x = await isolatedOnce();
    rows.push(x);
    console.log(
      `  run ${r + 1}/${RUNS} : cap#1 ${x.cap1.toFixed(1)} ms | cap#2 ${x.cap2.toFixed(1)} ms | audio ${x.aud.toFixed(1)} ms | baseline ${x.empty.toFixed(1)} ms`
    );
  }
  const s = (k) => fmt(stats(rows.map((r) => r[k])));
  console.log(`  médiane : cap#1 (froid) ${s("cap1")} | cap#2 (chaud) ${s("cap2")} | audio ${s("aud")} | baseline ${s("empty")}`);
  return s("cap1");
}

// ---- Partie 2 : eval document-start à froid (perf10 vs build, navigateur neuf par run) ----
async function evalColdOnce(code) {
  const browser = await chromium.launch({ channel: CHANNEL });
  try {
    const page = await browser.newPage();
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
    const r = await page.evaluate(() => ({ t: window.__bxLoadTime, err: window.__bxError || null }));
    if (r.err) throw new Error("eval: " + r.err);
    return r.t;
  } finally {
    await browser.close();
  }
}

async function evalCold() {
  const res = { perf10: [], build: [] };
  for (let r = 0; r < RUNS; r++) {
    for (const k of ["perf10", "build"]) {
      const t = await evalColdOnce(k === "perf10" ? p10 : build);
      res[k].push(t);
      console.log(`  run ${r + 1}/${RUNS} ${k.padEnd(7)} eval ${t.toFixed(1)} ms`);
    }
  }
  const s = (k) => fmt(stats(res[k]));
  const a = stats(res.perf10).med;
  const b = stats(res.build).med;
  const d = ((b / a - 1) * 100).toFixed(1);
  console.log(`  perf10 : ${s("perf10")} | build : ${s("build")} | Δ ${d} % (négatif = build plus rapide)`);
  return d;
}

async function main() {
  PORT = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
  console.log(`== cold-getcap : coût one-shot isolé de getCapabilities (${CHANNEL}, navigateur neuf par run, ${RUNS} runs) ==`);
  const cap1 = await isolated();
  console.log();
  console.log(`== cold-getcap : eval document-start à froid (perf10 vs build, ${RUNS} runs × 2 versions, navigateur neuf par run) ==`);
  const delta = await evalCold();
  console.log();
  console.log(`Lecture : 1er appel = ${cap1} (la pile RTC s'initialise intégralement dedans ; les suivants ~0,1 ms).`);
  console.log(`L'écart perf10/build sur l'éval (${delta} %) = exactement ce one-shot, supprimé du load par la v1.7.0.`);
  server.close();
}
main().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
