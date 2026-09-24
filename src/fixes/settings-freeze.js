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
//     ⚠ La pref est GLOBALE : son `setting.changed` part sur le bus SCRIPT,
//     alors que ces deux items écoutent le bus Stream. C'est
//     `src/fixes/settings-bus.js` (v1.13.7) qui les ré-abonne au bon bus — à
//     appliquer APRÈS ce fix (le pont Script→Stream que portait le moteur son
//     entre-temps a été supprimé : du code amont ne doit pas dépendre d'une
//     feature pour être livré).
//
//  3. STEPPER MORT QUAND IL EST CONSTRUIT DISABLED (v1.13.7, prouvé par
//     bench/settings-live-firefox.mjs — Firefox réel, dialogue monté par le
//     bundle) : BxNumberStepper.create sort en early-return quand
//     `options.disabled` est vrai — AVANT d'avoir créé le `input[type=range]`
//     et les accessors `value`/`disabled`. Résultat, booster éteint à
//     l'ouverture (le cas par défaut) : le contrôle est un div mort (aucun
//     range), le handler ne peut que réécrire une propriété JS sans effet →
//     cocher le booster ne dégrise JAMAIS le volume (défaut A4 du banc), et le
//     handler du panneau stream — sélecteur amont non fermé
//     `"input[type=range"`, sans repli — jette sur `$range.disabled` avec
//     $range null ; l'exception dans un listener coupe la boucle emit (défaut
//     C1). Correctif : (a) le early-return devient un no-op — le contrôle est
//     TOUJOURS construit complet (range + accessors + listeners + setNearby) ;
//     (b) l'état disabled est appliqué APRÈS les defineProperty, sur le range
//     seul (`options.disabled && ($range.disabled = !0)`) — les boutons +/−
//     restent vivants, ce qui rend A-monde EXACTEMENT équivalent au monde B
//     (témoin du banc, où le handler ne grise que le range) ; (c) l'item stream
//     reçoit le même repli `|| $elm` que l'item « Son » (le div expose les
//     accessors, donc le repli pilote tout le contrôle au lieu de jeter).
//
// Payload = paires (from → to) appliquées au bundle par bench/fix-settings-freeze.js,
// vérifiées par bench/fix-settings-freeze.test.js. Ne jamais éditer un bundle à
// la main pour ces zones : passer par la paire.
const GUARD_FROM = "observer.observe(document.documentElement || document, {subtree: !0,childList: !0,attributes: !0});";
const GUARD_TO = "observer.observe(document.documentElement || document, {subtree: !0,childList: !0,attributes: !0,attributeFilter: [\"selected\", \"disabled\", \"hidden\", \"value\", \"data-label\"]});";

const VOLUME_ITEM_SOUND_FROM = "{pref: \"audio.volume\",params: {disabled: !getGlobalPref(\"audio.volume.booster.enabled\")}}]}";
const VOLUME_ITEM_SOUND_TO = "{pref: \"audio.volume\",get params() {return {disabled: !getGlobalPref(\"audio.volume.booster.enabled\")};},onCreated: (setting, $elm) => {let $range = $elm.querySelector(\"input[type=range]\") || $elm;if (!$range) return;BxEventBus.Stream.on(\"setting.changed\", (payload) => {let { settingKey } = payload;if (settingKey !== \"audio.volume.booster.enabled\") return;let disabled = !getGlobalPref(\"audio.volume.booster.enabled\");$range.disabled = disabled;if (disabled) $range.value = \"100\", BxEvent.dispatch($range, \"input\", { ignoreOnChange: !0 });});}}]}";

const VOLUME_ITEM_STREAM_FROM = "{pref: \"audio.volume\",params: {disabled: !getGlobalPref(\"audio.volume.booster.enabled\")},onCreated: (setting, $elm) => {let $range = $elm.querySelector(\"input[type=range\");BxEventBus.Stream.on(\"setting.changed\", (payload) => {let { settingKey } = payload;if (settingKey === \"audio.volume\") $range.value = getStreamPref(settingKey).toString(), BxEvent.dispatch($range, \"input\", { ignoreOnChange: !0 });});}}";
const VOLUME_ITEM_STREAM_TO = "{pref: \"audio.volume\",get params() {return {disabled: !getGlobalPref(\"audio.volume.booster.enabled\")};},onCreated: (setting, $elm) => {let $range = $elm.querySelector(\"input[type=range]\") || $elm;BxEventBus.Stream.on(\"setting.changed\", (payload) => {let { settingKey } = payload;if (settingKey === \"audio.volume\") $range.value = getStreamPref(settingKey).toString(), BxEvent.dispatch($range, \"input\", { ignoreOnChange: !0 });else if (settingKey === \"audio.volume.booster.enabled\") {let disabled = !getGlobalPref(\"audio.volume.booster.enabled\");if ($range.disabled = disabled, disabled) $range.value = \"100\", BxEvent.dispatch($range, \"input\", { ignoreOnChange: !0 });}});}}";

// 3a. BxNumberStepper.create — le early-return « options.disabled » sautait la
// construction du range ET des accessors : le contrôle était mort à vie.
const STEPPER_HEAD_FROM = "BxNumberStepper.setValue.call(self, value), options.disabled) return $btnInc.disabled = !0, $btnInc.classList.add(\"bx-inactive\"), $btnDec.disabled = !0, $btnDec.classList.add(\"bx-inactive\"), self.disabled = !0, self;if ($range = CE(\"input\",";
const STEPPER_HEAD_TO = "BxNumberStepper.setValue.call(self, value), options.disabled) {}if ($range = CE(\"input\",";

// 3b. L'état disabled est appliqué juste avant `return self;`, quand l'accessor
// existe — sur le range seul (+/− vivants, monde A ≡ monde B du banc).
const STEPPER_TAIL_FROM = "Object.defineProperty(self, \"disabled\", {get() {return $range.disabled;},set(value2) {$btnDec.disabled = value2, $btnInc.disabled = value2, $range.disabled = value2;}}), self;}static setValue";
const STEPPER_TAIL_TO = "Object.defineProperty(self, \"disabled\", {get() {return $range.disabled;},set(value2) {$btnDec.disabled = value2, $btnInc.disabled = value2, $range.disabled = value2;}}), options.disabled && ($range.disabled = !0), self;}static setValue";

const PAIRS = [
  { name: "observateur BxSelectElement (attributeFilter)", from: GUARD_FROM, to: GUARD_TO },
  { name: "item audio.volume du groupe Son (params getter + onCreated)", from: VOLUME_ITEM_SOUND_FROM, to: VOLUME_ITEM_SOUND_TO },
  { name: "item audio.volume du tab stream (params getter + onCreated booster)", from: VOLUME_ITEM_STREAM_FROM, to: VOLUME_ITEM_STREAM_TO },
  { name: "BxNumberStepper.create : plus de early-return disabled (range toujours construit)", from: STEPPER_HEAD_FROM, to: STEPPER_HEAD_TO },
  { name: "BxNumberStepper.create : disabled appliqué après construction (accessor)", from: STEPPER_TAIL_FROM, to: STEPPER_TAIL_TO },
];

module.exports = {
  PAIRS,
  GUARD_FROM,
  GUARD_TO,
  VOLUME_ITEM_SOUND_FROM,
  VOLUME_ITEM_SOUND_TO,
  VOLUME_ITEM_STREAM_FROM,
  VOLUME_ITEM_STREAM_TO,
  STEPPER_HEAD_FROM,
  STEPPER_HEAD_TO,
  STEPPER_TAIL_FROM,
  STEPPER_TAIL_TO,
};
