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
 *
 * Variante startup seul : `--startup-only` — parse la sortie de
 *   `page-eval.js --cold` (éval à froid, navigateur neuf par run) et vérifie
 *   la borne de startup du build (~30 ms mesuré ; échec > 50 ms = coût
 *   one-shot revenu au chargement).
 *   node bench/check-ratios.js cold-eval.txt --startup-only --markdown=startup-summary.md
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
const STARTUP_ONLY = process.argv.includes("--startup-only");
// compteurs structurel (updateCanvas) et startup — déclarés ici pour être
// visibles dans le markdown même en mode --startup-only (le bloc hotloops
// est sauté, pas exécuté)
let structuralFail = 0;
let startupFail = 0;

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
const mm = {}; // scénario -> { perf10: {med,min,max}, build: {med,min,max} } (ligne de session)
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
    (mm[sc] ||= {})[m[1]] = { med: +sm[2], min: +sm[3], max: +sm[4] };
  });
}

// ---------- startup : éval page (bornes ~30 ms / 550-660 ms) ----------
// Bornes stables mesurées (Windows/Edge, protocole froid = navigateur neuf
// par run, 4 sessions) : build v1.7.0 ~30 ms (max observé 44,4) ; perf10
// ~550-660 ms (531-778). Le build ne doit pas régresser : un coût one-shot
// revenu au chargement (getCapabilities & co) = 100+ ms. perf10 est la
// baseline fixe : hors [300,1200] ms = dérive d'environnement (machine/
// browser), signalée en notice, pas en échec.
// Bornes overridables par env (STARTUP_BUILD_MAX_MS / STARTUP_P10_MIN_MS /
// STARTUP_P10_MAX_MS) : le job fork (ubuntu-latest) n'a PAS le one-shot RTC
// Windows (~550-660 ms d'énumération de codecs) — sous Linux perf10 ≈ build
// (~40 ms) et la bande par défaut n'a pas de sens → bande dédiée via env.
const STARTUP_BUILD_MAX_MS = process.env.STARTUP_BUILD_MAX_MS ? +process.env.STARTUP_BUILD_MAX_MS : 50;
const STARTUP_P10_MIN_MS = process.env.STARTUP_P10_MIN_MS ? +process.env.STARTUP_P10_MIN_MS : 300;
const STARTUP_P10_MAX_MS = process.env.STARTUP_P10_MAX_MS ? +process.env.STARTUP_P10_MAX_MS : 1200;
const startup = { present: false, cold: false, perf10: null, build: null };
for (const line of text.split(/\r?\n/)) {
  if (line.startsWith("=== Éval complète de page")) {
    startup.present = true;
    startup.cold = line.includes("à froid");
    continue;
  }
  const m = line.match(/^(perf10|build)\s*:\s*médiane ([0-9.]+) ms \| p95 ([0-9.]+) ms \| min ([0-9.]+) ms(?: \| max ([0-9.]+) ms)?/);
  if (!m) continue;
  startup[m[1]] = { med: +m[2], p95: +m[3], min: +m[4], max: m[5] ? +m[5] : null };
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
if (!STARTUP_ONLY) {
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

// ---------- ligne de session (tableau « Sessions hot loops » du README) ----------
// État dérivé du ratio IDLE perf10/build (mêmes seuils que le README) :
// bas ≥ ~10 (machine calme), haut ≤ ~9,5 (coût fixe d’environnement qui
// écrase l’avantage), transitionnel entre les deux. Date : capture d’état
// machine du job (bench/state-cpu-ci.before.json, écrite par le workflow),
// repli sur la date courante si absente.
const idle = mm.IDLE || {};
const rel = mm["relâchement"] || {};
const p10Idle = idle.perf10, bIdle = idle.build;
const p10Rel = rel.perf10, bRel = rel.build;
const ratioIdle = p10Idle && bIdle ? p10Idle.med / bIdle.med : null;
const etat = ratioIdle == null ? "n/a" : ratioIdle >= 10 ? "bas" : ratioIdle <= 9.5 ? "haut" : "transitionnel";
const sessionLabelArg = (process.argv.find((a) => a.startsWith("--session-label=")) || "").split("=").slice(1).join("=").trim();
const stCandidates = ["bench/state-cpu-ci.before.json", "state-cpu-ci.before.json", "bench/state-cpu-s42.before.json"];
let sessionDate = "";
let stateCtx = null;
for (const sf of stCandidates) {
  if (!fs.existsSync(sf)) continue;
  try {
    const st = JSON.parse(fs.readFileSync(sf, "utf8"));
    if (st.iso && !sessionDate) sessionDate = st.iso.slice(0, 10);
    if (!stateCtx) {
      const parts = [];
      if (st.gpu) parts.push("GPU " + st.gpu.tempC + " °C · util " + st.gpu.utilPct + " % · SM " + st.gpu.smClockMhz + " MHz");
      if (st.cpu) parts.push("CPU load " + st.cpu.loadPct + " %");
      if (parts.length) stateCtx = parts.join(" | ");
    }
  } catch (e) { /* état illisible → candidat suivant */ }
}
if (!sessionDate) sessionDate = new Date().toISOString().slice(0, 10);
const sessionLabel = sessionLabelArg || ("CI " + sessionDate + " (hotloops)");
const idleCell = (x) => (x ? (fmt(x.med) + " (" + fmt(x.min) + "–" + fmt(x.max) + ")") : "n/a");
const relCell = (x) => (x ? fmt(x.med) : "n/a");
const relPct = p10Rel && bRel && p10Rel.med > 0 ? (100 * (p10Rel.med - bRel.med) / p10Rel.med).toFixed(0) : null;
const readmeSessionLine =
  "| " + sessionLabel + " | " + idleCell(p10Idle) + " | " + idleCell(bIdle) + " | " + (ratioIdle != null ? "**×" + fmt(ratioIdle) + "**" : "n/a") + " | " + etat + " | " + relCell(p10Rel) + " → " + relCell(bRel) + (relPct != null ? " (−" + relPct + " %)" : "") + " |";
console.log("Session " + sessionDate + " : ratio IDLE ×" + (ratioIdle != null ? fmt(ratioIdle) : "n/a") + ", état " + etat);

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
  const totalFail = failures + structuralFail + startupFail;
  const verdict = totalFail === 0 ? "✅ PASS (6/6)" : `❌ ÉCHEC (${totalFail} vérification(s) en échec)`;
  lines.push("", "**Session — ligne prête à insérer dans le tableau « Sessions hot loops » de bench/README.md :**");
  lines.push("", "| Session | perf10 IDLE (ns/poll) | build IDLE (ns/poll) | Ratio IDLE | État | Relâchement Home (perf10 → build) |");
  lines.push("|---|---|---|---|---|---|");
  lines.push(readmeSessionLine);
  if (stateCtx) lines.push("", `_État machine au début du bench : ${stateCtx}._`);
  lines.push("", `**Résultat : ${verdict}**`);
  if (structuralFail > 0) {
    lines.push("", "_Vérification structurelle updateCanvas (compteurs `gl.uniform1f` : build ≤ 20, perf10 ≥ 1000) en échec._");
  }
  if (startup.present) {
    const b = startup.build;
    const bOk = b ? b.med <= STARTUP_BUILD_MAX_MS : false;
    const sCell = b ? `${b.med.toFixed(1)} ms` : "n/a";
    lines.push("", `**Startup (éval page) : build ${sCell} (borne ≤ ${STARTUP_BUILD_MAX_MS} ms, ~30 ms attendu) — ${bOk ? "✅" : "❌"}**`);
  }
  lines.push("", "_Régression = ratio perf10/build hors seuil (plancher ×4 pour IDLE/relâchement, ×12 pour updateCanvas avec le flag dirty v1.6.0, fourchette 0,5–2,0 pour les scénarios équivalents) ou compteurs GL anormaux. Sortie complète du harnais dans l'artefact `bench-out.txt` du workflow._");
  fs.writeFileSync(markdownFile, lines.join("\n") + "\n");
  console.log(`Résumé markdown écrit : ${markdownFile}`);
}
}

