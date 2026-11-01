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
 *   T10 Auto-spoof UA : quand le navigateur réel n'est pas Chromium (Firefox,
 *       Safari Windows…), forcer le profil « windows-edge » par défaut pour
 *       passer le gate navigateur de play.xbox.com (Chromium-only).
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

// EOL des ancres : la source peut être CRLF (vieux working tree Windows) ou
// LF (checkout CI) — on normalise l'entrée comme la sortie en LF (contrat
// `.gitattributes eol=lf` : la sortie CRLF historique imposait un staging LF
// manuel à chaque release, cf. session 24 sept).
const EOL = "\n";

// ---- contrat « deux versions » : identité DISTINCTE du build preview ----
// (rebrand 18 août : EvenBetterXcloud + tag evenbetter-xcloud-v* — les
// ancres T1 ci-dessous matchent le stable REBRANDÉ par bench/rebrand-bundle.js)
//
// Version preview : lue depuis PREVIEW_VERSION (racine) — source de vérité
// UNIQUE écrite par bench/bump-version.sh. Ne JAMAIS hardcoder la version
// ici (piège f39aeb2, revécu le 19 août : le rebuild après bump avait
// re-réinitialisé le preview en 1.12.0-preview1). GATE ROUGE si le fichier
// est absent ou vide : un clone frais / un bump incomplet se voit refuser le
// build au lieu de publier un preview mal versionné.
const PREVIEW_VERSION_FILE = path.join(ROOT, "PREVIEW_VERSION");
let PREVIEW_VERSION;
try {
  PREVIEW_VERSION = fs.readFileSync(PREVIEW_VERSION_FILE, "utf8").replace(/\r\n/g, "").trim();
} catch (e) {
  console.error("[build-preview] GATE ROUGE : " + PREVIEW_VERSION_FILE + " introuvable — lancer bash bench/bump-version.sh <version> d'abord");
  process.exit(1);
}
if (!PREVIEW_VERSION) {
  console.error("[build-preview] GATE ROUGE : " + PREVIEW_VERSION_FILE + " vide — lancer bash bench/bump-version.sh <version> d'abord");
  process.exit(1);
}
const PREVIEW_NAME = "EvenBetterXcloud (Preview)";
const PREVIEW_TAG = "evenbetter-xcloud-v" + PREVIEW_VERSION; // release versionnée (install manuel)
// CANAL D'AUTO-UPDATE flottant : le pin @updateURL/@downloadURL pointe une
// release dédiée, ré-uploadée à CHAQUE publication preview (jamais purgée
// par la rétention — whitelist release-prune.sh). Pourquoi pas un tag
// versionné ? (1) la rétention purge l'ancienne release → le pin 404 et
// l'utilisateur installé ne reçoit plus JAMAIS de mise à jour (incident
// preview1→preview2, 19 août) ; (2) même vivante, la meta servie reste figée
// à l'ancienne @version → TM ne voit aucune version plus récente. GitHub ne
// sert pas les prereleases par `releases/latest` (ce serait le stable), donc
// un tag fixe dédié sert de canal : `releases/download/evenbetter-xcloud-preview-channel/...`.
const PREVIEW_CHANNEL = "evenbetter-xcloud-preview-channel";

/* T15 (1er nov) : bloc de diagnostic du gel Firefox — inséré après T2 dans le
   build preview SEULEMENT (masques bx-off + watchdog bx-debug). Aucun effet
   par défaut : localStorage vide = aucun log, aucun compteur, aucun
   changement de comportement. */
