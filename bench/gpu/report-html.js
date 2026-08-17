// report-html.js — rapport HTML autonome de la validation visuelle du shader
//
// Lit le rapport JSON de visual-diff.js (défaut bench/gpu/visual-diff.json) et
// les PNG de shots/ (défaut bench/gpu/shots/), et produit UN fichier HTML
// autonome : les images sont embarquées en base64 (data URI) → le fichier se
// déplace/s'attache n'importe où, s'ouvre dans n'importe quel navigateur sans
// serveur. Regroupe les 6 cas : banner de verdict global, table de synthèse,
// puis par cas — stats du gate (v1.6.0→v1.7.0) et INFO (perf10→v1.7.0),
// montage labelisé, vignettes cliquables (lightbox).
//
// Usage :
//   node bench/gpu/report-html.js                       # défauts
//   node bench/gpu/report-html.js --report=/tmp/vd.json # autre rapport
//   node bench/gpu/report-html.js --out=/tmp/report.html
//
// Sortie : --out (défaut bench/gpu/visual-diff-report.html, gitignoré).

const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const argVal = (flag, dflt) => {
  const a = process.argv.find((x) => x.startsWith(flag + "="));
  return a ? a.split("=")[1] : dflt;
};
const REPORT = argVal("--report", path.join(DIR, "visual-diff.json"));
const OUT = argVal("--out", path.join(DIR, "visual-diff-report.html"));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");

// charge un PNG en data URI (embarqué) ; introuvable → placeholder
function dataUri(relPath) {
  const abs = path.resolve(process.cwd(), relPath);
  try {
    const b = fs.readFileSync(abs);
    return `data:image/png;base64,${b.toString("base64")}`;
  } catch {
    return null;
  }
}

// échelle de couleur pour maxAbs (bucket du diff mask)
function colorFor(maxAbs) {
  if (maxAbs === 0) return "#3fb950";
  if (maxAbs <= 2) return "#d29922";
  return "#f85149";
}

function statsTable(c) {
  const num = (x) => (x === undefined ? "—" : x.toFixed(4));
  const rows = [
    ["Gate v1.6.0 → v1.7.0 (patch 22)", c.gate],
    ["INFO perf10 → v1.7.0 (upload + shader)", c.info],
  ]
    .map(
      ([label, s]) =>
        `<tr><td>${esc(label)}</td><td>${s.maxAbs}</td><td>${num(s.meanAbs)}</td>` +
        `<td>${s.pctDiff0.toFixed(3)} %</td><td>${s.pctDiff1.toFixed(3)} %</td>` +
        `<td>${s.pctDiff2.toFixed(3)} %</td><td>${s.pctDiff8.toFixed(3)} %</td>` +
        `<td>${s.pctDiff16.toFixed(3)} %</td></tr>`
    )
    .join("");
  return (
    `<table class="stats"><tr><th>Paire</th><th>maxAbs</th><th>meanAbs</th><th>%&gt;0</th>` +
    `<th>%&gt;1</th><th>%&gt;2</th><th>%&gt;8</th><th>%&gt;16</th></tr>${rows}</table>`
  );
}

function caseSection(c, imgs) {
  const pass = c.gate.verdict.startsWith("PASS");
  const kind = esc(c.kind);
  const montage = imgs.montage
    ? `<img class="montage zoom" src="${imgs.montage}" alt="montage ${escAttr(c.id)}">`
    : `<p class="meta">montage absent (run sans images ?)</p>`;
  const thumbs = ["perf10", "v160", "v170", "diff", "heat"]
    .map((tag) => {
      const src = imgs[tag];
      const label = tag === "diff" ? "diff (c→b)" : tag;
      const inner = src
        ? `<img class="zoom" src="${src}" alt="${escAttr(label)} ${escAttr(c.id)}">`
        : `<p class="meta">n/a</p>`;
      return `<figure>${inner}<figcaption>${esc(label)}</figcaption></figure>`;
    })
    .join("");
  const heat = c.heat
    ? ` · heat: ${c.heat.reduce((a, b) => a + b, 0)} px répartis sur ${c.heat.filter((n) => n > 0).length}/144 tuiles`
    : "";
  return (
    `<section class="case" id="${escAttr(c.id)}">` +
    `<h2><span class="kind">${kind}</span> ${esc(c.id)} ` +
    `<span class="${pass ? "pass" : "fail"}">${esc(c.gate.verdict)}</span>${heat}</h2>` +
    `<div class="meta">seek: t=${c.vstate ? c.vstate.t : "?"} (paused=${c.vstate ? c.vstate.paused : "?"})</div>` +
    statsTable(c) + montage + `<div class="thumbs">${thumbs}</div></section>`
  );
}