// ---------- vérification startup ----------
console.log("=== Startup — vérification de l’éval page (perf10/build) ===");
if (!startup.present) {
  console.log("  startup non mesuré (pas d'éval page dans la sortie — Playwright absent ?) : ignoré");
} else {
  console.log(`  mode : ${startup.cold ? "à froid (navigateur neuf par run)" : "warm (process partagé)"}`);
  for (const k of ["perf10", "build"]) {
    if (!startup[k]) {
      ann("error", `startup : ligne « ${k} » manquante dans l’éval page`);
      startupFail++;
      continue;
    }
    const s = startup[k];
    const range = s.max != null ? `${s.min.toFixed(1)}–${s.max.toFixed(1)}` : `${s.min.toFixed(1)}`;
    console.log(`  ${k.padEnd(7)} médiane ${s.med.toFixed(1)} ms (${range})`);
  }
  const b = startup.build;
  if (b && b.med > STARTUP_BUILD_MAX_MS) {
    ann("error", `RÉGRESSION DÉTECTÉE : startup build ${b.med.toFixed(1)} ms > ${STARTUP_BUILD_MAX_MS} ms (attendu ~30 ms — un coût one-shot est revenu au chargement ?)`);
    startupFail++;
  } else if (b) {
    console.log(`  ✓ build ${b.med.toFixed(1)} ms ≤ ${STARTUP_BUILD_MAX_MS} ms (borne ~30 ms)`);
  }
  if (startup.cold && startup.perf10) {
    const p = startup.perf10.med;
    if (p < STARTUP_P10_MIN_MS || p > STARTUP_P10_MAX_MS) {
      ann("notice", `startup perf10 ${p.toFixed(1)} ms hors [${STARTUP_P10_MIN_MS}, ${STARTUP_P10_MAX_MS}] ms — dérive d’environnement (machine/browser), pas un échec du build`);
    } else {
      console.log(`  perf10 ${p.toFixed(1)} ms dans [${STARTUP_P10_MIN_MS}, ${STARTUP_P10_MAX_MS}] ms (environnement nominal)`);
    }
  }
  if (STARTUP_ONLY && markdownFile) {
    const p = startup.perf10, b = startup.build;
    const delta = p && b && p.med > 0 ? ((b.med / p.med - 1) * 100).toFixed(1) : null;
    const lines = [
      "### Startup — éval page à froid (bornes CI)",
      "",
      "| Version | Éval (ms) | Borne | Statut |",
      "|---|---|---|---|",
    ];
    const pCell = p ? `${p.med.toFixed(1)} (${p.min.toFixed(1)}–${(p.max ?? p.p95).toFixed(1)})` : "n/a";
    const pOk = p ? p.med >= STARTUP_P10_MIN_MS && p.med <= STARTUP_P10_MAX_MS : false;
    lines.push(`| perf10 | ${pCell} | [${STARTUP_P10_MIN_MS}, ${STARTUP_P10_MAX_MS}] (environnement) | ${pOk ? "✅" : "⚠️"} |`);
    if (b) {
      const bOk = b.med <= STARTUP_BUILD_MAX_MS;
      lines.push(`| build | ${b.med.toFixed(1)} (${b.min.toFixed(1)}–${(b.max ?? b.p95).toFixed(1)}) | ≤ ${STARTUP_BUILD_MAX_MS} ms (~30 ms attendu) | ${bOk ? "✅" : "❌"} |`);
    }
    lines.push("", `**Résultat : ${startupFail === 0 ? "✅ PASS" : `❌ ÉCHEC (${startupFail} vérification(s) en échec)`}**`);
    if (delta != null) lines.push("", `_Écart perf10/build : ${delta} % (négatif = build plus rapide)._`);
    lines.push("", "_Régression = build > 50 ms (un coût one-shot est revenu au chargement). Sortie complète dans l’artefact `cold-eval.txt` du workflow._");
    fs.writeFileSync(markdownFile, lines.join("\n") + "\n");
    console.log(`Résumé markdown startup écrit : ${markdownFile}`);
  }
}

console.log();
const totalFail = failures + structuralFail + startupFail;
if (totalFail === 0) {
  console.log("Résultat : PASS (6/6)");
  process.exit(0);
} else {
  console.log(`Résultat : ÉCHEC (${totalFail} vérification(s) en échec)`);
  process.exit(1);
}
