#!/usr/bin/env node
/**
 * bench/feature-session-import.test.js — gate CI de la feature « 📥 Session »
 * (v1.13.1, import/export de la session Xbox entre appareils), branché dans
 * le step preview de bench.yml.
 *
 * Pas de navigateur en CI → vérifications statiques + rejeu de l'injection :
 *   1. PRÉSENCE : la feature est dans le bundle STABLE (source de vérité) ET
 *      dans le build PREVIEW (qui en hérite via build-preview.js).
 *   2. ANCRES : dans le bundle stable injecté, les 3 ancres d'injection de
 *      feature-session-import.js tiennent (BX_EXPOSED ×1, groupe other ×1,
 *      filtre rendu déconnecté sous sa forme injectée ×1 / forme brute ×0,
 *      groupe Session inséré ×1, implémentation ×1).
 *   3. REJEU + SELF-TEST : copie STRIPPÉE du bundle (injection inversée,
 *      vérifiée) sur laquelle on relance `feature-session-import.js --dry-run
 *      --self-test` : le chemin d'injection complet ET le chemin d'échec
 *      (ancre corrompue → exit 1 attendu) doivent repasser.
 *
 * --self-test : corrompt l'ancre ANCHOR_OTHER sur une COPIE du bundle et
 * vérifie que les checks passent au rouge.
 *
 * Lancement local : node bench/feature-session-import.test.js [--self-test]
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const STABLE = path.join(ROOT, "better-xcloud.user.js");
const PREVIEW = path.join(ROOT, "better-xcloud-preview.user.js");
const FEATURE_JS = path.join(__dirname, "feature-session-import.js");
const BUILD_JS = path.join(ROOT, "bench", "preview", "port", "build-preview.js");

// Ancres extraites de feature-session-import.js (source de vérité). Normalisation
// CRLF→LF (checkout Windows autocrlf) — même piège que les autres features.
const FEATURE_SRC = fs.readFileSync(FEATURE_JS, "utf8").replace(/\r\n/g, "\n");
const ANCHOR_BX = (FEATURE_SRC.match(/const ANCHOR_BX = "([^"]*)";/) || [])[1];
const ANCHOR_OTHER = (FEATURE_SRC.match(/const ANCHOR_OTHER = '([^']*)';/) || [])[1];
const ANCHOR_FILTER = (FEATURE_SRC.match(/const ANCHOR_FILTER = '([^']*)';/) || [])[1];
// L'IMPL est un template literal : les échappements (\\n) y sont INTERPRÉTÉS
// (→ \n simple dans la valeur). Le regex capture le texte SOURCE (\\n double) ;
// on ré-applique l'interprétation pour comparer au bundle injecté.
const IMPL = ((FEATURE_SRC.match(/const IMPL = `([^]*?)`;/) || [])[1] || "").replace(/\\\\n/g, "\\n");
// Formes POST-injection : groupe « session » devant l'ancre other, filtre étendu.
const SESSION_GROUP = '{group: "session",label: "📥 Session",items: [($parent) => {window.BX_SESSION_IMPORT.render($parent);}]},';
const INJ_FILTER = 'section.group !== "sound" && section.group !== "data" && section.group !== "session") continue;';

if (!ANCHOR_BX || !ANCHOR_OTHER || !ANCHOR_FILTER || !IMPL) {
  console.error("❌ GATE : ancres non extractibles depuis feature-session-import.js (const renommée ?)");
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
  check("feature présente dans le bundle stable", count(stableSrc, "window.BX_SESSION_IMPORT") >= 1, "n=" + count(stableSrc, "window.BX_SESSION_IMPORT"));
  check("feature présente dans le build preview (héritée du stable)", count(previewSrc, "window.BX_SESSION_IMPORT") >= 1, "n=" + count(previewSrc, "window.BX_SESSION_IMPORT"));

  // ---- 2. ancres (bundle stable injecté) ----
  console.log("== 2. Ancres d'injection (bundle stable injecté) ==");
  check("ancre BX_EXPOSED ×1", count(stableSrc, ANCHOR_BX) === 1, "n=" + count(stableSrc, ANCHOR_BX));
  check("ancre groupe other ×1", count(stableSrc, ANCHOR_OTHER) === 1, "n=" + count(stableSrc, ANCHOR_OTHER));
  check("filtre rendu déconnecté (forme injectée) ×1", count(stableSrc, INJ_FILTER) === 1, "n=" + count(stableSrc, INJ_FILTER));
  check("filtre brut ×0 (remplacé par l'injection)", count(stableSrc, ANCHOR_FILTER) === 0, "n=" + count(stableSrc, ANCHOR_FILTER));
  check("groupe Session inséré ×1", count(stableSrc, SESSION_GROUP) === 1, "n=" + count(stableSrc, SESSION_GROUP));
  check("implémentation BX_SESSION_IMPORT ×1", count(stableSrc, IMPL) === 1, "n=" + count(stableSrc, IMPL));

  // ---- 3. rejeu + self-test sur copie sans feature ----
  console.log("== 3. Rejeu d'injection + self-test (copie sans feature) ==");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-sessimp-"));
  const strippedPath = path.join(dir, "bundle-stripped.user.js");
  let stripped = stableSrc;
  // L'ancre BX_EXPOSED est partagée par TOUTES les features : on retire la
  // plage [ANCHOR_BX … fin de IMPL] (robuste à l'ordre d'empilement).
  const bxIdx = stripped.indexOf(ANCHOR_BX);
  const impIdx = bxIdx >= 0 ? stripped.indexOf(IMPL, bxIdx) : -1;
  if (bxIdx >= 0 && impIdx >= 0) {
    stripped = stripped.slice(0, bxIdx) + ANCHOR_BX + stripped.slice(impIdx + IMPL.length);
  }
  if (count(stripped, SESSION_GROUP + ANCHOR_OTHER) === 1) stripped = stripped.replace(SESSION_GROUP + ANCHOR_OTHER, ANCHOR_OTHER);
  if (count(stripped, INJ_FILTER) === 1) stripped = stripped.replace(INJ_FILTER, ANCHOR_FILTER);
  fs.writeFileSync(strippedPath, stripped);

  const stripOk =
    count(stripped, "window.BX_SESSION_IMPORT") === 0 &&
    count(stripped, ANCHOR_BX) === 1 &&
    count(stripped, ANCHOR_OTHER) === 1 &&
    count(stripped, ANCHOR_FILTER) === 1;
  check("copie sans feature obtenue (injection inversée, ancres revenues)", stripOk,
    "BX=" + count(stripped, "window.BX_SESSION_IMPORT") + " bxAncre=" + count(stripped, ANCHOR_BX) +
    " otherAncre=" + count(stripped, ANCHOR_OTHER) + " filtBrut=" + count(stripped, ANCHOR_FILTER));

  if (stripOk) {
    const r = spawnSync(process.execPath, [FEATURE_JS, strippedPath, "--dry-run", "--self-test"], { encoding: "utf8" });
    if (r.stdout) console.log(r.stdout);
    if (r.stderr) console.error(r.stderr);
    check("feature-session-import.js --dry-run --self-test → exit 0 (injection + chemin d'échec OK)", r.status === 0, "exit=" + r.status);
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
  console.log("== SELF-TEST : ancre ANCHOR_OTHER corrompue sur une copie ==");
  const sBad = s.replace(ANCHOR_OTHER, '{group: "other",label: t("other_CHANGED")');
  if (count(sBad, ANCHOR_OTHER) !== 0) {
    console.error("❌ SELF-TEST : corruption inefficace (ancre encore présente)");
    process.exit(1);
  }
  const red = runChecks(sBad, p) > 0;
  console.log(red ? "\n[OK] SELF-TEST : dérive d'ancre détectée (GATE ROUGE attendu)" :
    "\n[FAIL] SELF-TEST : la corruption n'a PAS fait échouer les checks");
  process.exit(red ? 0 : 1);
}

const failures = runChecks(s, p);
console.log(failures === 0 ? "\nFeature Session import : tests OK" : `\n${failures} échec(s) Feature Session import`);
process.exit(failures === 0 ? 0 : 1);
