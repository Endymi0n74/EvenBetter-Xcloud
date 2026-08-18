#!/usr/bin/env node
/*
 * rebrand-bundle.js — applique le rebrand EvenBetterXcloud + la feature
 * « Sound » à un bundle userscript (stable ou preview) de façon DÉTERMINISTE,
 * avec gates (GATE ROUGE si un pattern a dérivé).
 *
 * Le bundle est un artefact commité (bun build upstream + patches). Ce script
 * est la seule source de vérité du rebrand : à chaque rebuild du bundle, on le
 * rejoue pour retrouver la marque. Chaque remplacement est compté et vérifié
 * (si un pattern a dérivé dans une future version du bundle, exit 1).
 *
 * Usage :
 *   node bench/rebrand-bundle.js <bundle.js> [--version=X.Y.Z] [--no-sound] [--dry-run]
 *
 * Ce que fait le script (cf. MEMORY.md §rebrand) :
 *   1. Header userscript : @name EvenBetterXcloud, @namespace/@author,
 *      @version (notre version), @updateURL/@downloadURL → repo EvenBetter-Xcloud.
 *   2. Constante BX_VERSION = notre version (affichée dans le badge du menu,
 *      à la place du SCRIPT_VERSION upstream 6.7.12) — le badge affiche
 *      « EvenBetterXcloud <version> ».
 *   3. Libellés visibles t("better-xcloud") → "EvenBetterXcloud" (badge,
 *      bouton header, titre du groupe) — la marque n'est pas traduite.
 *   4. Update-check : fetch vers NOTRE repo, comparaisons sur BX_VERSION,
 *      parse du tag (nos tags "evenbetter-xcloud-v1.9.0" / "-preview1").
 *   5. Feature Sound : groupe « sound » dans l'onglet GLOBAL (volume +
 *      booster, visible même déconnecté) — cf. patch son dans MEMORY.
 *   SCRIPT_VERSION upstream est CONSERVÉ tel quel (cache des patches,
 *   signature PatcherCache) — seul l'affichage utilisateur change.
 */
"use strict";
const fs = require("fs");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const versionArg = args.find((a) => a.startsWith("--version="));
const VERSION = versionArg ? versionArg.split("=")[1] : fs.readFileSync(__dirname + "/../VERSION", "utf8").trim();
const DO_SOUND = !args.includes("--no-sound");
const DRY_RUN = args.includes("--dry-run");
const IS_META = file.includes(".meta.js");
const BUMP_ONLY = args.includes("--bump-only");

if (!file) {
  console.error("usage: node bench/rebrand-bundle.js <bundle.js> [--version=X.Y.Z] [--no-sound] [--dry-run]");
  process.exit(1);
}

const REPO = "Endymi0n74/EvenBetter-Xcloud";
const REPO_OLD = "Endymi0n74/better-xcloud-perf";
const BRAND = "EvenBetterXcloud";

let s = fs.readFileSync(file, "utf8");
const results = [];
const original = s;

// Idempotence : si le bundle est déjà rebrandé (et la version déjà la bonne),
// on sort en no-op (exit 0) — ré-exécuter le script sur un bundle déjà traité
// ne doit pas faire GATE ROUGE.
if (s.includes("// @name         " + BRAND) && s.includes('BX_VERSION = "' + VERSION + '"')) {
  console.log("== rebrand-bundle " + file + " : déjà rebrandé (v" + VERSION + ") — no-op");
  process.exit(0);
}

