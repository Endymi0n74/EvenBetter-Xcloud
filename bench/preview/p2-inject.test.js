#!/usr/bin/env node
/*
 * p2-inject.test.js — self-test du module d'injection P2.
 *
 * Teste mergeStreamingOverrides/rewriteConfigurationBody sur la réponse
 * /configuration RÉELLE capturée en session (16 août, session.md) : la
 * fusion doit préserver les overrides serveur existants (inputConfiguration
 * useIntervalWorkerThreadForInput, nqiConfiguration, statisticsConfiguration,
 * videoConfiguration) et ajouter les clés du stable. Couvre aussi les
 * comportements du handleConfiguration stable : vibration toujours on,
 * localCoOp → useUnreliableInput=false, mkb on/off/force, touch, mic.
 *
 * Usage : node bench/preview/p2-inject.test.js
 */
"use strict";

const { mergeStreamingOverrides, rewriteConfigurationBody, resolveMkb, DEFAULT_PREFS } = require("./p2-inject.js");

let failures = 0;
function check(label, cond, extra) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures++; console.error(`  ❌ ${label}${extra ? " :: " + extra : ""}`); }
}

// ---------------- réponse /configuration réelle (capturée le 16 août) ----------------
const CONFIG_BODY = {
  keepAlivePulseInSeconds: 60,
  timeoutForNoConnectionSeconds: 300,
  serverDetails: {
    ipAddress: "13.104.113.180",
    port: 1059,
    srtp: { key: "lh45zSKVuBbmbARJ7gKvsqjnLbpB/CUpShG7lbL1" },
    ipV4List: [{ address: "13.104.113.180", port: 1059, rigPort: 1291, routingPreference: "AZURE" }],
  },
  clientStreamingConfigOverrides: JSON.stringify({
    inputConfiguration: { useIntervalWorkerThreadForInput: true, useUnreliableInput: true },
    nqiConfiguration: { consecutiveBadIntervalsForTrigger: 10, pingMsBadThreshold: 100 },
    statisticsConfiguration: { useQosChannel: true },
    videoConfiguration: { preferMainH264Profile: true },
  }),
};

console.log("== cas réel (réponse /configuration capturée) ==");

// défauts : vibration on, le reste off/auto
const cfgReal = rewriteConfigurationBody(CONFIG_BODY, {});
const ovReal = JSON.parse(cfgReal.clientStreamingConfigOverrides);
check("réel : overrides serveur préservés (useIntervalWorkerThreadForInput)", ovReal.inputConfiguration.useIntervalWorkerThreadForInput === true);
check("réel : nqiConfiguration intact", ovReal.nqiConfiguration.consecutiveBadIntervalsForTrigger === 10 && ovReal.nqiConfiguration.pingMsBadThreshold === 100);
check("réel : statisticsConfiguration intact", ovReal.statisticsConfiguration.useQosChannel === true);
check("réel : videoConfiguration intact", ovReal.videoConfiguration.preferMainH264Profile === true);
check("réel : enableVibration ajouté (défaut stable)", ovReal.inputConfiguration.enableVibration === true);
check("réel : pas de mkb/touch/mic par défaut", ovReal.inputConfiguration.enableMouseInput === undefined && ovReal.inputConfiguration.enableTouchInput === undefined && ovReal.audioConfiguration === undefined);
check("réel : champs racine intacts", cfgReal.keepAlivePulseInSeconds === 60 && cfgReal.serverDetails.port === 1059 && cfgReal.timeoutForNoConnectionSeconds === 300);

console.log("== comportements du stable (handleConfiguration) ==");

// vibration off → clé absente (option de l'outil, pas le stable qui force on)
const ovNoVib = mergeStreamingOverrides(null, { vibration: false });
check("vibration=false → enableVibration absent", ovNoVib.inputConfiguration.enableVibration === undefined);

// localCoOp → useUnreliableInput=false (écrase le true serveur)
const ovCoop = mergeStreamingOverrides(JSON.stringify({ inputConfiguration: { useUnreliableInput: true } }), { localCoOp: true });
check("localCoOp → useUnreliableInput=false", ovCoop.inputConfiguration.useUnreliableInput === false);

// mkb on
const ovMkbOn = mergeStreamingOverrides(null, { mkb: "on" });
check("mkb on → enableMouseInput/enableKeyboardInput=true", ovMkbOn.inputConfiguration.enableMouseInput === true && ovMkbOn.inputConfiguration.enableKeyboardInput === true);

// mkb off
const ovMkbOff = mergeStreamingOverrides(null, { mkb: "off" });
check("mkb off → enableMouseInput/enableKeyboardInput=false", ovMkbOff.inputConfiguration.enableMouseInput === false && ovMkbOff.inputConfiguration.enableKeyboardInput === false);

// mkb auto + titre forcé
check("resolveMkb : on → true", resolveMkb("on", "9N683TDT5M7R", []) === true);
check("resolveMkb : off → false", resolveMkb("off", "9N683TDT5M7R", []) === false);
check("resolveMkb : auto + titre forcé → true", resolveMkb(null, "9N683TDT5M7R", ["9N683TDT5M7R"]) === true);
check("resolveMkb : auto + titre non forcé → null", resolveMkb(null, "9N683TDT5M7R", ["OTHER"]) === null);
const ovMkbForce = mergeStreamingOverrides(null, { mkb: null, mkbForceTitles: ["9N683TDT5M7R"], titleId: "9N683TDT5M7R" });
check("mkb auto + titre forcé → mkb natif activé", ovMkbForce.inputConfiguration.enableMouseInput === true && ovMkbForce.inputConfiguration.enableKeyboardInput === true);

// touch
const ovTouch = mergeStreamingOverrides(null, { touch: true });
check("touch → enableTouchInput=true + maxTouchPoints=10", ovTouch.inputConfiguration.enableTouchInput === true && ovTouch.inputConfiguration.maxTouchPoints === 10);

// mic
const ovMic = mergeStreamingOverrides(null, { mic: true });
check("mic → audioConfiguration.enableMicrophone=true", ovMic.audioConfiguration && ovMic.audioConfiguration.enableMicrophone === true);

console.log("== cas limites ==");

// clientStreamingConfigOverrides invalide → base vide, pas de crash
const ovBad = mergeStreamingOverrides("not-json{{{", {});
check("overrides invalides → base vide + vibration ajouté", ovBad.inputConfiguration && ovBad.inputConfiguration.enableVibration === true && ovBad.nqiConfiguration === undefined);

// chaîne vide → base vide
const ovEmpty = mergeStreamingOverrides("", {});
check("overrides vides → base vide", ovEmpty.inputConfiguration && ovEmpty.inputConfiguration.enableVibration === true);

// body null → inchangé
check("body null → null", rewriteConfigurationBody(null, {}) === null);

// préférences par défaut exportées
check("DEFAULT_PREFS : vibration true", DEFAULT_PREFS.vibration === true);
check("DEFAULT_PREFS : mkb null (auto)", DEFAULT_PREFS.mkb === null);

console.log(failures === 0 ? "\nSelf-test p2-inject : OK ✅" : `\n${failures} échec(s) ❌`);
process.exit(failures === 0 ? 0 : 1);
