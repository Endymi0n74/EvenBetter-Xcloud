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
const { IMPL, IMPL_ENGINE, ENGINE_TAIL, ANCHOR_BX, ANCHOR_TAIL, ITEM_SOUND } = require("../src/features/sound");

let s = fs.readFileSync(file, "utf8");
const original = s;
const results = [];
let changed = false;

// Idempotence PAR BLOC : un bundle peut porter les presets (v1.13.0) sans le
// moteur (v1.13.6) — un no-op global interdirait d'ajouter un bloc à un bundle
// déjà injecté.
const PRESETS_MARKER = "window.BX_SOUND_PRESETS";
const ENGINE_MARKER = "window.BX_SOUND_ENGINE =";
// Corps seul (sans le saut de ligne de tête du gabarit) : c'est ce qu'on
// compare/écrit lors d'un remplacement en place — sinon chaque passage
// ajouterait une ligne vide.
const ENGINE_BLOCK = IMPL_ENGINE.replace(/^\r?\n/, "");
if (!ENGINE_BLOCK.startsWith("window.BX_SOUND_ENGINE = {")) {
  console.error("❌ gabarit moteur inattendu (début : " + JSON.stringify(ENGINE_BLOCK.slice(0, 40)) + ")");
  process.exit(1);
}


// Fin de l'item audio.volume du groupe « Son » natif (unique dans le bundle) :
// le onCreated écoute setting.changed et rejoue un input sur le range. L'ancre
// finit au MILIEU de l'item : `});}}]}` = on()+onCreated+ITEM+items+groupe. On
// ferme l'item (}}), on ajoute NOTRE item custom, puis on referme items+groupe.



function count(hay, needle) { return hay.split(needle).length - 1; }

// 1. Moteur du booster (après BX_EXPOSED, devant l'implémentation : le strip du
//    gate retire la plage [ancre … fin de IMPL], moteur compris).
if (count(s, ENGINE_MARKER) > 0) {
  // Déjà présent : si le bloc a évolué, on le REMPLACE en place — sinon
  // l'idempotence figerait une version périmée du moteur.
  const from = s.indexOf("window.BX_SOUND_ENGINE = {");
  const to = s.indexOf(ENGINE_TAIL, from);
  const current = from >= 0 && to >= 0 ? s.slice(from, to + ENGINE_TAIL.length) : null;
  if (current === null) {
    results.push({ ok: false, name: "bloc moteur illisible (marqueur sans fin)", found: count(s, ENGINE_MARKER), expected: 1 });
  } else if (current.replace(/\r\n/g, "\n") === ENGINE_BLOCK) {
    results.push({ ok: true, name: "moteur son (BX_SOUND_ENGINE) déjà à jour — no-op", found: 1 });
  } else {
    s = s.slice(0, from) + ENGINE_BLOCK + s.slice(to + ENGINE_TAIL.length);
    results.push({ ok: true, name: "moteur son (BX_SOUND_ENGINE) remplacé (version périmée)", found: 1 });
    changed = true;
  }
} else {
  const n0 = count(s, ANCHOR_BX);
  if (n0 !== 1) {
    results.push({ ok: false, name: "ancre BX_EXPOSED (moteur)", found: n0, expected: 1 });
  } else {
    s = s.replace(ANCHOR_BX, ANCHOR_BX + IMPL_ENGINE);
    results.push({ ok: true, name: "moteur son (BX_SOUND_ENGINE) injecté", found: 1 });
    changed = true;
  }
}

// 2. Implémentation des presets (après BX_EXPOSED)
if (count(s, PRESETS_MARKER) > 0) {
  results.push({ ok: true, name: "implémentation BX_SOUND_PRESETS déjà présente — no-op", found: 1 });
} else {
  const n1 = count(s, ANCHOR_BX);
  if (n1 !== 1) {
    results.push({ ok: false, name: "ancre BX_EXPOSED", found: n1, expected: 1 });
  } else {
    s = s.replace(ANCHOR_BX, ANCHOR_BX + IMPL);
    results.push({ ok: true, name: "implémentation BX_SOUND_PRESETS injectée", found: 1 });
    changed = true;
  }
}

// 3. Item presets à la fin du groupe « Son » natif (items: [slider, presets])
//
// ⚠ Garde d'idempotence sur le MARQUEUR, pas sur ITEM_SOUND : dès que le fix
// src/fixes/settings-freeze.js est appliqué, la fin de l'item global corrigé
// (`params` → getter + onCreated) redevient EXACTEMENT ANCHOR_TAIL — donc
// ITEM_SOUND n'est plus présent tel quel et cette étape se relançait en
// réinjectant l'item DANS la fin de l'item (forme `…}}]}` + item + `]}`),
// qui cassait l'item corrigé. Le marqueur `BX_SOUND_PRESETS.render($parent)`
// n'apparaît QUE dans notre item : c'est la seule présence fiable.
const PRESETS_ITEM = "window.BX_SOUND_PRESETS.render($parent)";
if (count(s, PRESETS_ITEM) > 0) {
  results.push({ ok: true, name: "item presets déjà présent dans le groupe audio — no-op", found: 1 });
} else {
  const n2 = count(s, ANCHOR_TAIL);
  if (n2 !== 1) {
    results.push({ ok: false, name: "groupe Son (fin de l'item audio.volume)", found: n2, expected: 1 });
  } else {
    s = s.replace(ANCHOR_TAIL, ITEM_SOUND);
    results.push({ ok: true, name: "presets Son ajoutés au groupe audio", found: 1 });
    changed = true;
  }
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

if (!changed) {
  console.log("== feature-sound " + file + " : déjà injectée (presets + moteur) — no-op");
  process.exit(0);
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
