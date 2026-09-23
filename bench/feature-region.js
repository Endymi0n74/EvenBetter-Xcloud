#!/usr/bin/env node
/*
 * feature-region.js — injecte la feature « ⚡ Appliquer la meilleure région »
 * (v1.12.0) dans un bundle userscript (stable ou preview) de façon
 * DÉTERMINISTE, avec gates (GATE ROUGE si un pattern a dérivé).
 *
 * La feature : un bouton « Appliquer la meilleure région » dans le groupe
 * SERVER des settings globaux, juste sous le test de latence (v1.10.0). Une
 * fois le test exécuté, le bouton affiche la meilleure région mesurée et
 * pose `server.region` (pref GLOBALE, valeur = la CLÉ de la région dans
 * STATES.serverRegions — ex. "CSE", pas shortName qui contient l'emoji
 * drapeau). Même chemin que les selects du script :
 * setGlobalPref("server.region", key, "ui") (validate + persist + event UI).
 *
 * Dépendances : la feature requiert feature-latency.js injecté (elle lit
 * window.BX_LATENCY_TEST.lastResults). feature-region.js PATCHE donc aussi
 * l'implémentation du test latence en 2 points minimaux :
 *   1. results.push(...) → + key: name (la clé de région, pour poser la pref)
 *   2. fin de run() → window.BX_LATENCY_TEST.lastResults = results + refresh
 *      du bouton (le bouton s'active en direct après chaque test, sans
 *      rouvrir les settings)
 * Les ancres de ces 2 patches sont extraites de src/features/latency.js
 * (pas en dur) → si le test latence dérive, le gate devient ROUGE au lieu de
 * patcher à l'aveugle.
 *
 * Usage :
 *   node bench/feature-region.js <bundle.js> [--dry-run] [--self-test]
 */
"use strict";
const fs = require("fs");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const DRY_RUN = args.includes("--dry-run");
const SELF_TEST = args.includes("--self-test");

if (!file) {
  console.error("usage: node bench/feature-region.js <bundle.js> [--dry-run] [--self-test]");
  process.exit(1);
}

// ---- IMPL latence réutilisé depuis src/features/latency.js (source unique ;
// avant : lecture regex du source de feature-latency.js — couplage fragile) ----
const { IMPL: IMPL_LATENCY } = require("../src/features/latency");
if (!IMPL_LATENCY) {
  console.error("❌ GATE : IMPL latence vide depuis src/features/latency.js");
  process.exit(1);
}
const { IMPL, ANCHOR_BX, ANCHOR_ITEM, ANCHOR_PUSH, ANCHOR_DONE } = require("../src/features/region");

if (!IMPL_LATENCY.includes(ANCHOR_PUSH) || !IMPL_LATENCY.includes(ANCHOR_DONE)) {
  console.error("❌ GATE : ancres du test latence introuvables dans src/features/latency.js (implémentation modifiée ?)");
  process.exit(1);
}

// ---- Implémentation injectée (portée du bundle : CE / getGlobalPref /
// setGlobalPref / window accessibles) ----


let s = fs.readFileSync(file, "utf8");
const original = s;
const results = [];

// Idempotence : déjà injecté → no-op exit 0.
if (s.includes("window.BX_REGION_APPLY")) {
  console.log("== feature-region " + file + " : déjà injectée — no-op");
  process.exit(0);
}




function count(hay, needle) { return hay.split(needle).length - 1; }

// 1. Implémentation (après BX_EXPOSED — même ancre que les autres features)
const n1 = count(s, ANCHOR_BX);
if (n1 !== 1) {
  results.push({ ok: false, name: "ancre BX_EXPOSED", found: n1, expected: 1 });
} else {
  s = s.replace(ANCHOR_BX, ANCHOR_BX + IMPL);
  results.push({ ok: true, name: "implémentation BX_REGION_APPLY injectée", found: 1 });
}

