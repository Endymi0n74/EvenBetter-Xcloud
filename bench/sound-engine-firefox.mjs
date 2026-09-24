#!/usr/bin/env node
/**
 * bench/sound-engine-firefox.mjs — preuve du moteur son sous Firefox réel.
 *
 * Extrait `window.BX_SOUND_ENGINE` du bundle (source de vérité, pas une copie)
 * et l'exécute dans une vraie page Firefox avec des doublures minimales du
 * scope du bundle (STATES / prefs / BxEventBus / BxLogger / SoundShortcut), sur
 * un VRAI flux audio (oscillateur → MediaStreamAudioDestinationNode → <audio>).
 *
 * Ce qui est vérifié, dans l'ordre du diagnostic « le son marche mais je ne
 * peux pas régler le volume » :
 *
 *   1. BUS — `audio.volume.booster.enabled` est une pref GLOBALE : setSetting
 *      l'émet sur le bus **Script** (le bus Stream ne porte que les prefs de
 *      ALL_PREFS.stream). Le harnais rejoue ce routage exact via setPref() : le
 *      moteur doit réagir à l'événement reçu sur Script, sans aucun pont
 *      (v1.13.7 : les items sont abonnés au bon bus par settings-bus.js).
 *   2. BRANCHEMENT LIVE — booster activé en cours de partie (aucun patch au
 *      chargement) : le moteur doit monter source → gain → destination, mettre
 *      le média en sourdine et publier audioGainNode (sinon le slider dégrisé
 *      ne fait rien).
 *   3. VOLUME EFFECTIF — mesuré au RMS en sortie du gain : ×2 à 200 %,
 *      ~0 à 0 %, retour à 100 %. C'est la mesure qui manquait : le slider
 *      bougeait sans rien changer.
 *   4. RESUME — un AudioContext créé sans geste reste `suspended` (Firefox ne
 *      le relance pas seul, contrairement à Chrome) : l'état doit passer à
 *      `running` après le passage du moteur.
 *   5. EXTINCTION — booster off : le graphe est libéré et le média ré-audible
 *      (on ne laisse jamais le <audio> muté sans gain node = silence).
 *
 * Usage : node bench/sound-engine-firefox.mjs
 */
import { firefox } from "playwright";
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(decodeURI(new URL(import.meta.url).pathname)).replace(/^\/(\w):/, "$1:");
const REPO = path.resolve(HERE, "..");
const BUNDLE = path.join(REPO, "better-xcloud.user.js");

const src = fs.readFileSync(BUNDLE, "utf8").replace(/\r\n/g, "\n");
const start = src.indexOf("window.BX_SOUND_ENGINE = {");
const end = src.indexOf("window.BX_SOUND_ENGINE.start();");
if (start < 0 || end < 0) {
  console.error("❌ moteur absent du bundle (BX_SOUND_ENGINE) — lancer bench/feature-sound.js d'abord");
  process.exit(1);
}
const ENGINE = src.slice(start, end + "window.BX_SOUND_ENGINE.start();".length);
console.log(`[bundle] ${path.basename(BUNDLE)} — moteur extrait (${ENGINE.length} o)`);

const PAGE = `<!doctype html><html><body>
<button id="start">démarrer</button>
<div data-testid="media-container"><audio id="player" autoplay></audio></div>
</body></html>`;

const browser = await firefox.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(PAGE);

// Un vrai geste utilisateur : c'est le cas réel (on clique pour lancer une
// session) — sauf pour le contexte du moteur, créé sans geste plus bas afin de
// reproduire l'état `suspended` de Firefox.
await page.click("#start");

