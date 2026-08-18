#!/usr/bin/env node
/**
 * bench/preview-codec-probe.js — codec + stats brutes de la session preview
 * Usage : node bench/preview-codec-probe.js [--port=9222]
 */
const CDP_PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "--port=9222").split("=")[1]);
(async () => {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
  const targets = await r.json();
  const page = targets.find((t) => t.type === "page" && /xbox\.com/.test(t.url));
  if (!page) { console.error("pas de page xbox.com"); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  await new Promise((res) => (ws.onopen = res));
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = (expr) => send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }).then((r2) => r2.result.value);
  const out = await ev(`(async () => {
    const rtp = (() => { try { return RTCRtpReceiver.getCapabilities("video").codecs.map(c => c.mimeType + (c.sdpFmtpLine ? " [" + c.sdpFmtpLine.split(";")[0] + "]" : "")); } catch (e) { return "ERR " + e.message; } })();
    const pc = window.BX_EXPOSED?.peerConnection || (window.STATES && window.STATES.currentStream && window.STATES.currentStream.peerConnection);
    const report = pc ? await pc.getStats() : null;
    let inbound = null, codec = null;
    const codecs = new Map();
    if (report) {
      for (const st of report.values()) { if (st.type === "codec") codecs.set(st.id, st); if (st.type === "inbound-rtp" && st.kind === "video") inbound = st; }
    }
    if (inbound) { const c = codecs.get(inbound.codecId); if (c) codec = { mime: c.mimeType, fmtp: c.sdpFmtpLine }; }
    return {
      rtp,
      pcFound: !!pc,
      codec,
      raw: inbound ? { bytesReceived: inbound.bytesReceived, framesDecoded: inbound.framesDecoded, framesPerSecond: inbound.framesPerSecond, frameWidth: inbound.frameWidth, frameHeight: inbound.frameHeight, ssrc: inbound.ssrc } : null,
      localSdpHasAV1: pc && pc.localDescription && pc.localDescription.sdp.includes("AV1"),
      remoteSdpHasAV1: pc && pc.remoteDescription && pc.remoteDescription.sdp.includes("AV1"),
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
  ws.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
