#!/usr/bin/env node
/**
 * bench/readme-version.test.js — gate CI « README toujours à jour ».
 *
 * Règle utilisateur (20 août) : « le README doit toujours être à jour ».
 * Ce gate automatise l'audit qui suivait chaque bump :
 *   1. ANCRES COURANTES : les READMEs « front » (README.md, README.en.md,
 *      mobile/README.md) DOIVENT citer la version courante là où ils la
 *      citent — titre `# EvenBetterXcloud — v<VERSION>`, ligne `Version` de
 *      la table « Deux versions », tag d'auto-update du preview, APK
 *      `evenbetter-xcloud-<VERSION>.apk` / `-<PREVIEW>.apk`.
 *   2. AUCUNE RÉFÉRENCE PÉRIMÉE : dans TOUS les READMEs (y compris les
 *      journaux bench/), un lien release `releases/download/evenbetter-xcloud-v<tag>`
 *      ou un APK versionné dont le tag/version n'est ni VERSION ni
 *      PREVIEW_VERSION → GATE ROUGE (la rétention purge les anciennes
 *      releases : ce lien deviendrait un 404 pour les utilisateurs, cf.
 *      incidents d'auto-update cassé). Les mentions historiques en prose
 *      (ex. « Nouveauté v1.13.0 ») sont tolérées — seuls les tags au format
 *      `evenbetter-xcloud-vX.Y.Z[-previewN]` et les APK versionnés sont
 *      vérifiés.
 *   3. SELF-TEST (--self-test) : copie corrompue (titre + tag + APK périmés)
 *      → le gate doit sortir en exit 1 avec le message GATE ROUGE.
 *
 * Sources de vérité : `VERSION` (stable) et `PREVIEW_VERSION` (preview) à la
 * racine — les mêmes fichiers lus par bump-version.sh et build-preview.js.
 *
 * Lancement local : node bench/readme-version.test.js [--self-test]
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const VERSION = fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim();
const PREVIEW = fs.readFileSync(path.join(ROOT, "PREVIEW_VERSION"), "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(VERSION) || !/^\d+\.\d+\.\d+-preview\d+$/.test(PREVIEW)) {
  console.error(`❌ GATE : fichiers de version invalides (VERSION="${VERSION}", PREVIEW_VERSION="${PREVIEW}")`);
  process.exit(1);
}

// READMEs audités (présence obligatoire) ; « FRONT » = docs utilisateur dont
// les mentions de version en prose doivent rester à jour (les journaux
// bench/ tolèrent les mentions historiques, mais PAS les liens/APK périmés).
const FILES = [
  "README.md",
  "README.en.md",
  "mobile/README.md",
  "bench/README.md",
  "bench/preview/README.md",
  "bench/preview/port/README.md",
];
const FRONT = new Set(["README.md", "README.en.md", "mobile/README.md"]);

function loadFiles(overrides) {
  const map = {};
  for (const f of FILES) {
    if (overrides && overrides[f] !== undefined) {
      map[f] = overrides[f];
      continue;
    }
    const p = path.join(ROOT, f);
    map[f] = fs.existsSync(p) ? fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n") : null;
  }
  return map;
}

function runChecks(files) {
  const ok = [];
  const failures = [];
  const check = (label, cond, detail) => {
    if (cond) ok.push(label);
    else failures.push(label + (detail ? " :: " + detail : ""));
  };

  // ---- 1. ancres courantes (READMEs front) ----
  console.log("== 1. Ancres courantes (VERSION=" + VERSION + " · PREVIEW=" + PREVIEW + ") ==");
  for (const f of ["README.md", "README.en.md"]) {
    const c = files[f];
    check(`${f} : fichier présent`, c != null, "README manquant");
    if (c == null) continue;
    check(`${f} : titre « # EvenBetterXcloud — v${VERSION} »`, c.includes(`# EvenBetterXcloud — v${VERSION}`),
      "ligne attendue : # EvenBetterXcloud — v" + VERSION);
    const row = `| Version | \`${VERSION}\` | \`${PREVIEW}\` (prerelease) |`;
    check(`${f} : ligne Version de la table « Deux versions »`, c.includes(row),
      "ligne attendue : " + row);
    check(`${f} : tag d'auto-update preview ${PREVIEW}`, c.includes(`evenbetter-xcloud-v${PREVIEW}`));
    check(`${f} : lien release courante v${VERSION}`, c.includes(`evenbetter-xcloud-v${VERSION}`));
  }
  const mob = files["mobile/README.md"];
  check("mobile/README.md : fichier présent", mob != null, "README manquant");
  if (mob != null) {
    check(`mobile/README.md : APK stable ${VERSION}`, mob.includes(`evenbetter-xcloud-${VERSION}.apk`));
    check(`mobile/README.md : APK preview ${PREVIEW}`, mob.includes(`evenbetter-xcloud-${PREVIEW}.apk`));
  }

  // ---- 2. aucune référence périmée ----
  console.log("== 2. Références périmées (liens release + APK versionnés) ==");
  const tagRe = (g) => new RegExp("evenbetter-xcloud-v([\\w.-]+)", g);
  const urlRe = (g) => new RegExp("releases/download/evenbetter-xcloud-v([\\w.-]+)/", g);
  const apkRe = (g) => new RegExp("evenbetter-xcloud-(\\d+\\.\\d+\\.\\d+(?:-preview\\d+)?)\\.apk", g);

  for (const f of FILES) {
    const c = files[f];
    if (c == null) {
      check(`${f} : fichier présent`, false, "README manquant");
      continue;
    }
    // tags en prose : docs front uniquement
    if (FRONT.has(f)) {
      let m;
      const re = tagRe("g");
      while ((m = re.exec(c))) {
        if (m[1] !== VERSION && m[1] !== PREVIEW)
          check(`${f} : tag périmé « ${m[1]} »`, false, "seuls v" + VERSION + " et v" + PREVIEW + " sont autorisés ici");
      }
    }
    // liens de téléchargement : doivent pointer une release courante (partout)
    {
      let m;
      const re = urlRe("g");
      while ((m = re.exec(c))) {
        if (m[1] !== VERSION && m[1] !== PREVIEW)
          check(`${f} : lien release périmé evenbetter-xcloud-v${m[1]}`, false,
            "la rétention purge cette release → 404 pour l'auto-update");
      }
    }
    // APK versionnés : doivent être courants (partout)
    {
      let m;
      const re = apkRe("g");
      while ((m = re.exec(c))) {
        if (m[1] !== VERSION && m[1] !== PREVIEW)
          check(`${f} : APK périmé evenbetter-xcloud-${m[1]}.apk`, false,
            "seuls " + VERSION + " et " + PREVIEW + " sont publiés");
      }
    }
  }

  ok.forEach((l) => console.log("  ✅ " + l));
  failures.forEach((l) => console.error("  ❌ " + l));
  return failures;
}

function selfTest() {
  console.log("== SELF-TEST : gate sur copie corrompue (doit être ROUGE) ==");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bx-readme-gate-"));
  const overrides = {};
  for (const f of ["README.md", "README.en.md", "mobile/README.md"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\r\n/g, "\n");
    let bad = src
      .replace(new RegExp("# EvenBetterXcloud — v" + VERSION.replace(/\./g, "\\.")), "# EvenBetterXcloud — v9.9.9")
      .split(`evenbetter-xcloud-v${VERSION}`).join("evenbetter-xcloud-v9.9.9")
      .split(`evenbetter-xcloud-${VERSION}.apk`).join("evenbetter-xcloud-9.9.9.apk")
      .split(`evenbetter-xcloud-${PREVIEW}.apk`).join("evenbetter-xcloud-9.9.8-preview1.apk");
    if (bad === src) {
      console.error("❌ SELF-TEST : impossible de corrompre " + f + " (ancre absente ?)");
      process.exit(1);
    }
    overrides[f] = bad;
  }
  const failures = runChecks(loadFiles(overrides));
  if (failures.length === 0) {
    console.error("❌ SELF-TEST : le gate n'a PAS détecté la copie corrompue — GATE INEFFICACE");
    process.exit(1);
  }
  console.log(`✅ SELF-TEST : ${failures.length} défaillance(s) détectée(s) sur la copie corrompue (attendu)`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

const isSelfTest = process.argv.includes("--self-test");
if (isSelfTest) selfTest();

const failures = runChecks(loadFiles(null));
if (failures.length > 0) {
  console.error(`\n❌ GATE ROUGE — README périmé (${failures.length} défaillance(s)). ` +
    `Après un bump, mettre à jour tous les READMEs citant une version ` +
    `(titre, table Deux versions, tags/liens release, APK mobile) dans le même lot.`);
  process.exit(1);
}
console.log("\n✅ GATE VERT — tous les READMEs citent les versions courantes (" + VERSION + " / " + PREVIEW + ")");
process.exit(0);
