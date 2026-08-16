#!/usr/bin/env node
/**
 * CI GPU — vérifie les ratios de la table « GPU » (perf10/build) issus du
 * protocole figé (run-s<seed>.json produits par gpu-runner.js) contre des
 * seuils, et vérifie le **chemin GL fonctionnel** (compteurs par frame).
 *
 * Checks :
 *   - upload vidéo : ratio perf10/build ≥ --upload-min (défaut 1,3 — Windows
 *     observe 1,5-2,2 ; le plancher est volontairement bas pour un runner CI
 *     inconnu) — régresse si le patch 13 (texStorage2D/texSubImage2D) casse
 *   - wallTotal : ratio ≥ --wall-min (défaut 1,2)
 *   - draw GPU : ratio dans [--draw-min, --draw-max] (défaut 0,5-2,0 ; attendu
 *     ~1,0 — même shader)
 *   - chemin GL : le build récent doit uploader par `texSubImage2D` (0
 *     `texImage2D`) et perf10 par `texImage2D` — si ce n'est plus le cas, le
 *     patch 13/16 a été reverté, quels que soient les timings.
 *   - bornes absolues du build (garde-fou : le ratio perf10/build peut passer
 *     même si le build régresse, quand perf10 régresse aussi — ex. driver ou
 *     harnais ; un build qui remonte vers le niveau perf10 échappe au ratio) :
 *     émission upload ≤ --build-upload-max µs (défaut 25 — nominal ~10 sur le
 *     runner CI) et wallTotal ≤ --build-wall-max ms (défaut 0,10 — nominal
 *     ~0,015). Calibrées sur le runner CI ; flags pour les sessions locales en
 *     état haut.
 *
 * `--markdown=<fichier>` : écrit aussi le résumé en tableau markdown (même en
 * cas d'échec, avant l'exit).
 *
 * Usage : node bench/gpu/check-gpu.js 100 200 300 400 500 600 [--markdown=out.md]
 *         [--upload-min=1.3] [--wall-min=1.2] [--draw-min=0.5] [--draw-max=2.0]
 */
"use strict";

const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const seeds = argv.filter((a) => !a.startsWith("--"));
if (seeds.length === 0) {
  console.error("Usage : node bench/gpu/check-gpu.js <seed1> <seed2> ... [--markdown=out.md]");
  process.exit(2);
}
const numVal = (flag, dflt) => {
  const a = argv.find((x) => x.startsWith(flag + "="));
  return a ? parseFloat(a.split("=")[1]) : dflt;
};
const UPLOAD_MIN = numVal("--upload-min", 1.3);
const WALL_MIN = numVal("--wall-min", 1.2);
const DRAW_MIN = numVal("--draw-min", 0.5);
const DRAW_MAX = numVal("--draw-max", 2.0);
const BUILD_UPLOAD_MAX = numVal("--build-upload-max", 25); // µs — nominal ~10 sur le runner CI (9-12)
const BUILD_WALL_MAX = numVal("--build-wall-max", 0.10);   // ms — nominal ~0,015 (0,011-0,019)
const markdownFile = (argv.find((a) => a.startsWith("--markdown=")) || "").split("=").slice(1).join("=") || null;

// ---------- lecture des runs ----------
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
      uploadNs: a.uploadNs,
      wallTotalMs: a.wallTotalAvg,
      gpuMs: a.gpuMed,
      counts: a.countsPerFrame,
      // split émission/sync (runs récents uniquement, sinon null → « — »)
      uploadSyncNs: a.uploadSyncNs != null ? a.uploadSyncNs : null,
      uploadTotalNs: a.uploadTotalNs != null ? a.uploadTotalNs : null,
    });
  }
}
const [P10, NEW] = labels;

