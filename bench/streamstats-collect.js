/*
 * streamstats-collect.js — mesure StreamStatsCollector.collect() (tick 1 Hz)
 *
 * Chiffre le gain du patch 9 (collect() en UN seul parcours du RTCStatsReport
 * au lieu de deux) : extrait la classe StreamStatsCollector de perf10 et du
 * build, l'exécute en vm sur un **report synthétique** (transport +
 * candidate-pairs + candidates + inbound-rtp vidéo/audio + outbound-rtp +
 * codecs + tracks, "centaines d'entrées" comme un report réel), et mesure le
 * coût par tick (warmup 2 phases + gc, 3 passes, médianes).
 *
 * Le collect() alterne deux variantes de la stat vidéo (bytes/decoded
 * incrémentés) pour exercer le chemin bitrate/decode (lastVideoStat).
 *
 * Usage :
 *   node bench/streamstats-collect.js <perf10.js> <build.js> [--passes=3]
 *       [--iters=2000] [--entries=265] [--json]
 *   node bench/streamstats-collect.js --self-test   # extraction + report, sans build
 */
"use strict";

const fs = require("fs");
const vm = require("vm");
const { performance } = require("perf_hooks");

// ---------------- logique pure (exportée pour le self-test) ----------------

// extrait le corps de la classe minifiée (une ligne, suivie de la classe StreamStats)
function extractCollector(src) {
  const re = /class StreamStatsCollector \{([\s\S]*?)\}\r?\nclass StreamStats \{/;
  const m = src.match(re);
  if (!m) throw new Error("StreamStatsCollector introuvable (ancres dérivées ?)");
  return "class StreamStatsCollector {" + m[1] + "}";
}

// report synthétique réaliste : ~N entrées au total
function buildReport(n, variant) {
  const report = new Map();
  report.set("transport-1", { type: "transport", iceState: "connected", selectedCandidatePairId: "cp-sel" });
  // candidate-pairs (~15 % du total)
  const nCp = Math.max(2, Math.round(n * 0.15));
  for (let i = 0; i < nCp; i++) {
    report.set("cp-" + i, {
      type: "candidate-pair", id: i === 0 ? "cp-sel" : "cp-" + i,
      bytesReceived: i === 0 ? 5_000_000 + variant * 100_000 : 1000 * i,
      bytesSent: i === 0 ? 200_000 : 500 * i,
      currentRoundTripTime: 0.015,
      state: "succeeded",
    });
  }
  // local + remote candidates (~25 %)
  const nCand = Math.round(n * 0.25);
  for (let i = 0; i < nCand; i++) {
    report.set("lc-" + i, { type: "local-candidate", protocol: "udp", address: "10.0." + (i % 10) + ".1", port: 1000 + i, candidateType: "host" });
    report.set("rc-" + i, { type: "remote-candidate", protocol: "udp", address: "20.0." + (i % 10) + ".1", port: 2000 + i, candidateType: "srflx" });
  }
  // inbound-rtp vidéo (toutes les clés lues par collect) + audio
  report.set("in-video", {
    type: "inbound-rtp", kind: "video", id: "in-video",
    frameWidth: 1920, frameHeight: 1080, framesPerSecond: 60,
    packetsLost: 3, packetsReceived: 180_000 + variant * 500,
    framesDropped: 5, framesReceived: 6_000 + variant * 30,
    jitterBufferDelay: 1.2 + variant * 0.01, jitterBufferEmittedCount: 6_000 + variant * 30,
    bytesReceived: 80_000_000 + variant * 900_000,
    timestamp: 1_800_000 + variant * 1_000,
    totalDecodeTime: 40 + variant * 0.5, framesDecoded: 6_000 + variant * 30,
  });
  report.set("in-audio", {
    type: "inbound-rtp", kind: "audio", id: "in-audio",
    bytesReceived: 1_500_000 + variant * 5_000, packetsReceived: 90_000 + variant * 100, jitter: 0.02,
  });
  // outbound-rtp (~5 %) + codecs (~35 %) + tracks (~15 %)
  const nOut = Math.max(2, Math.round(n * 0.05));
  for (let i = 0; i < nOut; i++) report.set("out-" + i, { type: "outbound-rtp", kind: "video", bytesSent: 1000 * i });
  const nCodec = Math.max(4, Math.round(n * 0.35));
  for (let i = 0; i < nCodec; i++) report.set("codec-" + i, { type: "codec", mimeType: "video/VP9", payloadType: 96 + i });
  const nTrack = Math.max(2, Math.round(n * 0.15));
  for (let i = 0; i < nTrack; i++) report.set("track-" + i, { type: "track", kind: "video", framesSent: 100 * i });
  return report;
}

// ---------------- stubs vm ----------------

function makeCtx(getReport) {
  const ctx = {
    console,
    Date,
    Math,
    Promise,
    globalThis: null,
    navigator: { getBattery: () => Promise.resolve({ charging: false, level: 0.5 }) },
    BxLogger: { info() {}, error() {}, warn() {} },
    getStreamPref: () => 60,
    humanFileSize: (b) => b + " B",
    secondsToHm: (s) => String(s),
    STATES: {
      currentStream: { peerConnection: { getStats: () => Promise.resolve(getReport()) } },
      browser: { capabilities: { batteryApi: true } },
    },
  };
  ctx.globalThis = ctx;
  return ctx;
}

async function benchAsync(fn, iters) {
  for (let i = 0; i < 500; i++) await fn();
  for (let i = 0; i < 1000; i++) await fn();
  if (global.gc) global.gc();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) await fn();
  return ((performance.now() - t0) / iters) * 1e6;
}

