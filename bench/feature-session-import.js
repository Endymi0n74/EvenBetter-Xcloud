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
const IMPL = `
window.BX_SESSION_IMPORT = {render: function ($parent) {
  var bridge = window.BXSessionImport;
  var box = CE("div", {});
  var note = CE("div", {style: "opacity:.75;font-size:12px;padding:2px 0 6px;"}, "Transfère la session Xbox d'un autre appareil du même réseau WiFi (utile quand le login est bloqué, ex. Freebox Pop).");
  var status = CE("div", {style: "padding:2px 0 6px;font-weight:600;white-space:pre-wrap;"});
  function btn(label, onClick) {
    var b = CE("button", {class: "bx-focusable", style: "display:block;width:100%;margin:4px 0;padding:8px 10px;border-radius:4px;background:#1f2937;color:#fff;cursor:pointer;text-align:left;"}, label);
    b.addEventListener("click", onClick);
    return b;
  }
  if (!bridge) {
    box.appendChild(CE("div", {style: "padding:6px 0;color:#f87171;"}, "⚠️ Disponible uniquement dans l'application EvenBetterXcloud Android."));
    box.appendChild(note);
    $parent.appendChild(box);
    return;
  }
  var urlInput = CE("input", {type: "text", placeholder: "URL affichée par le téléviseur (http://192.168.1.24:8765/import/123456)", value: localStorage.getItem("BX_SESSION_IMPORT_URL") || "", style: "width:100%;box-sizing:border-box;padding:8px;margin:4px 0;border-radius:4px;border:1px solid #374151;background:#111827;color:#fff;"});
  box.appendChild(btn("📥 Importer la session (cet appareil reçoit)", function () {
    try {
      var r = JSON.parse(bridge.startServer());
      if (!r.ok) { status.innerText = "❌ " + (r.error || "serveur indisponible"); return; }
      status.innerText = "Code : " + r.code + "\\nURL : " + r.url + "\\n\\nSur le téléphone : Session → « Envoyer la session » → collez cette URL.";
    } catch (e) { status.innerText = "❌ " + e.message; }
  }));
  box.appendChild(urlInput);
  box.appendChild(btn("📤 Envoyer la session (cet appareil envoie)", function () {
    try {
      var url = (urlInput && urlInput.value || "").trim();
      if (!url) { status.innerText = "❌ Collez d'abord l'URL affichée par l'autre appareil."; return; }
      localStorage.setItem("BX_SESSION_IMPORT_URL", url);
      var storage = {};
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); storage[k] = localStorage.getItem(k); }
      var payload = JSON.stringify({ origin: location.origin, storage: storage });
      status.innerText = "Envoi de la session (" + Object.keys(storage).length + " clés)…";
      var r = JSON.parse(bridge.send(url, payload));
      if (r.ok) status.innerText = "✅ Session envoyée — l'autre appareil recharge avec la session importée.";
      else status.innerText = "❌ " + (r.error || ("HTTP " + r.status));
    } catch (e) { status.innerText = "❌ " + e.message; }
  }));
  box.appendChild(note);
  box.appendChild(status);
  $parent.appendChild(box);
}};`;

let s = fs.readFileSync(file, "utf8");
const original = s;
const results = [];

// Idempotence : déjà injecté → no-op exit 0.
if (s.includes("window.BX_SESSION_IMPORT")) {
  console.log("== feature-session-import " + file + " : déjà injectée — no-op");
  process.exit(0);
}

const ANCHOR_BX = "window.BX_EXPOSED = BxExposed;";
const ANCHOR_OTHER = '{group: "other",label: t("other"),items: ["block.tracking"]}';
const ANCHOR_FILTER = 'section.group !== "sound" && section.group !== "data") continue;';

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
