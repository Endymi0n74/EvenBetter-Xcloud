#!/usr/bin/env node
/*
 * feature-latency.js — injecte la feature « 📡 Test de latence serveur » (v1.10.0)
 * dans un bundle userscript (stable ou preview) de façon DÉTERMINISTE, avec
 * gates (GATE ROUGE si un pattern a dérivé).
 *
 * La feature : un bouton « Tester la latence des serveurs » dans le groupe
 * SERVER des settings globaux. Au clic, elle ping chaque région gssv
 * (STATES.serverRegions, la liste réelle chargée par le client) via
 * NATIVE_FETCH (le fetch ORIGINAL du navigateur, capturé par le script — pas
 * le hook BX_FETCH ni l'XcloudInterceptor), mesure le RTT (avec timeout 3 s),
 * et marque la meilleure région « ⭐ recommandé » pour aider à choisir
 * `server.region`.
 *
 * Pourquoi NATIVE_FETCH : l'XcloudInterceptor du script route les URLs
 * finissant par /sessions/cloud/play vers handlePlay (rewrite de région) —
 * un ping naïf serait réécrit. Le suffixe `?probe=1` + NATIVE_FETCH garantit
 * une mesure pure du réseau vers la région cible.
 *
 * Usage :
 *   node bench/feature-latency.js <bundle.js> [--dry-run] [--self-test]
 */
"use strict";
const fs = require("fs");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const DRY_RUN = args.includes("--dry-run");
const SELF_TEST = args.includes("--self-test");

if (!file) {
  console.error("usage: node bench/feature-latency.js <bundle.js> [--dry-run] [--self-test]");
  process.exit(1);
}

// ---- Implémentation injectée (lisible, collée dans la portée du bundle :
// CE / t / STATES / NATIVE_FETCH / performance / Promise sont accessibles) ----
const IMPL = `
window.BX_LATENCY_TEST = {render: function ($parent) {
  var box = CE("div", {});
  var list = CE("div", {});
  var btn = CE("button", {class: "bx-focusable", style: "width:100%;margin:6px 0;padding:8px 10px;border-radius:4px;background:#107c10;color:#fff;cursor:pointer;font-weight:600;"}, "📡 Tester la latence des serveurs");
  btn.addEventListener("click", function () {window.BX_LATENCY_TEST.run(btn, list);});
  box.appendChild(btn), box.appendChild(list), $parent.appendChild(box);
}, run: async function (btn, list) {
  var regions = (window.STATES && STATES.serverRegions) || {};
  var names = Object.keys(regions).sort();
  btn.disabled = true;
  var orig = btn.innerText;
  btn.innerText = "📡 Test en cours…";
  list.innerText = "";
  if (names.length === 0) {
    list.appendChild(CE("div", {style: "opacity:.7;padding:6px 0;"}, "Aucune région disponible."));
    btn.disabled = false, btn.innerText = orig;
    return;
  }
  var fetchFn = typeof NATIVE_FETCH === "function" ? NATIVE_FETCH : window.fetch.bind(window);
  var results = [];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var r = regions[name] || {};
    // hôte propre : baseUri (ex. https://eus.core.gssv-play-prod.xboxlive.com) —
    // PAS shortName (contient l'emoji drapeau « 🇺🇸 EUS » → hôte invalide)
    var url = (r.baseUri || ("https://" + (r.name || name).toLowerCase() + ".core.gssv-play-prod.xboxlive.com")) + "/v5/sessions/cloud/play?probe=1";
    var t0 = performance.now(), ms = -1;
    try {
      await Promise.race([
        fetchFn(url, {mode: "no-cors", cache: "no-store"}),
        new Promise(function (resolve, reject) {setTimeout(function () {reject(new Error("timeout"));}, 3000);}),
      ]);
      ms = performance.now() - t0;
    } catch (e) {ms = -1;}
    results.push({code: r.shortName || r.name || name, label: r.displayName || name, ms: ms, isDefault: !!r.isDefault});
    list.appendChild(CE("div", {style: "display:flex;justify-content:space-between;gap:8px;padding:2px 4px;"},
      CE("span", {}, (r.shortName || r.name || name) + " — " + (r.displayName || name) + (r.isDefault ? " (défaut)" : "")),
      CE("span", {}, ms >= 0 ? Math.round(ms) + " ms" : "—")));
  }
  results.sort(function (a, b) {return (a.ms < 0 ? 1e5 : a.ms) - (b.ms < 0 ? 1e5 : b.ms);});
  if (results.length && results[0].ms >= 0) {
    var best = results[0];
    list.insertBefore(CE("div", {style: "padding:6px 4px;font-weight:700;color:#7ed321;"}, "⭐ " + best.code + " (" + Math.round(best.ms) + " ms) — région recommandée"), list.firstChild);
  }
  btn.disabled = false, btn.innerText = "📡 Relancer le test";
}};`;

let s = fs.readFileSync(file, "utf8");
const original = s;
const results = [];

// Idempotence : déjà injecté → no-op exit 0.
if (s.includes("window.BX_LATENCY_TEST")) {
  console.log("== feature-latency " + file + " : déjà injectée — no-op");
  process.exit(0);
}

const ANCHOR_BX = "window.BX_EXPOSED = BxExposed;";
const ANCHOR_SERVER = '{group: "server",label: t("server"),items: [{pref: "server.region",multiLines: !0},{pref: "stream.locale",multiLines: !0},"server.ipv6.prefer"]}';

function count(hay, needle) { return hay.split(needle).length - 1; }

// 1. Implémentation (après BX_EXPOSED)
const n1 = count(s, ANCHOR_BX);
if (n1 !== 1) {
  results.push({ ok: false, name: "ancre BX_EXPOSED", found: n1, expected: 1 });
} else {
  s = s.replace(ANCHOR_BX, ANCHOR_BX + IMPL);
  results.push({ ok: true, name: "implémentation BX_LATENCY_TEST injectée", found: 1 });
}

// 2. Bouton dans le groupe SERVER
const n2 = count(s, ANCHOR_SERVER);
if (n2 !== 1) {
  results.push({ ok: false, name: "groupe SERVER", found: n2, expected: 1 });
} else {
  s = s.replace(ANCHOR_SERVER, ANCHOR_SERVER.replace('"server.ipv6.prefer"]}', '"server.ipv6.prefer",($parent) => {window.BX_LATENCY_TEST.render($parent);}]}'));
  results.push({ ok: true, name: "bouton latence ajouté au groupe SERVER", found: 1 });
}

// Rapport
const fails = results.filter((r) => !r.ok);
console.log("== feature-latency " + file + " ==");
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
  let bad = original.replace(ANCHOR_BX, "window.BX_EXPOSED = BxExposed_CHANGED;");
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
