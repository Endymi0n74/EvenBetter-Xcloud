#!/usr/bin/env node
/**
 * bench/feature-sound.test.js — gate CI de la feature « 🔊 Son » (v1.13.0),
 * branché dans le step preview de bench.yml.
 *
 * Pas de navigateur en CI → vérifications statiques + rejeu de l'injection :
 *   1. PRÉSENCE : la feature est dans le bundle STABLE (source de vérité) ET
 *      dans le build PREVIEW (qui en hérite via build-preview.js) — un
 *      rebuild qui oublie l'injection → GATE ROUGE.
 *   2. ANCRES : dans le bundle stable injecté, les ancres d'injection de
 *      feature-sound.js tiennent (BX_EXPOSED ×1, implémentation ×1, item
 *      presets ajouté au groupe audio ×1, forme brute ×0) — une dérive du
 *      source amont ou de l'injection → GATE ROUGE.
 *   3. REJEU + SELF-TEST : copie STRIPPÉE du bundle (injection inversée,
 *      vérifiée) sur laquelle on relance `feature-sound.js --dry-run
 *      --self-test` : le chemin d'injection complet (2 ancres + syntaxe) ET
 *      le chemin d'échec (ancre corrompue → exit 1 attendu) doivent repasser
 *      → GATE ROUGE sinon.
 *
 * --self-test : corrompt l'item injecté (ITEM_SOUND) sur une COPIE du bundle
 * et vérifie que les checks passent au rouge — chemin d'échec rejouable sans
 * toucher aux builds réels, comme les autres gates.
 *
 * Lancement local : node bench/feature-sound.test.js [--self-test]
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const STABLE = path.join(ROOT, "better-xcloud.user.js");
const PREVIEW = path.join(ROOT, "better-xcloud-preview.user.js");
const FEATURE_JS = path.join(__dirname, "..", "src", "features", "sound.js");
const BUILD_JS = path.join(ROOT, "bench", "preview", "port", "build-preview.js");

// Ancres extraites de src/features/sound.js (source de vérité de l'injection).
// Si une const est renommée/déplacée dans le script, l'extraction échoue →
// GATE ROUGE immédiat. Normalisation CRLF→LF (checkout Windows autocrlf).
const FEATURE_SRC = fs.readFileSync(FEATURE_JS, "utf8").replace(/\r\n/g, "\n");
const ANCHOR_BX = (FEATURE_SRC.match(/const ANCHOR_BX = "([^"]*)";/) || [])[1];
const ANCHOR_TAIL = (FEATURE_SRC.match(/const ANCHOR_TAIL = '([^']*)';/) || [])[1];
const ITEM_SOUND = (FEATURE_SRC.match(/const ITEM_SOUND = '([^']*)';/) || [])[1];
const IMPL = (FEATURE_SRC.match(/const IMPL = `([^]*?)`;/) || [])[1];
const IMPL_ENGINE = (FEATURE_SRC.match(/const IMPL_ENGINE = `([^]*?)`;/) || [])[1];

// Marqueurs du moteur (v1.13.6) — noms stables, extraits du module source.
const ENGINE_MARKER = "window.BX_SOUND_ENGINE =";
const ENGINE_START = "window.BX_SOUND_ENGINE.start();";

if (!ANCHOR_BX || !ANCHOR_TAIL || !ITEM_SOUND || !IMPL || !IMPL_ENGINE) {
  console.error("❌ GATE : ancres non extractibles depuis src/features/sound.js (const renommée ?)");
  process.exit(1);
}

const count = (h, n) => h.split(n).length - 1;

function runChecks(stableSrc, previewSrc) {
  let failures = 0;
  const check = (label, cond, extra) => {
    if (cond) console.log(`  ✅ ${label}`);
    else { failures++; console.error(`  ❌ ${label}${extra ? " :: " + extra : ""}`); }
  };

  // ---- 1. présence ----
  console.log("== 1. Présence de la feature (stable + preview) ==");
  check("feature présente dans le bundle stable", count(stableSrc, "window.BX_SOUND_PRESETS") >= 1, "n=" + count(stableSrc, "window.BX_SOUND_PRESETS"));
  check("feature présente dans le build preview (héritée du stable)", count(previewSrc, "window.BX_SOUND_PRESETS") >= 1, "n=" + count(previewSrc, "window.BX_SOUND_PRESETS"));

  // ---- 2. ancres (bundle stable injecté) ----
  console.log("== 2. Ancres d'injection (bundle stable injecté) ==");
  check("ancre BX_EXPOSED ×1", count(stableSrc, ANCHOR_BX) === 1, "n=" + count(stableSrc, ANCHOR_BX));
  check("implémentation BX_SOUND_PRESETS ×1", count(stableSrc, IMPL) === 1, "n=" + count(stableSrc, IMPL));
  // Présence de l'item par son MARQUEUR et non par ITEM_SOUND : le fix
  // settings-freeze (v1.13.6) réécrit la fin de l'item global, si bien que
  // ANCHOR_TAIL s'y retrouve et qu'ITEM_SOUND n'est plus la forme injectée.
  check("item presets ajouté au groupe audio ×1 (marqueur render)",
    count(stableSrc, "window.BX_SOUND_PRESETS.render($parent)") === 1,
    "n=" + count(stableSrc, "window.BX_SOUND_PRESETS.render($parent)"));
  check("item presets suivi de la fermeture du groupe ×1",
    count(stableSrc, "window.BX_SOUND_PRESETS.render($parent);}]}") === 1,
    "n=" + count(stableSrc, "window.BX_SOUND_PRESETS.render($parent);}]}"));

  // ---- 2bis. Moteur du booster (v1.13.6) ----
  // Le slider ne sert à rien tant que le graphe WebAudio n'est pas monté et que
  // l'événement de la pref GLOBALE n'atteint pas le panneau stream : ces
  // contrôles verrouillent les 3 mécanismes du correctif (bus, branchement live,
  // relance du contexte Firefox).
  console.log("== 2bis. Moteur du booster (BX_SOUND_ENGINE) ==");
  check("moteur présent dans le bundle stable", count(stableSrc, ENGINE_MARKER) === 1, "n=" + count(stableSrc, ENGINE_MARKER));
  check("moteur présent dans le build preview", count(previewSrc, ENGINE_MARKER) === 1, "n=" + count(previewSrc, ENGINE_MARKER));
  check("moteur démarré au chargement", count(stableSrc, ENGINE_START) === 1, "n=" + count(stableSrc, ENGINE_START));
  check("pont de bus : la pref globale est republiée sur le bus Stream",
    count(stableSrc, "isStreamPref(payload.settingKey)) return;") === 1 &&
      count(stableSrc, 'BxEventBus.Stream.emit("setting.changed", payload)') === 1,
    "garde=" + count(stableSrc, "isStreamPref(payload.settingKey)) return;") +
    " emit=" + count(stableSrc, 'BxEventBus.Stream.emit("setting.changed", payload)'));
  check("relance du contexte suspendu (politique Firefox) présente",
    count(stableSrc, '.state === "suspended"') === 1 && count(stableSrc, "_resumeOnly") >= 2,
    "garde=" + count(stableSrc, '.state === "suspended"') + " resumeOnly=" + count(stableSrc, "_resumeOnly"));
  check("un seul AudioContext par moteur (pas de fuite de contexte)",
    count(stableSrc, "if (!ctx) ctx = this.ctx;") === 1, "n=" + count(stableSrc, "if (!ctx) ctx = this.ctx;"));
  check("branchement live source → gain → destination présent",
    count(stableSrc, "createMediaStreamSource") >= 1 && count(stableSrc, "gain.connect(ctx.destination)") === 1,
    "sources=" + count(stableSrc, "createMediaStreamSource") + " dest=" + count(stableSrc, "gain.connect(ctx.destination)"));
  check("le média est mis en sourdine APRÈS le branchement (jamais de silence)",
    count(stableSrc, "$media.muted = true;") === 1, "n=" + count(stableSrc, "$media.muted = true;"));
  check("extinction : média ré-audible",
    count(stableSrc, "if ($old && $old.muted) $old.muted = false;") === 1,
    "n=" + count(stableSrc, "if ($old && $old.muted) $old.muted = false;"));

  // ---- 3. rejeu + self-test sur copie sans feature ----
  console.log("== 3. Rejeu d'injection + self-test (copie sans feature) ==");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-sound-"));
  const strippedPath = path.join(dir, "bundle-stripped.user.js");
  let stripped = stableSrc;
  // L'ancre BX_EXPOSED est partagée par TOUTES les features (latence v1.10,
  // data v1.11, région v1.12, son v1.13, purge BX_PURGE_DIAG…) : l'IMPL du
  // son n'est plus forcément ADJACENT à l'ancre (les features plus récentes
  // passent devant). On retire la plage [ANCHOR_BX … fin de IMPL_SOUND] au
  // lieu d'une concaténation exacte — robuste à l'ajout de nouvelles
  // features (même fix que feature-datasaver.test.js).
  const bxIdx = stripped.indexOf(ANCHOR_BX);
  const sndIdx = bxIdx >= 0 ? stripped.indexOf(IMPL, bxIdx) : -1;
  if (bxIdx >= 0 && sndIdx >= 0) {
    stripped = stripped.slice(0, bxIdx + ANCHOR_BX.length) + stripped.slice(sndIdx + IMPL.length);
  }
  // Retrait de l'ITEM par son segment exact (le marqueur de présence) : la fin
  // de l'item audio.volume native revient alors à la forme de l'ancre, prête
  // pour un rejeu — ITEM_SOUND n'est pas fiable comme forme injectée depuis le
  // fix settings-freeze (voir le gate fix-settings-freeze.test.js).
  const itemSeg = ",($parent) => {window.BX_SOUND_PRESETS.render($parent);}";
  if (count(stripped, itemSeg) === 1) stripped = stripped.replace(itemSeg, "");
  fs.writeFileSync(strippedPath, stripped);

  const stripOk =
    count(stripped, "window.BX_SOUND_PRESETS") === 0 &&
    count(stripped, ENGINE_MARKER) === 0 &&
    count(stripped, ANCHOR_BX) === 1 &&
    count(stripped, ANCHOR_TAIL) >= 1;
  check("copie sans feature obtenue (injection inversée, ancres revenues)", stripOk,
    "sound=" + count(stripped, "window.BX_SOUND_PRESETS") + " moteur=" + count(stripped, ENGINE_MARKER) +
    " bxAncre=" + count(stripped, ANCHOR_BX) + " tail=" + count(stripped, ANCHOR_TAIL));

  if (stripOk) {
    // feature-sound.js : injection (dry-run, rien écrit) + --self-test du
    // chemin d'échec (ancre corrompue sur copie → exit 1 attendu → OK).
    const r = spawnSync(process.execPath, [FEATURE_JS, strippedPath, "--dry-run", "--self-test"], { encoding: "utf8" });
    if (r.stdout) console.log(r.stdout);
    if (r.stderr) console.error(r.stderr);
    check("feature-sound.js --dry-run --self-test → exit 0 (injection + chemin d'échec OK)", r.status === 0, "exit=" + r.status);
  } else {
    failures++;
    console.error("  ❌ rejeu non exécuté (strip invalide)");
  }
  fs.rmSync(dir, { recursive: true, force: true });

  return failures;
}

// ---- 0. bundles présents (le build preview précède ce test en CI) ----
if (!fs.existsSync(PREVIEW)) {
  console.log("== 0. Build preview manquant — lancement du build ==");
  execFileSync(process.execPath, [BUILD_JS], { cwd: ROOT, stdio: "inherit" });
}
if (!fs.existsSync(STABLE)) {
  console.error("❌ bundle stable absent : " + STABLE);
  process.exit(1);
}

const s = fs.readFileSync(STABLE, "utf8").replace(/\r\n/g, "\n");
const p = fs.readFileSync(PREVIEW, "utf8").replace(/\r\n/g, "\n");

// ---- --self-test : le chemin d'échec sur une copie corrompue ----
// Le bundle est DÉJÀ injecté : la corruption doit toucher la forme injectée
// (ITEM_SOUND), pas l'ancre brute (absente du bundle injecté).
if (process.argv.includes("--self-test")) {
  // Corruption sur le MARQUEUR de l'item (pas sur ITEM_SOUND : depuis le fix
  // settings-freeze la forme injectée n'est plus ITEM_SOUND, la corruption
  // serait un no-op et le self-test ne prouverait rien).
  console.log("== SELF-TEST : marqueur de l'item injecté corrompu sur une copie ==");
  const MARK = "window.BX_SOUND_PRESETS.render($parent)";
  const sBad = s.replace(MARK, MARK.replace(".render(", ".render_CHANGED("));
  if (count(sBad, MARK) !== 0) {
    console.error("❌ SELF-TEST : corruption inefficace (marqueur encore présent)");
    process.exit(1);
  }
  const red = runChecks(sBad, p) > 0;
  console.log(red ? "\n[OK] SELF-TEST : dérive d'ancre détectée (GATE ROUGE attendu)" :
    "\n[FAIL] SELF-TEST : la corruption n'a PAS fait échouer les checks");
  process.exit(red ? 0 : 1);
}

const failures = runChecks(s, p);
console.log(failures === 0 ? "\nFeature Son : tests OK" : `\n${failures} échec(s) Feature Son`);
process.exit(failures === 0 ? 0 : 1);
