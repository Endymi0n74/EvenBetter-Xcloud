#!/usr/bin/env node
/*
 * keepalive-idle.js — P1 : interception du WarningForBeingIdle du preview.
 *
 * Le preview (StreamSessionRequest-*.js) reçoit du serveur le message
 * `WarningForBeingIdle` (même protocole que le stable) et, dans
 * `onServerDisconnectMessage(e){`, affiche un compte à rebours
 * (`dispatchEvent(new qe(secondsUntilKick))`). Le stable, lui, intercepte ce
 * message et envoie `this.sendKeepAlive()` (patch remotePlayKeepAlive) pour
 * garder la session vivante malgré l'inactivité.
 *
 * `sendKeepAlive()` et `onServerDisconnectMessage` sont sur la MÊME classe
 * (classe `e` du module, offsets 50742 et 67876) → `this.sendKeepAlive()`
 * fonctionne dans le handler patché.
 *
 * Ce module est la source unique des deux usages :
 *   1. node : patchStreamSessionRequestSource(src) — transform du source du
 *      bundle (testé par keepalive-idle.test.js sur le bundle capturé).
 *   2. userscript : installKeepAliveIdle() — self-contained (toString() →
 *      embarqué par build-preview.js, transform T5) : hook fetch du module +
 *      api window.PreviewKeepAliveIdle.wrapSession(session).
 *
 * VERDICT 16 août (statique, session.md) : le module est chargé en ESM natif
 * (entry.client → import() dynamique du chunk route → import STATIQUE de
 * StreamSessionRequest dans GameStreamBootstrapper ; 0 fetch de module .js,
 * 0 importScripts, 0 <script> créé). Le loader ESM n'utilise JAMAIS
 * window.fetch → le hook fetch du module (voie 1) ne peut pas se brancher,
 * quel que soit le timing. wrapSession (voie 2) est la SEULE voie runtime de
 * P1 — reste à localiser l'instance de session au runtime (hook React /
 * capture). Le hook fetch est conservé en fallback inoffensif (si Microsoft
 * bascule un jour sur un chargement par fetch).
 */

"use strict";

const KEEPALIVE_OLD =
  ":t.reason===`WarningForBeingIdle`?(g.Instance.info(`Warning for being idle; secondsUntilKick:${t.secondsUntilKick}`),o.Instance.trackEvent(f.WarningForBeingIdle,{secondsUntilKick:t.secondsUntilKick??0,...this.telemetryContext.getProps()},{location:`StreamSession`}),this.eventTarget.dispatchEvent(new qe(t.secondsUntilKick??0)))";

const KEEPALIVE_NEW =
  ":t.reason===`WarningForBeingIdle`?(g.Instance.info(`BX keep-alive: idle warning intercepted (secondsUntilKick:${t.secondsUntilKick}); sending keep alive`),this.sendKeepAlive())";

/**
 * Transform du source du module StreamSessionRequest du preview.
 * Retourne { ok, patched, src? } ou { ok:false, error }.
 */
function patchStreamSessionRequestSource(src) {
  if (typeof src !== "string") return { ok: false, error: "not-a-string" };
  if (src.includes(KEEPALIVE_NEW)) return { ok: true, patched: false, skipped: "already-patched" };
  let count = 0, i = -1;
  while ((i = src.indexOf(KEEPALIVE_OLD, i + 1)) !== -1) count++;
  if (count === 0) return { ok: false, error: "anchor-not-found" };
  if (count > 1) return { ok: false, error: "anchor-duplicated:" + count };
  return { ok: true, patched: true, src: src.replace(KEEPALIVE_OLD, KEEPALIVE_NEW) };
}

/**
 * Runtime userscript — SELF-CONTAINED (toString() embarqué par le build).
 * Ne doit référencer aucune variable externe.
 */
