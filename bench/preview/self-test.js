#!/usr/bin/env node
/*
 * bench/preview/self-test.js — rejoue le moteur de signatures de
 * bench/preview/capture.js sur des bundles locaux (hors navigateur).
 *
 * Ce script valide :
 *   1. la syntaxe de capture.js (compilé en vm avec un DOM factice) ;
 *   2. l'extraction des signatures depuis capture.js (source unique) ;
 *   3. la matrice signatures × modules sur les bundles locaux (les bundles
 *      statiques du preview/stable déjà téléchargés — voir mémo §10) ;
 *   4. la synchronisation avec bench/preview/static-matrix.md (drift check).
 *
 * Usage :
 *   node bench/preview/self-test.js [dirA dirB ...] [--print] [--write]
 *     (défaut : /d/tmp/preview-player /d/tmp/stable-client — paths en slashs)
 *
 * Sortie : matrice markdown + vérifications ; exit 0 si tout est cohérent.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HERE = __dirname;
const capturePath = path.join(HERE, "capture.js");
const matrixPath = path.join(HERE, "static-matrix.md");

// ---------- 1. extraction des signatures depuis capture.js ----------
function extractSignatures() {
  const src = fs.readFileSync(capturePath, "utf8");
  const start = src.indexOf("const SIGNATURES = [");
  const end = src.indexOf("/* END_SIGNATURES */");
  if (start < 0 || end < 0) {
    throw new Error("markers BEGIN/END_SIGNATURES introuvables dans capture.js");
  }
  const arrSrc = src.slice(src.indexOf("[", start), src.lastIndexOf("];", end) + 2);
  const list = vm.runInNewContext(arrSrc, {});
  if (!Array.isArray(list) || !list.length) throw new Error("signatures non extraites");
  return list;
}

// ---------- 2. compile capture.js (syntaxe + API) ----------
function compileCapture() {
  const src = fs.readFileSync(capturePath, "utf8");
  const sandbox = {
    console,
    performance: { now: () => 0 },
    setTimeout: () => {},
    requestAnimationFrame: () => 0,
    fetch: () => Promise.resolve({ ok: false, status: 0 }),
    Blob: function () {},
    URL: { createObjectURL: () => "", revokeObjectURL: () => {} },
    document: { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } },
    navigator: {},
    location: { href: "about:blank" },
    PerformanceObserver: function () {},
    WebGL2RenderingContext: undefined,
    WebGLRenderingContext: undefined,
    GPUQueue: undefined,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "capture.js" });
  const api = sandbox.window.BX_PREVIEW_CAPTURE;
  if (!api) throw new Error("capture.js n'a pas exposé window.BX_PREVIEW_CAPTURE");
  return api;
}

// ---------- 3. matrice sur les bundles locaux ----------
function buildMatrix(dirList) {
  const sigs = extractSignatures();
  const rows = [];
  let totalJs = 0;
  for (const dir of dirList) {
    if (!fs.existsSync(dir)) {
      console.error("répertoire introuvable (ignoré) :", dir);
      continue;
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
    for (const f of files.sort()) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      totalJs++;
      const hits = sigs
        .map((s) => ({ id: s.id, n: (src.match(s.re) || []).length }))
        .filter((x) => x.n > 0);
      rows.push({ file: f, size: src.length, hits });
    }
  }
  return { sigs, rows, totalJs };
}

function matrixMd(m, note) {
  const L = [];
  L.push("# Matrice signatures × modules — bundles statiques (référence)");
  L.push("");
  L.push("_Générée par `node bench/preview/self-test.js` (moteur de `capture.js`, source unique). Répertoires : " + (note || "(voir la commande)") + ". Le but : savoir où vivent les ancres de rendu/upload/session dans le preview (Babylon) vs le stable — pour préparer le portage des optimisations et vérifier la stabilité des signatures à chaque re-capture._");
  L.push("");
  L.push(`- Date : ${new Date().toISOString()}`);
  L.push(`- Fichiers analysés : ${m.rows.length} (.js)`);
  L.push("");
  const sigsUsed = [...new Set(m.rows.flatMap((r) => r.hits.map((h) => h.id)))];
  L.push("| Module | " + sigsUsed.map((id) => m.sigs.find((s) => s.id === id).label).join(" | ") + " |");
  L.push("|---|---" + "---|".repeat(sigsUsed.length));
  for (const r of m.rows) {
    const cells = sigsUsed.map((id) => {
      const h = r.hits.find((x) => x.id === id);
      return h ? h.n : "";
    });
    L.push("| `" + r.file + "` | " + cells.join(" | ") + " |");
  }
  L.push("");
  L.push("Légende : nombre d'occurrences de la signature dans le module (vide = 0).");
  return L.join("\n");
}

// ---------- main ----------
function main() {
  const args = process.argv.slice(2);
  const dirs = args.filter((a) => !a.startsWith("--"));
  const list = dirs.length ? dirs : ["D:/tmp/preview-player", "D:/tmp/stable-client"];
  const print = args.includes("--print");
  const write = args.includes("--write");

  console.log("=== preview self-test ===\n");

  let ok = true;

  // syntaxe + API
  try {
    const api = compileCapture();
    console.log("  ✓ capture.js compile + expose BX_PREVIEW_CAPTURE");
    if (api.signatures.length !== extractSignatures().length) {
      console.error("  ✗ drift signatures (compile vs extraction)");
      ok = false;
    } else {
      console.log(`  ✓ ${api.signatures.length} signatures (extraction = API)`);
    }
  } catch (e) {
    console.error("  ✗ capture.js :", e.message);
    process.exit(1);
  }

  // matrice
  const m = buildMatrix(list);
  const md = matrixMd(m, list.join(" / "));
  console.log(`  ✓ matrice sur ${m.rows.length} modules (${m.totalJs} fichiers .js)`);

  // drift avec la référence committée
  if (fs.existsSync(matrixPath)) {
    const ref = fs.readFileSync(matrixPath, "utf8");
    const refBody = ref.slice(ref.indexOf("\n| Module |"));
    const newBody = md.slice(md.indexOf("\n| Module |"));
    if (refBody === newBody) {
      console.log("  ✓ static-matrix.md à jour (aucun drift)");
    } else {
      console.error("  ✗ DRIFT static-matrix.md (bundles ou signatures changés)");
      ok = false;
      if (write) {
        fs.writeFileSync(matrixPath, md);
        console.log("  → static-matrix.md réécrit");
      }
    }
  } else if (write) {
    fs.writeFileSync(matrixPath, md);
    console.log("  → static-matrix.md créé");
  } else {
    console.log("  (static-matrix.md absent — générer avec --write)");
    ok = false;
  }

  // smoke-draw : moteur de mesure GL (hors navigateur, contexte simulé)
  try {
    // execFileSync : pas de shell (le chemin de node contient un espace sur Windows)
    const { execFileSync } = require("child_process");
    execFileSync(process.execPath, [path.join(HERE, "smoke-draw.js")], { stdio: "inherit" });
    console.log("  ✓ smoke-draw : moteur de mesure GL cohérent");
  } catch (e) {
    console.error("  ✗ smoke-draw :", e.message);
    ok = false;
  }

  if (print) console.log("\n" + md);
  process.exit(ok ? 0 : 1);
}

main();
