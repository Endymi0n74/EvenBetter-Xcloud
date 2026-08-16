#!/usr/bin/env node
/*
 * capture-session.test.js — smoke test du harnais de capture protocole (P3).
 *
 * Charge capture-session.js dans un window simulé (fetch/Response/Request
 * réels de Node), déclenche des requêtes endpoint (play/configuration) et
 * non-endpoint (asset .js), et vérifie : capture sélective, body request lu,
 * body response lu, rapport contenant la section play.
 *
 * Usage : node bench/preview/capture-session.test.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "capture-session.js"), "utf8");
let failures = 0;
function check(label, cond, extra) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures++; console.error(`  ❌ ${label}${extra ? " :: " + extra : ""}`); }
}

const PLAY_BODY = {
  titleId: "123456789",
  systemUpdateGroup: "default",
  settings: {
    osName: "Windows",
    highContrast: "Off",
    locale: "en-US",
    useIceConnection: false,
    timezoneOffsetMinutes: 420,
    sdkType: "web",
    enableOptionalDataCollection: undefined,
  },
  serverId: "",
  fallbackRegionNames: [],
};

const sandbox = { console, URL, Blob, Request, Response, location: null, history: null, window: null };
sandbox.location = { href: "https://play.xbox.com/stream/BWBP12345" };
sandbox.history = { pushState() {}, replaceState() {} };
sandbox.window = sandbox;
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};

sandbox.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (/\/v5\/[a-f0-9-]+\/play/.test(url)) {
    return Promise.resolve(new Response(JSON.stringify({ sessionId: "sess-1", serverDetails: { host: "westus" }, clientStreamingConfigOverrides: "{\"inputConfiguration\":{\"enableVibration\":true}}" }), { status: 200, headers: { "content-type": "application/json" } }));
  }
  if (/\/configuration/.test(url)) {
    return Promise.resolve(new Response("{}", { status: 200 }));
  }
  return Promise.resolve(new Response("/* js */", { status: 200, headers: { "content-type": "text/javascript" } }));
};

vm.createContext(sandbox);
vm.runInContext(SRC, sandbox);
// NS est défini en dur dans le script : "BX_SESSION_CAPTURE"
const cap = sandbox.BX_SESSION_CAPTURE;
check("API exposée (BX_SESSION_CAPTURE)", !!cap && typeof cap.report === "function" && typeof cap.download === "function");

(async () => {
  // 1. play (POST avec body JSON) — doit être capturé avec reqBody + resBody
  const playReq = new Request("https://westus.gssv-prod.xboxlive.com/v5/abc-def-123/play", {
    method: "POST",
    body: JSON.stringify(PLAY_BODY),
    headers: { "content-type": "application/json" },
  });
  await sandbox.fetch(playReq);

  // 2. configuration (GET) — capturé, resBody lu
  await sandbox.fetch("https://westus.gssv-prod.xboxlive.com/v5/abc-def-123/configuration");

  // 3. asset JS — NE doit PAS être capturé
  await sandbox.fetch("https://play.xbox.com/assets/entry.client-xyz.js");

  await new Promise((r) => setTimeout(r, 30)); // laisser les clones async se lire

  const reqs = cap.state.requests;
  check("2 requêtes endpoint capturées (play + configuration)", reqs.length === 2, `n=${reqs.length}: ` + reqs.map((r) => r.url).join(", "));

  const play = reqs.find((r) => /\/play/.test(r.url));
  check("play : méthode POST", play && play.method === "POST");
  check("play : statut 200", play && play.status === 200);
  let playParsed = null;
  try { playParsed = play && play.reqBody && JSON.parse(play.reqBody); } catch (e) {}
  check("play : body request capturé (osName + sdkType + timezone)",
    playParsed && playParsed.settings && playParsed.settings.osName === "Windows" && playParsed.settings.sdkType === "web" && playParsed.settings.timezoneOffsetMinutes === 420,
    play && play.reqBody);
  check("play : body response capturé (clientStreamingConfigOverrides)", play && play.resBody && play.resBody.includes("clientStreamingConfigOverrides"), play && play.resBody);

  const cfg = reqs.find((r) => /\/configuration/.test(r.url));
  check("configuration : capturée", !!cfg && cfg.status === 200);

  const report = cap.report();
  check("rapport : section endpoints", report.includes("## Endpoints") && report.includes("gssv"));
  check("rapport : section play body", report.includes("## Body du/des play request"));
  check("rapport : osName visible", report.includes('"osName"'));
  check("rapport : response play", report.includes("### Response play"));

  console.log(failures === 0 ? "\nSmoke test capture-session : OK ✅" : `\n${failures} échec(s) ❌`);
  process.exit(failures === 0 ? 0 : 1);
})();