const result = await page.evaluate(async (engineSrc) => {
  const log = [];
  const errors = [];

  // ---- doublures du scope du bundle ----
  const prefs = { global: { "audio.volume.booster.enabled": false, "ui.layout": "default" }, stream: { "audio.volume": 100 } };
  // API réelle : on(eventName, handler) / emit(eventName, payload)
  const bus = () => {
    const ls = [];
    return { on: (a, b) => { const f = typeof b === "function" ? b : a; if (typeof f === "function") ls.push(f); }, emit: (ev, p) => ls.forEach((f) => f(p)) };
  };
  window.STATES = { currentStream: {} };
  window.BxEventBus = { Script: bus(), Stream: bus() };
  window.BxLogger = { info: () => {}, error: (e) => errors.push(String(e && e.message ? e.message : e)) };
  window.isStreamPref = (k) => k === "audio.volume";
  window.getGlobalPref = (k) => prefs.global[k];
  window.getStreamPref = (k) => prefs.stream[k];
  window.setStreamPref = (k, v, origin) => {
    prefs.stream[k] = v;
    if (origin === "ui") window.BxEventBus.Stream.emit("setting.changed", { settingKey: k });
    return v;
  };
  window.setGlobalPref = (k, v, origin) => {
    prefs.global[k] = v;
    if (origin === "ui") window.BxEventBus.Script.emit("setting.changed", { settingKey: k });
    return v;
  };
  // Routage EXACT de Settings.setSetting(key, value, "ui") : bus Stream pour une
  // pref stream, bus Script sinon. C'est ce chemin-là qu'emprunte l'UI.
  window.setPref = (k, v, origin) => (window.isStreamPref(k) ? window.setStreamPref(k, v, origin) : window.setGlobalPref(k, v, origin));
  // corps EXACT de SoundShortcut.setGainNodeVolume (upstream) : le slider passe
  // par lui, donc c'est ce chemin qu'il faut mesurer.
  window.SoundShortcut = {
    setGainNodeVolume: (value) => { window.STATES.currentStream.audioGainNode && (window.STATES.currentStream.audioGainNode.gain.value = value / 100); },
  };

  // ---- flux audio réel + média de la page ----
  const feed = new AudioContext();
  const osc = feed.createOscillator();
  osc.frequency.value = 440;
  const streamDest = feed.createMediaStreamDestination();
  osc.connect(streamDest);
  osc.start();
  const $media = document.getElementById("player");
  $media.srcObject = streamDest.stream;
  await new Promise((r) => { $media.addEventListener("playing", r, { once: true }); setTimeout(r, 1500); });
  log.push("média : srcObject audio=" + $media.srcObject.getAudioTracks().length + " · en lecture=" + !$media.paused);

  // ---- le moteur du bundle ----
  new Function(engineSrc)();
  const E = window.BX_SOUND_ENGINE;
  if (!E) return { log, errors, fatal: "BX_SOUND_ENGINE absent" };
  log.push("état initial : muted=" + $media.muted + " · gain=" + (E.gain ? "présent" : "absent"));

  const rms = () => new Promise((res) => {
    const g = window.STATES.currentStream.audioGainNode;
    const ctx = window.STATES.currentStream.audioContext;
    if (!g || !ctx) return res(null);
    const an = ctx.createAnalyser(); an.fftSize = 2048;
    g.connect(an);
    const buf = new Float32Array(an.fftSize);
    setTimeout(() => {
      an.getFloatTimeDomainData(buf);
      let s = 0; for (const v of buf) s += v * v;
      try { g.disconnect(an); } catch (e) {}
      res(Math.sqrt(s / buf.length));
    }, 200);
  });

  // ---- 1. routage réel : une pref GLOBALE part sur le bus Script ----
  let scriptHits = 0;
  window.BxEventBus.Script.on("setting.changed", (p) => { if (p && p.settingKey === "audio.volume.booster.enabled") scriptHits++; });
  window.setPref("ui.layout", "compact", "ui"); // bruit volontaire : pref globale, pas le booster
  log.push("routage : ui.layout (globale) → bus Script · booster compté=" + scriptHits);

  // ---- 2/4. booster activé EN COURS DE PARTIE (aucun patch au chargement) ----
  const ctxBefore = window.STATES.currentStream.audioContext ? window.STATES.currentStream.audioContext.state : "absent";
  window.setPref("audio.volume.booster.enabled", true, "ui");
  await new Promise((r) => setTimeout(r, 300));
  const mutedOn = $media.muted;
  const ctxAfter = window.STATES.currentStream.audioContext ? window.STATES.currentStream.audioContext.state : "absent";
  log.push("contexte : " + ctxBefore + " → " + ctxAfter + " · muted=" + $media.muted +
    " · audioGainNode=" + (window.STATES.currentStream.audioGainNode ? "présent" : "absent"));

  // ---- 3. le volume change-t-il vraiment ? ----
  const levels = {};
  for (const v of [100, 200, 0, 100]) {
    window.SoundShortcut.setGainNodeVolume(v);
    const r = await rms();
    levels[v] = r === null ? null : Math.round(r * 1000) / 1000;
    log.push("volume " + v + " % → RMS " + (r === null ? "n/a" : r.toFixed(6)));
  }

  // ---- 5. extinction ----
  window.setPref("audio.volume.booster.enabled", false, "ui");
  await new Promise((r) => setTimeout(r, 200));
  log.push("booster off : muted=" + $media.muted + " · gain=" + (E.gain ? "présent" : "absent"));

  return { log, errors, levels, ctxBefore, ctxAfter, scriptHits, mutedOn, mutedAfterOff: $media.muted };
}, ENGINE);

let fails = 0;
const step = (label, ok, extra) => {
  console.log((ok ? "  ✅ " : "  ❌ ") + label + (extra ? " :: " + extra : ""));
  if (!ok) fails++;
};

console.log("=== Firefox " + (await page.evaluate(() => navigator.userAgent.match(/Firefox\/[\d.]+/)?.[0])) + " ===");
for (const l of result.log) console.log("  " + l);
if (result.errors && result.errors.length) console.log("  ⚠ erreurs moteur : " + result.errors.join(" | "));
console.log("");

const L = result.levels || {};
step("routage réel : le booster part sur le bus Script et le moteur réagit", result.scriptHits >= 1 && result.mutedOn === true,
  "hits=" + result.scriptHits + " · muted=" + result.mutedOn);
step("branchement live : audioGainNode publié (le slider devient effectif)", result.log.some((l) => l.includes("audioGainNode=présent")));
step("contexte relancé (Firefox ne le fait pas seul)", result.ctxAfter === "running", result.ctxBefore + " → " + result.ctxAfter);
step("volume 100 % audible", (L[100] ?? 0) > 0.001, "RMS=" + L[100]);
step("volume 200 % ≈ ×2 (le slider AGIT enfin)", L[200] !== null && L[100] > 0 && Math.abs(L[200] / L[100] - 2) < 0.35, L[100] + " → " + L[200] + " (×" + (L[100] ? (L[200] / L[100]).toFixed(2) : "?") + ")");
step("volume 0 % muet", L[0] !== null && L[0] < 0.001, "RMS=" + L[0]);
step("retour à 100 %", (L[100] ?? 0) > 0.001, "RMS=" + L[100]);
step("booster off : média ré-audible (jamais muté sans gain)", result.mutedAfterOff === false);

console.log(fails === 0 ? "\n🎉 MOTEUR SON : TOUS LES CHECKS PASSENT (Firefox réel)" : `\n💥 ${fails} échec(s)`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
