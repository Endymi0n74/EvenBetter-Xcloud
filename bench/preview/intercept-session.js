#!/usr/bin/env node
/**
 * Interception CDP P3+P2 du protocole preview (play.xbox.com).
 *
 * S'attache au navigateur (mode connect : --connect=PORT sur un Chrome/Edge
 * déjà lancé avec --remote-debugging-port ; sinon mode launch : profil
 * persistant dédié .cdp-profile/, à connecter une fois) et intercepTe :
 *
 *   P3 — REQUÊTE play (v5/sessions/cloud/play, POST) :
 *        réécrit settings.osName + en-tête x-ms-device-info, même logique
 *        que handlePlay du stable (getOsNameFromResolution/generateMsDeviceInfo).
 *   P2 — RÉPONSE /configuration (GET) :
 *        fusionne les overrides du stable (enableVibration, enableTouchInput,
 *        enableMouseInput/enableKeyboardInput, enableMicrophone…) dans
 *        clientStreamingConfigOverrides — le handler client preview filtre
 *        les clés racine client-exclusives (ie) puis merge ae() ; nos
 *        sous-clés passent le filtre (validé en session, session.md).
 *
 * Mécanique CDP : Fetch.enable avec requestStage Request pour le play,
 * requestStage Response pour la configuration ; tout ce qui ne matche pas
 * est continué tel quel (continueRequest) pour ne jamais bloquer le flux.
 *
 * Usage :
 *   node bench/preview/intercept-session.js --connect=9222 [--resolution=1080p-hq|1080p|auto]
 *       [--vibration=on|off] [--mkb=on|off] [--touch=on|off] [--mic=on|off] [--timeout=S] [--sw]
 *   node bench/preview/intercept-session.js [mêmes options, mode launch]
 *
 * Portée SW : Fetch est par-session. Les requêtes initiées PAR LA PAGE (même
 * contrôlée par un service worker) produisent des requestPaused sur la
 * session de la page. Les requêtes initiées DANS le SW (self.fetch) sont un
 * target séparé : --sw attache l'interception à chaque service worker du
 * contexte (context.serviceWorkers + événement serviceworker).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { mergeStreamingOverrides, rewriteConfigurationBody } = require("./p2-inject.js");

function loadChromium() {
  try {
    return require("playwright").chromium;
  } catch {
    try {
      return require("playwright-core").chromium;
    } catch {
      console.error("Playwright introuvable. Installez-le (npm i -D playwright) ou pointez NODE_PATH vers un install existant.");
      process.exit(2);
    }
  }
}

// ---------------- logique pure (exportée pour les tests) ----------------

/** Mapping résolution → osName (identique au stable). */
function getOsNameFromResolution(resolution) {
  switch (resolution) {
    case "1080p-hq": return "tizen";
    case "1080p": return "windows";
    default: return "android";
  }
}

/** En-tête x-ms-device-info (identique à generateMsDeviceInfo du stable). */
function generateMsDeviceInfo(osName, host) {
  return {
    appInfo: {
      env: {
        clientAppId: host || "play.xbox.com",
        clientAppType: "browser",
        clientAppVersion: "26.1.97",
        clientSdkVersion: "10.3.7",
        httpEnvironment: "prod",
        sdkInstallId: "",
      },
    },
    dev: {
      os: { name: osName, ver: "22631.2715", platform: "desktop" },
      hw: { make: "Microsoft", model: "unknown", sdktype: "web" },
      browser: { browserName: "chrome", browserVersion: "140.0.3485.54" },
      displayInfo: { dimensions: { widthInPixels: 4096, heightInPixels: 2160 }, pixelDensity: { dpiX: 1, dpiY: 1 } },
    },
  };
}

/**
 * Réécrit le body du play request : settings.osName ← résolution cible.
 * Retourne le body réécrit (objet) ou null si rien à faire.
 */
function rewritePlayBody(body, resolution) {
  if (!body || typeof body !== "object") return null;
  if (!resolution || resolution === "auto") return null;
  const osName = getOsNameFromResolution(resolution);
  const out = JSON.parse(JSON.stringify(body));
  out.settings = out.settings || {};
  out.settings.osName = osName;
  return out;
}


// ---------------- helpers CDP ----------------

