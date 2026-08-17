// visual-diff.js — validation visuelle du shader USM (patch 22 : 9 taps → 4 taps)
//
// Le harnais GPU (gpu-runner.js) prouve la performance (draw −30 %), pas
// l'équivalence visuelle : les 4 échantillons bilinéaires (±0,5 texel) sont
// algébriquement identiques à la gaussienne 3×3 en 9 fetches (vérifié
// bit-identique en fp64), mais le rendu réel peut diverger (précision du filtre
// bilinéaire HW, ordre des sommes). Ce script rend TROIS variantes sur du
// texte fin (pire cas : contours à fort contraste) dans le vrai backend
// (Edge/ANGLE), et compare pixel à pixel.
//
//   - v1.6.0  (gpu-v160-webgl2player.txt) : USM 9 taps, upload texStorage2D/RGB8
//   - v1.7.0  (gpu-v170-usm-webgl2player.txt) : USM 4 taps bilinéaires, MÊME
//     upload — les deux classes ne diffèrent QUE de la ligne du shader
//     (vérifié : diff d'1 seule ligne). C'est le contrôle qui isole le patch 22.
//   - perf10  (gpu-perf10-webgl2player.txt) : référence amont — diffère AUSSI
//     du chemin d'upload (texImage2D, patches 13-20) : comparaison informative.
//
// Trois niveaux de vérification sur le gate v1.6.0 → v1.7.0 (du plus strict au
// toléré) :
//   1. ISOLATION (processing=cas) : le bloc CAS est identique dans les deux
//      classes → tolérance ±1/255 (le compilateur GLSL peut réordonner le
//      scheduling à cause du return anticipé du 4 taps → 1-ULP fp32 sur une
//      poignée de pixels). Aucun écart > 2 : sinon le portage a touché autre
//      chose que le branch USM.
//   2. IDENTITÉ (usm, sharpness=0) : sharpenFactor == 0 → les deux variantes
//      renvoient e inchangé → diff DOIT être exactement 0 (maxAbs == 0).
//   3. ÉQUIVALENCE (usm, sharpness 2/10) : mêmes poids, seul l'ordre
//      d'évaluation diffère → tolérance ±1/255, ≥ 99,9 % des pixels identiques.
//      Une régression réelle (offsets faux, mauvaise division) produit des
//      écarts ≥ 8 sur les contours → FAIL.
//
// La paire perf10 → v1.7.0 (upload + shader) est affichée en table INFO : on
// attend de petits écarts (~0,4 % des pixels, max ~74 — pixels de contours où
// la conversion d'upload RGB vs RGB8 diffère d'un ou deux crans), PAS un gate.
//
// Sortie IMAGES (défaut ON, --no-images pour désactiver) — comparaison image
// par image, dans --out-dir (défaut bench/gpu/shots/) :
//   shot-<id>.perf10.png / .v160.png / .v170.png   screenshots des 3 variantes
//   shot-<id>.diff.png       v1.7.0 avec pixels différents recolés par bucket
//                            (1 → rouge, 2-3 → orange, 4-15 → jaune, ≥16 → blanc)
//   shot-<id>.montage.png    perf10 | v1.6.0 | v1.7.0 | diff, labelisés
//   shot-<id>.heat.png       heatmap 16×9 : localisation spatiale des diffs
// + heat (compteurs par tuile) dans le rapport JSON.
//
// Usage :
//   node bench/gpu/visual-diff.js                  # protocole complet (défauts)
//   node bench/gpu/visual-diff.js --size=960x540   # plus de pixels de texte
//   node bench/gpu/visual-diff.js --headed         # fenêtre visible (debug)
//   node bench/gpu/visual-diff.js --keep-video     # réutilise test-text.webm
//   node bench/gpu/visual-diff.js --no-images      # gate seul, sans PNG
//   node bench/gpu/visual-diff.js --out=/tmp/vd.json
//   node bench/gpu/visual-diff.js --out-dir=/tmp/shots
//
// Exit 0 = gate v1.6.0→v1.7.0 tout PASS (validation visuelle OK), 1 sinon.
// Rapport JSON écrit dans --out (défaut bench/gpu/visual-diff.json).

