#!/usr/bin/env node
/**
 * Parse/compile benchmark (Node V8) — perf10 vs build courant.
 *
 * Mesure UNIQUEMENT la compilation (new Function sans exécution) : l'exécution
 * réelle est mesurée par bench/page-eval.js dans Edge.
 *
 * Stabilisation (même recette que hotloops.js et le harnais GPU) :
 *   - préchauffage explicite en 2 phases avant chaque mesure chronométrée
 *     (compile caches / state GC steady), puis `global.gc()` (nécessite
 *     `node --expose-gc`, fait par run-all.sh)
 *   - runs croisés : l'ordre des mesures (version × passe) est mélangé par un
 *     PRNG déterministe (`--seed=N`, mulberry32)
 *   - médiane / min / max sur `--passes` passes (défaut 3) — le temps par
 *     itération est pris en `process.hrtime.bigint()` (résolution ns) car
 *     ~110-130 µs par compile est trop proche de la résolution de
 *     `performance.now()` pour une mesure par itération fiable
 *
 * Usage : node bench/parse.js <build-perf10.js> <build-courant.js> [--passes=N] [--seed=N] [--iters=N]
 * Exemple : ./bench/run-all.sh
 */
"use strict";

const fs = require("fs");
const { performance } = require("perf_hooks");

const argv = process.argv.slice(2);
const paths = argv.filter((a) => !a.startsWith("--"));
const [p10Path, p13Path] = paths;
if (!p10Path || !p13Path) {
  console.error("Usage : node bench/parse.js <perf10.js> <build.js> [--passes=N] [--seed=N] [--iters=N]");
  process.exit(1);
}
const PASSES = parseInt((argv.find((a) => a.startsWith("--passes=")) || "=3").split("=")[1], 10);
const SEED = argv.find((a) => a.startsWith("--seed="))
  ? parseInt(argv.find((a) => a.startsWith("--seed=")).split("=")[1], 10)
  : Date.now() % 1000000;
const ITERS = parseInt((argv.find((a) => a.startsWith("--iters=")) || "=300").split("=")[1], 10);

const p10 = fs.readFileSync(p10Path, "utf-8");
const p13 = fs.readFileSync(p13Path, "utf-8");

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
 * Une passe de mesure pour un build : préchauffage 2 phases, GC, puis ITERS
 * compiles chronométrés en ns (hrtime). Retourne { median, p95, min } en ms.
 *
 * Tailles de préchauffage réduites vs hotloops.js (~ns/op) : une compile prend
 * ~110-130 µs, 10 + 20 compiles suffisent à stabiliser les caches de compile.
 */
function benchPass(code) {
  for (let i = 0; i < 10; i++) new Function(code);
  for (let i = 0; i < 20; i++) new Function(code);
  if (global.gc) global.gc();
  const times = [];
  for (let i = 0; i < ITERS; i++) {
    const t0 = process.hrtime.bigint();
    // Parse/compile pur (sans exécution)
    new Function(code);
    times.push(Number(process.hrtime.bigint() - t0));
  }
  times.sort((a, b) => a - b);
  return {
    median: times[Math.floor(times.length / 2)] / 1e6,
    p95: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))] / 1e6,
    min: times[0] / 1e6,
  };
}

const versions = [
  { label: "perf10", code: p10 },
  { label: "build", code: p13 },
];

// runs croisés : (version × passe), ordre mélangé par seed
const order = [];
for (let p = 0; p < PASSES; p++) for (const v of versions) order.push([v.label, p]);
shuffle(order, mulberry32(SEED));

const results = {};
for (const [vlabel] of order) {
  const v = versions.find((x) => x.label === vlabel);
  const r = benchPass(v.code);
  (results[vlabel] ||= []).push(r);
}

const agg = (label, key) => {
  const vals = (results[label] || []).map((r) => r[key]);
  const s = [...vals].sort((a, b) => a - b);
  return { med: s[Math.floor(s.length / 2)], min: s[0], max: s[s.length - 1] };
};

console.log(`=== Parse/compile Node (V8), ${ITERS} itérations/passe, ${PASSES} passes, seed ${SEED} (ordre mélangé) ===`);
for (const v of versions) {
  const label = v.label;
  const med = agg(label, "median"), p95 = agg(label, "p95"), mn = agg(label, "min");
  console.log(
    `${label.padEnd(7)}: médiane ${med.med.toFixed(3)} ms (min ${med.min.toFixed(3)}, max ${med.max.toFixed(3)}) | p95 ${p95.med.toFixed(3)} ms | min-itération ${mn.min.toFixed(3)} ms`
  );
}
const r10 = agg("perf10", "median");
const r13 = agg("build", "median");
console.log(`écart médiane : ${((r13.med / r10.med - 1) * 100).toFixed(1)} %`);
console.log("(échelle sub-ms → bruité : seule la comparaison relative compte ; médianes de passes, pas d'itération unique)");
