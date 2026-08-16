#!/usr/bin/env node
/*
 * userscript-rewrite.js — mesure de la réécriture P2+P3 via le hook userscript
 * (build preview), SANS CDP.
 *
 * Contexte (fetch-early.js) : le build preview pose window.fetch (hook du
 * stable, XcloudInterceptor) en document-start, AVANT entry.client → le SDK
 * capture notre hook (classe ub, i=fetch) → toutes les requêtes du protocole
 * passent dans XcloudInterceptor.handle(). Ce harnais PROUVE la réécriture
 * complète en vm : on extrait la classe XcloudInterceptor + les helpers
 * (getOsNameFromResolution / generateMsDeviceInfo) DU BUILD PREVIEW RÉEL, on
 * les exécute dans un vm avec un fetch simulé (NATIVE_FETCH), et on vérifie :
 *
 *   P3 — play POST → NATIVE_FETCH reçoit un body avec settings.osName=tizen
 *        + header x-ms-device-info (dev.os.name=tizen)
 *   P2 — réponse /configuration → clientStreamingConfigOverrides fusionné
 *        (enableVibration + enableMouseInput/enableKeyboardInput +
 *        enableMicrophone) par-dessus les overrides serveur
 *
 * Usage : node bench/preview/port/userscript-rewrite.js [--print]
 * Test : node bench/preview/port/userscript-rewrite.test.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const BUILD = path.join(ROOT, "better-xcloud-preview.user.js");

// ---------- extraction des morceaux du build preview réel ----------
function extractFromBuild(src) {
  const grab = (from, to, label) => {
    const i = src.indexOf(from);
    if (i < 0) throw new Error(`ancre introuvable: ${label} :: ${from.slice(0, 60)}`);
    const j = to === "\n" ? src.indexOf("\n", i) : src.indexOf(to, i);
    if (j < 0) throw new Error(`fin introuvable: ${label}`);
    return src.slice(i, j);
  };
  const xcloudClass = grab("class XcloudInterceptor", "\n", "class XcloudInterceptor");
  const osNameFn = grab("function getOsNameFromResolution(", "\n", "getOsNameFromResolution");
  const deviceInfoFn = grab("function generateMsDeviceInfo(", "\n", "generateMsDeviceInfo");
  return { xcloudClass, osNameFn, deviceInfoFn };
}

// ---------- vm : sandbox minimal pour exécuter XcloudInterceptor ----------
function makeSandbox({ nativeFetch, prefs, states }) {
  const sandbox = {
    console,
    URL,
    URLSearchParams,
    Request,
    Response,
    Headers,
    FormData: typeof FormData !== "undefined" ? FormData : function () {},
    Blob,
    // window.location (generateMsDeviceInfo lit window.location.host)
    location: { host: "play.xbox.com", href: "https://play.xbox.com/" },
    // fetch simulé = NATIVE_FETCH (ce que le hook appelle en dernier ressort)
    NATIVE_FETCH: nativeFetch,
    fetch: nativeFetch,
    // le hook du stable lit les prefs via getGlobalPref/getStreamPref
    getGlobalPref: (k) => {
      if (prefs && prefs.global && k in prefs.global) return prefs.global[k];
      return undefined;
    },
    getStreamPref: (k) => {
      if (prefs && prefs.stream && k in prefs.stream) return prefs.stream[k];
      return undefined;
    },
    getGlobalPrefDefinition: () => ({ max: 100000 }),
    // BxEventBus / STATES / StreamBadges / BX_FLAGS (dépendances du hook)
    BxEventBus: {
      Stream: { emit: () => {} },
      Script: { emit: () => {} },
    },
    STATES: Object.assign(
      {
        serverRegions: {},
        currentStream: { titleInfo: null },
        userAgent: { capabilities: { touch: false } },
        selectedRegion: null,
        gsToken: null,
      },
      states || {}
    ),
    StreamBadges: { getInstance: () => ({ setRegion: () => {} }) },
    BX_FLAGS: { Debug: false, ForceNativeMkbTitles: undefined },
    TouchController: {
      disable: () => {},
      enable: () => {},
      isEnabled: () => false,
      setXboxTitleId: () => {},
    },
    LoadingScreen: { setupWaitTime: () => {} },
    RemotePlayManager: { getInstance: () => null },
    BxLogger: { info: () => {}, warning: () => {}, error: () => {} },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

// ---------- exécution : charge la classe + helpers dans le vm ----------
function loadInterceptor(src, sandbox) {
  const { xcloudClass, osNameFn, deviceInfoFn } = extractFromBuild(src);
  vm.runInContext(deviceInfoFn, sandbox); // generateMsDeviceInfo (function → global)
  vm.runInContext(osNameFn, sandbox);     // getOsNameFromResolution (function → global)
  // `class` est lexicale (comme let/const) : ne crée PAS de propriété sur le
  // global du vm. On évalue en CLASS EXPRESSION (le code du build est
  // inchangé, seule l'affectation diffère) pour l'attacher au sandbox.
  vm.runInContext("XcloudInterceptor = " + xcloudClass, sandbox);
  return sandbox.XcloudInterceptor;
}

// ---------- scénarios P3 + P2 ----------
const PLAY_BODY = {
  titleId: "9N683TDT5M7R",
  systemUpdateGroup: "default",
  settings: {
    nanoVersion: "V3;WebrtcTransport.dll",
    enableTextToSpeech: false,
    highContrast: 0,
    locale: "fr-FR",
    useIceConnection: false,
    timezoneOffsetMinutes: 120,
    sdkType: "web",
    osName: "windows",
    enableOptionalDataCollection: false,
  },
  serverId: "",
  fallbackRegionNames: [],
  clientSessionId: "abc-def-123",
};

const CONFIG_BODY = {
  keepAlivePulseInSeconds: 60,
  timeoutForNoConnectionSeconds: 300,
  serverDetails: {
    ipAddress: "13.104.113.180",
    port: 1059,
    srtp: { key: "lh45zSKVuBbmbARJ7gKvsqjnLbpB/CUpShG7lbL1" },
    ipV4List: [{ address: "13.104.113.180", port: 1059, rigPort: 1291, routingPreference: "AZURE" }],
  },
  clientStreamingConfigOverrides: JSON.stringify({
    inputConfiguration: { useIntervalWorkerThreadForInput: true, useUnreliableInput: true },
    nqiConfiguration: { consecutiveBadIntervalsForTrigger: 10, pingMsBadThreshold: 100 },
    statisticsConfiguration: { useQosChannel: true },
    videoConfiguration: { preferMainH264Profile: true },
  }),
};

/**
 * Mesure P3 : un play POST passant par XcloudInterceptor.handle() doit
 * ressortir réécrit côté NATIVE_FETCH (osName=tizen + x-ms-device-info).
 */