const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const argVal = (flag, dflt) => {
  const a = process.argv.find((x) => x.startsWith(flag + "="));
  return a ? a.split("=")[1] : dflt;
};
const CHANNEL = argVal("--channel", "msedge"); // "chromium" = build Playwright (Linux/CI)
const HEADED = process.argv.includes("--headed");
const KEEP_VIDEO = process.argv.includes("--keep-video");
const SIZE = argVal("--size", "640x360");
const [W, H] = SIZE.split("x").map(Number);
const FILE_P10 = argVal("--cls-p10", path.join(DIR, "gpu-perf10-webgl2player.txt"));
const FILE_OLD = argVal("--cls-old", path.join(DIR, "gpu-v160-webgl2player.txt"));
const FILE_NEW = argVal("--cls-new", path.join(DIR, "gpu-v170-usm-webgl2player.txt"));
const OUT = argVal("--out", path.join(DIR, "visual-diff.json"));
const OUT_DIR = argVal("--out-dir", path.join(DIR, "shots"));
const IMAGES = !process.argv.includes("--no-images");
const TEXT_VIDEO = path.join(DIR, "test-text.webm");
const PORT = 8768;

// Cartes de texte fin (statiques → déterministes). Chaque carte dure 1,2 s ;
// échantillonnée à mi-carte (loin des transitions). Texte fin = pire cas pour
// le USM (contours à fort contraste, crénelage) : toute différence d'offsets
// ou de pondération y devient visible.
const CARD_DUR = 1.2;
const CARDS = [
  { t: 0.6, bg: "#f5f5f5", fg: "#1a1a1a", font: '8px "Times New Roman", serif',
    lines: ["The quick brown fox jumps over the lazy dog 0123456789",
            "l'Étranger é à ç ù â ê î ô û — « L'été »",
            "Il1O0 il1O0 | il1O0 5e ligne (2e paragraphe)",
            "0.123456789 9876543210 60fps/120fps — RVB 8 bits"] },
  { t: 1.8, bg: "#ffffff", fg: "#111111", font: '10px Arial, sans-serif',
    lines: ["Validation visuelle du shader USM 4 taps",
            "contours fins 1px, crénelage complet",
            "contraste maximal texte / fond clair",
            "0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ"] },
  { t: 3.0, bg: "#0a0a0a", fg: "#f0f0f0", font: '12px Consolas, monospace',
    lines: ["iIl1|O0Ø — Étranger 9e ligne, 120fps",
            "let a = texture(tex, coord + texelSize * vec2(-0.5, 0.5))",
            "return e + (e - gaussianBlur) * sharpenFactor / 3.0;",
            "minRgb = min(min(min(d, e), min(f, b)), h);"] },
  { t: 4.2, bg: "#dddddd", fg: "#333333", font: '9px Verdana, sans-serif',
    lines: ["UI 9px : libellés courts, bordures 1px",
            "OK Annuler Enregistrer Supprimer — x̄",
            "bordures de cartes et séparateurs fins",
            "8.5 lignes de texte dense sur fond gris"] },
];

