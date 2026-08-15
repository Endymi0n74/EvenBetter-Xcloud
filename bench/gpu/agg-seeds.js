// Agrege les runs gpu-runner.js (un JSON par seed) : pour chaque version,
// mediane par seed puis min/max/mediane-des-medianes sur les seeds.
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const seeds = argv.filter((a) => !a.startsWith("--"));
const LABEL = (argv.find((a) => a.startsWith("--label-new=")) || "").split("=").slice(1).join("=") || "v1.4.0";
const versions = ["perf10", LABEL];
const perVersion = { perf10: [], [LABEL]: [] };
let orderLines = [];

for (const s of seeds) {
  const file = path.join(__dirname, `run-s${s}.json`);
  const txt = fs.readFileSync(file, "utf-8");
  const res = JSON.parse(txt.slice(txt.indexOf("{")));
  orderLines.push(`  seed ${s}: ${res.passes.map((p) => p.name).join(" -> ")}`);
  for (const v of versions) {
    const a = res.agg[v];
    perVersion[v].push({
      seed: s,
      uploadNs: a.uploadNs,
      wallTotalMs: a.wallTotalAvg,
      gpuMs: a.gpuMed,
    });
  }
}

console.log("Ordre des passes par seed :");
console.log(orderLines.join("\n"));
console.log();

// NOTE unités : uploadNs est en ns (runner : (ms/UPLOADS)*1e6) → /1000 pour µs ;
// wallTotalMs est en ms ; gpuMed est en ms (queryResult/1e6) → *1000 pour µs.
// (Les versions précédentes affichaient uploadNs en ns et gpuMed en ms sous
// des étiquettes µs — les ratios étaient corrects, pas les valeurs.)
const SCALE = { uploadNs: 1 / 1000, wallTotalMs: 1, gpuMs: 1000 };
const stats = (arr, key, unit) => {
  const vals = arr.map((x) => x[key]).sort((a, b) => a - b);
  const med = vals[Math.floor(vals.length / 2)];
  const fmt = (x) => (SCALE[key] * x).toFixed(unit === "us" ? 1 : 3);
  console.log(
    `  ${key}: ${vals.map((v) => fmt(v)).join(" / ")}` +
      ` ${unit} | min ${fmt(vals[0])} | max ${fmt(vals[vals.length - 1])} | mediane ${fmt(med)}`
  );
  return { min: vals[0], max: vals[vals.length - 1], med };
};

for (const v of versions) {
  console.log(`== ${v} (${perVersion[v].length} seeds) ==`);
  const up = stats(perVersion[v], "uploadNs", "us");
  const wall = stats(perVersion[v], "wallTotalMs", "ms");
  const gpu = stats(perVersion[v], "gpuMs", "us");
  console.log();
}

// Ratios
const ratio = (a, b) => a.med / b.med;
console.log("== Ratios (mediane des medianes) ==");
const up = {
  p10: stats(perVersion.perf10, "uploadNs", "us"),
  v14: stats(perVersion[LABEL], "uploadNs", "us"),
};
const wall = {
  p10: stats(perVersion.perf10, "wallTotalMs", "ms"),
  v14: stats(perVersion[LABEL], "wallTotalMs", "ms"),
};
console.log(`  upload perf10/${LABEL} : x${ratio(up.p10, up.v14).toFixed(2)}`);
console.log(`  wallTotal perf10/${LABEL} : x${ratio(wall.p10, wall.v14).toFixed(2)}`);
