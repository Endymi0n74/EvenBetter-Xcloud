"use strict";
// Payload + ancres de la feature « 🔊 Son » (v1.13.0) : presets de volume
// Muet/Doux/Normal/Boost, appliqués en direct via le canal du slider natif.
//
// Source unique consommée par bench/feature-sound.js (require) et lue par
// bench/feature-sound.test.js (regex d'extraction —
// garder la syntaxe `const NAME = ...;` exacte).
const IMPL = `
window.BX_SOUND_PRESETS = {render: function ($parent) {
  var box = CE("div", {});
  var status = CE("div", {class: "bx-sound-status", style: "padding:4px 0 6px;font-weight:600;"});
  function refresh() {
    var vol = getStreamPref("audio.volume");
    var boost = getGlobalPref("audio.volume.booster.enabled");
    status.innerText = "Actuel — volume : " + (vol === 0 ? "🔇 muet" : vol + " %") + (boost ? " · booster activé" : " · booster off");
  }
  refresh();
  var presets = [
    {label: "🔇 Muet", desc: "volume 0 %", v: 0},
    {label: "🔉 Doux", desc: "volume 50 %", v: 50},
    {label: "🔊 Normal (défaut)", desc: "volume 100 % · booster désactivé", v: 100, resetBoost: true},
    {label: "📢 Boost", desc: "booster activé · volume 200 %", v: 200, boost: true},
  ];
  presets.forEach(function (p) {
    var btn = CE("button", {class: "bx-focusable", style: "display:block;width:100%;margin:4px 0;padding:8px 10px;border-radius:4px;background:#0b5e8a;color:#fff;cursor:pointer;text-align:left;"},
      CE("div", {style: "font-weight:600;"}, p.label),
      CE("div", {style: "opacity:.75;font-size:12px;"}, p.desc));
    btn.addEventListener("click", function () {
      try {
        if (p.boost) setGlobalPref("audio.volume.booster.enabled", true, "ui");
        else if (p.resetBoost) setGlobalPref("audio.volume.booster.enabled", false, "ui");
        // "ui" déclenche l'émission setting.changed → le slider natif se sync
        // et les onChange de la pref s'appliquent (SoundShortcut en session).
        setStreamPref("audio.volume", p.v, "ui");
        if (typeof SoundShortcut === "object" && SoundShortcut.setGainNodeVolume) SoundShortcut.setGainNodeVolume(p.v);
      } catch (e) {}
      refresh();
      status.innerText = "✅ " + p.label + " appliqué — volume : " + p.v + " % · " + (STATES.currentStream ? "en direct sur la session" : "en vigueur à la prochaine session");
    });
    box.appendChild(btn);
  });
  box.appendChild(status);
  $parent.appendChild(box);
}};`;

const ANCHOR_BX = "window.BX_EXPOSED = BxExposed;";

const ANCHOR_TAIL = 'BxEvent.dispatch($range, "input", { ignoreOnChange: !0 });});}}]}';

const ITEM_SOUND = 'BxEvent.dispatch($range, "input", { ignoreOnChange: !0 });});}},($parent) => {window.BX_SOUND_PRESETS.render($parent);}]}';

module.exports = { IMPL, ANCHOR_BX, ANCHOR_TAIL, ITEM_SOUND };
