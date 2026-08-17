/*
 * live-profile.js — profil CPU du runtime en session réelle (stable & preview)
 *
 * Attache le **CDP Profiler** à la page de stream (xbox.com/play OU
 * play.xbox.com) pendant N secondes de streaming réel, agrège le **self time**
 * par fonction (échantillonnage 100 µs) et identifie la dominante runtime.
 *
 * Complète les micro-benchmarks (hotloops.js / startup-profile.js) : il voit
 * la pipeline complète d'une session vivante (gestion vidéo, handlers
 * d'input, stats, DOM du stream UI) que les classes extraites ne couvrent
 * pas.
 *
 * Setup : la page doit tourner AVEC le build à profiler injecté (monde MAIN,
 * document-start — l'injection par addScriptToEvaluateOnNewDocument casse le
 * realm, cf. MEMORY « hookActif en réel ») :
 *   - stable : Tampermonkey sur le profil normal (better-xcloud.user.js,
 *     @match www.xbox.com/.../play) OU une extension content_scripts
 *     world:MAIN calquée sur .edge-inject avec matches www.xbox.com (le
 *     .edge-inject actuel ne couvre QUE play.xbox.com) ;
 *   - preview : profil edge-cdp existant (extension .edge-inject).
 *
 * Usage :
 *   node bench/live-profile.js [port] [--duration=10] [--top=20] [--json]
 *   node bench/live-profile.js --self-test   # agrégation, sans navigateur
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

// entrées de bruit exclues du classement (harnais/DevTools/natif) — même
// convention que startup-profile.js
const NOISE = new Set([
  "(idle)", "(program)", "(garbage collector)", "(root)", "(anonymous)",
  "tryRun", "InjectedScript", "UtilityScript", "_setupHitTargetInterceptors",
  "(new Promise)",
]);

// ---------------- logique pure (exportée pour le self-test) ----------------
function aggregateProfile(profile) {
  const nodes = profile.nodes || [];
  const samples = profile.samples || [];
  const deltas = profile.timeDeltas || [];
  const byId = new Map();
  for (const n of nodes) byId.set(n.id, n);
  const self = new Map(); // functionName -> {us, samples, url}
  let totalUs = 0;
  for (let i = 0; i < samples.length; i++) {
    const node = byId.get(samples[i]);
    const dt = i < deltas.length ? deltas[i] : 0;
    totalUs += dt;
    if (!node) continue;
    const cf = node.callFrame || {};
    const name = cf.functionName || "(anonymous)";
    let e = self.get(name);
    if (!e) { e = { us: 0, samples: 0, url: (cf.url || "").slice(0, 60) }; self.set(name, e); }
    e.us += dt;
    e.samples++;
  }
  const rows = [];
  for (const [name, e] of self) {
    if (NOISE.has(name)) continue;
    rows.push({ name, us: e.us, samples: e.samples, url: e.url });
  }
  rows.sort((a, b) => b.us - a.us);
  return { totalUs, rows };
}

async function main() {
  const args = process.argv.slice(2);
  const port = (args.find((a) => a.startsWith("--port=")) || args[0] || "9222").replace("--port=", "");
  const duration = parseInt((args.find((a) => a.startsWith("--duration=")) || "--duration=10").split("=")[1], 10);
  const top = parseInt((args.find((a) => a.startsWith("--top=")) || "--top=20").split("=")[1], 10);
  const json = args.includes("--json");

  if (args.includes("--self-test")) {
    // profil synthétique : 3 fonctions, 6 échantillons connus
    const profile = {
      nodes: [
        { id: 1, callFrame: { functionName: "(root)", url: "" } },
        { id: 2, callFrame: { functionName: "updateFrame", url: "https://xbox/stream.js" } },
        { id: 3, callFrame: { functionName: "collect", url: "https://xbox/stats.js" } },
        { id: 4, callFrame: { functionName: "(idle)", url: "" } },
      ],
      samples: [2, 3, 4, 2, 2, 3],
      timeDeltas: [100, 50, 200, 100, 100, 50],
    };
    const { totalUs, rows } = aggregateProfile(profile);
    const checks = [
      ["total", totalUs === 600],
      ["updateFrame", rows.find((r) => r.name === "updateFrame")?.us === 300],
      ["collect", rows.find((r) => r.name === "collect")?.us === 100],
      ["idle exclu", !rows.find((r) => r.name === "(idle)")],
      ["ordre", rows[0] && rows[0].name === "updateFrame"],
    ];
    for (const [name, ok] of checks) {
      if (!ok) { console.error(`SELF-TEST FAIL: ${name}`); process.exit(1); }
    }
    console.log("SELF-TEST OK");
    process.exit(0);
  }

  const tabs = await getJSON(`http://127.0.0.1:${port}/json`);
  const page = tabs.find(
    (t) => t.type === "page" && (t.url.includes("xbox.com") && t.url.includes("/play") || t.url.includes("play.xbox.com"))
  );
  if (!page) { console.error("[live-profile] aucune page de stream (www.xbox.com/*/play* ou play.xbox.com) — ouvre le stream d'abord"); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = {};
  const send = (method, params) => {
    id++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending[id] = { resolve, reject };
      setTimeout(() => { if (pending[id]) { delete pending[id]; reject(new Error("timeout " + method)); } }, 60000);
    });
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending[m.id]) { pending[m.id].resolve(m.result); delete pending[m.id]; }
  };
  await new Promise((r) => (ws.onopen = r));

  // pré-vérification : le stream est-il vivant ?
  const pre = await send("Runtime.evaluate", {
    expression: `(() => {
      const v = document.querySelector("video");
      let q = null;
      try { q = { f: v.getVideoPlaybackQuality().totalVideoFrames, d: v.getVideoPlaybackQuality().droppedVideoFrames }; } catch (e) {}
      return JSON.stringify({ url: location.href, video: v ? { rs: v.readyState, paused: v.paused, w: v.videoWidth, h: v.videoHeight } : null, q });
    })()`,
    returnByValue: true,
  });
  const st = JSON.parse(pre.result.value);
  const streaming = st.video && st.video.rs >= 2 && st.video.paused === false;
  if (!streaming) {
    console.warn(`[live-profile] ⚠️ vidéo ${st.video ? "rs=" + st.video.rs + " paused=" + st.video.paused : "absente"} — le profil capturera une page SANS stream actif`);
  }

  await send("Profiler.enable");
  await send("Profiler.start", { samplingInterval: 100 });
  const t0 = Date.now();
  console.log(`[live-profile] profilage ${duration}s sur ${page.url.slice(0, 70)}… (${new Date().toLocaleTimeString("fr-FR")})`);
  await new Promise((r) => setTimeout(r, duration * 1000));
  const res = await send("Profiler.stop");
  const profiledSec = (Date.now() - t0) / 1000;

  const { totalUs, rows } = aggregateProfile(res.profile);
  const topRows = rows.slice(0, top);

  if (json) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(), url: page.url, profiledSec: profiledSec.toFixed(1),
      streamState: st, totalMs: (totalUs / 1000).toFixed(1),
      dominant: topRows[0] ? { name: topRows[0].name, pct: ((topRows[0].us / totalUs) * 100).toFixed(1) } : null,
      top: topRows.map((r) => ({ name: r.name, ms: (r.us / 1000).toFixed(2), pct: ((r.us / totalUs) * 100).toFixed(1), url: r.url })),
    }, null, 1));
  } else {
    console.log(`=== Profil runtime ${profiledSec.toFixed(1)}s — ${page.url.slice(0, 60)} ===`);
    console.log(`  total profilé : ${(totalUs / 1000).toFixed(1)} ms · stream : ${streaming ? "ACTIF (" + (st.video.w || "?") + "x" + (st.video.h || "?") + ", " + (st.q && st.q.f || 0) + " frames)" : "INACTIF ⚠️"}`);
    if (topRows[0]) {
      const d = topRows[0];
      console.log(`  DOMINANT : ${d.name} — ${(d.us / 1000).toFixed(1)} ms (${((d.us / totalUs) * 100).toFixed(1)} % du temps profilé)`);
    }
    console.log("  top par self time :");
    topRows.forEach((r, i) => {
      console.log(`    ${String(i + 1).padStart(2)}. ${r.name.padEnd(40)} ${(r.us / 1000).toFixed(2).padStart(7)} ms  ${((r.us / totalUs) * 100).toFixed(1).padStart(5)} %  ${r.url.slice(0, 40)}`);
    });
    const unattributed = totalUs - rows.reduce((a, r) => a + r.us, 0);
    console.log(`  non-attribué (natif/GC/noise) : ${(unattributed / 1000).toFixed(1)} ms (${((unattributed / totalUs) * 100).toFixed(1)} %)`);
  }
  ws.close();
  process.exit(0);
}

module.exports = { aggregateProfile };

main().catch((e) => { console.error(e.message); process.exit(1); });
