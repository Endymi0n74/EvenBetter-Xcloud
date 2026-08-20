#!/usr/bin/env node
/**
 * bench/tv-defaults.test.js — gate CI des défauts TV de l'APK (v1.13.3).
 * Branché dans le step preview de bench.yml.
 *
 * La navigation télécommande de l'overlay sur les box (Freebox Pop, TV)
 * repose sur les défauts TV posés par l'APK via JS_TV_DEFAULTS dans
 * MainActivity.java (`ui.controllerFriendly=true` + `ui.layout="tv"`, cf.
 * piège du 20 août : la WebView est « unknown » → deviceType !== "unknown"
 * vaut false → navigation coupée sans ce réglage). Une réécriture du Java
 * qui oublie un réglage ou rétrograde le marqueur d'idempotence casserait
 * la box silencieusement → GATE ROUGE.
 *
 * Vérifie :
 *   1. la constante JS_TV_DEFAULTS existe et contient TOUS les réglages TV
 *      (maxBitrate 5 Mbps, 720p, reduceAnimations, controllerFriendly,
 *      layout tv, rocket hide) avec le marqueur d'idempotence à 2 ;
 *   2. les deux points d'injection tiennent : l'évaluation au chargement
 *      (`+ JS_TV_DEFAULTS +`) et l'application conditionnelle
 *      (`isTv ? JS_TV_DEFAULTS : ""` — les non-TV ne reçoivent rien) ;
 *   3. les APK rebuildés présents localement (out-stable/out-preview,
 *      `evenbetter-xcloud-*.apk`) embarquent les bundles COURANTS : les
 *      assets `assets/better-xcloud.user.js` (+ es2017) extraits doivent
 *      être byte-identiques aux bundles du repo (CRLF normalisé) ET contenir
 *      le marqueur `controllerFriendly`. Un APK périmé dans out/ (rebuild
 *      oublié après un changement de bundle) → GATE ROUGE. En CI (pas de
 *      build mobile) : APK absents → warning + skip, comme readme-version.
 *   4. --self-test : corrompt une copie (controllerFriendly retiré) et
 *      vérifie que les checks passent au rouge — chemin d'échec rejouable
 *      sans toucher aux fichiers réels, comme les autres gates. Pour les
 *      APK : les bundles attendus sont corrompus sur COPIE (le zip réel est
 *      extrait — l'échec vient de la comparaison) → ROUGE attendu.
 *
 * Dépendance : `unzip` (présent sur ubuntu-latest et Git Bash Windows) —
 * l'APK est un zip, l'asset est extrait via `unzip -p`.
 *
 * Lancement local : node bench/tv-defaults.test.js [--self-test]
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const MAIN = path.join(ROOT, "mobile", "src", "com", "bxperf", "app", "MainActivity.java");
const MOBILE_OUT = path.join(ROOT, "mobile");

// Réglages attendus DANS la constante JS_TV_DEFAULTS. Le littéral Java
// échappe chaque guillemet en `\"` (backslash + quote) : on construit les
// aiguilles via JQ() qui reproduit cet échappement — plus aucune ambiguïté
// d'échappement JS (le `\"` d'un littéral simple consommerait le backslash).
// Si un réglage est renommé/retiré dans le Java → le compte tombe à 0 →
// GATE ROUGE.
const JQ = (s) => s.replace(/"/g, '\\"');
const TV_DEFAULTS = [
  { label: "marqueur idempotence lu à 2", needle: JQ('s["_bxTvDefaults"]!==2') },
  { label: "maxBitrate 5 Mbps", needle: JQ('s["stream.video.maxBitrate"]=5120000') },
  { label: "résolution 720p", needle: JQ('s["stream.video.resolution"]="720p"') },
  { label: "reduceAnimations", needle: JQ('s["ui.reduceAnimations"]=true') },
  { label: "controllerFriendly (nav télécommande)", needle: JQ('s["ui.controllerFriendly"]=true') },
  { label: "layout tv (Smart TV)", needle: JQ('s["ui.layout"]="tv"') },
  { label: "rocket hide (écran de chargement)", needle: JQ('s["loadingScreen.rocket"]="hide"') },
  { label: "marqueur idempotence écrit à 2", needle: JQ('s["_bxTvDefaults"]=2') },
];

// Points d'injection : la constante doit être évaluée au chargement ET
// appliquée conditionnellement (TV uniquement).
const INJECT_EVAL = 'JS_TV_DEFAULTS + "}}catch(e){}})();"';
const INJECT_TV_ONLY = 'isTv ? JS_TV_DEFAULTS : ""';

// Bundles attendus DANS chaque APK. build.sh copie toujours l'asset sous le
// MÊME nom `assets/better-xcloud.user.js` quel que soit le variant — le
// contenu attendu diffère donc (preview vs stable).
const APK_VARIANTS = [
  {
    variant: "stable",
    dir: "out-stable",
    bundles: [
      { asset: "assets/better-xcloud.user.js", file: path.join(ROOT, "better-xcloud.user.js") },
      { asset: "assets/better-xcloud.es2017.user.js", file: path.join(ROOT, "better-xcloud.es2017.user.js") },
    ],
  },
  {
    variant: "preview",
    dir: "out-preview",
    bundles: [
      { asset: "assets/better-xcloud.user.js", file: path.join(ROOT, "better-xcloud-preview.user.js") },
      { asset: "assets/better-xcloud.es2017.user.js", file: path.join(ROOT, "better-xcloud-preview.es2017.user.js") },
    ],
  },
];

const count = (h, n) => h.split(n).length - 1;
const norm = (s) => s.replace(/\r\n/g, "\n");
const sha = (s) => crypto.createHash("sha256").update(norm(s), "utf8").digest("hex").slice(0, 16);

function runChecks(src) {
  let failures = 0;
  const check = (label, cond, extra) => {
    if (cond) console.log(`  ✅ ${label}`);
    else { failures++; console.error(`  ❌ ${label}${extra ? " :: " + extra : ""}`); }
  };

  console.log("== 1. Constante JS_TV_DEFAULTS (tous les réglages TV) ==");
  check("constante JS_TV_DEFAULTS déclarée", count(src, "JS_TV_DEFAULTS =") >= 1, "n=" + count(src, "JS_TV_DEFAULTS ="));
  for (const t of TV_DEFAULTS) {
    check(t.label, count(src, t.needle) >= 1, "n=" + count(src, t.needle));
  }

  console.log("== 2. Points d'injection ==");
  check('évaluation au chargement (JS_TV_DEFAULTS + catch)', count(src, INJECT_EVAL) >= 1, "n=" + count(src, INJECT_EVAL));
  check('application TV uniquement (isTv ? JS_TV_DEFAULTS : "")', count(src, INJECT_TV_ONLY) >= 1, "n=" + count(src, INJECT_TV_ONLY));

  return failures;
}

// ---------- 3. APK embarqués ----------
function findApks() {
  const found = [];
  for (const v of APK_VARIANTS) {
    const dir = path.join(MOBILE_OUT, v.dir);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith("evenbetter-xcloud-") && f.endsWith(".apk")) {
        found.push({ apk: path.join(dir, f), ...v });
      }
    }
  }
  return found;
}

function extractAsset(apk, asset) {
  // unzip -p <apk> <asset> → contenu sur stdout. Lève si unzip absent ou
  // asset introuvable (message d'erreur sur stderr).
  const out = execFileSync("unzip", ["-p", apk, asset], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return out;
}

function verifyApk(apkInfo, bundlesOverride) {
  // bundlesOverride : pour le --self-test, bundles attendus corrompus sur
  // copie (null → les bundles réels du repo).
  let failures = 0;
  const check = (label, cond, extra) => {
    if (cond) console.log(`  ✅ ${label}`);
    else { failures++; console.error(`  ❌ ${label}${extra ? " :: " + extra : ""}`); }
  };
  const bundles = bundlesOverride || apkInfo.bundles;
  console.log(`== 3. APK embarqué : ${path.basename(apkInfo.apk)} (${apkInfo.variant}) ==`);
  for (const b of bundles) {
    let embedded = null;
    let err = null;
    try { embedded = extractAsset(apkInfo.apk, b.asset); } catch (e) { err = e.message.split("\n")[0]; }
    if (!embedded) {
      check(`${b.asset} extrait (unzip)`, false, err || "contenu vide");
      continue;
    }
    const expected = fs.readFileSync(b.file, "utf8");
    check(`${b.asset} = bundle courant (sha ${sha(expected)})`, sha(embedded) === sha(expected),
      `embarqué=${sha(embedded)} attendu=${sha(expected)}`);
    // Marqueur explicite demandé : le bundle embarqué contient la clé de
    // préférence controllerFriendly (redondant avec le sha, mais rend la
    // garantie lisible dans le log).
    if (b.asset.endsWith("better-xcloud.user.js")) {
      check(`${b.asset} contient controllerFriendly`, count(embedded, "controllerFriendly") >= 1,
        "n=" + count(embedded, "controllerFriendly"));
    }
  }
  return failures;
}

function runApkChecks(bundlesOverride) {
  const apks = findApks();
  if (apks.length === 0) {
    console.log("== 3. APK embarqués : AUCUN APK local (CI sans build mobile) — vérification embarquée ignorée (warn) ==");
    return 0;
  }
  let failures = 0;
  for (const apk of apks) {
    failures += verifyApk(apk, bundlesOverride);
  }
  return failures;
}

if (!fs.existsSync(MAIN)) {
  console.error("❌ MainActivity.java introuvable : " + MAIN);
  process.exit(1);
}

// CRLF→LF comme les autres gates (checkout Windows autocrlf).
const src = fs.readFileSync(MAIN, "utf8").replace(/\r\n/g, "\n");

// ---- --self-test : le chemin d'échec sur des copies corrompues ----
if (process.argv.includes("--self-test")) {
  let selfFail = 0;

  // 1. MainActivity : controllerFriendly retiré sur copie.
  console.log("== SELF-TEST : controllerFriendly retiré sur une copie ==");
  const bad = src.split(JQ('s["ui.controllerFriendly"]=true;')).join("");
  if (count(bad, JQ('s["ui.controllerFriendly"]=true')) !== 0) {
    console.error("❌ SELF-TEST : corruption inefficace (controllerFriendly encore présent)");
    process.exit(1);
  }
  const redMain = runChecks(bad) > 0;
  console.log(redMain ? "  [OK] SELF-TEST : défaut TV manquant détecté (GATE ROUGE attendu)" :
    "  [FAIL] SELF-TEST : la corruption n'a PAS fait échouer les checks");
  if (!redMain) selfFail++;

  // 2. APK : bundles attendus corrompus sur copie (le zip réel est extrait —
  //    l'échec vient de la comparaison sha + du marqueur absent).
  console.log("\n== SELF-TEST APK : bundles attendus corrompus (sans controllerFriendly) sur copie ==");
  const apks = findApks();
  if (apks.length === 0) {
    console.log("  ⚠ aucun APK local — self-test APK ignoré");
  } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-tvselftest-"));
    let apkRedOk = true;
    for (const apk of apks) {
      const over = apk.bundles.map((b) => {
        let content = fs.readFileSync(b.file, "utf8");
        content = content.split("controllerFriendly").join("");
        const tmp = path.join(dir, path.basename(b.asset) + ".corrupted");
        fs.writeFileSync(tmp, content);
        return { ...b, file: tmp };
      });
      const red = verifyApk(apk, over) > 0;
      console.log(red ? `  [OK] APK ${path.basename(apk.apk)} : bundle périmé détecté (ROUGE attendu)` :
        `  [FAIL] APK ${path.basename(apk.apk)} : la corruption n'a PAS fait échouer les checks`);
      if (!red) apkRedOk = false;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    if (!apkRedOk) selfFail++;
  }

  console.log(selfFail === 0 ? "\nSELF-TEST : OK ✅ — chemins d'échec MainActivity + APK détectés (GATE ROUGE attendu)" :
    `\nSELF-TEST : ${selfFail} chemin(s) d'échec non détecté(s) ❌`);
  process.exit(selfFail === 0 ? 0 : 1);
}

let failures = runChecks(src);
console.log();
failures += runApkChecks(null);
console.log(failures === 0 ? "\nDéfauts TV APK : tests OK" : `\n${failures} échec(s) Défauts TV APK`);
process.exit(failures === 0 ? 0 : 1);
