#!/usr/bin/env node
/**
 * bench/av1-probe.js — sonde le support AV1 du navigateur dans la page xbox
 *
 * Usage : node bench/av1-probe.js [--port=9225]
 * Exige un Edge CDP avec l'extension stable chargée (session www.xbox.com/play).
 *
 * Évalue dans le contexte de la page :
 *   1. RTCRtpReceiver.getCapabilities("video").codecs → mimeTypes (AV1 ?)
 *   2. MediaCapabilities.decodingInfo AV1 (1080p60 @ 20 Mbps) → supported +
 *      powerEfficient (hardware ?)
 *   3. Les options du setting stream.video.codecProfile (via BX_EXPOSED si dispo)
 *   4. getSupportedCodecProfiles() du bundle (mémoïsé)
 */
const CDP_PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "--port=9225").split("=")[1]);

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

(async () => {
  const targets = await jsonList();
  const page = targets.find((t) => t.type === "page" && /xbox\.com/.test(t.url));
  if (!page) {
    console.error("pas de page xbox.com trouvée — ouvre www.xbox.com/play d'abord");
    process.exit(1);
  }
  const cdp = createCdp(page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Runtime.enable");

  const expr = `(async () => {
    const out = { url: location.href, ua: navigator.userAgent };
    // 1. Codecs offerts par la pile WebRTC
    try {
      out.rtpCodecs = RTCRtpReceiver.getCapabilities("video").codecs.map(c => c.mimeType);
    } catch (e) { out.rtpCodecs = "ERR " + e.message; }
    // 2. MediaCapabilities AV1 (fichier) + WebRTC (recevoir)
    out.mc = {};
    for (const [k, cfg] of Object.entries({
      av1_1080p60_file: { type: "file", video: { contentType: 'video/webm; codecs="av01.0.08M.08"', width: 1920, height: 1080, bitrate: 20000000, framerate: 60 } },
      av1_1440p60_file: { type: "file", video: { contentType: 'video/webm; codecs="av01.0.08M.08"', width: 2560, height: 1440, bitrate: 30000000, framerate: 60 } },
      av1_webrtc: { type: "webrtc", video: { contentType: "video/AV1", width: 1920, height: 1080, bitrate: 20000000, framerate: 60 } },
    })) {
      try { out.mc[k] = await navigator.mediaCapabilities.decodingInfo(cfg); }
      catch (e) { out.mc[k] = "ERR " + e.message; }
    }
    // 3. Setting codecProfile (via le storage du bundle si exposé)
    try {
      const p = window.BX_EXPOSED && window.BX_EXPOSED.getSettings ? await window.BX_EXPOSED.getSettings() : null;
      out.settingsApi = !!p;
      if (p) {
        const s = p.find(x => x.id === "stream.video.codecProfile");
        out.codecProfileSetting = s ? { value: s.value, options: s.options } : "absent";
      }
    } catch (e) { out.codecProfileSetting = "ERR " + e.message; }
    // 4. getSupportedCodecProfiles du bundle (si accessible via la fenêtre)
    try {
      out.bundleCodecProfiles = typeof window.getSupportedCodecProfiles === "function" ? window.getSupportedCodecProfiles() : "non exposé";
    } catch (e) { out.bundleCodecProfiles = "ERR " + e.message; }
    return out;
  })()`;

  const r = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    console.error("EXCEPTION:", JSON.stringify(r.exceptionDetails, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(r.result.value, null, 2));
  cdp.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
