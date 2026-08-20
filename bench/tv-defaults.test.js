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
 * Vérifie statiquement (pas de build APK en CI) :
 *   1. la constante JS_TV_DEFAULTS existe et contient TOUS les réglages TV
 *      (maxBitrate 5 Mbps, 720p, reduceAnimations, controllerFriendly,
 *      layout tv, rocket hide) avec le marqueur d'idempotence à 2 ;
 *   2. les deux points d'injection tiennent : l'évaluation au chargement
 *      (`+ JS_TV_DEFAULTS +`) et l'application conditionnelle
 *      (`isTv ? JS_TV_DEFAULTS : ""` — les non-TV ne reçoivent rien) ;
 *   3. --self-test : corrompt une copie (controllerFriendly retiré) et
 *      vérifie que les checks passent au rouge — chemin d'échec rejouable
 *      sans toucher au fichier réel, comme les autres gates.
 *
 * Lancement local : node bench/tv-defaults.test.js [--self-test]
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MAIN = path.join(ROOT, "mobile", "src", "com", "bxperf", "app", "MainActivity.java");

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
const INJECT_EVAL = "JS_TV_DEFAULTS + \"}}catch(e){}})();\"";
const INJECT_TV_ONLY = "isTv ? JS_TV_DEFAULTS : \"\"";

const count = (h, n) => h.split(n).length - 1;

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
  check("évaluation au chargement (JS_TV_DEFAULTS + catch)", count(src, INJECT_EVAL) >= 1, "n=" + count(src, INJECT_EVAL));
  check("application TV uniquement (isTv ? JS_TV_DEFAULTS : \"\")", count(src, INJECT_TV_ONLY) >= 1, "n=" + count(src, INJECT_TV_ONLY));

  return failures;
}

if (!fs.existsSync(MAIN)) {
  console.error("❌ MainActivity.java introuvable : " + MAIN);
  process.exit(1);
}

// CRLF→LF comme les autres gates (checkout Windows autocrlf).
const src = fs.readFileSync(MAIN, "utf8").replace(/\r\n/g, "\n");

// ---- --self-test : le chemin d'échec sur une copie corrompue ----
if (process.argv.includes("--self-test")) {
  console.log("== SELF-TEST : controllerFriendly retiré sur une copie ==");
  const bad = src.split(JQ('s["ui.controllerFriendly"]=true;')).join("");
  if (count(bad, JQ('s["ui.controllerFriendly"]=true')) !== 0) {
    console.error("❌ SELF-TEST : corruption inefficace (controllerFriendly encore présent)");
    process.exit(1);
  }
  const red = runChecks(bad) > 0;
  console.log(red ? "\n[OK] SELF-TEST : défaut TV manquant détecté (GATE ROUGE attendu)" :
    "\n[FAIL] SELF-TEST : la corruption n'a PAS fait échouer les checks");
  process.exit(red ? 0 : 1);
}

const failures = runChecks(src);
console.log(failures === 0 ? "\nDéfauts TV APK : tests OK" : `\n${failures} échec(s) Défauts TV APK`);
process.exit(failures === 0 ? 0 : 1);
