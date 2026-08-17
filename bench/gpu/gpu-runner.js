const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const HEADED = process.argv.includes("--headed");
const NO_FIX = process.argv.includes("--no-fix");
const FRAMES_ARG = process.argv.find((a) => a.startsWith("--frames="));
const PASSES_ARG = process.argv.find((a) => a.startsWith("--passes="));
const argVal = (flag, dflt) => {
  const a = process.argv.find((x) => x.startsWith(flag + "="));
  return a ? a.split("=")[1] : dflt;
};
// Canal navigateur : msedge par défaut (Windows, GPU ANGLE/D3D11) ;
// --channel=chromium pour Linux/CI (Chromium fourni par Playwright).
const CHANNEL = argVal("--channel", "msedge");
const DIR = __dirname;
// Défauts alignés sur le protocole figé (cf. README du repo) : la classe
// v1.4.0 contient déjà gl.RGB8 (patch 18) → mesurer avec --no-fix.
const FILE_P10 = argVal("--cls-p10", path.join(DIR, "gpu-perf10-webgl2player.txt"));
const FILE_NEW = argVal("--cls-new", path.join(DIR, "gpu-v140-webgl2player.txt"));
const LABEL_NEW = argVal("--label-new", "v1.4.0");
const LABEL_P10 = "perf10";
const clsP10 = fs.readFileSync(FILE_P10, "utf-8");
let clsNew = fs.readFileSync(FILE_NEW, "utf-8");
// CORRECTIF DE MESURE (optionnel) : gl.RGB est invalide pour texStorage2D
// (INVALID_ENUM, ecran noir). Le build v1.4.0 contient deja gl.RGB8 (patch 18),
// donc le replace est un no-op dessus. --no-fix desactive la correction pour
// mesurer strictement le build publie.
if (!NO_FIX) {
  const needle = "gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGB,";
  if (clsNew.includes(needle)) {
    clsNew = clsNew.replace(needle, "gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGB8,");
    console.log(`[bx-gpu] CORRECTIF RGB8 applique a ${path.basename(FILE_NEW)} (mesure chemin fonctionnel)`);
  }
}
const VIDEO = fs.readFileSync(path.join(DIR, "test.webm"));

const PORT = 8767;
const FRAMES = FRAMES_ARG ? parseInt(FRAMES_ARG.split("=")[1], 10) : 120;
const WARMUP = 30;
const PASSES = PASSES_ARG ? parseInt(PASSES_ARG.split("=")[1], 10) : 3;
const SEED_ARG = process.argv.find((a) => a.startsWith("--seed="));
const SEED = SEED_ARG ? parseInt(SEED_ARG.split("=")[1], 10) : Date.now() % 1000000;

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

