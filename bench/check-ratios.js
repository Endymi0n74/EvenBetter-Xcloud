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
 * régression) ; imprime des annotations `::error::`/`::notice::` quand
 * GITHUB_ACTIONS est défini.
 *
 * `--markdown=<fichier>` : écrit aussi le résumé en tableau markdown (pour le
 * commentaire automatique de PR) — écrit même en cas d'échec, avant l'exit.
 *
 * Usage : node bench/check-ratios.js <sortie-de-run-all.sh> [--markdown=out.md]
 *   bash bench/run-all.sh --skip-page-eval > bench-out.txt
 *   node bench/check-ratios.js bench-out.txt --markdown=bench-summary.md
 */
"use strict";

const fs = require("fs");
const path = require("path");

const file = process.argv[2];
if (!file) {
  console.error("Usage : node bench/check-ratios.js <bench-out.txt> [--markdown=out.md]");
  process.exit(2);
}
const markdownArg = process.argv.find((a) => a.startsWith("--markdown="));
const markdownFile = markdownArg ? markdownArg.split("=").slice(1).join("=") : null;
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
  updateCanvas: { min: 12.0, max: 100.0 }, // v1.6.0 flag dirty : attendu ~15-25× (le plancher ~13 ns du harnais domine ; 1 lecture + branche vs 7 gl.uniform*)
};
const ORDER = ["IDLE", "ACTIF", "commun", "relâchement", "updateFrame", "updateCanvas"];

