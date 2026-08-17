#!/usr/bin/env node
/**
 * Génère patches/22-webgl2-usm-4taps.patch (USM 4 échantillons bilinéaires)
 * à partir de la ligne baseline du fragment shader contenue dans le patch
 * global better-xcloud-perf11.patch, avec la substitution documentée.
 *
 * Le patch 22 individuel s'applique seul sur la baseline (comme les autres
 * patches de la série) : sa ligne « avant » est la ligne baseline complète
 * (9 fetches), sa ligne « après » la même ligne avec le bloc USM 4 taps.
 *
 * Auto-vérifications :
 *   - le build courant better-xcloud.user.js contient bien le bloc 4 taps
 *   - la ligne baseline du patch global contient bien le bloc 9 taps
 *   - la substitution produit exactement 1 occurrence, la ligne après contient
 *     le 4 taps et plus le 9 taps
 *
 * Usage : node patches/gen-patch-22.js
 * Sortie : patches/22-webgl2-usm-4taps.patch (CRLF, format de la série)
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const GLOBAL_PATCH = path.join(ROOT, "better-xcloud-perf11.patch");
const BUILD = path.join(ROOT, "better-xcloud.user.js");
const OUT = path.join(__dirname, "22-webgl2-usm-4taps.patch");

// ---------- blocs exacts (même source que l'intégration dans le build) ----------
// 9 fetches (baseline perf10 et build v1.7.0 avant USM)
const OLD_BLOCK =
  "vec3 b = texture(tex, coord + texelSize * vec2(0, 1)).rgb;" +
  "vec3 d = texture(tex, coord + texelSize * vec2(-1, 0)).rgb;" +
  "vec3 f = texture(tex, coord + texelSize * vec2(1, 0)).rgb;" +
  "vec3 h = texture(tex, coord + texelSize * vec2(0, -1)).rgb;" +
  "vec3 a;vec3 c;vec3 g;vec3 i;" +
  "if (filterId == FILTER_UNSHARP_MASKING || qualityMode) {" +
  "a = texture(tex, coord + texelSize * vec2(-1, 1)).rgb;" +
  "c = texture(tex, coord + texelSize * vec2(1, 1)).rgb;" +
  "g = texture(tex, coord + texelSize * vec2(-1, -1)).rgb;" +
  "i = texture(tex, coord + texelSize * vec2(1, -1)).rgb;" +
  "}" +
  "if (filterId == FILTER_UNSHARP_MASKING) {" +
  "vec3 gaussianBlur = (a + c + g + i) * 1.0 + (b + d + f + h) * 2.0 + e * 4.0;" +
  "gaussianBlur /= 16.0;" +
  "return e + (e - gaussianBlur) * sharpenFactor / 3.0;" +
  "}";

// 4 échantillons bilinéaires aux milieux des arêtes (gaussienne 3×3 exacte)
const NEW_BLOCK =
  "if (filterId == FILTER_UNSHARP_MASKING) {" +
  "vec3 gaussianBlur = (texture(tex, coord + texelSize * vec2(-0.5, 0.5)).rgb + " +
  "texture(tex, coord + texelSize * vec2(0.5, 0.5)).rgb + " +
  "texture(tex, coord + texelSize * vec2(-0.5, -0.5)).rgb + " +
  "texture(tex, coord + texelSize * vec2(0.5, -0.5)).rgb) / 4.0;" +
  "return e + (e - gaussianBlur) * sharpenFactor / 3.0;" +
  "}" +
  "vec3 b = texture(tex, coord + texelSize * vec2(0, 1)).rgb;" +
  "vec3 d = texture(tex, coord + texelSize * vec2(-1, 0)).rgb;" +
  "vec3 f = texture(tex, coord + texelSize * vec2(1, 0)).rgb;" +
  "vec3 h = texture(tex, coord + texelSize * vec2(0, -1)).rgb;" +
  "vec3 a;vec3 c;vec3 g;vec3 i;" +
  "if (qualityMode) {" +
  "a = texture(tex, coord + texelSize * vec2(-1, 1)).rgb;" +
  "c = texture(tex, coord + texelSize * vec2(1, 1)).rgb;" +
  "g = texture(tex, coord + texelSize * vec2(-1, -1)).rgb;" +
  "i = texture(tex, coord + texelSize * vec2(1, -1)).rgb;" +
  "}";

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

// 1) le build courant porte bien le 4 taps
const build = fs.readFileSync(BUILD, "utf8");
if (!build.includes(NEW_BLOCK)) fail("build courant : bloc 4 taps introuvable — l'intégration USM a-t-elle été appliquée ?");
if (build.includes(OLD_BLOCK)) fail("build courant : bloc 9 taps encore présent — intégration incomplète ?");

// 2) ligne baseline (9 taps) depuis le patch global
const globalPatch = fs.readFileSync(GLOBAL_PATCH, "utf8");
const globalPatchLines = globalPatch.split(/\r?\n/);
const minusLines = globalPatchLines.filter((l) => l.startsWith("-precision mediump float;"));
if (minusLines.length !== 1) fail(`patch global : ${minusLines.length} lignes baseline « precision mediump float » attendues (1)`);
const baselineLine = minusLines[0].slice(1); // sans le préfixe "-"
if (!baselineLine.includes(OLD_BLOCK)) fail("patch global : la ligne baseline ne contient pas le bloc 9 taps (ancre dérivée ?)");
if (baselineLine.includes(NEW_BLOCK)) fail("patch global : la ligne baseline contient déjà le 4 taps");

// 3) ligne après = baseline avec la substitution
const afterLine = baselineLine.split(OLD_BLOCK).join(NEW_BLOCK);
if (afterLine === baselineLine) fail("substitution : aucune occurrence remplacée");
if (afterLine.includes(OLD_BLOCK)) fail("substitution : le bloc 9 taps subsiste après remplacement");
if (!afterLine.includes(NEW_BLOCK)) fail("substitution : le bloc 4 taps absent après remplacement");

// 4) numéro de ligne de la ligne baseline dans le fichier cible (baseline)
//    Calculé dynamiquement depuis le patch global : les numéros de ligne
//    « avant » de ses hunks SONT la baseline perf10. On parcourt les hunks
//    jusqu'à la ligne « precision mediump float; » (le compteur avance sur les
//    lignes de contexte et les suppressions, pas sur les ajouts).
//    Vérifié sur la baseline reconstruite (patch global appliqué en sens
//    inverse sur le build committé, round-trip blob 4926cd2..9418fd7) : la
//    ligne « precision mediump float; » y est la ligne 283.
const BASELINE_LINE_NO = (() => {
  let cur = 0;
  for (const l of globalPatchLines) {
    const m = l.match(/^@@ -(\d+)(?:,(\d+))? \+/);
    if (m) {
      cur = parseInt(m[1], 10);
      continue;
    }
    if (l.startsWith("-precision mediump float;")) return cur;
    if (l.startsWith(" ") || l.startsWith("-")) cur++;
  }
  fail("patch global : ligne baseline « precision mediump float » introuvable dans les hunks");
})();

// 5) lignes de contexte autour du shader dans le patch global (lignes inchangées
//    du hunk : « in vec4 position… » avant, « class VideoPlayer… » après). Un
//    hunk 3 lignes avec contexte est nécessaire : le hunk 1 ligne sans contexte
//    n'est pas appliqué par git apply / patch sur cette ligne géante (vérifié :
//    « patch failed …:283 » alors que le contenu matche octet-pour-octet).
const shaderIdx = globalPatchLines.findIndex((l) => l.startsWith("-precision mediump float;"));
if (shaderIdx < 0) fail("patch global : ligne shader introuvable dans les hunks");
const ctxPre = globalPatchLines[shaderIdx - 1];
const ctxPost = globalPatchLines[shaderIdx + 2];
if (!ctxPre || !ctxPost || ctxPre[0] !== " " || ctxPost[0] !== " ")
  fail("patch global : contexte autour du shader inattendu (lignes non-contexte)");
const HUNK_LINE = BASELINE_LINE_NO - 1; // 282 : ligne de contexte avant le shader

const crlf = (s) => s.replace(/\r?\n/g, "\r\n");
const out =
  crlf(`diff --git a/better-xcloud.user.js b/better-xcloud.user.js
index 4926cd2..0000000 100644
--- a/better-xcloud.user.js
+++ b/better-xcloud.user.js
@@ -${HUNK_LINE},3 +${HUNK_LINE},3 @@
 ${ctxPre.slice(1)}
-${baselineLine}
+${afterLine}
 ${ctxPost.slice(1)}
`);

fs.writeFileSync(OUT, out);
console.log(`✅ patch 22 écrit : ${path.relative(ROOT, OUT)} (${(out.length / 1024).toFixed(1)} Ko, hunk ligne baseline #${HUNK_LINE}-${HUNK_LINE + 2})`);
console.log("   Vérif : git -c core.autocrlf=false apply --check patches/22-webgl2-usm-4taps.patch");
