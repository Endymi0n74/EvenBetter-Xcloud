#!/usr/bin/env node
/**
 * machine-state.js — capture l'état machine (GPU + CPU) à un instant T.
 *
 * Exécuté par run-gpu-ci.sh juste avant et juste après chaque seed de
 * gpu-runner.js, pour corréler l'état « haut » / « bas » des uploads GPU
 * (backpressure/sync du pipeline vidéo/GPU — cf. mémo projet, section 7)
 * avec l'état réel de la machine au moment de la mesure : température,
 * clocks, charge, processus de fond.
 *
 * Sortie (stdout, JSON) :
 *   {
 *     "when": "before" | "after",
 *     "iso": "<horodatage ISO>",
 *     "gpu": { "name", "tempC", "utilPct", "memUtilPct", "smClockMhz",
 *              "memClockMhz", "powerW", "pstate" } | null,
 *     "cpu": { "name", "cores", "loadPct", "perfPct" } | null,
 *     "top": [ { "name", "cpuSeconds" } ] | []
 *   }
 *
 *   - gpu : nvidia-smi (température, utilisation, clocks SM/mémoire,
 *     puissance, P-state) — null si nvidia-smi absent (ex. non-NVIDIA).
 *   - cpu : charge % (Get-Counter, échantillon ~1 s) et « % de la fréquence
 *     de base » (\Processor Information\% Processor Performance — 100 =
 *     base, >100 = boost) sous Windows ; charge via /proc/stat sinon.
 *   - top : 5 processus les plus gourmands en temps CPU cumulé.
 *
 * Tolérant : un outil absent → champ null, exit 0 (le protocole continue).
 * Timeout 15 s par source (20 s PowerShell) pour ne jamais bloquer le seed.
 *
 * Usage : node bench/gpu/machine-state.js before|after
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");

const when = process.argv[2] || "before";

const run = (cmd, args, timeoutMs = 15000) => {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: timeoutMs, windowsHide: true });
    if (r.error || r.status !== 0) return null;
    return r.stdout;
  } catch (e) {
    return null;
  }
};

// ---------- GPU (nvidia-smi) ----------
let gpu = null;
{
  const out = run("nvidia-smi", [
    "--query-gpu=name,temperature.gpu,utilization.gpu,utilization.memory,clocks.sm,clocks.mem,power.draw,pstate",
    "--format=csv,noheader,nounits",
  ]);
  if (out) {
    const f = out.trim().split(",").map((x) => x.trim());
    if (f.length >= 8) {
      gpu = {
        name: f[0],
        tempC: parseFloat(f[1]),
        utilPct: parseFloat(f[2]),
        memUtilPct: parseFloat(f[3]),
        smClockMhz: parseFloat(f[4]),
        memClockMhz: parseFloat(f[5]),
        powerW: parseFloat(f[6]),
        pstate: f[7],
      };
    }
  }
}

// ---------- CPU ----------
let cpu = null;
let top = [];
if (process.platform === "win32") {
  // Get-Counter (charge % + « % de la fréquence de base », >100 = boost) n'est
  // disponible que si les compteurs de performance sont enregistrés (désactivés
  // sur certaines machines — cette machine de bench les a cassés) → best-effort,
  // repli CIM : LoadPercentage (fiable partout) + CurrentClockSpeed (fréquence
  // de BASE, statique via WMI — référence, pas la fréquence instantanée).
  const ps = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$load = $null; $perf = $null",
    "$c = Get-Counter '\\Processor(_Total)\\% Processor Time','\\Processor Information(_Total)\\% Processor Performance' -ErrorAction SilentlyContinue",
    "if ($c) { $load = [math]::Round($c.CounterSamples[0].CookedValue,1); $perf = [math]::Round($c.CounterSamples[1].CookedValue,1) }",
    "$p = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1",
    "$loadCim = $null; $curMHz = $null; $maxMHz = $null; $pName = $null; $lcores = $null",
    "if ($p) { $loadCim = $p.LoadPercentage; $curMHz = $p.CurrentClockSpeed; $maxMHz = $p.MaxClockSpeed; $pName = $p.Name; $lcores = $p.NumberOfLogicalProcessors }",
    "$top = @(Get-Process -ErrorAction SilentlyContinue | Sort-Object CPU -Descending | Select-Object -First 5 | ForEach-Object { [pscustomobject]@{ n = $_.ProcessName; cpu = [math]::Round($_.CPU,1) } })",
    "[pscustomobject]@{ name = $pName; lcores = $lcores; load = $load; perf = $perf; loadCim = $loadCim; curMHz = $curMHz; maxMHz = $maxMHz; top = $top } | ConvertTo-Json -Compress",
  ].join("; ");
  const out = run("powershell", ["-NoProfile", "-Command", ps], 20000);
  if (out) {
    try {
      const j = JSON.parse(out.trim());
      cpu = {
        name: j.name || null,
        cores: j.lcores != null ? j.lcores : null,
        loadPct: j.load != null ? j.load : j.loadCim,
        perfPct: j.perf != null ? j.perf : null,
        clockMhz: j.curMHz || null, // fréquence de base (statique via WMI)
      };
      if (Array.isArray(j.top)) top = j.top.map((t) => ({ name: t.n, cpuSeconds: t.cpu }));
    } catch (e) {
      cpu = null;
    }
  }
} else {
  // Linux : charge via /proc/stat (2 échantillons espacés de 300 ms),
  // processus de fond via ps.
  const sample = () => {
    try {
      const line = fs.readFileSync("/proc/stat", "utf8").split("\n").find((l) => l.startsWith("cpu "));
      if (!line) return null;
      const p = line.split(/\s+/).slice(1).map(Number);
      return { idle: p[3] + (p[4] || 0), total: p.reduce((a, b) => a + b, 0) };
    } catch (e) {
      return null;
    }
  };
  const s1 = sample();
  if (s1) {
    run("sleep", ["0.3"], 5000);
    const s2 = sample();
    if (s2) {
      const dTotal = s2.total - s1.total;
      cpu = {
        name: null,
        cores: null,
        loadPct: dTotal > 0 ? Math.round((100 * (dTotal - (s2.idle - s1.idle))) / dTotal) : null,
        perfPct: null,
      };
    }
  }
  const out = run("ps", ["-eo", "comm=,cputime=", "--sort=-cputime"], 5000);
  if (out) {
    const toSec = (t) => {
      const p = t.split(":").map(Number);
      if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
      if (p.length === 2) return p[0] * 60 + p[1];
      return p[0] || 0;
    };
    top = out
      .trim()
      .split("\n")
      .slice(0, 5)
      .map((l) => {
        const m = l.trim().split(/\s+/);
        return { name: m[0] || "?", cpuSeconds: m[1] ? toSec(m[1]) : 0 };
      })
      .filter((t) => t.cpuSeconds > 0);
  }
}

console.log(JSON.stringify({ when, iso: new Date().toISOString(), gpu, cpu, top }));