function installKeepAliveIdle() {
  var OLD = ":t.reason===`WarningForBeingIdle`?(g.Instance.info(`Warning for being idle; secondsUntilKick:${t.secondsUntilKick}`),o.Instance.trackEvent(f.WarningForBeingIdle,{secondsUntilKick:t.secondsUntilKick??0,...this.telemetryContext.getProps()},{location:`StreamSession`}),this.eventTarget.dispatchEvent(new qe(t.secondsUntilKick??0)))";
  var NEW = ":t.reason===`WarningForBeingIdle`?(g.Instance.info(`BX keep-alive: idle warning intercepted (secondsUntilKick:${t.secondsUntilKick}); sending keep alive`),this.sendKeepAlive())";
  var MODULE_RE = /StreamSessionRequest-[A-Za-z0-9_-]+\.js/;
  var _patched = false;

  function patch(src) {
    if (_patched) return { ok: true, patched: false, skipped: "already-patched-once" };
    if (src.indexOf(NEW) !== -1) { _patched = true; return { ok: true, patched: false, skipped: "already-patched" }; }
    if (src.indexOf(OLD) === -1) return { ok: false, error: "anchor-not-found" };
    _patched = true;
    return { ok: true, patched: true, src: src.split(OLD).join(NEW) };
  }

  // 1) hook fetch : couvre le cas où le runtime charge le module via window.fetch
  //    (à confirmer runtime — chargement ESM natif possible → no-op silencieux).
  //    Se chaîne au window.fetch existant (le hook bloqueurs du script).
  var prevFetch = window.fetch;
  if (typeof prevFetch === "function") {
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      if (MODULE_RE.test(url)) {
        return prevFetch.apply(this, arguments).then(function (resp) {
          if (!resp || typeof resp.clone !== "function") return resp;
          try {
            return resp.clone().text().then(function (text) {
              var r = patch(text);
              if (r.ok && r.patched) {
                BxLogger && BxLogger.info("PreviewKeepAliveIdle", "module StreamSessionRequest patche (fetch)");
                return new Response(r.src, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
              }
              return resp;
            }).catch(function () { return resp; });
          } catch (e) { return resp; }
        });
      }
      return prevFetch.apply(this, arguments);
    };
  }

  // 2) api d'instance : wrapper onServerDisconnectMessage sur la session.
  window.PreviewKeepAliveIdle = {
    patched: function () { return _patched; },
    wrapSession: function (session) {
      if (!session || typeof session.onServerDisconnectMessage !== "function") return false;
      if (session._bxKeepAliveWrapped) return true;
      var org = session.onServerDisconnectMessage.bind(session);
      session.onServerDisconnectMessage = function (e) {
        var t = null;
        try { t = JSON.parse(e); } catch (ex) { return org(e); }
        if (t && t.reason === "WarningForBeingIdle") {
          try { if (typeof session.sendKeepAlive === "function") { session.sendKeepAlive(); return; } } catch (ex) { /* fallback */ }
        }
        return org(e);
      };
      session._bxKeepAliveWrapped = true;
      return true;
    }
  };

  // 3) LOCALISATION AUTOMATIQUE de la session au runtime (validée en réel 17 août) :
  //    la session du SDK est tenue dans l'état d'un composant React du stream —
  //    fibre .Connection → chaîne d'état (memoizedState.next…) → memoizedState.data._session
  //    (objet avec sendKeepAlive + onServerDisconnectMessage). Le walk est par
  //    FORME (sendKeepAlive), pas par nom de composant (minifié/instable).
  /* BFS persistant : etat conserve d'un tick a l'autre. */
  var bqKey = null, bq = [], bqi = 0;

  function locateSession() {
    try {
      var root = document.getElementById("root") || document.body;
      if (!root) return null;
      var fiberKey = null, keys = Object.keys(root);
      for (var i = 0; i < keys.length; i++) if (keys[i].indexOf("__reactFiber$") === 0) { fiberKey = keys[i]; break; }
      if (!fiberKey) return null;
      /* 1er nov : BUDGET DE TEMPS + file d'attente PERSISTANTE.
         L'ancienne version faisait queue.shift() (O(n) par noeud) sur jusqu'a
         20000 fibres, relancee toutes les 3 s : sur le shell actuel la session
         n'est jamais trouvee, donc chaque tick parcourait tout l'arbre — gel de
         plusieurs secondes a repetition (constate au lancement du jeu, brique
         t5 activee). Desormais chaque tick traite au plus ~6 ms et reprend la
         ou il s'etait arrete. */
      if (bqKey !== fiberKey || bqi >= bq.length) { bqKey = fiberKey; bq = [root[fiberKey]]; bqi = 0; }
      var t0 = typeof performance !== "undefined" ? performance.now() : Date.now(), steps = 0;
      while (bqi < bq.length && bq.length < 40000) {
        if ((steps++ & 63) === 0) {
          var now = typeof performance !== "undefined" ? performance.now() : Date.now();
          if (now - t0 > 6) return null;
        }
        var f = bq[bqi++];
        if (!f) continue;
        var st = f.memoizedState, depth = 0;
        while (st && depth++ < 10) {
          var ms = st.memoizedState;
          if (ms && ms.data && ms.data._session && typeof ms.data._session.sendKeepAlive === "function") {
            bqKey = null; bq = []; bqi = 0;
            return ms.data._session;
          }
          st = st.next;
        }
        if (f.child) bq.push(f.child);
        if (f.sibling) bq.push(f.sibling);
      }
      if (bqi >= bq.length) { bq = []; bqi = 0; }
    } catch (e) {}
    return null;
  }

  /* watcher : wrap la session des qu'elle apparait (montage du stream), et
     re-wrap si une NOUVELLE session est creee (relance / reconnexion — la
     garde _bxKeepAliveWrapped rend le wrap idempotent par instance).
     Cadence 3 s, cout borne par le budget de locateSession ; abandon apres
     10 min sans session pour ne pas tourner indefiniment. */
  var attempts = 0, timerId = null;
  function watchSession() {
    var _t5s = typeof performance !== "undefined" ? performance.now() : 0;
    try { if (typeof window.__BX_MARK === "function") window.__BX_MARK("t5.watchS"); } catch (e) {}
    var s = locateSession();
    try { if (typeof window.__BX_MARK === "function") window.__BX_MARK("t5.watch", (typeof performance !== "undefined" ? performance.now() : 0) - _t5s); } catch (e) {}
    if (s) {
      attempts = 0;
      if (!s._bxKeepAliveWrapped) {
        try {
          if (window.PreviewKeepAliveIdle.wrapSession(s)) BxLogger && BxLogger.info("PreviewKeepAliveIdle", "session wrapper (fibers)");
        } catch (e) {}
      }
      return;
    }
    if (++attempts > 200) {
      if (timerId !== null && typeof window.clearInterval === "function") window.clearInterval(timerId);
      timerId = null;
      BxLogger && BxLogger.info("PreviewKeepAliveIdle", "session introuvable apres 10 min — locator arrete");
    }
  }
  if (typeof window.setInterval === "function") timerId = window.setInterval(watchSession, 3000);
  watchSession();
}

module.exports = { KEEPALIVE_OLD, KEEPALIVE_NEW, patchStreamSessionRequestSource, installKeepAliveIdle };
