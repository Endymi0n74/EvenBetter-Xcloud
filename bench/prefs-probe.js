#!/usr/bin/env node
/**
 * bench/prefs-probe.js — sonde CDP du système de prefs du bundle (diagnostic
 * feature-datasaver) : getters disponibles, valeur maxBitrate/resolution,
 * round-trip setStreamPref.
 *
 * Usage : node bench/prefs-probe.js [--port=9225]
 */
const PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "--port=9225").split("=")[1]);

(async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/json`);
  const page = (await r.json()).find((t) => t.type === "page" && /xbox\.com/.test(t.url));
  if (!page) { console.error("pas de page xbox.com"); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  await new Promise((res) => (ws.onopen = res));
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = (expr) => send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, timeout: 5000 }).then((r2) => ({ v: r2.result ? r2.result.value : undefined, exc: r2.exceptionDetails ? (r2.exceptionDetails.exception || {}).description : null }));

  const out = {};
  for (const [label, expr] of [
    ["typeof getStreamPref", "typeof getStreamPref"],
    ["typeof setStreamPref", "typeof setStreamPref"],
    ["typeof getStreamPrefDefinition", "typeof getStreamPrefDefinition"],
    ["typeof setPref", "typeof setPref"],
  ]) {
    const res = await ev(expr);
    out[label] = res.exc || res.v;
  }
  const getBr = await ev(`(() => { try { return String(getStreamPref("stream.video.maxBitrate")); } catch (e) { return "ERR " + e.message; } })()`);
  out["get maxBitrate"] = getBr.exc || getBr.v;
  const getRes = await ev(`(() => { try { return String(getStreamPref("stream.video.resolution")); } catch (e) { return "ERR " + e.message; } })()`);
  out["get resolution"] = getRes.exc || getRes.v;
  const setBr = await ev(`(() => { try { setStreamPref("stream.video.maxBitrate", 10240000, "ui"); return "set ok"; } catch (e) { return "ERR " + e.message; } })()`);
  out["set maxBitrate 10M"] = setBr.exc || setBr.v;
  const getBr2 = await ev(`(() => { try { return String(getStreamPref("stream.video.maxBitrate")); } catch (e) { return "ERR " + e.message; } })()`);
  out["get maxBitrate après set"] = getBr2.exc || getBr2.v;
  const stored = await ev(`(() => { const o = JSON.parse(localStorage.getItem("BetterXcloud") || "{}"); return JSON.stringify({ br: o["stream.video.maxBitrate"], res: o["stream.video.resolution"] }); })()`);
  out["localStorage BetterXcloud"] = stored.exc || stored.v;
  // restauration 0
  await ev(`(() => { try { setStreamPref("stream.video.maxBitrate", 0, "ui"); return true; } catch (e) { return false; } })()`);

  console.log(JSON.stringify(out, null, 2));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
