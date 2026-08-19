#!/usr/bin/env node
/**
 * bench/feature-region.test.js — gate CI de la feature « ⚡ Appliquer la
 * meilleure région » (v1.12.0), branché dans le step preview de bench.yml.
 *
 * Pas de navigateur en CI → vérifications statiques + rejeu de l'injection :
 *   1. PRÉSENCE : la feature est dans le bundle STABLE (source de vérité) ET
 *      dans le build PREVIEW (qui en hérite via build-preview.js) — un
 *      rebuild qui oublie l'injection → GATE ROUGE.
 *   2. ANCRES : dans le bundle stable injecté, les 4 ancres d'injection de
 *      feature-region.js tiennent (BX_EXPOSED ×1, patch latence results.push
 *      sous sa forme patchee ×1 / brute ×0, patch latence fin-de-run ×1,
 *      item groupe SERVER ×1) + implémentation ×1 — une dérive du source
 *      amont ou de l'injection → GATE ROUGE.
 *   3. REJEU + SELF-TEST : copie STRIPPÉE du bundle (injection inversée,
 *      vérifiée) sur laquelle on relance `feature-region.js --dry-run
 *      --self-test` : le chemin d'injection complet (4 ancres + syntaxe) ET
 *      le chemin d'échec (ancre corrompue → exit 1 attendu) doivent repasser
 *      → GATE ROUGE sinon.
 *
 * --self-test : corrompt l'ancre ANCHOR_PUSH (patch du test latence) sur une
 * COPIE du bundle et vérifie que les checks passent au rouge — chemin
 * d'échec rejouable sans toucher aux builds réels, comme les autres gates.
 *
 * Lancement local : node bench/feature-region.test.js [--self-test]
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const STABLE = path.join(ROOT, "better-xcloud.user.js");
const PREVIEW = path.join(ROOT, "better-xcloud-preview.user.js");
const FEATURE_JS = path.join(__dirname, "feature-region.js");
const BUILD_JS = path.join(ROOT, "bench", "preview", "port", "build-preview.js");

// Ancres extraites de feature-region.js (source de vérité de l'injection).
// Si une const est renommée/déplacée dans le script, l'extraction échoue →
// GATE ROUGE immédiat. Normalisation CRLF→LF (checkout Windows autocrlf :
// les bundles sont en CRLF, feature-region.js en LF — même piège que le
// gate feature-datasaver).
const FEATURE_SRC = fs.readFileSync(FEATURE_JS, "utf8").replace(/\r\n/g, "\n");
const ANCHOR_BX = (FEATURE_SRC.match(/const ANCHOR_BX = "([^"]*)";/) || [])[1];
const ANCHOR_ITEM = (FEATURE_SRC.match(/const ANCHOR_ITEM = "([^"]*)";/) || [])[1];
const ANCHOR_PUSH = (FEATURE_SRC.match(/const ANCHOR_PUSH = "([^"]*)";/) || [])[1];
const ANCHOR_DONE = (FEATURE_SRC.match(/const ANCHOR_DONE = '([^']*)';/) || [])[1];
const IMPL = (FEATURE_SRC.match(/const IMPL = \`([^]*?)\`;/) || [])[1];
// Formes POST-injection (construites par feature-region.js).
const PUSH_KEY = "results.push({code: r.shortName || r.name || name, label: r.displayName || name, ms: ms, isDefault: !!r.isDefault, key: name});";
const DONE_HOOK = "window.BX_LATENCY_TEST.lastResults = results;window.BX_REGION_APPLY && window.BX_REGION_APPLY.refresh && window.BX_REGION_APPLY.refresh();";
const ITEM_REGION = ",($parent) => {window.BX_LATENCY_TEST.render($parent);},($parent) => {window.BX_REGION_APPLY.render($parent);}]}";

if (!ANCHOR_BX || !ANCHOR_ITEM || !ANCHOR_PUSH || !ANCHOR_DONE || !IMPL) {
  console.error("❌ GATE : ancres non extractibles depuis feature-region.js (const renommée ?)");
  process.exit(1);
}

const count = (h, n) => h.split(n).length - 1;

function runChecks(stableSrc, previewSrc) {
  let failures = 0;
  const check = (label, cond, extra) => {
    if (cond) console.log(`  ✅ ${label}`);
    else { failures++; console.error(`  ❌ ${label}${extra ? " :: " + extra : ""}`); }
  };

  // ---- 1. présence ----
  console.log("== 1. Présence de la feature (stable + preview) ==");
  check("feature présente dans le bundle stable", count(stableSrc, "window.BX_REGION_APPLY") >= 1, "n=" + count(stableSrc, "window.BX_REGION_APPLY"));
  check("feature présente dans le build preview (héritée du stable)", count(previewSrc, "window.BX_REGION_APPLY") >= 1, "n=" + count(previewSrc, "window.BX_REGION_APPLY"));
  check("dépendance BX_LATENCY_TEST présente dans le stable", count(stableSrc, "window.BX_LATENCY_TEST") >= 2, "n=" + count(stableSrc, "window.BX_LATENCY_TEST"));

  // ---- 2. ancres (bundle stable injecté) ----
  console.log("== 2. Ancres d'injection (bundle stable injecté) ==");
  check("ancre BX_EXPOSED ×1", count(stableSrc, ANCHOR_BX) === 1, "n=" + count(stableSrc, ANCHOR_BX));
  check("implémentation BX_REGION_APPLY ×1", count(stableSrc, IMPL) === 1, "n=" + count(stableSrc, IMPL));
  check("latence results.push patché (key) ×1", count(stableSrc, PUSH_KEY) === 1, "n=" + count(stableSrc, PUSH_KEY));
  check("latence results.push brut ×0 (remplacé)", count(stableSrc, ANCHOR_PUSH) === 0, "n=" + count(stableSrc, ANCHOR_PUSH));
  check("latence fin-de-run hookée (lastResults) ×1", count(stableSrc, DONE_HOOK) === 1, "n=" + count(stableSrc, DONE_HOOK));
  // La forme injectée = DONE_HOOK + ANCHOR_DONE (concaténés) : l'ancre brute
  // reste le tail de la ligne hookée → on vérifie qu'elle n'apparaît QUE sous
  // cette forme (hook + brut = 1 seule occurrence jointe).
  check("fin-de-run hookée + ancre brute concaténées ×1", count(stableSrc, DONE_HOOK + ANCHOR_DONE) === 1, "n=" + count(stableSrc, DONE_HOOK + ANCHOR_DONE));
  check("item latence brut ×0 (remplacé par latence+région)", count(stableSrc, ANCHOR_ITEM) === 0, "n=" + count(stableSrc, ANCHOR_ITEM));
  check("item région ajouté au groupe SERVER ×1", count(stableSrc, ITEM_REGION) === 1, "n=" + count(stableSrc, ITEM_REGION));

  // ---- 3. rejeu + self-test sur copie sans feature ----
  console.log("== 3. Rejeu d'injection + self-test (copie sans feature) ==");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-region-"));
  const strippedPath = path.join(dir, "bundle-stripped.user.js");
  let stripped = stableSrc;
  if (count(stripped, ANCHOR_BX + IMPL) === 1) stripped = stripped.replace(ANCHOR_BX + IMPL, ANCHOR_BX);
  if (count(stripped, PUSH_KEY) === 1) stripped = stripped.replace(PUSH_KEY, ANCHOR_PUSH);
  if (count(stripped, DONE_HOOK + ANCHOR_DONE) === 1) stripped = stripped.replace(DONE_HOOK + ANCHOR_DONE, ANCHOR_DONE);
  if (count(stripped, ITEM_REGION) === 1) stripped = stripped.replace(ITEM_REGION, ANCHOR_ITEM);
  fs.writeFileSync(strippedPath, stripped);

  const stripOk =
    count(stripped, "window.BX_REGION_APPLY") === 0 &&
    count(stripped, ANCHOR_BX) === 1 &&
    count(stripped, ANCHOR_PUSH) === 1 &&
    count(stripped, ANCHOR_DONE) === 1 &&
    count(stripped, ANCHOR_ITEM) === 1;
  check("copie sans feature obtenue (injection inversée, ancres revenues)", stripOk,
    "region=" + count(stripped, "window.BX_REGION_APPLY") + " bxAncre=" + count(stripped, ANCHOR_BX) +
    " push=" + count(stripped, ANCHOR_PUSH) + " done=" + count(stripped, ANCHOR_DONE) +
    " item=" + count(stripped, ANCHOR_ITEM));

  if (stripOk) {
    // feature-region.js : injection (dry-run, rien écrit) + --self-test du
    // chemin d'échec (ancre corrompue sur copie → exit 1 attendu → OK).
    const r = spawnSync(process.execPath, [FEATURE_JS, strippedPath, "--dry-run", "--self-test"], { encoding: "utf8" });
    if (r.stdout) console.log(r.stdout);
    if (r.stderr) console.error(r.stderr);
    check("feature-region.js --dry-run --self-test → exit 0 (injection + chemin d'échec OK)", r.status === 0, "exit=" + r.status);
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
// Le bundle est DÉJÀ injecté : la corruption doit toucher la forme PATCHÉE
// (PUSH_KEY), pas l'ancre brute (absente du bundle injecté). Même esprit que
// la PR de contrôle du gate feature-datasaver (#17) : une dérive de
// l'injection → GATE ROUGE.
if (process.argv.includes("--self-test")) {
  console.log("== SELF-TEST : forme patchée (PUSH_KEY) corrompue sur une copie ==");
  const sBad = s.replace(PUSH_KEY, "results.push({code: r.shortName || r.name || name, label: r.displayName || name, ms: ms, isDefault: !!r.isDefault, key: name_CHANGED});");
  if (count(sBad, PUSH_KEY) !== 0) {
    console.error("❌ SELF-TEST : corruption inefficace (forme patchée encore présente)");
    process.exit(1);
  }
  const red = runChecks(sBad, p) > 0;
  console.log(red ? "\n[OK] SELF-TEST : dérive d'ancre détectée (GATE ROUGE attendu)" :
    "\n[FAIL] SELF-TEST : la corruption n'a PAS fait échouer les checks");
  process.exit(red ? 0 : 1);
}

const failures = runChecks(s, p);
console.log(failures === 0 ? "\nFeature Region : tests OK" : `\n${failures} échec(s) Feature Region`);
process.exit(failures === 0 ? 0 : 1);
