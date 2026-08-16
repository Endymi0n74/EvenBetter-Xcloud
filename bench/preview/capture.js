/*
 * bench/preview/capture.js — harnais de capture des bundles runtime du
 * preview xCloud (play.xbox.com), session AUTHENTIFIÉE.
 *
 * But : pendant un stream réel, dump les modules JS chargés avec leurs
 * signatures (pour comparer avec le client stable et préparer le portage
 * des optimisations), et mesure le coût de rendu Babylon (draw/upload) —
 * l'équivalent « émission » du protocole GPU du repo (bench/gpu/).
 *
 * Usage (navigateur CONNECTÉ à play.xbox.com, compte Insider + Preview
 * Features activé) :
 *   1. Démarrer un stream (ouvrir un jeu).
 *   2. DevTools > Console : coller le contenu de ce fichier, Entrée.
 *      (ou bookmarklet : javascript:(()=>{ ...contenu... })())
 *   3. L'injection installe les hooks, capture les modules déjà chargés,
 *      mesure le draw pendant DRAW_WINDOW_MS, puis affiche le résumé.
 *
 * API après injection :
 *   window.BX_PREVIEW_CAPTURE.download()      -> rapport JSON complet
 *   window.BX_PREVIEW_CAPTURE.downloadAll()   -> chaque module brut (.js)
 *   window.BX_PREVIEW_CAPTURE.report()        -> résumé markdown (console)
 *   window.BX_PREVIEW_CAPTURE.stop()          -> retire les hooks
 *
 * Si le harnais est injecté AVANT le stream (page home), il reste armé :
 * le hook fetch + PerformanceObserver attrapent les chunks chargés à
 * l'ouverture du jeu (les pages React Router gardent le document, seule la
 * route change — le harnais survit). Relancer download() après le stream.
 *
 * Signatures : source unique inline (délimitée par /* BEGIN_SIGNATURES * /
 * et /* END_SIGNATURES * / — bench/preview/self-test.js l'extrait pour
 * rejouer le moteur hors navigateur).
 */
