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
  //    À brancher dès que la session est localisée (capture runtime / hook React).
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
}

module.exports = { KEEPALIVE_OLD, KEEPALIVE_NEW, patchStreamSessionRequestSource, installKeepAliveIdle };
