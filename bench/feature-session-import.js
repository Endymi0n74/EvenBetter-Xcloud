#!/usr/bin/env node
/*
 * feature-session-import.js — injecte la feature « 📥 Session » (v1.13.1) dans
 * un bundle userscript (stable ou preview) de façon DÉTERMINISTE, avec gates
 * (GATE ROUGE si un pattern a dérivé).
 *
 * La feature : un groupe « Session » dans les settings globaux (visible même
 * DÉCONNECTÉ — c'est le but : se connecter) avec deux boutons :
 *   - « 📥 Importer la session » (receveur) : appelle l'interface Android
 *     window.BXSessionImport.startServer() → démarre le mini serveur HTTP LAN
 *     de l'APK, affiche le code + l'URL à saisir sur le donneur.
 *   - « 📤 Envoyer la session » (donneur) : lit le localStorage (toutes les
 *     clés, dont msal.*) et POSTe via window.BXSessionImport.send() — le POST
 *     passe par Java (HttpURLConnection) car le fetch() de la page vers
 *     http://LAN est bloqué par le mixed content (MIXED_CONTENT_NEVER_ALLOW).
 * L'interface Android n'existe que dans l'APK → sur PC, le groupe affiche
 * « disponible uniquement dans l'application Android ».
 *
 * Contexte : la Freebox Pop (Android 10, 32 bits) ne peut pas faire le login
 * Xbox (anti-bot Microsoft → 404 PPServer). Le transfert du localStorage MSAL
 * depuis un appareil déjà connecté (téléphone) contourne le login. Avant :
 * ligne de commande (bench/mobile/session-transfer.js) ; maintenant : intégré
 * à l'APK, sans ligne de commande.
 *
 * Usage :
 *   node bench/feature-session-import.js <bundle.js> [--dry-run] [--self-test]
 */
"use strict";
const fs = require("fs");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const DRY_RUN = args.includes("--dry-run");
const SELF_TEST = args.includes("--self-test");

if (!file) {
  console.error("usage: node bench/feature-session-import.js <bundle.js> [--dry-run] [--self-test]");
  process.exit(1);
}

// ---- Implémentation injectée (portée du bundle : CE / localStorage / location) ----
const { IMPL, ANCHOR_BX, ANCHOR_OTHER, ANCHOR_FILTER } = require("../src/features/session-import");

let s = fs.readFileSync(file, "utf8");
const original = s;
const results = [];

// Idempotence : déjà injecté → no-op exit 0.
if (s.includes("window.BX_SESSION_IMPORT")) {
  console.log("== feature-session-import " + file + " : déjà injectée — no-op");
  process.exit(0);
}





function count(hay, needle) { return hay.split(needle).length - 1; }

// 1. Implémentation (après BX_EXPOSED)
const n1 = count(s, ANCHOR_BX);
if (n1 !== 1) {
  results.push({ ok: false, name: "ancre BX_EXPOSED", found: n1, expected: 1 });
} else {
  s = s.replace(ANCHOR_BX, ANCHOR_BX + IMPL);
  results.push({ ok: true, name: "implémentation BX_SESSION_IMPORT injectée", found: 1 });
}

// 2. Groupe « Session » inséré avant le groupe other (visible même déconnecté
//    via le filtre ANCHOR_FILTER — c'est le but : importer AVANT d'avoir une
//    session).
const n2 = count(s, ANCHOR_OTHER);
if (n2 !== 1) {
  results.push({ ok: false, name: "groupe other (ancre d'insertion)", found: n2, expected: 1 });
} else {
  const sessionGroup = '{group: "session",label: "📥 Session",items: [($parent) => {window.BX_SESSION_IMPORT.render($parent);}]},' + ANCHOR_OTHER;
  s = s.replace(ANCHOR_OTHER, sessionGroup);
  results.push({ ok: true, name: "groupe Session inséré", found: 1 });
}

// 3. Groupe « Session » visible sans connexion (renderFullSettings=false)
const n3 = count(s, ANCHOR_FILTER);
if (n3 !== 1) {
  results.push({ ok: false, name: "filtre rendu déconnecté (sound+data)", found: n3, expected: 1 });
} else {
  s = s.replace(ANCHOR_FILTER, 'section.group !== "sound" && section.group !== "data" && section.group !== "session") continue;');
  results.push({ ok: true, name: "groupe Session ajouté au rendu déconnecté", found: 1 });
}

// Rapport
const fails = results.filter((r) => !r.ok);
console.log("== feature-session-import " + file + " ==");
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
  let bad = original.replace(ANCHOR_OTHER, '{group: "other",label: t("other_CHANGED")');
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