function toHeaderArray(headers) {
  // CDP Fetch : headers = [{name, value}, ...]
  if (Array.isArray(headers)) return headers.map((h) => ({ name: h.name, value: String(h.value) }));
  if (headers && typeof headers === "object") {
    return Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }));
  }
  return [];
}

function headersToObject(arr) {
  const o = {};
  for (const h of arr || []) o[h.name.toLowerCase()] = h.value;
  return o;
}

function setHeader(arr, name, value) {
  const out = arr.map((h) => ({ ...h }));
  const i = out.findIndex((h) => h.name.toLowerCase() === name.toLowerCase());
  if (i >= 0) out[i].value = value;
  else out.push({ name, value });
  return out;
}

// ---------------- intercepteur ----------------

const PLAY_RE = /\/v5\/.*\/play(\?|$)/;
const CONFIG_RE = /\/v5\/.*\/configuration(\?|$)/;

/**
 * Installe l'interception Fetch sur une session CDP (page ou service worker).
 * Toute requête non ciblée est continuée telle quelle.
 */
async function installInterceptor(cdp, prefs, onLog) {
  const log = onLog || (() => {});
  // play : stage Request (réécriture du POST avant envoi)
  // configuration : stage Response (réécriture de la réponse)
  await cdp.send("Fetch.enable", {
    patterns: [
      { urlPattern: "*xboxlive.com/v5/*/play*", requestStage: "Request" },
      { urlPattern: "*xboxlive.com/v5/*/configuration*", requestStage: "Response" },
    ],
  });

  cdp.on("Fetch.requestPaused", async ({ requestId, request, responseStatusCode, responseHeaders }) => {
    const url = request.url || "";
    const method = request.method || "GET";
    try {
      // --- P3 : requête play (POST) ---
      if (method === "POST" && PLAY_RE.test(url) && prefs.resolution && prefs.resolution !== "auto") {
        let body = {};
        try { body = request.postData ? JSON.parse(request.postData) : {}; } catch (e) { body = {}; }
        const rewritten = rewritePlayBody(body, prefs.resolution);
        if (rewritten) {
          const osName = getOsNameFromResolution(prefs.resolution);
          let headers = toHeaderArray(request.headers);
          headers = setHeader(headers, "x-ms-device-info", JSON.stringify(generateMsDeviceInfo(osName, new URL(url).host)));
          await cdp.send("Fetch.continueRequest", { requestId, postData: JSON.stringify(rewritten), headers });
          log(`[P3] play réécrit → settings.osName=${osName} + x-ms-device-info (${url.slice(0, 90)})`);
          return;
        }
      }
      // --- P2 : réponse configuration (GET, stage Response) ---
      if (CONFIG_RE.test(url) && responseStatusCode !== undefined) {
        const { body: rawBody, base64Encoded } = await cdp.send("Fetch.getResponseBody", { requestId });
        if (rawBody) {
          const text = base64Encoded ? Buffer.from(rawBody, "base64").toString("utf8") : rawBody;
          let obj = {};
          try { obj = JSON.parse(text); } catch (e) { obj = null; }
          if (obj) {
            const rewritten = rewriteConfigurationBody(obj, prefs);
            const newBody = Buffer.from(JSON.stringify(rewritten), "utf8").toString("base64");
            // headers de réponse : retirer content-length (body changé), garder le reste
            const headers = (responseHeaders || []).filter((h) => h.name.toLowerCase() !== "content-length");
            await cdp.send("Fetch.fulfillRequest", {
              requestId,
              responseCode: responseStatusCode || 200,
              responseHeaders: headers,
              body: newBody,
            });
            const overrides = JSON.parse(rewritten.clientStreamingConfigOverrides || "{}");
            log(`[P2] /configuration réécrite → ${Object.keys(overrides).join(",")} (${url.slice(0, 90)})`);
            return;
          }
        }
      }
    } catch (e) {
      log(`[warn] interception ${url.slice(0, 80)} : ${e.message}`);
    }
    await cdp.send("Fetch.continueRequest", { requestId });
  });
}

/**
 * Attache l'interception aux service workers du contexte (mode --sw).
 * Un SW est un target séparé : ses self.fetch ne produisent PAS de
 * requestPaused sur la session de la page — il faut une session par SW.
 */