// ---- 1. Génération de la vidéo de texte fin (canvas + captureStream) ----
async function genTextVideo(page) {
  await page.setContent(`<!doctype html><html><body>
    <canvas id="c" width="${W}" height="${H}"></canvas>
  </body></html>`);
  const res = await page.evaluate(async ({ W, H, CARDS, CARD_DUR }) => {
    const canvas = document.getElementById("c");
    const ctx = canvas.getContext("2d");
    const draw = () => {
      const elapsed = (Date.now() - t0) / 1000;
      const idx = Math.min(CARDS.length - 1, Math.floor(elapsed / CARD_DUR));
      const card = CARDS[idx];
      ctx.fillStyle = card.bg;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = card.fg;
      ctx.font = card.font;
      ctx.textBaseline = "top";
      let y = 14;
      for (const line of card.lines) {
        ctx.fillText(line, 8, y);
        y += Math.ceil(parseFloat(card.font) * 1.5);
      }
      // bordures fines (cas des UIs) sur la 4e carte
      if (idx === 3) {
        ctx.strokeStyle = "#888";
        ctx.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
          ctx.strokeRect(8 + i * 130, H - 60, 120, 48);
          ctx.fillText("btn " + i, 14 + i * 130, H - 52);
        }
      }
    };
    const t0 = Date.now();
    draw();
    const stream = canvas.captureStream(30);
    let mime = "video/webm;codecs=vp9";
    if (!MediaRecorder.isTypeSupported(mime)) mime = "video/webm;codecs=vp8";
    if (!MediaRecorder.isTypeSupported(mime)) mime = "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });
    rec.start(200);
    const iv = setInterval(draw, 33);
    await new Promise((r) => setTimeout(r, CARDS.length * CARD_DUR * 1000 + 400));
    clearInterval(iv);
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: mime });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
    }
    return { mime, size: buf.length, b64: btoa(bin) };
  }, { W, H, CARDS, CARD_DUR });
  fs.writeFileSync(TEXT_VIDEO, Buffer.from(res.b64, "base64"));
  console.log(`[visual-diff] vidéo texte écrite : ${TEXT_VIDEO} (${res.size} o, ${res.mime})`);
  return res;
}

