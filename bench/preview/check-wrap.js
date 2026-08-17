#!/usr/bin/env node
/*
 * check-wrap.js — vérifie que wrapSession (P1) est branchée sur la session
 * RÉELLE du stream : localise l'instance de la classe session dans les fibers
 * React (chemin découvert le 17 août : .Connection → memoizedState.data._session)
 * et rapporte _bxKeepAliveWrapped (marqueur posé par installKeepAliveIdle).
 *
 * Critère de départ du run P1-B : _bxKeepAliveWrapped === true (sinon le
 * WarningForBeingIdle n'est PAS intercepté et la fenêtre AFK ne prouve rien).
 *
 * Usage : node bench/preview/check-wrap.js [port]
 */
"use strict";
const { chromium } = require("playwright");

(async () => {
  const port = process.argv[2] || "9222";
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const ctx = browser.contexts()[0];
    const page = ctx.pages().find((p) => p.url().includes("play.xbox.com/stream"));
    if (!page) { console.error("aucune page stream ouverte — lance un stream d'abord"); process.exit(1); }

    const res = await page.evaluate(() => {
      const getFiber = (node) => {
        const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
        return key ? node[key] : null;
      };
      const nameOf = (f) =>
        (f.type && (f.type.name || f.type.displayName)) ||
        (f.elementType && f.elementType.name) ||
        "tag" + f.tag;

      const rootFiber = getFiber(document.getElementById("root") || document.body);
      const sessions = [];
      const queue = rootFiber ? [rootFiber] : [];
      let guard = 0;
      while (queue.length && guard++ < 12000) {
        const f = queue.shift();
        if (!f) continue;
        // chaque fiber : parcours de la chaîne memoizedState à la recherche
        // d'un objet à forme de session (sendKeepAlive + onServerDisconnectMessage)
        let st = f.memoizedState;
        let steps = 0;
        while (st && steps++ < 8) {
          const d = st.memoizedState && st.memoizedState.data;
          if (d && typeof d === "object") {
            // la session est une PROPRIÉTÉ de data (d._session, découverte 17
            // août : .Connection:…:memoizedState.data._session) ; les méthodes
            // de classe (sendKeepAlive / onServerDisconnectMessage) sont portées
            // par le PROTOTYPE — typeof les voit, getOwnPropertyNames non.
            const scanForSession = (obj) => {
              if (obj && typeof obj === "object" && typeof obj.sendKeepAlive === "function" && typeof obj.onServerDisconnectMessage === "function") {
                sessions.push({
                  component: nameOf(f),
                  wrapped: obj._bxKeepAliveWrapped === true,
                  hasStream: !!obj.stream,
                  hasInputChannel: !!(obj.stream && typeof obj.stream.getInputChannel === "function"),
                });
                return true;
              }
              return false;
            };
            // candidats directs + un niveau de profondeur dans data
            if (!scanForSession(d)) {
              if (!(d._session && scanForSession(d._session))) {
                if (!(d._sessionRequest && scanForSession(d._sessionRequest))) {
                  for (const k of Object.getOwnPropertyNames(d)) if (scanForSession(d[k])) break;
                }
              }
            }
          }
          st = st.next;
        }
        if (f.child) queue.push(f.child);
        if (f.sibling) queue.push(f.sibling);
      }

      return {
        url: location.href,
        apiKeepAlive: typeof window.PreviewKeepAliveIdle === "object" && typeof window.PreviewKeepAliveIdle.wrapSession === "function",
        sessions,
      };
    });

    console.log(JSON.stringify(res, null, 2));
    const wrapped = res.sessions.filter((s) => s.wrapped).length;
    if (res.sessions.length === 0) {
      console.log("\n❌ aucune session (sendKeepAlive/onServerDisconnectMessage) dans les fibers — stream pas encore monté ?");
      process.exit(1);
    }
    if (wrapped === res.sessions.length) {
      console.log(`\nwrapSession branchée ✅ — ${wrapped}/${res.sessions.length} session(s) wrapée(s), prêt pour la fenêtre AFK P1-B`);
      process.exit(0);
    }
    console.log(`\n⚠️  ${res.sessions.length - wrapped} session(s) NON wrapée(s) — le locator (watcher 3 s) n'a pas encore wrapé, ou le build est antérieur au locator`);
    process.exit(2);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
