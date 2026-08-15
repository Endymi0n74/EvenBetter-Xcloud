#!/usr/bin/env node
/**
 * Formate la sortie brute du protocole figé (produite par bench/freeze.sh)
 * en tableaux markdown prêts à coller dans le README (chapitre Benchmarks).
 *
 * Lit le dossier de runs (argument 1) : hotloops-<seed>.txt (un par seed),
 * parse-<seed>.txt (un par seed), page-eval.txt (optionnel).
 *
 * Agrégation (règle figée) : chaque run imprime médiane/min/max sur les
 * passes ; le formateur prend la **médiane des médianes** sur les seeds et la
 * **plage min–max inter-seeds**. Les labels de gain sont curés par scénario
 * (comme dans le README — ex. updateFrame « équivalent (voir note) » car le
 * gain réel est côté driver GPU) : les nombres, eux, viennent du protocole.
 *
 * Usage : node bench/freeze-format.js <dir-runs> <passes> <seeds> <with-page-eval> <build-label>
 */
"use strict";

const fs = require("fs");
const path = require("path");

const [dir, , seedsArg, withPageEvalArg, buildLabel = "courant"] = process.argv.slice(2);
const SEEDS = seedsArg.split(/\s+/);
const WITH_PAGE_EVAL = withPageEvalArg === "1";

// ---------- helpers ----------
const read = (name) => fs.readFileSync(path.join(dir, name), "utf-8");

// médiane des médianes + plage inter-seeds (les `meds` = médianes par seed)
function aggMeds(meds) {
  const s = [...meds].sort((a, b) => a - b);
  return { med: s[Math.floor(s.length / 2)], range: [s[0], s[s.length - 1]] };
}

// nombre < 100 → 1 décimale (virgule), sinon entier — style des tables README
function fmtMed(n) {
  return (n < 100 ? (Math.round(n * 10) / 10).toFixed(1) : String(Math.round(n))).replace(".", ",");
}
function fmtInt(n) {
  return String(Math.round(n));
}
function fmtRange(r) {
  return `${fmtInt(r[0])}–${fmtInt(r[1])}`;
}
function fmtPct(p) {
  return (Math.round(p * 10) / 10).toFixed(1).replace(".", ",");
}

// ---------- parsing hotloops ----------
const HOTLOOP_SECTIONS = {
  controller: ["IDLE", "ACTIF"],
  poll: ["commun", "relâchement"],
  updateFrame: ["updateFrame"],
  updateCanvas: ["updateCanvas"],
};
const KNOWN_SCENARIOS = ["IDLE", "ACTIF", "commun", "relâchement"];

function parseHotloops(text) {
  // out[scenario][version] = { med, min, max }
  const out = {};
  let section = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("=== Hot loop 60 Hz : controller_customization_default")) { section = "controller"; continue; }
    if (line.startsWith("=== Hot loop : poll_gamepad_default")) { section = "poll"; continue; }
    if (line.startsWith("=== WebGL2Player.updateFrame")) { section = "updateFrame"; continue; }
    if (line.startsWith("=== WebGL2Player.updateCanvas")) { section = "updateCanvas"; continue; }
    const m = line.match(/^(perf10|build)\s*:\s*(.*)$/);
    if (!m || !section) continue;
    const version = m[1];
    m[2].split("|").map((s) => s.trim()).forEach((seg, i) => {
      // nom multi-mots possible (« relâchement Home ») → capture lazy avant « med »
      const sm = seg.match(/^(.*?)med ([0-9.]+) ns\/(?:poll|frame) \(min ([0-9.]+), max ([0-9.]+)\)/);
      if (!sm) return;
      const name = sm[1].trim();
      const scenario = KNOWN_SCENARIOS.includes(name)
        ? name
        : HOTLOOP_SECTIONS[section][i] || HOTLOOP_SECTIONS[section][0];
      (out[scenario] ||= {})[version] = { med: +sm[2], min: +sm[3], max: +sm[4] };
    });
  }
  return out;
}

function aggHotloops(perSeed) {
  // byScenario[scenario][version] = { meds: [...] }
  const byScenario = {};
  for (const seed of SEEDS) {
    const data = perSeed[seed];
    if (!data) continue;
    for (const [sc, versions] of Object.entries(data)) {
      for (const [version, v] of Object.entries(versions)) {
        (byScenario[sc] ||= {})[version] ||= { meds: [] };
        byScenario[sc][version].meds.push(v.med);
      }
    }
  }
  const res = {};
  for (const [sc, versions] of Object.entries(byScenario)) {
    res[sc] = {};
    for (const [version, { meds }] of Object.entries(versions)) {
      res[sc][version] = aggMeds(meds);
    }
  }
  return res;
}