(() => {
  "use strict";

  const NS = "BX_PREVIEW_CAPTURE";
  if (window[NS]) {
    console.warn("[BX-PREVIEW-CAPTURE] déjà injecté — API existante sur window." + NS);
    return window[NS];
  }

  /* BEGIN_SIGNATURES */
  const SIGNATURES = [
    // Babylon.js (renderer du preview : thinEngine)
    { id: "babylon-engine",  label: "Babylon thinEngine", re: /createRawCubeTexture|_boundUniforms|snapshotRendering|shaderPlatformName|get emptyCubeTexture/g },
    { id: "babylon-ctor",    label: "Engine.ctor Babylon", re: /_creationOptions|adaptToDeviceRatio|onBeforeTextureInitObservable/g },
    // Contexte GL
    { id: "webgl2-ctx",      label: 'getContext("webgl2"', re: /getContext\(\s*"webgl2"/g },
    { id: "webgl1-ctx",      label: 'getContext("webgl"',  re: /getContext\(\s*"webgl"/g },
    { id: "webgpu",          label: "WebGPU",              re: /GPUCanvasContext|navigator\.gpu|requestAdapter/g },
    // Appels GL (upload + draw)
    { id: "tex-sub",         label: "texSubImage2D",       re: /texSubImage2D/g },
    { id: "tex-image",       label: "texImage2D",          re: /texImage2D/g },
    { id: "tex-storage",     label: "texStorage2D",        re: /texStorage2D/g },
    { id: "draw-arrays",     label: "drawArrays",          re: /drawArrays/g },
    { id: "draw-elements",   label: "drawElements",        re: /drawElements/g },
    { id: "bind-texture",    label: "bindTexture",         re: /bindTexture/g },
    { id: "rvfc",            label: "requestVideoFrameCallback", re: /requestVideoFrameCallback/g },
    // Décodage vidéo (WebCodecs)
    { id: "video-decoder",   label: "VideoDecoder",        re: /VideoDecoder/g },
    { id: "video-frame",     label: "VideoFrame",          re: /VideoFrame/g },
    { id: "create-bitmap",   label: "createImageBitmap",   re: /createImageBitmap/g },
    // Session RTC / protocole
    { id: "rtc",             label: "RTCPeerConnection",   re: /RTCPeerConnection/g },
    { id: "rtc-setup",       label: "setLocalDescription", re: /setLocalDescription/g },
    { id: "rtc-stats",       label: "getStats(",           re: /getStats\(/g },
    { id: "sess-config",     label: "StreamSessionConfiguration", re: /StreamSessionConfiguration/g },
    // Input
    { id: "poll-gamepads",   label: "pollGamepads",        re: /pollGamepads/g },
    { id: "get-gamepads",    label: "navigator.getGamepads", re: /getGamepads/g },
    // Ancres du client STABLE (si présentes → portage des patches possible)
    { id: "webgl2-player",   label: "WebGL2Player (stable)", re: /WebGL2Player extends BaseCanvasPlayer/g },
    { id: "base-canvas",     label: "BaseCanvasPlayer (stable)", re: /BaseCanvasPlayer/g },
    { id: "cas-shader",      label: "shader CAS (stable)", re: /iResolution|sharpenFactor|FILTER_UNSHARP_MASKING|clarityBoost\(/g },
    { id: "power-pref",      label: "getStreamPref(video.player.powerPreference)", re: /video\.player\.powerPreference/g },
  ];
  /* END_SIGNATURES */

  // ---------- configuration ----------
  const cfg = {
    drawWindowMs: 8000,     // fenêtre de mesure du draw ; 0 = désactivé
    dumpSources: true,      // fetch des sources brutes (lourd : ~5-6 Mo ici)
    captureAssets: /\.js(\?|$)/,
  };

  // ---------- état ----------
  const state = {
    active: true,
    startedAt: new Date().toISOString(),
    modules: [],            // { url, size, loadMs, src, hits }
    draw: null,
    hooks: [],
  };
  const unHook = (fn) => state.hooks.push(fn);

  // ---------- utilitaires ----------
  const esc = (s) => String(s).replace(/[|]/g, "\\|");
  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function pct(arr, p) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  }
  const fmt = (n, d = 2) => Number(n).toFixed(d).replace(".", ",");

  // ---------- 1. capture des modules (perf entries + hook fetch) ----------
  function collectLoaded() {
    const known = new Set(state.modules.map((m) => m.url));
    let added = 0;
    for (const e of performance.getEntriesByType("resource")) {
      if (!cfg.captureAssets.test(e.name) || known.has(e.name)) continue;
      known.add(e.name);
      state.modules.push({
        url: e.name,
        size: e.transferSize || e.encodedBodySize || 0,
        loadMs: Math.round(e.duration),
        src: null,
        hits: [],
      });
      added++;
    }
    return added;
  }

  function hookFetch() {
    const orig = window.fetch;
    if (typeof orig !== "function") return;
    window.fetch = function (...args) {
      const u = typeof args[0] === "string" ? args[0] : args[0] && args[0].url;
      if (u && cfg.captureAssets.test(u) && !state.modules.some((m) => m.url === u)) {
        state.modules.push({ url: u, size: 0, loadMs: 0, src: null, hits: [] });
      }
      return orig.apply(this, args);
    };
    unHook(() => { window.fetch = orig; });
  }

  function hookPerfObserver() {
    if (typeof PerformanceObserver === "undefined") return;
    const obs = new PerformanceObserver((list) => collectLoaded());
    try {
      obs.observe({ type: "resource", buffered: true });
      unHook(() => obs.disconnect());
    } catch (e) { /* certains navigateurs refusent le buffered → non bloquant */ }
  }

  async function fetchSources() {
    for (const m of state.modules) {
      if (m.src) continue;
      try {
        const r = await fetch(m.url, { credentials: "include" });
        if (!r.ok) { m.fetchStatus = r.status; continue; }
        m.src = await r.text();
        m.fetchStatus = r.status;
      } catch (e) { m.fetchStatus = "err:" + e.message; }
    }
  }

  // ---------- 2. signatures ----------
  function analyze() {
    const sigHits = (src) =>
      SIGNATURES.map((s) => ({ id: s.id, n: (src.match(s.re) || []).length })).filter((x) => x.n > 0);
    for (const m of state.modules) if (m.src) m.hits = sigHits(m.src);
  }

  // ---------- 3. mesure du draw (hook GL) ----------
  function measureDraw() {
    const w = cfg.drawWindowMs;
    if (!w) return null;
    const res = { windowMs: w, frames: 0, gl: {}, samples: [], uploadUs: [], drawUs: [], submitUs: [] };
    // accumulateur de la frame en cours (muté par les hooks GL, lu à chaque rAF)
    let frame = { glMs: 0, draws: 0, uploads: 0, uniforms: 0, submits: 0, clears: 0 };

    const bucket = (name) => (res.gl[name] = res.gl[name] || { calls: 0, ms: 0, maxMs: 0 });
    const wrap = (proto, name, bkt, samplesArr) => {
      if (!proto || typeof proto[name] !== "function") return;
      const orig = proto[name];
      try {
        proto[name] = function (...a) {
          const t0 = performance.now();
          const r = orig.apply(this, a);
          const dt = performance.now() - t0;
          const b = bucket(bkt);
          b.calls++; b.ms += dt; if (dt > b.maxMs) b.maxMs = dt;
          if (samplesArr) samplesArr.push(dt);
          frame.glMs += dt;
          if (bkt === "draws") frame.draws++;
          else if (bkt === "uploads") frame.uploads++;
          else if (bkt === "uniforms") frame.uniforms++;
          else if (bkt === "submits") frame.submits++;
          else if (bkt === "clears") frame.clears++;
          return r;
        };
        unHook(() => { try { proto[name] = orig; } catch (e) {} });
      } catch (e) { /* méthode non remplaçable → ignorée */ }
    };

    // WebGL2 + WebGL1 (prototype : couvre les contextes existants ET futurs)
    const p2 = typeof WebGL2RenderingContext !== "undefined" && WebGL2RenderingContext.prototype;
    const p1 = typeof WebGLRenderingContext !== "undefined" && WebGLRenderingContext.prototype;
    for (const p of [p2, p1]) {
      if (!p) continue;
      wrap(p, "drawArrays", "draws", res.drawUs);
      wrap(p, "drawElements", "draws", res.drawUs);
      wrap(p, "texImage2D", "uploads", res.uploadUs);
      wrap(p, "texSubImage2D", "uploads", res.uploadUs);
      wrap(p, "texStorage2D", "uploads", res.uploadUs);
      wrap(p, "bindTexture", "textureState");
      wrap(p, "pixelStorei", "textureState");
      wrap(p, "clear", "clears");
      for (const m of Object.getOwnPropertyNames(p)) if (/^uniform/.test(m)) wrap(p, m, "uniforms");
    }
    // WebGPU éventuel (Babylon isWebGPU) : GPUQueue.submit = l'envoi du draw
    if (typeof GPUQueue !== "undefined") wrap(GPUQueue.prototype, "submit", "submits", res.submitUs);

    // boucle de comptage (rAF = frames wall-clock)
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        res.frames++;
        res.samples.push({
          frame: res.frames,
          glMs: frame.glMs, draws: frame.draws, uploads: frame.uploads,
          uniforms: frame.uniforms, submits: frame.submits, clears: frame.clears,
        });
        frame = { glMs: 0, draws: 0, uploads: 0, uniforms: 0, submits: 0, clears: 0 };
        if (performance.now() - t0 < w) {
          requestAnimationFrame(tick);
        } else {
          // agrégats par frame
          const g = (k) => res.samples.map((s) => s[k]);
          res.fps = res.frames / (w / 1000);
          res.aggregate = {
            drawsPerFrame: median(g("draws")),
            uploadsPerFrame: median(g("uploads")),
            glMsPerFrame: median(g("glMs")),
            glMsP90: pct(g("glMs"), 90),
            glMsMax: Math.max(0, ...g("glMs")),
            fps: res.fps,
          };
          res.uploadUsMed = median(res.uploadUs) * 1000;
          res.drawUsMed = median(res.drawUs) * 1000;
          resolve(res);
        }
      };
      requestAnimationFrame(tick);
    });
  }

  // ---------- 4. rapport ----------
  function sigLabel(id) {
    const s = SIGNATURES.find((x) => x.id === id);
    return s ? s.label : id;
  }

  function buildReport() {
    const L = [];
    L.push("### Preview capture — play.xbox.com (stream, session authentifiée)");
    L.push("");
    L.push(`- Date : ${state.startedAt}`);
    L.push(`- URL : ${esc(location.href)}`);
    L.push(`- UA : ${esc(navigator.userAgent)}`);
    L.push(`- Modules chargés : ${state.modules.length} (sources récupérées : ${state.modules.filter((m) => m.src).length})`);
    L.push("");
    // matrice signatures × modules (compacte : modules avec hits, sigs avec hits)
    const hitMods = state.modules.filter((m) => m.hits && m.hits.length);
    if (hitMods.length) {
      const sigsUsed = [...new Set(hitMods.flatMap((m) => m.hits.map((h) => h.id)))];
      L.push("| Module | " + sigsUsed.map((id) => esc(sigLabel(id))).join(" | ") + " |");
      L.push("|---|---" + "---|".repeat(sigsUsed.length));
      for (const m of hitMods) {
        const name = m.url.split("/").pop();
        L.push("| `" + esc(name) + "` | " + sigsUsed.map((id) => { const h = m.hits.find((x) => x.id === id); return h ? h.n : ""; }).join(" | ") + " |");
      }
      L.push("");
    }
    // draw
    if (state.draw && state.draw.aggregate) {
      const d = state.draw;
      L.push("**Draw Babylon** (fenêtre " + d.windowMs + " ms, " + d.frames + " frames, médianes) :");
      L.push("");
      L.push("| FPS | drawArrays+drawElements/frame | uploads tex*/frame | GL total µs/frame (méd) | p90 | max | upload µs/call (méd) | draw µs/call (méd) | submits GPU/frame |");
      L.push("|---|---|---|---|---|---|---|---|---|");
      L.push(
        `| ${fmt(d.aggregate.fps, 1)} | ${d.aggregate.drawsPerFrame} | ${d.aggregate.uploadsPerFrame} | ` +
        `${fmt(d.aggregate.glMsPerFrame * 1000)} | ${fmt(d.aggregate.glMsP90 * 1000)} | ${fmt(d.aggregate.glMsMax * 1000)} | ` +
        `${fmt(d.uploadUsMed)} | ${fmt(d.drawUsMed)} | ${d.samples.length ? d.samples[d.samples.length - 1].submits : 0} |`
      );
      L.push("");
      L.push("_Mesure JS (performance.now autour des appels GL) = proxy « émission » ; le readback/sync GPU (queries EXT_disjoint_timer_query) est un prolongement prévu (cf. bench/gpu : la sync readback est le composant volatile)._");
      L.push("");
    }
    // liste des modules
    L.push("**Modules** (" + state.modules.length + ") :");
    L.push("");
    L.push("| # | URL | octets | load (ms) | signatures |");
    L.push("|---|---|---|---|---|");
    state.modules.forEach((m, i) => {
      const hits = m.hits ? m.hits.map((h) => sigLabel(h.id) + "×" + h.n).join(", ") : (m.fetchStatus ? "fetch " + m.fetchStatus : "—");
      L.push(`| ${i + 1} | \`${esc(m.url)}\` | ${m.size} | ${m.loadMs} | ${esc(hits)} |`);
    });
    // ligne de session (format projet, prête pour une future table Preview)
    if (state.draw && state.draw.aggregate) {
      const d = state.draw;
      L.push("");
      L.push("**Ligne de session (prête) :** `Preview 2026-… | " + state.modules.length + " modules | draw " +
        fmt(d.aggregate.drawsPerFrame) + "/frame | uploads " + fmt(d.aggregate.uploadsPerFrame) + "/frame | GL " +
        fmt(d.aggregate.glMsPerFrame * 1000) + " µs/frame | upload " + fmt(d.uploadUsMed) + " µs/call |`");
    }
    return L.join("\n");
  }

  function toJSON() {
    return JSON.stringify(
      {
        meta: { date: state.startedAt, url: location.href, ua: navigator.userAgent },
        config: cfg,
        modules: state.modules.map((m) => ({
          url: m.url, size: m.size, loadMs: m.loadMs, fetchStatus: m.fetchStatus,
          hits: m.hits, src: m.src,
        })),
        signatures: SIGNATURES.map((s) => ({ id: s.id, label: s.label })),
        draw: state.draw,
      },
      null, 1
    );
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type: type || "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- 5. démarrage ----------
  async function start() {
    hookFetch();
    hookPerfObserver();
    const added = collectLoaded();
    console.log(`[BX-PREVIEW-CAPTURE] ${added} module(s) capturé(s) (${state.modules.length} au total) — fetch des sources…`);
    if (cfg.dumpSources) await fetchSources();
    analyze();
    const hitMods = state.modules.filter((m) => m.hits && m.hits.length).length;
    console.log(`[BX-PREVIEW-CAPTURE] signatures : ${hitMods}/${state.modules.length} module(s) avec hits — mesure du draw sur ${cfg.drawWindowMs} ms…`);
    state.draw = await measureDraw();
    console.log(`[BX-PREVIEW-CAPTURE] draw mesuré : ${fmt(state.draw.frames)} frames, ${fmt(state.draw.aggregate.drawsPerFrame)} draws/frame, GL ${fmt(state.draw.aggregate.glMsPerFrame * 1000)} µs/frame (méd)`);
    console.log(buildReport());
    console.log("[BX-PREVIEW-CAPTURE] terminé — download() rapport JSON, downloadAll() sources brutes, stop() pour retirer les hooks.");
  }

  function stop() {
    state.active = false;
    state.hooks.forEach((h) => { try { h(); } catch (e) {} });
    state.hooks = [];
    console.log("[BX-PREVIEW-CAPTURE] hooks retirés — état figé, rapport toujours dispo.");
  }

  const api = {
    cfg, state, signatures: SIGNATURES,
    start, stop,
    report: buildReport,
    download: () => download("preview-capture-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".json", toJSON(), "application/json"),
    downloadAll: () => {
      state.modules.forEach((m, i) => {
        if (m.src) download("preview-module-" + String(i + 1).padStart(2, "0") + "-" + m.url.split("/").pop(), m.src);
      });
    },
  };
  window[NS] = api;

  // auto-démarrage (retardé pour laisser la page répondre)
  setTimeout(() => { start().catch((e) => console.error("[BX-PREVIEW-CAPTURE]", e)); }, 300);
  return api;
})();