async function measureP3(buildSrc, resolution) {
  let sent = null;
  const nativeFetch = async (req, init) => {
    sent = { req, init };
    return new Response("{}", { status: 200 });
  };
  const sandbox = makeSandbox({
    nativeFetch,
    prefs: {
      global: { "stream.video.resolution": resolution, "stream.locale": "default" },
      stream: {},
    },
    states: { serverRegions: {} },
  });
  const X = loadInterceptor(buildSrc, sandbox);
  // le play request est SANS GUID (v5/sessions/cloud/play) — le hook route
  // via url.endsWith("/sessions/cloud/play") ; state/configuration ont le GUID.
  const req = new Request(
    "https://uks.core.gssv-play-prod.xboxlive.com/v5/sessions/cloud/play",
    { method: "POST", body: JSON.stringify(PLAY_BODY), headers: { "content-type": "application/json" } }
  );
  await X.handle(req);
  if (!sent) return { ok: false, error: "handle() n'a pas appelé NATIVE_FETCH (URL non routée ?)" };
  const sentBody = JSON.parse(await sent.req.clone().text());
  const deviceInfoHeader = sent.req.headers.get("x-ms-device-info");
  let deviceInfo = null;
  try { deviceInfo = deviceInfoHeader ? JSON.parse(deviceInfoHeader) : null; } catch (e) {}
  return {
    ok: sentBody.settings.osName === "tizen" && deviceInfo && deviceInfo.dev.os.name === "tizen",
    osName: sentBody.settings.osName,
    original: PLAY_BODY.settings.osName,
    deviceInfoOs: deviceInfo && deviceInfo.dev.os.name,
    localeIntact: sentBody.settings.locale === "fr-FR",
    clientSessionIdIntact: sentBody.clientSessionId === "abc-def-123",
  };
}

/**
 * Mesure P2 : la réponse /configuration passant par handleConfiguration
 * (via handle) doit ressortir avec les overrides fusionnés côté client.
 */