async function main() {
  const argv = process.argv.slice(2);
  const paths = argv.filter((a) => !a.startsWith("--"));
  const PASSES = parseInt((argv.find((a) => a.startsWith("--passes=")) || "=3").split("=")[1], 10);
  const ITERS = parseInt((argv.find((a) => a.startsWith("--iters=")) || "=2000").split("=")[1], 10);
  const ENTRIES = parseInt((argv.find((a) => a.startsWith("--entries=")) || "=265").split("=")[1], 10);
  const json = argv.includes("--json");

  if (argv.includes("--self-test")) {
    const fake = "prefix class StreamStatsCollector {async collect(){}} }\nclass StreamStats {other}";
    const checks = [
      ["extraction", extractCollector(fake).includes("async collect")],
      ["report transport", buildReport(265, 0).get("transport-1")?.type === "transport"],
      ["report video clés", !!buildReport(265, 0).get("in-video")?.frameWidth],
      ["report taille", buildReport(265, 0).size >= 265 && buildReport(265, 0).size <= 1.4 * 265],
      ["variantes diff", buildReport(50, 1).get("in-video").bytesReceived !== buildReport(50, 0).get("in-video").bytesReceived],
    ];
    for (const [name, ok] of checks) {
      if (!ok) { console.error(`SELF-TEST FAIL: ${name}`); process.exit(1); }
    }
    console.log("SELF-TEST OK");
    process.exit(0);
  }

  if (paths.length < 2) {
    console.error("Usage : node bench/streamstats-collect.js <perf10.js> <build.js> [--passes=N] [--iters=N] [--entries=N]");
    process.exit(1);
  }
  const p10 = fs.readFileSync(paths[0], "utf-8");
  const build = fs.readFileSync(paths[1], "utf-8");

  async function measure(src, tag) {
    const classSrc = extractCollector(src);
    let variant = 0;
    const reportA = buildReport(ENTRIES, 0);
    const reportB = buildReport(ENTRIES, 1);
    const ctx = makeCtx(() => (variant++ % 2 === 0 ? reportA : reportB));
    vm.createContext(ctx);
    vm.runInContext(classSrc + "; globalThis.__SSC = StreamStatsCollector;", ctx);
    const inst = new ctx.__SSC();
    inst.reset();
    const samples = [];
    for (let p = 0; p < PASSES; p++) {
      samples.push(await benchAsync(() => inst.collect(), ITERS));
    }
    samples.sort((a, b) => a - b);
    const med = samples[Math.floor(samples.length / 2)];
    return { tag, med, min: samples[0], max: samples[samples.length - 1], pass: samples };
  }

  const r10 = await measure(p10, "perf10");
  const rb = await measure(build, "build");

  if (json) {
    console.log(JSON.stringify({ entries: ENTRIES, iters: ITERS, passes: PASSES, perf10: r10, build: rb }, null, 1));
  } else {
    const gain = (1 - rb.med / r10.med) * 100;
    const perSec = (rb.med / 1000).toFixed(2);
    const cpuPct = (rb.med / 1e9 * 100).toFixed(4);
    console.log(`=== StreamStatsCollector.collect() — tick 1 Hz, report ${ENTRIES} entrées, ${ITERS} ticks/passe × ${PASSES} passes ===`);
    console.log(`perf10 : med ${r10.med.toFixed(0)} ns/tick (min ${r10.min.toFixed(0)}, max ${r10.max.toFixed(0)})`);
    console.log(`build  : med ${rb.med.toFixed(0)} ns/tick (min ${rb.min.toFixed(0)}, max ${rb.max.toFixed(0)})`);
    console.log(`gain single-pass (patch 9) : ${gain.toFixed(1)} %  (×${(r10.med / rb.med).toFixed(2)})`);
    console.log(`coût absolu du build : ${perSec} µs par tick (1 Hz) = ${cpuPct} % CPU — marge restante : négligeable`);
  }
  process.exit(0);
}

module.exports = { extractCollector, buildReport };

main().catch((e) => { console.error(e.message); process.exit(1); });
