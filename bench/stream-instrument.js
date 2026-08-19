#!/usr/bin/env node
/*
 * stream-instrument.js — instrumentation du WebView pendant un stream (écran noir).
 *
 * Attaché via CDP (adb forward → localabstract:webview_devtools_remote_<pid>),
 * écoute pendant un stream et capture l'événement EXACT d'un éventuel écran
 * noir / freeze :
 *   - états video (readyState, paused, currentTime, error, dimensions)
 *   - frames RÉELLEMENT présentées (requestVideoFrameCallback → presentedFrames)
 *     → détection de freeze compositor vs freeze décodeur/réseau
 *   - WebRTC (getStats : framesDropped/framesDecoded/packetsLost/jitter +
 *     iceConnectionState/connectionState) via le peerConnection de la session
 *     trouvé par walk des fibres React (locator P1, best-effort) + wrap du
 *     constructeur pour les connexions suivantes
 *   - événements CDP : exceptions JS, erreurs console, échecs réseau
 *   - événements page : video error/stalled/waiting/emptied, visibilitychange
 *
 * Usage : node bench/stream-instrument.js [--port 9231] [--duration 300]
 *         [--interval 1000] [--out bench/stream-instrument-<ts>.jsonl]
 *
 * Sortie : JSONL (toutes les secondes + anomalies) + résumé final sur stdout.
 * exit 0 même si des anomalies sont vues (c'est une observation, pas un gate).
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const port = parseInt(args[args.indexOf("--port") + 1], 10) || 9231;
const durationMs = (parseInt(args[args.indexOf("--duration") + 1], 10) || 300) * 1000;
const intervalMs = parseInt(args[args.indexOf("--interval") + 1], 10) || 1000;
const outIdx = args.indexOf("--out");
const outFile = (outIdx !== -1 && args[outIdx + 1]) || path.join(__dirname, "stream-instrument-" + new Date().toISOString().replace(/[:.]/g, "-") + ".jsonl");
const BASE = "http://127.0.0.1:" + port;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    http.get(BASE + pathname, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

// Instrument injecté une fois dans la page : compteur rVFC persistant +
// écouteurs d'événements + wrap RTCPeerConnection. Résultats dans
// window.__bxInst (lu à chaque poll depuis Node).
const INSTRUMENT = `(() => {
  if (window.__bxInst) return;
  const I = { ts: Date.now(), events: [], rvfc: null, pcs: [], pcStats: {}, started: Date.now() };
  window.__bxInst = I;
  const push = (e) => { I.events.push(Object.assign({ t: Date.now() }, e)); if (I.events.length > 500) I.events.splice(0, I.events.length - 500); };

  // --- compteur rVFC persistant (frames réellement présentées) ---
  const v = () => document.querySelector("video");
  const tick = () => {
    const el = v();
    if (!el || typeof el.requestVideoFrameCallback !== "function") { I.rvfc = null; return; }
    el.requestVideoFrameCallback((now, meta) => {
      I.rvfc = { pf: meta.presentedFrames, mt: meta.mediaTime, w: meta.width, h: meta.height, at: Date.now() };
      tick();
    });
  };
  tick();

  // --- événements video (délégation sur document : survit au remplacement)
  // --- du document par le shell preview ---
  ["error", "stalled", "waiting", "playing", "pause", "emptied", "ended", "abort", "suspend"].forEach((ev) => {
    document.addEventListener(ev, (e) => {
      if (e.target && e.target.tagName !== "VIDEO") return;
      const el = e.target;
      push({ ev: "video." + ev, rs: el.readyState, t: el.currentTime, err: el.error ? el.error.code : null });
    }, { capture: true, passive: true });
  });

  // --- page / fenêtre ---
  window.addEventListener("error", (e) => push({ ev: "window.error", msg: String(e.message).slice(0, 200) }), true);
  window.addEventListener("unhandledrejection", (e) => push({ ev: "unhandledrejection", msg: String(e.reason).slice(0, 200) }));
  document.addEventListener("visibilitychange", () => push({ ev: "visibilitychange", hidden: document.hidden }));

  // --- WebRTC : wrap pour les connexions futures + stats pollées ---
  const OrigPC = window.RTCPeerConnection;
  if (OrigPC && !I._wrapped) {
    I._wrapped = true;
    window.RTCPeerConnection = class extends OrigPC {
      constructor(...a) {
        super(...a);
        const pc = this;
        I.pcs.push(pc);
        ["iceconnectionstatechange", "connectionstatechange", "signalingstatechange"].forEach((ev) => {
          pc.addEventListener(ev, () => push({ ev: "pc." + ev, ice: pc.iceConnectionState, conn: pc.connectionState }));
        });
      }
    };
  }
})();`;

(async () => {
  // ---- connexion CDP ----
  let pages;
  try { pages = await getJson("/json"); } catch (e) {
    console.error("❌ GATE : CDP injoignable sur " + BASE + " (" + e.message + ") — adb forward requis");
    process.exit(1);
  }
  const page = pages.find((p) => p.type === "page" && /play\.xbox\.com|stream/.test(p.url || ""));
  if (!page) {
    console.error("❌ GATE : aucune page stream CDP — " + JSON.stringify(pages.filter((p) => p.type === "page").map((p) => p.url)));
    process.exit(1);
  }
  console.log("[instrument] page : " + page.url);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const cdpEvents = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) cdpEvents.push({ t: Date.now(), method: m.method, params: m.params });
  });
  await new Promise((r) => ws.addEventListener("open", r));
  const send = (method, params) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) {
      return { __err: r.result.exceptionDetails.text + " " + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || "").slice(0, 150) };
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send("Runtime.enable").catch(() => {});
  await send("Log.enable").catch(() => {});
  await send("Network.enable").catch(() => {});

  // ---- injection de l'instrument ----
  const inj = await evalJs(INSTRUMENT);
  if (inj && inj.__err) { console.error("❌ injection échouée : " + inj.__err); process.exit(1); }
  console.log("[instrument] instrument injecté");

  // ---- best-effort : peerConnection de la session via walk des fibres React ----
  // Stocke le PC trouvé dans window.__bxInst.foundPc pour que le poll getStats
  // puisse l'utiliser (le PC de la session courante précède l'injection).
  const pcProbe = await evalJs(`(() => {
    const seen = new Set();
    const found = [];
    const visit = (f, depth) => {
      if (!f || depth > 40 || found.length >= 2 || seen.has(f)) return;
      seen.add(f);
      let m = f.memoizedState, guard = 0;
      while (m && guard++ < 40) {
        const d = m && m.memoizedState;
        if (d && typeof d === "object") {
          try {
            for (const k of Object.keys(d)) {
              const o = d[k];
              if (o && typeof o === "object" && typeof o.getStats === "function" && "connectionState" in o) { found.push(o); }
            }
          } catch (e) {}
        }
        m = m.next;
      }
      visit(f.child, depth + 1);
      visit(f.sibling, depth + 1);
    };
    const rootEl = document.querySelector("body > div") || document.body;
    for (const k of Object.keys(rootEl)) if (k.startsWith("__reactFiber")) { visit(rootEl[k], 0); break; }
    if (window.__bxInst && found.length) window.__bxInst.foundPc = found[0];
    return { found: found.length };
  })()`);
  console.log("[instrument] PC session trouvé via fibres : " + JSON.stringify(pcProbe));

  // ---- boucle de sondage ----
  const log = fs.createWriteStream(outFile, { flags: "a" });
  const line = (o) => { const s = JSON.stringify(o); log.write(s + "\n"); console.log(s); };
  const anomalies = [];
  const T0 = Date.now();
  let prevPf = null, prevT = null, prevDrop = null, stallCount = 0;
  let lastIce = null, lastConn = null, prevRs = null, prevErr = null;
  console.log("[instrument] observation " + (durationMs / 1000) + " s → " + outFile);

  while (Date.now() - T0 < durationMs) {
    const now = Date.now();
    // état video + rVFC
    const st = await evalJs(`(() => {
      const el = document.querySelector("video");
      const I = window.__bxInst;
      const base = {
        url: location.pathname,
        v: el ? { rs: el.readyState, paused: el.paused, t: el.currentTime, err: el.error ? el.error.code : null, w: el.videoWidth, h: el.videoHeight } : null,
        rvfc: I ? I.rvfc : null,
        vis: document.visibilityState,
      };
      const evs = I ? I.events.splice(0, I.events.length) : [];
      if (evs.length) base.evs = evs;
      return JSON.stringify(base);
    })()`);
    let o = {};
    try { o = JSON.parse(st || "{}"); } catch (e) {}
    const v = o.v, r = o.rvfc;
    const sample = { t: now - T0, url: o.url, rs: v ? v.rs : -1, paused: v ? v.paused : null, tVideo: v ? +v.t.toFixed(2) : null, err: v ? v.err : null, res: v ? v.w + "x" + v.h : null, pf: r ? r.pf : null, vis: o.vis };
    // fps présenté
    if (r && prevPf !== null && prevT !== null) {
      const dt = (now - prevT) / 1000;
      const dpf = r.pf - prevPf;
      sample.fps = dt > 0 ? +(dpf / dt).toFixed(1) : 0;
      // freeze : 0 frames présentées pendant >= 2 polls alors que la vidéo joue
      if (dpf === 0 && v && v.rs >= 2 && !v.paused) {
        stallCount++;
        if (stallCount === 2) {
          const a = { at: (now - T0) / 1000, kind: "FREEZE_CANDIDAT", detail: "0 frame présentée depuis " + (stallCount * intervalMs / 1000) + "s (rs=" + v.rs + ", t=" + +v.t.toFixed(2) + ")" };
          anomalies.push(a); sample.anomaly = a;
        }
      } else if (dpf > 0) stallCount = 0;
    }
    prevPf = r ? r.pf : null; prevT = now;
    // regression readyState
    if (v && v.rs <= 1 && prevRs !== null && prevRs >= 2) {
      const a = { at: (now - T0) / 1000, kind: "READYSTATE_RESET", detail: "readyState " + prevRs + "→" + v.rs };
      anomalies.push(a); sample.anomaly = a;
    }
    if (v) prevRs = v.rs;
    // erreur video
    if (v && v.err !== null && v.err !== prevErr) {
      const a = { at: (now - T0) / 1000, kind: "VIDEO_ERROR", detail: "code " + v.err };
      anomalies.push(a); sample.anomaly = a;
    }
    if (v) prevErr = v.err;
    // événements de la page
    if (o.evs && o.evs.length) {
      sample.evs = o.evs.map((e) => e.ev + (e.msg ? ":" + e.msg.slice(0, 60) : "") + (e.ice ? " ice=" + e.ice : "") + (e.conn ? " conn=" + e.conn : "") + (e.hidden !== undefined ? " hidden=" + e.hidden : ""));
      for (const e of o.evs) {
        if (/error|failed|stalled|waiting|emptied|disconnected/.test(e.ev)) {
          anomalies.push({ at: (now - T0) / 1000, kind: "EVENT", detail: e.ev + (e.msg ? " " + e.msg.slice(0, 80) : "") + (e.ice ? " ice=" + e.ice : "") });
        }
      }
    }
    // stats PC (getStats) si trouvé — best-effort toutes les ~5 s
    if (now % 5000 < intervalMs) {
      const ps = await evalJs(`(async () => {
        const I = window.__bxInst;
        const pc = I ? (I.foundPc || (I.pcs.length ? I.pcs[I.pcs.length - 1] : null)) : null;
        if (!pc) return null;
        try {
          const rr = await pc.getStats();
          let out = null;
          rr.forEach((s) => {
            if (s.type === "inbound-rtp" && s.kind === "video") out = { fd: s.framesDecoded, fdrop: s.framesDropped, frec: s.framesReceived, pl: s.packetsLost, jit: s.jitter ? +s.jitter.toFixed(3) : null, res: (s.frameWidth || 0) + "x" + (s.frameHeight || 0) };
          });
          return JSON.stringify({ ice: pc.iceConnectionState, conn: pc.connectionState, stats: out });
        } catch (e) { return null; }
      })()`);
      if (ps && ps !== "null") {
        const pp = JSON.parse(ps);
        sample.ice = pp.ice; sample.conn = pp.conn;
        if (pp.stats) {
          sample.pc = pp.stats;
          if (prevDrop !== null && pp.stats.fdrop !== undefined) {
            const d = pp.stats.fdrop - prevDrop;
            if (d > 0) { sample.droppedDelta = d; anomalies.push({ at: (now - T0) / 1000, kind: "FRAMES_DROPPED", detail: "+" + d + " frames dropped (decode)" }); }
          }
          if (pp.stats.fd !== undefined) prevDrop = pp.stats.fdrop;
        }
        if (lastIce !== null && pp.ice !== lastIce) { anomalies.push({ at: (now - T0) / 1000, kind: "ICE_STATE", detail: lastIce + "→" + pp.ice }); }
        if (lastConn !== null && pp.conn !== lastConn) { anomalies.push({ at: (now - T0) / 1000, kind: "CONN_STATE", detail: lastConn + "→" + pp.conn }); }
        lastIce = pp.ice; lastConn = pp.conn;
      }
    }
    line(sample);
    await sleep(intervalMs);
  }

  // ---- CDP events pendant la fenêtre ----
  const cdpIssues = cdpEvents.filter((e) => {
    if (e.t < T0) return false; // bruit de l'injection (fetch télémétrie au enable)
    if (e.method === "Runtime.exceptionThrown") return true;
    if (e.method === "Log.entryAdded") { const t = (e.params && e.params.entry && e.params.entry.text || "") + " " + (e.params && e.params.entry && e.params.entry.url || ""); return /error|fail/i.test(t); }
    if (e.method === "Network.loadingFailed") { const t = e.params && e.params.errorText || ""; return /fail|error/i.test(t) && /gssv|xbox/i.test(e.params && e.params.requestId || "x"); }
    return false;
  }).slice(0, 20);

  // ---- résumé ----
  console.log("\n=== RÉSUMÉ (" + (durationMs / 1000) + " s) ===");
  console.log("Anomalies : " + (anomalies.length ? "" : "AUCUNE") + (anomalies.length ? "" : " — session saine sur la fenêtre"));
  for (const a of anomalies) console.log("  ⚠ +" + a.at.toFixed(1) + "s " + a.kind + " : " + a.detail);
  if (cdpIssues.length) {
    console.log("Événements CDP notables (" + cdpIssues.length + ") :");
    for (const e of cdpIssues.slice(0, 5)) console.log("  · " + e.method + " @" + ((e.t - T0) / 1000).toFixed(1) + "s " + JSON.stringify(e.params).slice(0, 140));
  } else {
    console.log("Événements CDP notables : aucun (zéro exception JS, zéro échec réseau gssv)");
  }
  if (anomalies.length === 0 && cdpIssues.length === 0) console.log("✅ AUCUN ÉVÉNEMENT D'ÉCRAN NOIR OBSERVÉ — la vidéo a délivré des frames en continu (" + (prevPf || "?") + " présentées)");
  console.log("Log complet : " + outFile);
  log.end();
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("❌ " + e.message); process.exit(1); });
