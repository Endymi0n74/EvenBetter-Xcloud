#!/usr/bin/env node
/*
 * feature-diag-purge.js — injecte la routine de purge des listeners de
 * diagnostic oubliés (v1.13.0) dans un bundle userscript (stable ou preview)
 * de façon DÉTERMINISTE, avec gates (GATE ROUGE si un pattern a dérivé).
 *
 * Le problème : pendant une session CDP (probes, debug), on peut attacher des
 * listeners de diagnostic sur `window` (ex. capturer les clics pour observer
 * l'état). Un listener oublié dont la fermeture référence une variable morte
 * (ex. `log.push(...)` avec `log` non défini) peut THROWER à chaque clic et
 * polluer la console / casser des listeners du bundle. Les listeners ne
 * survivent pas au reload — mais une session longue en accumule.
 *
 * La routine (injectée au démarrage, document-start) :
 *   - hook `window.addEventListener` / `window.removeEventListener` UNIQUEMENT
 *     (pas EventTarget.prototype : coût ~0 sur les listeners non-window) ;
 *   - enregistre tout listener dont la SOURCE contient le marqueur
 *     `win-capture` (convention des probes de diagnostic) ;
 *   - expose `window.BX_PURGE_DIAG()` qui retire tous les listeners marqués
 *     (les autres ne sont jamais touchés) — appelé une fois au démarrage
 *     (page neuve : no-op) et disponible pour les probes en fin de session.
 *
 * Convention pour les probes : tout listener de diagnostic attaché à window
 * doit contenir `win-capture` dans son corps (ex. un commentaire ou une
 * chaîne), et appeler `window.BX_PURGE_DIAG && window.BX_PURGE_DIAG()` à la
 * fin de son run.
 *
 * Usage :
 *   node bench/feature-diag-purge.js <bundle.js> [--dry-run] [--self-test]
 */
"use strict";
const fs = require("fs");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const DRY_RUN = args.includes("--dry-run");
const SELF_TEST = args.includes("--self-test");

if (!file) {
  console.error("usage: node bench/feature-diag-purge.js <bundle.js> [--dry-run] [--self-test]");
  process.exit(1);
}

// ---- Implémentation injectée (portée du bundle : window accessible) ----
const IMPL = `
(function () {
  if (window.BX_PURGE_DIAG) return; // déjà installé (double injection)
  var DIAG = [];
  var MARKER = /win-capture/;
  var origAdd = window.addEventListener.bind(window);
  var origRemove = window.removeEventListener.bind(window);
  window.addEventListener = function (type, fn, opts) {
    try {
      if (typeof fn === "function" && MARKER.test(Function.prototype.toString.call(fn))) {
        DIAG.push({ type: type, fn: fn, opts: opts });
      }
    } catch (e) {}
    return origAdd(type, fn, opts);
  };
  window.removeEventListener = function (type, fn, opts) {
    for (var i = 0; i < DIAG.length; i++) {
      if (DIAG[i].fn === fn) { DIAG.splice(i, 1); break; }
    }
    return origRemove(type, fn, opts);
  };
  window.BX_PURGE_DIAG = function () {
    var n = 0;
    for (var i = 0; i < DIAG.length; i++) {
      var d = DIAG[i];
      try {
        origRemove(d.type, d.fn, d.opts === true || (d.opts && d.opts.capture));
        n++;
      } catch (e) {}
    }
    DIAG.length = 0;
    return n;
  };
  window.BX_PURGE_DIAG(); // au démarrage : purge les restes éventuels (page neuve = no-op)
})();
`;

let s = fs.readFileSync(file, "utf8");
const original = s;
const results = [];

// Idempotence : déjà injecté → no-op exit 0.
if (s.includes("window.BX_PURGE_DIAG")) {
  console.log("== feature-diag-purge " + file + " : déjà injectée — no-op");
  process.exit(0);
}

// Ancre d'injection (même point que les autres features — l'IMPL purge passe
// AVANT les IMPL précédemment injectées, donc au plus tôt des features).
const ANCHOR_BX = "window.BX_EXPOSED = BxExposed;";

function count(hay, needle) { return hay.split(needle).length - 1; }

const n1 = count(s, ANCHOR_BX);
if (n1 !== 1) {
  results.push({ ok: false, name: "ancre BX_EXPOSED", found: n1, expected: 1 });
} else {
  s = s.replace(ANCHOR_BX, ANCHOR_BX + IMPL);
  results.push({ ok: true, name: "routine BX_PURGE_DIAG injectée", found: 1 });
}

// Rapport
const fails = results.filter((r) => !r.ok);
console.log("== feature-diag-purge " + file + " ==");
for (const r of results) {
  console.log((r.ok ? "  ✓ " : "  ✗ ") + r.name + (r.found !== undefined ? " ×" + r.found : ""));
}
if (fails.length) {
  console.error("\n❌ GATE ROUGE : " + fails.length + " ancre(s) dérivée(s) — la routine ne s'injecte pas");
  process.exit(1);
}

// Syntaxe de l'ensemble
try {
  new Function(s.slice(s.indexOf("// ==UserScript==")));
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
  let bad = original.replace(ANCHOR_BX, "window.BX_EXPOSED_CHANGED = BxExposed;");
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
