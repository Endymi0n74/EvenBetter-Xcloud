#!/usr/bin/env node
/*
 * find-session.js — localise l'instance de session du SDK au runtime (prérequis
 * P1-B : brancher window.PreviewKeepAliveIdle.wrapSession(session)).
 *
 * Stratégie : traversée des fibers React depuis le root de la page stream, +
 * scan borné des objets à « forme de session ». Les noms de méthodes du build
 * preview sont minifiés → heuristiques STRUCTURELLES (pas par noms) :
 *   - sessionPath ("v5/sessions/cloud/<GUID>")
 *   - serverDetails (objet avec ipAddress)
 *   - RTCPeerConnection (rtcPeerConnection / peerConnection / pc)
 *   - un objet dont une valeur chaîne contient le GUID de session courante
 *     (extrait du resource timing des requêtes /keepalive ou /state)
 *
 * Usage : node bench/preview/find-session.js [port]
 */
"use strict";
const { chromium } = require("playwright");

(async () => {
  const port = process.argv[2] || "9222";
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const ctx = browser.contexts()[0];
    const page = ctx.pages().find((p) => p.url().includes("play.xbox.com/stream"));
    if (!page) { console.error("aucune page stream ouverte"); process.exit(1); }

    const res = await page.evaluate(() => {
      // GUID de session courant, depuis le resource timing (requêtes /keepalive
      // ou /state vues par le navigateur)
      let sessionGuid = null;
      try {
        for (const e of performance.getEntriesByType("resource")) {
          const m = (e.name || "").match(/\/sessions\/cloud\/([0-9A-Fa-f-]{36})/);
          if (m) { sessionGuid = m[1].toUpperCase(); break; }
        }
      } catch (e) {}

      const looksLikeSession = (o) => {
        if (!o || typeof o !== "object") return false;
        const keys = Object.keys(o);
        const str = JSON.stringify(o).slice(0, 400);
        const hasSessionPath = typeof o.sessionPath === "string" && o.sessionPath.includes("sessions/cloud");
        const hasServerDetails = !!o.serverDetails && typeof o.serverDetails === "object" && typeof o.serverDetails.ipAddress === "string";
        const hasPc = keys.some((k) => /^(rtcPeerConnection|peerConnection|pc)$/i.test(k) && o[k] && typeof o[k] === "object");
        const hasGuid = sessionGuid ? str.includes(sessionGuid) : false;
        return (hasSessionPath || hasServerDetails || hasPc) || (hasGuid && keys.length >= 5);
      };

      const out = [];
      const seen = new Set();
      const scan = (obj, path, depth) => {
        if (depth > 6 || !obj || typeof obj !== "object") return;
        if (seen.has(obj)) return;
        seen.add(obj);
        try {
          if (looksLikeSession(obj)) {
            out.push({
              path,
              keys: Object.keys(obj).slice(0, 80),
              fn: Object.keys(obj).filter((k) => typeof obj[k] === "function").slice(0, 40),
              sessionPath: obj.sessionPath || null,
              guid: sessionGuid,
            });
          }
        } catch (e) {}
        for (const k of Object.keys(obj)) {
          if (k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance")) continue;
          let v;
          try { v = obj[k]; } catch (e) { continue; }
          if (v && typeof v === "object") {
            if (Array.isArray(v)) { if (v.length <= 300) scan(v, path + "." + k, depth + 1); }
            else scan(v, path + "." + k, depth + 1);
          }
        }
      };

      const getFiber = (node) => {
        if (!node) return null;
        const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
        return key ? node[key] : null;
      };
      const nameOf = (f) =>
        (f.type && (f.type.name || f.type.displayName)) ||
        (f.elementType && f.elementType.name) ||
        "tag" + f.tag;

      const rootNode = document.getElementById("root") || document.body;
      const rootFiber = getFiber(rootNode);
      const components = [];
      let queue = rootFiber ? [rootFiber] : [];
      let guard = 0;
      while (queue.length && guard++ < 8000) {
        const f = queue.shift();
        if (!f) continue;
        const name = nameOf(f);
        if (!name.startsWith("tag") && components.indexOf(name) === -1) components.push(name);
        try {
          if (f.memoizedProps) scan(f.memoizedProps, name + ":props", 0);
          if (f.memoizedState) scan(f.memoizedState, name + ":state", 0);
          if (f.stateNode && typeof f.stateNode === "object" && !(f.stateNode instanceof Node)) scan(f.stateNode, name + ":stateNode", 0);
          if (f.alternate && f.alternate.memoizedProps) scan(f.alternate.memoizedProps, name + ":altProps", 0);
          if (f.alternate && f.alternate.memoizedState) scan(f.alternate.memoizedState, name + ":altState", 0);
        } catch (e) {}
        if (f.child) queue.push(f.child);
        if (f.sibling) queue.push(f.sibling);
      }

      // globaux intéressants (session/stream/game/xcloud/rtc)
      const windowHits = Object.keys(window)
        .filter((k) => /session|stream|game|xcloud|rtc|webrtc|remote/i.test(k))
        .slice(0, 40);

      return { sessionGuid, components, sessions: out.slice(0, 8), windowHits };
    });

    console.log(JSON.stringify(res, null, 2));
    if (res.sessions.length === 0) console.log("\n⚠️  aucun objet à forme de session trouvé (fibers/props/state/globaux).");
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