// ---------- agrégation (médiane des médianes + plage inter-seeds) ----------
const agg = (vals) => {
  const s = [...vals].sort((a, b) => a - b);
  return { med: s[Math.floor(s.length / 2)], range: [s[0], s[s.length - 1]] };
};
const upP10 = agg(perVersion[P10].map((r) => r.uploadNs / 1000)); // ns → µs
const upNew = agg(perVersion[NEW].map((r) => r.uploadNs / 1000));
const wallP10 = agg(perVersion[P10].map((r) => r.wallTotalMs));   // ms
const wallNew = agg(perVersion[NEW].map((r) => r.wallTotalMs));
const drawP10 = agg(perVersion[P10].map((r) => r.gpuMs * 1000));  // ms → µs
const drawNew = agg(perVersion[NEW].map((r) => r.gpuMs * 1000));
const cNew = perVersion[NEW][0].counts || {};
const cP10 = perVersion[P10][0].counts || {};
// ---------- split émission/sync (runs récents) : médiane des médianes par
// seed + plage inter-seeds, en µs — alimente les colonnes Sync/Total de la
// ligne de session README (« — » si les runs n'ont pas le split).
const hasSplit = perVersion[NEW].some((r) => r.uploadSyncNs != null);
const syncAgg = hasSplit ? agg(perVersion[NEW].map((r) => r.uploadSyncNs / 1000)) : null;
const totalAgg = hasSplit ? agg(perVersion[NEW].map((r) => r.uploadTotalNs / 1000)) : null;

// ---------- vérification ----------
const fmt = (n) => n.toFixed(2).replace(".", ",");
const ann = (level, msg) => console.log(process.env.GITHUB_ACTIONS ? `::${level}::${msg}` : `${level.toUpperCase()} : ${msg}`);

const rows = [];
let failures = 0;
const add = (metric, p10, nw, ratio, seuil, ok) => {
  rows.push({ metric, p10, nw, ratio, seuil, ok });
  if (!ok) failures++;
};

const upRatio = upP10.med / upNew.med;
const wallRatio = wallP10.med / wallNew.med;
const drawRatio = drawP10.med / drawNew.med;
const glOk = cNew.texSubImage2D >= 1 && cNew.texImage2D === 0;
const p10GlOk = cP10.texImage2D >= 1 && cP10.texSubImage2D === 0;

// ---------- ligne de session (tableau « Sessions GPU » du README) ----------
// État dérivé du ratio upload perf10/build (mêmes seuils que le README) :
// bas ≥ ~4 (émission pure), haut ≤ ~2,5 (coût fixe de backpressure qui masque
// l'avantage), transitionnel entre les deux. Date : capture machine-state du
// 1er seed (state-s<seed>.before.json, écrit par run-gpu-ci.sh / le workflow),
// repli sur la date courante si absente.
const etat = upRatio >= 4 ? "bas" : upRatio <= 2.5 ? "haut" : "transitionnel";
const stFile = path.join(__dirname, `state-s${seeds[0]}.before.json`);
let sessionDate = "";
if (fs.existsSync(stFile)) {
  try {
    const st = JSON.parse(fs.readFileSync(stFile, "utf8"));
    sessionDate = st.iso ? st.iso.slice(0, 10) : "";
  } catch (e) {
    /* état illisible → repli date courante */
  }
}
if (!sessionDate) sessionDate = new Date().toISOString().slice(0, 10);
console.log(`Session ${sessionDate} : ${seeds.length} seeds, ratio upload ×${fmt(upRatio)}, état ${etat}`);

// Label de la session : --session-label pour personnaliser, défaut
// « <date> (N seeds) » (préfixé « CI » sous GitHub Actions).
const sessionLabelArg = (argv.find((a) => a.startsWith("--session-label=")) || "").split("=").slice(1).join("=").trim();
const sessionLabel = sessionLabelArg || `${process.env.GITHUB_ACTIONS ? "CI " : ""}${sessionDate} (${seeds.length} seeds)`;