// ---------- parsing parse / page-eval ----------
function parseMetricLines(text, re) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(re);
    if (m) out[m[1]] = m.slice(2).map(Number);
  }
  return out;
}

// ---------- table Hot loops ----------
const ROW_ORDER = ["IDLE", "ACTIF", "commun", "relâchement", "updateFrame", "updateCanvas"];
const ROW_LABELS = {
  IDLE: "Controller customization — **IDLE** (aucun input, sticks centrés)",
  ACTIF: "Controller customization — ACTIF (bouton + stick)",
  commun: "`poll_gamepad_default` — chemin commun (Home jamais pressé)",
  "relâchement": "`poll_gamepad_default` — relâchement du bouton Home",
  updateFrame: "`WebGL2Player.updateFrame` — chemin stable (coût JS seul)",
  updateCanvas: "`WebGL2Player.updateCanvas` — valeurs inchangées (chemin 60 Hz, coût JS seul)",
};
// « computed » = gain calculé à partir des mesures ; les autres labels sont
// curés (mêmes jugements que le README)
const GAIN_CURATED = {
  IDLE: "computed",
  ACTIF: "équivalent",
  commun: "identique",
  "relâchement": "computed",
  updateFrame: "équivalent (voir note)",
  updateCanvas: "computed",
};
const UNIT = { updateFrame: "frame", updateCanvas: "frame", commun: "poll", IDLE: "poll", ACTIF: "poll", "relâchement": "poll" };

function hotloopsTable(data) {
  const rows = ROW_ORDER.map((sc) => {
    const p10 = data[sc]?.perf10;
    const build = data[sc]?.build;
    if (!p10 || !build) return null;
    const unit = UNIT[sc];
    const ratio = p10.med / build.med;
    const pct = (1 - build.med / p10.med) * 100;
    const gainKind = GAIN_CURATED[sc];

    let gain;
    if (gainKind === "computed") {
      gain = pct >= 40
        ? `**-${fmtPct(pct)} % (×${fmtMed(ratio)})**`
        : pct >= 10
          ? `~-${fmtPct(pct)} %`
          : pct <= -10
            ? `~+${fmtPct(-pct)} %`
            : "équivalent";
    } else {
      gain = gainKind;
    }

    const buildCell = `~${fmtMed(build.med)} ns/${unit} (${fmtRange(build.range)})`;
    return [
      ROW_LABELS[sc],
      `~${fmtMed(p10.med)} ns/${unit} (${fmtRange(p10.range)})`,
      gainKind === "computed" ? `**${buildCell}**` : buildCell,
      gain,
    ];
  }).filter(Boolean);

  const header = [
    "| Hot loop | perf10 | v" + buildLabel + " | Gain |",
    "|---|---|---|---|",
  ];
  return [...header, ...rows.map((r) => "| " + r.join(" | ") + " |")].join("\n");
}

// ---------- table Chargement ----------
function parseTable(perSeed) {
  const byVersion = {};
  for (const seed of SEEDS) {
    const data = perSeed[seed];
    if (!data) continue;
    for (const [version, [med, min, max]] of Object.entries(data)) {
      (byVersion[version] ||= { meds: [], mins: [], maxs: [] }).meds.push(med);
      byVersion[version].mins.push(min);
      byVersion[version].maxs.push(max);
    }
  }
  const res = {};
  for (const [version, v] of Object.entries(byVersion)) {
    res[version] = {
      med: aggMeds(v.meds),
      min: Math.min(...v.mins),
      max: Math.max(...v.maxs),
    };
  }
  return res;
}

function fmtMs(n) {
  return (Math.round(n * 100) / 100).toFixed(2).replace(".", ",");
}

function parseRow(perSeed, seedCount) {
  const data = parseTable(perSeed);
  const p10 = data.perf10, build = data.build;
  if (!p10 || !build) return null;
  const p10Cell = `~${fmtMs(p10.med.range[0])}–${fmtMs(p10.med.range[1])} ms`;
  const buildCell = `~${fmtMs(build.med.range[0])}–${fmtMs(build.med.range[1])} ms`;
  const overlap = p10.med.range[0] <= build.med.range[1] && build.med.range[0] <= p10.med.range[1];
  const delta = overlap
    ? "non mesurable : ≈ ±10–20 % run à run (bruit sub-ms)"
    : `~${fmtPct(Math.abs((1 - build.med.med / p10.med.med) * 100))} %`;
  return `| Parse/compile (Node \`new Function\`, ×300/passe, protocole stabilisé : médiane de 3 passes × ${seedCount} seed${seedCount > 1 ? "s" : ""}) | ${p10Cell} | ${buildCell} | ${delta} |`;
}

