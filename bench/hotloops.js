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
 * Stabilisation (même recette que le harnais GPU) :
 *   - préchauffage explicite en 2 phases avant chaque mesure chronométrée
 *   - runs croisés : l'ordre des mesures (version × scénario) est mélangé par
 *     un PRNG déterministe (`--seed=N`, mulberry32) pour qu'aucune version ne
 *     soit systématiquement mesurée en premier/dernier
 *   - médiane / min / max sur `--passes` passes (défaut 3)
 *
 * Usage : node bench/hotloops.js <build-perf10.js> <build-courant.js> [--passes=N] [--seed=N] [--iters=N]
 */
"use strict";

const fs = require("fs");
const { performance } = require("perf_hooks");

const argv = process.argv.slice(2);
const paths = argv.filter((a) => !a.startsWith("--"));
const [p10Path, p13Path] = paths;
if (!p10Path || !p13Path) {
  console.error("Usage : node bench/hotloops.js <perf10.js> <build.js> [--passes=N] [--seed=N] [--iters=N]");
  process.exit(1);
}
const PASSES = parseInt((argv.find((a) => a.startsWith("--passes=")) || "=3").split("=")[1], 10);
const SEED = argv.find((a) => a.startsWith("--seed="))
  ? parseInt(argv.find((a) => a.startsWith("--seed=")).split("=")[1], 10)
  : Date.now() % 1000000;
const ITERS = parseInt((argv.find((a) => a.startsWith("--iters=")) || "=200000").split("=")[1], 10);

const p10 = fs.readFileSync(p10Path, "utf-8");
const p13 = fs.readFileSync(p13Path, "utf-8");

function extractVar(src, name) {
  const re = new RegExp(`var ${name} = "((?:[^"\\\\]|\\\\.)*)";`);
  const m = src.match(re);
  if (!m) throw new Error(`fragment ${name} introuvable dans le build`);
  return JSON.parse(`"${m[1]}"`);
}

// PRNG déterministe (seed) pour des runs croisés reproductibles
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Préchauffage explicite en 2 phases (JIT, caches, état GC steady) puis
 * mesure chronométrée. Retourne le coût moyen en ns/op.
 *
 * `global.gc()` (dispo avec `node --expose-gc`) vide la young generation après
 * le préchauffage : sans ça, la poubelle du warmup est purgée pendant le chrono
 * et fausse la mesure (c'est l'équivalent CPU du `flush()` du harnais GPU).
 */
