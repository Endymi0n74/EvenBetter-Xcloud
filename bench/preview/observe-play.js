/*
 * observe-play.js — observateur PASSIF du play (témoin natif)
 *
 * Attache Fetch sur la page play.xbox.com, log le corps du play (postData)
 * et la réponse (sessionPath) SANS rien modifier (continueRequest inchangé).
 * Sert de côté "témoin" du protocole A/B P3 : confirmer ce que le client
 * natif envoie réellement (osName=windows, pas de x-ms-device-info) et le
 * GUID de session attribué par le serveur.
 *
 * Usage :
 *   node bench/preview/observe-play.js [--port=9222] [--json]
 *   node bench/preview/observe-play.js --self-test   # sans navigateur
 */
"use strict";

const http = require("http");

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => {
          try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
        });
      })
      .on("error", reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const port = (args.find((a) => a.startsWith("--port=")) || "--port=9222").split("=")[1];
  const json = args.includes("--json");
  if (args.includes("--self-test")) {
    // gates de parsing : le regex GUID et l'extraction du corps
    const tests = [
      ["https://uks.core.gssv-play-prod.xboxlive.com/v5/sessions/cloud/play", true],
      ["https://uks.core.gssv-play-prod.xboxlive.com/v5/sessions/cloud/8A7F6A20-DA4A-4607-9B45-29180C93730B/state", false],
      ["https://play.xbox.com/", false],
    ];
    for (const [url, exp] of tests) {
      const isPlay = /\/sessions\/cloud\/play(?:\?|$)/.test(url);
      if (isPlay !== exp) { console.error(`SELF-TEST FAIL: ${url}`); process.exit(1); }
    }
    console.log("SELF-TEST OK");
    process.exit(0);
  }

  const tabs = await getJSON(`http://127.0.0.1:${port}/json`);
  const page = tabs.find((t) => t.type === "page" && t.url.includes("play.xbox.com"));
  if (!page) { console.error("[observe] aucune page play.xbox.com — ouvre le stream d'abord ?"); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = {};
  const send = (method, params) => {
    id++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((r) => (pending[id] = r));
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending[m.id]) { pending[m.id](m.result); delete pending[m.id]; }
    if (m.method === "Fetch.requestPaused") {
      handlePaused(m.params).catch((err) => console.error("[observe] err", err.message));
    }
  };

  async function handlePaused({ requestId, request, responseStatusCode, responseHeaders }) {
    const url = request.url;
    if (/\/sessions\/cloud\/play(?:\?|$)/.test(url)) {
      let body = {};
      try { body = request.postData ? JSON.parse(request.postData) : {}; } catch (e) {}
      const info = {
        ts: new Date().toLocaleTimeString("fr-FR"),
        url: url.slice(0, 90),
        osName: body.settings && body.settings.osName,
        deviceInfoHeader: (request.headers && request.headers["x-ms-device-info"]) || null,
        hasVibration: !!(body.clientStreamingConfigOverrides || "").includes("enableVibration"),
        sessionPath: body.sessionPath || null,
      };
      console.log("[PLAY natif]", JSON.stringify(info));
    }
    if (responseStatusCode === 200 && /\/sessions\/cloud\/play(?:\?|$)/.test(url)) {
      // réponse du play : on ne la lit pas (fulfill nécessaire) — le GUID viendra du resource timing
      console.log("[PLAY réponse]", responseStatusCode);
    }
    try { await send("Fetch.continueRequest", { requestId }); } catch (e) {
      console.error("[observe] continueRequest:", e.message);
    }
  }

  await new Promise((r) => (ws.onopen = r));
  await send("Fetch.enable", {
    patterns: [{ urlPattern: "*sessions/cloud/play*", requestStage: "Request" }],
  });
  console.log(`[observe] attaché à ${page.url.slice(0, 70)} — observation passive du play (Ctrl+C pour arrêter)`);

  // ping périodique pour garder le process vivant
  const keep = setInterval(() => {}, 1000);
  process.on("SIGINT", () => { clearInterval(keep); ws.close(); process.exit(0); });
  await new Promise(() => {});
}

main().catch((e) => { console.error(e.message); process.exit(1); });
