/*
 * bitrate-check.js — mesure le bitrate vidéo/audio d'une session live (A/B P3)
 *
 * Localise la session SDK dans les fibers React (locator check-wrap), récupère
 * le RTCPeerConnection via session.streamStats.stream.peerConnection, et
 * échantillonne getStats() deux fois sur N secondes → bitrate vidéo/audio
 * (Δbytes×8/Δt) + fps + résolution + qualité (qpSum). Complète render-check.js
 * (qui ne mesure que résolution/FPS) pour le comparatif tizen vs natif.
 *
 * Usage :
 *   node bench/preview/bitrate-check.js [port] [--sample=12] [--json]
 *   node bench/preview/bitrate-check.js --self-test   # sans navigateur
 */
"use strict";

const http = require("http");

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => {
          try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
        });
      })
      .on("error", reject);
  });
}

const LOCATOR = `(() => {
  const getFiber = (node) => {
    const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
    return key ? node[key] : null;
  };
  const nameOf = (f) =>
    (f.type && (f.type.name || f.type.displayName)) ||
    (f.elementType && f.elementType.name) ||
    "tag" + f.tag;
  const rootFiber = getFiber(document.getElementById("root") || document.body);
  let session = null;
  const queue = rootFiber ? [rootFiber] : [];
  let guard = 0;
  while (queue.length && guard++ < 12000) {
    const f = queue.shift();
    if (!f) continue;
    let st = f.memoizedState;
    let steps = 0;
    while (st && steps++ < 8) {
      const d = st.memoizedState && st.memoizedState.data;
      if (d && typeof d === "object") {
        const scan = (obj) => {
          if (obj && typeof obj === "object" && typeof obj.sendKeepAlive === "function" && typeof obj.onServerDisconnectMessage === "function") {
            session = obj; return true;
          }
          return false;
        };
        if (!scan(d)) {
          if (!(d._session && scan(d._session))) {
            if (!(d._sessionRequest && scan(d._sessionRequest))) {
              for (const k of Object.getOwnPropertyNames(d)) if (scan(d[k])) break;
            }
          }
        }
      }
      if (session) break;
      st = st.next;
    }
    if (session) break;
    if (f.child) queue.push(f.child);
    if (f.sibling) queue.push(f.sibling);
  }
  return session;
})()`;

const SNAP = `(() => {
  const session = ${LOCATOR};
  if (!session || !session.streamStats || !session.streamStats.stream) return JSON.stringify({ error: "no session" });
  const pc = session.streamStats.stream.peerConnection;
  if (!pc) return JSON.stringify({ error: "no pc" });
  return pc.getStats().then((st) => {
    const rows = {};
    st.forEach((s) => {
      if (s.type === "inbound-rtp" && s.kind) {
        rows[s.kind] = { bytes: s.bytesReceived || 0, fps: s.framesPerSecond, w: s.frameWidth, h: s.frameHeight, qp: s.qpSum, pkts: s.packetsReceived };
      } else if (s.type === "inbound-rtp") {
        rows.total = (rows.total || 0) + (s.bytesReceived || 0);
      }
    });
    const coll = session.streamStats.ongoingAudioVideoStatsCollection;
    const arr = coll && coll.list ? Array.from(coll.list) : [];
    const last = arr[arr.length - 1];
    let sdk = null;
    if (typeof last === "string") {
      try { const p = JSON.parse(last); sdk = { keys: Object.keys(p).slice(0, 25) }; } catch (e) { sdk = { raw: last.slice(0, 120) }; }
    } else if (last && typeof last === "object") {
      sdk = { keys: Object.keys(last).slice(0, 25) };
    }
    return JSON.stringify({ pc: pc.connectionState, rows, sdk, sdkCount: arr.length });
  });
})()`;

