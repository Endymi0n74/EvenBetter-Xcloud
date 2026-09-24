"use strict";
// Fix upstream — audit des bus `setting.changed` (v1.13.7).
//
// DIAGNOSTIC. Settings.setSetting(key, value, origin) route l'evenement selon la
// CLASSE de la pref :
//
//   if (isStreamPref(key)) BxEventBus.Stream.emit("setting.changed", ...)
//   else                   BxEventBus.Script.emit("setting.changed", ...)
//
// Le bus Stream ne porte donc QUE les prefs de ALL_PREFS.stream ; le bus Script
// porte tout le reste (prefs globales + cles hors referentiel). Or
// `audio.volume.booster.enabled` est une pref GLOBALE : les deux items
// `audio.volume` qui l'ecoutent etaient abonnes au seul bus Stream, donc leur
// callback n'etait jamais appele (pas mort : injoignable).
//
//   1. item `audio.volume` du groupe GLOBAL << Son >> : son unique filtre est le
//      booster -> bus Script. Sans ca, le slider reste grise apres activation du
//      booster (le `get params()` pose par settings-freeze corrige l'etat INITIAL,
//      pas la bascule live).
//   2. item `audio.volume` du panneau stream : il filtre `audio.volume` (STREAM,
//      bus Stream) ET le booster (GLOBALE, bus Script) -> le meme handler doit
//      etre abonne AUX DEUX bus. Le callback inline est extrait dans une variable
//      locale pour etre souscrit deux fois sans dupliquer son corps.
//
// Ces deux defauts etaient masques par un pont ad hoc du moteur son
// (BX_SOUND_ENGINE re-emettait Script -> Stream) : la livraison dependait donc de
// l'existence de notre feature, et tout autre listener Stream filtrant une pref
// globale serait reste injoignable en silence. bench/settings-bus-audit.js
// verifie desormais la table complete (et tourne en CI).
//
// ORDRE : ces paires s'appliquent APRES src/fixes/settings-freeze.js — la paires 1
// vise le `onCreated` que ce fix vient d'ajouter a l'item global (avant lui, il
// n'existe pas) et la paire 2 la ligne qu'il a reecrite. bench/fix-settings-bus.js
// refuse de tourner dans le mauvais ordre ; bench/fix-settings-freeze.js accepte
// en retour ces formes-ci comme << deja applique >> (helper rebusItemText).
//
// Payload = paires (from -> to) appliquees au bundle par bench/fix-settings-bus.js,
// verifiees par bench/fix-settings-bus.test.js + bench/settings-bus.test.js.

// 1. Item `audio.volume` du groupe global << Son >> : bus Script.
const SOUND_ITEM_BUS_FROM =
  'BxEventBus.Stream.on("setting.changed", (payload) => {let { settingKey } = payload;if (settingKey !== "audio.volume.booster.enabled") return;';
const SOUND_ITEM_BUS_TO =
  'BxEventBus.Script.on("setting.changed", (payload) => {let { settingKey } = payload;if (settingKey !== "audio.volume.booster.enabled") return;';

// 2. Item `audio.volume` du panneau stream : handler nomme + abonnement aux 2 bus.
const STREAM_HANDLER_FROM =
  'BxEventBus.Stream.on("setting.changed", (payload) => {let { settingKey } = payload;if (settingKey === "audio.volume") $range.value = getStreamPref(settingKey).toString(), BxEvent.dispatch($range, "input", { ignoreOnChange: !0 });else if (settingKey === "audio.volume.booster.enabled") {let disabled = !getGlobalPref("audio.volume.booster.enabled");if ($range.disabled = disabled, disabled) $range.value = "100", BxEvent.dispatch($range, "input", { ignoreOnChange: !0 });}});}}';
const STREAM_HANDLER_TO =
  'var bxOnSettingChanged = (payload) => {let { settingKey } = payload;if (settingKey === "audio.volume") $range.value = getStreamPref(settingKey).toString(), BxEvent.dispatch($range, "input", { ignoreOnChange: !0 });else if (settingKey === "audio.volume.booster.enabled") {let disabled = !getGlobalPref("audio.volume.booster.enabled");if ($range.disabled = disabled, disabled) $range.value = "100", BxEvent.dispatch($range, "input", { ignoreOnChange: !0 });}};BxEventBus.Stream.on("setting.changed", bxOnSettingChanged);BxEventBus.Script.on("setting.changed", bxOnSettingChanged);}}';

const PAIRS = [
  { name: "item audio.volume du groupe Son (bus Script)", from: SOUND_ITEM_BUS_FROM, to: SOUND_ITEM_BUS_TO },
  { name: "item audio.volume du panneau stream (handler partage, 2 bus)", from: STREAM_HANDLER_FROM, to: STREAM_HANDLER_TO },
];

// Applique les deux rebus a un TEXTE d'item (pas un bundle) : sert a deriver la
// forme << post-bus >> des paires de src/fixes/settings-freeze.js, dont ces paires
// reecrivent le contenu (tolerance << deja applique >>, zero duplication).
function rebusItemText(text) {
  return text.split(SOUND_ITEM_BUS_FROM).join(SOUND_ITEM_BUS_TO).split(STREAM_HANDLER_FROM).join(STREAM_HANDLER_TO);
}

module.exports = {
  PAIRS,
  rebusItemText,
  SOUND_ITEM_BUS_FROM,
  SOUND_ITEM_BUS_TO,
  STREAM_HANDLER_FROM,
  STREAM_HANDLER_TO,
};
