#!/usr/bin/env node
/**
 * Parse/compile benchmark (Node V8) — perf10 vs build courant.
 *
 * Mesure UNIQUEMENT la compilation (new Function sans exécution) : l'exécution
 * réelle est mesurée par bench/page-eval.js dans Edge.
 *
 * Usage : node bench/parse.js <build-perf10.js> <build-courant.js>
 * Exemple : ./bench/run-all.sh
 */
"use strict";

const fs = require("fs");
const { performance } = require("perf_hooks");

const [p10Path, p13Path] = process.argv.slice(2);
if (!p10Path || !p13Path) {
  console.error("Usage : node bench/parse.js <perf10.js> <build.js>");
  process.exit(1);
}

const p10 = fs.readFileSync(p10Path, "utf-8");
const p13 = fs.readFileSync(p13Path, "utf-8");

const ITER = 300;

function bench(code) {
  const times = [];
  for (let i = 0; i < ITER; i++) {
    const t0 = performance.now();
    // Parse/compile pur (sans exécution)
    new Function(code);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return {
    median: times[Math.floor(times.length / 2)],
    p95: times[Math.floor(times.length * 0.95)],
    min: times[0],
  };
}

const r10 = bench(p10);
const r13 = bench(p13);

console.log("=== Parse/compile Node (V8), 300 itérations ===");
console.log(`perf10 : médiane ${r10.median.toFixed(3)} ms | p95 ${r10.p95.toFixed(3)} ms | min ${r10.min.toFixed(3)} ms`);
console.log(`build  : médiane ${r13.median.toFixed(3)} ms | p95 ${r13.p95.toFixed(3)} ms | min ${r13.min.toFixed(3)} ms`);
console.log(`écart médiane : ${((r13.median / r10.median - 1) * 100).toFixed(1)} %`);
console.log("(échelle sub-ms → bruité : seule la comparaison relative compte)");