const HARNESS = ({ clsP10, clsNew, LABEL_P10, LABEL_NEW, FRAMES, WARMUP, PASSES, SEED }) => {
  return new Promise(async (resolve) => {
    const fail = (msg) => resolve({ error: msg });

    // PRNG deterministe (seed) pour des runs croises reproductibles
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
    window.getStreamPref = () => "default";
    window.BX_FLAGS = { WebGL2NoColorConversion: false };

    class BaseCanvasPlayer {
      constructor(type, $video, name) {
        this.type = type;
        this.$video = $video;
        this.name = name;
        this.$canvas = document.createElement("canvas");
        this.$canvas.width = 640;
        this.$canvas.height = 360;
        this.options = {
          processing: "usm", processingMode: "performance",
          sharpness: 2, brightness: 100, contrast: 100, saturation: 100,
        };
      }
      toFilterId(p) { return p === "cas" ? 2 : 1; }
      destroy() {}
    }

    function instrument(gl) {
      const counts = {};
      const gpuQueries = [];
      const names = [
        "bindTexture", "texImage2D", "texSubImage2D", "texStorage2D",
        "texParameteri", "pixelStorei", "drawArrays", "createTexture",
        "deleteTexture", "uniform1f", "uniform1i", "uniform2f", "viewport",
      ];
      const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
      for (const n of names) {
        const orig = WebGL2RenderingContext.prototype[n].bind(gl);
        counts[n] = 0;
        gl[n] = (...args) => {
          counts[n]++;
          if (n === "drawArrays" && ext) {
            // API de query native WebGL2 + TIME_ELAPSED_EXT (Edge/ANGLE n'expose pas createQueryEXT)
            const q = gl.createQuery();
            gpuQueries.push(q);
            gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
            const r = orig(...args);
            gl.endQuery(ext.TIME_ELAPSED_EXT);
            return r;
          }
          return orig(...args);
        };
      }
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "n/a";
      return { gl, counts, gpuQueries, ext, renderer };
    }

    const origGetContext = HTMLCanvasElement.prototype.getContext;
    let inst = null;
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const ctx = origGetContext.apply(this, args);
      if (args[0] === "webgl2" && ctx && !this.__bxInst) {
        this.__bxInst = true;
        inst = instrument(ctx);
      }
      return ctx;
    };

    const video = document.getElementById("v");
    video.muted = true;
    await video.play();
    for (let i = 0; i < 200; i++) {
      if (video.readyState >= 2 && video.currentTime > 0.3) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    if (video.currentTime <= 0.3) {
      resolve({ error: "video not playing", currentTime: video.currentTime, readyState: video.readyState });
      return;
    }

    // PHASE DU PIPELINE VIDÉO : requestVideoFrameCallback enregistre le
    // compteur/mediaTime de la DERNIÈRE frame présentée (signal de phase du
    // décodeur). Objectif : tester l'hypothèse temporelle de la variance de la
    // sync readback (mémo projet §7) — une sync haute devrait corréler avec une
    // frame fraîchement présentée pendant la fenêtre de mesure (le upload
    // texImage2D(..., video) copie la frame courante ; si elle vient de changer,
    // le readback attend le travail différé).
    window.__bxLastFrame = null;
    if (typeof video.requestVideoFrameCallback === "function") {
      const onFrame = (now, meta) => {
        window.__bxLastFrame = {
          mediaTime: meta.mediaTime,
          presentationTime: meta.presentationTime,
          presentedFrames: meta.presentedFrames,
        };
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
    }
    // Snapshot de l'état du décodeur à un instant donné (appelé avant/après
    // chaque mesure timée). currentTime a une granularité ~1/fps ; le compteur
    // rVFC (presentedFrames) est le signal précis de « frame arrivée ».
    const snapVideo = () => {
      const q = video.getVideoPlaybackQuality ? video.getVideoPlaybackQuality() : null;
      const f = window.__bxLastFrame;
      return {
        t: performance.now(),
        currentTime: video.currentTime,
        readyState: video.readyState,
        paused: video.paused,
        seeking: video.seeking,
        droppedFrames: q ? q.droppedVideoFrames : null,
        totalFrames: q ? q.totalVideoFrames : null,
        lastFrameCount: f ? f.presentedFrames : null,
        lastFrameMediaTime: f ? f.mediaTime : null,
        lastFramePresentedAt: f ? f.presentationTime : null,
      };
    };

    async function resolveGpuMs(inst, queries) {
      const gl = inst.gl;
      // resolution en parallele (chaque query attend independamment)
      return await Promise.all(queries.map(async (q) => {
        let ok = false;
        for (let i = 0; i < 500 && !ok; i++) {
          ok = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE);
          if (!ok) await new Promise((r) => setTimeout(r, 1));
        }
        return ok ? gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 : -1;
      }));
    }

    async function measure(clsCode, version) {
      console.log("[bx-gpu] measure start", version);
      inst = null;
      const fn = new Function("BaseCanvasPlayer", clsCode + "\n; return WebGL2Player;");
      const WebGL2Player = fn(BaseCanvasPlayer);
      const player = new WebGL2Player(video);
      await player.setupShaders();
      const g = inst;
      if (!g) return fail("contexte non instrumente");

      // Prechauffage GPU explicite : bursts d'updateFrame separes par flush +
      // delai, pour que le driver ait fini compilation/caches avant les mesures
      // (sans ca, les premieres frames/passes sont contaminees par l'etat GPU).
      for (let b = 0; b < 3; b++) {
        for (let i = 0; i < 200; i++) player.updateFrame();
        g.gl.flush();
        await new Promise((r) => setTimeout(r, 50));
      }
      for (let i = 0; i < WARMUP; i++) player.updateFrame();
      g.gl.flush();
      for (const k in g.counts) g.counts[k] = 0;
      const gpuStart = g.gpuQueries.length;

      const vFrames = snapVideo(); // phase au début de la boucle frames

      const frames = [];
      const tLoop0 = performance.now();
      for (let i = 0; i < FRAMES; i++) {
        const before = { ...g.counts };
        const t0 = performance.now();
        player.updateFrame();
        const wall = performance.now() - t0;
        const delta = {};
        for (const k in g.counts) delta[k] = g.counts[k] - (before[k] || 0);
        frames.push({ wall, delta });
      }
      const wallTotalMs = (performance.now() - tLoop0) / FRAMES;

      const gpuQueries = g.gpuQueries.slice(gpuStart);
      const gpuMs = await resolveGpuMs(g, gpuQueries);

      // upload seul en boucle tight (bulk timing, ~us/upload) : le vrai levier des patches 13/16
      const UPLOADS = 400;
      const uploadOnce = (gl) => {
        if (version === LABEL_P10) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
        } else {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGB, gl.UNSIGNED_BYTE, video);
        }
      };
      // prechauffage de la boucle d'upload : les premiers uploads subissent
      // l'etat du driver (reallocation/cache) et faussaient la 1re passe
      for (let i = 0; i < 50; i++) uploadOnce(g.gl);
      g.gl.flush();
      // PRÉCHAUFFAGE DU READBACK (fix du spike de 1re passe) : le chemin de
      // complétion GPU est froid au 1er readPixels timé de chaque passe (sync
      // 65-239 µs en passe 1 vs 13-25 µs en passe 2 — analyse bimodalité,
      // mémo projet §7). gl.finish() est un quasi no-op sous ANGLE/D3D11 et
      // fenceSync ne signale jamais sur ce stack → readPixels est la seule
      // sonde de complétion fiable : on émet un batch d'uploads puis on draine
      // (readPixels) 2× avant la mesure timée, pour que le chemin soit chaud.
      const rb = new Uint8Array(4);
      for (let w = 0; w < 2; w++) {
        for (let i = 0; i < 100; i++) uploadOnce(g.gl);
        g.gl.readPixels(0, 0, 1, 1, g.gl.RGBA, g.gl.UNSIGNED_BYTE, rb);
        g.gl.flush();
        await new Promise((r) => setTimeout(r, 25));
      }
      // ÉMISSION seule : boucle tight SANS flush — coût CPU de mise en file des
      // appels. Si le driver bloque en cours de boucle (file pleine, attente
      // pipeline vidéo/GPU = backpressure), c'est ICI que ça apparaît (état
      // « haut » des sessions — mémo projet §7).
      const vEmit0 = snapVideo(); // phase juste avant l'émission timée
      const t0e = performance.now();
      for (let i = 0; i < UPLOADS; i++) uploadOnce(g.gl);
      const uploadEmitNs = ((performance.now() - t0e) / UPLOADS) * 1e6;
      const vEmit1 = snapVideo(); // phase juste après l'émission (avant la sync)
      // SYNC via READBACK : gl.readPixels(1×1) force la complétion GPU de TOUTE
      // la file émise (l'ordre GL garantit que les uploads précédents sont
      // exécutés avant la lecture). /UPLOADS → sync par upload. C'est la mesure
      // de « rattrapage » du pipeline (copies différées, synchro décodeur).
      //   - gl.finish() : quasi no-op sous ANGLE/D3D11 (retourné ~0 µs).
      //   - fenceSync + clientWaitSync : ne signale JAMAIS dans ce setup
      //     (timeout 5 s, même après les 400 uploads — busyloop ou deadlock du
      //     fence sur le chemin vidéo) → abandonné.
      // Petit → le blocage est DANS l'appel d'upload (émission, backpressure
      // décodeur/pipeline vidéo) ; grand → le GPU est en retard (à croiser avec
      // le draw timé GPU, resté stable).
      const t0s = performance.now();
      g.gl.readPixels(0, 0, 1, 1, g.gl.RGBA, g.gl.UNSIGNED_BYTE, rb);
      const uploadSyncNs = ((performance.now() - t0s) / UPLOADS) * 1e6;
      const vSync1 = snapVideo(); // phase juste après la sync (fin de fenêtre)
      const uploadNs = uploadEmitNs; // sémantique historique : émission seule
      player.destroy();

      const stat = (arr, f) => {
        const s = [...arr].map(f).sort((a, b) => a - b);
        return {
          med: s[Math.floor(s.length / 2)],
          p95: s[Math.floor(s.length * 0.95)],
          avg: arr.reduce((x, y) => x + f(y), 0) / arr.length,
        };
      };
      const countsTot = {};
      for (const f of frames) for (const k in f.delta) countsTot[k] = (countsTot[k] || 0) + f.delta[k];

      return {
        renderer: g.renderer,
        wall: stat(frames, (f) => f.wall),
        wallTotalMs,
        gpu: stat(gpuMs, (x) => x),
        uploadNs,
        uploadEmitNs,
        uploadSyncNs,
        uploadTotalNs: uploadEmitNs + uploadSyncNs,
        countsPerFrame: Object.fromEntries(Object.entries(countsTot).map(([k, v]) => [k, +(v / FRAMES).toFixed(2)])),
        // Phase du pipeline vidéo autour des mesures (hypothèse temporelle) :
        // snapshots du décodeur au début de la boucle frames, avant l'émission
        // timée, après l'émission et après la sync. La fenêtre émission+sync
        // s'étend de vEmit0 à vSync1 — le delta de compteur rVFC y indique si
        // une frame a été présentée PENDANT la mesure.
        videoPhase: { frames: vFrames, emit0: vEmit0, emit1: vEmit1, sync1: vSync1 },
      };
    }

    try {
      // Runs croises : ordre melange (seed reproductible) pour qu'une derive
      // systematique (clocks GPU, temperature) ne favorise pas toujours la meme
      // version — le 1er run n'est plus toujours perf10.
      const order = [];
      for (let p = 0; p < PASSES; p++) {
        order.push([LABEL_P10, clsP10], [LABEL_NEW, clsNew]);
      }
      shuffle(order, mulberry32(SEED));
      console.log("[bx-gpu] seed", SEED, "| ordre", order.map(([n]) => n).join(" -> "));
      const out = { passes: [], perVersion: { [LABEL_P10]: [], [LABEL_NEW]: [] } };
      for (const [name, code] of order) {
        const res = await measure(code, name);
        res.name = name;
        out.passes.push(res);
        out.perVersion[name].push(res);
        console.log("[bx-gpu] pass done:", name);
      }
      const agg = {};
      for (const [name, arr] of Object.entries(out.perVersion)) {
        const medOf = (key, sub) => {
          const vals = arr.map((p) => p[key][sub]).sort((a, b) => a - b);
          return vals[Math.floor(vals.length / 2)];
        };
        agg[name] = {
          renderer: arr[0].renderer,
          wallMed: medOf("wall", "med"),
          wallAvg: medOf("wall", "avg"),
          wallTotalAvg: arr.map((p) => p.wallTotalMs).sort((a, b) => a - b)[Math.floor(arr.length / 2)],
          gpuMed: medOf("gpu", "med"),
          gpuAvg: medOf("gpu", "avg"),
          uploadNs: arr.map((p) => p.uploadNs).sort((a, b) => a - b)[Math.floor(arr.length / 2)],
          uploadEmitNs: arr.map((p) => p.uploadEmitNs).sort((a, b) => a - b)[Math.floor(arr.length / 2)],
          uploadSyncNs: arr.map((p) => p.uploadSyncNs).sort((a, b) => a - b)[Math.floor(arr.length / 2)],
          uploadTotalNs: arr.map((p) => p.uploadTotalNs).sort((a, b) => a - b)[Math.floor(arr.length / 2)],
          countsPerFrame: arr[0].countsPerFrame,
        };
      }
      resolve({ agg, passes: out.passes });
    } catch (e) {
      fail(String(e && e.stack || e));
    }
  });
};

