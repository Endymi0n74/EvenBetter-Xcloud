#!/usr/bin/env node
/*
 * dump-session.js — creuse l'objet _sessionRequest découvert par find-session.js
 * (chemin .Connection:state.next.next.next.memoizedState.data._sessionRequest) :
 * prototype (noms minifiés ou non), _state, eventTarget, configuration,
 * playService — pour localiser la session réelle (sendKeepAlive/heartBeatSession)
 * et décider comment wrapSession l'attrape.
 *
 * Usage : node bench/preview/dump-session.js [port]
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

      // retrouver TOUTES les fibers .Connection et chercher _sessionRequest dans chacune
      const rootFiber = getFiber(document.getElementById("root") || document.body);
      const connFibers = [];
      const queue = rootFiber ? [rootFiber] : [];
      let guard = 0;
      while (queue.length && guard++ < 12000) {
        const f = queue.shift();
        if (!f) continue;
        if (nameOf(f) === ".Connection") connFibers.push(f);
        if (f.child) queue.push(f.child);
        if (f.sibling) queue.push(f.sibling);
      }
      if (connFibers.length === 0) return { error: "fiber .Connection introuvable" };

      let sr = null;
      let foundIn = null;
      for (const cf of connFibers) {
        let st = cf.memoizedState;
        let steps = 0;
        while (st && steps++ < 8) {
          if (st.memoizedState && st.memoizedState.data && st.memoizedState.data._sessionRequest) { sr = st.memoizedState.data._sessionRequest; foundIn = cf; break; }
          st = st.next;
        }
        if (sr) break;
      }
      if (!sr) return { error: "_sessionRequest introuvable dans les chaînes d'état des " + connFibers.length + " fibers .Connection" };

      // dump structurel
      const dumpProto = (obj, label) => {
        const proto = Object.getPrototypeOf(obj);
        if (!proto || proto === Object.prototype || proto === null) return [];
        const names = Object.getOwnPropertyNames(proto);
        const methods = [];
        const getters = [];
        const props = [];
        for (const n of names) {
          // getOwnPropertyDescriptor : ne PAS déclencher les getters (this mal lié)
          const d = Object.getOwnPropertyDescriptor(proto, n);
          if (d.get) getters.push(n);
          else if (typeof d.value === "function") methods.push(n);
          else props.push(n);
        }
        return { label, ctor: proto.constructor ? proto.constructor.name : "?", methods: methods.slice(0, 60), getters: getters.slice(0, 20), props: props.slice(0, 20) };
      };
      const out = { sessionPath: sr.sessionPath, keys: Object.keys(sr) };
      out.proto = dumpProto(sr, "sr");
      for (const k of ["_state", "eventTarget", "configuration", "playService", "telemetryContext", "deviceInformation", "serviceSettings"]) {
        const v = sr[k];
        if (v === undefined || v === null) continue;
        out[k] = {
          type: typeof v,
          ctor: v && v.constructor ? v.constructor.name : null,
          keys: v && typeof v === "object" ? Object.keys(v).slice(0, 40) : null,
          proto: v && typeof v === "object" ? dumpProto(v, k) : null,
        };
      }
      return out;
    });

    console.log(JSON.stringify(res, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
