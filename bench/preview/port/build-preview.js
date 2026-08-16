#!/usr/bin/env node
/*
 * build-preview.js — portage app-shell du build perf (better-xcloud.user.js,
 * v1.7.0) vers le preview (play.xbox.com, React Router 7 / rolldown).
 *
 * Ce script ne ré-écrit pas les patches : il applique un OVERLAY qui rend le
 * build v1.7.0 sûr et utilisable sur play.xbox.com. Les 13 patches app-shell
 * (01-12, 21) sont déjà dans le build (script-interne pour la plupart — voir
 * classify.md) ; l'overlay porte :
 *
 *   T1  Header : +@match https://play.xbox.com/* , version 1.7.0-preview1
 *   T2  Détection runtime : var BX_PREVIEW (hostname play.xbox.com)
 *   T3  Garde du Patcher site : Patcher.init()/checkChunks no-op sur preview
 *       (évite un match accidentel des patches site — chunkName/requireAsync —
 *       sur le code rolldown du preview, qui n'a pas ces ancres)
 *   T4  Entrée settings : PreviewSettingsEntry — injection du bouton settings
 *       (HeaderSection existant, dialog 100 % autonome) dans le shell du
 *       preview via MutationObserver délégué, avec sélecteurs candidats
 *       (anchors.md) à affiner depuis la capture runtime d'une session.
 *
 * Usage : node bench/preview/port/build-preview.js
 * Sortie : better-xcloud-preview.user.js (racine du repo, à côté du build perf)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const keepAlive = require("./keepalive-idle.js");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SRC = path.join(ROOT, "better-xcloud.user.js");
const OUT = path.join(ROOT, "better-xcloud-preview.user.js");

const EOL = "\r\n"; // le build perf est en CRLF

function must(src, needle, label) {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error(`[build-preview] ancre introuvable: ${label} :: ${JSON.stringify(needle.slice(0, 80))}`);
  return i;
}

function build() {
  let s = fs.readFileSync(SRC, "utf8");

  /* ---------- T1 : header ---------- */
  const matchAnchor = "// @match        https://www.xbox.com/*/auth/msa?*loggedIn*" + EOL;
  must(s, matchAnchor, "T1 @match");
  s = s.replace(matchAnchor, matchAnchor + "// @match        https://play.xbox.com/*" + EOL);

  const versionAnchor = "// @version      1.7.0" + EOL;
  must(s, versionAnchor, "T1 @version");
  s = s.replace(versionAnchor, "// @version      1.7.0-preview1" + EOL);

  /* ---------- T2 : détection runtime ---------- */
  const detAnchor = "var NATIVE_FETCH = window.fetch;";
  must(s, detAnchor, "T2 NATIVE_FETCH");
  s = s.replace(
    detAnchor,
    detAnchor +
      EOL +
      `var BX_PREVIEW = window.location.hostname === "play.xbox.com" || window.location.hostname.endsWith(".play.xbox.com");`
  );

  /* ---------- T3 : garde du Patcher site ---------- */
  const initAnchor = "static init() {Patcher.patchNativeBind();}";
  must(s, initAnchor, "T3 Patcher.init");
  s = s.replace(initAnchor, "static init() {if (BX_PREVIEW) return;Patcher.patchNativeBind();}");

  const chunksAnchor = "static checkChunks(item) {let patchesToCheck,";
  must(s, chunksAnchor, "T3 checkChunks");
  s = s.replace(chunksAnchor, "static checkChunks(item) {if (BX_PREVIEW) return;let patchesToCheck,");

  /* ---------- T4 : entrée settings preview ---------- */
  const entryAnchor = "class HeaderSection {";
  must(s, entryAnchor, "T4 HeaderSection");
  const adapter = `/* ============ PREVIEW (play.xbox.com) : entree settings ============
   Le dialog de settings du script est 100 % autonome (NavigationDialogManager
   cree son propre overlay/container, HeaderSection porte le bouton). Sur le
   stable, le bouton est injecte via le hook React du header du site
   (injectHeaderUseEffect -> event ui.header.rendered). Sur le preview (React
   Router 7, CSS modules hashes), cette ancre n'existe pas : on injecte via un
   MutationObserver delegue sur les selecteurs candidats (anchors.md, T4). */
if (BX_PREVIEW) {
  var PreviewSettingsEntry = {
    SELECTORS: ["header[class*='Header']", "[class*='AppHeader']", "[class*='shell'] header", "header"],
    TARGET_SELECTORS: ["[class*='right']", "[class*='actions']", "[class*='nav']", "[class*='menu']", "[class*='buttons']"],
    _injected: false,
    tryInject() {
      if (this._injected) return true;
      var $header = null, i = 0;
      for (; i < this.SELECTORS.length; i++) { $header = document.querySelector(this.SELECTORS[i]); if ($header) break; }
      if (!$header) return false;
      var $target = null, j = 0;
      for (; j < this.TARGET_SELECTORS.length; j++) { $target = $header.querySelector(this.TARGET_SELECTORS[j]); if ($target) break; }
      $target = $target || $header;
      var section = HeaderSection.getInstance();
      section.$btnSettings.classList.remove("bx-gone");
      $target.appendChild(section.$buttonsWrapper);
      this._injected = true;
      BxLogger.info("PreviewSettingsEntry", "bouton settings injecte", $header.className || $header.tagName);
      return true;
    },
    start() {
      var observer = new MutationObserver(() => { if (this.tryInject()) observer.disconnect(); });
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      if (document.readyState !== "loading") this.tryInject();
      BxLogger.info("PreviewSettingsEntry", "observer arme", document.readyState);
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { PreviewSettingsEntry.start(); }, { once: true });
  else PreviewSettingsEntry.start();
}
/* ============ FIN PREVIEW ============ */
${entryAnchor}`;
  s = s.replace(entryAnchor, adapter);

  /* ---------- T5 : keep-alive idle (P1) — inséré en FIN de script ----------
     Après main(); : window.fetch est alors le hook final (bloqueurs du script),
     le hook fetch de T5 se chaîne au bon maillon. */
  const t5Block =
    "/* ============ PREVIEW (play.xbox.com) : keep-alive idle (P1) ============\n" +
    "   Interception du WarningForBeingIdle (meme protocole que le stable) : au\n" +
    "   lieu du compte a rebours (dispatchEvent qe), envoi de this.sendKeepAlive()\n" +
    "   pour garder la session vivante malgre l'inactivite (voir session.md P1).\n" +
    "   Deux voies : (1) hook fetch du module StreamSessionRequest-*.js (si le\n" +
    "   runtime le charge via fetch — a confirmer en session), (2) api\n" +
    "   window.PreviewKeepAliveIdle.wrapSession(session) a brancher quand la\n" +
    "   session est localisee au runtime (capture / hook React).\n" +
    "======================================================================== */\n" +
    "if (BX_PREVIEW) {\n" +
    keepAlive.installKeepAliveIdle.toString() +
    "\ninstallKeepAliveIdle();\n}\n";
  s = s + t5Block;

  // normalisation CRLF (le build perf est CRLF pur)
  s = s.replace(/\r?\n/g, "\r\n");
  return s;
}

