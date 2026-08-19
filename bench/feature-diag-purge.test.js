#!/usr/bin/env node
/**
 * bench/feature-diag-purge.test.js — gate CI de la routine « purge des
 * listeners de diagnostic » (BX_PURGE_DIAG, v1.13.0), branché dans le step
 * preview de bench.yml.
 *
 * Pas de navigateur en CI → vérifications statiques + rejeu de l'injection +
 * TEST FONCTIONNEL vm de la routine elle-même :
 *   1. PRÉSENCE : la routine est dans le bundle STABLE (source de vérité) ET
 *      dans le build PREVIEW (qui en hérite via build-preview.js) — un
 *      rebuild qui oublie l'injection → GATE ROUGE.
 *   2. ANCRES : dans le bundle stable injecté, les ancres d'injection de
 *      feature-diag-purge.js tiennent (BX_EXPOSED ×1, implémentation ×1) —
 *      une dérive du source amont ou de l'injection → GATE ROUGE.
 *   3. FONCTIONNEL vm : dans un contexte vm avec un window factice, l'IMPL
 *      installée hook addEventListener, enregistre les listeners dont la
 *      source contient « win-capture », et BX_PURGE_DIAG() retire UNIQUEMENT
 *      ceux-là (les listeners normaux restent) — le comportement réel de la
 *      purge est vérifié sans navigateur.
 *   4. REJEU + SELF-TEST : copie STRIPPÉE du bundle (injection inversée,
 *      vérifiée) sur laquelle on relance `feature-diag-purge.js --dry-run
 *      --self-test` : le chemin d'injection ET le chemin d'échec (ancre
 *      corrompue → exit 1 attendu) doivent repasser → GATE ROUGE sinon.
 *
 * Lancement local : node bench/feature-diag-purge.test.js [--self-test]
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const STABLE = path.join(ROOT, "better-xcloud.user.js");
const PREVIEW = path.join(ROOT, "better-xcloud-preview.user.js");
const FEATURE_JS = path.join(__dirname, "feature-diag-purge.js");
const BUILD_JS = path.join(ROOT, "bench", "preview", "port", "build-preview.js");

// Ancres extraites de feature-diag-purge.js (source de vérité de l'injection).
const FEATURE_SRC = fs.readFileSync(FEATURE_JS, "utf8").replace(/\r\n/g, "\n");
const ANCHOR_BX = (FEATURE_SRC.match(/const ANCHOR_BX = "([^"]*)";/) || [])[1];
const IMPL = (FEATURE_SRC.match(/const IMPL = `([^]*?)`;/) || [])[1];

if (!ANCHOR_BX || !IMPL) {
  console.error("❌ GATE : ancres non extractibles depuis feature-diag-purge.js (const renommée ?)");
  process.exit(1);
}

const count = (h, n) => h.split(n).length - 1;

// ---- 3. test fonctionnel vm : la purge ne retire que les listeners marqués ----
function vmFunctionalCheck() {
  const listeners = new Map(); // key: "type|capture" → Set(fn)
  const fakeWindow = {
    addEventListener(type, fn, opts) {
      const k = type + "|" + (opts === true || (opts && opts.capture));
      if (!listeners.has(k)) listeners.set(k, new Set());
      listeners.get(k).add(fn);
    },
    removeEventListener(type, fn, opts) {
      const k = type + "|" + (opts === true || (opts && opts.capture));
      const s = listeners.get(k);
      if (s) s.delete(fn);
    },
    _count() { let n = 0; for (const s of listeners.values()) n += s.size; return n; },
    _has(fn) { for (const s of listeners.values()) if (s.has(fn)) return true; return false; },
  };
  const sandbox = { window: fakeWindow };
  vm.createContext(sandbox);
  vm.runInContext(IMPL, sandbox);

  // listener NORMAL (pas de marqueur) — ne doit jamais être purgé
  const normal = function () { console.log("normal click"); };
  // listener de DIAGNOSTIC (marqueur win-capture dans la source) — doit être purgé
  const diag = function (e) { log.push("win-capture target=" + e.target.tagName); };
  // listener marqué aussi mais sans capture — doit être purgé aussi
  const diagNoCap = function () { console.log("win-capture no-cap"); };

  fakeWindow.addEventListener("click", normal, true);
  fakeWindow.addEventListener("click", diag, true);
  fakeWindow.addEventListener("scroll", diagNoCap, false);

  const before = fakeWindow._count();
  const removed = vm.runInContext("window.BX_PURGE_DIAG()", sandbox);
  const after = fakeWindow._count();

  return {
    before,
    after,
    removed,
    normalKept: fakeWindow._has(normal),
    diagGone: !fakeWindow._has(diag),
    diagNoCapGone: !fakeWindow._has(diagNoCap),
    apiExposed: vm.runInContext("typeof window.BX_PURGE_DIAG", sandbox) === "function",
  };
}

function runChecks(stableSrc, previewSrc) {
  let failures = 0;
  const check = (label, cond, extra) => {
    if (cond) console.log(`  ✅ ${label}`);
    else { failures++; console.error(`  ❌ ${label}${extra ? " :: " + extra : ""}`); }
  };

  // ---- 1. présence ----
  console.log("== 1. Présence de la routine (stable + preview) ==");
  check("routine présente dans le bundle stable", count(stableSrc, "window.BX_PURGE_DIAG") >= 1, "n=" + count(stableSrc, "window.BX_PURGE_DIAG"));
  check("routine présente dans le build preview (héritée du stable)", count(previewSrc, "window.BX_PURGE_DIAG") >= 1, "n=" + count(previewSrc, "window.BX_PURGE_DIAG"));

  // ---- 2. ancres (bundle stable injecté) ----
  console.log("== 2. Ancres d'injection (bundle stable injecté) ==");
  check("ancre BX_EXPOSED ×1", count(stableSrc, ANCHOR_BX) === 1, "n=" + count(stableSrc, ANCHOR_BX));
  check("implémentation BX_PURGE_DIAG ×1", count(stableSrc, IMPL) === 1, "n=" + count(stableSrc, IMPL));

  // ---- 3. fonctionnel vm ----
  console.log("== 3. Comportement réel de la purge (vm, window factice) ==");
  const v = vmFunctionalCheck();
  check("API BX_PURGE_DIAG exposée", v.apiExposed);
  check("3 listeners attachés (2 marqués + 1 normal)", v.before === 3, "before=" + v.before);
  check("purge retire UNIQUEMENT les 2 marqués (removed=2, after=1)", v.removed === 2 && v.after === 1, "removed=" + v.removed + " after=" + v.after);
  check("listener normal conservé", v.normalKept);
  check("listener diag (capture) retiré", v.diagGone);
  check("listener diag (sans capture) retiré", v.diagNoCapGone);

  // ---- 4. rejeu + self-test sur copie sans la routine ----
  console.log("== 4. Rejeu d'injection + self-test (copie sans la routine) ==");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-diagpurge-"));
  const strippedPath = path.join(dir, "bundle-stripped.user.js");
  let stripped = stableSrc;
  // L'ancre BX_EXPOSED est partagée par toutes les features : retire la
  // plage [ANCHOR_BX … fin de IMPL] au lieu d'une concaténation exacte —
  // robuste à l'ajout de nouvelles features (même fix que
  // feature-datasaver.test.js).
  const bxIdx = stripped.indexOf(ANCHOR_BX);
  const implIdx = bxIdx >= 0 ? stripped.indexOf(IMPL, bxIdx) : -1;
  if (bxIdx >= 0 && implIdx >= 0) {
    stripped = stripped.slice(0, bxIdx + ANCHOR_BX.length) + stripped.slice(implIdx + IMPL.length);
  }
  fs.writeFileSync(strippedPath, stripped);

  const stripOk =
    count(stripped, "window.BX_PURGE_DIAG") === 0 &&
    count(stripped, ANCHOR_BX) === 1;
  check("copie sans routine obtenue (injection inversée, ancre revenue)", stripOk,
    "purge=" + count(stripped, "window.BX_PURGE_DIAG") + " bxAncre=" + count(stripped, ANCHOR_BX));

  if (stripOk) {
    const r = spawnSync(process.execPath, [FEATURE_JS, strippedPath, "--dry-run", "--self-test"], { encoding: "utf8" });
    if (r.stdout) console.log(r.stdout);
    if (r.stderr) console.error(r.stderr);
    check("feature-diag-purge.js --dry-run --self-test → exit 0 (injection + chemin d'échec OK)", r.status === 0, "exit=" + r.status);
  } else {
    failures++;
    console.error("  ❌ rejeu non exécuté (strip invalide)");
  }
  fs.rmSync(dir, { recursive: true, force: true });

  return failures;
}

// ---- 0. bundles présents (le build preview précède ce test en CI) ----
if (!fs.existsSync(PREVIEW)) {
  console.log("== 0. Build preview manquant — lancement du build ==");
  execFileSync(process.execPath, [BUILD_JS], { cwd: ROOT, stdio: "inherit" });
}
if (!fs.existsSync(STABLE)) {
  console.error("❌ bundle stable absent : " + STABLE);
  process.exit(1);
}

const s = fs.readFileSync(STABLE, "utf8").replace(/\r\n/g, "\n");
const p = fs.readFileSync(PREVIEW, "utf8").replace(/\r\n/g, "\n");

// ---- --self-test : le chemin d'échec sur une copie corrompue ----
if (process.argv.includes("--self-test")) {
  console.log("== SELF-TEST : forme injectée (IMPL) corrompue sur une copie ==");
  const sBad = s.replace(IMPL, IMPL.replace("window.BX_PURGE_DIAG()", "window.BX_PURGE_DIAG_CHANGED()"));
  if (count(sBad, IMPL) !== 0) {
    console.error("❌ SELF-TEST : corruption inefficace (forme injectée encore présente)");
    process.exit(1);
  }
  const red = runChecks(sBad, p) > 0;
  console.log(red ? "\n[OK] SELF-TEST : dérive d'ancre détectée (GATE ROUGE attendu)" :
    "\n[FAIL] SELF-TEST : la corruption n'a PAS fait échouer les checks");
  process.exit(red ? 0 : 1);
}

const failures = runChecks(s, p);
console.log(failures === 0 ? "\nFeature diag-purge : tests OK" : `\n${failures} échec(s) Feature diag-purge`);
process.exit(failures === 0 ? 0 : 1);
