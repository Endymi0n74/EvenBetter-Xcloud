// gpu-runner-webgpu.js — mesure du draw GPU du chemin WebGPU (WebGPUPlayer)
//
// Compare deux classes WebGPUPlayer extraites du build : OLD (shader WGSL USM
// 9 fetches) vs NEW (USM 4 échantillons bilinéaires, return avant les fetches).
//
// MÉTRIQUE — les timestamp queries WebGPU sont cassées dans cet Edge (la
// feature timestamp-query est déclarée mais timestampWrites rendent des valeurs
// identiques et queue.writeTimestamp n'existe pas — vérifié 17/08). On mesure
// donc le split émission/sync du protocole GPU (comme gpu-runner.js) côté
// WebGPU : N updateFrame batchées puis barrière device.queue.onSubmittedWorkDone
// (équivalent fiable de la complétion GPU, contrairement à gl.finish/fenceSync
// en WebGL2).
//   - emitNs  : coût CPU de l'émission des N frames (encodage command buffer)
//   - frameNs : temps de pipeline par frame (fenêtre complète émission →
//              complétion GPU, / N) — en régime GPU-bound c'est le temps GPU,
//              la différence 9 taps vs 4 taps (coût du fragment shader) y
//              apparaît. N par défaut 400 (déquantification de performance.now).
//   - syncNs  : frameNs - emitNs (rattrapage GPU)
//
// Cible hors-écran : le render pass est redirigé vers une texture offscreen
// (wrapper du command encoder) — isole import + draw du pacing de présentation
// du compositor (getCurrentTexture, cadence ~2 ms en headless) qui quantifiait
// la fenêtre et faussait la variance passe à passe.
//
// IMPORTANT — Playwright inhibe navigator.gpu (même en headed) : le harnais
// lance le VRAI binaire Edge (--headless=new ou headed) + un profil temporaire,
// et se connecte via CDP (comme les outils preview). Vérifié : navigator.gpu
// présent, adapter hardware.
//
// Usage :
//   node bench/gpu/gpu-runner-webgpu.js --seed=42
//       [--cls-old=FILE --label-old=9tap] [--cls-new=FILE --label-new=4tap]
//       [--frames=120 --passes=3 --out=run-s42-webgpu.json]
//       [--headed]   par défaut --headless=new (WebGPU OK, vérifié)
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const HEADED = process.argv.includes("--headed");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const DIR = __dirname;
const PROFILE = path.join(DIR, "_edge-profile-wgpu");
const CDP_PORT = 9224;
const HTTP_PORT = 8768;

const argVal = (flag, dflt) => {
  const a = process.argv.find((x) => x.startsWith(flag + "="));
  return a ? a.split("=")[1] : dflt;
};
const FILE_OLD = argVal("--cls-old", path.join(DIR, "gpu-webgpu-9tap.txt"));
const FILE_NEW = argVal("--cls-new", path.join(DIR, "gpu-webgpu-4tap.txt"));
const LABEL_OLD = argVal("--label-old", "9tap");
const LABEL_NEW = argVal("--label-new", "4tap");
const OUT = argVal("--out", path.join(DIR, "run-s42-webgpu.json"));
const SEED = parseInt(argVal("--seed", String(Date.now() % 1000000)), 10);
const FRAMES = parseInt(argVal("--frames", "400"), 10);
const PASSES = parseInt(argVal("--passes", "3"), 10);

const clsOld = fs.readFileSync(FILE_OLD, "utf-8");
const clsNew = fs.readFileSync(FILE_NEW, "utf-8");
const VIDEO = fs.readFileSync(path.join(DIR, "test.webm"));

