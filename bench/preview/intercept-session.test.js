#!/usr/bin/env node
/*
 * intercept-session.test.js — self-test de l'interception CDP P3+P2.
 *
 * Teste la logique pure sur les formes RÉELLES capturées en session
 * (body du play request + réponse /configuration, session.md) et le flux
 * CDP simulé (Fetch.requestPaused → continueRequest / getResponseBody →
 * fulfillRequest) : P3 réécrit settings.osName + x-ms-device-info, P2
 * fusionne les overrides dans clientStreamingConfigOverrides, tout ce qui
 * ne matche pas est continué tel quel.
 *
 * Usage : node bench/preview/intercept-session.test.js
 */
"use strict";

const path = require("path");
const { getOsNameFromResolution, generateMsDeviceInfo, rewritePlayBody, mergeStreamingOverrides, rewriteConfigurationBody, installInterceptor, PLAY_RE, CONFIG_RE } = require("./intercept-session.js");

let failures = 0;
function check(label, cond, extra) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures++; console.error(`  ❌ ${label}${extra ? " :: " + extra : ""}`); }
}

// ---------------- fixtures réelles (capturées le 16 août) ----------------

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

const PREFS = { resolution: "1080p-hq", vibration: true, mkb: true, touch: true, mic: true };

// ---------------- 1. logique pure ----------------

console.log("== logique pure ==");

check("getOsNameFromResolution : 1080p-hq→tizen", getOsNameFromResolution("1080p-hq") === "tizen");
check("getOsNameFromResolution : 1080p→windows", getOsNameFromResolution("1080p") === "windows");
check("getOsNameFromResolution : défaut→android", getOsNameFromResolution("autre") === "android");

const di = generateMsDeviceInfo("tizen", "play.xbox.com");
check("generateMsDeviceInfo : dev.os.name=tizen", di.dev.os.name === "tizen");
check("generateMsDeviceInfo : displayInfo 4096x2160", di.dev.displayInfo.dimensions.widthInPixels === 4096 && di.dev.displayInfo.dimensions.heightInPixels === 2160);
check("generateMsDeviceInfo : appInfo.env.clientAppId=host", di.appInfo.env.clientAppId === "play.xbox.com");

// P3 : body du play request réel réécrit
const rewritten = rewritePlayBody(PLAY_BODY, "1080p-hq");
check("rewritePlayBody : osName réécrit en tizen", rewritten && rewritten.settings.osName === "tizen");
check("rewritePlayBody : le reste intact (titleId/locale/timezone)", rewritten && rewritten.titleId === PLAY_BODY.titleId && rewritten.settings.locale === "fr-FR" && rewritten.settings.timezoneOffsetMinutes === 120 && rewritten.settings.nanoVersion === "V3;WebrtcTransport.dll");
check("rewritePlayBody : clientSessionId préservé", rewritten && rewritten.clientSessionId === "abc-def-123");
check("rewritePlayBody : auto → null (rien à faire)", rewritePlayBody(PLAY_BODY, "auto") === null);
check("rewritePlayBody : non-objet → null", rewritePlayBody(null, "1080p") === null);

// P2 : fusion sur la réponse /configuration réelle
const cfg = rewriteConfigurationBody(CONFIG_BODY, PREFS);
const ov = JSON.parse(cfg.clientStreamingConfigOverrides);
check("rewriteConfigurationBody : overrides serveur préservés (useIntervalWorkerThreadForInput)", ov.inputConfiguration.useIntervalWorkerThreadForInput === true);
check("rewriteConfigurationBody : enableVibration ajouté", ov.inputConfiguration.enableVibration === true);
check("rewriteConfigurationBody : enableMouseInput/enableKeyboardInput (mkb)", ov.inputConfiguration.enableMouseInput === true && ov.inputConfiguration.enableKeyboardInput === true);
check("rewriteConfigurationBody : enableTouchInput + maxTouchPoints 10", ov.inputConfiguration.enableTouchInput === true && ov.inputConfiguration.maxTouchPoints === 10);
check("rewriteConfigurationBody : enableMicrophone ajouté", ov.audioConfiguration && ov.audioConfiguration.enableMicrophone === true);
check("rewriteConfigurationBody : nqi/statistics/video intacts", ov.nqiConfiguration.pingMsBadThreshold === 100 && ov.statisticsConfiguration.useQosChannel === true && ov.videoConfiguration.preferMainH264Profile === true);
check("rewriteConfigurationBody : champs racine intacts (keepAlive/serverDetails)", cfg.keepAlivePulseInSeconds === 60 && cfg.serverDetails.port === 1059);

