"use strict";
// Portées au STABLE en v1.13.11 (elles vivaient dans bench/preview/port/
// build-preview.js, donc uniquement dans le bundle preview) :
//
//  1. T10 — AUTO-SPOOF D'USER-AGENT hors Chromium.
//     play.xbox.com gate sur `isSupportedChromiumBasedBrowser` et affiche
//     « Votre navigateur ne prend pas en charge la diffusion en continu » pour
//     tout autre moteur. Le flux WebRTC H.264 fonctionne pourtant sous Firefox.
//     On présente donc les moteurs non Chromium comme Edge par défaut.
//     Le setting `userAgent.profile` garde la main : un profil explicite (custom
//     ou windows-edge choisi à la main) n'est jamais écrasé, et un vrai
//     Chromium (Chrome, Edge, Crios) n'est jamais spoofé.
//
//  2. T17 — PANNEAU DE SETTINGS COMPLET HORS SESSION.
//     `renderFullSettings = supportedRegion && isSignedIn` filtre les sections
//     et n'crée même pas les onglets stream/controller/mkb/stats. Sur
//     play.xbox.com `isSignedIn` ne peut jamais devenir vrai hors partie :
//     `window.xbcUser` est un global de www.xbox.com/play, et
//     `xcloud.server ready` n'arrive qu'en session. Le script se croyait donc
//     déconnecté alors que le gamertag était affiché → panneau réduit au bloc
//     « home ». Ce sont des préférences stockées, appliquées au prochain
//     chargement : les rendre visibles hors session est sans effet de bord.
//
// Payload = paires (from → to) appliquées au bundle par
// bench/fix-ua-settings-stable.js, vérifiées par bench/preview/port/
// t10-auto-spoof.test.js (marker + comportement vm sur les DEUX bundles).
const UA_SPOOF_FROM = 'if (!UserAgent.#config.custom) UserAgent.#config.custom = "";UserAgent.spoof();';
const UA_SPOOF_TO =
  'if (!UserAgent.#config.custom) UserAgent.#config.custom = "";' +
  "/* T10 : gate play.xbox.com = Chromium-only (Firefox/Safari not listed). WebRTC H.264 works in Firefox: auto-spoof Edge by default. */" +
  'if (UserAgent.#config.profile === "default" && !(/chrom(e|ium)|edg\\/|crios/i.test(navigator.userAgent))) UserAgent.#config.profile = "windows-edge";' +
  "UserAgent.spoof();";

const FULL_SETTINGS_FROM = "this.renderFullSettings = STATES.supportedRegion && STATES.isSignedIn";
const FULL_SETTINGS_TO =
  "/* T17 : xbcUser absent sur play.xbox.com -> panneau complet des que la region est supportee */" +
  "this.renderFullSettings = STATES.supportedRegion";

const PAIRS = [
  { name: "T10 auto-spoof UA hors Chromium", from: UA_SPOOF_FROM, to: UA_SPOOF_TO },
  { name: "T17 panneau de settings complet hors session", from: FULL_SETTINGS_FROM, to: FULL_SETTINGS_TO },
];

module.exports = { PAIRS, UA_SPOOF_FROM, UA_SPOOF_TO, FULL_SETTINGS_FROM, FULL_SETTINGS_TO };
