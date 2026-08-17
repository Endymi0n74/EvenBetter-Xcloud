#!/usr/bin/env node
/*
 * render-check.js — vérifie le RENDU EFFECTIF de la config réécrite (P3+P2)
 * sur la session live : résolution décodée (video.videoWidth/videoHeight), FPS
 * réel (sampling getVideoPlaybackQuality), état session (connectionState,
 * _bxKeepAliveWrapped, enableVibration), et — si le log d'interception est
 * fourni — la chaîne CDP [P3]→[P2] pour la session en cours.
 *
 * Validé en réel le 17 août (session CF49BC01) : chaîne [P3#3]→[P2#3],
 * vidéo 1920×1080 décodée, 59,98 fps / 0 dropped (3 s) — voir
 * port/e2e-cdp.md « Vérification rendu effectif ».
 *
 * Usage :
 *   node bench/preview/render-check.js [port] [--sample=S] [--min-width=W]
 *       [--min-height=H] [--min-fps=F] [--chain=<log intercept-session>]
 *       [--json]
 *   node bench/preview/render-check.js --self-test    # sans navigateur
 *
 * Gates (exit 1 si rouge) :
 *   A — résolution décodée ≥ --min-width×--min-height (défaut 1920×1080)
 *   B — FPS mesuré ≥ --min-fps (défaut 50)
 *   C — frames dropped ≤ 5 % de l'échantillon
 *   D — (si --chain) chaîne [P3]→[P2] (même #N) trouvée ET GUID de la
 *       /configuration == GUID de la session live
 */
"use strict";
const fs = require("fs");
const { chromium } = require("playwright");

