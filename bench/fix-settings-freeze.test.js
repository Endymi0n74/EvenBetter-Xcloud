#!/usr/bin/env node
/**
 * bench/fix-settings-freeze.test.js — gate CI du fix « gel settings + volume
 * figé » (src/fixes/settings-freeze.js), intégré à la v1.13.6.
 *
 * Pas de navigateur en CI → contrôles statiques + rejeu de l'injection :
 *   1. PRÉSENCE : chaque paire est APPLIQUÉE (forme corrigée ×1, forme
 *      d'origine ×0) dans le bundle stable ET dans le build preview — un
 *      rebuild sans ce fix (il n'est pas dans le pipeline des features) →
 *      GATE ROUGE.
 *   2. REJEU : sur une copie où les paires sont REVERSÉES (l'état d'un bundle
 *      fraîchement dérivé de l'amont), l'injecteur doit les réappliquer —
 *      chemin à emprunter après chaque rebase amont, donc verrouillé.
 *   3. SELF-TEST : une paire corrompue sur une copie → l'injecteur sort en
 *      GATE ROUGE (exit 1) et le gate passe au rouge.
 *
 * Lancement local : node bench/fix-settings-freeze.test.js [--self-test]
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { PAIRS } = require("../src/fixes/settings-freeze");

const ROOT = path.join(__dirname, "..");
const STABLE = path.join(ROOT, "better-xcloud.user.js");
const PREVIEW = path.join(ROOT, "better-xcloud-preview.user.js");
const INJECTOR = path.join(__dirname, "fix-settings-freeze.js");

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
  // Marqueurs lisibles du fix, indépendants de la forme exacte des paires.
  check("attributeFilter présent (observateur BxSelectElement filtré)", count(src, "attributeFilter") === 1, "n=" + count(src, "attributeFilter"));
  check("getter `get params()` du volume ×2 (groupes Son + tab stream)",
    count(src, 'get params() {return {disabled: !getGlobalPref("audio.volume.booster.enabled")};}') === 2,
    "n=" + count(src, 'get params() {return {disabled: !getGlobalPref("audio.volume.booster.enabled")};}'));
  check("forme figée `params: {disabled: …booster…}` ×0",
    count(src, 'params: {disabled: !getGlobalPref("audio.volume.booster.enabled")}') === 0,
    "n=" + count(src, 'params: {disabled: !getGlobalPref("audio.volume.booster.enabled")}'));
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-freeze-"));
  const badPath = path.join(dir, "bundle-bad.user.js");
  let bad = stableSrc;
  for (const pair of PAIRS) {
    // Corruption INSÉRÉE dans le motif : concaténer après laisserait la forme
    // d'origine en sous-motif (le fix ne serait pas détecté).
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

// ---- 3. rejeu sur copie « amont » (paires reversées) ----
console.log("== 3. Rejeu d'injection (copie amont, paires reversées) ==");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-freeze-"));
const upstreamPath = path.join(dir, "bundle-upstream.user.js");
let upstream = stableSrc;
for (const pair of PAIRS) upstream = upstream.replace(pair.to, pair.from);
fs.writeFileSync(upstreamPath, upstream);

const reverted =
  PAIRS.every((p) => count(upstream, p.from) === 1 && count(upstream, p.to) === 0);
check("copie amont obtenue (chaque paire reversée)", reverted,
  PAIRS.map((p) => `${count(upstream, p.from)}/${count(upstream, p.to)}`).join(" "));

if (reverted) {
  const r = spawnSync(process.execPath, [INJECTOR, upstreamPath, "--dry-run", "--self-test"], { encoding: "utf8" });
  if (r.stdout) console.log(r.stdout);
  if (r.stderr) console.error(r.stderr);
  check("fix-settings-freeze.js --dry-run --self-test → exit 0 (rejeu + chemin d'échec OK)", r.status === 0, "exit=" + r.status);
} else {
  failures++;
}
fs.rmSync(dir, { recursive: true, force: true });

console.log(failures === 0 ? "\nFix settings-freeze : tests OK" : `\n${failures} échec(s) Fix settings-freeze`);
process.exit(failures === 0 ? 0 : 1);
