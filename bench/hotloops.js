#!/usr/bin/env node
/**
 * Hot loops ~60 Hz (Node V8) — perf10 vs build courant.
 *
 * Fragments injectés extraits des builds, exécutés tels quels après les
 * substitutions que fait le Patcher à l'exécution. Détails des pièges :
 *   - `var self=this` en tête de poll_gamepad_default → appeler fn.call(ctx, ctx)
 *   - shadow de `window` et `setTimeout` dans le wrapper (Node tire le vrai
 *     timer/global sinon)
 *   - réutiliser le même ctx entre les polls (un ctx neuf par itération domine
 *     la mesure : 20+ allocations)
 *   - chemin « relâchement Home » : bxHomeStates[index] pré-rempli +
 *     inputSink.onGamepadInput + BX_STREAM_SETTINGS.controllerPollingRate
 *
 * Usage : node bench/hotloops.js <build-perf10.js> <build-courant.js>
 */
"use strict";

const fs = require("fs");
const { performance } = require("perf_hooks");

const [p10Path, p13Path] = process.argv.slice(2);
if (!p10Path || !p13Path) {
  console.error("Usage : node bench/hotloops.js <perf10.js> <build.js>");
  process.exit(1);
}

const p10 = fs.readFileSync(p10Path, "utf-8");
const p13 = fs.readFileSync(p13Path, "utf-8");

function extractVar(src, name) {
  const re = new RegExp(`var ${name} = "((?:[^"\\\\]|\\\\.)*)";`);
  const m = src.match(re);
  if (!m) throw new Error(`fragment ${name} introuvable dans le build`);
  return JSON.parse(`"${m[1]}"`);
}

function bench(fn, iters) {
  for (let i = 0; i < 3000; i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  return ((performance.now() - t0) / iters) * 1e6;
}

function makeButtons(pressedHome, pressedA) {
  return Array.from({ length: 20 }, (_, i) => ({
    pressed: (i === 16 && pressedHome) || (i === 0 && pressedA),
    value: (i === 16 && pressedHome) || (i === 0 && pressedA) ? 1 : 0,
  }));
}

// ---------- 1) controller_customization_default ----------
function makeCustomCtx(active) {
  const mapping = {
    A: "A", B: "B", X: "X", Y: "Y",
    LB: "LB", RB: "RB", LT: "LT", RT: "RT",
    Select: "Select", Start: "Start",
    LeftStickAxes: "RightStickAxes", RightStickAxes: "LeftStickAxes",
    LeftTrigger: "LeftTrigger", RightTrigger: "RightTrigger",
    Share: "Select",
  };
  const ranges = {
    LeftTrigger: [0.1, 0.9], RightTrigger: [0.1, 0.9],
    LeftThumb: [0.1, 0.9], RightThumb: [0.1, 0.9],
  };
  return {
    currentGamepad: {
      id: "pad", index: 0, timestamp: 1,
      buttons: makeButtons(false, active),
      axes: active ? [0.5, 0.25, 0, 0] : [0, 0, 0, 0],
    },
    xCloudGamepad: {
      A: active ? 1 : 0, B: 0, X: 0, Y: 0, LB: 0, RB: 0, LT: 0, RT: 0,
      Select: 0, Start: 0, Home: 0,
      LeftThumbXAxis: active ? 0.5 : 0, LeftThumbYAxis: active ? 0.25 : 0,
      RightThumbXAxis: 0, RightThumbYAxis: 0,
    },
    BX_STREAM_SETTINGS: { controllers: { pad: { customization: { mapping, ranges } } } },
  };
}

function buildCustomFn(src) {
  const frag = extractVar(src, "controller_customization_default");
  const code = frag.replace("$xCloudGamepadVar$", "ctx.xCloudGamepad");
  return new Function("ctx", `
    var currentGamepad = ctx.currentGamepad;
    var window = ctx;
    ${code}
  `);
}

// ---------- 2) poll_gamepad_default ----------
function buildPollFn(src) {
  const frag = extractVar(src, "poll_gamepad_default");
  const code = frag.replace("$gamepadVar$", "ctx.currentGamepad");
  return new Function("ctx", `
    var currentGamepad = ctx.currentGamepad;
    var window = ctx;
    var setTimeout = ctx.setTimeout;
    ${code}
  `);
}

function makePollBase(homeButtons) {
  return {
    BX_EXPOSED: {
      disableGamepadPolling: false,
      handleControllerShortcut: () => false,
      resetControllerShortcut: () => {},
    },
    inputConfiguration: { useIntervalWorkerThreadForInput: false },
    pollGamepadssetTimeoutTimerID: 0,
    gamepadIsIdle: new Map(),
    inputSink: { onGamepadInput: () => {} },
    BX_STREAM_SETTINGS: { controllerPollingRate: 8 },
    setTimeout: () => 0,
    dispatchEvent: () => {},
    _homeButtons: homeButtons,
  };
}

// ---------- 3) WebGL2Player.updateFrame (chemin stable) ----------
function extractClass(src, name) {
  const start = src.indexOf(`class ${name}`);
  if (start < 0) return null;
  const after = src.slice(start);
  const nextClass = after.search(/\nclass |\nvar [A-Za-z_$]+ = class /);
  return after.slice(0, nextClass < 0 ? after.length : nextClass);
}

function extractMethod(cls, name) {
  const re = new RegExp(`${name}\\(\\) \\{`);
  const m = re.exec(cls);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < cls.length; i++) {
    if (cls[i] === "{") depth++;
    else if (cls[i] === "}") {
      depth--;
      if (depth === 0) return cls.slice(open, i + 1);
    }
  }
  return null;
}