// ---------- serveur http : vidéo + page ----------
const server = http.createServer((req, res) => {
  if (req.url === "/test.webm") {
    res.writeHead(200, { "Content-Type": "video/webm", "Content-Length": VIDEO.length });
    res.end(VIDEO);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!doctype html><html><head><meta charset="utf-8"></head><body>
    <video id="v" src="/test.webm" loop muted playsinline autoplay width="640" height="360"></video>
    <pre id="out"></pre>
  </body></html>`);
});

// ---------- harnais exécuté dans la page ----------
const HARNESS = ({ clsOld, clsNew, LABEL_OLD, LABEL_NEW, FRAMES, PASSES, SEED }) => {
  return new Promise(async (resolve) => {
    const fail = (msg) => resolve({ error: msg });

    const mulberry32 = (a) => () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const shuffle = (arr, rnd) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    const stat = (arr) => {
      const s = [...arr].sort((a, b) => a - b);
      return {
        med: s[Math.floor(s.length / 2)],
        p95: s[Math.floor(s.length * 0.95)],
        avg: arr.reduce((x, y) => x + y, 0) / arr.length,
      };
    };

    window.BX_FLAGS = { EnableWebGPURenderer: true };

    class BaseCanvasPlayer {
      constructor(type, $video, name) {
        this.type = type;
        this.$video = $video;
        this.name = name;
        // Canvas 1920×1080 (résolution réelle des streams xCloud) : le draw
        // coûte ~9× plus cher qu'à 640×360, ce qui sort le signal du bruit de
        // performance.now() sous Windows (résolution ~100 µs) et amplifie la
        // différence 9 taps vs 4 taps (coût fragment shader).
        this.$canvas = document.createElement("canvas");
        this.$canvas.width = 1920;
        this.$canvas.height = 1080;
        this.options = {
          processing: "usm", processingMode: "performance",
          sharpness: 2, brightness: 100, contrast: 100, saturation: 100,
        };
      }
      toFilterId(p) { return p === "cas" ? 2 : 1; }
      destroy() {}
    }    // ---------- device WebGPU ----------
    let device = null;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return fail("aucun adapter WebGPU");
      device = await adapter.requestDevice();
    } catch (e) {
      return fail("requestAdapter/requestDevice: " + String(e));
    }

    // Cible HORS-ÉCRAN : le render pass du player est redirigé vers une
    // texture offscreen au lieu du canvas. Le pacing de présentation du
    // compositor (getCurrentTexture → cadence ~2 ms en headless) parasite la
    // mesure (quantification ±2 ms sur la fenêtre, variance passe à passe).
    // En hors-écran, la frame mesurée = import de texture vidéo + draw seul.
    const offscreenView = device.createTexture({
      size: [1920, 1080],
      format: navigator.gpu.getPreferredCanvasFormat(),
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    }).createView();
    const origCCE = device.createCommandEncoder.bind(device);
    device.createCommandEncoder = (desc) => {
      const enc = origCCE(desc);
      const origBRP = enc.beginRenderPass.bind(enc);
      enc.beginRenderPass = (d) => {
        if (d && d.colorAttachments && d.colorAttachments.length) {
          d = {
            ...d,
            colorAttachments: d.colorAttachments.map((c, i) => (i === 0 ? { ...c, view: offscreenView } : c)),
          };
        }
        return origBRP(d);
      };
      return enc;
    };

    const video = document.getElementById("v");
    video.muted = true;
    await video.play();
    for (let i = 0; i < 200; i++) {
      if (video.readyState >= 2 && video.currentTime > 0.3) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    if (video.currentTime <= 0.3) {
      return fail("video not playing: " + video.currentTime);
    }

    async function measure(clsCode, version) {
      console.log("[bx-wgpu] measure start", version);
      const fn = new Function("BaseCanvasPlayer", clsCode + "\n; return WebGPUPlayer;");
      const WebGPUPlayer = fn(BaseCanvasPlayer);
      // le player n'appelle pas prepare() : on injecte le device nous-mêmes
      WebGPUPlayer.device = device;
      const player = new WebGPUPlayer(video);
      player.setupShaders();
      if (!player.pipeline) return fail("setupShaders: pipeline manquant");

      // préchauffage GPU (compilation/caches driver)
      for (let b = 0; b < 3; b++) {
        for (let i = 0; i < 100; i++) player.updateFrame();
        await device.queue.onSubmittedWorkDone();
        await new Promise((r) => setTimeout(r, 50));
      }

      // ÉMISSION (CPU) : N frames batchées — coût d'encodage/soumission seul
      // (WebGPU ne bloque jamais à la soumission).
      const t0e = performance.now();
      for (let i = 0; i < FRAMES; i++) player.updateFrame();
      const emitNs = ((performance.now() - t0e) / FRAMES) * 1e6;
      // BATCH COMPLET : t0 AVANT l'émission → complétion GPU (onSubmittedWorkDone).
      // En régime GPU-bound (emit < gpu), le fenêtre entière ≈ N × temps GPU par
      // frame (le GPU reste saturé) → frameNs = temps de pipeline par frame,
      // déquantifié (N=600 ⇒ ~30 ms ≈ 300 ticks de performance.now()).
      const t0b = performance.now();
      for (let i = 0; i < FRAMES; i++) player.updateFrame();
      await device.queue.onSubmittedWorkDone();
      const frameNs = ((performance.now() - t0b) / FRAMES) * 1e6;
      const syncNs = Math.max(0, frameNs - emitNs);

      // wall par frame (CPU seul, sans attendre le GPU)
      const wall = [];
      for (let i = 0; i < Math.min(FRAMES, 60); i++) {
        const t0 = performance.now();
        player.updateFrame();
        wall.push(performance.now() - t0);
      }

      player.destroy();
      return {
        name: version,
        wall: stat(wall),
        emitNs,
        syncNs,
        frameNs,
        totalNs: emitNs + syncNs,
      };
    }

    try {
      const order = [];
      for (let p = 0; p < PASSES; p++) order.push([LABEL_OLD, clsOld], [LABEL_NEW, clsNew]);
      shuffle(order, mulberry32(SEED));
      console.log("[bx-wgpu] seed", SEED, "| ordre", order.map(([n]) => n).join(" -> "));
      const out = { passes: [], perVersion: { [LABEL_OLD]: [], [LABEL_NEW]: [] } };
      for (const [name, code] of order) {
        const res = await measure(code, name);
        res.name = name;
        out.passes.push(res);
        out.perVersion[name].push(res);
        console.log("[bx-wgpu] pass done:", name);
      }
      const agg = {};
      for (const [name, arr] of Object.entries(out.perVersion)) {
        // 1re passe rejetée : la première exécution de chaque shader paie la
        // compilation/pipeline GPU (drift observé, ~+30 % sur la passe 1).
        const stable = arr.length > 1 ? arr.slice(1) : arr;
        const medOf = (key) => stable.map((p) => p[key]).sort((a, b) => a - b)[Math.floor(stable.length / 2)];
        agg[name] = {
          passesKept: stable.length,
          emitNs: medOf("emitNs"),
          syncNs: medOf("syncNs"),
          frameNs: medOf("frameNs"),
          totalNs: medOf("totalNs"),
          wallMed: stable.map((p) => p.wall.med).sort((a, b) => a - b)[Math.floor(stable.length / 2)],
        };
      }
      resolve({ agg, passes: out.passes });
    } catch (e) {
      fail(String(e && e.stack || e));
    }
  });
};

// ---------- orchestration : Edge réel + CDP ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(HTTP_PORT, "127.0.0.1", r));
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
    "--no-first-run",
  ];
  if (!HEADED) args.push("--headless=new");
  const edge = spawn(EDGE, args, { stdio: "ignore" });

  let browser;
  try {
    // attente de l'endpoint CDP
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      await sleep(250);
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
        ok = true;
      } catch (e) { /* pas encore prêt */ }
    }
    if (!browser) throw new Error("CDP endpoint introuvable — Edge n'a pas démarré ?");

    const page = browser.contexts()[0].pages()[0] || (await browser.contexts()[0].newPage());
    page.on("console", (m) => console.log(`  [page] ${m.text()}`));
    page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));
    await page.goto(`http://127.0.0.1:${HTTP_PORT}/`);

    const res = await Promise.race([
      page.evaluate(HARNESS, { clsOld, clsNew, LABEL_OLD, LABEL_NEW, FRAMES, PASSES, SEED }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("page.evaluate timeout 240s")), 240000)),
    ]);
    console.log(JSON.stringify(res, null, 2));
    if (res && res.agg) fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
  } catch (e) {
    console.error("RUN-FAIL:", String(e && e.stack || e));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    edge.kill();
    server.close();
    // Edge peut garder le profil verrouillé un court instant après kill
    for (let i = 0; i < 10; i++) {
      try {
        fs.rmSync(PROFILE, { recursive: true, force: true });
        break;
      } catch (e) {
        await sleep(200);
      }
    }
  }
})();