// ---- 2. Harnais en page : rendu des deux variantes + capture pixels ----
const server = http.createServer((req, res) => {
  if (req.url === "/test-text.webm") {
    res.writeHead(200, { "Content-Type": "video/webm", "Content-Length": fs.statSync(TEXT_VIDEO).size });
    res.end(fs.readFileSync(TEXT_VIDEO));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!doctype html><html><head><meta charset="utf-8"></head><body>
    <video id="v" src="/test-text.webm" loop muted playsinline width="${W}" height="${H}"></video>
    <pre id="out"></pre>
  </body></html>`);
});

const HARNESS = ({ clsP10, clsOld, clsNew, W, H, CASES, IMAGES }) => {
  return new Promise(async (resolve) => {
    const fail = (msg) => resolve({ error: msg });
    try {
      window.getStreamPref = () => "default";
      window.BX_FLAGS = { WebGL2NoColorConversion: false };

      class BaseCanvasPlayer {
        constructor(type, $video, name) {
          this.type = type;
          this.$video = $video;
          this.name = name;
          this.$canvas = document.createElement("canvas");
          this.$canvas.width = W;
          this.$canvas.height = H;
          this.options = {
            processing: "usm", processingMode: "performance",
            sharpness: 2, brightness: 100, contrast: 100, saturation: 100,
          };
        }
        toFilterId(p) { return p === "cas" ? 2 : 1; }
        destroy() {}
      }

      const mkPlayer = (clsCode) => {
        const fn = new Function("BaseCanvasPlayer", clsCode + "\n; return WebGL2Player;");
        return new (fn(BaseCanvasPlayer))(video);
      };

      const video = document.getElementById("v");
      video.muted = true;
      // attendre les métadonnées + une vraie frame décodée avant de figer
      for (let i = 0; i < 200; i++) {
        if (video.readyState >= 2 && video.currentTime > 0.05) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      await video.play();
      await new Promise((r) => setTimeout(r, 150));
      video.pause();
      // vérifier que la pause tient vraiment
      for (let i = 0; i < 100 && !video.paused; i++) await new Promise((r) => setTimeout(r, 25));
      if (!video.paused) return fail("video impossible à figer (pause refusée)");

      const pa = mkPlayer(clsP10);   // perf10 (upload texImage2D)
      await pa.setupShaders();
      const pc = mkPlayer(clsOld);   // v1.6.0 (9 taps, upload texStorage2D/RGB8)
      await pc.setupShaders();
      const pb = mkPlayer(clsNew);   // v1.7.0 (4 taps, même upload que v1.6.0)
      await pb.setupShaders();
      // getContext est idempotent → le contexte du canvas du player
      const glA = pa.$canvas.getContext("webgl2");
      const glC = pc.$canvas.getContext("webgl2");
      const glB = pb.$canvas.getContext("webgl2");
      if (!glA || !glC || !glB) return fail("contexte WebGL2 absent (GPU désactivé ?)");
      const dbg = glA.getExtension("WEBGL_debug_renderer_info");
      const renderer = dbg ? glA.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "n/a";

      const settle = () => new Promise((r) => setTimeout(r, 100));

      function diffStats(a, b) {
        let maxAbs = 0, sum = 0;
        const px = a.length / 4;
        const cnt = { d0: 0, d1: 0, d2: 0, d8: 0, d16: 0 };
        for (let i = 0; i < a.length; i += 4) {
          const m = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
          if (m > maxAbs) maxAbs = m;
          sum += m;
          if (m > 0) cnt.d0++;
          if (m > 1) cnt.d1++;
          if (m > 2) cnt.d2++;
          if (m > 8) cnt.d8++;
          if (m > 16) cnt.d16++;
        }
        return {
          maxAbs,
          meanAbs: sum / px,
          pctDiff0: (cnt.d0 / px) * 100,
          pctDiff1: (cnt.d1 / px) * 100,
          pctDiff2: (cnt.d2 / px) * 100,
          pctDiff8: (cnt.d8 / px) * 100,
          pctDiff16: (cnt.d16 / px) * 100,
        };
      }

      // Échantillonne un cas : seek + pause sur le frame, règle les options du
      // player, rend une frame, readPixels plein écran.
      async function sample(p, gl, options) {
        p.options = Object.assign({}, p.options, options);
        p._uniformsDirty = true;
        p.updateFrame();
        const px = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      }

      // Images (comparaison image par image) : les screenshots sont construits
      // depuis les buffers readPixels (les canvases WebGL ont
      // preserveDrawingBuffer:false → toDataURL direct serait noir) en
      // réinversant Y (readPixels lit du bas vers le haut).
      function buildImages(a1, c1, b1) {
        const mkCanvas = (px) => {
          const cv = document.createElement("canvas");
          cv.width = W;
          cv.height = H;
          const ctx = cv.getContext("2d");
          const img = ctx.createImageData(W, H);
          for (let y = 0; y < H; y++) {
            const src = (H - 1 - y) * W * 4; // readPixels : y=0 en bas
            img.data.set(px.subarray(src, src + W * 4), y * W * 4);
          }
          ctx.putImageData(img, 0, 0);
          return cv;
        };
        const a = mkCanvas(a1), c = mkCanvas(c1), b = mkCanvas(b1);

        // diff : image v1.7.0 avec pixels différents recolés par magnitude
        const diffCv = document.createElement("canvas");
        diffCv.width = W;
        diffCv.height = H;
        const dctx = diffCv.getContext("2d");
        dctx.drawImage(b, 0, 0);
        const dImg = dctx.getImageData(0, 0, W, H);
        const dd = dImg.data;
        for (let i = 0; i < c1.length; i += 4) {
          const m = Math.max(Math.abs(c1[i] - b1[i]), Math.abs(c1[i + 1] - b1[i + 1]), Math.abs(c1[i + 2] - b1[i + 2]));
          if (m > 0) {
            const col = m <= 1 ? [255, 0, 0] : m <= 3 ? [255, 128, 0] : m <= 15 ? [255, 255, 0] : [255, 255, 255];
            dd[i] = col[0]; dd[i + 1] = col[1]; dd[i + 2] = col[2]; dd[i + 3] = 255;
          }
        }
        dctx.putImageData(dImg, 0, 0);

        // montage labelisé : perf10 | v1.6.0 | v1.7.0 | diff
        const LBL = 18, GAP = 4;
        const mcv = document.createElement("canvas");
        mcv.width = W * 4 + GAP * 3;
        mcv.height = H + LBL;
        const mctx = mcv.getContext("2d");
        mctx.fillStyle = "#111";
        mctx.fillRect(0, 0, mcv.width, mcv.height);
        mctx.font = "12px monospace";
        ["perf10", "v1.6.0", "v1.7.0", "diff(c→b)"].forEach((label, i) => {
          const x = i * (W + GAP);
          mctx.fillStyle = "#ddd";
          mctx.fillText(label, x + 4, 13);
          mctx.drawImage([a, c, b, diffCv][i], x, LBL);
        });

        // heatmap 16×9 : intensité ∝ nombre de pixels différents par tuile
        const cols = 16, rows = 9;
        const tw = Math.ceil(W / cols), th = Math.ceil(H / rows);
        const tile = new Array(cols * rows).fill(0);
        for (let y = 0; y < H; y++) {
          const ty = Math.min(rows - 1, Math.floor(y / th));
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const m = Math.max(Math.abs(c1[i] - b1[i]), Math.abs(c1[i + 1] - b1[i + 1]), Math.abs(c1[i + 2] - b1[i + 2]));
            if (m > 0) tile[ty * cols + Math.min(cols - 1, Math.floor(x / tw))]++;
          }
        }
        const heatCv = document.createElement("canvas");
        heatCv.width = W;
        heatCv.height = H;
        const hctx = heatCv.getContext("2d");
        hctx.fillStyle = "#000";
        hctx.fillRect(0, 0, W, H);
        const max = Math.max(1, ...tile);
        tile.forEach((n, i) => {
          const alpha = 0.15 + 0.85 * Math.sqrt(n / max); // sqrt : compresse l'échelle
          hctx.fillStyle = `rgba(255, 0, 0, ${alpha.toFixed(3)})`;
          hctx.fillRect((i % cols) * tw, Math.floor(i / cols) * th, tw, th);
        });

        return {
          aPng: a.toDataURL("image/png"),
          cPng: c.toDataURL("image/png"),
          bPng: b.toDataURL("image/png"),
          diffPng: diffCv.toDataURL("image/png"),
          montagePng: mcv.toDataURL("image/png"),
          heatPng: heatCv.toDataURL("image/png"),
          heat: tile,
        };
      }

      const out = { renderer, cases: [] };

      // Seek robuste : retry ×3, et échec dur si le frame ne tombe pas sur t.
      // Piège vécu : sur cet Edge, un seek ARRIÈRE proche de la fin (4,2 → 3,0)
      // remet currentTime à 0 — les cas doivent être ordonnés en t croissant.
      async function seekTo(t) {
        for (let attempt = 0; attempt < 3; attempt++) {
          video.currentTime = t;
          await new Promise((r) => {
            video.onseeked = r;
            setTimeout(r, 2000); // garde : seeked peut ne pas tirer si frame déjà dispo
          });
          for (let i = 0; i < 200; i++) {
            if (!video.seeking && Math.abs(video.currentTime - t) < 0.01 && video.readyState >= 2) break;
            await new Promise((r) => setTimeout(r, 25));
          }
          await settle();
          if (Math.abs(video.currentTime - t) < 0.05) return true;
        }
        return false;
      }

      for (const c of CASES) {
        if (Math.abs(video.currentTime - c.t) > 0.01) {
          const ok = await seekTo(c.t);
          if (!ok) {
            resolve({ error: `seek échoué pour ${c.id} (t=${c.t}, currentTime=${video.currentTime}) — harnais invalide` });
            return;
          }
        }
        const vstate = {
          paused: video.paused,
          t: video.currentTime,
          ready: video.readyState,
          seeking: video.seeking,
        };
        const a1 = await sample(pa, glA, c.options);   // perf10
        const a2 = await sample(pa, glA, c.options);   // self-check A (déterminisme)
        const c1 = await sample(pc, glC, c.options);   // v1.6.0 (9 taps)
        const c2 = await sample(pc, glC, c.options);   // self-check C
        const b1 = await sample(pb, glB, c.options);   // v1.7.0 (4 taps)
        const b2 = await sample(pb, glB, c.options);   // self-check B
        // le diff est calculé EN PAGE (les pixels ne sortent pas de la page —
        // renvoyer 36 × 921 Ko vers Node saturait le heap)
        const caseOut = {
          id: c.id, kind: c.kind, vstate,
          self: { a: diffStats(a1, a2), c: diffStats(c1, c2), b: diffStats(b1, b2) },
          gate: diffStats(c1, b1), // v1.6.0 9 taps → v1.7.0 4 taps (isole le patch 22)
          info: diffStats(a1, b1), // perf10 → v1.7.0 (upload + shader cumulés)
        };
        if (IMAGES) caseOut.images = buildImages(a1, c1, b1);
        out.cases.push(caseOut);
        console.log(`[visual-diff] cas ${c.id} rendu (perf10 + v1.6.0 + v1.7.0)`);
      }
      resolve(out);
    } catch (e) {
      fail(String((e && e.stack) || e));
    }
  });
};

// ---- 3. Verdicts (Node) — le diff est calculé en page, seules les stats arrivent ici ----
function verdictFor(c, stats) {
  if (c.kind === "identity") {
    // sharpness=0 : les deux variantes renvoient e inchangé → diff DOIT être 0
    return stats.maxAbs === 0 ? "PASS (identique)" : "FAIL";
  }
  // isolation (CAS) et equivalence (USM 2/10) : mêmes poids, mais le
  // compilateur GLSL peut réordonner le scheduling (le return anticipé du
  // 4 taps) → 1-ULP fp32 sur une poignée de pixels (0,002 %, maxAbs 1).
  // La valeur forte : AUCUN écart > 2 (une vraie régression d'offsets ou de
  // pondération produit des écarts ≥ 8 sur les contours).
  return stats.maxAbs <= 2 && stats.pctDiff1 <= 0.1 ? "PASS (tolérance ±1/255)" : "FAIL";
}

// Cas de test : une carte de texte fin × un réglage.
//  - isolation : processing=cas → chemin CAS identique dans les deux classes
//  - identity   : usm sharpness=0 → return e inchangé dans les deux
//  - equivalence: usm sharpness 2 (défaut) et 10 (max)
// ORDRE IMPÉRATIF : t strictement croissant (les seeks arrière proches de la
// fin échouent sur cet Edge → currentTime remis à 0). Deux cas au même t : le
// second ne re-seek pas (|currentTime - t| < 0.01).
const CASES = [
  { id: "usm-sharp2-card1", kind: "equivalence",t: 0.6, options: { processing: "usm",  sharpness: 2 } },
  { id: "cas-sharp2-card1", kind: "isolation",  t: 0.6, options: { processing: "cas",  sharpness: 2 } },
  { id: "usm-sharp0-card2", kind: "identity",   t: 1.8, options: { processing: "usm",  sharpness: 0 } },
  { id: "usm-sharp10-card2",kind: "equivalence",t: 1.8, options: { processing: "usm",  sharpness: 10 } },
  { id: "usm-sharp10-card3",kind: "equivalence",t: 3.0, options: { processing: "usm",  sharpness: 10 } },
  { id: "usm-sharp2-card4", kind: "equivalence",t: 4.2, options: { processing: "usm",  sharpness: 2 } },
];

(async () => {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const launchOpts = { headless: !HEADED };
  if (CHANNEL !== "chromium") launchOpts.channel = CHANNEL;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: W + 40, height: H + 80 } });
  page.on("console", (m) => console.log(`  [page] ${m.text()}`));
  page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));

  if (!fs.existsSync(TEXT_VIDEO) || !KEEP_VIDEO) {
    await genTextVideo(page);
  }
  const clsP10 = fs.readFileSync(FILE_P10, "utf-8");
  const clsOld = fs.readFileSync(FILE_OLD, "utf-8");
  const clsNew = fs.readFileSync(FILE_NEW, "utf-8");
  await page.goto(`http://127.0.0.1:${PORT}/`);
  const raw = await Promise.race([
    page.evaluate(HARNESS, { clsP10, clsOld, clsNew, W, H, CASES, IMAGES }),
    new Promise((_, rej) => setTimeout(() => rej(new Error("page.evaluate timeout 120s")), 120000)),
  ]);
  // Fermeture robuste : comme gpu-runner.js — une erreur de close ne doit pas
  // faire perdre un run complet (le rapport JSON est écrit après, en Node).
  try { await browser.close(); } catch (e) { console.error(`[visual-diff] browser.close: ${e}`); }
  try { server.close(); } catch (e) { console.error(`[visual-diff] server.close: ${e}`); }

  if (raw.error) {
    console.error(`[visual-diff] ERREUR harnais : ${raw.error}`);
    process.exit(1);
  }

  if (IMAGES) fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = { date: new Date().toISOString(), size: `${W}x${H}`, renderer: raw.renderer, outDir: IMAGES ? OUT_DIR : null, cases: [] };
  let allPass = true;
  const row = (id, kind, s, verdict) =>
    `${id.padEnd(22)} | ${kind.padEnd(10)} | ${String(s.maxAbs).padEnd(6)} | ${s.meanAbs.toFixed(4).padEnd(8)} | ` +
    `${s.pctDiff0.toFixed(3).padEnd(6)} | ${s.pctDiff1.toFixed(3).padEnd(6)} | ${s.pctDiff2.toFixed(3).padEnd(6)} | ` +
    `${s.pctDiff8.toFixed(3).padEnd(5)} | ${verdict}`;
  const header = "cas                   | type       | maxAbs | meanAbs | %>0    | %>1    | %>2    | %>8   | verdict";
  const rule = "----------------------|------------|--------|---------|--------|--------|--------|-------|-------------------";

  console.log(`\n[visual-diff] rendu ${raw.renderer}\n`);
  console.log("== GATE (isole le patch 22) : v1.6.0 9 taps vs v1.7.0 4 taps — même chemin d'upload ==");
  console.log(header);
  console.log(rule);
  for (const c of raw.cases) {
    for (const [tag, s] of Object.entries(c.self)) {
      if (s.maxAbs !== 0) {
        console.log(`  [!] self-check ${tag} ${c.id} : deux rendus du MÊME player diffèrent (maxAbs=${s.maxAbs}) — harnais instable`);
      }
    }
    const caseDef = CASES.find((x) => x.id === c.id);
    const verdict = verdictFor(caseDef, c.gate);
    if (!verdict.startsWith("PASS")) allPass = false;
    const rec = { id: c.id, kind: c.kind, vstate: c.vstate, gate: { ...c.gate, verdict }, info: c.info };
    if (IMAGES && c.images) {
      const base = path.join(OUT_DIR, "shot-" + c.id);
      const save = (suffix, b64) => fs.writeFileSync(base + suffix, Buffer.from(b64.split(",")[1], "base64"));
      save(".perf10.png", c.images.aPng);
      save(".v160.png", c.images.cPng);
      save(".v170.png", c.images.bPng);
      save(".diff.png", c.images.diffPng);
      save(".montage.png", c.images.montagePng);
      save(".heat.png", c.images.heatPng);
      rec.heat = c.images.heat;
      rec.images = [".perf10.png", ".v160.png", ".v170.png", ".diff.png", ".montage.png", ".heat.png"]
        .map((s) => path.relative(process.cwd(), base + s));
    }
    report.cases.push(rec);
    console.log(row(c.id, c.kind, c.gate, verdict));
  }
  console.log("\n== INFO (cumul upload texImage2D→texStorage2D + shader) : perf10 vs v1.7.0 — pas un gate ==");
  console.log(header);
  console.log(rule);
  for (const c of raw.cases) {
    const caseDef = CASES.find((x) => x.id === c.id);
    console.log(row(c.id, caseDef.kind, c.info, "—"));
  }
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  const imgNote = IMAGES ? ` + images ${path.relative(process.cwd(), OUT_DIR)}/shot-<id>.*.png` : "";
  console.log(`\n[visual-diff] ${allPass ? "VALIDATION VISUELLE OK — le USM 4 taps est équivalent au 9 taps (v1.6.0→v1.7.0)" : "AU MOINS UN CAS DU GATE EN ÉCHEC"} → rapport ${OUT}${imgNote}`);
  process.exit(allPass ? 0 : 1);
})();
