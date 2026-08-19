#!/usr/bin/env node
/*
 * feature-datasaver.js — injecte la feature « 📊 Données » (v1.11.0) dans un
 * bundle userscript (stable ou preview) de façon DÉTERMINISTE, avec gates
 * (GATE ROUGE si un pattern a dérivé).
 *
 * La feature : un groupe « Données » dans les settings globaux avec 3
 * presets débit/résolution en un clic, basés sur les MESURES RÉELLES du 18
 * août (bench/README.md « Préférences utilisateur mesurées ») :
 *   - 🚀 Max (défaut)      : débit illimité (15360000 = max du slider ;
 *                            transformValue.set le rend équivalent au
 *                            défaut 0 — forme persistée : 15360000)
 *   - ⚖️ Équilibré (rec.)  : cap 10 Mbps + auto  → 1440p conservé, ~6,6 Mbps
 *                            réels (le cap maxBitrate est le seul réglage qui
 *                            économise SANS perdre la définition)
 *   - 🌱 Économe           : cap 5 Mbps + 720p → ~4,7 Mbps réels
 * (1080p/1080p-hq sont des no-op sur PC — mesuré — donc non proposés.)
 *
 * Le groupe est ajouté à la liste des groupes rendus même déconnecté
 * (renderFullSettings=false) pour poser les presets AVANT de lancer une
 * session. Les prefs stream.video.* sont classées GLOBALES (ALL_PREFS.global)
 * → lues/écrites via getGlobalPref/setGlobalPref(key, value, "ui") — le même
 * chemin que les selects du script (validate + persist + event UI).
 * ⚠ Piège : getStreamPref pour stream.video.* THROWE (définitions du storage
 * stream sans ces clés — elles vivent dans GlobalSettingsStorage.DEFINITIONS).
 *
 * Usage :
 *   node bench/feature-datasaver.js <bundle.js> [--dry-run] [--self-test]
 */
"use strict";
const fs = require("fs");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const DRY_RUN = args.includes("--dry-run");
const SELF_TEST = args.includes("--self-test");

if (!file) {
  console.error("usage: node bench/feature-datasaver.js <bundle.js> [--dry-run] [--self-test]");
  process.exit(1);
}

// ---- Implémentation injectée (portée du bundle : CE / t / getStreamPref /
// setStreamPref / performance accessibles) ----
const IMPL = `
window.BX_DATA_SAVER = {render: function ($parent) {
  var box = CE("div", {});
  var note = CE("div", {style: "opacity:.75;font-size:12px;padding:2px 0 6px;"}, "Basé sur nos mesures (18 août) : le cap maxBitrate est fiable (1440p conservé), 1080p/1080p-hq sont sans effet sur PC.");
  var status = CE("div", {style: "padding:2px 0 6px;font-weight:600;"});
  function fmt(br) {
    // transformValue.get mappe le stocké 0 → 15360000 (max du slider) =
    // « illimité » ; tout cap réel est < max.
    if (!br || br >= 15360000) return "illimité";
    return Math.round(br / 100000) / 10 + " Mbps";
  }
  function refresh() {
    status.innerText = "Actuel — débit max : " + fmt(getGlobalPref("stream.video.maxBitrate")) + " · résolution : " + (getGlobalPref("stream.video.resolution") || "auto");
  }
  refresh();
  var presets = [
    {label: "🚀 Max (défaut)", desc: "débit illimité · résolution auto", br: 15360000, res: "auto"},
    {label: "⚖️ Équilibré (recommandé)", desc: "cap 10 Mbps · 1440p conservé (~6,6 Mbps réels)", br: 10240000, res: "auto"},
    {label: "🌱 Économe", desc: "cap 5 Mbps · 720p (~4,7 Mbps réels)", br: 5120000, res: "720p"},
  ];
  presets.forEach(function (p) {
    var btn = CE("button", {class: "bx-focusable", style: "display:block;width:100%;margin:4px 0;padding:8px 10px;border-radius:4px;background:#1f2937;color:#fff;cursor:pointer;text-align:left;"},
      CE("div", {style: "font-weight:600;"}, p.label),
      CE("div", {style: "opacity:.75;font-size:12px;"}, p.desc));
    btn.addEventListener("click", function () {
      setGlobalPref("stream.video.maxBitrate", p.br, "ui");
      setGlobalPref("stream.video.resolution", p.res, "ui");
      refresh();
      note.innerText = "✅ " + p.label + " appliqué — en vigueur au prochain lancement de session.";
    });
    box.appendChild(btn);
  });
  box.appendChild(note);
  box.appendChild(status);
  $parent.appendChild(box);
}};`;

