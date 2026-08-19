#!/usr/bin/env node
/*
 * feature-region.js — injecte la feature « ⚡ Appliquer la meilleure région »
 * (v1.12.0) dans un bundle userscript (stable ou preview) de façon
 * DÉTERMINISTE, avec gates (GATE ROUGE si un pattern a dérivé).
 *
 * La feature : un bouton « Appliquer la meilleure région » dans le groupe
 * SERVER des settings globaux, juste sous le test de latence (v1.10.0). Une
 * fois le test exécuté, le bouton affiche la meilleure région mesurée et
 * pose `server.region` (pref GLOBALE, valeur = la CLÉ de la région dans
 * STATES.serverRegions — ex. "CSE", pas shortName qui contient l'emoji
 * drapeau). Même chemin que les selects du script :
 * setGlobalPref("server.region", key, "ui") (validate + persist + event UI).
 *
 * Dépendances : la feature requiert feature-latency.js injecté (elle lit
 * window.BX_LATENCY_TEST.lastResults). feature-region.js PATCHE donc aussi
 * l'implémentation du test latence en 2 points minimaux :
 *   1. results.push(...) → + key: name (la clé de région, pour poser la pref)
 *   2. fin de run() → window.BX_LATENCY_TEST.lastResults = results + refresh
 *      du bouton (le bouton s'active en direct après chaque test, sans
 *      rouvrir les settings)
 * Les ancres de ces 2 patches sont extraites du SOURCE de feature-latency.js
 * (pas en dur) → si le test latence dérive, le gate devient ROUGE au lieu de
 * patcher à l'aveugle.
 *
 * Usage :
 *   node bench/feature-region.js <bundle.js> [--dry-run] [--self-test]
 */
"use strict";
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const DRY_RUN = args.includes("--dry-run");
const SELF_TEST = args.includes("--self-test");

if (!file) {
  console.error("usage: node bench/feature-region.js <bundle.js> [--dry-run] [--self-test]");
  process.exit(1);
}

