#!/usr/bin/env node
/**
 * bench/launch-game.js — lance un jeu xCloud stable et attend le stream live
 *
 * Usage : node bench/launch-game.js [--port=9225] [--game="As Dusk Falls"]
 *                              [--av1] [--timeout=90]
 *
 * --av1 : avant le lancement, installe un patch SDP qui force AV1 en premier
 *   dans l'offre WebRTC (wrapper setLocalDescription + neutralisation de
 *   setCodecPreferences pour que l'offre garde tous les codecs). Sortie :
 *   JSON { url, av1Patch, video: {readyState, w, h, t} }.
 *
 * Le clic passe par element.click() (les clics CDP synthétiques sont
 * interceptés par la page — piège documenté).
 */
const CDP_PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "--port=9225").split("=")[1]);
const GAME = (process.argv.find((a) => a.startsWith("--game=")) || "--game=As Dusk Falls").split("=").slice(1).join("=");
const FORCE_AV1 = process.argv.includes("--av1");
const TIMEOUT = Number((process.argv.find((a) => a.startsWith("--timeout=")) || "--timeout=90").split("=")[1]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
  const targets = await r.json();
  const page = targets.find((t) => t.type === "page" && /xbox\.com/.test(t.url));
  if (!page) { console.error("pas de page xbox.com"); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  await new Promise((res) => (ws.onopen = res));
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = (expr) => send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }).then((r2) => r2.result.value);
  const evEx = async (expr) => {
    const rr = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (rr.exceptionDetails) throw new Error("EXCEPTION: " + (rr.exceptionDetails.exception?.description || JSON.stringify(rr.exceptionDetails)));
    return rr.result.value;
  };

  // 1. Patch AV1 si demandé (avant tout lancement)
  let av1Patch = false;
  if (FORCE_AV1) {
    av1Patch = await evEx(`(() => {
      try {
        // Neutraliser setCodecPreferences : garder tous les codecs dans l'offre
        const origSCP = RTCRtpTransceiver.prototype.setCodecPreferences;
        RTCRtpTransceiver.prototype.setCodecPreferences = function () { /* no-op volontaire */ };
        // Réordonner l'offre : AV1 en tête du m=video
        const origSLD = RTCPeerConnection.prototype.setLocalDescription;
        RTCPeerConnection.prototype.setLocalDescription = function (desc) {
          if (desc && desc.sdp && desc.type === "offer") {
            const lines = desc.sdp.split("\\r\\n");
            const rtpmap = {};
            let av1Id = null;
            for (const l of lines) {
              const m = /^a=rtpmap:(\\d+) (\\S+)/.exec(l);
              if (m) rtpmap[m[1]] = m[2];
              if (m && /^AV1\\//.test(m[2]) && av1Id === null) av1Id = m[1];
            }
            if (av1Id) {
              for (let i = 0; i < lines.length; i++) {
                if (/^m=video /.test(lines[i])) {
                  const parts = lines[i].split(" ");
                  const others = parts.slice(3).filter((p) => p !== av1Id && rtpmap[p] && !/^rtx\\//.test(rtpmap[p]) && !/^red\\//.test(rtpmap[p]) && !/^ulpfec/.test(rtpmap[p]) && !/^flexfec/.test(rtpmap[p]));
                  const rtxOfAv1 = parts.slice(3).filter((p) => rtpmap[p] && /^rtx\\//.test(rtpmap[p]));
                  lines[i] = ["m=video", parts[1], parts[2], av1Id, ...rtxOfAv1, ...others].join(" ");
                }
              }
              desc.sdp = lines.join("\\r\\n");
            }
          }
          return origSLD.apply(this, arguments);
        };
        return true;
      } catch (e) { return "ERR " + e.message; }
    })()`);
    console.log("[launch] patch AV1 installé : " + JSON.stringify(av1Patch));
  }

  // 2. Cliquer le jeu (depuis la home ou le produit)
  const clicked = await evEx(`(() => {
    const els = [...document.querySelectorAll('button, a')];
    const el = els.find(e => (e.textContent || '').trim() === ${JSON.stringify(GAME)});
    if (el) { el.click(); return true; }
    return false;
  })()`);
  if (!clicked) { console.error("jeu introuvable : " + GAME); process.exit(1); }
  console.log("[launch] clic sur « " + GAME + " »");

  // 3. Attendre la page produit puis cliquer JOUER
  const t0 = Date.now();
  let video = null;
  while (Date.now() - t0 < TIMEOUT * 1000) {
    const state = await ev(`(() => ({
      url: location.href,
      playBtns: [...document.querySelectorAll('button, a')].filter(b => /jouer|play/i.test((b.textContent || '').trim()) && (b.textContent || '').trim().length < 40).map(b => (b.textContent || '').trim()),
      video: (() => { const v = [...document.querySelectorAll('video')].sort((a,b) => b.videoWidth - a.videoWidth)[0]; return v ? { readyState: v.readyState, w: v.videoWidth, h: v.videoHeight, t: v.currentTime } : null; })(),
    }))()`);
    if (state.video && state.video.readyState >= 3 && state.video.t > 0) { video = state.video; break; }
    if (state.url.includes("/play/launch/") && !state.playBtns.length && !state.video) {
      // déjà sur la page stream, la vidéo arrive
    } else if (!state.url.includes("/play/launch/") && state.playBtns.length) {
      const clicked2 = await evEx(`(() => {
        const els = [...document.querySelectorAll('button, a')];
        const el = els.find(b => /jouer maintenant|play now|jouer/i.test((b.textContent || '').trim()) && (b.textContent || '').trim().length < 40);
        if (el) { el.click(); return (el.textContent || '').trim(); }
        return null;
      })()`);
      if (clicked2) console.log("[launch] clic sur « " + clicked2 + " »");
    }
    await sleep(3000);
  }
  if (!video) { console.error("timeout — stream non démarré"); process.exit(1); }
  console.log(JSON.stringify({ url: (await ev("location.href")), av1Patch, video }, null, 2));
  ws.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
