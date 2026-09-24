#!/usr/bin/env node
/*
 * fix-settings-freeze.js — applique au bundle les paires de
 * src/fixes/settings-freeze.js (source unique du payload) :
 *
 *   1. observateur BxSelectElement : attributeFilter (gel Firefox à
 *      l'ouverture des settings) ;
 *   2. les 2 items audio.volume : `get params()` + onCreated booster (slider
 *      grisé à vie sans booster).
 *
 * Idempotent : une paire déjà appliquée (from absent, to présent ×1) est un
 * no-op ; une paire ni appliquée ni applicable est un GATE ROUGE (jamais de
 * remplacement silencieux à l'aveugle — le bundle serait corrompu sans bruit).
 *
 * Tolérance « fix suivant » : src/fixes/settings-bus.js (v1.13.7) réécrit le
 * CONTENU de deux de ces paires (bus du listener booster, handler du panneau
 * stream). Ces formes-là valent « déjà appliqué » — sinon relancer ce fix après
 * le fix bus sortirait en ROUGE alors que le travail est fait. La stricte vérité
 * du contenu est portée par bench/fix-settings-bus.test.js et
 * bench/settings-bus-audit.js (gate CI).
 *
 * Usage : node bench/fix-settings-freeze.js <bundle.js> [--dry-run] [--self-test]
 */
"use strict";
const fs = require("fs");
const { PAIRS } = require("../src/fixes/settings-freeze");
const { rebusItemText } = require("../src/fixes/settings-bus");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const DRY_RUN = args.includes("--dry-run");
const SELF_TEST = args.includes("--self-test");

if (!file) {
  console.error("usage: node bench/fix-settings-freeze.js <bundle.js> [--dry-run] [--self-test]");
  process.exit(1);
}

const count = (hay, needle) => hay.split(needle).length - 1;

let s = fs.readFileSync(file, "utf8");
const original = s;
const results = [];
let changed = false;

// Formes valant « appliqué » : la forme canonique de la paire, plus la forme
// post-fix-bus quand elle en diffère (cf. tolérance « fix suivant » ci-dessus).
function appliedForms(pair) {
  const alt = rebusItemText(pair.to);
  return alt === pair.to ? [pair.to] : [pair.to, alt];
}

for (const pair of PAIRS) {
  const nFrom = count(s, pair.from);
  const nTo = appliedForms(pair).reduce((n, form) => n + count(s, form), 0);
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

console.log("== fix-settings-freeze " + file + " ==");
for (const r of results) console.log((r.ok ? "  ✓ " : "  ✗ ") + r.name + (r.detail ? " :: " + r.detail : ""));

const fails = results.filter((r) => !r.ok);
if (fails.length) {
  console.error(`\n❌ GATE ROUGE : ${fails.length} paire(s) non conforme(s) — le bundle a dérivé (rebaser la paire)`);
  process.exit(1);
}

// Syntaxe de l'ensemble (le header n'est pas compilé, on teste le corps)
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

// --self-test : rejoue le chemin d'échec (paire non conforme → exit 1)
if (SELF_TEST) {
  let bad = original;
  // On corrompt une forme PRÉSENTE (la corrigée, pas l'originelle : sur un
  // bundle déjà corrigé, `from` n'existe plus). Corruption INSÉRÉE dans le
  // motif (et non concaténée après) : sinon la forme reste un sous-motif de la
  // forme corrompue, l'injecteur la retrouve et sort en 0 — self-test creux.
  // Une forme PRÉSENTE : la corrigée sur un bundle à jour, celle d'origine sur
  // une base amont — les deux mènent au GATE ROUGE (from=0 + aucune forme connue).
  const victim = PAIRS.map((p) => [...appliedForms(p), p.from].find((f) => bad.includes(f))).find(Boolean);
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
