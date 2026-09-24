#!/usr/bin/env node
/**
 * bench/fix-settings-bus.test.js — gate CI du fix « bus setting.changed »
 * (src/fixes/settings-bus.js), intégré à la v1.13.7.
 *
 * Pas de navigateur en CI → contrôles statiques + rejeu de l'injection :
 *   1. PRÉSENCE : chaque paire est APPLIQUÉE (forme corrigée ×1, forme d'origine
 *      ×0) dans le bundle stable ET dans le build preview — un rebuild sans ce
 *      fix (il n'est pas dans le pipeline des features) → GATE ROUGE.
 *   2. REJEU : sur une copie où les fixes sont REVERSÉS (état d'un bundle
 *      fraîchement dérivé de l'amont), gel/volume puis bus doivent s'appliquer
 *      sans no-op silencieux — chemin à emprunter après chaque rebase amont.
 *   3. SELF-TEST : une paire corrompue sur une copie → l'injecteur sort en
 *      GATE ROUGE (exit 1) et le gate passe au rouge.
 *
 * Lancement local : node bench/fix-settings-bus.test.js [--self-test]
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { PAIRS, SOUND_ITEM_BUS_TO, STREAM_HANDLER_TO, rebusItemText } = require("../src/fixes/settings-bus");
const { PAIRS: FREEZE_PAIRS } = require("../src/fixes/settings-freeze");

const ROOT = path.join(__dirname, "..");
const STABLE = path.join(ROOT, "better-xcloud.user.js");
const PREVIEW = path.join(ROOT, "better-xcloud-preview.user.js");
const INJECTOR = path.join(__dirname, "fix-settings-bus.js");
const FREEZE_INJECTOR = path.join(__dirname, "fix-settings-freeze.js");

const count = (hay, needle) => hay.split(needle).length - 1;
const norm = (s) => s.replace(/\r\n/g, "\n");

let failures = 0;
const check = (label, cond, extra) => {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures++; console.error(`  ❌ ${label}${extra ? " :: " + extra : ""}`); }
};

function checkBundle(label, src) {
  console.log(`== ${label} ==`);
  for (const pair of PAIRS) {
    const nFrom = count(src, pair.from);
    const nTo = count(src, pair.to);
    check(`${pair.name} — appliqué (corrigé ×1, d'origine ×0)`, nTo === 1 && nFrom === 0, `from=${nFrom} to=${nTo}`);
  }
  // Marqueurs lisibles, indépendants de la forme exacte des paires.
  check("item « Son » : bus Script (jamais Stream pour le booster)",
    count(src, SOUND_ITEM_BUS_TO) === 1 && count(src, PAIRS[0].from) === 0,
    "script=" + count(src, SOUND_ITEM_BUS_TO) + " stream=" + count(src, PAIRS[0].from));
  check("panneau stream : handler partagé, abonné aux 2 bus",
    count(src, "BxEventBus.Stream.on(\"setting.changed\", bxOnSettingChanged)") === 1 &&
    count(src, "BxEventBus.Script.on(\"setting.changed\", bxOnSettingChanged)") === 1,
    "stream=" + count(src, "BxEventBus.Stream.on(\"setting.changed\", bxOnSettingChanged)") +
    " script=" + count(src, "BxEventBus.Script.on(\"setting.changed\", bxOnSettingChanged)"));
  check("plus aucun pont Script→Stream dans le moteur son",
    count(src, "// Pont : une pref GLOBALE") === 0, "n=" + count(src, "// Pont : une pref GLOBALE"));
}

// ---- 0. bundles présents ----
if (!fs.existsSync(STABLE) || !fs.existsSync(PREVIEW)) {
  console.error("❌ bundle stable ou preview absent — lancer d'abord les builds (bump/publish)");
  process.exit(1);
}

const stableSrc = norm(fs.readFileSync(STABLE, "utf8"));
const previewSrc = norm(fs.readFileSync(PREVIEW, "utf8"));

// ---- --self-test : paire corrompue → injecteur ROUGE + gate ROUGE ----
if (process.argv.includes("--self-test")) {
  console.log("== SELF-TEST : forme corrigée corrompue sur une copie ==");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-bus-"));
  const badPath = path.join(dir, "bundle-bad.user.js");
  let bad = stableSrc;
  for (const pair of PAIRS) {
    // Corruption INSÉRÉE dans le motif (concaténer après laisserait la forme
    // d'origine en sous-motif : le fix ne serait pas détecté).
    if (bad.includes(pair.to)) {
      bad = bad.replace(pair.to, pair.to.slice(0, -1) + "_X" + pair.to.slice(-1));
      break;
    }
  }
  fs.writeFileSync(badPath, bad);
  const r = spawnSync(process.execPath, [INJECTOR, badPath], { encoding: "utf8" });
  const red = r.status === 1;
  console.log(red ? "[OK] SELF-TEST : paire corrompue détectée (GATE ROUGE attendu)" : "[FAIL] SELF-TEST : aucune détection");
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(red ? 0 : 1);
}

// ---- 1/2. présence dans les deux bundles ----
checkBundle("1. Bundle stable", stableSrc);
checkBundle("2. Build preview", previewSrc);

// ---- 3. rejeu sur copie « amont » (les deux fixes reversés) ----
console.log("== 3. Rejeu d'injection (copie amont, fixes reversés) ==");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-bus-"));
const upstreamPath = path.join(dir, "bundle-upstream.user.js");
let upstream = stableSrc;
// Reverser le fix bus d'abord (il a réécrit le contenu de 2 paires du fix gel),
// puis le fix gel/volume lui-même — qui restaure la forme amont des 2 items et
// emporte donc les formes visées par le fix bus.
for (const pair of PAIRS) upstream = upstream.split(pair.to).join(pair.from);
for (const pair of FREEZE_PAIRS) {
  const alt = rebusItemText(pair.to);
  const form = [pair.to, alt].find((f) => upstream.includes(f));
  if (form) upstream = upstream.replace(form, pair.from);
}
fs.writeFileSync(upstreamPath, upstream);

// Sur une base amont, les paires du fix bus ne sont PAS applicables : leur forme
// d'origine n'existe qu'après le fix gel (c'est la garde d'ordre). Ce qui doit
// être vrai ici : gel/volume applicable (from ×1) et bus inapplicable (0/0).
const reverted =
  FREEZE_PAIRS.every((p) => count(upstream, p.from) === 1 && count(upstream, p.to) === 0) &&
  PAIRS.every((p) => count(upstream, p.from) === 0 && count(upstream, p.to) === 0);
check("copie amont obtenue (gel applicable, bus pas encore)", reverted,
  PAIRS.map((p) => `${count(upstream, p.from)}/${count(upstream, p.to)}`).join(" ") + " | " +
  FREEZE_PAIRS.map((p) => `${count(upstream, p.from)}/${count(upstream, p.to)}`).join(" "));

if (reverted) {
  // Garde d'ordre : le fix bus seul sur une base amont doit REFUSER.
  const alone = spawnSync(process.execPath, [INJECTOR, upstreamPath], { encoding: "utf8" });
  const refused = alone.status === 1 && /ORDRE/.test((alone.stderr || "") + (alone.stdout || ""));
  console.log(refused ? "[OK] fix-settings-bus.js seul sur une base amont → GATE ROUGE (ORDRE)" : "[FAIL] garde d'ordre absente");
  if (!refused) failures++;

  const freeze = spawnSync(process.execPath, [FREEZE_INJECTOR, upstreamPath], { encoding: "utf8" });
  check("fix-settings-freeze.js sur copie amont → exit 0", freeze.status === 0, "exit=" + freeze.status);
  check("le fix gel restaure bien les formes visées par le fix bus",
    PAIRS.every((p) => count(norm(fs.readFileSync(upstreamPath, "utf8")), p.from) === 1),
    PAIRS.map((p) => count(norm(fs.readFileSync(upstreamPath, "utf8")), p.from)).join(" "));

  const bus = spawnSync(process.execPath, [INJECTOR, upstreamPath], { encoding: "utf8" });
  if (bus.stdout) console.log(bus.stdout);
  if (bus.stderr) console.error(bus.stderr);
  check("fix-settings-bus.js sur copie gelée → application réelle (exit 0)", bus.status === 0, "exit=" + bus.status);

  // Reproduction exacte : freeze + bus sur une base amont doit rendre le bundle
  // committé, octet pour octet.
  const chained = norm(fs.readFileSync(upstreamPath, "utf8"));
  check("enchaînement freeze → bus reproductible (bundle identique, octet pour octet)",
    chained === stableSrc, "len=" + chained.length + " vs " + stableSrc.length +
    (chained === stableSrc ? "" : " · première divergence @" + (() => { let i = 0; while (i < chained.length && chained[i] === stableSrc[i]) i++; return i; })()));
} else {
  failures++;
}
fs.rmSync(dir, { recursive: true, force: true });

console.log(failures === 0 ? "\nFix settings-bus : tests OK" : `\n${failures} échec(s) Fix settings-bus`);
process.exit(failures === 0 ? 0 : 1);