function makeGl() {
  const calls = {};
  const gl = new Proxy({}, {
    get(t, prop) {
      if (typeof prop === "string" && (prop.startsWith("TEXTURE_") || prop === "RGB" ||
          prop === "UNSIGNED_BYTE" || prop === "LINEAR" || prop === "CLAMP_TO_EDGE" ||
          prop === "TRIANGLES" || prop === "UNPACK_FLIP_Y_WEBGL" || prop === "NONE")) {
        return prop;
      }
      return (...args) => { calls[prop] = (calls[prop] || 0) + 1; };
    },
  });
  return { gl, calls };
}

function buildUpdateFrameFn(src) {
  const cls = extractClass(src, "WebGL2Player");
  if (!cls) return null;
  const body = extractMethod(cls, "updateFrame");
  if (!body) return null;
  return new Function("ctx", `${body}`);
}

// ---------- exécution ----------
console.log("=== Hot loop 60 Hz : controller_customization_default (200 000 polls) ===");
for (const [label, src] of [["perf10", p10], ["build", p13]]) {
  const fn = buildCustomFn(src);
  const idleCtx = makeCustomCtx(false);
  const actCtx = makeCustomCtx(true);
  const idle = bench(() => fn(idleCtx), 200000);
  const active = bench(() => fn(actCtx), 200000);
  console.log(`${label.padEnd(7)}: IDLE ${idle.toFixed(1)} ns/poll | ACTIF ${active.toFixed(1)} ns/poll`);
}

console.log("\n=== Hot loop : poll_gamepad_default (chemin commun + relâchement Home) ===");
for (const [label, src] of [["perf10", p10], ["build", p13]]) {
  const fn = buildPollFn(src);

  // chemin commun : pas de bouton Home
  const commonButtons = makeButtons(false, false);
  const commonCtx = Object.assign(makePollBase(commonButtons), {
    currentGamepad: { id: "pad", index: 0, timestamp: 1, buttons: commonButtons, axes: [0, 0, 0, 0] },
    bxHomeStates: {},
  });
  const common = bench(() => fn.call(commonCtx, commonCtx), 200000);

  // relâchement Home : btnHome présent, pressed=false, state shortcutPressed=0
  const homeButtons = makeButtons(false, false);
  const release = bench(() => {
    const ctx = Object.assign(makePollBase(homeButtons), {
      currentGamepad: { id: "pad", index: 0, timestamp: 9, buttons: homeButtons, axes: [0, 0, 0, 0] },
      bxHomeStates: { 0: { shortcutPressed: 0, timestamp: 8 } },
    });
    fn.call(ctx, ctx);
  }, 100000);

  console.log(`${label.padEnd(7)}: commun ${common.toFixed(1)} ns/poll | relâchement Home ${release.toFixed(1)} ns/poll`);
}

console.log("\n=== WebGL2Player.updateFrame (chemin stable, gl/video factices) ===");
for (const [label, src] of [["perf10", p10], ["build", p13]]) {
  const fn = buildUpdateFrameFn(src);
  if (!fn) { console.log(`${label}: updateFrame introuvable`); continue; }
  const { gl, calls } = makeGl();
  const video = { videoWidth: 1920, videoHeight: 1080 };
  // ctx pré-conditionné sur le chemin stable (pas de resize par frame)
  const ctx = {
    gl, $video: video, video,
    _texWidth: 1920, _texHeight: 1080, texture: {},
    allocatedWidth: 1920, allocatedHeight: 1080,
  };
  const t = bench(() => fn.call(ctx), 200000);
  console.log(`${label.padEnd(7)}: ${t.toFixed(1)} ns/frame | bindTexture=${calls.bindTexture || 0} texImage2D=${calls.texImage2D || 0} texSubImage2D=${calls.texSubImage2D || 0} drawArrays=${calls.drawArrays || 0}`);
}
