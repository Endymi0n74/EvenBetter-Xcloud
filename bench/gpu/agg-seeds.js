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
    // uploadEmitNs/uploadSyncNs/uploadTotalNs : ajoutés par gpu-runner.js —
    // absents des runs antérieurs → émission = uploadNs (sémantique historique),
    // sync/total = null (affichage « n/a »).
    const emit = a.uploadEmitNs != null ? a.uploadEmitNs : a.uploadNs;
    const sync = a.uploadSyncNs != null ? a.uploadSyncNs : null;
    perVersion[v].push({
      seed: s,
      uploadNs: a.uploadNs,
      uploadEmitNs: emit,
      uploadSyncNs: sync,
      uploadTotalNs: sync != null ? emit + sync : null,
      wallTotalMs: a.wallTotalAvg,
      gpuMs: a.gpuMed,
    });
  }
}

console.log("Ordre des passes par seed :");
console.log(orderLines.join("\n"));
console.log();

// ---------- état machine par seed (avant mesure, si capturé par run-gpu-ci.sh) ----------
// Permet de corréler l'état « haut » / « bas » des uploads GPU (backpressure/sync
// du pipeline vidéo/GPU, mémo projet §7) avec la température/clocks/charge réels.
console.log("État machine par seed (avant mesure) :");
for (const s of seeds) {
  const sf = path.join(__dirname, `state-s${s}.before.json`);
  let line = `  seed ${s}: n/a (pas de state-s${s}.before.json)`;
  if (fs.existsSync(sf)) {
    try {
      const st = JSON.parse(fs.readFileSync(sf, "utf8"));
      const g = st.gpu;
      const c = st.cpu;
      const parts = [];
      parts.push(
        g
          ? `GPU ${g.tempC}°C · util ${g.utilPct}% · SM ${g.smClockMhz} MHz · mem ${g.memClockMhz} MHz · ${g.powerW} W · ${g.pstate}`
          : "GPU n/a"
      );
      parts.push(
        c
          ? `CPU load ${c.loadPct}%` + (c.perfPct != null ? ` · perf ${c.perfPct}%` : "") + (c.clockMhz ? ` · base ${c.clockMhz} MHz` : "")
          : "CPU n/a"
      );
      const t = (st.top || []).slice(0, 3).map((x) => `${x.name}(${x.cpuSeconds}s)`).join(" ");
      if (t) parts.push("top: " + t);
      line = `  seed ${s}: ${parts.join(" | ")}`;
    } catch (e) {
      line = `  seed ${s}: état illisible (${sf})`;
    }
  }
  console.log(line);
}
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
  // Décomposition émission/sync (runs récents uniquement) : l'état « haut »
  // des uploads (backpressure pipeline vidéo/GPU, mémo projet §7) doit se
  // voir dans l'émission (blocage CPU pendant la mise en file), pas dans la
  // sync (sinon ce serait le GPU qui est en retard — croiser avec le draw).
  const hasSplit = perVersion[v].some((x) => x.uploadSyncNs != null);
  if (hasSplit) {
    // uploadEmitNs/uploadSyncNs/uploadTotalNs sont en ns (comme uploadNs) → /1000
    const med = (key) => {
      const vals = perVersion[v].map((x) => x[key]).filter((x) => x != null).sort((a, b) => a - b);
      return vals.length ? vals[Math.floor(vals.length / 2)] / 1000 : null; // ns → µs
    };
    const fmt2 = (x) => (x == null ? "n/a" : x.toFixed(1));
    console.log(
      `  upload split (médianes) : emit ${fmt2(med("uploadEmitNs"))} / sync ${fmt2(med("uploadSyncNs"))} / total ${fmt2(med("uploadTotalNs"))} us`
    );
  }
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
