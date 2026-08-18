#!/usr/bin/env node
/**
 * bench/sdp-inspect.js — inspecte le SDP (local + remote) de la session live
 * Usage : node bench/sdp-inspect.js [--port=9225]
 */
const CDP_PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "--port=9225").split("=")[1]);
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
  const out = await ev(`(() => {
    const pc = window.BX_EXPOSED?.peerConnection || (window.STATES && window.STATES.currentStream && window.STATES.currentStream.peerConnection);
    if (!pc) return { error: "pas de peerConnection" };
    const parse = (sdp) => {
      if (!sdp) return null;
      const lines = sdp.split("\\r\\n");
      const videoIdx = lines.findIndex(l => /^m=video /.test(l));
      const mline = lines[videoIdx];
      const payloads = mline ? mline.split(" ").slice(3) : [];
      const rtpmap = {};
      for (const l of lines) { const m = /^a=rtpmap:(\\d+) (\\S+)/.exec(l); if (m) rtpmap[m[1]] = m[2]; }
      return { mline, payloads: payloads.map(p => (rtpmap[p] || p + "?")), hasAV1: payloads.some(p => rtpmap[p] && /^AV1\\//.test(rtpmap[p])) };
    };
    return {
      local: parse(pc.localDescription && pc.localDescription.sdp),
      remote: parse(pc.remoteDescription && pc.remoteDescription.sdp),
      connState: pc.connectionState,
      patchInstalled: (() => {
        // détecter notre wrapper : le prototype setLocalDescription doit être différent de la native
        const native = RTCPeerConnection.prototype.setLocalDescription;
        return native.toString().length > 400 || /origSLD|no-op volontaire/.test(native.toString());
      })(),
    };
  })()`);
  console.log(JSON.stringify(out, null, 2));
  ws.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
