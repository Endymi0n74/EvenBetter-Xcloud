#!/usr/bin/env node
/*
 * bench/preview/play-chain.js — garde anti-dérive de la chronologie du play
 * request du preview (la chaîne requestConnection → play, session.md).
 *
 * Le play est déclenché par la mutation requestConnection (accs.system) :
 * connectionEligibility → syncConnectionState → connectionManager.connect →
 * performConnect (getToken → createSession) → StreamSessionRequest
 * .createSession → startProcessingRequest → triggerPlayRequest →
 * sendPlayCloud → POST /v5/sessions/cloud/play. Si une ancre dérive (nouveau
 * build du preview, minifier qui renomme), la capture/interception P2/P3 doit
 * être revalidée — ce script alerte.
 *
 * Sortie : tableau markdown de la chaîne (ancres + preuves + offsets) et
 * statut DRIFT/OK. Drift = une ancre attendue absente d'un bundle, ou la
 * chaîne d'import GameStreamBootstrapper → StreamSessionRequest rompue.
 *
 * Usage :
 *   node bench/preview/play-chain.js [dir] [--print] [--write] [--soft]
 *     (défaut : /d/tmp/preview-player ; --print affiche le markdown,
 *      --write régénère bench/preview/play-chain.md ; --soft = pas de bundle
 *      trouvé du tout → warning + exit 0, pour les contextes sans capture
 *      locale (CI, Étape 0 du protocole E2E) — un bundle présent mais des
 *      ancres dérivées reste un échec).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_DIR = process.platform === "win32" ? "D:\\tmp\\preview-player" : "/d/tmp/preview-player";

// Ancres de la chaîne requestConnection → play, par bundle.
// Chaque ancre : { label, needle, min } — needle peut être un RegExp.
const CHAIN = [
  // entry.client : la mutation requestConnection et ses étapes
  { bundle: "entry.client", label: "mutation requestConnection (accs.system)", needle: /requestConnection:/, min: 1 },
  { bundle: "entry.client", label: "fetch connectionEligibility (éligibilité avant connect)", needle: /connectionEligibility/, min: 2 },
  { bundle: "entry.client", label: "syncConnectionState → eligible", needle: /async syncConnectionState/, min: 1 },
  { bundle: "entry.client", label: "« Eligible, connecting to ACCS... » → connectionManager.connect", needle: /Eligible, connecting to ACCS/, min: 1 },
  { bundle: "entry.client", label: "performConnect : getToken() → createSession(token)", needle: /let t=await e\.getToken\(\);if\(!t\)/, min: 1 },
  { bundle: "entry.client", label: "Ude.createSession : getHttpConfiguration → t.createSession", needle: /getHttpConfiguration\(\),r=\{getToken/, min: 1 },
  // GameStreamBootstrapper : import statique du module de session
  { bundle: "GameStreamBootstrapper", label: "import STATIQUE de StreamSessionRequest", needle: /import\{i as \w+,o as \w+\}from"\.\/StreamSessionRequest-/, min: 1 },
  // StreamSessionRequest : le chemin interne jusqu'au POST play
  { bundle: "StreamSessionRequest", label: "createSession(e,t) → startProcessingRequest()", needle: /async createSession\(e,t\)/, min: 1 },
  { bundle: "StreamSessionRequest", label: "« Creating new cloud session. » (startProcessingRequest cloud)", needle: /Creating new cloud session/, min: 1 },
  { bundle: "StreamSessionRequest", label: "triggerPlayRequest → sendPlayCloud", needle: /async sendPlayRequest\(e,t\)\{return this\.playService\.sendPlayCloud/, min: 1 },
  { bundle: "StreamSessionRequest", label: "sessionPath loggé après le play", needle: /sessionPath: \$\{t\.sessionPath\}/, min: 1 },
];

function findBundle(dir, prefix) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const hit = files.filter((f) => f.startsWith(prefix) && f.endsWith(".js"));
  return hit.length ? path.join(dir, hit[0]) : null;
}

function countMatches(content, needle) {
  // clone TOUJOURS avec le flag g (exec sans g boucle à l'infini sur un match)
  const src = needle instanceof RegExp ? needle : new RegExp(needle);
  const re = new RegExp(src.source, src.flags.includes("g") ? src.flags : src.flags + "g");
  let n = 0;
  let m;
  while ((m = re.exec(content)) !== null) { n++; if (m[0].length === 0) re.lastIndex++; }
  return n;
}

function firstOffset(content, needle) {
  const re = needle instanceof RegExp ? needle : new RegExp(needle);
  const m = re.exec(content);
  return m ? m.index : -1;
}

function buildChain(dir) {
  const rows = [];
  let drift = 0;
  const bundles = {};
  const foundBundles = new Set();
  for (const step of CHAIN) {
    if (!bundles[step.bundle]) {
      bundles[step.bundle] = findBundle(dir, step.bundle) ? fs.readFileSync(findBundle(dir, step.bundle), "utf8") : null;
    }
    const content = bundles[step.bundle];
    if (!content) { rows.push({ ...step, ok: false, count: 0, offset: -1, note: "bundle absent" }); drift++; continue; }
    foundBundles.add(step.bundle);
    const count = countMatches(content, step.needle);
    const offset = firstOffset(content, step.needle);
    const ok = count >= step.min;
    if (!ok) drift++;
    rows.push({ ...step, ok, count, offset, note: ok ? "" : `attendu ≥ ${step.min}, trouvé ${count}` });
  }
  return { rows, drift, foundBundles: foundBundles.size };
}

function render(rows, drift) {
  const lines = [];
  lines.push("# Chaîne requestConnection → play (garde anti-dérive)");
  lines.push("");
  lines.push(`- Généré le : ${new Date().toISOString()}`);
  lines.push(`- Statut : ${drift === 0 ? "**OK — ancres stables** ✅" : `**DRIFT — ${drift} ancre(s) dérivée(s)** ❌`}`);
  lines.push(`- Ancre déclencheuse : mutation \`requestConnection\` (accs.system) → éligibilité → connect → \`sendPlayCloud\` → POST \`/v5/sessions/cloud/play\` (chronologie détaillée dans \`port/session.md\`)`);
  lines.push("");
  lines.push("| Bundle | Étape | Ancres | Offsets |");
  lines.push("|---|---|---|---|");
  for (const r of rows) {
    const anchor = r.needle instanceof RegExp ? r.needle.source.slice(0, 60) : r.needle;
    lines.push(`| ${r.bundle} | ${r.label} | ${r.ok ? "✅" : "❌"} \`${anchor}\` (x${r.count}) | ${r.offset >= 0 ? r.offset : "—"} |`);
  }
  lines.push("");
  lines.push("Régénérer : `node bench/preview/play-chain.js --write`");
  return lines.join("\n");
}

const argv = process.argv.slice(2);
const dir = argv.find((a) => !a.startsWith("--")) || DEFAULT_DIR;
const soft = argv.includes("--soft");
const { rows, drift, foundBundles } = buildChain(dir);
const md = render(rows, drift);

if (argv.includes("--print")) console.log(md);
else {
  for (const r of rows) {
    console.log(`  ${r.ok ? "✅" : "❌"} [${r.bundle}] ${r.label}${r.note ? " :: " + r.note : ""}`);
  }
  console.log(`\nChaîne requestConnection→play : ${drift === 0 ? "OK — ancres stables ✅" : `DRIFT (${drift} ancre(s)) ❌`} — bundles : ${dir}`);
}
if (argv.includes("--write")) {
  fs.writeFileSync(path.join(__dirname, "play-chain.md"), md, "utf8");
  console.log(`Référence écrite : bench/preview/play-chain.md`);
}
// --soft : aucun bundle trouvé → contexte sans capture locale (CI, Étape 0) :
// warning, pas d'échec — un bundle présent avec des ancres dérivées reste un DRIFT.
if (soft && foundBundles === 0) {
  console.log(`⚠️ play-chain : aucun bundle dans ${dir} — chronologie non vérifiable (mode --soft), exit 0`);
  process.exit(0);
}
process.exit(drift === 0 ? 0 : 1);
