#!/usr/bin/env node
/*
 * fetch-early.test.js — tests de la mesure d'injection document-start (P2/P3
 * côté userscript). Vérifie la chaîne : garde T6 (main() atteint sur
 * play.xbox.com), probes statiques du build généré, capture de notre hook par
 * la classe ub du SDK preview (pattern réel du bundle).
 *
 * Usage : node bench/preview/port/fetch-early.test.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { measure, guardBehavior } = require("./fetch-early.js");

const ROOT = path.resolve(__dirname, "..", "..", "..");
// surcharge par env (mode --self-test de run-e2e0.sh : gate sur une COPIE
// corrompue sans toucher au build réel)
const BUILD = process.env.BX_PREVIEW_BUILD || path.join(ROOT, "better-xcloud-preview.user.js");

let failures = 0;
function check(label, cond, extra) {
  if (cond) console.log("  ✅ " + label);
  else { failures++; console.error("  ❌ " + label + (extra ? " :: " + extra : "")); }
}

console.log("== fetch-early : viabilité document-start (P2/P3 userscript) ==\n");

// ---------- 1. garde T6 ----------
check("garde : preview stream (/stream/…) → main() atteint", !guardBehavior(true, "/stream/9N683TDT5M7R/halo-campaign-evolved").threw);
check("garde : preview products (/products/…) → main() atteint", !guardBehavior(true, "/products/9N683TDT5M7R/halo-campaign-evolved").threw);
check("garde : preview root (/) → main() atteint", !guardBehavior(true, "/").threw);
check("garde : stable /fr-fr/play → pas de throw (comportement préservé)", guardBehavior(false, "/fr-fr/play").threw === false);
check("garde : stable hors xCloud → throw conservé (protection intacte)", guardBehavior(false, "/stream/9N683TDT5M7R").threw === true);

// ---------- 2. probes statiques du build généré ----------
if (!fs.existsSync(BUILD)) {
  console.error("  ❌ build preview introuvable — lance d'abord node bench/preview/port/build-preview.js");
  process.exit(1);
}
const r = measure(BUILD);
for (const [k, v] of Object.entries(r.build.probes)) check("build : " + k, v);

// ---------- 3. capture SDK (classe ub réelle) ----------
check("sdk : httpClient (new ub(void 0,[i])) capture window.fetch (notre hook)", r.sdk.capturedHttpClient, JSON.stringify(r.sdk));
check("sdk : build() → new ub(…, fetch) capture window.fetch", r.sdk.capturedBuild);
check("sdk : référence capturée === BX_FETCH (le hook du build)", r.sdk.capturedIsHook);
check("sdk : NATIVE_FETCH préservé (pas de boucle infinie)", r.sdk.nativePreserved);

// ---------- 4. synthèse ----------
// CONTROLE VOLONTAIRE (branche ci/control-gate-rouge) : gate A forcé au rouge
// pour vérifier que le job bench échoue et que l'alerte remonte à la PR.
// À RETIRER avec le merge.
check("CONTROLE VOLONTAIRE — gate rouge attendu", false);
const ok = !r.guard.previewStream.threw && !r.guard.previewProducts.threw && !r.guard.previewRoot.threw &&
  r.guard.stablePlay.threw === false && r.guard.stableNoMatch.threw === true && r.build.ok && r.sdk.ok;
console.log(failures === 0 ? "\nMesure document-start : OK ✅ — P2/P3 viables côté userscript (SDK capture notre hook)" : `\n${failures} échec(s) ❌`);
process.exit(failures === 0 ? 0 : 1);
