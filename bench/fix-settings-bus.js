#!/usr/bin/env node
/*
 * fix-settings-bus.js — applique au bundle les paires de
 * src/fixes/settings-bus.js (source unique du payload) :
 *
 *   1. item `audio.volume` du groupe global « Son » : le booster est une pref
 *      GLOBALE, donc livrée sur le bus Script — l'item écoutait Stream ;
 *   2. item `audio.volume` du panneau stream : handler partagé, abonné aux deux
 *      bus (il filtre `audio.volume` ET le booster).
 *
 * ⚠ ORDRE : à lancer APRÈS bench/fix-settings-freeze.js (les deux formes visées
 * sont écrites par ce fix). Inverse → GATE ROUGE explicite, jamais de silence.
 *
 * Idempotent : une paire déjà appliquée (from absent, to présent ×1) est un
 * no-op ; une paire ni appliquée ni applicable est un GATE ROUGE.
 *
 * Usage : node bench/fix-settings-bus.js <bundle.js> [--dry-run] [--self-test]
 */
"use strict";
const fs = require("fs");
const { PAIRS } = require("../src/fixes/settings-bus");
const { PAIRS: FREEZE_PAIRS } = require("../src/fixes/settings-freeze");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const DRY_RUN = args.includes("--dry-run");
const SELF_TEST = args.includes("--self-test");

if (!file) {
  console.error("usage: node bench/fix-settings-bus.js <bundle.js> [--dry-run] [--self-test]");
  process.exit(1);
}

const count = (hay, needle) => hay.split(needle).length - 1;

let s = fs.readFileSync(file, "utf8");
const original = s;

// ---- Garde d'ordre : les fixes du gel/volume figé d'abord ----
const pending = FREEZE_PAIRS.filter((p) => count(s, p.from) > 0);
if (pending.length) {
  console.error("== fix-settings-bus " + file + " ==");
  console.error("❌ ORDRE : " + pending.length + " paire(s) de src/fixes/settings-freeze.js ne sont pas encore appliquées");
  for (const p of pending) console.error("   · " + p.name);
  console.error("   → lancer d'abord : node bench/fix-settings-freeze.js " + file);
  process.exit(1);
}

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
    results.push({ ok: false, name: pair.name, detail: "forme d'origine ×" + nFrom + " / forme corrigée ×" + nTo + " (attendu 1/0 ou 0/1)" });
  }
}

console.log("== fix-settings-bus " + file + " ==");
for (const r of results) console.log((r.ok ? "  ✓ " : "  ✗ ") + r.name + (r.detail ? " :: " + r.detail : ""));

const fails = results.filter((r) => !r.ok);
if (fails.length) {
  console.error("\n❌ GATE ROUGE : " + fails.length + " paire(s) non conforme(s) — le bundle a dérivé (rebaser la paire)");
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

// --self-test : rejoue le chemin d'échec (paire corrompue → exit 1). Corruption
// INSÉRÉE dans le motif : concaténer après laisserait la forme d'origine en
// sous-motif, l'injecteur la retrouverait et sortirait en 0 (self-test creux).
if (SELF_TEST) {
  let bad = original;
  const first = PAIRS.find((p) => bad.includes(p.from));
  if (first) bad = bad.replace(first.from, first.from.slice(0, -1) + "_X" + first.from.slice(-1));
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