let out;
try {
  out = build();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

fs.writeFileSync(OUT, out);
console.log(`[build-preview] ecrit ${path.relative(ROOT, OUT)} (${out.length} octets)`);

// validation syntaxe
try {
  execFileSync(process.execPath, ["--check", OUT], { stdio: "pipe" });
  console.log("[build-preview] node --check OK");
} catch (e) {
  console.error("[build-preview] node --check ECHEC");
  console.error(String(e.stderr || e.message));
  process.exit(1);
}

// round-trip : les ancres de l'overlay sont bien presentes
for (const probe of [
  "// @match        https://play.xbox.com/*",
  "// @version      1.7.0-preview1",
  'var BX_PREVIEW = window.location.hostname === "play.xbox.com"',
  "static init() {if (BX_PREVIEW) return;Patcher.patchNativeBind();}",
  "static checkChunks(item) {if (BX_PREVIEW) return;",
  "var PreviewSettingsEntry = {",
  "if (BX_PREVIEW) {",
  "installKeepAliveIdle",
  "window.PreviewKeepAliveIdle",
]) {
  if (!out.includes(probe)) { console.error("[build-preview] probe manquante: " + probe); process.exit(1); }
}
console.log("[build-preview] probes overlay OK");

// self-test P1 : le transform s'applique au bundle capturé (si présent)
try {
  const BUNDLE_DIR = "D:/tmp/preview-player";
  const bundle = fs.existsSync(BUNDLE_DIR) ? fs.readdirSync(BUNDLE_DIR).find((f) => /^StreamSessionRequest-.*\.js$/.test(f)) : null;
  if (bundle) {
    const src = fs.readFileSync(path.join(BUNDLE_DIR, bundle), "utf8");
    const r = keepAlive.patchStreamSessionRequestSource(src);
    if (r.ok && r.patched) console.log(`[build-preview] P1 keep-alive : transform OK sur ${bundle}`);
    else if (r.ok && !r.patched) console.log(`[build-preview] P1 keep-alive : ${bundle} deja patché (${r.skipped})`);
    else { console.error(`[build-preview] P1 keep-alive : ECHEC (${r.error}) — le module preview a change, ancre a re-deriver`); process.exit(1); }
  } else {
    console.log("[build-preview] P1 keep-alive : bundle StreamSessionRequest absent (self-test ignoré)");
  }
} catch (e) {
  console.log("[build-preview] P1 keep-alive : self-test non exécuté : " + e.message);
}
