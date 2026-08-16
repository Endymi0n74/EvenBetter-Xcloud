#!/usr/bin/env node
/*
 * bench/preview/smoke-draw.js — valide le moteur de MESURE du draw de
 * bench/preview/capture.js hors navigateur : on exécute capture.js dans un
 * vm avec un contexte GL simulé (méthodes dont on contrôle la durée), on
 * lance la mesure sur une courte fenêtre, puis on vérifie que les agrégats
 * (draws/frame, uploads/frame, µs/call, GL µs/frame) sont cohérents.
 *
 * Usage : node bench/preview/smoke-draw.js   (exit 0 = tout passe)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const capturePath = path.join(__dirname, "capture.js");

// GL simulé : chaque appel « coûte » une durée connue. Busy-loop sur
// performance.now (résolution sub-ms) — ni Date.now (~1 ms), ni Atomics.wait
// (timeouts fractionnaires imprécis sur Node).
function busy(ms) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {}
}
// Durées simulées volontairement > granularité de performance.now (~1 ms sur
// Windows) : la quantification résiduelle (±1 ms) reste dans les bornes.
const DRAWS_MS = 2.0;   // drawArrays
const UPLOAD_MS = 3.5;  // texSubImage2D

function main() {
  const proto2 = {
    drawArrays() { busy(DRAWS_MS); },
    drawElements() { busy(DRAWS_MS); },
    texSubImage2D() { busy(UPLOAD_MS); },
    texImage2D() { busy(UPLOAD_MS); },
    texStorage2D() {},
    bindTexture() {},
    pixelStorei() {},
    clear() {},
    uniform1f() {},
    uniform2f() {},
    uniform1i() {},
  };
  const sandbox = {
    console,
    performance: {
      now: () => Date.now(),
      getEntriesByType: () => [],
    },
    setTimeout: () => 0, // bloque l'auto-start de capture.js (on pilote à la main)
    requestAnimationFrame: () => 0, // remplacé dans main() par le pump
    fetch: () => Promise.resolve({ ok: false, status: 0 }),
    Blob: function () {},
    URL: { createObjectURL: () => "", revokeObjectURL: () => {} },
    document: { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } },
    navigator: {},
    location: { href: "https://play.xbox.com/stream/mock" },
    PerformanceObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    WebGL2RenderingContext: { prototype: proto2 },
    WebGLRenderingContext: { prototype: {} },
    GPUQueue: undefined,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(capturePath, "utf8"), sandbox, { filename: "capture.js" });
  const api = sandbox.window.BX_PREVIEW_CAPTURE;
  if (!api) { console.error("✗ API absente"); process.exit(1); }

  // fenêtre courte + drive rAF : chaque tick = une frame avec 1 draw + 1 upload
  api.cfg.drawWindowMs = 300;
  const rafCbs = [];
  sandbox.requestAnimationFrame = (cb) => { rafCbs.push(cb); };

  api.start().then(() => {
    const d = api.state.draw;
    if (!d || !d.aggregate || d.frames < 5) { console.error("✗ mesure vide/insuffisante"); process.exit(1); }
    const drawsPerFrame = d.aggregate.drawsPerFrame;
    const uploadsPerFrame = d.aggregate.uploadsPerFrame;
    const glUsFrame = d.aggregate.glMsPerFrame * 1000;
    const uploadUsMed = d.uploadUsMed;
    const drawUsMed = d.drawUsMed;

    let ok = true;
    if (!(drawsPerFrame >= 0.8 && drawsPerFrame <= 1.2)) { console.error(`✗ draws/frame attendu ~1, mesuré ${drawsPerFrame}`); ok = false; }
    if (!(uploadsPerFrame >= 0.8 && uploadsPerFrame <= 1.2)) { console.error(`✗ uploads/frame attendu ~1, mesuré ${uploadsPerFrame}`); ok = false; }
    if (!(glUsFrame > 3800 && glUsFrame < 7000)) { console.error(`✗ GL µs/frame attendu ~5500, mesuré ${glUsFrame}`); ok = false; }
    if (!(uploadUsMed > 2600 && uploadUsMed < 4600)) { console.error(`✗ upload µs/call attendu ~3500, mesuré ${uploadUsMed}`); ok = false; }
    if (!(drawUsMed > 1200 && drawUsMed < 3000)) { console.error(`✗ draw µs/call attendu ~2000, mesuré ${drawUsMed}`); ok = false; }

    console.log(`  ${ok ? "✓" : "✗"} draw simulé : ${d.frames} frames, ${drawsPerFrame.toFixed(2)} draws/f, ${uploadsPerFrame.toFixed(2)} uploads/f, GL ${glUsFrame.toFixed(0)} µs/f, upload ${uploadUsMed.toFixed(0)} µs/call, draw ${drawUsMed.toFixed(0)} µs/call`);
    process.exitCode = ok ? 0 : 1; // exitCode (pas process.exit) : flush stdout complet
  }).catch((e) => { console.error("✗", e); process.exit(1); });

  // pump : consomme les rAF enregistrés ~60/s pendant 500 ms (au-delà de la
  // fenêtre de 300 ms). Asynchrone (setTimeout réel) pour laisser les
  // microtasks de start() progresser — sinon la mesure ne démarre jamais.
  const t0 = Date.now();
  (function pump() {
    if (Date.now() - t0 < 500) {
      // « render » simulé par frame : 1 draw + 1 upload, comme la boucle Babylon
      proto2.drawArrays();
      proto2.texSubImage2D();
      const cbs = rafCbs.splice(0);
      for (const cb of cbs) cb();
      setTimeout(pump, 16);
    }
  })();
}

main();