// Ligne de session au format du tableau « Sessions GPU » du README (8
// colonnes, y compris Sync/Total quand le split est dispo) — utilisée par
// le résumé markdown ET par l'insertion automatique (--update-readme).
const syncCell = syncAgg ? `${fmt(syncAgg.med)} (${fmt(syncAgg.range[0])}–${fmt(syncAgg.range[1])})` : "—";
const totalCell = totalAgg ? `**${fmt(totalAgg.med)}** (${fmt(totalAgg.range[0])}–${fmt(totalAgg.range[1])})` : "—";
const readmeSessionLine =
  `| ${sessionLabel} | ${NEW} | ${fmt(upP10.med)} (${fmt(upP10.range[0])}–${fmt(upP10.range[1])}) | ` +
  `${fmt(upNew.med)} (${fmt(upNew.range[0])}–${fmt(upNew.range[1])}) | **×${fmt(upRatio)}** | ${etat} | ` +
  `${syncCell} | ${totalCell} | ${fmt(drawP10.med)} vs ${fmt(drawNew.med)} |`;

console.log(`=== Bench GPU — vérification des ratios (${P10} vs ${NEW}, ${seeds.length} seeds) ===`);
add("Upload vidéo (µs)", `${fmt(upP10.med)} (${fmt(upP10.range[0])}–${fmt(upP10.range[1])})`, `${fmt(upNew.med)} (${fmt(upNew.range[0])}–${fmt(upNew.range[1])})`, upRatio, `≥ ${fmt(UPLOAD_MIN)}`, upRatio >= UPLOAD_MIN);
add("wallTotal (ms)", `${fmt(wallP10.med)} (${fmt(wallP10.range[0])}–${fmt(wallP10.range[1])})`, `${fmt(wallNew.med)} (${fmt(wallNew.range[0])}–${fmt(wallNew.range[1])})`, wallRatio, `≥ ${fmt(WALL_MIN)}`, wallRatio >= WALL_MIN);
add("Draw GPU (µs)", fmt(drawP10.med), fmt(drawNew.med), drawRatio, `${fmt(DRAW_MIN)}–${fmt(DRAW_MAX)}`, drawRatio >= DRAW_MIN && drawRatio <= DRAW_MAX);
add(`Chemin GL ${NEW} (compteurs/frame)`, `texImage2D=${cP10.texImage2D || 0}, texSubImage2D=${cP10.texSubImage2D || 0}`, `texImage2D=${cNew.texImage2D || 0}, texSubImage2D=${cNew.texSubImage2D || 0}`, null, "texSubImage2D ≥ 1, texImage2D = 0", glOk);

// Bornes absolues du build — complètent les ratios (qui peuvent passer même
// si le build régresse quand perf10 régresse aussi) : le coût du build est
// calibré sur le runner CI (émission ~10 µs, wall ~0,015 ms).
add("Upload build — émission (µs, abs.)", "—", `${fmt(upNew.med)} (${fmt(upNew.range[0])}–${fmt(upNew.range[1])})`, null, `≤ ${fmt(BUILD_UPLOAD_MAX)}`, upNew.med <= BUILD_UPLOAD_MAX);
add("wallTotal build (ms, abs.)", "—", `${fmt(wallNew.med)} (${fmt(wallNew.range[0])}–${fmt(wallNew.range[1])})`, null, `≤ ${fmt(BUILD_WALL_MAX)}`, wallNew.med <= BUILD_WALL_MAX);

for (const r of rows) {
  const ratio = r.ratio != null ? fmt(r.ratio) : "—";
  const mark = r.ok ? "✓" : "❌";
  console.log(`  ${mark} ${r.metric.padEnd(28)} ${P10}: ${r.p10} | ${NEW}: ${r.nw} → ratio ${ratio} [seuil ${r.seuil}]`);
  if (!r.ok) ann("error", `RÉGRESSION GPU DÉTECTÉE : ${r.metric} → ${r.ratio != null ? r.p10 + " vs " + r.nw : "build " + r.nw} (seuil ${r.seuil})`);
}
if (!p10GlOk) {
  ann("error", `chemin GL perf10 inattendu (texImage2D=${cP10.texImage2D || 0}, texSubImage2D=${cP10.texSubImage2D || 0})`);
  failures++;
}