function pageEvalRow() {
  const file = path.join(dir, "page-eval.txt");
  if (!WITH_PAGE_EVAL || !fs.existsSync(file)) return null;
  const data = parseMetricLines(read("page-eval.txt"), /^(perf10|build)\s*:\s*médiane ([0-9.]+) ms \| p95 ([0-9.]+) ms \| min ([0-9.]+) ms/);
  const p10 = data.perf10, build = data.build;
  if (!p10 || !build) return null;
  const [p10Med, , p10Min] = p10;
  const [bMed, , bMin] = build;
  const pct = (1 - bMed / p10Med) * 100;
  return `| Éval complète de page (Edge headless, injection \`document-start\`, 20 runs, médiane) | ~${fmtInt(p10Med)} ms (min ${fmtInt(p10Min)}) | ~${fmtInt(bMed)} ms (min ${fmtInt(bMin)}) | ~${fmtPct(pct)} % |`;
}

// ---------- exécution ----------
const perSeedHotloops = {};
const perSeedParse = {};
for (const seed of SEEDS) {
  const hFile = path.join(dir, `hotloops-${seed}.txt`);
  const pFile = path.join(dir, `parse-${seed}.txt`);
  if (fs.existsSync(hFile)) perSeedHotloops[seed] = parseHotloops(read(`hotloops-${seed}.txt`));
  if (fs.existsSync(pFile)) perSeedParse[seed] = parseMetricLines(
    read(`parse-${seed}.txt`),
    /^(perf10|build)\s*:\s*médiane ([0-9.]+) ms \(min ([0-9.]+), max ([0-9.]+)\)/
  );
}

function hotloopsSection() {
  return [
    "### Hot loops (~60 Hz)",
    "",
    `Protocole figé — seeds ${SEEDS.join(" / ")} × 3 passes × 200 000 itérations ; chaque cellule = médiane des médianes, plage = min–max inter-seeds. Les absolus varient ~±10–30 % run à run, les ratios sont stables.`,
    "",
    hotloopsTable(aggHotloops(perSeedHotloops)),
  ].join("\n");
}

function chargementSection() {
  const rows = [
    "### Chargement (parse + éval de page)",
    "",
    "| Mesure | perf10 | v" + buildLabel + " | Δ |",
    "|---|---|---|---|",
    parseRow(perSeedParse, SEEDS.length) || "| Parse/compile | n/a | n/a | n/a |",
  ];
  const pageEval = pageEvalRow();
  if (pageEval) rows.push(pageEval);
  return rows.join("\n");
}

// ---------- mode --update-readme : régénère les sections du README en place ----------
const updArg = process.argv.find((a) => a.startsWith("--update-readme"));
if (updArg) {
  const readmePath = updArg.includes("=") ? updArg.split("=").slice(1).join("=") : "README.md";
  let content = fs.readFileSync(readmePath, "utf-8");

  // ancres tolérantes LF/CRLF (le README de travail est CRLF sous Windows)
  const blank = "\r?\n\r?\n";
  const hl = hotloopsSection();
  const hlRe = new RegExp(`### Hot loops \\(~60 Hz\\)[\\s\\S]*?${blank}Notes :`);
  if (!hlRe.test(content)) {
    console.error(`Ancre « Notes : » introuvable dans ${readmePath} — mise à jour annulée.`);
    process.exit(1);
  }
  content = content.replace(hlRe, hl + "\n\nNotes :");

  const cg = chargementSection();
  const cgRe = new RegExp(`### Chargement \\(parse \\+ éval de page\\)[\\s\\S]*?${blank}La série perf11`);
  if (!cgRe.test(content)) {
    console.error(`Ancre « La série perf11 » introuvable dans ${readmePath} — mise à jour annulée.`);
    process.exit(1);
  }
  content = content.replace(cgRe, cg + "\n\nLa série perf11");

  // cohérence des fins de ligne (le fichier de travail est CRLF)
  fs.writeFileSync(readmePath, content.replace(/\r?\n/g, "\r\n"));
  console.log(`README mis à jour (${readmePath}) : sections « Hot loops » et « Chargement » régénérées (v${buildLabel}).`);
  console.log("Sections générées :");
  console.log();
  console.log(hl);
  console.log();
  console.log(cg);
  process.exit(0);
}

// ---------- mode console (sortie à coller) ----------
console.log(hotloopsSection());
console.log();
console.log(chargementSection());
console.log();
console.log("> Note : les labels de gain des lignes ACTIF/commun/updateFrame sont curés (mêmes jugements que le README — ex. updateFrame « équivalent » car le gain réel est côté driver GPU) ; les nombres viennent du protocole.");
