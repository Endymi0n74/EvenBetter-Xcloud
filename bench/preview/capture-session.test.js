#!/usr/bin/env node
/*
 * capture-session.test.js — smoke test du harnais de capture protocole (P3).
 *
 * Charge capture-session.js dans un window simulé (fetch/Response/Request
 * réels de Node + faux XHR/WebSocket/performance), déclenche des requêtes
 * endpoint (play/configuration) et non-endpoint (asset .js) sur les 3
 * transports, et vérifie : capture sélective, body request lu, body response
 * lu, WebSocket suivi, dump resource timing dans le rapport, diagnostic.
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

// ---- faux XMLHttpRequest (open/send + loadend + responseText) ----
class FakeXHR {
  constructor() { this.status = 0; this.responseText = ""; this._ls = {}; this.__bx = null; }
  addEventListener(ev, fn) { (this._ls[ev] = this._ls[ev] || []).push(fn); }
  open(method, url) { this._m = method; this._u = url; }
  send(body) { this._b = body; }
  // helper de test : simule la fin de la requête
  _finish(status, text) {
    this.status = status;
    this.responseText = text;
    for (const fn of this._ls.loadend || []) fn.call(this);
  }
}

// ---- faux WebSocket ----
function FakeWS(url, protocols) {
  this.url = url;
  this.readyState = 0;
  this._ls = {};
}
FakeWS.CONNECTING = 0; FakeWS.OPEN = 1; FakeWS.CLOSING = 2; FakeWS.CLOSED = 3;
FakeWS.prototype.addEventListener = function (ev, fn) { (this._ls[ev] = this._ls[ev] || []).push(fn); };
FakeWS.prototype._fire = function (ev, arg) { for (const fn of this._ls[ev] || []) fn.call(this, arg); };

const sandbox = {
  console, URL, Blob, Request, Response,
  location: { href: "https://play.xbox.com/stream/BWBP12345" },
  history: { pushState() {}, replaceState() {} },
  XMLHttpRequest: FakeXHR,
  WebSocket: FakeWS,
  navigator: { serviceWorker: { controller: null, register: () => Promise.resolve({}) } },
  performance: {
    getEntriesByType: (t) => t === "resource" ? [
      { name: "https://westus.gssv-prod.xboxlive.com/v5/abc-def-123/play" },
      { name: "https://westus.gssv-prod.xboxlive.com/v5/abc-def-123/configuration" },
      { name: "https://play.xbox.com/assets/entry.client-xyz.js" },
    ] : [],
  },
};
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
check("API exposée (BX_SESSION_CAPTURE)", !!cap && typeof cap.report === "function" && typeof cap.download === "function" && typeof cap.diag === "function");

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

  // 4. XHR endpoint (POST play via xhr) — capturé via le hook open/send/loadend
  const xhr = new FakeXHR();
  xhr.open("POST", "https://westus.gssv-prod.xboxlive.com/v5/abc-def-123/play");
  xhr.send(JSON.stringify(PLAY_BODY));
  xhr._finish(200, JSON.stringify({ sessionId: "sess-xhr" }));

  // 5. XHR non-endpoint — ne doit pas être capturé
  const xhr2 = new FakeXHR();
  xhr2.open("GET", "https://play.xbox.com/assets/chunk-42.js");
  xhr2.send();
  xhr2._finish(200, "/* js */");

  // 6. WebSocket gssv — capturé avec cycle de vie (via le constructeur hooké)
  const ws = new sandbox.WebSocket("wss://gssv-prod.xboxlive.com/session/abc");
  ws._fire("open");

  // 7. WebSocket non-endpoint — pas capturé
  new sandbox.WebSocket("wss://telemetry.xbox.com/events");

  await new Promise((r) => setTimeout(r, 30)); // laisser les clones async se lire

  const reqs = cap.state.requests;
  check("4 requêtes endpoint capturées (fetch play+config, xhr play, ws gssv)", reqs.length === 4, `n=${reqs.length}: ` + reqs.map((r) => r.url).join(", "));

  const play = reqs.find((r) => r.via === "fetch" && /\/play/.test(r.url));
  check("play(fetch) : méthode POST", play && play.method === "POST");
  check("play(fetch) : statut 200", play && play.status === 200);
  let playParsed = null;
  try { playParsed = play && play.reqBody && JSON.parse(play.reqBody); } catch (e) {}
  check("play(fetch) : body request capturé (osName + sdkType + timezone)",
    playParsed && playParsed.settings && playParsed.settings.osName === "Windows" && playParsed.settings.sdkType === "web" && playParsed.settings.timezoneOffsetMinutes === 420,
    play && play.reqBody);
  check("play(fetch) : body response capturé (clientStreamingConfigOverrides)", play && play.resBody && play.resBody.includes("clientStreamingConfigOverrides"), play && play.resBody);

  const cfg = reqs.find((r) => r.via === "fetch" && /\/configuration/.test(r.url));
  check("configuration : capturée", !!cfg && cfg.status === 200);

  const pxhr = reqs.find((r) => r.via === "xhr" && /\/play/.test(r.url));
  check("play(xhr) : capturé avec statut 200 + resBody", pxhr && pxhr.status === 200 && pxhr.resBody && pxhr.resBody.includes("sess-xhr"), pxhr && pxhr.status + " / " + pxhr && pxhr.resBody);
  check("play(xhr) : body request lu", pxhr && pxhr.reqBody && pxhr.reqBody.includes("osName"));

  const wsRec = reqs.find((r) => r.via === "ws");
  check("ws gssv : capturé (via=ws)", !!wsRec && /gssv/.test(wsRec.url));
  check("ws gssv : statut 'open' après événement open", wsRec && wsRec.status === "open", wsRec && wsRec.status);

  // 8. compteurs de diagnostic
  const d = cap.diag();
  check("diag : vues fetch=3, xhr=2, ws=2", d.vues.fetch === 3 && d.vues.xhr === 2 && d.vues.ws === 2, JSON.stringify(d.vues));
  check("diag : matchées fetch=2, xhr=1, ws=1", d.matchées.fetch === 2 && d.matchées.xhr === 1 && d.matchées.ws === 1, JSON.stringify(d.matchées));
  check("diag : resource timing protocolaires=2", d.resourceTiming.protocolaires === 2, JSON.stringify(d.resourceTiming));

  // 9. rapport
  const report = cap.report();
  check("rapport : section endpoints", report.includes("## Endpoints") && report.includes("gssv"));
  check("rapport : section play body", report.includes("## Body du/des play request"));
  check("rapport : osName visible", report.includes('"osName"'));
  check("rapport : response play", report.includes("### Response play"));
  check("rapport : trace réseau protocolaire", report.includes("## Trace réseau protocolaire") && report.includes("gssv-prod.xboxlive.com"));
  check("rapport : ligne transports", report.includes("fetch=") && report.includes("xhr=") && report.includes("ws="));

  // 10. workers / service workers : hooks new Worker/SharedWorker + register()
  sandbox.Worker = function FakeWorker(url, opts) { this.url = url; };
  sandbox.SharedWorker = function FakeShared(url, opts) { this.url = url; };
  sandbox.navigator = {
    serviceWorker: {
      controller: null,
      register: function (scriptURL, opts) { this._registered = scriptURL; return Promise.resolve({}); },
    },
  };
  vm.runInContext("BX_SESSION_CAPTURE.stop()", sandbox);
  // re-injecter v3 dans un sandbox neuf pour tester les hooks workers
  const sandbox3 = {
    console, URL, Blob, Request, Response,
    location: { href: "https://play.xbox.com/stream/BWBP12345" },
    history: { pushState() {}, replaceState() {} },
    XMLHttpRequest: FakeXHR,
    WebSocket: FakeWS,
    Worker: function FakeWorker(url) { this.url = url; },
    SharedWorker: function FakeShared(url) { this.url = url; },
    navigator: { serviceWorker: { controller: { scriptURL: "https://play.xbox.com/entry.worker.js?v=3" }, register: function (u) { this._reg = u; return Promise.resolve({}); } } },
    performance: { getEntriesByType: () => [] },
  };
  sandbox3.window = sandbox3;
  sandbox3.addEventListener = () => {};
  sandbox3.removeEventListener = () => {};
  sandbox3.fetch = (input) => Promise.resolve(new Response("{}", { status: 200 }));
  vm.createContext(sandbox3);
  vm.runInContext(SRC, sandbox3);
  const cap3 = sandbox3.BX_SESSION_CAPTURE;
  new sandbox3.Worker("/assets/stream-worker.js");
  new sandbox3.SharedWorker("/assets/shared.js");
  sandbox3.navigator.serviceWorker.register("/entry.worker.js");
  check("workers : new Worker capturé", cap3.state.workers.some((w) => w.kind === "worker" && w.url.includes("stream-worker")));
  check("workers : SharedWorker capturé", cap3.state.workers.some((w) => w.kind === "shared" && w.url.includes("shared")));
  check("workers : register() capturé (sw)", cap3.state.workers.some((w) => w.kind === "sw" && w.url.includes("entry.worker")));
  check("workers : SW déjà actif signalé (sw-active)", cap3.state.workers.some((w) => w.kind === "sw-active" && w.url.includes("entry.worker")));
  check("rapport : ligne workers visible", cap3.report().includes("Workers / service workers vus"));

  // ---- scénario réel : v1 déjà active dans la page → la v2 doit la remplacer ----
  const sandbox2 = {
    console, URL, Blob, Request, Response,
    location: { href: "https://play.xbox.com/stream/BWBP12345" },
    history: { pushState() {}, replaceState() {} },
    XMLHttpRequest: FakeXHR,
    WebSocket: FakeWS,
    performance: { getEntriesByType: () => [] },
  };
  sandbox2.window = sandbox2;
  sandbox2.addEventListener = () => {};
  sandbox2.removeEventListener = () => {};
  sandbox2.navigator = { serviceWorker: { controller: null, register: () => Promise.resolve({}) } };
  sandbox2.fetch = (input) => Promise.resolve(new Response("{}", { status: 200 }));
  // fausse v1 : même NS mais sans VERSION ni diag
  sandbox2.BX_SESSION_CAPTURE = { report() {}, download() {}, stop() { sandbox2._stopped = true; } };
  vm.createContext(sandbox2);
  vm.runInContext(SRC, sandbox2);
  check("v1 présente → la v3 la remplace (VERSION=3)", sandbox2.BX_SESSION_CAPTURE.VERSION === 3);
  check("v1 présente → stop() appelé avant remplacement", sandbox2._stopped === true);
  const cap2 = sandbox2.BX_SESSION_CAPTURE;
  cap2.diag(); // ne doit pas thrower
  check("v3 remplaçante : diag() fonctionne sans erreur", true);

  // fausse v2 (VERSION=2) → la v3 doit aussi la remplacer (workers hooks)
  const sandbox4 = {
    console, URL, Blob, Request, Response,
    location: { href: "https://play.xbox.com/stream/BWBP12345" },
    history: { pushState() {}, replaceState() {} },
    XMLHttpRequest: FakeXHR,
    WebSocket: FakeWS,
    Worker: function FakeWorker(url) { this.url = url; },
    navigator: { serviceWorker: { controller: null, register: () => Promise.resolve({}) } },
    performance: { getEntriesByType: () => [] },
  };
  sandbox4.window = sandbox4;
  sandbox4.addEventListener = () => {};
  sandbox4.removeEventListener = () => {};
  sandbox4.fetch = (input) => Promise.resolve(new Response("{}", { status: 200 }));
  sandbox4.BX_SESSION_CAPTURE = { VERSION: 2, diag() {}, report() {}, download() {}, stop() { sandbox4._stopped = true; } };
  vm.createContext(sandbox4);
  vm.runInContext(SRC, sandbox4);
  check("v2 présente → la v3 la remplace (VERSION=3)", sandbox4.BX_SESSION_CAPTURE.VERSION === 3);
  check("v2 présente → stop() appelé avant remplacement", sandbox4._stopped === true);
  new sandbox4.Worker("/assets/stream-worker.js");
  check("v3 après v2 : hook worker actif", sandbox4.BX_SESSION_CAPTURE.state.workers.some((w) => w.kind === "worker" && w.url.includes("stream-worker")));

  console.log(failures === 0 ? "\nSmoke test capture-session : OK ✅" : `\n${failures} échec(s) ❌`);
  process.exit(failures === 0 ? 0 : 1);
})();