// ---------- résumé markdown (commentaire PR / artefact) ----------
if (markdownFile) {
  const lines = [
    "### Bench GPU — upload vidéo (protocole 6 seeds)",
    "",
    `_Runner : ${process.env.GITHUB_ACTIONS ? "CI (runner GPU self-hosted)" : "local"}, ${seeds.length} seeds, ${P10} vs ${NEW}._`,
    "",
    "| Métrique | " + P10 + " | " + NEW + " | Ratio | Seuil | Statut |",
    "|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    lines.push(`| ${r.metric} | ${r.p10} | ${r.nw} | ${r.ratio != null ? fmt(r.ratio) : "—"} | ${r.seuil} | ${r.ok ? "✅" : "❌"} |`);
  }
  // Ligne de session prête à coller dans le tableau « Sessions GPU » du README
  // (même en-tête, même format : plages, ratio, état, draw).
  lines.push("", "**Session — ligne prête à insérer dans le tableau « Sessions GPU » du README** (`--update-readme` l'insère automatiquement) :");
  lines.push("", "| Session | Version | Upload perf10 (µs) | Upload build — émission (µs) | Ratio upload | État | Sync build (µs) | Total build (µs) | Draw (µs) |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  lines.push(readmeSessionLine);
  const verdict = failures === 0 ? "✅ PASS" : `❌ ÉCHEC (${failures} check(s) hors seuil)`;
  lines.push("", `**Résultat : ${verdict}**`);
  lines.push("", "_Upload = `texImage2D` (réalloue le storage GPU) vs `texSubImage2D` (storage immuable) — le ratio doit rester ≥ 1,3. Les absolus varient selon la machine/le driver ; les compteurs GL vérifient le chemin fonctionnel indépendamment des timings._");
  fs.writeFileSync(markdownFile, lines.join("\n") + "\n");
  console.log(`Résumé markdown écrit : ${markdownFile}`);
}

// ---------- insertion automatique dans le tableau « Sessions GPU » du README ----------
// --update-readme[=chemin] : ajoute la ligne de session au tableau du README
// (défaut : README.md à la racine du repo). Idempotent : si une ligne porte
// déjà le même label de session, l'insertion est sautée. EOL préservée (CRLF
// pour le README du repo).
const updateReadmeArg = argv.find((a) => a.startsWith("--update-readme"));
if (updateReadmeArg !== undefined) {
  const readmePath = (updateReadmeArg.split("=").slice(1).join("=").trim() ||
    path.join(__dirname, "..", "..", "README.md")).replace(/\\/g, "/");
  if (!fs.existsSync(readmePath)) {
    console.error(`README introuvable : ${readmePath}`);
    process.exit(1);
  }
  const rd = fs.readFileSync(readmePath, "utf8");
  const eol = rd.includes("\r\n") ? "\r\n" : "\n";
  const endsWithEol = /\r\n|\n$/.test(rd);
  const lines = rd.split(/\r\n|\n/);
  if (lines[lines.length - 1] === "") lines.pop(); // élément vide de fin (le EOL final sera ré-ajouté)
  const hdrIdx = lines.findIndex((l) => l.startsWith("| Session | Version |"));
  if (hdrIdx < 0) {
    console.error(`Tableau « Sessions GPU » introuvable dans ${readmePath}`);
    process.exit(1);
  }
  let lastData = -1;
  for (let i = hdrIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith("| ")) lastData = i;
    else if (lastData >= 0) break;
  }
  const dup = lines.slice(hdrIdx + 1, lastData + 1).find((l) => l.startsWith(`| ${sessionLabel} |`));
  if (dup) {
    console.log(`Session « ${sessionLabel} » déjà présente dans le tableau — insertion sautée (idempotent)`);
  } else {
    lines.splice(lastData + 1, 0, readmeSessionLine);
    fs.writeFileSync(readmePath, lines.join(eol) + (endsWithEol ? eol : ""));
    console.log(`Ligne de session insérée dans le tableau « Sessions GPU » (${readmePath}) :`);
    console.log(`  ${readmeSessionLine}`);
  }
}

console.log();
if (failures === 0) {
  console.log("Résultat : PASS");
  process.exit(0);
} else {
  console.log(`Résultat : ÉCHEC (${failures} check(s) hors seuil)`);
  process.exit(1);
}
