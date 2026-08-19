#!/usr/bin/env node
/**
 * build-es2017.mjs — transpile le bundle stable (ES2020+) en ES2017 pour les
 * vieux Android System WebView (Chrome < 80 : pas de ?. / ?? / class fields).
 *
 * Le bundle source est minifié ESNext par esbuild/bun. On re-transpile avec
 * esbuild `--target=es2017` en préservant :
 *   - le header userscript (// ==UserScript== ... ==/UserScript==) — esbuild
 *     le supprimerait en minifiant (ce n'est pas un commentaire de licence) ;
 *   - la sémantique du code (downlevel ?. → ternaires, ?? → ||, class fields
 *     → defineProperty, private fields → WeakMap, ...).
 *
 * Usage : bun bench/es2017-build.mjs [--src <bundle>] [--out <fichier>] [--minify]
 *   défaut : source `better-xcloud.user.js` (stable) → écrit
 *   `better-xcloud.es2017.user.js` à la racine (minifié),
 *   imprime la taille, le delta et les compteurs de syntaxe ES2020 résiduelle.
 *   Le preview : --src better-xcloud-preview.user.js
 *   --out better-xcloud-preview.es2017.user.js (appelé par bump-version.sh).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { build } from "esbuild";

const argv = process.argv.slice(2);
const srcArg = argv[argv.indexOf("--src") + 1];
const outArg = argv[argv.indexOf("--out") + 1];
const minify = argv.includes("--minify") || !argv.includes("--pretty");

const SRC = srcArg || "better-xcloud.user.js";
const outPath = outArg || "better-xcloud.es2017.user.js";

// ---- extraire le header userscript (bloc // ==UserScript== ... ==/UserScript==)
const src = readFileSync(SRC, "utf8");
const m = src.match(/^\/\/ ==UserScript==[\s\S]*?==\/UserScript==\s*\n/);
if (!m) {
  console.error("❌ header userscript introuvable dans " + SRC);
  process.exit(1);
}
const header = m[0];
const body = src.slice(m[0].length);

// ---- transpiler le corps avec esbuild (target es2017)
const result = await build({
  stdin: {
    contents: body,
    sourcefile: "better-xcloud.user.js",
    loader: "js",
  },
  write: false,
  minify,
  target: "es2017",
  legalComments: "none",
});

let out = result.outputFiles[0].text;
// esbuild ajoute "use strict" en tête ; le header doit rester TOUT en tête.
if (out.startsWith('"use strict";')) out = out.slice('"use strict";'.length);
// un saut de ligne entre header et corps
out = header.replace(/\n$/, "") + "\n" + out.replace(/^\n+/, "") + "\n";

writeFileSync(outPath, out);

// ---- vérifications
function stripStrings(code) {
  return code
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const s = stripStrings(out);
const es2020 = {
  "optional chaining ?.": (s.match(/\?\./g) || []).length,
  "nullish ??": (s.match(/\?\?(?!=)/g) || []).length,
  "?.(": (s.match(/\?\.\(/g) || []).length,
  "logical assign ||= &&= ??=": (s.match(/\|\|=|&&=|\?\?=/g) || []).length,
};
const es2022 = {
  "class fields (private #)": (s.match(/#[A-Za-z_]/g) || []).length,
  "static blocks": (s.match(/static\s*\{/g) || []).length,
};
const es2018 = {
  "object/array spread ...": (s.match(/\.\.\./g) || []).length,
  "async iter for await": (s.match(/for\s+await/g) || []).length,
};
const es2017 = {
  "async/await": (s.match(/\bawait\b/g) || []).length,
  "Object.values/entries": (s.match(/Object\.(?:values|entries)\(/g) || []).length,
};
console.log("source        : " + SRC + "  " + src.length + " o");
console.log("sortie        : " + outPath + "  " + out.length + " o" + (minify ? " (minifié)" : " (pretty)"));
console.log("delta         : " + (out.length - src.length >= 0 ? "+" : "") + (out.length - src.length) + " o (" + (((out.length / src.length) - 1) * 100).toFixed(1) + " %)");
console.log("header        : " + (out.startsWith("// ==UserScript==") ? "conservé ✓" : "PERDU ❌"));
console.log("ES2020 résiduel: " + JSON.stringify(es2020));
console.log("ES2022 résiduel: " + JSON.stringify(es2022));
console.log("ES2018 (spread): " + JSON.stringify(es2018));
console.log("ES2017 (garde) : " + JSON.stringify(es2017));
