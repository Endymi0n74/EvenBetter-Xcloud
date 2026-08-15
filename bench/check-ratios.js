#!/usr/bin/env node
/**
 * CI — vérifie les ratios des hot loops (perf10/build) issus de
 * `bench/run-all.sh --skip-page-eval` contre des seuils.
 *
 * Un ratio = médiane perf10 / médiane build pour chaque scénario. Les
 * scénarios à gain attendu (IDLE, relâchement Home) doivent rester au-dessus
 * d'un plancher ; les scénarios « équivalents » (ACTIF, commun, updateFrame)
 * doivent rester dans une fourchette. Sort avec le code 1 si un ratio régresse
 * au-delà de son seuil (le workflow GitHub Actions échoue alors et signale la
 * régression) ; imprime aussi des annotations `::error::`/`::notice::` quand
 * GITHUB_ACTIONS est défini.
 *
 * Usage : node bench/check-ratios.js <sortie-de-run-all.sh>
 *   bash bench/run-all.sh --skip-page-eval > bench-out.txt
 *   node bench/check-ratios.js bench-out.txt
 */
"use strict";

const fs = require("fs");

const file = process.argv[2];
if (!file) {
  console.error("Usage : node bench/check-ratios.js <bench-out.txt>");
  process.exit(2);
}
const text = fs.readFileSync(file, "utf-8");

// ---------- seuils (ratio perf10/build) ----------
// Planchers larges : les ratios mesurés sont ~7-9,5× (IDLE) et ~7-9×
// (relâchement) ; un ratio < 4 = l'optimisation ne s'applique plus (skip idle
// cassé, structuredClone revenu). Fourchettes larges pour les scénarios
// « équivalents » (bruit CI ~±30 % sur les absolus).
const THRESHOLDS = {
  IDLE: { min: 4.0, max: 20.0 },          // skip idle : attendu ~7-9,5×
  ACTIF: { min: 0.5, max: 2.0 },          // équivalent
  commun: { min: 0.5, max: 2.0 },         // identique
  "relâchement": { min: 4.0, max: 20.0 }, // structuredClone supprimé : attendu ~7-9×
  updateFrame: { min: 0.5, max: 2.0 },    // équivalent (coût JS seul)
};
const ORDER = ["IDLE", "ACTIF", "commun", "relâchement", "updateFrame"];

// ---------- parsing (mêmes regex que freeze-format.js) ----------
const SECTIONS = {
  controller: ["IDLE", "ACTIF"],
  poll: ["commun", "relâchement"],
  updateFrame: ["updateFrame"],
};
const KNOWN = ["IDLE", "ACTIF", "commun", "relâchement"];
const meds = {}; // scénario -> { perf10: ns, build: ns }
let section = null;
for (const line of text.split(/\r?\n/)) {
  if (line.startsWith("=== Hot loop 60 Hz : controller_customization_default")) { section = "controller"; continue; }
  if (line.startsWith("=== Hot loop : poll_gamepad_default")) { section = "poll"; continue; }
  if (line.startsWith("=== WebGL2Player.updateFrame")) { section = "updateFrame"; continue; }
  const m = line.match(/^(perf10|build)\s*:\s*(.*)$/);
  if (!m || !section) continue;
  m[2].split("|").map((s) => s.trim()).forEach((seg, i) => {
    const sm = seg.match(/^(.*?)med ([0-9.]+) ns\/(?:poll|frame) \(min ([0-9.]+), max ([0-9.]+)\)/);
    if (!sm) return;
    const name = sm[1].trim();
    const sc = KNOWN.includes(name) ? name : SECTIONS[section][i] || SECTIONS[section][0];
    (meds[sc] ||= {})[m[1]] = +sm[2];
  });
}

// ---------- vérification ----------
const fmt = (n) => n.toFixed(2).replace(".", ",");
const ann = (level, msg) => {
  const line = process.env.GITHUB_ACTIONS ? `::${level}::${msg}` : `${level.toUpperCase()} : ${msg}`;
  console.log(line);
};

let failures = 0;
console.log("=== Hot loops — vérification des ratios (perf10/build) ===");
for (const sc of ORDER) {
  const data = meds[sc];
  const th = THRESHOLDS[sc];
  if (!data || data.perf10 == null || data.build == null) {
    ann("error", `scénario « ${sc} » introuvable dans la sortie du harnais (run-all.sh a-t-il réussi ?)`);
    failures++;
    continue;
  }
  const ratio = data.perf10 / data.build;
  const ok = ratio >= th.min && ratio <= th.max;
  const ctx = `perf10 ${fmt(data.perf10)} ns / build ${fmt(data.build)} ns → ratio ${fmt(ratio)} [seuil ${fmt(th.min)}–${fmt(th.max)}]`;
  if (ok) {
    console.log(`  ✓ ${sc.padEnd(12)} ${ctx}`);
  } else {
    ann("error", `RÉGRESSION DÉTECTÉE : ${sc} → ratio ${fmt(ratio)} hors seuil ${fmt(th.min)}–${fmt(th.max)} (${ctx})`);
    failures++;
  }
}

console.log();
if (failures === 0) {
  console.log("Résultat : PASS (5/5)");
  process.exit(0);
} else {
  console.log(`Résultat : ÉCHEC (${failures} scénario(s) hors seuil)`);
  process.exit(1);
}