async function installSWInterceptor(context, prefs, onLog) {
  const log = onLog || (() => {});
  const attach = async (sw) => {
    try {
      const cdp = await context.newCDPSession(sw);
      await installInterceptor(cdp, prefs, log);
      log(`[sw] interception attachée à ${sw.url().slice(0, 90)}`);
    } catch (e) {
      log(`[warn] attachement SW échoué : ${e.message}`);
    }
  };
  // SW déjà actifs
  for (const sw of context.serviceWorkers ? context.serviceWorkers() : []) await attach(sw);
  // SW futurs
  if (typeof context.on === "function") {
    context.on("serviceworker", (sw) => { attach(sw).catch(() => {}); });
  }
}

// ---------------- CLI ----------------

function parseArgs(argv) {
  const arg = (name, def) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split("=").slice(1).join("=") : def;
  };
  const has = (name) => argv.some((a) => a === `--${name}`);
  return {
    connect: arg("connect", null),
    resolution: arg("resolution", "auto"),
    vibration: arg("vibration", "on") !== "off",
    mkb: arg("mkb", "null") === "null" ? null : arg("mkb", "null") === "on",
    touch: arg("touch", "off") === "on",
    mic: arg("mic", "off") === "on",
    sw: has("--sw"),
    timeout: parseInt(arg("timeout", "0"), 10) || 0,
    channel: arg("channel", process.platform === "win32" ? "msedge" : "chromium"),
    headless: has("--headless"),
  };
}

async function main() {
  const chromium = loadChromium();
  const prefs = parseArgs(process.argv.slice(2));
  console.log(`[intercept] P3 résolution=${prefs.resolution} · P2 vibration=${prefs.vibration ? "on" : "off"} mkb=${prefs.mkb === null ? "auto" : prefs.mkb ? "on" : "off"} touch=${prefs.touch ? "on" : "off"} mic=${prefs.mic ? "on" : "off"}`);

  let browser = null;
  let context = null;
  if (prefs.connect) {
    const port = prefs.connect.startsWith("http") ? prefs.connect : `http://127.0.0.1:${prefs.connect}`;
    console.log(`[intercept] connexion au navigateur existant : ${port}`);
    browser = await chromium.connectOverCDP(port);
    const pages = browser.contexts().flatMap((c) => c.pages());
    const target = pages.find((p) => p.url().includes("play.xbox.com"));
    if (!target) {
      console.error("[intercept] aucune page play.xbox.com ouverte — ouvre le stream d'abord, ou utilise le mode launch.");
      await browser.close();
      process.exit(1);
    }
    context = target.context();
    const cdp = await context.newCDPSession(target);
    await installInterceptor(cdp, prefs, (m) => console.log(m));
    if (prefs.sw) await installSWInterceptor(context, prefs, (m) => console.log(m));
    console.log(`[intercept] attaché à ${target.url()}${prefs.sw ? " + service workers" : ""} — interception active (Ctrl+C pour arrêter)`);
  } else {
    const profileDir = path.join(__dirname, ".cdp-profile");
    fs.mkdirSync(profileDir, { recursive: true });
    console.log(`[intercept] lancement navigateur (profil persistant ${profileDir}) — connecte-toi à play.xbox.com si besoin`);
    context = await chromium.launchPersistentContext(profileDir, {
      headless: prefs.headless,
      channel: prefs.channel,
      viewport: null,
    });
    const page = context.pages()[0] || (await context.newPage());
    const cdp = await context.newCDPSession(page);
    await installInterceptor(cdp, prefs, (m) => console.log(m));
    if (prefs.sw) await installSWInterceptor(context, prefs, (m) => console.log(m));
    console.log(`[intercept] interception active sur cette page${prefs.sw ? " + service workers" : ""} — ouvre play.xbox.com et lance un stream`);
  }

  // timeout optionnel (pour runs automatisés)
  if (prefs.timeout > 0) {
    setTimeout(async () => { console.log(`[intercept] timeout ${prefs.timeout}s — arrêt`); await context.close(); process.exit(0); }, prefs.timeout * 1000);
  }
  process.on("SIGINT", async () => {
    console.log("[intercept] arrêt");
    await context.close();
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { getOsNameFromResolution, generateMsDeviceInfo, rewritePlayBody, mergeStreamingOverrides, rewriteConfigurationBody, installInterceptor, installSWInterceptor, PLAY_RE, CONFIG_RE };

