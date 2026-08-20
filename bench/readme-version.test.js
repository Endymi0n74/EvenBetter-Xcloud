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
 *   3. BUNDLES : les `@version` de better-xcloud.user.js/.meta.js et
 *      better-xcloud-preview.user.js/.meta.js doivent égaler VERSION /
 *      PREVIEW_VERSION, et le pin `@updateURL` du preview (tag dédié) doit
 *      pointer la version courante — un bump de fichier SANS rebuild laisse
 *      l'ancienne version ET l'ancien pin (→ 404 auto-update) : piège
 *      « bump sans rebuild » couvert.
 *   4. APK : mobile/build.sh doit dériver les noms d'APK de VERSION (stable)
 *      et PREVIEW_VERSION (preview — jamais de suffixe -previewN hardcodé) ;
 *      si des APK construits sont présents (mobile/out/, gitignoré), leurs
 *      noms doivent être courants.
 *   5. SELF-TEST (--self-test) : copies corrompues (READMEs + bundles +
 *      build.sh) → le gate doit sortir en exit 1 avec le message GATE ROUGE.
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
// S'ajoutent les bundles (en-têtes @version + pin) et mobile/build.sh (noms
// d'APK dérivés de VERSION/PREVIEW_VERSION).
const FILES = [
  "README.md",
  "README.en.md",
  "mobile/README.md",
  "bench/README.md",
  "bench/preview/README.md",
  "bench/preview/port/README.md",
  "better-xcloud.user.js",
  "better-xcloud.meta.js",
  "better-xcloud-preview.user.js",
  "better-xcloud-preview.meta.js",
  "mobile/build.sh",
];
const FRONT = new Set(["README.md", "README.en.md", "mobile/README.md"]);