let s = fs.readFileSync(file, "utf8");
const original = s;
const results = [];

// Idempotence : déjà injecté → no-op exit 0.
if (s.includes("window.BX_DATA_SAVER")) {
  console.log("== feature-datasaver " + file + " : déjà injectée — no-op");
  process.exit(0);
}

const ANCHOR_BX = "window.BX_EXPOSED = BxExposed;";
const ANCHOR_GROUP = '{group: "server",label: t("server")';
const ANCHOR_FILTER = 'section.group !== "sound") continue;';

function count(hay, needle) { return hay.split(needle).length - 1; }

// 1. Implémentation (après BX_EXPOSED)
const n1 = count(s, ANCHOR_BX);
if (n1 !== 1) {
  results.push({ ok: false, name: "ancre BX_EXPOSED", found: n1, expected: 1 });
} else {
  s = s.replace(ANCHOR_BX, ANCHOR_BX + IMPL);
  results.push({ ok: true, name: "implémentation BX_DATA_SAVER injectée", found: 1 });
}

// 2. Groupe « Données » inséré avant le groupe server (rendu même déconnecté
//    via le filtre ANCHOR_FILTER). Les prefs maxBitrate/resolution y figurent
//    aussi → un seul endroit pour tout ce qui touche au débit.
const n2 = count(s, ANCHOR_GROUP);
if (n2 !== 1) {
  results.push({ ok: false, name: "groupe server (ancre d'insertion)", found: n2, expected: 1 });
} else {
  const dataGroup = '{group: "data",label: "📊 Données",items: ["stream.video.maxBitrate","stream.video.resolution",($parent) => {window.BX_DATA_SAVER.render($parent);}]},' + ANCHOR_GROUP;
  s = s.replace(ANCHOR_GROUP, dataGroup);
  results.push({ ok: true, name: "groupe Données inséré (prefs + presets)", found: 1 });
}

// 3. Groupe « Données » visible sans connexion (renderFullSettings=false)
const n3 = count(s, ANCHOR_FILTER);
if (n3 !== 1) {
  results.push({ ok: false, name: "filtre rendu déconnecté (sound)", found: n3, expected: 1 });
} else {
  s = s.replace(ANCHOR_FILTER, 'section.group !== "sound" && section.group !== "data") continue;');
  results.push({ ok: true, name: "groupe Données ajouté au rendu déconnecté", found: 1 });
}

// Rapport
const fails = results.filter((r) => !r.ok);
console.log("== feature-datasaver " + file + " ==");
for (const r of results) {
  console.log((r.ok ? "  ✓ " : "  ✗ ") + r.name + (r.found !== undefined ? " ×" + r.found : ""));
}
if (fails.length) {
  console.error("\n❌ GATE ROUGE : " + fails.length + " ancre(s) dérivée(s) — la feature ne s'injecte pas");
  process.exit(1);
}

// Syntaxe de l'ensemble
try {
  new Function(s.slice(s.indexOf("// ==UserScript=="))); // ne compile pas le header, on teste la syntaxe
} catch (e) {
  console.error("\n❌ GATE ROUGE : syntaxe invalide après injection — " + e.message);
  process.exit(1);
}

if (!DRY_RUN) {
  fs.writeFileSync(file, s);
  console.log("\nOK : " + file + " écrit (" + s.length + " o)");
} else {
  console.log("\n(dry-run — rien écrit)");
}

// --self-test : rejoue le chemin d'échec sur une copie corrompue (contenu
// PRÉ-injection — sinon l'idempotence sort en no-op exit 0)
if (SELF_TEST) {
  let bad = original.replace(ANCHOR_GROUP, '{group: "server",label: t("server_CHANGED")');
  const exitCode = (() => {
    try {
      const child = require("child_process");
      const tmp = file + ".selftest.js";
      fs.writeFileSync(tmp, bad);
      const r = child.spawnSync(process.execPath, [__filename, tmp], { encoding: "utf8" });
      fs.unlinkSync(tmp);
      return r.status;
    } catch (e) { return -1; }
  })();
  if (exitCode === 1) {
    console.log("\nSELF-TEST OK : ancre corrompue → GATE ROUGE (exit 1)");
    process.exit(0);
  }
  console.error("\n❌ SELF-TEST FAIL : exit attendu 1, obtenu " + exitCode);
  process.exit(1);
}