(async () => {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const launchOpts = { headless: !HEADED };
  if (CHANNEL !== "chromium") launchOpts.channel = CHANNEL; // "chromium" = build fourni par Playwright
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on("console", (m) => console.log(`  [page] ${m.text()}`));
  page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  const res = await Promise.race([
    page.evaluate(HARNESS, { clsP10, clsNew, LABEL_P10, LABEL_NEW, FRAMES, WARMUP, PASSES, SEED }),
    new Promise((_, rej) => setTimeout(() => rej(new Error("page.evaluate timeout 180s")), 180000)),
  ]);
  console.log(JSON.stringify(res, null, 2));
  // Fermeture robuste : une erreur de close (ex. process msedge tué pendant le
  // run — un autre Edge utilisateur ouvert sur la machine — ou serveur déjà
  // fermé) ne doit PAS transformer une mesure complète (JSON déjà écrit) en
  // exit 1. Flake CI du 17 août (gpu-upload, seed 600 : JSON complet + exit 1
  // silencieux → le `|| exit 1` du workflow court-circuitait agg-seeds).
  try { await browser.close(); } catch (e) { console.error(`[bx-gpu] browser.close: ${e}`); }
  try { server.close(); } catch (e) { console.error(`[bx-gpu] server.close: ${e}`); }
})();
