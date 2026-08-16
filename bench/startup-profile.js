#!/usr/bin/env node
/**
 * Profil CPU fonction-par-fonction du startup userscript — perf10 vs build.
 *
 * Échantillonne le eval document-start (même protocole que page-eval.js) via
 * le **CDP Profiler** (échantillonnage 100 µs) et agrège le **self time** par
 * fonction sur `--runs` exécutions (contexte neuf à chaque run, même process
 * navigateur). Objectif : garder visible, à chaque session, la dominante
 * fonction-par-fonction du démarrage — celle qui a révélé
 * `getSupportedCodecProfiles` (667 ms de `RTCRtpReceiver.getCapabilities` à
 * froid = 96 % du eval, supprimé du load en v1.7.0).
 *
 * Sortie par version : médiane du eval (ms), top `--top` fonctions par self
 * time (ms/run + % du eval), et le % non-attribué (idle/program/GC : temps
 * natif non rattaché à un frame JS).
 *
 * Pièges documentés :
 *   - le userscript est strict → ses internes ne sont pas globaux ; on
 *     n'accède à rien, on échantillonne (le profil attribue les frames du
 *     eval par nom de fonction)
 *   - la pile RTC froide fait exploser le 1er run de perf10 (~600 ms) : le
 *     median sur 5 runs l'absorbe, mais les runs 2+ sont chauds — l'écart
 *     perf10/build sur les dominantes reste le signal (v1.7.0 : la fonction
 *     disparaît du load)
 *   - entrées de bruit exclues du classement : (idle), (program),
 *     (garbage collector), tryRun/InjectedScript/UtilityScript (harnais +
 *     DevTools), _setupHitTargetInterceptors
 *
 * Usage : node bench/startup-profile.js <perf10.js> <build.js> [--runs=N] [--top=N] [--channel=msedge|chromium]
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
  console.error("Usage : node bench/startup-profile.js <perf10.js> <build.js> [--runs=N] [--top=N] [--channel=msedge|chromium]");
  process.exit(1);
}
const RUNS = parseInt((argv.find((a) => a.startsWith("--runs=")) || "=5").split("=")[1], 10);
const TOP = parseInt((argv.find((a) => a.startsWith("--top=")) || "=15").split("=")[1], 10);
// Canal : msedge par défaut sous Windows (GPU/ANGLE), chromium ailleurs
// (Linux/CI) — même auto-détection que le harnais GPU.
const CHANNEL = argv.find((a) => a.startsWith("--channel="))
  ? argv.find((a) => a.startsWith("--channel=")).split("=")[1]
  : process.platform === "win32" ? "msedge" : "chromium";

const MS_PER_SAMPLE = 0.1; // interval d'échantillonnage 100 µs
// bruit harnais/DevTools/natif — pas des fonctions du script
const NOISE = new Set([
  "(idle)", "(program)", "(garbage collector)",
  "tryRun", "InjectedScript", "UtilityScript", "wrapper", "_setupHitTargetInterceptors",
]);

const p10 = fs.readFileSync(p10Path, "utf-8");
const build = fs.readFileSync(buildPath, "utf-8");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<!doctype html><html><head></head><body>bench</body></html>");
});
let PORT = 0;

async function profileOnce(browser, code) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript((src) => {
    window.BX_FLAGS = { SafariWorkaround: false };
    const tryRun = () => {
      if (document.documentElement) {
        const t0 = performance.now();
        try { (0, eval)(src); } catch (e) { window.__bxError = String((e && e.stack) || e); }
        window.__bxLoaded = performance.now() - t0;
      } else setTimeout(tryRun, 1);
    };
    tryRun();
  }, code);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Profiler.start");
  await page.goto(`http://127.0.0.1:${PORT}/en-us/play`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__bxLoaded !== undefined, null, { timeout: 20000 });
  // arrêt immédiat après le eval synchrone — pas d'attente idle (l'async post-load
  // est un régime différent, pas le startup)
  await new Promise((r) => setTimeout(r, 0));
  const { profile } = await cdp.send("Profiler.stop");
  const evalMs = await page.evaluate(() => window.__bxLoaded);
  const err = await page.evaluate(() => window.__bxError || null);
  await ctx.close();
  return { profile, evalMs, err };
}

function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return { med: s[Math.floor(s.length / 2)], min: s[0], max: s[s.length - 1] };
}

async function profileVersion(browser, code, label) {
  const self = new Map(); // fn -> samples (cumulés sur les runs)
  const evals = [];
  for (let r = 0; r < RUNS; r++) {
    const { profile, evalMs, err } = await profileOnce(browser, code);
    if (err) console.error(`  [${label}] run ${r + 1} : erreur eval ${err}`);
    evals.push(evalMs);
    // map id→node propre à CHAQUE profile (les ids ne sont pas stables entre runs)
    const idToNode = new Map(profile.nodes.map((n) => [n.id, n]));
    for (const sid of profile.samples) {
      const node = idToNode.get(sid);
      if (!node) continue;
      const name = node.callFrame.functionName || "(anonymous)";
      self.set(name, (self.get(name) || 0) + 1);
    }
  }
  const e = stats(evals);
  let total = 0, noise = 0;
  const ranked = [];
  for (const [name, samples] of self) {
    total += samples;
    if (NOISE.has(name)) { noise += samples; continue; }
    // % = part des échantillons totaux (idle/program inclus dans total pour que
    // la somme « fonctions + non-attribué » ≈ 100 %)
    ranked.push({ name, ms: (samples * MS_PER_SAMPLE) / RUNS, pct: (100 * samples) / total });
  }
  const medMs = e.med;
  ranked.sort((a, b) => b.ms - a.ms);
  console.log(`\n=== ${label} — eval médiane ${medMs.toFixed(1)} ms (min ${e.min.toFixed(1)} / max ${e.max.toFixed(1)}), ${RUNS} runs, top ${TOP} ===`);
  for (const r of ranked.slice(0, TOP)) {
    console.log(`  ${r.ms.toFixed(2).padStart(7)} ms  ${r.pct.toFixed(1).padStart(6)} %  ${r.name}`);
  }
  console.log(`  ${((noise * MS_PER_SAMPLE) / RUNS).toFixed(2).padStart(7)} ms  ${(100 * noise / total).toFixed(1).padStart(6)} %  (non-attribué : idle/program/GC — temps natif hors frames JS)`);
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  PORT = server.address().port;

  let browser;
  try {
    const launchOpts = { headless: true };
    if (CHANNEL !== "chromium") launchOpts.channel = CHANNEL;
    browser = await chromium.launch(launchOpts);
  } catch (e) {
    console.error(`Impossible de lancer le navigateur (canal ${CHANNEL}) :`, e.message);
    console.error("Utilisez --channel=chromium ou installez Edge (canal msedge).");
    process.exit(2);
  }

  console.log(`=== Profil CPU du startup (CDP Profiler, ${RUNS} runs × 2 versions, échantillon 100 µs, canal ${CHANNEL}) ===`);
  await profileVersion(browser, p10, "perf10");
  await profileVersion(browser, build, "build");

  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
