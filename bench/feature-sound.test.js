#!/usr/bin/env node
/**
 * bench/feature-sound.test.js — gate CI de la feature « 🔊 Son » (v1.13.0),
 * branché dans le step preview de bench.yml.
 *
 * Pas de navigateur en CI → vérifications statiques + rejeu de l'injection :
 *   1. PRÉSENCE : la feature est dans le bundle STABLE (source de vérité) ET
 *      dans le build PREVIEW (qui en hérite via build-preview.js) — un
 *      rebuild qui oublie l'injection → GATE ROUGE.
 *   2. ANCRES : dans le bundle stable injecté, les ancres d'injection de
 *      feature-sound.js tiennent (BX_EXPOSED ×1, implémentation ×1, item
 *      presets ajouté au groupe audio ×1, forme brute ×0) — une dérive du
 *      source amont ou de l'injection → GATE ROUGE.
 *   3. REJEU + SELF-TEST : copie STRIPPÉE du bundle (injection inversée,
 *      vérifiée) sur laquelle on relance `feature-sound.js --dry-run
 *      --self-test` : le chemin d'injection complet (2 ancres + syntaxe) ET
 *      le chemin d'échec (ancre corrompue → exit 1 attendu) doivent repasser
 *      → GATE ROUGE sinon.
 *
 * --self-test : corrompt l'item injecté (ITEM_SOUND) sur une COPIE du bundle
 * et vérifie que les checks passent au rouge — chemin d'échec rejouable sans
 * toucher aux builds réels, comme les autres gates.
 *
 * Lancement local : node bench/feature-sound.test.js [--self-test]
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const STABLE = path.join(ROOT, "better-xcloud.user.js");
const PREVIEW = path.join(ROOT, "better-xcloud-preview.user.js");
const FEATURE_JS = path.join(__dirname, "feature-sound.js");
const BUILD_JS = path.join(ROOT, "bench", "preview", "port", "build-preview.js");

// Ancres extraites de feature-sound.js (source de vérité de l'injection).
// Si une const est renommée/déplacée dans le script, l'extraction échoue →
// GATE ROUGE immédiat. Normalisation CRLF→LF (checkout Windows autocrlf).
const FEATURE_SRC = fs.readFileSync(FEATURE_JS, "utf8").replace(/\r\n/g, "\n");
const ANCHOR_BX = (FEATURE_SRC.match(/const ANCHOR_BX = "([^"]*)";/) || [])[1];
const ANCHOR_TAIL = (FEATURE_SRC.match(/const ANCHOR_TAIL = '([^']*)';/) || [])[1];
const ITEM_SOUND = (FEATURE_SRC.match(/const ITEM_SOUND = '([^']*)';/) || [])[1];
const IMPL = (FEATURE_SRC.match(/const IMPL = `([^]*?)`;/) || [])[1];

if (!ANCHOR_BX || !ANCHOR_TAIL || !ITEM_SOUND || !IMPL) {
  console.error("❌ GATE : ancres non extractibles depuis feature-sound.js (const renommée ?)");
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
  check("feature présente dans le bundle stable", count(stableSrc, "window.BX_SOUND_PRESETS") >= 1, "n=" + count(stableSrc, "window.BX_SOUND_PRESETS"));
  check("feature présente dans le build preview (héritée du stable)", count(previewSrc, "window.BX_SOUND_PRESETS") >= 1, "n=" + count(previewSrc, "window.BX_SOUND_PRESETS"));

  // ---- 2. ancres (bundle stable injecté) ----
  console.log("== 2. Ancres d'injection (bundle stable injecté) ==");
  check("ancre BX_EXPOSED ×1", count(stableSrc, ANCHOR_BX) === 1, "n=" + count(stableSrc, ANCHOR_BX));
  check("implémentation BX_SOUND_PRESETS ×1", count(stableSrc, IMPL) === 1, "n=" + count(stableSrc, IMPL));
  check("item presets ajouté au groupe audio ×1", count(stableSrc, ITEM_SOUND) === 1, "n=" + count(stableSrc, ITEM_SOUND));
  check("forme brute (fin de l'item audio.volume) ×0", count(stableSrc, ANCHOR_TAIL) === 0, "n=" + count(stableSrc, ANCHOR_TAIL));

  // ---- 3. rejeu + self-test sur copie sans feature ----
  console.log("== 3. Rejeu d'injection + self-test (copie sans feature) ==");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-sound-"));
  const strippedPath = path.join(dir, "bundle-stripped.user.js");
  let stripped = stableSrc;
  // L'ancre BX_EXPOSED est partagée par TOUTES les features (latence v1.10,
  // data v1.11, région v1.12, son v1.13, purge BX_PURGE_DIAG…) : l'IMPL du
  // son n'est plus forcément ADJACENT à l'ancre (les features plus récentes
  // passent devant). On retire la plage [ANCHOR_BX … fin de IMPL_SOUND] au
  // lieu d'une concaténation exacte — robuste à l'ajout de nouvelles
  // features (même fix que feature-datasaver.test.js).
  const bxIdx = stripped.indexOf(ANCHOR_BX);
  const sndIdx = bxIdx >= 0 ? stripped.indexOf(IMPL, bxIdx) : -1;
  if (bxIdx >= 0 && sndIdx >= 0) {
    stripped = stripped.slice(0, bxIdx + ANCHOR_BX.length) + stripped.slice(sndIdx + IMPL.length);
  }
  if (count(stripped, ITEM_SOUND) === 1) stripped = stripped.replace(ITEM_SOUND, ANCHOR_TAIL);
  fs.writeFileSync(strippedPath, stripped);

  const stripOk =
    count(stripped, "window.BX_SOUND_PRESETS") === 0 &&
    count(stripped, ANCHOR_BX) === 1 &&
    count(stripped, ANCHOR_TAIL) === 1;
  check("copie sans feature obtenue (injection inversée, ancres revenues)", stripOk,
    "sound=" + count(stripped, "window.BX_SOUND_PRESETS") + " bxAncre=" + count(stripped, ANCHOR_BX) +
    " tail=" + count(stripped, ANCHOR_TAIL));

  if (stripOk) {
    // feature-sound.js : injection (dry-run, rien écrit) + --self-test du
    // chemin d'échec (ancre corrompue sur copie → exit 1 attendu → OK).
    const r = spawnSync(process.execPath, [FEATURE_JS, strippedPath, "--dry-run", "--self-test"], { encoding: "utf8" });
    if (r.stdout) console.log(r.stdout);
    if (r.stderr) console.error(r.stderr);
    check("feature-sound.js --dry-run --self-test → exit 0 (injection + chemin d'échec OK)", r.status === 0, "exit=" + r.status);
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
// Le bundle est DÉJÀ injecté : la corruption doit toucher la forme injectée
// (ITEM_SOUND), pas l'ancre brute (absente du bundle injecté).
if (process.argv.includes("--self-test")) {
  console.log("== SELF-TEST : forme injectée (ITEM_SOUND) corrompue sur une copie ==");
  const sBad = s.replace(ITEM_SOUND, ITEM_SOUND.replace("BX_SOUND_PRESETS.render", "BX_SOUND_PRESETS.render_CHANGED"));
  if (count(sBad, ITEM_SOUND) !== 0) {
    console.error("❌ SELF-TEST : corruption inefficace (forme injectée encore présente)");
    process.exit(1);
  }
  const red = runChecks(sBad, p) > 0;
  console.log(red ? "\n[OK] SELF-TEST : dérive d'ancre détectée (GATE ROUGE attendu)" :
    "\n[FAIL] SELF-TEST : la corruption n'a PAS fait échouer les checks");
  process.exit(red ? 0 : 1);
}

const failures = runChecks(s, p);
console.log(failures === 0 ? "\nFeature Son : tests OK" : `\n${failures} échec(s) Feature Son`);
process.exit(failures === 0 ? 0 : 1);