// ---------- parsing (mêmes regex que freeze-format.js) ----------
const SECTIONS = {
  controller: ["IDLE", "ACTIF"],
  poll: ["commun", "relâchement"],
  updateFrame: ["updateFrame"],
  updateCanvas: ["updateCanvas"],
};
const KNOWN = ["IDLE", "ACTIF", "commun", "relâchement"];
const meds = {}; // scénario -> { perf10: ns, build: ns }
let section = null;
for (const line of text.split(/\r?\n/)) {
  if (line.startsWith("=== Hot loop 60 Hz : controller_customization_default")) { section = "controller"; continue; }
  if (line.startsWith("=== Hot loop : poll_gamepad_default")) { section = "poll"; continue; }
  if (line.startsWith("=== WebGL2Player.updateFrame")) { section = "updateFrame"; continue; }
  if (line.startsWith("=== WebGL2Player.updateCanvas")) { section = "updateCanvas"; continue; }
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
const fmtTh = (th) => (th.max >= 20 ? `≥ ${fmt(th.min)}` : `${fmt(th.min)}–${fmt(th.max)}`);
const ann = (level, msg) => {
  const line = process.env.GITHUB_ACTIONS ? `::${level}::${msg}` : `${level.toUpperCase()} : ${msg}`;
  console.log(line);
};

const rows = []; // { sc, p10, build, ratio, th, ok }
let failures = 0;
console.log("=== Hot loops — vérification des ratios (perf10/build) ===");
for (const sc of ORDER) {
  const data = meds[sc];
  const th = THRESHOLDS[sc];
  if (!data || data.perf10 == null || data.build == null) {
    ann("error", `scénario « ${sc} » introuvable dans la sortie du harnais (run-all.sh a-t-il réussi ?)`);
    rows.push({ sc, p10: null, build: null, ratio: null, th, ok: false });
    failures++;
    continue;
  }
  const ratio = data.perf10 / data.build;
  const ok = ratio >= th.min && ratio <= th.max;
  const ctx = `perf10 ${fmt(data.perf10)} ns / build ${fmt(data.build)} ns → ratio ${fmt(ratio)} [seuil ${fmtTh(th)}]`;
  if (ok) {
    console.log(`  ✓ ${sc.padEnd(12)} ${ctx}`);
  } else {
    ann("error", `RÉGRESSION DÉTECTÉE : ${sc} → ratio ${fmt(ratio)} hors seuil ${fmtTh(th)} (${ctx})`);
    failures++;
  }
  rows.push({ sc, p10: data.perf10, build: data.build, ratio, th, ok });
}

// ---------- vérification structurelle : compteurs gl.uniform* (scénario updateCanvas) ----------
// Le flag dirty (v1.6.0) fait que le build n'émet ses 7 gl.uniform* qu'au warmup
// hors chrono (compteurs ~1/2/4 sur toute la passe) ; perf10 en émet 7 par
// itération (~860k uniform1f). Un retour au cache-comparaison v1.5.0 (22 ns) ou
// à perf10 ferait exploser les compteurs du build — détecté même si le ratio
// temporel reste dans le bruit (équivalent du check « chemin GL » du harnais GPU).
const counts = {}; // version -> nombre d'appels gl.uniform1f de la dernière passe
for (const line of text.split(/\r?\n/)) {
  const m = line.match(/^(perf10|build)\s*:.*uniform1f=(\d+)/);
  if (m) counts[m[1]] = +m[2];
}
let structuralFail = 0;
if (counts.build != null && counts.perf10 != null) {
  if (counts.build > 20) {
    ann("error", `updateCanvas : le build émet encore ${counts.build} gl.uniform1f (attendu ≤ 20 — flag dirty inactif ?)`);
    structuralFail++;
  }
  if (counts.perf10 < 1000) {
    ann("error", `updateCanvas : perf10 n'émet que ${counts.perf10} gl.uniform1f (attendu ≥ 1000 — harnais cassé ?)`);
    structuralFail++;
  }
  if (structuralFail === 0) {
    console.log(`  ✓ updateCanvas  structure : build ${counts.build} / perf10 ${counts.perf10} gl.uniform1f (flag dirty actif)`);
  }
} else {
  ann("error", "updateCanvas : compteurs gl.uniform1f introuvables dans la sortie du harnais");
  structuralFail++;
}

// ---------- résumé markdown (commentaire PR) ----------
if (markdownFile) {
  const lines = [
    "### Bench hot loops — ratios perf10/build (seuils CI)",
    "",
    "| Scénario | perf10 | build | Ratio | Seuil | Statut |",
    "|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    const statut = r.ok ? "✅" : "❌";
    const ratio = r.ratio != null ? fmt(r.ratio) : "n/a";
    const med = r.p10 != null ? `${fmt(r.p10)} ns` : "n/a";
    const bld = r.build != null ? `${fmt(r.build)} ns` : "n/a";
    lines.push(`| ${r.sc} | ${med} | ${bld} | ${ratio} | ${fmtTh(r.th)} | ${statut} |`);
  }
  const totalFail = failures + structuralFail;
  const verdict = totalFail === 0 ? "✅ PASS (6/6)" : `❌ ÉCHEC (${totalFail} vérification(s) en échec)`;
  lines.push("", `**Résultat : ${verdict}**`);
  if (structuralFail > 0) {
    lines.push("", "_Vérification structurelle updateCanvas (compteurs `gl.uniform1f` : build ≤ 20, perf10 ≥ 1000) en échec._");
  }
  lines.push("", "_Régression = ratio perf10/build hors seuil (plancher ×4 pour IDLE/relâchement, ×12 pour updateCanvas avec le flag dirty v1.6.0, fourchette 0,5–2,0 pour les scénarios équivalents) ou compteurs GL anormaux. Sortie complète du harnais dans l'artefact `bench-out.txt` du workflow._");
  fs.writeFileSync(markdownFile, lines.join("\n") + "\n");
  console.log(`Résumé markdown écrit : ${markdownFile}`);
}

console.log();
const totalFail = failures + structuralFail;
if (totalFail === 0) {
  console.log("Résultat : PASS (6/6)");
  process.exit(0);
} else {
  console.log(`Résultat : ÉCHEC (${totalFail} vérification(s) en échec)`);
  process.exit(1);
}
