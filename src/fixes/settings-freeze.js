"use strict";
// Fix upstream — intégré à la v1.13.6 (les deux correctifs de la session du
// 24 sept n'avaient jamais été publiés : la 1.13.5 servie n'en portait aucun).
//
//  1. GEL sous Firefox à l'ouverture des settings (régression de patch 06) :
//     l'observateur global de BxSelectElement observe documentElement avec
//     {subtree, childList, attributes} SANS attributeFilter → chaque mutation
//     d'attribut de TOUTE la page (rafale React du dialog) traverse onMutation
//     + un closest() par record → gel du main thread. Chromium encaissait,
//     Firefox non. Le filtre ne garde que les attributs lus par onMutation.
//
//  2. VOLUME FIGÉ : les 2 items `audio.volume` (groupe global « Son » et groupe
//     « audio » du tab stream) rendaient `params.disabled` FIGÉ au moment du
//     rendu → slider grisé à vie tant que le booster était off, et aucun
//     rafraîchissement à son activation. `get params()` est évalué à CHAQUE
//     rendu et un onCreated écoute `audio.volume.booster.enabled`.
//     ⚠ L'un-grey effectif dépend AUSSI du pont de bus Script→Stream du moteur
//     (`src/features/sound.js`, BX_SOUND_ENGINE) : la pref est GLOBALE, donc
//     l'événement `setting.changed` part sur le bus Script alors que ces items
//     n'écoutent que le bus Stream.
//
// Payload = paires (from → to) appliquées au bundle par bench/fix-settings-freeze.js,
// vérifiées par bench/fix-settings-freeze.test.js. Ne jamais éditer un bundle à
// la main pour ces zones : passer par la paire.
const GUARD_FROM = "observer.observe(document.documentElement || document, {subtree: !0,childList: !0,attributes: !0});";
const GUARD_TO = "observer.observe(document.documentElement || document, {subtree: !0,childList: !0,attributes: !0,attributeFilter: [\"selected\", \"disabled\", \"hidden\", \"value\", \"data-label\"]});";

const VOLUME_ITEM_SOUND_FROM = "{pref: \"audio.volume\",params: {disabled: !getGlobalPref(\"audio.volume.booster.enabled\")}}]}";
const VOLUME_ITEM_SOUND_TO = "{pref: \"audio.volume\",get params() {return {disabled: !getGlobalPref(\"audio.volume.booster.enabled\")};},onCreated: (setting, $elm) => {let $range = $elm.querySelector(\"input[type=range]\") || $elm;if (!$range) return;BxEventBus.Stream.on(\"setting.changed\", (payload) => {let { settingKey } = payload;if (settingKey !== \"audio.volume.booster.enabled\") return;let disabled = !getGlobalPref(\"audio.volume.booster.enabled\");$range.disabled = disabled;if (disabled) $range.value = \"100\", BxEvent.dispatch($range, \"input\", { ignoreOnChange: !0 });});}}]}";

const VOLUME_ITEM_STREAM_FROM = "{pref: \"audio.volume\",params: {disabled: !getGlobalPref(\"audio.volume.booster.enabled\")},onCreated: (setting, $elm) => {let $range = $elm.querySelector(\"input[type=range\");BxEventBus.Stream.on(\"setting.changed\", (payload) => {let { settingKey } = payload;if (settingKey === \"audio.volume\") $range.value = getStreamPref(settingKey).toString(), BxEvent.dispatch($range, \"input\", { ignoreOnChange: !0 });});}}";
const VOLUME_ITEM_STREAM_TO = "{pref: \"audio.volume\",get params() {return {disabled: !getGlobalPref(\"audio.volume.booster.enabled\")};},onCreated: (setting, $elm) => {let $range = $elm.querySelector(\"input[type=range\");BxEventBus.Stream.on(\"setting.changed\", (payload) => {let { settingKey } = payload;if (settingKey === \"audio.volume\") $range.value = getStreamPref(settingKey).toString(), BxEvent.dispatch($range, \"input\", { ignoreOnChange: !0 });else if (settingKey === \"audio.volume.booster.enabled\") {let disabled = !getGlobalPref(\"audio.volume.booster.enabled\");if ($range.disabled = disabled, disabled) $range.value = \"100\", BxEvent.dispatch($range, \"input\", { ignoreOnChange: !0 });}});}}";

const PAIRS = [
  { name: "observateur BxSelectElement (attributeFilter)", from: GUARD_FROM, to: GUARD_TO },
  { name: "item audio.volume du groupe Son (params getter + onCreated)", from: VOLUME_ITEM_SOUND_FROM, to: VOLUME_ITEM_SOUND_TO },
  { name: "item audio.volume du tab stream (params getter + onCreated booster)", from: VOLUME_ITEM_STREAM_FROM, to: VOLUME_ITEM_STREAM_TO },
];

module.exports = { PAIRS, GUARD_FROM, GUARD_TO, VOLUME_ITEM_SOUND_FROM, VOLUME_ITEM_SOUND_TO, VOLUME_ITEM_STREAM_FROM, VOLUME_ITEM_STREAM_TO };
