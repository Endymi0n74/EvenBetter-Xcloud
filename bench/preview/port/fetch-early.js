#!/usr/bin/env node
/*
 * fetch-early.js — mesure de la viabilité de l'injection document-start pour
 * P2/P3 côté userscript (build preview).
 *
 * Contexte (session.md, « Paradoxe résolu ») : le SDK preview capture la
 * référence `fetch` au chargement d'entry.client (classe `ub`, paramètre par
 * défaut `i=fetch`, clients instanciés au bootstrap) — un hook posé APRÈS
 * (console, harnais de capture) est contourné. MAIS le build preview est
 * `@run-at document-start` + `@grant none` : si main() pose `window.fetch`
 * (hook du stable, XcloudInterceptor) AVANT le chargement d'entry.client,
 * alors la référence capturée par le SDK EST notre hook → P2/P3 deviennent
 * viables côté userscript, sans CDP.
 *
 * Ce harnais mesure la chaîne en 3 volets :
 *   1. Garde « Not xCloud page » (T6) : sur play.xbox.com, main() s'exécute
 *      (le garde ne throw plus) — sinon pas de hook du tout.
 *   2. Probes statiques du build généré : @run-at document-start, main()
 *      au top-level, hook `window.BX_FETCH = window.fetch =` posé dans
 *      interceptHttpRequests(), T6 présent AVANT main().
 *   3. Capture SDK : dans un vm, la classe `ub` réelle (pattern du bundle,
 *      `i=fetch` par défaut + `new ub(void 0, [...])`) instanciée APRÈS le
 *      hook → sa référence `_baseFetchImpl` === notre hook, et un fetch play
 *      passé par le client est bien vu par le hook.
 *
 * Usage : node bench/preview/port/fetch-early.js [chemin-build-preview]
 *        node bench/preview/port/fetch-early.test.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_BUILD = path.join(ROOT, "better-xcloud-preview.user.js");

// ---------- 1. garde T6 : main() s'exécute-t-il sur play.xbox.com ? ----------
// Fragment exact du build (T6) : on simule l'évaluation du garde avec
// BX_PREVIEW selon le hostname et le pathname de la page.
const GUARD_SRC = `(function (BX_PREVIEW, pathname) {
  if (!BX_PREVIEW && !pathname.match(/^\\/[a-zA-Z]{2}-[a-zA-Z]{2}\\/play/)) throw Error("[Better xCloud] Not xCloud page");
  return "ok";
})`;

function guardBehavior(bxPreview, pathname) {
  try {
    return { threw: false, value: vm.runInNewContext(`(${GUARD_SRC})(${bxPreview}, ${JSON.stringify(pathname)})`) };
  } catch (e) {
    return { threw: true, error: e.message };
  }
}

// ---------- 2. probes statiques du build généré ----------
function probeBuild(src) {
  const EOL = "\n";
  const probes = {
    "run-at document-start": src.includes("// @run-at       document-start"),
    "grant none": src.includes("// @grant        none"),
    "main() au top-level (appel synchrone, pas différé)": (() => {
      // T5 (keepalive) est ajouté APRÈS main() par le build : main(); n'est pas
      // en fin de fichier. Un appel au top-level est précédé de la définition
      // qui se termine par `}` (le corps de function main() {…} est sur la
      // même ligne, donc la ligne juste avant main(); se termine par `}`) ;
      // un appel différé (DOMContentLoaded) serait dans un callback, pas ici.
      const lines = src.replace(/\r\n/g, EOL).split(EOL);
      const call = lines.findIndex((l) => l.trim() === "main();");
      if (call < 0) return false;
      const prev = lines.slice(Math.max(0, call - 1), call)[0] || "";
      return prev.trim().endsWith("}");
    })(),
    "T6 garde neutralisé (BX_PREVIEW avant pathname)": src.includes('if (!BX_PREVIEW && !window.location.pathname.match(/^\\/(?:[a-zA-Z]{2}-[a-zA-Z]{2}\\/)?play/)) throw Error("[Better xCloud] Not xCloud page");'),
    "hook fetch posé (BX_FETCH = window.fetch =)": src.includes("window.BX_FETCH = window.fetch ="),
    "hook posé avant main() (interceptHttpRequests défini avant main)": (() => {
      const iHook = src.indexOf("function interceptHttpRequests()");
      const iMain = src.indexOf("function main()");
      return iHook >= 0 && iMain >= 0 && iHook < iMain;
    })(),
    "T6 avant main() (garde ne tue pas le hook)": (() => {
      const iGuard = src.indexOf("if (!BX_PREVIEW && !window.location.pathname.match(/^\\/(?:[a-zA-Z]{2}-[a-zA-Z]{2}\\/)?play/))");
      const iMain = src.indexOf("main();");
      return iGuard >= 0 && iMain >= 0 && iGuard < iMain;
    })(),
  };
  const ok = Object.values(probes).every(Boolean);
  return { ok, probes };
}

// ---------- 3. capture SDK : la classe ub réelle attrape-t-elle notre hook ? ----------
// Pattern réel du bundle preview (entry.client-h6o444u3.js, offset 777849) :
//   ub=class{constructor(e,t=[],n=[],r=[],i=fetch){...this._baseFetchImpl=i...}}
//   ... this.httpClient=new ub(void 0,[i]) ... ; kM(...).build() → new ub(..., fetch)
// On reproduit ce pattern dans un vm : window.fetch est d'abord notre hook
// (comme après main() en document-start), puis la classe est instanciée.
const SDK_CAPTURE_SRC = `
(function () {
  var NATIVE_FETCH = window.fetch;          // le fetch natif (avant hook)
  var seen = [];                             // les URLs que notre hook voit
  window.BX_FETCH = window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    seen.push(url);
    return NATIVE_FETCH(input, init);
  };
  // classe ub réelle (pattern minifié du bundle, i=fetch par défaut)
  var ub = class { constructor(e, t, n, r, i) { this._authenticator = e; this._baseFetchImpl = i === undefined ? fetch : i; } };
  // instanciation au bootstrap, comme entry.client : new ub(void 0, [interceptor])
  var httpClient = new ub(void 0, [{}]);
  var built = new ub(void 0, [{}], [], [], fetch);   // build() → fetch par défaut
  return {
    capturedHttpClient: httpClient._baseFetchImpl === window.fetch,
    capturedBuild: built._baseFetchImpl === window.fetch,
    capturedIsHook: httpClient._baseFetchImpl === window.BX_FETCH,
    nativePreserved: NATIVE_FETCH !== window.fetch,
  };
})();
`;

function simulateSdkCapture() {
  const sandbox = {
    window: undefined,
    fetch: (input, init) => Promise.resolve({ status: 200, url: typeof input === "string" ? input : "", ok: true }),
    Response: function () {},
    URL,
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const out = vm.runInContext(SDK_CAPTURE_SRC, sandbox);
  return { ok: out.capturedHttpClient && out.capturedBuild && out.capturedIsHook && out.nativePreserved, ...out };
}

// ---------- 4. point d'entrée ----------
function measure(buildPath) {
  const src = fs.readFileSync(buildPath, "utf8");
  const g1 = guardBehavior(true, "/stream/9N683TDT5M7R/halo-campaign-evolved");
  const g2 = guardBehavior(true, "/products/9N683TDT5M7R/halo-campaign-evolved");
  const g3 = guardBehavior(true, "/");
  const gStable = guardBehavior(false, "/fr-fr/play");
  const gStableNoMatch = guardBehavior(false, "/stream/9N683TDT5M7R");
  const build = probeBuild(src);
  const sdk = simulateSdkCapture();
  return {
    guard: {
      previewStream: g1, previewProducts: g2, previewRoot: g3,
      stablePlay: gStable, stableNoMatch: gStableNoMatch,
    },
    build,
    sdk,
  };
}

module.exports = { measure, guardBehavior, probeBuild, simulateSdkCapture, GUARD_SRC, SDK_CAPTURE_SRC };

// exécution directe : rapport markdown
if (require.main === module) {
  const buildPath = process.argv[2] || DEFAULT_BUILD;
  if (!fs.existsSync(buildPath)) { console.error("build introuvable : " + buildPath); process.exit(1); }
  const r = measure(buildPath);
  console.log("# Mesure injection document-start — P2/P3 côté userscript\n");
  console.log("- Build analysé : " + buildPath + "\n");
  console.log("## 1. Garde « Not xCloud page » (T6)");
  console.log("| Page | BX_PREVIEW | pathname | Résultat |");
  console.log("|---|---|---|---|");
  console.log("| preview stream | true | `/stream/…` | " + (r.guard.previewStream.threw ? "THROW ❌" : "main() atteint ✅") + " |");
  console.log("| preview products | true | `/products/…` | " + (r.guard.previewProducts.threw ? "THROW ❌" : "main() atteint ✅") + " |");
  console.log("| preview root | true | `/` | " + (r.guard.previewRoot.threw ? "THROW ❌" : "main() atteint ✅") + " |");
  console.log("| stable play (pathname valide) | false | `/fr-fr/play` | " + (r.guard.stablePlay.threw ? "THROW inattendu ❌" : "passé (garde laisse jouer) ✅") + " |");
  console.log("| stable hors xCloud (pathname invalide) | false | `/stream/…` | " + (r.guard.stableNoMatch.threw ? "THROW (garde préservée) ✅" : "passé ❌ — garde perdue") + " |");
  console.log("\n## 2. Probes statiques du build généré");
  for (const [k, v] of Object.entries(r.build.probes)) console.log("- " + (v ? "✅" : "❌") + " " + k);
  console.log("\n## 3. Capture SDK (classe ub réelle, pattern entry.client)");
  console.log("- `httpClient._baseFetchImpl === window.fetch` : " + (r.sdk.capturedHttpClient ? "✅ hook capturé" : "❌ fetch natif capturé"));
  console.log("- `built (build()) === window.fetch` : " + (r.sdk.capturedBuild ? "✅ hook capturé" : "❌ fetch natif capturé"));
  console.log("- `_baseFetchImpl === BX_FETCH` : " + (r.sdk.capturedIsHook ? "✅ c'est bien notre hook" : "❌"));
  console.log("- NATIVE_FETCH préservé (pas de boucle) : " + (r.sdk.nativePreserved ? "✅" : "❌"));
  const ok = !r.guard.previewStream.threw && !r.guard.previewProducts.threw && !r.guard.previewRoot.threw &&
    !r.guard.stablePlay.threw && r.guard.stableNoMatch.threw && r.build.ok && r.sdk.ok;
  console.log("\n" + (ok ? "VERDICT : document-start VIABLE ✅ — le SDK capturera notre hook, P2/P3 possibles côté userscript" :
    "VERDICT : document-start NON viable ❌ — voir les échecs ci-dessus"));
  process.exit(ok ? 0 : 1);
}