// ---------- Bump-only : bundle déjà rebrandé, on ne change QUE la version ----------
// Placé AVANT les remplacements de header (qui attendent l'état NON rebrandé
// et feraient GATE ROUGE sur un bundle déjà traité).
if (BUMP_ONLY) {
  const bumpRe = (label, re, to) => {
    if (!re.test(s)) { results.push({ ok: false, name: label, found: 0 }); return; }
    s = s.replace(re, to);
    results.push({ ok: true, name: label });
  };
  bumpRe("@version -> " + VERSION, /\/\/ @version      [^\r\n]+/, "// @version      " + VERSION);
  // Un meta n'a ni BX_VERSION ni commentaire OPTIMISATIONS : on les saute.
  if (!IS_META) {
    bumpRe("BX_VERSION -> " + VERSION, /BX_VERSION = "[^"]*"/, 'BX_VERSION = "' + VERSION + '"');
    bumpRe("OPTIMISATIONS -> v" + VERSION, /OPTIMISATIONS v?[0-9][0-9a-z.\-]*/, "OPTIMISATIONS v" + VERSION);
  }
  const failsB = results.filter((r) => !r.ok);
  if (failsB.length) {
    console.error("❌ GATE ROUGE : " + failsB.length + " remplacement(s) en échec (bump-only)");
    process.exit(1);
  }
  if (!DRY_RUN) fs.writeFileSync(file, s);
  console.log("OK : " + file + " bumpé -> v" + VERSION + " (" + s.length + " o)");
  process.exit(0);
}
// Remplacement compté : expected = nombre d'occurrences attendues
// (0 = doit être ABSENT, "any" = au moins 1).
function rep(from, to, expected) {
  const count = s.split(from).length - 1;
  if (expected === 0) {
    results.push({ ok: count === 0, name: from.slice(0, 70), found: count, expected });
    return; // absence attendue : rien à remplacer
  }
  if (count === 0) {
    results.push({ ok: false, name: from.slice(0, 70), found: 0, expected });
    return;
  }
  if (expected !== "any" && expected !== undefined && count !== expected) {
    results.push({ ok: false, name: from.slice(0, 70), found: count, expected });
    return;
  }
  s = s.split(from).join(to);
  results.push({ ok: true, name: from.slice(0, 70), found: count });
}

const isPreview = file.includes("preview");

// ---------- 1. Header userscript ----------
rep("// @name         Better xCloud (Preview)", "// @name         " + BRAND + " (Preview)", isPreview ? 1 : 0);
rep("// @name         Better xCloud", "// @name         " + BRAND, isPreview ? 0 : 1);
rep("// @namespace    https://github.com/redphx", "// @namespace    https://github.com/" + REPO, 1);
rep("// @author       redphx", "// @author       Endymi0n74", 1);
rep("// @updateURL    https://github.com/" + REPO_OLD + "/", "// @updateURL    https://github.com/" + REPO + "/", 1);
rep("// @downloadURL  https://github.com/" + REPO_OLD + "/", "// @downloadURL  https://github.com/" + REPO + "/", 1);
// @version : la ligne peut être "1.8.0" ou "1.8.0-preview4"
const verRe = /\/\/ @version      [^\r\n]+/;
if (verRe.test(s)) {
  s = s.replace(verRe, "// @version      " + VERSION);
  results.push({ ok: true, name: "@version -> " + VERSION });
} else {
  results.push({ ok: false, name: "@version line", found: 0 });
}

// ---------- Meta : le fichier s'arrête au header ----------
if (IS_META) {
  const fails0 = results.filter((r) => !r.ok);
  if (fails0.length) {
    console.error("❌ GATE ROUGE : " + fails0.length + " remplacement(s) en échec (meta)");
    process.exit(1);
  }
  if (!DRY_RUN) fs.writeFileSync(file, s);
  console.log("OK : " + file + " (meta, " + s.length + " o)");
  process.exit(0);
}

// ---------- 2. BX_VERSION ----------
const svLineStable = 'var SCRIPT_VERSION = "6.7.12", SCRIPT_VARIANT = "full", AppInterface = window.AppInterface;';
const svLinePreview = 'var SCRIPT_VERSION = "6.7.12", SCRIPT_VARIANT = "full", AppInterface';
if (s.includes(svLineStable)) {
  s = s.replace(svLineStable, 'var SCRIPT_VERSION = "6.7.12", SCRIPT_VARIANT = "full", BX_VERSION = "' + VERSION + '", AppInterface = window.AppInterface;');
  results.push({ ok: true, name: "BX_VERSION injecté (ligne SCRIPT_VERSION)" });
} else if (s.includes(svLinePreview)) {
  s = s.replace(svLinePreview, 'var SCRIPT_VERSION = "6.7.12", SCRIPT_VARIANT = "full", BX_VERSION = "' + VERSION + '", AppInterface');
  results.push({ ok: true, name: "BX_VERSION injecté (ligne SCRIPT_VERSION preview)" });
} else {
  results.push({ ok: false, name: "ligne var SCRIPT_VERSION", found: 0 });
}

// ---------- 3. Libellés visibles ----------
rep('t("better-xcloud")', '"' + BRAND + '"', "any");

// ---------- 4. Update-check vers notre repo ----------
rep('function checkForUpdate() {if (SCRIPT_VERSION.includes("beta")) return',
    'function checkForUpdate() {if (BX_VERSION.includes("beta")) return', 1);
