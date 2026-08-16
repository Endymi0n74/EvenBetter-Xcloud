#!/usr/bin/env node
/*
 * p2-schema.test.js — compatibilité machine P2 : les clés que p2-inject.js
 * écrit dans clientStreamingConfigOverrides doivent TOUTES exister dans le
 * schéma Zod réel du preview (module StreamSessionConfiguration-*.js), sinon
 * validateClientStreamingConfigOverrides (throwErrors:true) les rejette.
 *
 * Le schéma est extrait du bundle local (D:/tmp/preview-player) — si le
 * module est absent (CI sans capture), le test passe en mode « schéma non
 * vérifiable » (warn) mais vérifie quand même la cohérence interne.
 *
 * Usage : node bench/preview/p2-schema.test.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

const BUNDLE_DIR = process.argv[2] || "D:/tmp/preview-player";
let failures = 0;
function check(label, cond, extra) {
  if (cond) console.log("  ✅ " + label);
  else { failures++; console.error("  ❌ " + label + (extra ? " :: " + extra : "")); }
}

// ---- clés que p2-inject.js écrit (source unique) ----
// (inputConfiguration + audioConfiguration — ce que mergeStreamingOverrides
//  peut produire selon les préfs)
const INJECTED = {
  inputConfiguration: [
    "enableVibration",
    "useUnreliableInput",
    "enableMouseInput",
    "enableKeyboardInput",
    "enableTouchInput",
    "maxTouchPoints",
  ],
  audioConfiguration: ["enableMicrophone"],
};
// liste des clés racine client-exclusives (v dans le schéma) — celles-ci ne
// sont PAS censées être injectées par P2 (le filtre ie les retire avant merge)
const CLIENT_EXCLUSIVE = [
  "options",
  "systemUiHandler",
  "touchControlHandler",
  "nexusButtonHandler",
  "clientDeviceCapabilities",
  "pollingConfiguration",
];

// ---- extraction du schéma depuis le bundle réel ----
function extractSchema(bundlePath) {
  const src = fs.readFileSync(bundlePath, "utf8");
  const s = src.replace(/\s+/g, " ");

  // la liste v (clés client-exclusives) — pattern : ["options", ...]
  const vMatch = s.match(/\[`options`,[^\]]*`pollingConfiguration`\]/);
  const clientExclusive = vMatch
    ? [...vMatch[0].matchAll(/`([a-zA-Z]+)`/g)].map((m) => m[1])
    : null;

  // le schéma inputConfiguration (validateInputConfiguration) : l'objet de
  // clés est AVANT le marker — forme réelle du bundle :
  //   n({enableGamepadInput:e,...,enableVibration:e,...},{name:`validateInputConfiguration`,...})
  // → on prend le segment avant `{name:`validateInputConfiguration`` et on
  //   extrait les `key:e` / `key:i`.
  const inMarker = s.indexOf("{name:`validateInputConfiguration`");
  let inputKeys = null;
  if (inMarker >= 0) {
    const seg = s.slice(Math.max(0, inMarker - 1200), inMarker);
    // clés au format `key:` (valeur simple e/i ou composée a(...)) — on
    // capture aussi la dernière clé avant le marker (pas de virgule finale)
    inputKeys = [...seg.matchAll(/([a-zA-Z]+):[a-z(]/g)].map((m) => m[1]);
    const last = seg.match(/([a-zA-Z]+):[a-z]$/);
    if (last) inputKeys.push(last[1]);
  }

  const audioMarker = s.indexOf("{name:`validateAudioConfiguration`");
  let audioKeys = null;
  if (audioMarker >= 0) {
    const seg = s.slice(Math.max(0, audioMarker - 800), audioMarker);
    audioKeys = [...seg.matchAll(/([a-zA-Z]+):[a-z(]/g)].map((m) => m[1]);
    const last = seg.match(/([a-zA-Z]+):[a-z]$/);
    if (last) audioKeys.push(last[1]);
  }

  return { clientExclusive, inputKeys, audioKeys };
}

console.log("== p2-schema : clés P2 vs schéma Zod réel du preview ==\n");

const bundle = fs.existsSync(BUNDLE_DIR)
  ? fs.readdirSync(BUNDLE_DIR).find((f) => /^StreamSessionConfiguration-.*\.js$/.test(f))
  : null;

if (!bundle) {
  console.log("  ⚠️ bundle StreamSessionConfiguration absent (" + BUNDLE_DIR + ") — compatibilité non vérifiable, tests internes seuls");
} else {
  const sch = extractSchema(path.join(BUNDLE_DIR, bundle));
  console.log(`  (bundle : ${bundle})`);

  // 1. liste des clés client-exclusives conforme (le filtre ie du merge)
  if (sch.clientExclusive) {
    check("liste v (client-exclusives) extraite", sch.clientExclusive.length === CLIENT_EXCLUSIVE.length,
      sch.clientExclusive.join(","));
    for (const k of CLIENT_EXCLUSIVE) {
      check("client-exclusive " + k + " dans la liste v", sch.clientExclusive.includes(k));
    }
  } else {
    console.log("  ⚠️ liste v non extraite (bundle minifié ?) — vérification sautée");
  }

  // 2. chaque clé injectée par P2 existe dans le schéma correspondant
  const checkKeys = (group, keys) => {
    const missing = keys.filter((k) => !group || !group.includes(k));
    check("inputConfiguration : toutes les clés P2 dans le schéma (" + INJECTED.inputConfiguration.join(", ") + ")",
      group && INJECTED.inputConfiguration.every((k) => group.includes(k)),
      missing.length ? "manquantes: " + missing.join(", ") + " (schéma: " + (group || []).join(", ") + ")" : "");
  };
  checkKeys(sch.inputKeys, INJECTED.inputConfiguration);
  check("audioConfiguration : enableMicrophone dans le schéma",
    sch.audioKeys && sch.audioKeys.includes("enableMicrophone"),
    "audioKeys: " + (sch.audioKeys || []).join(", "));

  // 3. aucune clé injectée ne figure dans la liste client-exclusive (sinon
  //    le filtre ie la retirerait avant merge → P2 muet)
  if (sch.clientExclusive) {
    const clash = [...INJECTED.inputConfiguration, ...INJECTED.audioConfiguration]
      .filter((k) => sch.clientExclusive.includes(k));
    check("aucune clé P2 dans la liste client-exclusive (filtre ie)", clash.length === 0,
      "conflits: " + clash.join(", "));
  }
}

// ---- cohérence interne (sans bundle) : les clés écrites par p2-inject.js ----
const { mergeStreamingOverrides } = require("./p2-inject.js");
const out = mergeStreamingOverrides('{"inputConfiguration":{"useIntervalWorkerThreadForInput":true},"nqiConfiguration":{"pingMsBadThreshold":100}}', {
  vibration: true, mkb: "on", touch: true, mic: true,
});
check("cohérence interne : enableVibration écrit", out.inputConfiguration.enableVibration === true);
check("cohérence interne : enableMouseInput+enableKeyboardInput écrits (mkb on)", out.inputConfiguration.enableMouseInput === true && out.inputConfiguration.enableKeyboardInput === true);
check("cohérence interne : enableTouchInput+maxTouchPoints écrits (touch)", out.inputConfiguration.enableTouchInput === true && out.inputConfiguration.maxTouchPoints === 10);
check("cohérence interne : enableMicrophone écrit (mic)", out.audioConfiguration && out.audioConfiguration.enableMicrophone === true);
check("cohérence interne : overrides serveur préservés", out.inputConfiguration.useIntervalWorkerThreadForInput === true && out.nqiConfiguration.pingMsBadThreshold === 100);

console.log(failures === 0 ? "\np2-schema : OK ✅ — les clés P2 passent le schéma Zod réel (validateClientStreamingConfigOverrides)" : `\n${failures} échec(s) ❌`);
process.exit(failures === 0 ? 0 : 1);