const BX_DIAG_BLOCK = `/* ============ T15 preview : diag gel Firefox (opt-in localStorage) ============
   Gel total sans exception => main thread bloque : la console ne peut rien
   dire d'utile, et devtools ne repond plus. Outils inertes par defaut :
   - bx-on    : reactiver une brique preview neutralisee PAR DEFAUT.
                Etat courant (1er nov, gel clic Play) : LES SIX briques OFF
                (t4, t5, t7, t10, t14, t16) -> comportement de la version
                stable. bx-on = "t4" (ou "t7", "t5", "t14") pour les rallumer.
   - bx-off   : masquer une brique active (aucune par defaut).
   - bx-debug : ON PAR DEFAUT dans ce build de diagnostic ("0" pour
                couper). Ecrit le dernier marqueur dans localStorage
                ["bx-watch.last"] de facon SYNCHRONE (survit au gel) et
                l'affiche en bandeau au chargement suivant.
   - bx-debug : compteurs + dernier marqueur + duree max, flush 200 ms dans
                localStorage["bx-watch"] ; le run suivant annonce le run
                precedent (flush arrete net = onglet gele).
   Nettoyage : localStorage.removeItem("bx-off"); removeItem("bx-debug"). */
var BX_OFF = (function () { var o = " "; try { o += (window.localStorage.getItem("bx-off") || "") + " "; } catch (e) {} return o; })();
function bxOff(id) { return BX_OFF.indexOf(" " + id + " ") !== -1; }
var BX_ON = (function () { var o = " "; try { o += (window.localStorage.getItem("bx-on") || "") + " "; } catch (e) {} return o; })();
function bxOn(id) { return BX_ON.indexOf(" " + id + " ") !== -1; }
var BX_DBG = false; /* 1er nov : correctif CSS livre -> diagnostic OFF ("1" ou bx-debug dans le code pour le rallumer) */
try { if (window.localStorage.getItem("bx-debug") === "0") BX_DBG = false; } catch (e) {}
/* 1er nov (suite 5) : URL lisible dans le bandeau — l'ancienne troncature par la
   fin ne donnait que "t-type=application%2Fx-json-stream&w=2..." sans l'hote. */
window.__BX_SHORT = function (u) {
  u = String(u);
  try {
    var o = new URL(u, location.href), h = o.hostname.split(".");
    var k = h.length > 2 ? h.slice(-3).join(".") : o.hostname;
    return k + o.pathname.slice(-30) + (o.search ? "?" + o.search.slice(1, 26) : "");
  } catch (e) { return u.slice(-52); }
};
/* 1er nov (suite 10) : addCss() est LA cause du gel. Un <style> insere dans le
   document avant l'hydratation React desynchronise serveur et client
   (React #418) : l'app garde son HTML mais perd ses gestionnaires, donc le clic
   ne fait plus rien — aucune requete, aucune exception, thread libre.
   Correctif : on capture le CSS produit par addCss(), on RETIRE les noeuds
   <style> crees, puis on adopte la feuille sans noeud DOM
   (document.adoptedStyleSheets). Repli (navigateur sans constructible
   stylesheets) : insertion seulement apres load + 3 s, hydratation terminee. */
window.__bxAddCssSafe = function () {
  function listStyles() {
    var out = [], list = [];
    try { list = document.getElementsByTagName("style"); } catch (e) {}
    for (var i = 0; i < list.length; i++) out.push(list[i]);
    return out;
  }
  var before = listStyles();
  try { if (typeof addCss === "function") addCss(); } catch (e) {}
  var after = listStyles(), css = "", i;
  for (i = 0; i < after.length; i++) {
    if (before.indexOf(after[i]) === -1) {
      try { css += after[i].textContent || ""; } catch (e) {}
      try { after[i].parentNode.removeChild(after[i]); } catch (e) {}
    }
  }
  try {
    if (css && window.CSSStyleSheet && "replaceSync" in CSSStyleSheet.prototype && "adoptedStyleSheets" in document) {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      document.adoptedStyleSheets = document.adoptedStyleSheets.concat([sheet]);
      return;
    }
  } catch (e) {}
  var inject = function () {
    try {
      var st = document.createElement("style");
      st.textContent = css;
      (document.head || document.documentElement).appendChild(st);
    } catch (e) {}
  };
  if (document.readyState === "complete") window.setTimeout(inject, 3000);
  else window.addEventListener("load", function () { window.setTimeout(inject, 3000); });
};
window.__BX_MARK = !BX_DBG ? function () {} : (function () {
  var w = { n: {}, max: {}, last: "boot", t0: Date.now() };
  var _syncId = "", _syncT = 0;
  window.__BX_WATCH = w;
  try {
    var prev = window.localStorage.getItem("bx-watch");
    window.localStorage.removeItem("bx-watch");
    window.__BX_PREVLAST = window.localStorage.getItem("bx-watch.last");
    window.localStorage.removeItem("bx-watch.last");
    if (prev) {
      var p = JSON.parse(prev);
      if (p && p.t && Date.now() - p.t < 900000) {
        console.warn("[BX watch] run precedent interrompu a " + Math.round((p.t - (p.t0 || p.t)) / 1000) + " s - dernier marqueur " + p.last + " - masques:[" + (p.off || "") + "]", p.n, p.max);
      }
    }
  } catch (e) {}
  try { if (window.__BX_PREVLAST) console.warn("[BX watch] dernier marqueur SYNCHRONE (survit au gel) : " + window.__BX_PREVLAST); } catch (e) {}
  /* Bandeau visible SANS console (build de diagnostic) : affiche le dernier
     marqueur ecrit avant le gel du run precedent. */
  try {
    if (window.__BX_PREVLAST) window.setTimeout(function () {
      try {
        var d = document.createElement("div");
        d.style.cssText = "position:fixed;left:10px;top:10px;z-index:2147483647;background:#101010;color:#00e676;font:12px/1.45 monospace;padding:8px 12px;border:1px solid #00e676;border-radius:6px;max-width:62vw;white-space:pre-wrap;pointer-events:none";
        d.textContent = "BX diag (run precedent) : " + window.__BX_PREVLAST;
        (document.documentElement || document.body || {}).appendChild(d);
      } catch (e) {}
    }, 1200);
  } catch (e) {}
  window.setInterval(function () {
    try { window.localStorage.setItem("bx-watch", JSON.stringify({ t: Date.now(), t0: w.t0, last: w.last, n: w.n, max: w.max, off: BX_OFF.replace(/ /g, "") })); } catch (e) {}
  }, 200);
  /* 1er nov : battement de coeur — si le dernier marqueur est "hb", le gel
     est survenu pendant le travail moteur (layout/paint) et non dans nos
     callbacks ; "dom:NNNN" donne la taille du DOM au dernier battement. */
  window.setInterval(function () {
    try {
      var _w = window.__BX_WATCH;
      if (_w) {
        _w.n.dom = document.getElementsByTagName("*").length;
        var _d = document.querySelector("[class*='bx-navigation-dialog']");
        _w.n.dlg = _d ? String(window.getComputedStyle(_d).display) : "absent";
      }
    } catch (e) {}
    try { window.__BX_MARK("hb"); } catch (e) {}
  }, 500);
  /* 1er nov (suite 4) : le clic Play n'emet aucune requete et le thread n'est pas
     bloque -> soit une promesse jamais resolue (pend:), soit une exception
     avalee par le site (err:). Ces ecoutes nomment la cause sans console. */
  try {
    window.addEventListener("unhandledrejection", function (ev) {
      try { (window.__BX_ERRS = window.__BX_ERRS || []).push("rej:" + String((ev && ev.reason && (ev.reason.message || ev.reason)) || "?").slice(0, 70)); } catch (e) {}
    });
    window.addEventListener("error", function (ev) {
      try { (window.__BX_ERRS = window.__BX_ERRS || []).push("err:" + String((ev && ev.message) || "?").slice(0, 70) + "@" + String((ev && ev.filename) || "").split("/").pop() + ":" + String((ev && ev.lineno) || "?")); } catch (e) {}
    });
  } catch (e) {}
  /* 1er nov (suite 7) : React avale ses exceptions — journalisation utile
     seulement pendant le diagnostic. */
  try {
    if (BX_DBG) {
      var _bxCE = console.error;
      console.error = function () {
        try {
          var _m = "";
          for (var _i = 0; _i < arguments.length; _i++) _m += String((arguments[_i] && arguments[_i].message) || arguments[_i]) + " ";
          (window.__BX_ERRS = window.__BX_ERRS || []).push("log:" + _m.slice(0, 90));
        } catch (e) {}
        return _bxCE.apply(console, arguments);
      };
    }
  } catch (e) {}
  /* 1er nov (suite 5) : le clic n'emet aucune requete interceptee et le thread
     reste libre. Trois sondes pour savoir si la requete de lancement existe
     malgre tout, HORS de notre fetch : journal des ressources (PerformanceObserver :
     XHR, beacon, iframe, worker du document), clics recus par le document, et
     etat des scripts injectes dans les iframes same-origin. */
  try {
    if (window.PerformanceObserver) {
      new window.PerformanceObserver(function (list) {
        try {
          var _r = list.getEntries(), _a = (window.__BX_RES = window.__BX_RES || []);
          for (var _ri = 0; _ri < _r.length; _ri++) {
            var _nm = String(_r[_ri].name || "");
            if (/session|play|configur|waittime|ice/i.test(_nm)) {
              _a.push((window.__BX_SHORT ? window.__BX_SHORT(_nm) : _nm.slice(-44)) + "#" + Math.round(_r[_ri].duration || 0) + "ms");
              if (_a.length > 8) _a.shift();
            }
          }
        } catch (e) {}
      }).observe({ entryTypes: ["resource"] });
    }
  } catch (e) {}
  try {
    document.addEventListener("click", function (ev) {
      try {
        var _t = ev && ev.target, _tag = _t && _t.tagName ? _t.tagName.toLowerCase() : "?";
        var _lab = (_t && _t.getAttribute && (_t.getAttribute("aria-label") || _t.getAttribute("title"))) || (_t && typeof _t.className === "string" && _t.className.slice(0, 24)) || (_t && _t.textContent) || "";
        _lab = String(_lab).trim().slice(0, 26);
        var _c = (window.__BX_CLK = window.__BX_CLK || []);
        _c.push(_tag + ":" + _lab);
        if (_c.length > 3) _c.shift();
      } catch (e) {}
      try { window.__BX_MARK("click"); } catch (e) {}
    }, true);
  } catch (e) {}
  try {
    window.__BX_FRS = [];
    window.setInterval(function () {
      var _o = [];
      try {
        var _f = window.frames;
        for (var _i = 0; _i < _f.length && _i < 3; _i++) {
          try { var _w2 = _f[_i]; if (_w2 && _w2.__BX_WATCH) _o.push("f" + _i + ":" + String(_w2.__BX_WATCH.last).slice(0, 40)); } catch (e) {}
        }
      } catch (e) {}
      try { window.__BX_FRS = _o; } catch (e) {}
    }, 2000);
  } catch (e) {}
  return function (id, ms) {
    w.n[id] = (w.n[id] || 0) + 1;
    /* 1er nov (suite) : ecriture SYNCHRONE — quand le main thread est bloque
       (exactement le cas recherche), aucun timer de flush ne tourne plus ; le
       setItem, lui, survit au kill de l'onglet. Throttle 100 ms sauf si le
       marqueur change (une rafale du meme marqueur reste a 10 ecritures/s). */
    try {
      var _nowS = Date.now();
      if (id !== _syncId || _nowS - _syncT >= 100) {
        _syncId = id; _syncT = _nowS;
        var _sum = "";
        try {
          var _k = Object.keys(w.n), _p = [];
          for (var _i = 0; _i < _k.length; _i++) _p.push(_k[_i] + ":" + w.n[_k[_i]]);
          _sum = " | " + _p.join(" ");
        } catch (e) {}
        var _pe = "";
        try {
          var _pk = Object.keys(window.__BX_PEND || {}), _pv = [];
          for (var _j = 0; _j < _pk.length; _j++) {
            var _pi = window.__BX_PEND[_pk[_j]];
            _pv.push((_pi && _pi.u ? _pi.u : String(_pi)) + "@" + Math.round((Date.now() - ((_pi && _pi.t) || Date.now())) / 1000) + "s");
          }
          if (_pv.length) _pe += " pend:[" + _pv.join(" | ") + "]";
        } catch (e) {}
        try { if (window.__BX_ERRS && window.__BX_ERRS.length) _pe += " err:[" + window.__BX_ERRS.slice(-3).join(" ; ") + "]"; } catch (e) {}
        try { if (window.__BX_XHR && window.__BX_XHR.length) _pe += " xhr:[" + window.__BX_XHR.slice(-3).join(" | ") + "]"; } catch (e) {}
        try { if (window.__BX_RES && window.__BX_RES.length) _pe += " res:[" + window.__BX_RES.slice(-4).join(" ") + "]"; } catch (e) {}
        try { if (window.__BX_FRS && window.__BX_FRS.length) _pe += " fr:[" + window.__BX_FRS.slice(-2).join(" ") + "]"; } catch (e) {}
        try { if (window.__BX_CLK && window.__BX_CLK.length) _pe += " cl:[" + window.__BX_CLK.slice(-2).join(" | ") + "]"; } catch (e) {}
        window.localStorage.setItem("bx-watch.last", id + " #" + w.n[id] + " @" + Math.round(performance.now()) + "ms" + (ms ? " duree:" + Math.round(ms) + "ms" : "") + _sum + _pe + " masques:[" + BX_OFF.replace(/ /g, "") + "]");
      }
    } catch (e) {}
    w.last = id + " #" + w.n[id] + " @" + Math.round(performance.now()) + "ms";
    if (ms > (w.max[id] || 0)) w.max[id] = Math.round(ms);
  };
})();`;

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
  // BX_VERSION (rebrand) : le badge du preview doit afficher la version
  // PREVIEW, pas celle du stable — on substitue la valeur injectée par
  // rebrand-bundle.js (qui est celle du stable). Extrait AVANT le replace
  // du @version (sinon on lirait déjà la version preview).
  const stableVersion = (s.match(/\/\/ @version      ([^\r\n]+)/) || [])[1];

  const nameAnchor = "// @name         EvenBetterXcloud" + EOL;
  must(s, nameAnchor, "T1 @name");
  s = s.replace(nameAnchor, "// @name         " + PREVIEW_NAME + EOL);

  const versionAnchor = "// @version      " + stableVersion + EOL;
  must(s, versionAnchor, "T1 @version");
  s = s.replace(versionAnchor, "// @version      " + PREVIEW_VERSION + EOL);

  const bxVerAnchor = 'BX_VERSION = "' + stableVersion + '"';
  must(s, bxVerAnchor, "T1 BX_VERSION");
  s = s.replace(bxVerAnchor, 'BX_VERSION = "' + PREVIEW_VERSION + '"');

  // le preview ne matche QUE play.xbox.com (suppression des matches www.xbox.com)
  const matchStable = "// @match        https://www.xbox.com/*/play*" + EOL +
    "// @match        https://www.xbox.com/*/auth/msa?*loggedIn*" + EOL +
    "// @exclude      https://www.xbox.com/*/xbox-game-pass/play-day-one" + EOL;
  must(s, matchStable, "T1 @match stable");
  s = s.replace(matchStable, "// @match        https://play.xbox.com/*" + EOL);

  // auto-update DÉDIÉ : CANAL FLOTTANT preview (jamais le latest du stable —
  // il servirait le stable, et la release versionnée serait purgée par la
  // rétention → pin 404). Le canal est pinné par le build et ré-uploadé à
  // chaque publication ; sa meta sert donc TOUJOURS la dernière @version.
  const updateAnchor = "// @updateURL    https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest/download/better-xcloud.meta.js" + EOL +
    "// @downloadURL  https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest/download/better-xcloud.user.js" + EOL;
  must(s, updateAnchor, "T1 @updateURL");
  s = s.replace(updateAnchor,
    "// @updateURL    https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/download/" + PREVIEW_CHANNEL + "/better-xcloud-preview.meta.js" + EOL +
    "// @downloadURL  https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/download/" + PREVIEW_CHANNEL + "/better-xcloud-preview.user.js" + EOL);

  // l'en-tête OPTIMISATIONS signale la variante preview
  const headerAnchor = "/* OPTIMISATIONS v" + stableVersion + ":";
  must(s, headerAnchor, "T1 header OPTIMISATIONS");
  s = s.replace(headerAnchor,
    "/* OPTIMISATIONS " + PREVIEW_VERSION + " — VARIANTE PREVIEW (play.xbox.com uniquement) :\n" +
    "   Identite distincte du stable (name/version/updateURL) — les deux versions\n" +
    "   cohabitent sans se confondre. Overlay T1-T13 (detection BX_PREVIEW, garde\n" +
    "   du Patcher site, entree settings) + T5 (keep-alive idle P1).\n" +
    "   STABLE:");

  /* ---------- T2 : détection runtime ---------- */
  const detAnchor = "var NATIVE_FETCH = window.fetch;";
  must(s, detAnchor, "T2 NATIVE_FETCH");
  s = s.replace(
    detAnchor,
    detAnchor +
      EOL +
      `var BX_PREVIEW = window.location.hostname === "play.xbox.com" || window.location.hostname.endsWith(".play.xbox.com");` +
      EOL +
      BX_DIAG_BLOCK
  );

  /* ---------- T3 : garde du Patcher site ---------- */
  const initAnchor = "static init() {Patcher.patchNativeBind();}";
  must(s, initAnchor, "T3 Patcher.init");
  s = s.replace(initAnchor, "static init() {if (BX_PREVIEW) return;Patcher.patchNativeBind();}");

  const chunksAnchor = "static checkChunks(item) {let patchesToCheck,";
  must(s, chunksAnchor, "T3 checkChunks");
  s = s.replace(chunksAnchor, "static checkChunks(item) {if (BX_PREVIEW) return;let patchesToCheck,");

  /* ---------- T20 : marqueurs du code de BASE (diag gel clic Play, 1er nov) ----------
     Les six briques preview etant coupees et le gel persistant, la cause est dans
     le code de base commun. Ces marqueurs nomment les points d'entree qui tournent
     au moment du clic Play (fetch patche, handlePlay, configuration, ICE) ; le
     bandeau affiche le dernier atteint et l'URL en cours ("url:"). */
  const baseMarks = [
    ["function main() {if (GhPagesUtils.fetchLatestCommit(),", "function main() {window.__BX_MARK(\"base.main\");if (GhPagesUtils.fetchLatestCommit(),"],
    ["if (addCss(), StreamStatsCollector.setupEvents(),", "if (window.__BX_MARK(\"base.css\"), addCss(), StreamStatsCollector.setupEvents(),"],
    ["interceptHttpRequests(), patchVideoApi(),", "window.__BX_MARK(\"base.hooks\"), interceptHttpRequests(), patchVideoApi(),"],
    ["Patcher.init(), disablePwa(),", "window.__BX_MARK(\"base.patcher\"), Patcher.init(), disablePwa(),"],
    ["window.BX_FETCH = window.fetch = async (request, init) => {", "window.BX_FETCH = window.fetch = async (request, init) => {try { window.__BX_MARK(\"base.fetch\"); } catch (e) {}"],
    ["static async handle(request, init) {let url = typeof request === \"string\" ? request : request.url;", "static async handle(request, init) {let url = typeof request === \"string\" ? request : request.url;try { if (window.__BX_WATCH) window.__BX_WATCH.n.url = String(url).slice(-46); window.__BX_MARK(\"base.handle\"); } catch (e) {}"],
    ["static async handlePlay(request, init) {", "static async handlePlay(request, init) {window.__BX_MARK(\"base.play\");"],
    ["static async handleConfiguration(request, init) {", "static async handleConfiguration(request, init) {window.__BX_MARK(\"base.config\");"],
    ["static async handleWaitTime(request, init) {", "static async handleWaitTime(request, init) {window.__BX_MARK(\"base.wait\");"],
    ["static async handleLogin(request, init) {", "static async handleLogin(request, init) {window.__BX_MARK(\"base.login\");"]
  ];
  for (const pair of baseMarks) {
    const n = s.split(pair[0]).length - 1;
    if (n !== 1) { console.warn("[build-preview] T20 ignore (" + n + "x) : " + pair[0].slice(0, 60)); continue; }
    s = s.replace(pair[0], pair[1]);
  }

  /* ---------- T25 : addCss() injectee sans noeud DOM (correctif du gel) ----------
     React #418 (hydratation ratee) = l'app garde son HTML mais perd ses
     gestionnaires : clic sans effet, sans requete, sans exception. addCss() est
     le seul appel restant qui touche au rendu, donc le premier a blanchir. */
  {
            const t25old = "addCss(), StreamStatsCollector.setupEvents()";
    const t25i = s.indexOf(t25old);
    if (t25i < 0) throw new Error("[build-preview] T25 : appel addCss de main() introuvable");
    s = s.slice(0, t25i) + "__bxAddCssSafe(), StreamStatsCollector.setupEvents()" + s.slice(t25i + t25old.length);
    console.log("[build-preview] T25 : addCss() remplacee par __bxAddCssSafe()");
  }
  /* le code de base est aussi execute par les gates dans un mock sans
     __BX_MARK : marqueur neutre quand la fonction n'existe pas. */
  s = s.split('window.__BX_MARK("base.').join('(window.__BX_MARK||function(){})("base.');

  /* ---------- T21 : requetes en vol + XHR (diag gel clic Play, 1er nov, suite 4) ----------
     Mesure du bandeau : base.fetch:33 / base.handle:13 mais base.play:0 et aucune
     URL /sessions/cloud/play -> le clic n'emet pas la requete de lancement, et le
     heartbeat continue de battre (thread libre). Donc : promesse jamais resolue
     (pend:) ou exception avalee (err:) ou requete hors fetch (xhr:).
     - pend:[urls] : entrees dans le fetch patche jamais resolues (le suspect).
     - xhr:[[urls]] : derniers XMLHttpRequest.open -> le play passe-t-il en XHR ? */
  const t21 = [
    ['window.BX_FETCH = window.fetch = async (request, init) => {try { (window.__BX_MARK||function(){})("base.fetch"); } catch (e) {}',
     'window.BX_FETCH = window.fetch = (request, init) => {var __bxP = (BX_DBG ? (window.__BX_PEND = window.__BX_PEND || {}) : {}), __bxI = (window.__BX_SEQ = (window.__BX_SEQ || 0) + 1);try { __bxP[__bxI] = { u: (window.__BX_SHORT || function (u) { return String(u).slice(-52); })(typeof request === "string" ? request : (request && request.url) || "?"), t: Date.now() }; } catch (e) {}var __bxR = __bxInner(request, init);if (!__bxR || !__bxR.then) return __bxR;return __bxR.then(function (v) { try { delete __bxP[__bxI]; } catch (e) {} return v; }, function (e) { try { delete __bxP[__bxI]; } catch (_) {} try { (window.__BX_ERRS = window.__BX_ERRS || []).push("ko:" + (window.__BX_SHORT || function (u) { return String(u).slice(-40); })(typeof request === "string" ? request : (request && request.url) || "?") + "!" + String((e && e.message) || e).slice(0, 30)); } catch (_) {} throw e; });};async function __bxInner(request, init) {try { window.__BX_MARK("base.fetch"); } catch (e) {}'],
    ['xhrPrototype.open = function(method, url) {return this._url = url, nativeXhrOpen.apply(this, arguments);}',
     'xhrPrototype.open = function(method, url) {try { var _x = BX_DBG ? (window.__BX_XHR = window.__BX_XHR || []) : []; _x.push(String(method) + " " + (window.__BX_SHORT || function (u) { return String(u).slice(-44); })(url) + " len:" + String(url).length); if (_x.length > 6) _x.shift(); } catch (e) {}return this._url = url, nativeXhrOpen.apply(this, arguments);}']
  ];
  for (const pair of t21) {
    must(s, pair[0], "T21 " + pair[0].slice(0, 46));
    s = s.replace(pair[0], pair[1]);
  }

  
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
       de classe Header-* (anchors.md §4). 31 oct : le client a basculé sur le
       shell « Bastion » (dock vertical à gauche + barre de titre WCO) — le top
       bar est [role="toolbar"][aria="Contrôles de l'application"] (h 48)
       dans nav.drag-region ; plus aucun nav.col-container ni <header>.
       Le cluster de droite (.justify-end) porte Manette/Profil : c'est là
       qu'on insère le bouton. Les anciens candidats restent en repli. */
    SELECTORS: ["[role='toolbar']", "nav.drag-region", "nav.col-container", "header[class*='Header']", "[class*='AppHeader']", "[class*='shell'] header", "header"],
    TARGET_SELECTORS: ["[class*='justify-end']", "[class*='flex-row']", "[class*='right']", "[class*='actions']", "[class*='nav']", "[class*='menu']", "[class*='buttons']"],
    /* 17 août : re-rendu SPA du nav (hydratation/React) — on NE disconnecte PAS
       l'observer et on ré-appende le wrapper s'il est détaché (isConnected),
       coalescé à 150 ms pour ne pas travailler à chaque mutation. */
    _wrapper: null,
    _observer: null,
    _root: null,
    _t: 0,
    _injected: false,
    tryInject() {
      window.__BX_MARK("t4.inject");
      var section = HeaderSection.getInstance();
      section.$btnSettings.classList.remove("bx-gone");
      var wrapper = this._wrapper || (this._wrapper = section.$buttonsWrapper);
      /* 19 août : shell MOBILE (play.xbox.com en WebView téléphone) — pas de
         nav.col-container ni de <header> (observé à 390 px, CDP emulation
         BlueStacks) → le top bar desktop n'existe pas et T4 ne trouvait
         aucune ancre : aucun bouton, aucun accès aux settings. Fallback :
         bouton flottant (FAB) fixe au-dessus de la mini-nav basse,
         indépendant de la structure du site. Circulaire compact (56 px),
         z-index au-dessus de z-shell-bottom. */
      if (window.innerWidth < 768) {
        wrapper.classList.add("bx-mobile-fab");
        if (!document.getElementById("bx-mobile-fab-css")) {
          var st = document.createElement("style");
          st.id = "bx-mobile-fab-css";
          st.textContent = ".bx-mobile-fab{position:fixed!important;right:16px!important;bottom:112px!important;z-index:9999!important;pointer-events:auto!important;margin:0!important;}.bx-mobile-fab [class*=\\\"bx-header-settings\\\"]{height:48px!important;min-height:48px!important;padding:0 18px!important;border-radius:999px!important;box-shadow:0 4px 12px rgba(0,0,0,.5)!important;}";
          document.documentElement.appendChild(st);
        }
        if (!wrapper.isConnected) {
          document.documentElement.appendChild(wrapper);
          BxLogger.info("PreviewSettingsEntry", "bouton settings mobile (FAB) injecte");
        }
        this._injected = true;
        return true;
      }
      var $header = null, i = 0;
      for (; i < this.SELECTORS.length; i++) { $header = document.querySelector(this.SELECTORS[i]); if ($header) break; }
      if (!$header) return false;
      var $target = null, j = 0;
      for (; j < this.TARGET_SELECTORS.length; j++) { $target = $header.querySelector(this.TARGET_SELECTORS[j]); if ($target) break; }
      $target = $target || $header;
      /* 17 août : le top bar preview est dans un container pointer-events-none
         (z-shell-top) — chaque élément interactif du site se ré-arme en
         pointer-events:auto. Le wrapper du bouton doit faire pareil, sinon les
         clics traversent vers le <main> (observé : elementFromPoint = contenu). */
      wrapper.style.pointerEvents = "auto";
      /* 31 oct : shell Bastion — la barre est une drag-region WCO : un enfant
         sans no-drag-region reste inerte (le drag de fenêtre avale le clic).
         On insère le bouton juste avant le conteneur du bouton Profil, comme
         les autres contrôles (Manette/Profil). */
      if ($header.getAttribute("role") === "toolbar" || $header.closest("[role='toolbar']")) {
        wrapper.classList.add("no-drag-region");
        var $profile = $target.querySelector("button[aria-label='Profil'], button[aria-label='Profile']");
        var $slot = $profile ? $profile.closest(".no-drag-region") : null;
        if ($slot && $slot.parentElement) {
          if (wrapper.parentElement !== $slot.parentElement || wrapper.nextElementSibling !== $slot) {
            $slot.parentElement.insertBefore(wrapper, $slot);
            BxLogger.info("PreviewSettingsEntry", "bouton settings (toolbar Bastion) injecte");
          }
          this._injected = true;
          return true;
        }
      }
      if (!wrapper.isConnected) {
        $target.appendChild(wrapper);
        BxLogger.info("PreviewSettingsEntry", "bouton settings (re)injecte", $header.className || $header.tagName);
      }
      this._injected = true;
      return true;
    },
    /* 19 août : le shell preview remplace le document (document.open / re-render
       html) → le body observé meurt avec l'ancien document et plus aucune
       mutation ne déclenche tryInject : le bouton ne revient jamais (reproduit
       en WebView). arm() est réutilisable : re-crée un observer sur le document
       COURANT (T7 point 3 le rappelle quand documentElement change d'identité). */
    arm() {
      if (this._observer) { try { this._observer.disconnect(); } catch (e) {} }
      var self = this;
      this._observer = new MutationObserver(function () {
        window.__BX_MARK("t4.obs");
        if (self._t) return;
        self._t = setTimeout(function () { self._t = 0; var _s4 = performance.now(); window.__BX_MARK("t4.tryS"); self.tryInject(); window.__BX_MARK("t4.try", performance.now() - _s4); }, 150);
      });
      var root = document.body || document.documentElement;
      if (root) this._observer.observe(root, { childList: true, subtree: true });
      this._root = document.documentElement;
    },
    start() {
      if (!bxOn("t4")) { BxLogger.info("PreviewSettingsEntry", "desactive (bx-off t4)"); return; }
      this.arm();
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
    if (!bxOn("t7")) return;
    var _t7s = performance.now();
    window.__BX_MARK("t7S");
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
      if (!_hasCss) { window.__BX_MARK("t7.css");
        try { addCss(); BxLogger.info("BX_PREVIEW", "CSS re-injecte (document remplace par le shell)"); } catch (e2) { /* non bloquant */ }
      }
      /* 3. T4 : le shell remplace le document → l'observer du bouton observe
            l'ancien body (mort) et le FAB/header est détaché. Re-armer sur le
            document courant et ré-injecter le bouton s'il a disparu (reproduit
            19 août en WebView : document.open → bouton mort, jamais revenu). */
      try {
        if (PreviewSettingsEntry._root && PreviewSettingsEntry._root !== document.documentElement) {
          window.__BX_MARK("t7.rearm");
          PreviewSettingsEntry._root = document.documentElement;
          PreviewSettingsEntry.arm();
          BxLogger.info("PreviewSettingsEntry", "document remplace — observer re-arme");
        }
        if (!PreviewSettingsEntry._injected || (PreviewSettingsEntry._wrapper && !PreviewSettingsEntry._wrapper.isConnected)) {
          PreviewSettingsEntry.tryInject();
        }
      } catch (e3) { /* non bloquant */ }
      /* 4. T11 : game bar — si le shell a remplacé le document, le #bx-game-bar
            (appendu au documentElement du constructeur) est orphelin sous
            l'ancien <html> : ré-append au document courant. Et si le jeu
            tourne mais que la bar est cachée (bx-offscreen/bx-hide — le
            disable du polling preview, voir patch T11), la re-montrer : sur
            la preview, la game bar est LA SEULE entrée settings en session. */
      try {
        var _gb = typeof GameBar !== "undefined" ? GameBar.getInstance() : null;
        if (_gb && _gb.$gameBar && _gb.$container) {
          if (!_gb.$gameBar.isConnected && document.documentElement && document.documentElement.isConnected) {
            window.__BX_MARK("t7.gb");
            document.documentElement.appendChild(_gb.$gameBar);
            BxLogger.info("GameBar", "re-appende (document remplace par le shell)");
          }
          if (STATES.isPlaying && (_gb.$container.classList.contains("bx-offscreen") || _gb.$container.classList.contains("bx-hide"))) {
            _gb.$container.classList.remove("bx-offscreen", "bx-hide");
            _gb.$container.classList.add("bx-show");
          }
        }
      } catch (e4) { /* non bloquant */ }
      /* 5. T12 : volume LIVE preview — le patch SDK du stable
            (patchAudioMediaStream → ".srcObject=this.audioMediaStream,") ne
            matche pas le SDK du client preview → aucun gain node n'est créé,
            les presets Son posent la pref mais n'ont pas d'effet audible en
            session (reproduit 20 août : audioGainNode=false avec booster on).
            Le client preview joue l'audio via un <audio> (srcObject =
            MediaStream, 1 piste audio, muted=false) + STATES.currentStream.
            audioContext est déjà le contexte PATCHÉ du script : on branche
            le gain node depuis l'élément audio (setupGainNode le mute et
            route l'audio par le gain — même mécanique que le stable,
            volume 0-600 % live). No-op dès qu'un gain node existe. */
      try {
        if (STATES.isPlaying && STATES.currentStream && !STATES.currentStream.audioGainNode &&
            typeof getGlobalPref === "function" && getGlobalPref("audio.volume.booster.enabled")) {
          var _aud = null, _als = document.querySelectorAll("audio");
          for (var _ai = 0; _ai < _als.length; _ai++) {
            var _t = _als[_ai].srcObject;
            if (_t && _t.getAudioTracks && _t.getAudioTracks().length > 0 && !_als[_ai].muted) { _aud = _als[_ai]; break; }
          }
          if (_aud && typeof window.BX_EXPOSED !== "undefined" && window.BX_EXPOSED.setupGainNode) {
            window.__BX_MARK("t7.gain");
            window.BX_EXPOSED.setupGainNode(_aud, _aud.srcObject);
            BxLogger.info("BX_PREVIEW", "T12 gain node branche (volume live preview)");
          }
        }
      } catch (e5) { /* non bloquant */ }
    } catch (e) { /* non bloquant */ }
    window.__BX_MARK("t7", performance.now() - _t7s);
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
  // Depuis le 20 août, le gate stable accepte aussi "/play" sans locale
  // (Freebox : www.xbox.com/play → bundle stable no-op sans l'overlay).
  const guardAnchor = "if (!window.location.pathname.match(/^\\/(?:[a-zA-Z]{2}-[a-zA-Z]{2}\\/)?play/)) throw Error(\"[Better xCloud] Not xCloud page\");";
  must(s, guardAnchor, "T6 garde Not xCloud page");
  s = s.replace(guardAnchor, "if (!BX_PREVIEW && !window.location.pathname.match(/^\\/(?:[a-zA-Z]{2}-[a-zA-Z]{2}\\/)?play/)) throw Error(\"[Better xCloud] Not xCloud page\");");

  /* ---------- T8 : P3 neutralisé (override osName=tizen retiré le 17 août) ----------
     A/B mesuré en réel (e2e-cdp.md « A/B bitrate ») : osName=tizen est un
     NO-OP en PC cloud gaming — résolution ET bitrate identiques au natif
     (1080p60, ~6 Mbps, distributions superposées). Le play passe donc SANS
     réécriture : ni osName, ni x-ms-device-info (le header natif du client
     porte le displayInfo réel — le remplacer perdrait l'info d'écran). P2
     (fusion de la réponse /configuration) est conservé ; --resolution est un
     no-op documenté. */
  const p3Anchor =
    'if (PREF_STREAM_TARGET_RESOLUTION !== "auto") {let osName = getOsNameFromResolution(PREF_STREAM_TARGET_RESOLUTION);headers["x-ms-device-info"] = JSON.stringify(generateMsDeviceInfo(osName)), body.settings.osName = osName;}';
  must(s, p3Anchor, "T8 handlePlay resolution (P3)");
  s = s.replace(p3Anchor, "if (false) {let osName = getOsNameFromResolution(PREF_STREAM_TARGET_RESOLUTION);headers[\"x-ms-device-info\"] = JSON.stringify(generateMsDeviceInfo(osName)), body.settings.osName = osName;}");

  /* ---------- T9 : bouton settings dans la game bar (page stream immersive) ----------
     Sur play.xbox.com, la page stream est une vue immersive SANS <nav>/header
     (observé 17 août : navs=[] sur /stream/) — le T4 n'a pas d'ancre
     d'injection en session. La seule surface utilisateur du script en cours
     de jeu est la GAME BAR (bx-game-bar, cachée par défaut, visible au
     mouvement de souris / clic sur la poignée). On ajoute une action
     Settings dans la liste d'actions du GameBar : même dialog que le bouton
     du header (SettingsDialog.getInstance().show()), super.onClick() cache
     la bar comme les autres actions. Patch preview-only (build-preview.js). */
  const gameBarAnchor = "class GameBar {";
  must(s, gameBarAnchor, "T9 class GameBar");
  s = s.replace(gameBarAnchor,
    "class SettingsAction extends BaseGameBarAction {$content;constructor() {super();this.$content = createButton({style: 8,icon: BxIcon.STREAM_SETTINGS,title: t(\"settings\"),onClick: this.onClick});}onClick = (e) => {super.onClick(e), SettingsDialog.getInstance().show();};}\n" +
    "class GameBar {");
  const gameBarActionsAnchor = "this.actions = [new ScreenshotAction";
  must(s, gameBarActionsAnchor, "T9 GameBar actions");
  s = s.replace(gameBarActionsAnchor, "this.actions = [new ScreenshotAction,new SettingsAction");

  /* ---------- T11 : game bar toujours utilisable sur la preview ----------
     Reproduit le 20 août en session réelle : la game bar n'apparaissait PAS
     en jeu sur play.xbox.com (overlay absent, settings inaccessibles en
     session). Cause : sur le client preview, xCloudPollingMode vaut « all »
     pendant le jeu (le stable vaut « none ») → le handler polling du
     constructeur GameBar appelle disable() (bar cachée, bx-offscreen —
     verifié en live : pollingMode=all, container=bx-offscreen ; showBar()
     manuel la rend visible). On neutralise ce disable sur BX_PREVIEW : la
     bar et son action Settings (T9) restent disponibles en session — la
     résilience document remplacé est couverte par le step 4 de T7. */
  const pollingAnchor = 'position !== "off" && window.addEventListener(BxEvent.XCLOUD_POLLING_MODE_CHANGED, ((e) => {if (STATES.isPlaying) window.BX_STREAM_SETTINGS.xCloudPollingMode !== "none" ? this.disable() : this.enable();}).bind(this));';
  must(s, pollingAnchor, "T11 GameBar polling handler");
  s = s.replace(pollingAnchor, 'position !== "off" && window.addEventListener(BxEvent.XCLOUD_POLLING_MODE_CHANGED, ((e) => {if (STATES.isPlaying && !BX_PREVIEW) window.BX_STREAM_SETTINGS.xCloudPollingMode !== "none" ? this.disable() : this.enable();}).bind(this));');

  /* ---------- T10 : auto-spoof UA non-Chromium (gate play.xbox.com) ----------
     Le client play.xbox.com bloque les navigateurs non-Chromium : check
     isSupportedChromiumBasedBrowser dans entry.client (Chrome/Blink >=106 ou
     fallback Chrome/Edge/Safari) — Firefox n'est pas dans la liste (dialog
     « Votre navigateur ne prend pas en charge la diffusion en continu »).
     Le stream WebRTC H.264 fonctionne pourtant sous Firefox. Auto-spoof :
     si le navigateur reel n'est PAS Chromium (Firefox, Safari Windows...),
     forcer le profil « windows-edge » par defaut — le gate passe sans reglage
     manuel. Le setting userAgent.profile garde la main (un profil explicite
     n'est jamais ecrase). Patch preview-only (BX_PREVIEW), stable inchange. */
  const uaSpoofAnchor = 'if (!UserAgent.#config.custom) UserAgent.#config.custom = "";UserAgent.spoof();';
  must(s, uaSpoofAnchor, "T10 UserAgent.init");
  s = s.replace(uaSpoofAnchor,
    'if (!UserAgent.#config.custom) UserAgent.#config.custom = "";' +
    '/* T10 : gate play.xbox.com = Chromium-only (Firefox/Safari not listed). WebRTC H.264 works in Firefox: auto-spoof Edge by default. */' +
    'if (BX_PREVIEW && bxOn("t10") && UserAgent.#config.profile === "default" && !(/chrom(e|ium)|edg\\/|crios/i.test(navigator.userAgent))) UserAgent.#config.profile = "windows-edge";' +
    'UserAgent.spoof();');

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
    "\nif (bxOn(\"t5\")) installKeepAliveIdle();\n}\n";
  s = s + t5Block;

  /* ---------- T16 : patch history (pushState/replaceState) — suspicion gel ----------
     Le build perf enveloppe history.pushState/replaceState et, a CHAQUE appel,
     emet BxEvent.POPSTATE de facon SYNCHRONE -> onHistoryChanged() ->
     NavigationDialogManager.hide() + LoadingScreen.reset() +
     BxEventBus.Stream.emit("state.stopped"). Sur www.xbox.com (React Router du
     stable) c'est inoffensif. Sur le client preview, un clic « Se preparer a
     diffuser en continu » declenche une navigation SPA : si un handler de
     state.stopped rappelle pushState/replaceState, la chaine
     navigation -> state.stopped -> navigation tourne sans jamais rendre la
     main = gel total MUET (aucune exception), dans TOUS les navigateurs
     (reproduit 1er nov sur Edge ET Firefox, apres le clic Play).
     - compteur : window.__BX_MARK("hist") a chaque appel (bx-debug) : une
       rafale de "hist" en dernier marqueur avant le gel = preuve.
     - masque   : localStorage bx-off = "t16" -> le patch history n'est PAS
       installe (methodes natives) : bisect sans rebuild.
     Etat 1er nov : NEUTRALISE PAR DEFAUT sur la preview (liste bx-on
     vide) — le patch history ne sert qu'a www.xbox.com. Reactiver sans
     rebuild : localStorage bx-on = "t16". */
  const histMarkerAnchor = "return function(...args) {return BxEvent.dispatch(window, BxEvent.POPSTATE, {arguments: args})";
  must(s, histMarkerAnchor, "T16 patchHistoryMethod wrapper");
  if (s.indexOf(histMarkerAnchor) !== s.lastIndexOf(histMarkerAnchor)) throw new Error("[build-preview] T16 : ancre wrapper multiple");
  s = s.replace(histMarkerAnchor, "return function(...args) {return window.__BX_MARK&&window.__BX_MARK(\"hist\"),BxEvent.dispatch(window, BxEvent.POPSTATE, {arguments: args})");

  const histPushAnchor = "window.history.pushState = patchHistoryMethod(\"pushState\");";
  const histReplAnchor = "window.history.replaceState = patchHistoryMethod(\"replaceState\");";
  must(s, histPushAnchor, "T16 pushState assign");
  must(s, histReplAnchor, "T16 replaceState assign");
  if (s.indexOf(histPushAnchor) !== s.lastIndexOf(histPushAnchor)) throw new Error("[build-preview] T16 : ancre pushState multiple");
  if (s.indexOf(histReplAnchor) !== s.lastIndexOf(histReplAnchor)) throw new Error("[build-preview] T16 : ancre replaceState multiple");
  s = s.replace(histPushAnchor, "if (!BX_PREVIEW || bxOn(\"t16\")) " + histPushAnchor);
  s = s.replace(histReplAnchor, "if (!BX_PREVIEW || bxOn(\"t16\")) " + histReplAnchor);

  /* ---------- T13 : la preview lit le flux via video.srcObject ----------
     Le stable masque le <video> tant qu'il n'a pas d'attribut src :
     `#game-stream video:not([src]){visibility:hidden}` (anti-flash noir du
     client www.xbox.com, qui pose src=blob: avant lecture). Le client preview
     attache le MediaStream par `video.srcObject` et ne pose JAMAIS src :
     la règle matche donc en permanence → vidéo invisible (visibility:hidden),
     droppedVideoFrames ≈ 100 %, jeu figé à l'écran (reproduit 30 oct sur FF7,
     `vis:hidden` + 41/42 frames droppées ; sans script : `vis:visible` + 2
     frames droppées). On retire la règle UNIQUEMENT dans le build preview. */
  const hideVideoRule = "#game-stream video:not([src]){visibility:hidden}";
  must(s, hideVideoRule, "T13 regle video:not([src])");
  s = s.replace(hideVideoRule, "/* T13 preview: video.srcObject (no src attribute) - hiding rule removed */");

  /* ---------- T14 : eager NavigationDialogManager au document-start CDP ----------
     Le stable est @run-at document-start, mais Tampermonkey garantit déjà un
     <html>. L'injection CDP du bench (inject-preview.js,
     Page.addScriptToEvaluateOnNewDocument) s'exécute PLUS TÔT : documentElement
     est null et le constructeur fait document.documentElement.appendChild(...)
     → TypeError qui avorte tout le reste du bundle (BX_SESSION_IMPORT,
     BX_DATA_SAVER, BX_REGION_APPLY, main(), T5). Constaté le 31 oct :
     BX_EXPOSED + BX_SOUND_ENGINE définis, tout le reste undefined, et le clic
     sur le bouton settings lève « reading 'render' » sur TAB_GLOBAL_ITEMS.
     On diffère l'appel eager tant que <html> n'existe pas ; le listener D-pad
     (window-capture) est posé dès que possible, bien avant l'interaction. */
  const eagerNavAnchor = "NavigationDialogManager.getInstance(); // eager : le listener D-pad (window-capture) est enregistré au document-start, avant le handler clavier de la page (course vs React)";
  must(s, eagerNavAnchor, "T14 eager NavigationDialogManager");
  s = s.replace(eagerNavAnchor, [
    "/* T14 preview: CDP document-start -> <html> pas encore cree */",
    "(function () {",
    "  if (!bxOn(\"t14\")) return;",
    "  function bxEagerNavDialog() {",
    "    window.__BX_MARK(\"t14.try\");",
    "    try { NavigationDialogManager.getInstance(); return true; }",
    "    catch (e) {",
    "      try { BxLogger.warn(\"PreviewEager\", \"NavigationDialogManager differe: \" + (e && e.message)); } catch (e2) {}",
    "      return false;",
    "    }",
    "  }",
    "  if (bxEagerNavDialog()) return;",
    "  var bxTries = 0;",
    "  var bxTimer = window.setInterval(function () {",
    "    if (bxEagerNavDialog() || ++bxTries > 500) window.clearInterval(bxTimer);",
    "  }, 10);",
    "  document.addEventListener(\"DOMContentLoaded\", function () { window.clearInterval(bxTimer); bxEagerNavDialog(); }, { once: true });",
    "})();",
    "// eager : listener D-pad (window-capture) pose des que <html> existe"
  ].join("\n"));

  // normalisation LF (contrat `.gitattributes eol=lf` : le CRLF historique
  // imposait un staging LF manuel à chaque release)
  s = s.replace(/\r\n/g, "\n");
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
  // 2. auto-update dédié — jamais le latest du stable, jamais un tag versionné
  // (purgé par la rétention → pin 404) : le CANAL flottant preview.
  if (previewSrc.includes("releases/latest/download/better-xcloud")) fail("@updateURL/@downloadURL pointent le latest du stable (clobbering)");
  if (!previewSrc.includes(PREVIEW_CHANNEL + "/better-xcloud-preview.meta.js")) fail("@updateURL preview manquant (canal " + PREVIEW_CHANNEL + ")");
  if (previewSrc.includes("releases/download/" + PREVIEW_TAG)) fail("@updateURL preview pinné sur un tag versionné (purgé par la rétention → 404 auto-update) — doit pointer le canal flottant");
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
fs.writeFileSync(META_OUT, extractMeta(out).replace(/\r\n/g, "\n"));
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
  "// @updateURL    https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/download/" + PREVIEW_CHANNEL,
  'var BX_PREVIEW = window.location.hostname === "play.xbox.com"',
  "static init() {if (BX_PREVIEW) return;Patcher.patchNativeBind();}",
  "static checkChunks(item) {if (BX_PREVIEW) return;",
  "if (!BX_PREVIEW && !window.location.pathname.match(/^\\/(?:[a-zA-Z]{2}-[a-zA-Z]{2}\\/)?play/)) throw Error(\"[Better xCloud] Not xCloud page\");",
  "var PreviewSettingsEntry = {",
  "bx-mobile-fab",
  "T13 preview: video.srcObject",
  "T14 preview: CDP document-start",
  "bxEagerNavDialog",
  "if (BX_PREVIEW) {",
  "installKeepAliveIdle",
  "window.PreviewKeepAliveIdle",
  "auto-spoof Edge by default",
  "var BX_OFF =",
  "window.__BX_MARK",
  "function bxOff(id)",
  'if (!bxOn("t4"))',
  'if (!bxOn("t7")) return;',
  'if (bxOn("t5")) installKeepAliveIdle();',
  'if (!bxOn("t14")) return;',
  'BX_PREVIEW && bxOn("t10")',
]) {
  if (!out.includes(probe)) { console.error("[build-preview] probe manquante: " + probe); process.exit(1); }
}
/* T13 : la règle de masquage du stable ne doit JAMAIS survivre au build preview. */
if (out.includes("#game-stream video:not([src]){visibility:hidden}")) {
  console.error("[build-preview] T13 ECHEC : #game-stream video:not([src]) toujours present (video preview masquee)");
  process.exit(1);
}
/* T14 : l'appel eager nu doit avoir disparu (sinon abort au document-start CDP). */
if (out.includes("NavigationDialogManager.getInstance(); // eager")) {
  console.error("[build-preview] T14 ECHEC : appel eager NavigationDialogManager non garde");
  process.exit(1);
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