rep("if (currentVersion === SCRIPT_VERSION && now - lastCheck < CHECK_INTERVAL_SECONDS) return",
    "if (currentVersion === BX_VERSION && now - lastCheck < CHECK_INTERVAL_SECONDS) return", 1);
rep("Translations.updateTranslations(currentVersion === SCRIPT_VERSION)",
    "Translations.updateTranslations(currentVersion === BX_VERSION)", 1);
rep('if (!SCRIPT_VERSION.includes("beta") && PREF_LATEST_VERSION && PREF_LATEST_VERSION != SCRIPT_VERSION)',
    'if (!BX_VERSION.includes("beta") && PREF_LATEST_VERSION && PREF_LATEST_VERSION != BX_VERSION)', 1);
rep('if (!SCRIPT_VERSION.includes("beta") && PREF_LATEST_VERSION && PREF_LATEST_VERSION !== SCRIPT_VERSION)',
    'if (!BX_VERSION.includes("beta") && PREF_LATEST_VERSION && PREF_LATEST_VERSION !== BX_VERSION)', 1);
rep('setGlobalPref("version.current", SCRIPT_VERSION, "direct")',
    'setGlobalPref("version.current", BX_VERSION, "direct")', 1);
rep('fetch("https://api.github.com/repos/redphx/better-xcloud/releases/latest")',
    'fetch("https://api.github.com/repos/' + REPO + '/releases/latest")', 1);
rep('json.tag_name.substring(1)',
    '(json.tag_name.match(/(\\d+\\.\\d+(?:\\.\\d+)?(?:-[A-Za-z0-9]+)?)$/) || ["", ""])[1]', 1);
rep('opts.url = "https://github.com/redphx/better-xcloud/releases/latest"',
    'opts.url = "https://github.com/' + REPO + '/releases/latest"', 1);
rep('url: "https://github.com/redphx/better-xcloud/releases"',
    'url: "https://github.com/' + REPO + '/releases"', 1);

// ---------- Badge : version affichée = BX_VERSION ----------
rep('if (label += " " + SCRIPT_VERSION, SCRIPT_VARIANT === "lite")',
    'if (label += " " + BX_VERSION, SCRIPT_VARIANT === "lite")', 1);

// ---------- Commentaire OPTIMISATIONS ----------
// Matche uniquement la partie version (v1.8.0 / 1.8.0-preview4) et PRÉSERVE
// la suite de la ligne (le ":" et la mention VARIANTE PREVIEW) : la classe
// s'arrête à l'espace / au ":" — sinon on mangerait le reste du commentaire.
const optRe = /OPTIMISATIONS v?[0-9][0-9a-z.\-]*/;
if (optRe.test(s)) {
  s = s.replace(optRe, "OPTIMISATIONS v" + VERSION);
  results.push({ ok: true, name: "commentaire OPTIMISATIONS -> v" + VERSION });
} else {
  results.push({ ok: false, name: "commentaire OPTIMISATIONS", found: 0 });
}

// ---------- 5. Feature Sound (onglet global) ----------
if (DO_SOUND) {
  rep('"server.bypassRestriction","ui.controllerFriendly"]}, {group: "server"',
      '"server.bypassRestriction","ui.controllerFriendly"]}, {group: "sound",label: t("sound"),items: ["audio.volume.booster.enabled",{pref: "audio.volume",params: {disabled: !getGlobalPref("audio.volume.booster.enabled")}}]}, {group: "server"', 1);
  rep('section.group !== "general" && section.group !== "footer" && section.group !== "advanced"',
      'section.group !== "general" && section.group !== "footer" && section.group !== "advanced" && section.group !== "sound"', 1);
}

// ---------- Rapport ----------
const fails = results.filter((r) => !r.ok);
console.log("== rebrand-bundle " + file + " (version " + VERSION + (DO_SOUND ? ", sound" : "") + ") ==");
for (const r of results) {
  console.log((r.ok ? "  ✓ " : "  ✗ ") + r.name + (r.found !== undefined ? " ×" + r.found : ""));
}
if (fails.length) {
  console.error("\n❌ GATE ROUGE : " + fails.length + " remplacement(s) en échec (patterns dérivés ?)");
  process.exit(1);
}
if (s === original) {
  console.error("\n❌ GATE ROUGE : aucun changement appliqué (bundle déjà rebrandé ?)");
  process.exit(1);
}
if (!DRY_RUN) {
  fs.writeFileSync(file, s);
  console.log("\nOK : " + file + " écrit (" + s.length + " o)");
} else {
  console.log("\n(dry-run — rien écrit)");
}
