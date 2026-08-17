// Génère la table markdown « GPU — renderer WebGL2 » depuis les runs
// gpu-runner.js (run-s<seed>.json) et met à jour la section GPU du README du
// fork **en place** — équivalent GPU de bench/freeze.sh --update-readme.
//
// Agrégation : même règle que agg-seeds.js — médiane par seed (sur les 3
// passes du runner) puis médiane des médianes + plage min–max inter-seeds.
// La table seule est régénérée (le bullet « Protocole figé » de la section
// « Lecture des résultats » reste curé — il documente le protocole et les
// sessions, pas seulement des nombres).
//
// Usage :
//   node gpu-runner.js ... --seed=100 > run-s100.json   (× les seeds)
//   node gpu-update-readme.js 100 200 300 400 500 600 [--readme=D:\Codex\better-xcloud-fork\bench\README.md]
//   node gpu-update-readme.js 100 200 300 400 500 600 --print-only
"use strict";

const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const seeds = argv.filter((a) => !a.startsWith("--"));
const PRINT_ONLY = argv.includes("--print-only");
const readmePath = (argv.find((a) => a.startsWith("--readme=")) || "").split("=").slice(1).join("=")
  || path.join(__dirname, "..", "..", "bench", "README.md");

// ---------- lecture des runs ----------
function loadRuns() {
  const perVersion = {};
  let labels = null;
  for (const s of seeds) {
    const file = path.join(__dirname, `run-s${s}.json`);
    if (!fs.existsSync(file)) {
      console.error(`Fichier introuvable : ${file} — lancez d'abord gpu-runner.js avec --seed=${s}`);
      process.exit(1);
    }
    const txt = fs.readFileSync(file, "utf-8");
    const res = JSON.parse(txt.slice(txt.indexOf("{")));
    if (!labels) labels = Object.keys(res.agg);
    for (const name of labels) {
      const a = res.agg[name];
      (perVersion[name] ||= []).push({
        seed: s,
        uploadNs: a.uploadNs,
        wallTotalMs: a.wallTotalAvg,
        gpuMs: a.gpuMed,
        counts: a.countsPerFrame,
      });
    }
  }
  return { perVersion, labels };
}

// ---------- agrégation (médiane des médianes + plage inter-seeds) ----------
function agg(vals) {
  const s = [...vals].sort((a, b) => a - b);
  return {
    med: s[Math.floor(s.length / 2)],
    range: [s[0], s[s.length - 1]],
    raw: s,
  };
}

// ---------- formatage (style des tables README) ----------
const fmt1 = (n) => (Math.round(n * 10) / 10).toFixed(1).replace(".", ",");
const fmtInt = (n) => String(Math.round(n));
const fmt3 = (n) => n.toFixed(3).replace(".", ",");

// ---------- génération de la table ----------
function gpuTable(data) {
  const [p10, nw] = data.labels;
  const a10 = agg(data.perVersion[p10].map((r) => r.uploadNs));
  const aNw = agg(data.perVersion[nw].map((r) => r.uploadNs));
  const w10 = agg(data.perVersion[p10].map((r) => r.wallTotalMs));
  const wNw = agg(data.perVersion[nw].map((r) => r.wallTotalMs));
  const g10 = agg(data.perVersion[p10].map((r) => r.gpuMs));
  const gNw = agg(data.perVersion[nw].map((r) => r.gpuMs));

  const counts10 = data.perVersion[p10][0].counts || {};
  const countsNw = data.perVersion[nw][0].counts || {};
  const gl10 = counts10.texImage2D > 0 ? "`texImage2D`" : "`texSubImage2D`";
  const glNw = countsNw.texSubImage2D > 0 ? "`texSubImage2D`" : "`texImage2D`";

  const upRatio = a10.med / aNw.med;
  const wallRatio = w10.med / wNw.med;
  const drawSame = Math.abs(g10.med - gNw.med) / gNw.med < 0.05;

  return [
    "| Mesure | " + p10 + " | " + nw + " | Δ |",
    "|---|---|---|---|",
    `| Appels GL par frame | ${gl10} + \`drawArrays\` (0 allocation) | ${glNw} + \`drawArrays\` (0 allocation) | même nombre d'appels |`,
    // uploadNs est en ns (runner : (ms/UPLOADS)*1e6) → /1000 pour µs
    `| Upload vidéo — boucle tight (µs/upload) | ~${fmtInt(a10.range[0] / 1000)}–${fmtInt(a10.range[1] / 1000)} µs | ~${fmtInt(aNw.range[0] / 1000)}–${fmtInt(aNw.range[1] / 1000)} µs | **×${fmt1(upRatio)}** |`,
    `| Rasterisation \`drawArrays\` (µs/draw, médiane GPU) | ${fmt1(g10.med * 1000)} µs | ${fmt1(gNw.med * 1000)} µs | ${drawSame ? "identique (même shader)" : `×${fmt1(g10.med / gNw.med)}`} |`,
    `| \`updateFrame\` — wall total (ms/frame, boucle complète / FRAMES) | ~${fmt3(w10.range[0])}–${fmt3(w10.range[1])} ms | ~${fmt3(wNw.range[0])}–${fmt3(wNw.range[1])} ms | **×${fmt1(wallRatio)}** |`,
  ].join("\n");
}

// ---------- exécution ----------
const data = loadRuns();
const table = gpuTable(data);

console.log("Table GPU générée (médiane des médianes + plage inter-seeds) :");
console.log();
console.log(table);

if (PRINT_ONLY) process.exit(0);

if (!fs.existsSync(readmePath)) {
  console.error(`\nREADME introuvable : ${readmePath} — utilisez --readme=<chemin> ou --print-only.`);
  process.exit(1);
}

let content = fs.readFileSync(readmePath, "utf-8");
// ancres tolérantes LF/CRLF (le README de travail est CRLF sous Windows).
// ⚠ La ligne « | Mesure | perf10 | v… | Δ | » existe DEUX fois dans le README
// (table Chargement + table GPU) : le regex est donc ancré sur la ligne
// « | Appels GL par frame | » (unique) pour ne matcher QUE la table GPU.
const blank = "\\r?\\n\\r?\\n";
const re = new RegExp(`\\| Mesure \\| perf10 \\| v[^ |]+ \\| Δ \\|\\r?\\n\\|-+\\|-+\\|-+\\|-+\\|\\r?\\n\\| Appels GL par frame \\|[\\s\\S]*?${blank}Lecture des résultats :`);
if (!re.test(content)) {
  console.error(`\nAncre « | Mesure | perf10 | v… | Δ | … Lecture des résultats : » introuvable dans ${readmePath} — mise à jour annulée.`);
  process.exit(1);
}
content = content.replace(re, table + "\n\nLecture des résultats :");
fs.writeFileSync(readmePath, content.replace(/\r?\n/g, "\r\n"));
console.log(`\nREADME mis à jour (${readmePath}) : table « GPU — renderer WebGL2 » régénérée (${seeds.length} seeds).`);
console.log("Vérifiez le diff avant de commiter.");