// P2 sans préférence → rien d'ajouté (mais rien cassé)
const cfg2 = rewriteConfigurationBody(CONFIG_BODY, { resolution: "auto", vibration: false, mkb: null, touch: false, mic: false });
const ov2 = JSON.parse(cfg2.clientStreamingConfigOverrides);
check("rewriteConfigurationBody : préfs off → overrides serveur seuls", ov2.inputConfiguration.enableVibration === undefined && ov2.inputConfiguration.useIntervalWorkerThreadForInput === true);

// ---------------- 2. flux CDP simulé ----------------

console.log("== flux CDP simulé ==");

function fakeCdp() {
  const calls = [];
  const listeners = {};
  return {
    calls,
    listeners,
    async send(method, params) { calls.push({ method, params }); return {}; },
    on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); },
    async fire(event, params) { for (const fn of listeners[event] || []) await fn(params); },
  };
}

(async () => {
  // --- P3 : requête play interceptée et réécrite ---
  {
    const cdp = fakeCdp();
    await installInterceptor(cdp, PREFS, () => {});
    const enableCall = cdp.calls.find((c) => c.method === "Fetch.enable");
    check("Fetch.enable appelé avec 2 patterns (Request play / Response configuration)", !!enableCall && enableCall.params.patterns.length === 2);
    const playPattern = enableCall.params.patterns.find((p) => p.urlPattern.includes("play"));
    const cfgPattern = enableCall.params.patterns.find((p) => p.urlPattern.includes("configuration"));
    check("pattern play : requestStage Request", playPattern && playPattern.requestStage === "Request");
    check("pattern configuration : requestStage Response", cfgPattern && cfgPattern.requestStage === "Response");

    await cdp.fire("Fetch.requestPaused", {
      requestId: "req-play-1",
      request: {
        url: "https://uks.core.gssv-play-prod.xboxlive.com/v5/sessions/cloud/8A7F6A20-DA4A-4607-9B45-29180C93730B/play",
        method: "POST",
        headers: { "content-type": "application/json", "accept": "*/*" },
        postData: JSON.stringify(PLAY_BODY),
      },
    });
    const cont = cdp.calls.find((c) => c.method === "Fetch.continueRequest" && c.params.requestId === "req-play-1");
    check("P3 : continueRequest envoyé pour le play", !!cont);
    const contBody = cont && JSON.parse(cont.params.postData);
    check("P3 : postData réécrit (settings.osName=tizen)", contBody && contBody.settings.osName === "tizen");
    const deviceInfoHeader = cont && cont.params.headers.find((h) => h.name.toLowerCase() === "x-ms-device-info");
    check("P3 : header x-ms-device-info ajouté", deviceInfoHeader && JSON.parse(deviceInfoHeader.value).dev.os.name === "tizen");
    check("P3 : headers d'origine préservés (content-type)", cont && cont.params.headers.some((h) => h.name.toLowerCase() === "content-type" && h.value === "application/json"));
  }

  // --- P2 : réponse /configuration interceptée et réécrite ---
  {
    const cdp = fakeCdp();
    cdp.send = async (method, params) => {
      cdp.calls.push({ method, params });
      if (method === "Fetch.getResponseBody") {
        return { body: JSON.stringify(CONFIG_BODY), base64Encoded: false };
      }
      return {};
    };
    await installInterceptor(cdp, PREFS, () => {});
    await cdp.fire("Fetch.requestPaused", {
      requestId: "req-cfg-1",
      request: {
        url: "https://uks.core.gssv-play-prod.xboxlive.com/v5/sessions/cloud/8A7F6A20-DA4A-4607-9B45-29180C93730B/configuration",
        method: "GET",
        headers: {},
      },
      responseStatusCode: 200,
      responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "content-length", value: "999" }],
    });
    const fulfilled = cdp.calls.find((c) => c.method === "Fetch.fulfillRequest" && c.params.requestId === "req-cfg-1");
    check("P2 : fulfillRequest envoyé pour la configuration", !!fulfilled);
    const resBody = fulfilled && JSON.parse(Buffer.from(fulfilled.params.body, "base64").toString("utf8"));
    const resOv = resBody && JSON.parse(resBody.clientStreamingConfigOverrides);
    check("P2 : body réécrit avec enableVibration", resOv && resOv.inputConfiguration.enableVibration === true);
    check("P2 : overrides serveur préservés", resOv && resOv.inputConfiguration.useIntervalWorkerThreadForInput === true);
    check("P2 : content-length retiré (body changé)", fulfilled && !fulfilled.params.responseHeaders.some((h) => h.name.toLowerCase() === "content-length"));
    check("P2 : content-type préservé", fulfilled && fulfilled.params.responseHeaders.some((h) => h.name.toLowerCase() === "content-type"));
    check("P2 : responseCode 200", fulfilled && fulfilled.params.responseCode === 200);
  }

  // --- requête non ciblée : continuée telle quelle ---
  {
    const cdp = fakeCdp();
    await installInterceptor(cdp, PREFS, () => {});
    await cdp.fire("Fetch.requestPaused", {
      requestId: "req-asset-1",
      request: { url: "https://play.xbox.com/assets/entry.client-h6o444u3.js", method: "GET", headers: {} },
    });
    const cont = cdp.calls.find((c) => c.method === "Fetch.continueRequest" && c.params.requestId === "req-asset-1");
    check("non-ciblé : continueRequest sans modification", !!cont && !cont.params.postData && !cont.params.headers);
  }

  // --- play GET (polling state) : non réécrit, continué ---
  {
    const cdp = fakeCdp();
    await installInterceptor(cdp, PREFS, () => {});
    await cdp.fire("Fetch.requestPaused", {
      requestId: "req-state-1",
      request: { url: "https://uks.core.gssv-play-prod.xboxlive.com/v5/sessions/cloud/8A7F6A20-DA4A-4607-9B45-29180C93730B/state", method: "GET", headers: {} },
    });
    const cont = cdp.calls.find((c) => c.method === "Fetch.continueRequest" && c.params.requestId === "req-state-1");
    check("state (GET, non-play) : continué sans modification", !!cont && !cont.params.postData);
  }

  // --- regex : formes d'URL réelles ---
  check("PLAY_RE : URL play réelle", PLAY_RE.test("https://uks.core.gssv-play-prod.xboxlive.com/v5/sessions/cloud/8A7F6A20-DA4A-4607-9B45-29180C93730B/play"));
  check("CONFIG_RE : URL configuration réelle", CONFIG_RE.test("https://uks.core.gssv-play-prod.xboxlive.com/v5/sessions/cloud/8A7F6A20-DA4A-4607-9B45-29180C93730B/configuration"));
  check("PLAY_RE : ne matche pas state", !PLAY_RE.test("https://uks.core.gssv-play-prod.xboxlive.com/v5/sessions/cloud/8A7F6A20-DA4A-4607-9B45-29180C93730B/state"));
  check("PLAY_RE : ne matche pas login", !PLAY_RE.test("https://cloudgaming.gssv-play-prod.xboxlive.com/v2/login/user"));

  console.log(failures === 0 ? "\nSelf-test intercept-session : OK ✅" : `\n${failures} échec(s) ❌`);
  process.exit(failures === 0 ? 0 : 1);
})();
