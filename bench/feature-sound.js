#!/usr/bin/env node
/*
 * feature-sound.js — injecte la feature « 🔊 Son » (v1.13.0) dans un bundle
 * userscript (stable ou preview) de façon DÉTERMINISTE, avec gates (GATE
 * ROUGE si un pattern a dérivé).
 *
 * La feature : des presets de volume en un clic, rendus dans le groupe
 * « Son » EXISTANT des settings globaux (sous le slider audio.volume) :
 *   - 🔇 Muet            : audio.volume = 0
 *   - 🔉 Doux            : audio.volume = 50
 *   - 🔊 Normal (défaut) : audio.volume = 100 + booster désactivé
 *   - 📢 Boost           : audio.volume.booster.enabled = true + volume 200
 *     (0-600 % débloqués par le booster — le slider natif est désactivé
 *     tant que le booster est off)
 *
 * Mécanique (vérifiée dans le bundle v1.12.0) :
 *   - `audio.volume` est une pref STREAM (ABSENTE de ALL_PREFS.global) →
 *     getStreamPref/setStreamPref ; `audio.volume.booster.enabled` est une
 *     pref GLOBALE → getGlobalPref/setGlobalPref.
 *   - `setStreamPref(key, v, "ui")` / `setGlobalPref(key, v, "ui")` : le 3e
 *     argument "ui" déclenche l'émission `BxEventBus.Stream.emit("setting.
 *     changed", {storageKey, settingKey})` → le slider du groupe audio se
 *     synchronise (son onCreated écoute cet événement) et les onChange de la
 *     pref se déclenchent (SoundShortcut.setGainNodeVolume en session).
 *   - Application live : SoundShortcut.setGainNodeVolume(v) →
 *     STATES.currentStream.audioGainNode.gain.value = v / 100 (no-op sans
 *     session — la pref persiste pour la prochaine).
 *
 * Usage :
 *   node bench/feature-sound.js <bundle.js> [--dry-run] [--self-test]
 */
"use strict";
const fs = require("fs");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const DRY_RUN = args.includes("--dry-run");
const SELF_TEST = args.includes("--self-test");

if (!file) {
  console.error("usage: node bench/feature-sound.js <bundle.js> [--dry-run] [--self-test]");
  process.exit(1);
}

// ---- Implémentation injectée (portée du bundle : CE / t / getStreamPref /
// setStreamPref / getGlobalPref / setGlobalPref / SoundShortcut / STATES
// accessibles — mêmes bindings que le groupe audio natif) ----
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

let s = fs.readFileSync(file, "utf8");
const original = s;
const results = [];

// Idempotence : déjà injecté → no-op exit 0.
if (s.includes("window.BX_SOUND_PRESETS")) {
  console.log("== feature-sound " + file + " : déjà injectée — no-op");
  process.exit(0);
}

const ANCHOR_BX = "window.BX_EXPOSED = BxExposed;";
// Fin de l'item audio.volume du groupe « Son » natif (unique dans le bundle) :
// le onCreated écoute setting.changed et rejoue un input sur le range. L'ancre
// finit au MILIEU de l'item : `});}}]}` = on()+onCreated+ITEM+items+groupe. On
// ferme l'item (}}), on ajoute NOTRE item custom, puis on referme items+groupe.
const ANCHOR_TAIL = 'BxEvent.dispatch($range, "input", { ignoreOnChange: !0 });});}}]}';
const ITEM_SOUND = 'BxEvent.dispatch($range, "input", { ignoreOnChange: !0 });});}},($parent) => {window.BX_SOUND_PRESETS.render($parent);}]}';

function count(hay, needle) { return hay.split(needle).length - 1; }

// 1. Implémentation (après BX_EXPOSED)
const n1 = count(s, ANCHOR_BX);
if (n1 !== 1) {
  results.push({ ok: false, name: "ancre BX_EXPOSED", found: n1, expected: 1 });
} else {
  s = s.replace(ANCHOR_BX, ANCHOR_BX + IMPL);
  results.push({ ok: true, name: "implémentation BX_SOUND_PRESETS injectée", found: 1 });
}

// 2. Item presets à la fin du groupe « Son » natif (items: [slider, presets])
const n2 = count(s, ANCHOR_TAIL);
if (n2 !== 1) {
  results.push({ ok: false, name: "groupe Son (fin de l'item audio.volume)", found: n2, expected: 1 });
} else {
  s = s.replace(ANCHOR_TAIL, ITEM_SOUND);
  results.push({ ok: true, name: "presets Son ajoutés au groupe audio", found: 1 });
}

// Rapport
const fails = results.filter((r) => !r.ok);
console.log("== feature-sound " + file + " ==");
for (const r of results) {
  console.log((r.ok ? "  ✓ " : "  ✗ ") + r.name + (r.found !== undefined ? " ×" + r.found : ""));
}
if (fails.length) {
  console.error("\n❌ GATE ROUGE : " + fails.length + " ancre(s) dérivée(s) — la feature ne s'injecte pas");
  process.exit(1);
}

// Syntaxe de l'ensemble
try {
  new Function(s.slice(s.indexOf("// ==UserScript=="))); // ne compile pas le header, on teste la syntaxe
} catch (e) {
  console.error("\n❌ GATE ROUGE : syntaxe invalide après injection — " + e.message);
  process.exit(1);
}

if (!DRY_RUN) {
  fs.writeFileSync(file, s);
  console.log("\nOK : " + file + " écrit (" + s.length + " o)");
} else {
  console.log("\n(dry-run — rien écrit)");
}

// --self-test : rejoue le chemin d'échec sur une copie corrompue (contenu
// PRÉ-injection — sinon l'idempotence sort en no-op exit 0)
if (SELF_TEST) {
  let bad = original.replace(ANCHOR_TAIL, 'BxEvent.dispatch($range, "input", { ignoreOnChange: !0 });});}}]}_CHANGED');
  const exitCode = (() => {
    try {
      const child = require("child_process");
      const tmp = file + ".selftest.js";
      fs.writeFileSync(tmp, bad);
      const r = child.spawnSync(process.execPath, [__filename, tmp], { encoding: "utf8" });
      fs.unlinkSync(tmp);
      return r.status;
    } catch (e) { return -1; }
  })();
  if (exitCode === 1) {
    console.log("\nSELF-TEST OK : ancre corrompue → GATE ROUGE (exit 1)");
    process.exit(0);
  }
  console.error("\n❌ SELF-TEST FAIL : exit attendu 1, obtenu " + exitCode);
  process.exit(1);
}
