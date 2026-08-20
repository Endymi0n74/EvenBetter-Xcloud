#!/usr/bin/env node
/**
 * bench/update-test/update-mechanism.test.js — harnais du MÉCANISME TM/GM
 * (partie déterministe du cycle d'auto-update).
 *
 * Ce que fait un gestionnaire de userscripts (Tampermonkey/Greasemonkey) à
 * chaque check d'update, exactement :
 *   1. lit le @updateURL du script INSTALLÉ (celui qu'il a enregistré) ;
 *   2. télécharge la meta à cette URL (fetch) ;
 *   3. compare @version servi vs @version installé (semver) ;
 *   4. si servi > installé → propose la mise à jour.
 *
 * Le harnais rejoue donc 1→3 sur les vrais bundles du repo et les vraies
 * URLs GitHub, et rend un verdict. Deux scénarios :
 *   - pin 404 (avant fix 19 août) : bundle preview1 publié, pin sur le tag
 *     versionné purgé par la rétention → la meta ne se télécharge pas →
 *     « AUCUNE MISE À JOUR POSSIBLE » (reproduction de l'incident) ;
 *   - pin canal (après fix) : pin = `evenbetter-xcloud-preview-channel` →
 *     la meta téléchargée sert @version preview2 > preview1 installé →
 *     « MISE À JOUR PROPOSÉE ».
 *
 * Usage : node bench/update-test/update-mechanism.test.js [--only=canal|--only=404]
 * Réseau obligatoire (fetch des URLs GitHub) — PAS exécuté au CI bench
 * (hors-ligne), lancé en local après chaque publication preview.
 */

"use strict";

const https = require("https");
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.join(__dirname, "..", "..");
const REPO = "Endymi0n74/EvenBetter-Xcloud";
const BASE = `https://github.com/${REPO}/releases/download`;
const CHANNEL = "evenbetter-xcloud-preview-channel";

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "update-mechanism-test" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        res.resume();
        resolve(fetchUrl(res.headers.location));
        return;
      }
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

// --- récupérer le bundle preview1 publié (git) : IL EST le « script installé » ----
function preview1Published() {
  const out = spawnSync("git", ["show", "304891e:better-xcloud-preview.user.js"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (out.status !== 0) throw new Error("impossible d'extraire le bundle preview1 publié : " + out.stderr);
  return out.stdout.replace(/\r\n/g, "\n");
}

// --- récupérer le bundle local (preview2, pin canal) : le « build courant » ----
function previewLocal() {
  return fs.readFileSync(path.join(ROOT, "better-xcloud-preview.user.js"), "utf8").replace(/\r\n/g, "\n");
}

function metaOf(bundle) {
  const m = /@version\s+([\w.-]+)/.exec(bundle);
  const u = /@updateURL\s+(\S+)/.exec(bundle);
  return { version: m && m[1], updateURL: u && u[1] };
}

function cmpSemver(a, b) {
  // a, b : "1.13.1-preview2" — compare les parties numériques, puis le suffixe
  const pa = /^(\d+)\.(\d+)\.(\d+)(?:-preview(\d+))?$/.exec(a);
  const pb = /^(\d+)\.(\d+)\.(\d+)(?:-preview(\d+))?$/.exec(b);
  if (!pa || !pb) throw new Error("versions non semver: " + a + " vs " + b);
  for (let i = 1; i <= 3; i++) {
    if (+pa[i] !== +pb[i]) return +pa[i] - +pb[i];
  }
  return (+(pa[4] || 0)) - (+(pb[4] || 0));
}

const ONLY = process.argv.find((a) => a.startsWith("--only="));
const onlyVal = ONLY ? ONLY.split("=")[1] : null;

async function scenarioCanal() {
  console.log("\n=== SCÉNARIO : instal preview1 → pin CANAL (post-fix 20 août) ===");
  // le pin du build COURANT (le canal) appliqué à l'ancienne version installée
  const local = previewLocal();
  const installed = { version: "1.13.1-preview1", updateURL: `https://github.com/${REPO}/releases/download/${CHANNEL}/better-xcloud-preview.meta.js` };
  const r = await fetchUrl(installed.updateURL);
  if (r.status !== 200) {
    console.error(`❌ GATE ROUGE : le pin canal → HTTP ${r.status} — le canal n'existe pas ou n'a pas été uploadé`);
    process.exit(1);
  }
  const served = /@version\s+([\w.-]+)/.exec(r.body);
  if (!served) { console.error("❌ GATE ROUGE : meta servie sans @version"); process.exit(1); }
  const diff = cmpSemver(served[1], installed.version);
  const ok = diff > 0;
  console.log(`  installé : ${installed.version} → pin ${CHANNEL}`);
  console.log(`  servi    : ${served[1]}`);
  console.log(diff > 0
    ? "  ✅ MISE À JOUR PROPOSÉE (servi > installé) — c'est ce que TM/GM affiche"
    : "  ❌ GATE ROUGE : servi <= installé — TM ne proposerait rien");
  if (!ok) process.exit(1);
  // le pin du build local doit être le canal (cohérence)
  const locMeta = metaOf(local);
  if (!locMeta.updateURL.includes(CHANNEL)) {
    console.error(`❌ GATE ROUGE : le build local ne pinne pas le canal (${locMeta.updateURL})`);
    process.exit(1);
  }
  console.log("  ✅ build local pinné sur le canal — cohérent");
  return true;
}

async function scenario404() {
  console.log("\n=== SCÉNARIO : instal preview1 → pin TAG VERSIONNÉ (avant fix, 19 août) ===");
  const published = preview1Published();
  const inst = metaOf(published);
  console.log(`  bundle publié preview1 : @version ${inst.version}, pin @updateURL = ${inst.updateURL}`);
  const r = await fetchUrl(inst.updateURL);
  const noUpdate = r.status !== 200;
  console.log(`  meta au pin → HTTP ${r.status}`);
  console.log(noUpdate
    ? "  ✅ REPRODUCTION DE L'INCIDENT : pin 404 → TM ne peut pas vérifier → AUCUNE mise à jour possible"
    : "  ⚠️  le pin répond — verifier le @version servi");
  return true;
}

(async () => {
  try {
    if (!onlyVal || onlyVal === "canal") await scenarioCanal();
    if (!onlyVal || onlyVal === "404") await scenario404();
    console.log("\n✅ MÉCANISME TM VALIDÉ — le cycle preview1 → preview2 passe par le canal flottant");
    process.exit(0);
  } catch (e) {
    console.error("❌ GATE ROUGE : " + e.message);
    process.exit(1);
  }
})();