// ---------- parsing de la chaîne CDP (pur, testable sans navigateur) ----------
// Lignes réelles d'intercept-session.js :
//   [P3#3 13:08:30] play réécrit → osName=tizen (original:windows) + ... (.../v5/sessions/cloud/play)
//   [P2#3 13:08:39] /configuration réécrite → inputConfiguration,... (.../v5/sessions/cloud/CF49BC01-...)
function parseChain(logText) {
  const out = { p3: [], p2: [] };
  for (const line of String(logText || "").split(/\r?\n/)) {
    let m = line.match(/\[P3#(\d+)\s+[\d:]+]\s+play réécrit → osName=(\w+)/);
    if (m) { out.p3.push({ n: parseInt(m[1], 10), osName: m[2] }); continue; }
    m = line.match(/\[P2#(\d+)\s+[\d:]+]\s+\/configuration réécrite .*v5\/sessions\/cloud\/([0-9A-F-]{8,})/);
    if (m) { out.p2.push({ n: parseInt(m[1], 10), guid: m[2] }); }
  }
  return out;
}

// Dernier couple P3/P2 de même index : P3 antérieur à P2, P3 en tizen.
function lastPair(chain) {
  for (let i = chain.p3.length - 1; i >= 0; i--) {
    const p3 = chain.p3[i];
    const p2 = chain.p2.find((x) => x.n === p3.n);
    if (p2) return { p3, p2 };
  }
  return null;
}

// ---------- gates (purs) ----------
function gates(meas, opts) {
  const minW = opts["min-width"] ?? 1920;
  const minH = opts["min-height"] ?? 1080;
  const minFps = opts["min-fps"] ?? 50;
  const resOk = meas.width >= minW && meas.height >= minH;
  const fpsOk = meas.fps >= minFps;
  const dropOk = meas.droppedRatio !== null && meas.droppedRatio <= 0.05;
  return {
    A: { ok: resOk, label: `résolution ${meas.width}×${meas.height} ≥ ${minW}×${minH}` },
    B: { ok: fpsOk, label: `fps ${meas.fps != null ? meas.fps.toFixed(1) : "n/a"} ≥ ${minFps}` },
    C: { ok: dropOk, label: `dropped ${meas.droppedRatio != null ? (meas.droppedRatio * 100).toFixed(1) + "%" : "n/a"} ≤ 5 %` },
  };
}

function chainGate(chain, liveGuid) {
  const pair = lastPair(chain);
  if (!pair) return { ok: false, label: "aucun couple [P3]/[P2] de même #N" };
  // le log d'intercept-session tronque les URLs à 90 chars (guid coupé) : on
  // compare le PRÉFIXE `XXXXXXXX-XXXX-XXXX` (13 chars, unique par session).
  const prefix = (g) => (g || "").slice(0, 13);
  const guidOk = prefix(pair.p2.guid) === prefix(liveGuid);
  return {
    ok: pair.p3.osName === "tizen" && guidOk,
    label: `[P3#${pair.p3.n}] osName=${pair.p3.osName} + [P2#${pair.p2.n}] GUID ${pair.p2.guid} ${guidOk ? "==" : "!="} session ${liveGuid} (préfixe 13)`,
  };
}

// ---------- self-test (pas de navigateur) ----------
function selfTest() {
  const log = [
    "[intercept] P3 résolution=1080p-hq · P2 vibration=on",
    "[P3#1 12:43:28] play réécrit → osName=tizen (original:windows) + x-ms-device-info (https://…/v5/sessions/cloud/play)",
    "[P2#1 12:43:35] /configuration réécrite → inputConfiguration,nqiConfiguration (https://…/v5/sessions/cloud/94F0F80A-7507-407C-A4D4-48A15FB747B4)",
    "[P3#3 13:08:30] play réécrit → osName=tizen (original:windows) + x-ms-device-info (https://…/v5/sessions/cloud/play)",
    "[P2#3 13:08:39] /configuration réécrite → inputConfiguration,nqiConfiguration (https://…/v5/sessions/cloud/CF49BC01-4238-4104-9B10-AA3C96CC746B)",
  ].join("\n");
  const chain = parseChain(log);
  const checks = [
    ["parseChain : 2 P3", chain.p3.length === 2],
    ["parseChain : 2 P2", chain.p2.length === 2],
    ["lastPair → #3", lastPair(chain).p3.n === 3 && lastPair(chain).p2.n === 3],
    ["chainGate GUID tronqué (log 90 chars) → ok", chainGate(chain, "CF49BC01-4238-4104-9B10-AA3C96CC746B").ok === true],
    ["chainGate GUID KO → ko", chainGate(chain, "AUTRE-GUID").ok === false],
    ["gates : 1080p60 sans drop → AAA", (() => { const g = gates({ width: 1920, height: 1080, fps: 59.9, droppedRatio: 0 }, {}); return g.A.ok && g.B.ok && g.C.ok; })()],
    ["gates : 720p → A rouge", gates({ width: 1280, height: 720, fps: 60, droppedRatio: 0 }, {}).A.ok === false],
    ["gates : 30 fps → B rouge", gates({ width: 1920, height: 1080, fps: 30, droppedRatio: 0 }, {}).B.ok === false],
    ["gates : 8 % dropped → C rouge", gates({ width: 1920, height: 1080, fps: 60, droppedRatio: 0.08 }, {}).C.ok === false],
  ];
  let fail = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? "✅" : "❌"} ${label}`);
    if (!ok) fail++;
  }
  console.log(fail === 0 ? "\nself-test OK — parsing + gates stables" : `\n${fail} échec(s)`);
  process.exit(fail === 0 ? 0 : 1);
}

// ---------- mode réel ----------
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();

  const port = (args.find((a) => !a.startsWith("--")) || "9222");
  const opt = (name, def) => {
    const a = args.find((x) => x.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : def;
  };
  const sample = parseInt(opt("sample", "3"), 10);
  const chainPath = opt("chain", null);
  const wantJson = args.includes("--json");
  const gatesOpts = {
    "min-width": parseInt(opt("min-width", "1920"), 10),
    "min-height": parseInt(opt("min-height", "1080"), 10),
    "min-fps": parseInt(opt("min-fps", "50"), 10),
  };

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const ctx = browser.contexts()[0];
    const page = ctx.pages().find((p) => p.url().includes("play.xbox.com/stream"));
    if (!page) { console.error("aucune page stream ouverte — lance un stream d'abord"); process.exit(1); }

    const res = await page.evaluate(async (sampleS) => {
      const v = document.querySelector("video");
      if (!v) return { error: "pas de <video> sur la page" };

      // résolution décodée (la vraie, pas l'upscale canvas)
      const width = v.videoWidth, height = v.videoHeight;

      // FPS par sampling getVideoPlaybackQuality
      let fps = null, droppedRatio = null;
      if (v.getVideoPlaybackQuality) {
        const q1 = v.getVideoPlaybackQuality();
        const t1 = performance.now();
        await new Promise((r) => setTimeout(r, sampleS * 1000));
        const q2 = v.getVideoPlaybackQuality();
        const dt = (performance.now() - t1) / 1000;
        const frames = q2.totalVideoFrames - q1.totalVideoFrames;
        const dropped = q2.droppedVideoFrames - q1.droppedVideoFrames;
        if (dt > 0) { fps = frames / dt; droppedRatio = frames > 0 ? dropped / frames : null; }
      }

      // session live (fibers React) + config effective
      const getFiber = (node) => { const k = Object.keys(node).find((x) => x.startsWith("__reactFiber$")); return k ? node[k] : null; };
      const nameOf = (f) => (f.type && (f.type.name || f.type.displayName)) || "tag" + f.tag;
      const rootFiber = getFiber(document.getElementById("root") || document.body);
      let session = null, sessionRequest = null;
      const queue = rootFiber ? [rootFiber] : [];
      let guard = 0;
      while (queue.length && guard++ < 12000) {
        const f = queue.shift();
        if (!f) continue;
        if (nameOf(f) === ".Connection") {
          let st = f.memoizedState, steps = 0;
          while (st && steps++ < 8) {
            const d = st.memoizedState && st.memoizedState.data;
            if (d && typeof d === "object") {
              if (!session && d._session && typeof d._session.sendKeepAlive === "function") session = d._session;
              if (!sessionRequest && d._sessionRequest) sessionRequest = d._sessionRequest;
            }
            st = st.next;
          }
          if (session && sessionRequest) break;
        }
        if (f.child) queue.push(f.child);
        if (f.sibling) queue.push(f.sibling);
      }

      const out = {
        url: location.href.slice(0, 90),
        video: { ready: v.readyState, paused: v.paused, width, height },
        fps: { value: fps, droppedRatio, sampleSeconds: sampleS },
        gamepadsConnected: (navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean).length : -1),
      };
      if (session) {
        out.session = {
          connectionState: session._connectionState,
          wrapped: session._bxKeepAliveWrapped === true,
          // significatif uniquement si une manette est connectée (le SDK met
          // enableVibration à false sans gamepad — vérifié le 17 août, session
          // CF49BC01 : 0 manette → false ; sessions 1-2 avec manette → true)
          enableVibration: !!(session._configuration && session._configuration.inputConfiguration && session._configuration.inputConfiguration.enableVibration),
        };
      }
      if (sessionRequest && sessionRequest.sessionPath) out.sessionPath = sessionRequest.sessionPath;
      return out;
    }, sample);

    if (res.error) { console.error(res.error); process.exit(1); }

    // chaîne CDP depuis le log d'interception (optionnel)
    let chain = null, gateD = null;
    if (chainPath) {
      if (!fs.existsSync(chainPath)) { console.error(`log d'interception absent : ${chainPath}`); process.exit(1); }
      chain = parseChain(fs.readFileSync(chainPath, "utf8"));
      const liveGuid = (res.sessionPath || "").split("/").pop();
      gateD = chainGate(chain, liveGuid);
    }

    const g = gates({ width: res.video.width, height: res.video.height, fps: res.fps.value, droppedRatio: res.fps.droppedRatio }, gatesOpts);
    const report = {
      date: new Date().toISOString(),
      url: res.url,
      video: res.video,
      fps: res.fps,
      session: res.session || null,
      sessionPath: res.sessionPath || null,
      chain: chain ? { p3: chain.p3.length, p2: chain.p2.length, pair: lastPair(chain) } : null,
      gates: {
        A: g.A, B: g.B, C: g.C,
        ...(gateD ? { D: gateD } : {}),
      },
      verdict: g.A.ok && g.B.ok && g.C.ok && (!gateD || gateD.ok) ? "RENDU OK" : "GATE ROUGE",
    };

    if (wantJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`== render-check : ${report.url} — ${report.date} ==`);
      console.log(`  vidéo : ${res.video.width}×${res.video.height} (décodé, ready=${res.video.ready} paused=${res.video.paused})`);
      if (res.fps.value != null) {
        console.log(`  fps : ${res.fps.value.toFixed(1)} (${(res.fps.droppedRatio ?? 0) * 100} % dropped, échantillon ${sample}s)`);
      }
      if (res.session) {
        console.log(`  session : ${res.session.connectionState} · wrapped=${res.session.wrapped} · enableVibration=${res.session.enableVibration}${res.gamepadsConnected >= 0 ? ` (manettes: ${res.gamepadsConnected})` : ""}`);
      }
      if (res.sessionPath) console.log(`  sessionPath : ${res.sessionPath}`);
      for (const [k, gate] of Object.entries(report.gates)) {
        console.log(`  gate ${k} : ${gate.ok ? "OK" : "ROUGE"} — ${gate.label}`);
      }
      console.log(`\n  verdict : ${report.verdict}`);
      if (report.verdict === "GATE ROUGE") process.exit(1);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