// ---- Ancres du test latence, extraites du SOURCE de feature-latency.js ----
const LATENCY_SRC = fs.readFileSync(path.join(__dirname, "feature-latency.js"), "utf8").replace(/\r\n/g, "\n");
const IMPL_LATENCY = (LATENCY_SRC.match(/const IMPL = \`([^]*?)\`;/) || [])[1];
if (!IMPL_LATENCY) {
  console.error("❌ GATE : IMPL non extractible depuis feature-latency.js (const renommée ?)");
  process.exit(1);
}
const ANCHOR_PUSH = "results.push({code: r.shortName || r.name || name, label: r.displayName || name, ms: ms, isDefault: !!r.isDefault});";
const ANCHOR_DONE = 'btn.disabled = false, btn.innerText = "📡 Relancer le test";';
if (!IMPL_LATENCY.includes(ANCHOR_PUSH) || !IMPL_LATENCY.includes(ANCHOR_DONE)) {
  console.error("❌ GATE : ancres du test latence introuvables dans feature-latency.js (implémentation modifiée ?)");
  process.exit(1);
}

// ---- Implémentation injectée (portée du bundle : CE / getGlobalPref /
// setGlobalPref / window accessibles) ----
const IMPL = `
window.BX_REGION_APPLY = {render: function ($parent) {
  var box = CE("div", {});
  var status = CE("div", {class: "bx-region-status", style: "padding:6px 0 4px;font-weight:600;"}, "Lancez d'abord « 📡 Tester la latence des serveurs » pour obtenir la meilleure région.");
  var btn = CE("button", {class: "bx-focusable bx-region-apply", style: "width:100%;margin:4px 0;padding:8px 10px;border-radius:4px;background:#7d4fc9;color:#fff;cursor:pointer;font-weight:600;"}, "⚡ Appliquer la meilleure région");
  btn.disabled = true; // état par défaut correct même si aucun refresh ne passe
  btn.addEventListener("click", function () {
    var best = window.BX_REGION_APPLY.best();
    if (!best) return;
    setGlobalPref("server.region", best.key, "ui");
    status.innerText = "✅ " + best.code + " appliquée — en vigueur au prochain lancement de session.";
    btn.disabled = true;
  });
  box.appendChild(status), box.appendChild(btn), $parent.appendChild(box);
  // Refresh RETARDÉ : le dialog attache le groupe APRÈS avoir rendu tous les
  // items — un refresh synchrone ne trouve pas encore status/btn dans le
  // document. On pole jusqu'à ce que le groupe soit attaché (borné 6 s), puis
  // chaque ré-ouverture re-rend les items → nouveau refresh retardé.
  (function waitReady(attempt) {
    if (attempt > 30) return;
    if (document.querySelector(".bx-settings-dialog .bx-region-status")) {
      window.BX_REGION_APPLY.refresh();
      return;
    }
    setTimeout(function () { waitReady(attempt + 1); }, 200);
  })(0);
}, best: function () {
  var res = window.BX_LATENCY_TEST && window.BX_LATENCY_TEST.lastResults;
  if (!res || !res.length) return null;
  return res.filter(function (r) { return r.ms >= 0 && r.key; }).sort(function (a, b) { return a.ms - b.ms; })[0] || null;
}, refresh: function () {
  var status = document.querySelector(".bx-settings-dialog .bx-region-status");
  var btn = document.querySelector(".bx-settings-dialog .bx-region-apply");
  if (!status || !btn) return;
  var best = window.BX_REGION_APPLY.best();
  if (!best) {
    status.innerText = "Lancez d'abord « 📡 Tester la latence des serveurs » pour obtenir la meilleure région.";
    btn.disabled = true;
    return;
  }
  var cur = getGlobalPref("server.region");
  if (cur === best.key) {
    status.innerText = "⭐ " + best.code + " (" + Math.round(best.ms) + " ms) — déjà appliquée ✅";
    btn.disabled = true;
    return;
  }
  status.innerText = "⭐ " + best.code + " (" + Math.round(best.ms) + " ms) · actuelle : " + (cur || "défaut") + " — cliquer pour appliquer";
  btn.disabled = false;
}};`;

let s = fs.readFileSync(file, "utf8");
const original = s;
const results = [];

// Idempotence : déjà injecté → no-op exit 0.
if (s.includes("window.BX_REGION_APPLY")) {
  console.log("== feature-region " + file + " : déjà injectée — no-op");
  process.exit(0);
}

const ANCHOR_BX = "window.BX_EXPOSED = BxExposed;";
const ANCHOR_ITEM = ",($parent) => {window.BX_LATENCY_TEST.render($parent);}]}";

function count(hay, needle) { return hay.split(needle).length - 1; }

// 1. Implémentation (après BX_EXPOSED — même ancre que les autres features)
const n1 = count(s, ANCHOR_BX);
if (n1 !== 1) {
  results.push({ ok: false, name: "ancre BX_EXPOSED", found: n1, expected: 1 });
} else {
  s = s.replace(ANCHOR_BX, ANCHOR_BX + IMPL);
  results.push({ ok: true, name: "implémentation BX_REGION_APPLY injectée", found: 1 });
}

// 2. Patch du test latence — la clé de région dans les résultats (pour poser
//    la pref server.region sans l'emoji drapeau de shortName)
const n2 = count(s, ANCHOR_PUSH);
if (n2 !== 1) {
  results.push({ ok: false, name: "patch latence — results.push (key)", found: n2, expected: 1 });
} else {
  s = s.replace(ANCHOR_PUSH, "results.push({code: r.shortName || r.name || name, label: r.displayName || name, ms: ms, isDefault: !!r.isDefault, key: name});");
  results.push({ ok: true, name: "latence : key de région ajoutée aux résultats", found: 1 });
}

// 3. Patch du test latence — mémorise les résultats + refresh du bouton
const n3 = count(s, ANCHOR_DONE);
if (n3 !== 1) {
  results.push({ ok: false, name: "patch latence — fin de run (lastResults)", found: n3, expected: 1 });
} else {
  s = s.replace(ANCHOR_DONE, "window.BX_LATENCY_TEST.lastResults = results;window.BX_REGION_APPLY && window.BX_REGION_APPLY.refresh && window.BX_REGION_APPLY.refresh();" + ANCHOR_DONE);
  results.push({ ok: true, name: "latence : lastResults mémorisés + refresh bouton", found: 1 });
}

// 4. Bouton dans le groupe SERVER, juste après le test latence
const n4 = count(s, ANCHOR_ITEM);
if (n4 !== 1) {
  results.push({ ok: false, name: "item latence (groupe SERVER)", found: n4, expected: 1 });
} else {
  s = s.replace(ANCHOR_ITEM, ",($parent) => {window.BX_LATENCY_TEST.render($parent);},($parent) => {window.BX_REGION_APPLY.render($parent);}]}");
  results.push({ ok: true, name: "bouton Appliquer la meilleure région ajouté au groupe SERVER", found: 1 });
}

// Rapport
const fails = results.filter((r) => !r.ok);
console.log("== feature-region " + file + " ==");
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
  let bad = original.replace(ANCHOR_PUSH, "results.push({code: r.shortName_CHANGED || r.name || name, label: r.displayName || name, ms: ms, isDefault: !!r.isDefault});");
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
