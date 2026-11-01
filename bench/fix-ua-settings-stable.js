#!/usr/bin/env node
/*
 * fix-ua-settings-stable.js — applique au bundle les paires de
 * src/fixes/ua-settings-stable.js (source unique du payload) :
 *
 *   1. T10 : auto-spoof d'User-Agent hors Chromium (gate Chromium-only de
 *      play.xbox.com → « navigateur non pris en charge » sous Firefox) ;
 *   2. T17 : panneau de settings complet hors session (renderFullSettings
 *      n'exige plus isSignedIn, indétectable sur play.xbox.com).
 *
 * Idempotent : paire déjà appliquée (from absent, to présent ×1) = no-op ;
 * paire ni appliquée ni applicable = GATE ROUGE (jamais de remplacement
 * silencieux à l'aveugle).
 *
 * Usage : node bench/fix-ua-settings-stable.js <bundle.js> [--dry-run] [--self-test]
 */
"use strict";
const fs = require("fs");
const { PAIRS } = require("../src/fixes/ua-settings-stable");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const DRY_RUN = args.includes("--dry-run");
const SELF_TEST = args.includes("--self-test");

if (!file) {
  console.error("usage: node bench/fix-ua-settings-stable.js <bundle.js> [--dry-run] [--self-test]");
  process.exit(1);
}

const count = (hay, needle) => hay.split(needle).length - 1;

let s = fs.readFileSync(file, "utf8");
const original = s;
const results = [];
let changed = false;

for (const pair of PAIRS) {
  const nFrom = count(s, pair.from);
  const nTo = count(s, pair.to);
  if (nFrom === 1 && nTo === 0) {
    s = s.replace(pair.from, pair.to);
    results.push({ ok: true, name: pair.name + " — appliqué" });
    changed = true;
  } else if (nFrom === 0 && nTo === 1) {
    results.push({ ok: true, name: pair.name + " — déjà à jour (no-op)" });
  } else {
    results.push({
      ok: false,
      name: pair.name,
      detail: `forme d'origine ×${nFrom} / forme corrigée ×${nTo} (attendu 1/0 ou 0/1)`,
    });
  }
}

console.log("== fix-ua-settings-stable " + file + " ==");
for (const r of results) console.log((r.ok ? "  ✓ " : "  ✗ ") + r.name + (r.detail ? " :: " + r.detail : ""));

const fails = results.filter((r) => !r.ok);
if (fails.length) {
  console.error(`\n❌ GATE ROUGE : ${fails.length} paire(s) non conforme(s) — le bundle a dérivé (rebaser la paire)`);
  process.exit(1);
}

// Syntaxe de l'ensemble (le header userscript n'est pas compilé, on teste le corps)
try {
  new Function(s.slice(s.indexOf("// ==UserScript==")));
} catch (e) {
  console.error("\n❌ GATE ROUGE : syntaxe invalide après correction — " + e.message);
  process.exit(1);
}

if (!changed) {
  console.log("\n(" + file + " déjà corrigé — no-op)");
  process.exit(0);
}
if (!DRY_RUN) {
  fs.writeFileSync(file, s);
  console.log("\nOK : " + file + " écrit (" + s.length + " o)");
} else {
  console.log("\n(dry-run — rien écrit)");
}

// --self-test : rejoue le chemin d'échec (paire corrompue → exit 1)
if (SELF_TEST) {
  let bad = original;
  const victim = PAIRS.map((p) => [p.to, p.from].find((f) => bad.includes(f))).find(Boolean);
  if (victim) bad = bad.replace(victim, victim.slice(0, -1) + "_X" + victim.slice(-1));
  const child = require("child_process");
  const tmp = file + ".selftest.js";
  fs.writeFileSync(tmp, bad);
  const r = child.spawnSync(process.execPath, [__filename, tmp], { encoding: "utf8" });
  fs.unlinkSync(tmp);
  if (r.status === 1) {
    console.log("\nSELF-TEST OK : paire corrompue → GATE ROUGE (exit 1)");
    process.exit(0);
  }
  console.error("\n❌ SELF-TEST FAIL : exit attendu 1, obtenu " + r.status);
  process.exit(1);
}