function bench(fn, iters) {
  for (let i = 0; i < 5000; i++) fn();
  for (let i = 0; i < 10000; i++) fn();
  if (global.gc) global.gc();
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

function buildUpdateCanvasFn(src) {
  const cls = extractClass(src, "WebGL2Player");
  if (!cls) return null;
  const body = extractMethod(cls, "updateCanvas");
  if (!body) return null;
  return new Function("ctx", `${body}`);
}

// ---------- scénarios ----------
// run(fn) -> { ns, counts? } ; le ctx est réutilisé (ou pré-conditionné sans
// allocation par itération) — une allocation par poll dominerait la mesure.
const SCENARIOS = [
  {
    id: "controller.IDLE",
    title: "controller_customization_default — IDLE",
    build: (src) => buildCustomFn(src),
    run: (fn) => {
      const ctx = makeCustomCtx(false);
      return { ns: bench(() => fn(ctx), ITERS) };
    },
  },
  {
    id: "controller.ACTIF",
    title: "controller_customization_default — ACTIF",
    build: (src) => buildCustomFn(src),
    run: (fn) => {
      const ctx = makeCustomCtx(true);
      return { ns: bench(() => fn(ctx), ITERS) };
    },
  },
  {
    id: "poll.common",
    title: "poll_gamepad_default — chemin commun",
    build: (src) => buildPollFn(src),
    run: (fn) => {
      const buttons = makeButtons(false, false);
      const ctx = Object.assign(makePollBase(buttons), {
        currentGamepad: { id: "pad", index: 0, timestamp: 1, buttons, axes: [0, 0, 0, 0] },
        bxHomeStates: {},
      });
      return { ns: bench(() => fn.call(ctx, ctx), ITERS) };
    },
  },
  {
    id: "poll.release",
    title: "poll_gamepad_default — relâchement Home",
    build: (src) => buildPollFn(src),
    run: (fn) => {
      // ctx NEUF à chaque poll : le fragment met `bxHomeStates[index]` à null
      // sur le premier relâchement (et perf10 y fait un structuredClone), donc
      // le chemin coûteux ne s'exécute qu'une fois par ctx — un ctx réutilisé
      // retomberait sur le chemin rapide (état null).
      // `buttons` est HOISTÉ (créé une fois, partagé) : le créer dans la
      // closure ajouterait 20 allocations par poll et gonflerait la mesure
      // (piège déjà documenté « ctx réutilisé »).
      const buttons = makeButtons(false, false);
      return { ns: bench(() => {
        const ctx = Object.assign(makePollBase(buttons), {
          currentGamepad: { id: "pad", index: 0, timestamp: 9, buttons, axes: [0, 0, 0, 0] },
          bxHomeStates: { 0: { shortcutPressed: 0, timestamp: 8 } },
        });
        fn.call(ctx, ctx);
      }, ITERS) };
    },
  },
  {
    id: "updateFrame",
    title: "WebGL2Player.updateFrame (chemin stable)",
    build: (src) => buildUpdateFrameFn(src),
    run: (fn) => {
      const { gl, calls } = makeGl();
      const ctx = {
        gl,
        $video: { videoWidth: 1920, videoHeight: 1080 },
        _texWidth: 1920, _texHeight: 1080, texture: {},
        allocatedWidth: 1920, allocatedHeight: 1080,
      };
      return { ns: bench(() => fn.call(ctx), ITERS), counts: calls };
    },
  },
  {
    id: "updateCanvas",
    title: "WebGL2Player.updateCanvas (valeurs inchangées, chemin 60 Hz)",
    build: (src) => buildUpdateCanvasFn(src),
    run: (fn) => {
      const { gl, calls } = makeGl();
      const ctx = {
        gl,
        _uniforms: { iResolution: {}, filterId: {}, qualityMode: {}, sharpenFactor: {}, brightness: {}, contrast: {}, saturation: {} },
        $canvas: { width: 1920, height: 1080 },
        options: { processing: "usm", processingMode: "performance", sharpness: 0, brightness: 100, contrast: 100, saturation: 100 },
        toFilterId: (p) => (p === "cas" ? 2 : 1),
      };
      // première exécution hors chrono : perf10 fait ses 7 uploads, le build
      // remplit `_uniformsCache` — la mesure couvre ensuite l'état stable 60 Hz
      // (valeurs inchangées → retour anticipé pour le build, 7 gl.uniform* pour perf10)
      fn.call(ctx);
      return { ns: bench(() => fn.call(ctx), ITERS), counts: calls };
    },
  },
];

// ---------- exécution ----------  console.log(`=== Hot loops ~60 Hz — ${ITERS} itérations, ${PASSES} passes, seed ${SEED} (ordre mélangé) ===`);

const versions = [
  { label: "perf10", src: p10 },
  { label: "build", src: p13 },
];

// prépare toutes les fonctions une fois
const prepared = {};
for (const v of versions) {
  prepared[v.label] = {};
  for (const sc of SCENARIOS) {
    const fn = sc.build(v.src);
    if (fn === null) console.log(`${v.label}: ${sc.id} introuvable — ignoré`);
    else prepared[v.label][sc.id] = fn;
  }
}

// runs croisés : (version × scénario) × passes, ordre mélangé par seed
const order = [];
for (let p = 0; p < PASSES; p++)
  for (const v of versions)
    for (const sc of SCENARIOS)
      if (prepared[v.label][sc.id]) order.push([v.label, sc.id]);
shuffle(order, mulberry32(SEED));

const results = {};
for (const [vlabel, sid] of order) {
  const sc = SCENARIOS.find((s) => s.id === sid);
  const { ns, counts } = sc.run(prepared[vlabel][sid]);
  results[sid] ||= {};
  results[sid][vlabel] ||= { ns: [], counts: null };
  results[sid][vlabel].ns.push(ns);
  if (counts) results[sid][vlabel].counts = counts;
}

// groupement par section (même présentation que l'ancien harnais)
const section = (ids, header, fmt) => {
  console.log(`\n=== ${header} ===`);
  for (const v of versions) {
    const parts = ids.map((sid) => {
      const r = results[sid]?.[v.label];
      if (!r) return `${sid}: n/a`;
      const s = [...r.ns].sort((a, b) => a - b);
      const med = s[Math.floor(s.length / 2)];
      return fmt(sid, med, s[0], s[s.length - 1], r);
    });
    console.log(`${v.label.padEnd(7)}: ${parts.join(" | ")}`);
  }
};

section(
  ["controller.IDLE", "controller.ACTIF"],
  `Hot loop 60 Hz : controller_customization_default (${ITERS} polls)`,
  (sid, med, min, max) =>
    `${sid === "controller.IDLE" ? "IDLE" : "ACTIF"} med ${med.toFixed(1)} ns/poll (min ${min.toFixed(1)}, max ${max.toFixed(1)})`
);

section(
  ["poll.common", "poll.release"],
  `Hot loop : poll_gamepad_default (chemin commun + relâchement Home)`,
  (sid, med, min, max) =>
    `${sid === "poll.common" ? "commun" : "relâchement Home"} med ${med.toFixed(1)} ns/poll (min ${min.toFixed(1)}, max ${max.toFixed(1)})`
);

section(
  ["updateFrame"],
  `WebGL2Player.updateFrame (chemin stable, gl/video factices)`,
  (sid, med, min, max, r) => {
    const c = r.counts || {};
    return `med ${med.toFixed(1)} ns/frame (min ${min.toFixed(1)}, max ${max.toFixed(1)}) | bindTexture=${c.bindTexture || 0} texImage2D=${c.texImage2D || 0} texSubImage2D=${c.texSubImage2D || 0} drawArrays=${c.drawArrays || 0}`;
  }
);

section(
  ["updateCanvas"],
  `WebGL2Player.updateCanvas (valeurs inchangées, chemin 60 Hz, gl/uniforms factices)`,
  (sid, med, min, max, r) => {
    const c = r.counts || {};
    return `med ${med.toFixed(1)} ns/frame (min ${min.toFixed(1)}, max ${max.toFixed(1)}) | uniform2f=${c.uniform2f || 0} uniform1i=${c.uniform1i || 0} uniform1f=${c.uniform1f || 0}`;
  }
);
