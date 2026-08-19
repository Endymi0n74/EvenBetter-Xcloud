#!/usr/bin/env node
/**
 * bench/feature-datasaver.test.js — gate CI de la feature « 📊 Données »
 * (v1.11.0), branché dans le step preview de bench.yml.
 *
 * Pas de navigateur en CI → vérifications statiques + rejeu de l'injection :
 *   1. PRÉSENCE : la feature est dans le bundle STABLE (source de vérité) ET
 *      dans le build PREVIEW (qui en hérite via build-preview.js) — un
 *      rebuild qui oublie l'injection → GATE ROUGE.
 *   2. ANCRES : dans le bundle stable injecté, les 3 ancres d'injection de
 *      feature-datasaver.js tiennent (BX_EXPOSED ×1, groupe server ×1, filtre
 *      rendu déconnecté sous sa forme injectée ×1 / forme brute ×0, groupe
 *      Données inséré ×1, implémentation ×1) — une dérive du source amont
 *      ou de l'injection → GATE ROUGE.
 *   3. REJEU + SELF-TEST : copie STRIPPÉE du bundle (injection inversée,
 *      vérifiée) sur laquelle on relance `feature-datasaver.js --dry-run
 *      --self-test` : le chemin d'injection complet (3 ancres + syntaxe) ET
 *      le chemin d'échec (ancre corrompue → exit 1 attendu) doivent repasser
 *      → GATE ROUGE sinon.
 *
 * --self-test : corrompt l'ancre ANCHOR_GROUP sur une COPIE du bundle (la
 * même corruption que la PR de contrôle #17) et vérifie que les checks
 * passent au rouge — chemin d'échec rejouable sans toucher aux builds réels,
 * comme t10-auto-spoof.test.js.
 *
 * Lancement local : node bench/feature-datasaver.test.js [--self-test]
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const STABLE = path.join(ROOT, "better-xcloud.user.js");
const PREVIEW = path.join(ROOT, "better-xcloud-preview.user.js");
const FEATURE_JS = path.join(__dirname, "feature-datasaver.js");
const BUILD_JS = path.join(ROOT, "bench", "preview", "port", "build-preview.js");

// Ancres extraites de feature-datasaver.js (source de vérité de l'injection).
// Si une const est renommée/déplacée dans le script, l'extraction échoue →
// GATE ROUGE immédiat (le test ne peut pas vérifier ce qu'il ne lit plus).
// Normalisation CRLF→LF : sur un checkout Windows (autocrlf=true) les bundles
// sont en CRLF alors que feature-datasaver.js (écrit en LF) reste en LF → les
// comparaisons octet-à-octet (IMPL, ancres, strip) échoueraient à tort. Le CI
// ubuntu est en LF partout ; la normalisation rend le test identique partout.
const FEATURE_SRC = fs.readFileSync(FEATURE_JS, "utf8").replace(/\r\n/g, "\n");
const ANCHOR_BX = (FEATURE_SRC.match(/const ANCHOR_BX = "([^"]*)";/) || [])[1];
const ANCHOR_GROUP = (FEATURE_SRC.match(/const ANCHOR_GROUP = '([^']*)';/) || [])[1];
const ANCHOR_FILTER = (FEATURE_SRC.match(/const ANCHOR_FILTER = '([^']*)';/) || [])[1];
const IMPL = (FEATURE_SRC.match(/const IMPL = `([^]*?)`;/) || [])[1];
// Formes POST-injection (construites par feature-datasaver.js) : le groupe
// « data » inséré devant l'ancre server, et le filtre rendu déconnecté étendu.
const DATA_GROUP = '{group: "data",label: "📊 Données",items: ["stream.video.maxBitrate","stream.video.resolution",($parent) => {window.BX_DATA_SAVER.render($parent);}]},';
const INJ_FILTER = 'section.group !== "sound" && section.group !== "data") continue;';

if (!ANCHOR_BX || !ANCHOR_GROUP || !ANCHOR_FILTER || !IMPL) {
  console.error("❌ GATE : ancres non extractibles depuis feature-datasaver.js (const renommée ?)");
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
  check("feature présente dans le bundle stable", count(stableSrc, "window.BX_DATA_SAVER") >= 1, "n=" + count(stableSrc, "window.BX_DATA_SAVER"));
  check("feature présente dans le build preview (héritée du stable)", count(previewSrc, "window.BX_DATA_SAVER") >= 1, "n=" + count(previewSrc, "window.BX_DATA_SAVER"));

  // ---- 2. ancres (bundle stable injecté) ----
  console.log("== 2. Ancres d'injection (bundle stable injecté) ==");
  check("ancre BX_EXPOSED ×1", count(stableSrc, ANCHOR_BX) === 1, "n=" + count(stableSrc, ANCHOR_BX));
  check("ancre groupe server ×1", count(stableSrc, ANCHOR_GROUP) === 1, "n=" + count(stableSrc, ANCHOR_GROUP));
  check("filtre rendu déconnecté (forme injectée) ×1", count(stableSrc, INJ_FILTER) === 1, "n=" + count(stableSrc, INJ_FILTER));
  check("filtre brut ×0 (remplacé par l'injection)", count(stableSrc, ANCHOR_FILTER) === 0, "n=" + count(stableSrc, ANCHOR_FILTER));
  check("groupe Données inséré ×1", count(stableSrc, DATA_GROUP) === 1, "n=" + count(stableSrc, DATA_GROUP));
  check("implémentation BX_DATA_SAVER ×1", count(stableSrc, IMPL) === 1, "n=" + count(stableSrc, IMPL));

  // ---- 3. rejeu + self-test sur copie sans feature ----
  console.log("== 3. Rejeu d'injection + self-test (copie sans feature) ==");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-datasaver-"));
  const strippedPath = path.join(dir, "bundle-stripped.user.js");
  let stripped = stableSrc;
  if (count(stripped, ANCHOR_BX + IMPL) === 1) stripped = stripped.replace(ANCHOR_BX + IMPL, ANCHOR_BX);
  if (count(stripped, DATA_GROUP + ANCHOR_GROUP) === 1) stripped = stripped.replace(DATA_GROUP + ANCHOR_GROUP, ANCHOR_GROUP);
  if (count(stripped, INJ_FILTER) === 1) stripped = stripped.replace(INJ_FILTER, ANCHOR_FILTER);
  fs.writeFileSync(strippedPath, stripped);

  const stripOk =
    count(stripped, "window.BX_DATA_SAVER") === 0 &&
    count(stripped, ANCHOR_BX) === 1 &&
    count(stripped, ANCHOR_GROUP) === 1 &&
    count(stripped, ANCHOR_FILTER) === 1;
  check("copie sans feature obtenue (injection inversée, ancres revenues)", stripOk,
    "BX=" + count(stripped, "window.BX_DATA_SAVER") + " bxAncre=" + count(stripped, ANCHOR_BX) +
    " grpAncre=" + count(stripped, ANCHOR_GROUP) + " filtBrut=" + count(stripped, ANCHOR_FILTER));

  if (stripOk) {
    // feature-datasaver.js : injection (dry-run, rien écrit) + --self-test du
    // chemin d'échec (ancre corrompue sur copie → exit 1 attendu → OK).
    const r = spawnSync(process.execPath, [FEATURE_JS, strippedPath, "--dry-run", "--self-test"], { encoding: "utf8" });
    if (r.stdout) console.log(r.stdout);
    if (r.stderr) console.error(r.stderr);
    check("feature-datasaver.js --dry-run --self-test → exit 0 (injection + chemin d'échec OK)", r.status === 0, "exit=" + r.status);
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
  console.log("== SELF-TEST : ancre ANCHOR_GROUP corrompue sur une copie ==");
  // Même corruption que la PR de contrôle réelle (#17) : l'ancre du groupe
  // server est remplacée → la feature-datasaver ne peut plus s'injecter.
  const sBad = s.replace(ANCHOR_GROUP, '{group: "server",label: t("server_CHANGED")');
  if (count(sBad, ANCHOR_GROUP) !== 0) {
    console.error("❌ SELF-TEST : corruption inefficace (ancre encore présente)");
    process.exit(1);
  }
  const red = runChecks(sBad, p) > 0;
  console.log(red ? "\n[OK] SELF-TEST : dérive d'ancre détectée (GATE ROUGE attendu)" :
    "\n[FAIL] SELF-TEST : la corruption n'a PAS fait échouer les checks");
  process.exit(red ? 0 : 1);
}

const failures = runChecks(s, p);
console.log(failures === 0 ? "\nFeature Data saver : tests OK" : `\n${failures} échec(s) Feature Data saver`);
process.exit(failures === 0 ? 0 : 1);
