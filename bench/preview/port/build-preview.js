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
 *   T1  Header : +@match https://play.xbox.com/* , version 1.8.0-preview1
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
const META_OUT = path.join(ROOT, "better-xcloud-preview.meta.js");

// EOL des ancres : la source peut être CRLF (working tree Windows, autocrlf)
// ou LF (checkout CI) — on normalise l'entrée en LF, la sortie en CRLF.
const EOL = "\n";

// ---- contrat « deux versions » : identité DISTINCTE du build preview ----
const PREVIEW_VERSION = "1.8.0-preview2";
const PREVIEW_NAME = "Better xCloud (Preview)";
const PREVIEW_TAG = "better-xcloud-perf-" + PREVIEW_VERSION; // releases/download/<tag>/...

function must(src, needle, label) {
  const i = src.indexOf(needle);
  if (i < 0) throw new Error(`[build-preview] ancre introuvable: ${label} :: ${JSON.stringify(needle.slice(0, 80))}`);
  return i;
}

function build() {
  let s = fs.readFileSync(SRC, "utf8").replace(/\r\n/g, "\n"); // entrée normalisée en LF

  /* ---------- T1 : header — identité DISTINCTE (contrat deux versions) ----------
     Le preview ne doit JAMAIS partager l'identité du stable : même @name =
     conflit Tampermonkey, même @updateURL = auto-update vers le stable
     (clobbering), @match www.xbox.com = double injection sur le stable.
     → name/version/updateURL/downloadURL distincts, match = play.xbox.com seul. */
  const nameAnchor = "// @name         Better xCloud" + EOL;
  must(s, nameAnchor, "T1 @name");
  s = s.replace(nameAnchor, "// @name         " + PREVIEW_NAME + EOL);

  const versionAnchor = "// @version      1.8.0" + EOL;
  must(s, versionAnchor, "T1 @version");
  s = s.replace(versionAnchor, "// @version      " + PREVIEW_VERSION + EOL);

  // le preview ne matche QUE play.xbox.com (suppression des matches www.xbox.com)
  const matchStable = "// @match        https://www.xbox.com/*/play*" + EOL +
    "// @match        https://www.xbox.com/*/auth/msa?*loggedIn*" + EOL +
    "// @exclude      https://www.xbox.com/*/xbox-game-pass/play-day-one" + EOL;
  must(s, matchStable, "T1 @match stable");
  s = s.replace(matchStable, "// @match        https://play.xbox.com/*" + EOL);

  // auto-update DÉDIÉ (tag preview — jamais le latest du stable)
  const updateAnchor = "// @updateURL    https://github.com/Endymi0n74/better-xcloud-perf/releases/latest/download/better-xcloud.meta.js" + EOL +
    "// @downloadURL  https://github.com/Endymi0n74/better-xcloud-perf/releases/latest/download/better-xcloud.user.js" + EOL;
  must(s, updateAnchor, "T1 @updateURL");
  s = s.replace(updateAnchor,
    "// @updateURL    https://github.com/Endymi0n74/better-xcloud-perf/releases/download/" + PREVIEW_TAG + "/better-xcloud-preview.meta.js" + EOL +
    "// @downloadURL  https://github.com/Endymi0n74/better-xcloud-perf/releases/download/" + PREVIEW_TAG + "/better-xcloud-preview.user.js" + EOL);

  // l'en-tête OPTIMISATIONS signale la variante preview
  const headerAnchor = "/* OPTIMISATIONS v1.8.0:";
  must(s, headerAnchor, "T1 header OPTIMISATIONS");
  s = s.replace(headerAnchor,
    "/* OPTIMISATIONS " + PREVIEW_VERSION + " — VARIANTE PREVIEW (play.xbox.com uniquement) :\n" +
    "   Identite distincte du stable (name/version/updateURL) — les deux versions\n" +
    "   cohabitent sans se confondre. Overlay T1-T4 (detection BX_PREVIEW, garde\n" +
    "   du Patcher site, entree settings) + T5 (keep-alive idle P1).\n" +
    "   STABLE:");

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
  BxLogger.info("BX_PREVIEW", "overlay actif (T4 arme) — play.xbox.com");
  var PreviewSettingsEntry = {
    /* 17 août : le shell preview est du Tailwind — pas de <header> sémantique ni
       de classe Header-* (anchors.md §4). Le vrai top bar est nav.col-container
       (h 73, rangée interne flex-row h 48). On garde les anciens candidats pour
       compat et on ajoute l'ancre réelle observée en session. */
    SELECTORS: ["nav.col-container", "header[class*='Header']", "[class*='AppHeader']", "[class*='shell'] header", "header"],
    TARGET_SELECTORS: ["[class*='flex-row']", "[class*='right']", "[class*='actions']", "[class*='nav']", "[class*='menu']", "[class*='buttons']"],
    /* 17 août : re-rendu SPA du nav (hydratation/React) — on NE disconnecte PAS
       l'observer et on ré-appende le wrapper s'il est détaché (isConnected),
       coalescé à 150 ms pour ne pas travailler à chaque mutation. */
    _wrapper: null,
    _t: 0,
    _injected: false,
    tryInject() {
      var $header = null, i = 0;
      for (; i < this.SELECTORS.length; i++) { $header = document.querySelector(this.SELECTORS[i]); if ($header) break; }
      if (!$header) return false;
      var $target = null, j = 0;
      for (; j < this.TARGET_SELECTORS.length; j++) { $target = $header.querySelector(this.TARGET_SELECTORS[j]); if ($target) break; }
      $target = $target || $header;
      var section = HeaderSection.getInstance();
      section.$btnSettings.classList.remove("bx-gone");
      var wrapper = this._wrapper || (this._wrapper = section.$buttonsWrapper);
      /* 17 août : le top bar preview est dans un container pointer-events-none
         (z-shell-top) — chaque élément interactif du site se ré-arme en
         pointer-events:auto. Le wrapper du bouton doit faire pareil, sinon les
         clics traversent vers le <main> (observé : elementFromPoint = contenu). */
      wrapper.style.pointerEvents = "auto";
      if (!wrapper.isConnected) {
        $target.appendChild(wrapper);
        BxLogger.info("PreviewSettingsEntry", "bouton settings (re)injecte", $header.className || $header.tagName);
      }
      this._injected = true;
      return true;
    },
    start() {
      var self = this;
      var observer = new MutationObserver(function () {
        if (self._t) return;
        self._t = setTimeout(function () { self._t = 0; self.tryInject(); }, 150);
      });
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      if (document.readyState !== "loading") this.tryInject();
      BxLogger.info("PreviewSettingsEntry", "observer arme (resilient SPA)", document.readyState);
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { PreviewSettingsEntry.start(); }, { once: true });
  else PreviewSettingsEntry.start();

  /* ---------- T7 : résilience dialog (document.open du shell preview) ----------
     Le shell preview REPLACE le document au démarrage (observé 17 août : les
     nœuds du NavigationDialogManager finissent sous un ancien <html> détaché —
     le manager survit, show() marche, mais rien ne s'affiche). On ré-appende
     overlay + container au documentElement courant s'ils sont détachés.
     Interval 2 s : coût nul (check isConnected), couvre tout remplacement
     futur du document (document.open, hydratation, re-render html). */
  setInterval(function () {
    try {
      /* 1. nœuds du dialog : ré-append overlay + container si détachés (le
            document remplacé les a orphelins sous l'ancien <html>). */
      var _mgr = NavigationDialogManager.getInstance();
      if (_mgr.$overlay && !_mgr.$overlay.isConnected && document.documentElement && document.documentElement.isConnected) {
        document.documentElement.appendChild(_mgr.$overlay);
        document.documentElement.appendChild(_mgr.$container);
        BxLogger.info("NavigationDialogManager", "overlay/container re-attaches (document remplace par le shell)");
      }
      /* 2. feuille de style du script : le document remplacé l'a aussi effacée
            (zéro règle bx-* → dialog statique hors-écran). addCss() est
            idempotent ici car l'ancien <style> n'existe plus ; on ne ré-injecte
            que si aucun style porteur du CSS n'est présent (évite les doublons
            si le retrait vient d'ailleurs que du remplacement document). */
      var _hasCss = false;
      var _styles = document.querySelectorAll("style");
      for (var _si = 0; _si < _styles.length; _si++) {
        if ((_styles[_si].textContent || "").indexOf(".bx-navigation-dialog-overlay{") !== -1) { _hasCss = true; break; }
      }
      if (!_hasCss) {
        try { addCss(); BxLogger.info("BX_PREVIEW", "CSS re-injecte (document remplace par le shell)"); } catch (e2) { /* non bloquant */ }
      }
    } catch (e) { /* non bloquant */ }
  }, 2000);
}
/* ============ FIN PREVIEW ============ */
${entryAnchor}`;
  s = s.replace(entryAnchor, adapter);

  /* ---------- T6 : garde « Not xCloud page » neutralisé sur preview ----------
     Le stable throw si le pathname n'est pas /<locale>/play (page xCloud de
     www.xbox.com). Sur play.xbox.com le pathname est "/", "/stream/...",
     "/products/..." — le garde tuerait tout le script AVANT main(), donc sans
     hook fetch, sans overlay, sans T5. BX_PREVIEW (T2, défini avant) skip le
     garde : main() tourne, le hook window.fetch est posé en document-start
     (le userscript est @run-at document-start) — AVANT entry.client, donc le
     SDK preview capture NOTRE hook (classe ub, i=fetch par défaut) et P2/P3
     deviennent viables côté userscript (voir fetch-early.js). */
  const guardAnchor = "if (!window.location.pathname.match(/^\\/[a-zA-Z]{2}-[a-zA-Z]{2}\\/play/)) throw Error(\"[Better xCloud] Not xCloud page\");";
  must(s, guardAnchor, "T6 garde Not xCloud page");
  s = s.replace(guardAnchor, "if (!BX_PREVIEW && !window.location.pathname.match(/^\\/[a-zA-Z]{2}-[a-zA-Z]{2}\\/play/)) throw Error(\"[Better xCloud] Not xCloud page\");");

  /* ---------- T5 : keep-alive idle (P1) — inséré en FIN de script ----------
     Après main(); : window.fetch est alors le hook final (bloqueurs du script),
     le hook fetch de T5 se chaîne au bon maillon. */
  const t5Block =
    "/* ============ PREVIEW (play.xbox.com) : keep-alive idle (P1) ============\n" +
    "   Interception du WarningForBeingIdle (meme protocole que le stable) : au\n" +
    "   lieu du compte a rebours (dispatchEvent qe), envoi de this.sendKeepAlive()\n" +
    "   pour garder la session vivante malgre l'inactivite (voir session.md P1).\n" +
    "   Deux voies : (1) hook fetch du module StreamSessionRequest-*.js (ESM\n" +
    "   natif prouve 16 aout → inactif, fallback), (2) api\n" +
    "   window.PreviewKeepAliveIdle.wrapSession(session) — VOIE PRINCIPALE, a\n" +
    "   brancher quand la session est localisee au runtime (capture / hook React).\n" +
    "======================================================================== */\n" +
    "if (BX_PREVIEW) {\n" +
    keepAlive.installKeepAliveIdle.toString() +
    "\ninstallKeepAliveIdle();\n}\n";
  s = s + t5Block;

  // normalisation CRLF (le build perf est CRLF pur)
  s = s.replace(/\r?\n/g, "\r\n");
  return s;
}

/* Invariants « deux versions » — le build échoue si la séparation casse.
   (appelés après écriture du fichier, sur le contenu réel) */
function checkTwoVersionInvariants(stableSrc, previewSrc) {
  // EOL-insensible (working tree Windows CRLF / checkout CI LF)
  stableSrc = stableSrc.replace(/\r\n/g, "\n");
  previewSrc = previewSrc.replace(/\r\n/g, "\n");
  const fail = (msg) => { console.error("[build-preview] CONTRAT DEUX VERSIONS VIOLÉ : " + msg); process.exit(1); };
  // 1. identité distincte
  if (previewSrc.includes("// @name         Better xCloud" + EOL)) fail("@name du preview = celui du stable (conflit Tampermonkey)");
  if (!previewSrc.includes("// @name         " + PREVIEW_NAME + EOL)) fail("@name preview manquant: " + PREVIEW_NAME);
  if (!previewSrc.includes("// @version      " + PREVIEW_VERSION + EOL)) fail("@version preview manquant");
  // 2. auto-update dédié — jamais le latest du stable
  if (previewSrc.includes("releases/latest/download/better-xcloud")) fail("@updateURL/@downloadURL pointent le latest du stable (clobbering)");
  if (!previewSrc.includes(PREVIEW_TAG + "/better-xcloud-preview.meta.js")) fail("@updateURL preview manquant (tag " + PREVIEW_TAG + ")");
  // 3. matches disjoints : preview = play.xbox.com seul, stable = www.xbox.com seul
  if (previewSrc.includes("https://www.xbox.com/*/play*")) fail("@match www.xbox.com présent dans le preview (double injection sur le stable)");
  if (previewSrc.includes("https://www.xbox.com/*/xbox-game-pass")) fail("@exclude www.xbox.com hérité dans le preview");
  if (!previewSrc.includes("// @match        https://play.xbox.com/*")) fail("@match play.xbox.com manquant");
  if (stableSrc.includes("https://play.xbox.com")) fail("@match play.xbox.com présent dans le stable");
  console.log("[build-preview] invariants deux versions OK (name/version/updateURL/matches disjoints)");
}

/* Extraire le bloc ==UserScript== (pour better-xcloud-preview.meta.js) */
function extractMeta(fullSrc) {
  const start = fullSrc.indexOf("// ==UserScript==");
  const end = fullSrc.indexOf("// ==/UserScript==");
  if (start < 0 || end < 0) throw new Error("[build-preview] bloc ==UserScript== introuvable");
  return fullSrc.slice(start, end + "// ==/UserScript==".length) + EOL;
}

let out;
try {
  out = build();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

// invariants deux versions (avant écriture — sur le contenu généré + le stable)
checkTwoVersionInvariants(fs.readFileSync(SRC, "utf8"), out);

fs.writeFileSync(OUT, out);
console.log(`[build-preview] ecrit ${path.relative(ROOT, OUT)} (${out.length} octets)`);
fs.writeFileSync(META_OUT, extractMeta(out).replace(/\r?\n/g, "\r\n"));
console.log(`[build-preview] ecrit ${path.relative(ROOT, META_OUT)}`);

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
  "// @version      " + PREVIEW_VERSION,
  "// @name         " + PREVIEW_NAME,
  "// @updateURL    https://github.com/Endymi0n74/better-xcloud-perf/releases/download/" + PREVIEW_TAG,
  'var BX_PREVIEW = window.location.hostname === "play.xbox.com"',
  "static init() {if (BX_PREVIEW) return;Patcher.patchNativeBind();}",
  "static checkChunks(item) {if (BX_PREVIEW) return;",
  "if (!BX_PREVIEW && !window.location.pathname.match(/^\\/[a-zA-Z]{2}-[a-zA-Z]{2}\\/play/)) throw Error(\"[Better xCloud] Not xCloud page\");",
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
