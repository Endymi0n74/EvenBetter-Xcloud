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

// ---- Moteur du booster (v1.13.6). Diagnostic complet en tete de
// src/fixes/settings-freeze.js : bus Script/Stream (la pref du booster est
// GLOBALE), gating au chargement, et .resume() absent sous Firefox.
const IMPL_ENGINE = `
window.BX_SOUND_ENGINE = {
  ctx: null, gain: null, source: null, $media: null, watching: false,

  _media: function () {
    return document.querySelector("div[data-testid=media-container] audio") ||
      document.querySelector("div[data-testid=media-container] video") ||
      document.querySelector("audio[srcobject]") ||
      document.querySelector("video[srcobject]");
  },

  // UN contexte par moteur : le créer à chaque appel épuiserait le plafond de
  // Firefox (6 AudioContext) — donc on réutilise, et on ne crée qu'ici (au
  // moment du branchement, flux présent), jamais depuis apply().
  _context: function () {
    var ctx = null;
    try { ctx = STATES.currentStream && STATES.currentStream.audioContext; } catch (e) {}
    if (!ctx) ctx = this.ctx;
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
      try { if (STATES.currentStream) STATES.currentStream.audioContext = ctx; } catch (e) {}
    }
    this.ctx = ctx;
    this._resumeOnly();
    return ctx;
  },

  // Firefox : un AudioContext créé sans geste utilisateur reste "suspended" et
  // n'est JAMAIS relancé tout seul (Chrome le fait) — le média déjà mis en
  // sourdine jouerait alors dans le vide.
  _resumeOnly: function () {
    var c = this.ctx;
    try { c = (STATES.currentStream && STATES.currentStream.audioContext) || this.ctx; } catch (e) {}
    if (c && c.state === "suspended" && typeof c.resume === "function") {
      try { var p = c.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    }
  },

  _release: function () {
    try { if (this.source) this.source.disconnect(); } catch (e) {}
    try { if (this.gain) this.gain.disconnect(); } catch (e) {}
    this.source = null;
    this.gain = null;
    try { if (STATES.currentStream) STATES.currentStream.audioGainNode = null; } catch (e) {}
  },

  setGain: function (value) {
    if (this.gain) { try { this.gain.gain.value = value / 100; } catch (e) {} }
  },

  attach: function () {
    // Graphe déjà monté par le bundle (booster actif au chargement) : on
    // l'adopte, sinon on doublerait la sortie (2 sources vers destination).
    var upstream = null;
    try { upstream = STATES.currentStream && STATES.currentStream.audioGainNode; } catch (e) {}
    if (upstream && upstream !== this.gain) {
      this.gain = upstream;
      if (!this.$media) this.$media = this._media();
      return true;
    }
    var $media = this.$media;
    if (!$media || !$media.isConnected) $media = this._media();
    if (!$media) { this._wake(); return false; }
    var stream = $media.srcObject;
    if (!stream || typeof stream.getAudioTracks !== "function" || !stream.getAudioTracks().length) { this._wake(); return false; }
    var ctx = this._context();
    if (!ctx) return false;
    if (this.$media === $media && this.gain) {
      this.setGain(getStreamPref("audio.volume"));
      return true;
    }
    try {
      this._release();
      var source = ctx.createMediaStreamSource(stream);
      var gain = ctx.createGain();
      source.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.value = getStreamPref("audio.volume") / 100;
      this.source = source;
      this.gain = gain;
      this.$media = $media;
      $media.muted = true;
      try { if (STATES.currentStream) STATES.currentStream.audioGainNode = gain; } catch (e) {}
      BxLogger.info("BX_SOUND_ENGINE", "gain node branché en direct");
      return true;
    } catch (e) {
      BxLogger.error("BX_SOUND_ENGINE", e);
      this._release();
      return false;
    }
  },

  _wake: function () {
    var self = this;
    if (this.watching) return;
    this.watching = true;
    var onPlay = function () {
      document.removeEventListener("playing", onPlay, true);
      self.watching = false;
      if (self.attach()) self.watching = false;
    };
    document.addEventListener("playing", onPlay, true);
    var n = 0;
    var timer = setInterval(function () {
      n++;
      var on = false;
      try { on = !!getGlobalPref("audio.volume.booster.enabled"); } catch (e) {}
      if (!on || n > 60) { clearInterval(timer); self.watching = false; return; }
      if (self.attach()) { clearInterval(timer); self.watching = false; }
    }, 1000);
  },

  apply: function () {
    var on = false;
    try { on = !!getGlobalPref("audio.volume.booster.enabled"); } catch (e) {}
    if (!on) {
      var $old = this.$media;
      this._release();
      if ($old && $old.muted) $old.muted = false;
      this.$media = null;
      return;
    }
    this._resumeOnly();
    this.attach();
  },

  start: function () {
    var self = this;
    var onChange = function (payload) {
      if (!payload || payload.settingKey !== "audio.volume.booster.enabled") return;
      self.apply();
    };
    try { BxEventBus.Script.on("setting.changed", onChange); } catch (e) {}
    try { BxEventBus.Stream.on("setting.changed", onChange); } catch (e) {}
    try {
      // Pont : une pref GLOBALE doit être vue par le panneau stream (items
      // audio.volume des 2 groupes, qui n'écoutent que le bus Stream).
      BxEventBus.Script.on("setting.changed", function (payload) {
        if (!payload || !payload.settingKey || isStreamPref(payload.settingKey)) return;
        BxEventBus.Stream.emit("setting.changed", payload);
      });
    } catch (e) {}
    var unlock = function () {
      try { self._resumeOnly(); } catch (e) {}
      document.removeEventListener("pointerdown", unlock, true);
      document.removeEventListener("keydown", unlock, true);
    };
    document.addEventListener("pointerdown", unlock, true);
    document.addEventListener("keydown", unlock, true);
    // Un média peut (re)démarrer à tout moment (nouvelle session, switch
    // d'élément React) : on réévalue à chaque lecture.
    document.addEventListener("playing", function () { try { self.apply(); } catch (e) {} }, true);
    try { window.setTimeout(function () { self.apply(); }, 1500); } catch (e) {}
  }
};
window.BX_SOUND_ENGINE.start();`;

const ENGINE_TAIL = "window.BX_SOUND_ENGINE.start();";

const ANCHOR_BX = "window.BX_EXPOSED = BxExposed;";

const ANCHOR_TAIL = 'BxEvent.dispatch($range, "input", { ignoreOnChange: !0 });});}}]}';

const ITEM_SOUND = 'BxEvent.dispatch($range, "input", { ignoreOnChange: !0 });});}},($parent) => {window.BX_SOUND_PRESETS.render($parent);}]}';

module.exports = { IMPL, IMPL_ENGINE, ENGINE_TAIL, ANCHOR_BX, ANCHOR_TAIL, ITEM_SOUND };