function build(report) {
  const allPass = report.cases.every((c) => c.gate.verdict.startsWith("PASS"));
  const banner = allPass
    ? `<div class="banner ok">✅ VALIDATION VISUELLE OK — le USM 4 taps est équivalent au 9 taps (gate v1.6.0 → v1.7.0)</div>`
    : `<div class="banner bad">❌ AU MOINS UN CAS DU GATE EN ÉCHEC — voir détail ci-dessous</div>`;

  const sumRows = report.cases
    .map((c) => {
      const cls = c.gate.verdict.startsWith("PASS") ? "pass" : "fail";
      return (
        `<tr><td>${esc(c.id)}</td><td>${esc(c.kind)}</td>` +
        `<td><span style="color:${colorFor(c.gate.maxAbs)}">${c.gate.maxAbs}</span></td>` +
        `<td>${c.gate.pctDiff1.toFixed(4)} %</td><td>${c.info.maxAbs}</td>` +
        `<td class="${cls}">${esc(c.gate.verdict)}</td></tr>`
      );
    })
    .join("");

  const cases = report.cases
    .map((c) => {
      const imgs = {};
      for (const f of c.images || []) {
        const m = f.match(/\.(perf10|v160|v170|diff|heat|montage)\.png$/);
        if (m) imgs[m[1]] = dataUri(f);
      }
      return caseSection(c, imgs);
    })
    .join("");

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Validation visuelle USM — ${esc(report.size)}</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: ui-monospace, Consolas, monospace; background: #0d1117; color: #e6edf3; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #8b949e; font-size: 12px; }
  .banner { padding: 12px 16px; border-radius: 8px; font-weight: 700; margin: 16px 0; }
  .banner.ok { background: #12261b; color: #3fb950; border: 1px solid #238636; }
  .banner.bad { background: #2d1215; color: #f85149; border: 1px solid #da3633; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin: 10px 0; }
  th, td { border: 1px solid #30363d; padding: 4px 8px; text-align: right; }
  th { background: #161b22; }
  td:first-child, th:first-child { text-align: left; }
  .pass { color: #3fb950; font-weight: 700; }
  .fail { color: #f85149; font-weight: 700; }
  .case { border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin: 20px 0; background: #161b22; }
  .case h2 { font-size: 14px; margin: 0 0 8px; }
  .kind { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: #30363d; margin-right: 8px; }
  .montage { width: 100%; border: 1px solid #30363d; border-radius: 4px; margin-top: 10px; }
  .thumbs { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .thumbs figure { margin: 0; flex: 1 1 130px; min-width: 110px; }
  .thumbs img { width: 100%; cursor: zoom-in; border: 1px solid #30363d; border-radius: 4px; }
  .thumbs figcaption { font-size: 10px; color: #8b949e; text-align: center; margin-top: 4px; }
  #lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.85); display: none; align-items: center; justify-content: center; cursor: zoom-out; z-index: 10; }
  #lightbox img { max-width: 96vw; max-height: 96vh; }
</style></head><body>
<h1>Validation visuelle USM — ${esc(report.size)}</h1>
<div class="meta">${esc(report.date ? new Date(report.date).toLocaleString("fr-FR") : "date n/a")} · ${esc(report.renderer)}</div>
${banner}
<table><tr><th>Cas</th><th>Type</th><th>Gate maxAbs</th><th>Gate %&gt;1</th><th>INFO maxAbs</th><th>Verdict</th></tr>${sumRows}</table>
${cases}
<div id="lightbox" onclick="this.style.display='none'"><img id="lightboxImg" alt=""></div>
<script>
  const lb = document.getElementById("lightbox"), lbImg = document.getElementById("lightboxImg");
  document.addEventListener("click", (e) => {
    if (e.target.classList && e.target.classList.contains("zoom")) { lbImg.src = e.target.src; lb.style.display = "flex"; }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") lb.style.display = "none"; });
</script>
</body></html>`;
}

const report = JSON.parse(fs.readFileSync(REPORT, "utf-8"));
fs.writeFileSync(OUT, build(report), "utf-8");
const sizeKb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`rapport HTML écrit : ${OUT} (${sizeKb} Ko, ${report.cases.length} cas, autonome)`);
