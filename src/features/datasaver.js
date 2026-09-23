"use strict";
// Payload + ancres de la feature « 📊 Données » (v1.11.0) : presets
// débit/résolution basés sur les mesures réelles du 18 août.
//
// Source unique consommée par bench/feature-datasaver.js (require) et lue par
// bench/feature-datasaver.test.js (regex d'extraction —
// garder la syntaxe `const NAME = ...;` exacte).
const IMPL = `
window.BX_DATA_SAVER = {render: function ($parent) {
  var box = CE("div", {});
  var note = CE("div", {style: "opacity:.75;font-size:12px;padding:2px 0 6px;"}, "Basé sur nos mesures (18 août) : le cap maxBitrate est fiable (1440p conservé), 1080p/1080p-hq sont sans effet sur PC.");
  var status = CE("div", {style: "padding:2px 0 6px;font-weight:600;"});
  function fmt(br) {
    // transformValue.get mappe le stocké 0 → 15360000 (max du slider) =
    // « illimité » ; tout cap réel est < max.
    if (!br || br >= 15360000) return "illimité";
    return Math.round(br / 100000) / 10 + " Mbps";
  }
  function refresh() {
    status.innerText = "Actuel — débit max : " + fmt(getGlobalPref("stream.video.maxBitrate")) + " · résolution : " + (getGlobalPref("stream.video.resolution") || "auto");
  }
  refresh();
  var presets = [
    {label: "🚀 Max (défaut)", desc: "débit illimité · résolution auto", br: 15360000, res: "auto"},
    {label: "⚖️ Équilibré (recommandé)", desc: "cap 10 Mbps · 1440p conservé (~6,6 Mbps réels)", br: 10240000, res: "auto"},
    {label: "🌱 Économe", desc: "cap 5 Mbps · 720p (~4,7 Mbps réels)", br: 5120000, res: "720p"},
  ];
  presets.forEach(function (p) {
    var btn = CE("button", {class: "bx-focusable", style: "display:block;width:100%;margin:4px 0;padding:8px 10px;border-radius:4px;background:#1f2937;color:#fff;cursor:pointer;text-align:left;"},
      CE("div", {style: "font-weight:600;"}, p.label),
      CE("div", {style: "opacity:.75;font-size:12px;"}, p.desc));
    btn.addEventListener("click", function () {
      setGlobalPref("stream.video.maxBitrate", p.br, "ui");
      setGlobalPref("stream.video.resolution", p.res, "ui");
      refresh();
      note.innerText = "✅ " + p.label + " appliqué — en vigueur au prochain lancement de session.";
    });
    box.appendChild(btn);
  });
  box.appendChild(note);
  box.appendChild(status);
  $parent.appendChild(box);
}};`;

const ANCHOR_BX = "window.BX_EXPOSED = BxExposed;";

const ANCHOR_GROUP = '{group: "server",label: t("server")';

const ANCHOR_FILTER = 'section.group !== "sound") continue;';

module.exports = { IMPL, ANCHOR_BX, ANCHOR_GROUP, ANCHOR_FILTER };
