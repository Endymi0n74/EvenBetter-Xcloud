// Extracts `class WebGL2Player extends BaseCanvasPlayer { ... }` from a
// minified build. String-aware brace matching (quotes/template literals
// skipped) so the WGSL/GLSL shader strings with `{ }` don't break counting.
const fs = require("fs");

function extractClass(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) {
    console.error(`marker not found: ${marker}`);
    process.exit(1);
  }
  const bodyStart = src.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let i = bodyStart;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) {
    console.error("unbalanced braces");
    process.exit(1);
  }
  return src.slice(start, i + 1);
}

const src = fs.readFileSync(process.argv[2], "utf-8");
// marqueur optionnel (argv[4]) : défaut WebGL2Player (compat rétro), ex.
// "class WebGPUPlayer extends BaseCanvasPlayer" pour le chemin WebGPU.
const marker = process.argv[4] || "class WebGL2Player extends BaseCanvasPlayer";
const cls = extractClass(src, marker);
fs.writeFileSync(process.argv[3], cls);
console.log(`extracted ${cls.length} chars (${marker.split(" ")[1]}) -> ${process.argv[3]}`);