async function measureP2(buildSrc) {
  const nativeFetch = async (req, init) => {
    return new Response(JSON.stringify(CONFIG_BODY), { status: 200, headers: { "content-type": "application/json" } });
  };
  const sandbox = makeSandbox({
    nativeFetch,
    prefs: {
      global: {
        "touchController.mode": "default",
        "nativeMkb.mode": "on",
        "audio.mic.onPlaying": true,
      },
      stream: { "localCoOp.enabled": false },
    },
    states: { serverRegions: {}, currentStream: { titleInfo: null } },
  });
  const X = loadInterceptor(buildSrc, sandbox);
  const req = new Request(
    "https://uks.core.gssv-play-prod.xboxlive.com/v5/sessions/cloud/8A7F6A20-DA4A-4607-9B45-29180C93730B/configuration",
    { method: "GET" }
  );
  const resp = await X.handle(req);
  const obj = await resp.json();
  const overrides = JSON.parse(obj.clientStreamingConfigOverrides);
  return {
    ok:
      overrides.inputConfiguration.enableVibration === true &&
      overrides.inputConfiguration.enableMouseInput === true &&
      overrides.inputConfiguration.enableKeyboardInput === true &&
      overrides.audioConfiguration && overrides.audioConfiguration.enableMicrophone === true,
    enableVibration: overrides.inputConfiguration.enableVibration,
    enableMouse: overrides.inputConfiguration.enableMouseInput,
    enableKeyboard: overrides.inputConfiguration.enableKeyboardInput,
    enableMicrophone: overrides.audioConfiguration && overrides.audioConfiguration.enableMicrophone,
    serveurPreservé: overrides.inputConfiguration.useIntervalWorkerThreadForInput === true &&
      overrides.videoConfiguration && overrides.videoConfiguration.preferMainH264Profile === true,
    keepAliveIntact: obj.keepAlivePulseInSeconds === 60,
  };
}

// ---------- point d'entrée ----------
function measure(buildPath) {
  const src = fs.readFileSync(buildPath, "utf8");
  return { src, extract: extractFromBuild(src) };
}

module.exports = { extractFromBuild, makeSandbox, loadInterceptor, measureP3, measureP2, measure, PLAY_BODY, CONFIG_BODY };

// exécution directe : rapport
if (require.main === module) {
  const buildPath = process.argv[2] || BUILD;
  if (!fs.existsSync(buildPath)) { console.error("build introuvable : " + buildPath); process.exit(1); }
  const src = fs.readFileSync(buildPath, "utf8");
  console.log("# Mesure réécriture userscript P2+P3 (XcloudInterceptor du build preview)\n");
  console.log("- Build : " + buildPath + "\n");
  const { xcloudClass, osNameFn, deviceInfoFn } = extractFromBuild(src);
  console.log("## Extraction (du build réel)");
  console.log("- `class XcloudInterceptor` : " + xcloudClass.length + " chars");
  console.log("- `getOsNameFromResolution` : " + osNameFn.length + " chars");
  console.log("- `generateMsDeviceInfo` : " + deviceInfoFn.length + " chars");

  (async () => {
    const p3 = await measureP3(src, "1080p-hq");
    const p2 = await measureP2(src);
    console.log("\n## P3 — play request (via handle → NATIVE_FETCH)");
    console.log("- osName réécrit : " + (p3.ok ? `✅ ${p3.original} → ${p3.osName}` : `❌ ${JSON.stringify(p3)}`));
    console.log("- x-ms-device-info : " + (p3.deviceInfoOs ? `✅ dev.os.name=${p3.deviceInfoOs}` : "❌ absent"));
    console.log("- réécriture chirurgicale (locale + clientSessionId intacts) : " + (p3.localeIntact && p3.clientSessionIdIntact ? "✅" : "❌"));
    console.log("\n## P2 — réponse /configuration (via handleConfiguration)");
    console.log("- enableVibration : " + (p2.enableVibration === true ? "✅ true" : "❌ " + p2.enableVibration));
    console.log("- enableMouseInput/enableKeyboardInput (mkb=on) : " + (p2.enableMouse === true && p2.enableKeyboard === true ? "✅" : "❌"));
    console.log("- enableMicrophone (mic=on) : " + (p2.enableMicrophone === true ? "✅" : "❌"));
    console.log("- overrides serveur préservés : " + (p2.serveurPreservé ? "✅" : "❌"));
    console.log("- champs racine intacts (keepAlive) : " + (p2.keepAliveIntact ? "✅" : "❌"));
    const ok = p3.ok && p3.deviceInfoOs === "tizen" && p2.ok;
    console.log("\n" + (ok
      ? "VERDICT : réécriture userscript P2+P3 COMPLÈTE ✅ — XcloudInterceptor du build preview réécrit play + configuration sans CDP"
      : "VERDICT : réécriture incomplète ❌ — voir les échecs"));
    process.exit(ok ? 0 : 1);
  })();
}
