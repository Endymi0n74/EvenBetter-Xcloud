#!/usr/bin/env node
/*
 * t10-auto-spoof.test.js — gate CI de la logique T10 (auto-spoof UA).
 *
 * Pas de navigateur en CI → le test tourne en vm sur le statement T10
 * EXTRAIT du build preview réel (better-xcloud-preview.user.js, construit
 * juste avant par build-preview.js dans le step preview de bench.yml).
 *
 * 1. Présence : le marker T10 est présent dans le bundle preview (1
 *    occurrence) et ABSENT du bundle stable (le guard BX_PREVIEW isole bien
 *    les deux builds — dérive → échec).
 * 2. Cohérence : le profil forcé « windows-edge » existe dans les
 *    #USER_AGENTS du bundle (sinon le spoof produirait une UA vide).
 * 3. Comportement vm : le statement extrait est exécuté dans un mock
 *    UserAgent (même contrat que le bundle : #config + spoof() no-op quand
 *    profile === "default") pour chaque UA réelle —
 *    Firefox/Safari → profil forcé windows-edge (gate passé),
 *    Edge/Chrome/Crios → inchangé, profil explicite → jamais écrasé,
 *    BX_PREVIEW=false (contexte stable) → inchangé.
 *
 * --self-test : corrompt le marker T10 sur des COPIES temporaires et vérifie
 * que les checks échouent (chemin d'échec rejouable, build réel intact).
 *
 * Usage : node bench/preview/port/t10-auto-spoof.test.js [--self-test]
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..", "..");
const STABLE = path.join(ROOT, "better-xcloud.user.js");
const PREVIEW = path.join(ROOT, "better-xcloud-preview.user.js");
const BUILD_JS = path.join(ROOT, "bench", "preview", "port", "build-preview.js");

const T10_MARKER = "/* T10 : gate play.xbox.com";
// capture le statement `if (...) UserAgent.#config.profile = "windows-edge";`
// entre le marker et le UserAgent.spoof(); qui le suit (ancre d'injection T10)
const T10_STMT_RE = /\/\* T10 :[\s\S]*?\*\/\s*(if[\s\S]*?)\s*UserAgent\.spoof\(\);/;

const UAS = {
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
  safariWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0",
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
  crios: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/152.0.0.0 Mobile/15E148 Safari/604.1",
};

let failures = 0;
function check(label, cond, extra) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures++; console.error(`  ❌ ${label}${extra ? " :: " + extra : ""}`); }
}

function makeRunner(statement) {
  // mock UserAgent : #config privé + spoof() no-op quand profile === "default"
  // (contrat exact du bundle) — le statement est exécuté DANS le corps de la
  // classe (accès #config valide, comme dans UserAgent.init() du bundle).
  const sandbox = {
    navigator: { userAgent: "" },
    BX_PREVIEW: false,
  };
  vm.createContext(sandbox);
  const src = `
    class UserAgent {
      static #config = { custom: "", profile: "default" };
      static spoof() { this._spoofed = UserAgent.#config.profile !== "default"; }
      static run(ua, profile, bxPreview) {
        navigator.userAgent = ua;
        BX_PREVIEW = bxPreview;
        UserAgent.#config = { custom: "", profile };
        UserAgent._spoofed = false;
        ${statement}
        UserAgent.spoof(); // flux réel du bundle : init() → [T10] → spoof()
        return { profile: UserAgent.#config.profile, spoofed: !!UserAgent._spoofed };
      }
    }
    this.runCase = (ua, profile, bxPreview) => UserAgent.run(ua, profile, bxPreview);
  `;
  vm.runInContext(src, sandbox);
  return sandbox.runCase;
}

function runChecks(stable, preview) {
  // ---- 1. présence marker + pureté du stable ----
  console.log("== 1. Présence T10 (preview) / pureté (stable) ==");
  const markerCount = preview.split(T10_MARKER).length - 1;
  check("marker T10 présent dans le build preview (1 occurrence)", markerCount === 1, `occurrences=${markerCount}`);
  check("marker T10 ABSENT du bundle stable (guard BX_PREVIEW)", !stable.includes(T10_MARKER));

  const stmtMatch = preview.match(T10_STMT_RE);
  check("statement T10 extrait du bundle preview", !!stmtMatch);
  const t10Stmt = stmtMatch ? stmtMatch[1] : "";
  if (t10Stmt) console.log(`  statement : ${t10Stmt.slice(0, 120)}…`);

  // ---- 2. cohérence : le profil forcé existe dans #USER_AGENTS ----
  console.log("== 2. Profil « windows-edge » réel dans le bundle ==");
  const uaIndex = stable.indexOf('"windows-edge":');
  check('clé "windows-edge" présente dans #USER_AGENTS du stable', uaIndex !== -1);
  if (uaIndex !== -1) {
    const uaVal = stable.slice(uaIndex, uaIndex + 200).match(/`([^`]*)`/);
    check("valeur non vide (UA Edge complète)", !!(uaVal && uaVal[1] && uaVal[1].includes("Edg/")), uaVal && uaVal[1] ? uaVal[1].slice(0, 60) : "vide");
  }

  // ---- 3. comportement vm du statement extrait ----
  console.log("== 3. Comportement vm (mock UserAgent, même contrat que le bundle) ==");
  if (t10Stmt) {
    const run = makeRunner(t10Stmt);
    // Firefox / Safari : gate Chromium-only → auto-spoof windows-edge
    let r = run(UAS.firefox, "default", true);
    check("Firefox + default + BX_PREVIEW → profil windows-edge (gate passé)",
      r.profile === "windows-edge" && r.spoofed === true, JSON.stringify(r));
    r = run(UAS.safariWin, "default", true);
    check("Safari Windows + default + BX_PREVIEW → windows-edge",
      r.profile === "windows-edge" && r.spoofed === true, JSON.stringify(r));
    // Chromium réels : jamais spoofés
    for (const [name, ua] of [["Edge", UAS.edge], ["Chrome", UAS.chrome], ["Crios (Chrome iOS)", UAS.crios]]) {
      r = run(ua, "default", true);
      check(`${name} + default → inchangé (default, pas de spoof)`,
        r.profile === "default" && r.spoofed === false, JSON.stringify(r));
    }
    // le setting garde la main : profil explicite jamais écrasé
    r = run(UAS.firefox, "custom", true);
    check("Firefox + profil explicite (custom) → jamais écrasé",
      r.profile === "custom" && r.spoofed === true, JSON.stringify(r));
    r = run(UAS.firefox, "windows-edge", true);
    check("Firefox + profil explicite (windows-edge) → inchangé",
      r.profile === "windows-edge" && r.spoofed === true, JSON.stringify(r));
    // contexte stable : BX_PREVIEW=false → jamais de spoof auto
    r = run(UAS.firefox, "default", false);
    check("Firefox + default + BX_PREVIEW=false (contexte stable) → inchangé",
      r.profile === "default" && r.spoofed === false, JSON.stringify(r));
  } else {
    failures++;
    console.error("  ❌ comportement vm non testé (statement non extrait)");
  }
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

// ---- --self-test : le chemin d'échec sur des copies corrompues ----
if (process.argv.includes("--self-test")) {
  console.log("== SELF-TEST : marker T10 corrompu sur des copies ==");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t10-self-"));
  const sCopy = path.join(dir, "stable.js");
  const pCopy = path.join(dir, "preview.js");
  fs.writeFileSync(sCopy, fs.readFileSync(STABLE, "utf8"));
  fs.writeFileSync(pCopy, fs.readFileSync(PREVIEW, "utf8").replace(T10_MARKER, "/* T10 : corrompu"));
  failures = 0;
  runChecks(fs.readFileSync(sCopy, "utf8"), fs.readFileSync(pCopy, "utf8"));
  const red = failures > 0;
  console.log(red ? "\n[OK] SELF-TEST : dérive T10 détectée (échec attendu)" :
    "\n[FAIL] SELF-TEST : la corruption n'a PAS fait échouer les checks");
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(red ? 0 : 1);
}

failures = 0;
runChecks(fs.readFileSync(STABLE, "utf8"), fs.readFileSync(PREVIEW, "utf8"));
console.log(failures === 0 ? "\nT10 auto-spoof : tests OK" : `\n${failures} échec(s) T10 auto-spoof`);
process.exit(failures === 0 ? 0 : 1);
