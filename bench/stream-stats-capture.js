#!/usr/bin/env node
/**
 * bench/stream-stats-capture.js — capture les stats d'un stream live stable
 *
 * Usage : node bench/stream-stats-capture.js [--port=9225] [--seconds=20]
 *
 * Attache le CDP à la page xbox.com en cours (stream live), force la fenêtre
 * au premier plan (cycle minimiser→restaurer, recette documentée — un onglet
 * occlus throttle le rendu), puis échantillonne pendant N secondes :
 *   - codec effectif (getStats → codecId → mimeType), résolution, fps
 *   - bitrate réseau (delta bytesReceived sur les inbound-rtp)
 *   - decode time (delta totalDecodeTime) et frames dropped
 *   - métriques vidéo (readyState, videoWidth/Height, currentTime)
 * Sort : JSON sur stdout. Exit 0 si stats capturées.
 */
const CDP_PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "--port=9225").split("=")[1]);
const SECONDS = Number((process.argv.find((a) => a.startsWith("--seconds=")) || "--seconds=20").split("=")[1]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let BASE = null;
async function jsonList() {
  for (const host of ["[::1]", "127.0.0.1"]) {
    try {
      const r = await fetch(`http://${host}:${CDP_PORT}/json`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) { BASE = `http://${host}:${CDP_PORT}`; return r.json(); }
    } catch {}
  }
  throw new Error(`aucun CDP sur le port ${CDP_PORT}`);
}
function createCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws erreur")); });
  return {
    ready,
    send(method, params = {}) {
      return ready.then(() => new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }));
    },
    close() { try { ws.close(); } catch {} },
  };
}

async function evalIn(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error("EXCEPTION: " + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)));
  return r.result.value;
}

(async () => {
  const targets = await jsonList();
  const page = targets.find((t) => t.type === "page" && /xbox\.com/.test(t.url));
  if (!page) throw new Error("pas de page xbox.com — ouvre le stream d'abord");
  const cdp = createCdp(page.webSocketDebuggerUrl);
  await cdp.ready;

  // 1. Attendre une vidéo live (readyState >= 3)
  let videoState = null;
  for (let i = 0; i < 30; i++) {
    videoState = await evalIn(cdp, `(() => {
      const v = [...document.querySelectorAll("video")].sort((a,b) => b.videoWidth - a.videoWidth)[0];
      if (!v) return null;
      return { readyState: v.readyState, w: v.videoWidth, h: v.videoHeight, t: v.currentTime };
    })()`);
    if (videoState && videoState.readyState >= 3 && videoState.t > 0) break;
    await sleep(2000);
  }
  if (!videoState || videoState.readyState < 3) throw new Error("pas de stream live (video readyState=" + (videoState && videoState.readyState) + ")");

  // 2. Forcer le premier plan (cycle minimiser→restaurer — recette documentée)
  //    La page stream immersive du preview est en plein écran : repasser
  //    d'abord en « normal » sinon le minimize est refusé par Chrome.
  const { windowId } = await cdp.send("Browser.getWindowForTarget", { targetId: page.id });
  try { await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } }); await sleep(500); } catch {}
  try {
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
    await sleep(800);
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    await sleep(1500);
  } catch (e) { console.log("[warn] cycle fenêtre impossible : " + e.message); }
  const vis = await evalIn(cdp, `document.visibilityState`);
  if (vis !== "visible") console.log(`[warn] visibilityState=${vis} — rendu possiblement throttlé`);

  // 3. Échantillonner getStats sur SECONDS secondes
  const samples = [];
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < SECONDS * 1000) {
    const s = await evalIn(cdp, `(async () => {
      const pc = window.BX_EXPOSED?.peerConnection || (window.STATES && window.STATES.currentStream && window.STATES.currentStream.peerConnection);
      const conn = pc || [...window.__bxConnections || []][0];
      if (!conn) return null;
      const report = await conn.getStats();
      let inbound = null, codec = null;
      const codecs = new Map();
      for (const st of report.values()) {
        if (st.type === "codec") codecs.set(st.id, st);
        if (st.type === "inbound-rtp" && st.kind === "video") inbound = st;
      }
      if (!inbound) return null;
      const c = inbound.codecId ? codecs.get(inbound.codecId) : null;
      if (c) codec = c;
      const v = [...document.querySelectorAll("video")].sort((a,b) => b.videoWidth - a.videoWidth)[0] || {};
      const fmtp = codec && codec.sdpFmtpLine ? codec.sdpFmtpLine : null;
      const profile = fmtp && /profile-level-id=([0-9a-f]{6})/i.exec(fmtp) ? /profile-level-id=([0-9a-f]{6})/i.exec(fmtp)[1] : null;
      return {
        ts: Date.now(),
        codec: codec ? codec.mimeType : "?",
        profileLevelId: profile,
        bytesReceived: inbound.bytesReceived,
        framesDecoded: inbound.framesDecoded,
        framesDropped: inbound.framesDropped,
        framesPerSecond: inbound.framesPerSecond,
        frameWidth: inbound.frameWidth,
        frameHeight: inbound.frameHeight,
        totalDecodeTime: inbound.totalDecodeTime,
        vw: v.videoWidth, vh: v.videoHeight,
        droppedVideoFrames: v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality().droppedVideoFrames : undefined,
      };
    })()`);
    if (s) samples.push(s);
    await sleep(1000);
  }
  if (samples.length < 2) throw new Error("pas assez d'échantillons getStats");

  // 4. Agréger
  const first = samples[0], lastS = samples[samples.length - 1];
  const dt = (lastS.ts - first.ts) / 1000;
  const bitrate = ((lastS.bytesReceived - first.bytesReceived) * 8) / dt / 1e6;
  const decodeMsPerFrame = (lastS.totalDecodeTime - first.totalDecodeTime) / (lastS.framesDecoded - first.framesDecoded) * 1000;
  const summary = {
    codec: lastS.codec,
    profileLevelId: lastS.profileLevelId,
    resolution: `${lastS.frameWidth || lastS.vw}×${lastS.frameHeight || lastS.vh}`,
    fps: lastS.framesPerSecond,
    bitrateMbps: +bitrate.toFixed(1),
    decodeMsPerFrame: +decodeMsPerFrame.toFixed(3),
    framesDecodedDelta: lastS.framesDecoded - first.framesDecoded,
    framesDroppedDelta: lastS.framesDropped - first.framesDropped,
    videoElement: { w: lastS.vw, h: lastS.vh },
    duration: +dt.toFixed(1),
    samples: samples.length,
    visibility: vis,
  };
  console.log(JSON.stringify(summary, null, 2));
  cdp.close();
})().catch((e) => { console.error("[capture] " + e.message); process.exit(1); });