// Bundles : version attendue + pin d'auto-update. Le stable suit le canal
// `releases/latest` (sans version dans l'URL). Le preview est pinné sur le
// CANAL FLOTTANT `evenbetter-xcloud-preview-channel` — JAMAIS sur un tag
// versionné : la rétention purge l'ancienne release (pin → 404 auto-update),
// et même vivante sa meta resterait figée à l'ancienne @version (TM ne
// proposerait jamais la suivante). Le canal est ré-uploadé à chaque
// publication preview et n'est jamais purgé.
const PREVIEW_CHANNEL = "evenbetter-xcloud-preview-channel";
const BUNDLES = [
  { file: "better-xcloud.user.js", ver: VERSION, pin: null, noTag: null },
  { file: "better-xcloud.meta.js", ver: VERSION, pin: null, noTag: null },
  { file: "better-xcloud-preview.user.js", ver: PREVIEW, pin: PREVIEW_CHANNEL, noTag: `evenbetter-xcloud-v${PREVIEW}` },
  { file: "better-xcloud-preview.meta.js", ver: PREVIEW, pin: PREVIEW_CHANNEL, noTag: `evenbetter-xcloud-v${PREVIEW}` },
];

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
      check(`${f} : fichier présent`, false, "fichier manquant");
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
    // APK versionnés : doivent être courants dans les docs FRONT (un nom
    // d'APK historique cité dans un journal bench/ est légitime — ce n'est
    // pas un lien vers une release purgée, contrairement aux URLs ci-dessus).
    if (FRONT.has(f)) {
      let m;
      const re = apkRe("g");
      while ((m = re.exec(c))) {
        if (m[1] !== VERSION && m[1] !== PREVIEW)
          check(`${f} : APK périmé evenbetter-xcloud-${m[1]}.apk`, false,
            "seuls " + VERSION + " et " + PREVIEW + " sont publiés");
      }
    }
  }

  // ---- 3. bundles : @version + pin preview ----
  console.log("== 3. Bundles : @version et pin auto-update ==");
  for (const b of BUNDLES) {
    const c = files[b.file];
    check(`${b.file} : fichier présent`, c != null, "bundle manquant (bump sans rebuild ?)");
    if (c == null) continue;
    const m = /@version\s+([\w.-]+)/.exec(c);
    check(`${b.file} : @version ${b.ver}`, m != null && m[1] === b.ver,
      "trouvé : " + (m ? m[1] : "absent") + " — bump de fichier sans rebuild ?");
    if (b.pin) {
      check(`${b.file} : @updateURL pinné sur le canal ${b.pin}`, c.includes(b.pin),
        "l'ancien pin → 404 auto-update (canal attendu, piège bump sans rebuild)");
    }
    if (b.noTag) {
      check(`${b.file} : @updateURL PAS pinné sur le tag versionné ${b.noTag}`, !c.includes(`releases/download/${b.noTag}/`),
        "pin sur tag versionné → purgé par la rétention → 404 auto-update (incident preview1→preview2, 19 août)");
    }
  }

  // ---- 4. APK : noms dérivés des fichiers de version ----
  console.log("== 4. APK : noms dérivés de VERSION / PREVIEW_VERSION ==");
  const buildSh = files["mobile/build.sh"];
  check("mobile/build.sh : fichier présent", buildSh != null, "build script manquant");
  if (buildSh != null) {
    check("build.sh : APK stable dérivé de ${VERSION}",
      buildSh.includes('APK_NAME="evenbetter-xcloud-${VERSION}.apk"'));
    check("build.sh : APK preview dérivé de ${PREVIEW_VERSION}",
      buildSh.includes('APK_NAME="evenbetter-xcloud-${PREVIEW_VERSION}.apk"'),
      "le suffixe -previewN doit venir de PREVIEW_VERSION, jamais hardcodé");
    check("build.sh : versionName stable dérivé de VERSION",
      buildSh.includes('VERSION_NAME="$VERSION"'));
    check("build.sh : versionName preview dérivé de PREVIEW_VERSION",
      buildSh.includes('VERSION_NAME="$PREVIEW_VERSION"'),
      "l'APK preview doit annoncer 1.13.1-preview1, pas la version stable");
  }
  // Out par VARIANT depuis le 20 août (build.sh : `rm -rf $OUT` en cours de
  // build — un dossier partagé faisait disparaître l'APK stable quand on
  // buildait le preview ensuite). On scanne les deux dossiers.
  const outDirs = ["out-stable", "out-preview"].map((d) => path.join(ROOT, "mobile", d));
  let foundApk = false;
  for (const outDir of outDirs) {
    if (!fs.existsSync(outDir)) continue;
    for (const f of fs.readdirSync(outDir)) {
      // APK de RELEASE uniquement (evenbetter-xcloud-<v>.apk) — les
      // artefacts intermédiaires (base.apk, app-unsigned.apk, app-aligned.apk)
      // sont ignorés.
      if (!/^evenbetter-xcloud-.*\.apk$/.test(f)) continue;
      foundApk = true;
      const exp = f.includes("preview")
        ? `evenbetter-xcloud-${PREVIEW}.apk`
        : `evenbetter-xcloud-${VERSION}.apk`;
      check(`${path.basename(outDir)}/${f} : nom courant`, f === exp, "attendu : " + exp);
    }
  }
  if (!foundApk) console.log("  (aucun APK construit présent — check build.sh seul, attendu en CI)");

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
  // bundles : @version périmé + pin preview cassé (piège « bump sans rebuild »)
  // + TAG VERSIONNÉ pinné au lieu du canal (le bug réel de l'incident 19 août)
  for (const b of BUNDLES) {
    const src = fs.readFileSync(path.join(ROOT, b.file), "utf8");
    let bad = src;
    // AVANT le remplacement générique : le bug réel du 19 août pour preview —
    // pin sur le TAG VERSIONNÉ au lieu du canal (purgé par la rétention →
    // 404 auto-update). Doit faire échouer les deux checks canal.
    if (b.file.startsWith("better-xcloud-preview") && b.noTag) {
      bad = bad.split("releases/download/" + b.pin + "/").join("releases/download/" + b.noTag + "/");
    }
    bad = bad
      .replace(new RegExp("@version\\s+" + b.ver.replace(/\./g, "\\.")), "@version 9.9.9")
      .split(b.pin || "evenbetter-xcloud-v" + b.ver).join("evenbetter-xcloud-v9.9.9");
    if (bad === src) {
      console.error("❌ SELF-TEST : impossible de corrompre le bundle " + b.file + " (ancre absente ?)");
      process.exit(1);
    }
    overrides[b.file] = bad;
  }
  // build.sh : noms d'APK hardcodés au lieu des variables de version
  {
    const src = fs.readFileSync(path.join(ROOT, "mobile", "build.sh"), "utf8");
    const bad = src
      .split('APK_NAME="evenbetter-xcloud-${VERSION}.apk"').join('APK_NAME="evenbetter-xcloud-9.9.9.apk"')
      .split('APK_NAME="evenbetter-xcloud-${PREVIEW_VERSION}.apk"').join('APK_NAME="evenbetter-xcloud-9.9.8-preview1.apk"')
      .split('VERSION_NAME="$VERSION"').join('VERSION_NAME="9.9.9"')
      .split('VERSION_NAME="$PREVIEW_VERSION"').join('VERSION_NAME="9.9.8-preview1"');
    if (bad === src) {
      console.error("❌ SELF-TEST : impossible de corrompre mobile/build.sh (ancre absente ?)");
      process.exit(1);
    }
    overrides["mobile/build.sh"] = bad;
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
  console.error(`\n❌ GATE ROUGE — version périmée quelque part (${failures.length} défaillance(s)). ` +
    `Après un bump : mettre à jour les READMEs citant une version (titre, ` +
    `table Deux versions, tags/liens release, APK mobile) ET REBUILDER les ` +
    `bundles (en-têtes @version + pin preview) dans le même lot — un bump de ` +
    `fichier sans rebuild laisse l'ancienne version ET l'ancien pin auto-update.`);
  process.exit(1);
}
console.log("\n✅ GATE VERT — READMEs, bundles et APK à jour (" + VERSION + " / " + PREVIEW + ")");
process.exit(0);
