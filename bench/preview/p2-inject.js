#!/usr/bin/env node
/**
 * p2-inject.js — module d'injection P2 : fusion des overrides du stable dans
 * `clientStreamingConfigOverrides` de la réponse `/configuration`.
 *
 * Source unique de la logique de fusion, calquée sur `handleConfiguration`
 * du stable (XcloudInterceptor, better-xcloud.user.js offset 366894) :
 *
 *   const overrides = JSON.parse(obj.clientStreamingConfigOverrides || "{}");
 *   overrides.inputConfiguration = overrides.inputConfiguration || {};
 *   overrides.inputConfiguration.enableVibration = true;            // toujours
 *   if (localCoOp.enabled) overrides.inputConfiguration.useUnreliableInput = false;
 *   // nativeMkb.mode : on → enableMouseInput/enableKeyboardInput = true
 *   //                : off → enableMouseInput/enableKeyboardInput = false
 *   if (TouchController.isEnabled()) {
 *     overrides.inputConfiguration.enableTouchInput = true;
 *     overrides.inputConfiguration.maxTouchPoints = 10;
 *   }
 *   if (audio.mic.onPlaying) overrides.audioConfiguration.enableMicrophone = true;
 *
 * Le handler client du preview (StreamSessionRequest, offset 80925) filtre
 * les clés racine client-exclusives `ie` (options, systemUiHandler,
 * clientDeviceCapabilities, pollingConfiguration…) puis merge `ae()` — nos
 * sous-clés passent le filtre (validé en session, session.md §5).
 *
 * API :
 *   mergeStreamingOverrides(existingStr, prefs) -> objet overrides fusionné
 *   rewriteConfigurationBody(body, prefs)       -> body /configuration réécrit
 *   DEFAULT_PREFS, resolveMkb(mode, titleId, forceTitles)
 *
 * Test : node bench/preview/p2-inject.test.js (sur la réponse réelle capturée)
 */
"use strict";

/**
 * Préférences par défaut (mêmes défauts sémantiques que le stable).
 *  - vibration : true (le stable force enableVibration toujours)
 *  - localCoOp : false (stable : getStreamPref("localCoOp.enabled"))
 *  - mkb       : null = auto (stable : nativeMkb.mode "on"/"off", sinon inchangé)
 *  - mkbForceTitles : titleIds qui forcent le mkb natif (stable : BX_FLAGS.ForceNativeMkbTitles)
 *  - touch     : false (stable : TouchController.isEnabled())
 *  - mic       : false (stable : audio.mic.onPlaying)
 */
const DEFAULT_PREFS = {
  vibration: true,
  localCoOp: false,
  mkb: null,          // "on" | "off" | null (auto = inchangé)
  mkbForceTitles: [],
  touch: false,
  mic: false,
};

/** Résolution du mode mkb natif → booléen ou null (inchangé). */
function resolveMkb(mode, titleId, forceTitles) {
  if (mode === "on") return true;
  if (mode === "off") return false;
  // auto : forcer si le titre est dans la liste (stable : BX_FLAGS.ForceNativeMkbTitles)
  if (forceTitles && Array.isArray(forceTitles) && titleId && forceTitles.includes(String(titleId))) return true;
  return null;
}

/** Fusionne les overrides du stable dans un clientStreamingConfigOverrides existant. */
function mergeStreamingOverrides(existingStr, prefs = {}) {
  const p = { ...DEFAULT_PREFS, ...prefs };
  let base = {};
  try {
    base = existingStr ? JSON.parse(existingStr) : {};
  } catch (e) {
    base = {};
  }
  if (!base || typeof base !== "object") base = {};
  const out = JSON.parse(JSON.stringify(base));

  out.inputConfiguration = out.inputConfiguration || {};
  if (p.vibration) out.inputConfiguration.enableVibration = true;
  if (p.localCoOp) out.inputConfiguration.useUnreliableInput = false;

  const mkb = resolveMkb(p.mkb, p.titleId, p.mkbForceTitles);
  if (mkb !== null) {
    out.inputConfiguration.enableMouseInput = mkb;
    out.inputConfiguration.enableKeyboardInput = mkb;
  }

  if (p.touch) {
    out.inputConfiguration.enableTouchInput = true;
    out.inputConfiguration.maxTouchPoints = 10;
  }

  if (p.mic) {
    out.audioConfiguration = out.audioConfiguration || {};
    out.audioConfiguration.enableMicrophone = true;
  }
  return out;
}

/** Réécrit la réponse /configuration : fusion dans clientStreamingConfigOverrides. */
function rewriteConfigurationBody(body, prefs = {}) {
  if (!body || typeof body !== "object") return body;
  const out = JSON.parse(JSON.stringify(body));
  const merged = mergeStreamingOverrides(out.clientStreamingConfigOverrides, prefs);
  out.clientStreamingConfigOverrides = JSON.stringify(merged);
  return out;
}

module.exports = { mergeStreamingOverrides, rewriteConfigurationBody, resolveMkb, DEFAULT_PREFS };
