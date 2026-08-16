#!/usr/bin/env node
/*
 * hunt-session.js — chasse l'instance de la classe session du SDK au runtime.
 * Le module StreamSessionRequest-iiux1fqv.js définit la classe avec les noms
 * NON minifiés onServerDisconnectMessage / sendKeepAlive / heartBeatSession.
 * Stratégie : retrouver _sessionRequest via les fibers .Connection (comme
 * dump-session.js), puis scan du GRAPHE atteignable (généreux, borné par un
 * seen-set) à la recherche d'objets exposant ces méthodes — la session est
 * probablement accrochée à playService / eventTarget / la machine à états.
 *
 * Usage : node bench/preview/hunt-session.js [port]
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
      const getFiber = (node) => {
        const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
        return key ? node[key] : null;
      };
      const nameOf = (f) =>
        (f.type && (f.type.name || f.type.displayName)) ||
        (f.elementType && f.elementType.name) ||
        "tag" + f.tag;

      const rootFiber = getFiber(document.getElementById("root") || document.body);
      let sr = null;
      const queue = rootFiber ? [rootFiber] : [];
      let guard = 0;
      while (queue.length && guard++ < 12000) {
        const f = queue.shift();
        if (!f) continue;
        if (nameOf(f) === ".Connection") {
          let st = f.memoizedState;
          let steps = 0;
          while (st && steps++ < 8) {
            if (st.memoizedState && st.memoizedState.data && st.memoizedState.data._sessionRequest) { sr = st.memoizedState.data._sessionRequest; break; }
            st = st.next;
          }
          if (sr) break;
        }
        if (f.child) queue.push(f.child);
        if (f.sibling) queue.push(f.sibling);
      }
      if (!sr) return { error: "_sessionRequest introuvable" };

      const HUNT = ["onServerDisconnectMessage", "sendKeepAlive", "heartBeatSession"];
      const found = [];
      const seen = new Set();
      const scan = (obj, path, depth) => {
        if (depth > 12 || !obj || typeof obj !== "object") return;
        if (seen.has(obj)) return;
        seen.add(obj);
        try {
          const own = Object.getOwnPropertyNames(obj);
          const hits = HUNT.filter((h) => typeof obj[h] === "function");
          if (hits.length > 0) {
            found.push({ path, hits, fn: Object.keys(obj).filter((k) => typeof obj[k] === "function").slice(0, 30) });
            return; // ne pas re-scanner un candidat session
          }
          // chemin direct vers playService/eventTarget/config pour la suite
          for (const k of own) {
            if (k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance")) continue;
            let v;
            try { v = obj[k]; } catch (e) { continue; }
            if (v && typeof v === "object") {
              if (Array.isArray(v)) { if (v.length <= 500) scan(v, path + "." + k, depth + 1); }
              else scan(v, path + "." + k, depth + 1);
            }
          }
          // prototypes (méthodes de classe portées par l'instance ?)
          let p = Object.getPrototypeOf(obj);
          let pd = 0;
          while (p && p !== Object.prototype && pd++ < 4) {
            if (!seen.has(p)) {
              seen.add(p);
              for (const h of HUNT) if (typeof p[h] === "function") found.push({ path: path + " [proto " + (p.constructor ? p.constructor.name : "?") + "]", hits: [h] });
            }
            p = Object.getPrototypeOf(p);
          }
        } catch (e) {}
      };

      // graphes : _sessionRequest entier, playService, eventTarget, serviceSettings
      scan(sr, "_sessionRequest", 0);
      if (sr.playService) scan(sr.playService, "_sessionRequest.playService", 0);
      if (sr.eventTarget) scan(sr.eventTarget, "_sessionRequest.eventTarget", 0);
      if (sr.serviceSettings) scan(sr.serviceSettings, "_sessionRequest.serviceSettings", 0);
      if (sr.telemetryContext) scan(sr.telemetryContext, "_sessionRequest.telemetryContext", 0);

      // scan de l'ARBRE DE FIBERS complet : la session (sendKeepAlive /
      // onServerDisconnectMessage) peut être dans un état React non atteignable
      // depuis _sessionRequest (closure du module, exposée via un composant)
      const scanFiber = (f) => {
        if (!f || seen.has(f)) return;
        seen.add(f);
        try {
          for (const [label, val] of [["props", f.memoizedProps], ["state", f.memoizedState], ["altProps", f.alternate && f.alternate.memoizedProps], ["altState", f.alternate && f.alternate.memoizedState]]) {
            if (val && typeof val === "object" && val.data && typeof val.data === "object") scan(val.data, nameOf(f) + ":" + label + ".data", 0);
            else if (val && typeof val === "object") scan(val, nameOf(f) + ":" + label, 0);
          }
          if (f.stateNode && typeof f.stateNode === "object" && !(f.stateNode instanceof Node)) scan(f.stateNode, nameOf(f) + ":stateNode", 0);
        } catch (e) {}
      };
      let q2 = rootFiber ? [rootFiber] : [];
      let g2 = 0;
      while (q2.length && g2++ < 12000) {
        const f = q2.shift();
        if (!f) continue;
        scanFiber(f);
        if (f.child) q2.push(f.child);
        if (f.sibling) q2.push(f.sibling);
      }

      return {
        sessionPath: sr.sessionPath,
        found: found.slice(0, 12),
        scannedObjects: seen.size,
      };
    });

    console.log(JSON.stringify(res, null, 2));
    if (res.found && res.found.length === 0) console.log("\n⚠️  aucune instance session (onServerDisconnectMessage/sendKeepAlive) atteignable depuis _sessionRequest/playService/eventTarget.");
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
