#!/usr/bin/env node
/**
 * bench/settings-bus.test.js — gate CI de l'audit des bus `setting.changed`
 * (bench/settings-bus-audit.js).
 *
 * L'audit affirme que TOUT listener `setting.changed` peut recevoir les prefs
 * qu'il filtre (le bus Stream ne porte que les prefs de ALL_PREFS.stream, le bus
 * Script tout le reste). Ce gate verrouille l'audit lui-même :
 *   1. VERDICT : les 2 bundles du repo passent (0 défaut) et le contrat
 *      d'émission est reconnu conforme — sinon l'analyse serait périmée ;
 *   2. NON-VACUITÉ : sur une copie où le fix bus est REVERSÉ, l'audit DOIT
 *      retrouver les 2 items `audio.volume` injoignables (preuve que le gate
 *      détecte la régression, pas seulement qu'il ne dit rien) ;
 *   3. DÉRIVE : contrat d'émission modifié → GATE ROUGE explicite ;
 *   4. SÉMANTIQUE : la règle de livraison (stream = prefs stream uniquement,
 *      script = le reste) et l'extraction des clés sont testées unitairement ;
 *   5. CLI : exit 0 sur les bundles réels, exit 1 sur une fixture défectueuse.
 *
 * Lancement local : node bench/settings-bus.test.js
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { analyze, keysOf, busDelivers, classOf, prefsOf } = require("./settings-bus-audit");
const { PAIRS: BUS_PAIRS } = require("../src/fixes/settings-bus");

const ROOT = path.join(__dirname, "..");
const STABLE = path.join(ROOT, "better-xcloud.user.js");
const PREVIEW = path.join(ROOT, "better-xcloud-preview.user.js");
const AUDITOR = path.join(__dirname, "settings-bus-audit.js");
const norm = (s) => s.replace(/\r\n/g, "\n");

let failures = 0;
const check = (label, cond, extra) => {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures++; console.error(`  ❌ ${label}${extra ? " :: " + extra : ""}`); }
};

if (!fs.existsSync(STABLE) || !fs.existsSync(PREVIEW)) {
  console.error("❌ bundle stable ou preview absent — lancer d'abord les builds (bump/publish)");
  process.exit(1);
}

const stableSrc = norm(fs.readFileSync(STABLE, "utf8"));
const previewSrc = norm(fs.readFileSync(PREVIEW, "utf8"));

// ---- 1. verdict sur les bundles réels ----
console.log("== 1. Verdict sur les bundles du repo ==");
for (const [label, src] of [["stable", stableSrc], ["preview", previewSrc]]) {
  const r = analyze(src);
  check(`${label} : 0 défaut (tous les listeners joignables)`, r.errors.length === 0, r.errors.join(" | "));
  check(`${label} : contrat d'émission conforme`, r.contract === true);
  check(`${label} : préambule ALL_PREFS lu (global/stream non vides)`, !!r.prefs && r.prefs.global.size > 40 && r.prefs.stream.size > 25,
    r.prefs ? r.prefs.global.size + "/" + r.prefs.stream.size : "prefs illisibles");
  check(`${label} : les 2 items audio.volume audités (groupes repérés)`, r.groups.length >= 5, "groupes=" + r.groups.length);
  const boosters = r.groups.filter((g) => g.keys.includes("audio.volume.booster.enabled"));
  check(`${label} : les 2 groupes du booster sont verts`, boosters.length >= 2 && boosters.every((g) => g.problems.length === 0),
    boosters.map((g) => g.buses.join("+") + (g.problems.length ? " ✗" : " ✓")).join(" | "));
}

// ---- 2. non-vacuité : le fix bus reversé doit être détecté ----
console.log("== 2. Non-vacuité (fix bus reversé) ==");
{
  let broken = stableSrc;
  for (const pair of BUS_PAIRS) broken = broken.split(pair.to).join(pair.from);
  const r = analyze(broken);
  const boosterBreaks = r.errors.filter((e) => e.includes("audio.volume.booster.enabled"));
  check("les 2 items audio.volume redeviennent injoignables (2 défauts)", boosterBreaks.length === 2, boosterBreaks.join(" | "));
  check("le défaut nomme la classe de la pref (globale)", boosterBreaks.every((e) => e.includes("(globale)")), boosterBreaks.join(" | "));
  check("l'audit ne signale AUCUN autre défaut parasite", r.errors.length === boosterBreaks.length, r.errors.join(" | "));
}

// ---- 3. dérive du contrat d'émission ----
console.log("== 3. Dérive du contrat d'émission ==");
{
  const drifted = stableSrc.replace('if (isStreamPref(key)) BxEventBus.Stream.emit("setting.changed"', 'if (!0) BxEventBus.Script.emit("setting.changed"');
  const r = analyze(drifted);
  check("contrat modifié → GATE ROUGE explicite", r.contract === false && r.errors.some((e) => e.includes("contrat d'émission")), r.errors.join(" | "));
}

// ---- 4. sémantique de la règle de livraison + extraction des clés ----
console.log("== 4. Sémantique (règle de livraison, extraction des clés) ==");
{
  const prefs = prefsOf(stableSrc);
  check("Stream livre une pref stream", busDelivers("stream", "audio.volume", prefs) === true);
  check("Stream NE livre PAS une pref globale", busDelivers("stream", "audio.volume.booster.enabled", prefs) === false);
  check("Script livre une pref globale", busDelivers("script", "audio.volume.booster.enabled", prefs) === true);
  check("Script NE livre PAS une pref stream", busDelivers("script", "audio.volume", prefs) === false);
  check("classe d'une pref globale", classOf("audio.volume.booster.enabled", prefs) === "globale");
  check("classe d'une pref stream", classOf("audio.volume", prefs) === "stream");
  check("clé inconnue classée hors référentiel", classOf("pref.qui.n.existe.pas", prefs) === "hors référentiel");

  const k1 = keysOf('if (payload.settingKey !== "audio.volume.booster.enabled") return;');
  check("clés extraites d'une comparaison !== (garde « ce seul événement »)", k1.keys.length === 1 && k1.keys[0] === "audio.volume.booster.enabled", JSON.stringify(k1));
  const k2 = keysOf('if (settingKey === "a") {x()} else if (settingKey === "b") {y()}');
  check("clés extraites d'une chaîne de else-if", k2.keys.join(",") === "a,b", JSON.stringify(k2));
  const k3 = keysOf('if (isStreamPref(data.settingKey)) this.update(data.settingKey);');
  check("joker isStreamPref détecté (aucune clé littérale)", k3.wildcardStream === true && k3.keys.length === 0, JSON.stringify(k3));
}

// ---- 5. CLI : code de sortie ----
console.log("== 5. CLI (code de sortie) ==");
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-bus-audit-"));
  const okPath = path.join(dir, "ok.user.js");
  const koPath = path.join(dir, "ko.user.js");
  fs.writeFileSync(okPath, stableSrc);
  let ko = stableSrc;
  for (const pair of BUS_PAIRS) ko = ko.split(pair.to).join(pair.from);
  fs.writeFileSync(koPath, ko);
  const okRun = spawnSync(process.execPath, [AUDITOR, okPath, "--quiet"], { encoding: "utf8" });
  const koRun = spawnSync(process.execPath, [AUDITOR, koPath, "--quiet"], { encoding: "utf8" });
  check("bundle corrigé → exit 0", okRun.status === 0, "exit=" + okRun.status);
  check("bundle défectueux → exit 1", koRun.status === 1, "exit=" + koRun.status);
  check("sortie rouge lisible (GATE ROUGE + défauts)", /GATE ROUGE/.test(koRun.stdout) && /booster/.test(koRun.stdout));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAudit bus setting.changed : tests OK" : `\n${failures} échec(s) Audit bus setting.changed`);
process.exit(failures === 0 ? 0 : 1);