async function main() {
  const args = process.argv.slice(2);
  const port = (args.find((a) => a.startsWith("--port=")) || args[0] || "9222").replace("--port=", "");
  const sample = parseInt((args.find((a) => a.startsWith("--sample=")) || "--sample=12").split("=")[1], 10);
  const json = args.includes("--json");

  if (args.includes("--self-test")) {
    // gates : locator syntax + parsing du snapshot (sans navigateur)
    const checks = [
      ["locator", LOCATOR.includes("onServerDisconnectMessage") && LOCATOR.includes("sendKeepAlive")],
      ["snap", SNAP.includes("getStats") && SNAP.includes("inbound-rtp")],
      ["sample", Number.isFinite(sample) && sample >= 3 && sample <= 120],
    ];
    for (const [name, ok] of checks) {
      if (!ok) { console.error(`SELF-TEST FAIL: ${name}`); process.exit(1); }
    }
    console.log("SELF-TEST OK");
    process.exit(0);
  }

  const tabs = await getJSON(`http://127.0.0.1:${port}/json`);
  const page = tabs.find((t) => t.type === "page" && t.url.includes("play.xbox.com/stream"));
  if (!page) { console.error("[bitrate] aucune page stream ouverte"); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = {};
  const send = (method, params) => {
    id++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending[id] = { resolve, reject };
      setTimeout(() => { if (pending[id]) { delete pending[id]; reject(new Error("timeout " + method)); } }, 25000);
    });
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending[m.id]) { pending[m.id].resolve(m.result); delete pending[m.id]; }
  };
  await new Promise((r) => (ws.onopen = r));

  const t0 = Date.now();
  const r1 = await send("Runtime.evaluate", { expression: SNAP, awaitPromise: true, returnByValue: true });
  if (!r1.result || !r1.result.value) {
    console.error("[bitrate] snapshot 1 échoué:", JSON.stringify(r1.exceptionDetails || {}).slice(0, 200));
    process.exit(1);
  }
  const s1 = JSON.parse(r1.result.value);
  await new Promise((r) => setTimeout(r, sample * 1000));
  const r2 = await send("Runtime.evaluate", { expression: SNAP, awaitPromise: true, returnByValue: true });
  const s2 = JSON.parse(r2.result.value);
  const dt = (Date.now() - t0) / 1000;

  const out = { ts: new Date().toISOString(), sampleSec: dt.toFixed(1), pc: s1.pc };
  out.flows = {};
  if (s1.rows && s2.rows) {
    for (const kind of Object.keys(s1.rows)) {
      if (kind === "total") continue;
      const a = s1.rows[kind], b = s2.rows[kind];
      if (b && a && b.bytes > a.bytes) {
        out.flows[kind] = {
          kbps: Math.round(((b.bytes - a.bytes) * 8) / dt / 1000),
          fps: b.fps, res: b.w ? b.w + "x" + b.h : null, pkts: b.pkts,
          qpDelta: b.qp && a.qp ? b.qp - a.qp : null,
        };
      }
    }
  }
  out.sdk = { count: s2.sdkCount, lastKeys: s2.sdk ? s2.sdk.keys : null };

  if (json) {
    console.log(JSON.stringify(out, null, 1));
  } else {
    console.log(`== bitrate-check : ${page.url.slice(0, 60)} — ${out.ts} ==`);
    console.log(`  pc : ${out.pc} · échantillon ${out.sampleSec}s`);
    for (const kind of Object.keys(out.flows || {})) {
      const f = out.flows[kind];
      console.log(`  ${kind} : ${f.kbps} kbps · ${f.fps} fps · ${f.res || "?"} · ${f.pkts} pkts · Δqp ${f.qpDelta}`);
    }
    if (!Object.keys(out.flows || {}).length) console.log("  (aucun flux mesurable — session en vie ?)");
    console.log(`  sdk stats : ${out.sdk.count} entrées · dernières clés: ${out.sdk.lastKeys ? out.sdk.lastKeys.join(",") : "n/a"}`);
  }
  ws.close();
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
