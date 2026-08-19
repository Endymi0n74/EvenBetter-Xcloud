#!/usr/bin/env node
/**
 * Insère / remplace une ligne dans la table « Sessions startup » du README
 * du fork, à partir du résumé startup généré par `check-ratios.js
 * --startup-only` (le même fichier que l'artefact `startup-summary-<sha>` du
 * job CI `startup-cold`).
 *
 * Ligne produite (mêmes conventions que les tables « Sessions GPU » /
 * « Sessions hot loops ») :
 *   | Session | perf10 éval (ms) | build éval (ms) | Δ perf10/build | État | Statut |
 * avec :
 *   - Δ = écart des médianes (perf10 → build, négatif = build plus rapide) ;
 *   - état dérivé du perf10 (le one-shot RTC porte la dérive d'environnement,
 *     le build ~30 ms est stable) : `bas` = perf10 ≤ 620 ms, `haut` sinon ;
 *   - statut = build ≤ 50 ms ET perf10 dans [300, 1200] ms (les bornes CI).
 * La ligne est insérée à la fin de la table, ou remplace la ligne de même
 * session (déduplication par libellé).
 *
 * Usage :
 *   # depuis l'artefact CI (startup-summary-<sha>/startup-summary.md)
 *   node bench/update-startup-session.js startup-summary.md --label="CI 2026-08-16 (PR #6)"
 *   node bench/update-startup-session.js startup-summary.md --print-only
 *   node bench/update-startup-session.js startup-summary.md --readme=D:/Codex/EvenBetterXcloud/better-xcloud-fork/bench/README.md
 */
"use strict";

const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const summaryFile = argv.find((a) => !a.startsWith("--"));
if (!summaryFile) {
  console.error("Usage : node bench/update-startup-session.js <startup-summary.md> [--label=...] [--print-only] [--readme=...]");
  process.exit(2);
}
const PRINT_ONLY = argv.includes("--print-only");
const readmePath = (argv.find((a) => a.startsWith("--readme=")) || "").split("=").slice(1).join("=")
  || path.join(__dirname, "..", "bench", "README.md");
const labelArg = (argv.find((a) => a.startsWith("--label=")) || "").split("=").slice(1).join("=").trim();

const txt = fs.readFileSync(summaryFile, "utf-8");

// ---------- parsing du résumé ----------
const fmtF = (n) => n.toFixed(1).replace(".", ",");
const parsed = {}; // perf10/build -> { med, min, max }
let verdict = null;
for (const line of txt.split(/\r?\n/)) {
  let m = line.match(/^\| (perf10|build) \| ([\d.]+) \(([\d.]+)–([\d.]+)\) \|/);
  if (m) {
    parsed[m[1]] = { med: +m[2], min: +m[3], max: +m[4] };
    continue;
  }
  m = line.match(/^\| (perf10|build) \| ([\d.,]+) \|/); // sans plage (dégradé)
  if (m) parsed[m[1]] = { med: +m[2].replace(",", "."), min: null, max: null };
  m = line.match(/\*\*Résultat : ([^ ]+)/);
  if (m) verdict = m[1];
}
if (!parsed.perf10 || !parsed.build) {
  console.error(`perf10/build introuvables dans ${summaryFile} (format du résumé check-ratios --startup-only ?)`);
  process.exit(1);
}

// ---------- ligne de session ----------
const STARTUP_BUILD_MAX_MS = 50;
const STARTUP_P10_MIN_MS = 300;
const STARTUP_P10_MAX_MS = 1200;
const P10_HAUT_MS = 620; // état haut/bas dérivé du perf10 (one-shot RTC)

const label = labelArg || ("CI " + new Date().toISOString().slice(0, 10) + " (startup)");
const p = parsed.perf10, b = parsed.build;
const delta = ((b.med / p.med - 1) * 100);
const deltaStr = (delta < 0 ? "−" : "+") + Math.abs(delta).toFixed(1).replace(".", ",") + " %";
const etat = p.med <= P10_HAUT_MS ? "bas" : "haut";
const ok = b.med <= STARTUP_BUILD_MAX_MS && p.med >= STARTUP_P10_MIN_MS && p.med <= STARTUP_P10_MAX_MS;
const statut = ok ? "✅" : "❌";
const cell = (x) => (x.max != null ? `${fmtF(x.med)} (${fmtF(x.min)}–${fmtF(x.max)})` : fmtF(x.med));
const row = `| ${label} | ${cell(p)} | ${cell(b)} | ${deltaStr} | ${etat} | ${statut} |`;

if (PRINT_ONLY) {
  console.log(row);
  process.exit(0);
}

// ---------- insertion dans le README (CRLF-aware, dédup par libellé) ----------
if (!fs.existsSync(readmePath)) {
  console.error(`README introuvable : ${readmePath}`);
  process.exit(1);
}
let c = fs.readFileSync(readmePath, "utf-8");
const CRLF = c.includes("\r\n");
const E = CRLF ? "\r\n" : "\n";
const endsWithNewline = /\r?\n$/.test(c); // préserver l'EOF exact (pas de ligne vide ajoutée)
const lines = c.split(/\r?\n/);

const hdrIdx = lines.findIndex((l) => l.includes("| perf10 éval (ms) |") && l.includes("build éval"));
if (hdrIdx === -1) {
  console.error("Table « Sessions startup » introuvable dans le README (header « | perf10 éval (ms) | build éval (ms) | Δ perf10/build | État | Statut | »)");
  process.exit(1);
}
let endIdx = hdrIdx + 2; // après header + séparateur
while (endIdx < lines.length && /^\| /.test(lines[endIdx])) endIdx++;

const existing = lines.slice(hdrIdx + 2, endIdx).findIndex((l) => l.includes("| " + label + " |"));
if (existing >= 0) {
  lines[hdrIdx + 2 + existing] = row;
  console.log(`Ligne remplacée (session « ${label} » existante) : ${row}`);
} else {
  lines.splice(endIdx, 0, row);
  console.log(`Ligne insérée : ${row}`);
}
fs.writeFileSync(readmePath, lines.join(E) + (endsWithNewline ? "" : E));
console.log(`README mis à jour : ${readmePath}`);