// 2. Patch du test latence — la clé de région dans les résultats (pour poser
//    la pref server.region sans l'emoji drapeau de shortName)
const n2 = count(s, ANCHOR_PUSH);
if (n2 !== 1) {
  results.push({ ok: false, name: "patch latence — results.push (key)", found: n2, expected: 1 });
} else {
  s = s.replace(ANCHOR_PUSH, "results.push({code: r.shortName || r.name || name, label: r.displayName || name, ms: ms, isDefault: !!r.isDefault, key: name});");
  results.push({ ok: true, name: "latence : key de région ajoutée aux résultats", found: 1 });
}

// 3. Patch du test latence — mémorise les résultats + refresh du bouton
const n3 = count(s, ANCHOR_DONE);
if (n3 !== 1) {
  results.push({ ok: false, name: "patch latence — fin de run (lastResults)", found: n3, expected: 1 });
} else {
  s = s.replace(ANCHOR_DONE, "window.BX_LATENCY_TEST.lastResults = results;window.BX_REGION_APPLY && window.BX_REGION_APPLY.refresh && window.BX_REGION_APPLY.refresh();" + ANCHOR_DONE);
  results.push({ ok: true, name: "latence : lastResults mémorisés + refresh bouton", found: 1 });
}

// 4. Bouton dans le groupe SERVER, juste après le test latence
const n4 = count(s, ANCHOR_ITEM);
if (n4 !== 1) {
  results.push({ ok: false, name: "item latence (groupe SERVER)", found: n4, expected: 1 });
} else {
  s = s.replace(ANCHOR_ITEM, ",($parent) => {window.BX_LATENCY_TEST.render($parent);},($parent) => {window.BX_REGION_APPLY.render($parent);}]}");
  results.push({ ok: true, name: "bouton Appliquer la meilleure région ajouté au groupe SERVER", found: 1 });
}

// Rapport
const fails = results.filter((r) => !r.ok);
console.log("== feature-region " + file + " ==");
for (const r of results) {
  console.log((r.ok ? "  ✓ " : "  ✗ ") + r.name + (r.found !== undefined ? " ×" + r.found : ""));
}
if (fails.length) {
  console.error("\n❌ GATE ROUGE : " + fails.length + " ancre(s) dérivée(s) — la feature ne s'injecte pas");
  process.exit(1);
}

// Syntaxe de l'ensemble
try {
  new Function(s.slice(s.indexOf("// ==UserScript=="))); // ne compile pas le header, on teste la syntaxe
} catch (e) {
  console.error("\n❌ GATE ROUGE : syntaxe invalide après injection — " + e.message);
  process.exit(1);
}

if (!DRY_RUN) {
  fs.writeFileSync(file, s);
  console.log("\nOK : " + file + " écrit (" + s.length + " o)");
} else {
  console.log("\n(dry-run — rien écrit)");
}

// --self-test : rejoue le chemin d'échec sur une copie corrompue (contenu
// PRÉ-injection — sinon l'idempotence sort en no-op exit 0)
if (SELF_TEST) {
  let bad = original.replace(ANCHOR_PUSH, "results.push({code: r.shortName_CHANGED || r.name || name, label: r.displayName || name, ms: ms, isDefault: !!r.isDefault});");
  const exitCode = (() => {
    try {
      const child = require("child_process");
      const tmp = file + ".selftest.js";
      fs.writeFileSync(tmp, bad);
      const r = child.spawnSync(process.execPath, [__filename, tmp], { encoding: "utf8" });
      fs.unlinkSync(tmp);
      return r.status;
    } catch (e) { return -1; }
  })();
  if (exitCode === 1) {
    console.log("\nSELF-TEST OK : ancre corrompue → GATE ROUGE (exit 1)");
    process.exit(0);
  }
  console.error("\n❌ SELF-TEST FAIL : exit attendu 1, obtenu " + exitCode);
  process.exit(1);
}
