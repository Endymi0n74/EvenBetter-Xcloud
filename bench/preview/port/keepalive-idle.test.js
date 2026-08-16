#!/usr/bin/env node
/*
 * keepalive-idle.test.js — self-test P1 (ancre identique au stable).
 *
 * 1. Transform source : applique patchStreamSessionRequestSource au bundle
 *    capturé StreamSessionRequest-*.js (D:/tmp/preview-player) et vérifie le
 *    remplacement (NEW présent, OLD absent, 1 occurrence) + node --check du
 *    module patché.
 * 2. Cas d'erreur : ancre absente, doublon, déjà patché.
 * 3. Runtime : installKeepAliveIdle() dans un window simulé — hook fetch qui
 *    renvoie le module patché, wrapSession qui intercepte WarningForBeingIdle.
 *
 * Usage : node bench/preview/port/keepalive-idle.test.js
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");
const {
  KEEPALIVE_OLD,
  KEEPALIVE_NEW,
  patchStreamSessionRequestSource,
  installKeepAliveIdle,
} = require("./keepalive-idle.js");

let failures = 0;
function check(label, cond, extra) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures++; console.error(`  ❌ ${label}${extra ? " :: " + extra : ""}`); }
}

const BUNDLE_DIR = "D:/tmp/preview-player";
const bundle = fs.existsSync(BUNDLE_DIR)
  ? fs.readdirSync(BUNDLE_DIR).find((f) => /^StreamSessionRequest-.*\.js$/.test(f))
  : null;
const bundlePath = bundle ? path.join(BUNDLE_DIR, bundle) : null;

console.log("== 1. Transform sur le bundle capturé ==");
if (!bundlePath) {
  console.error("  ⚠️  bundle StreamSessionRequest absent — tests source ignorés");
} else {
  const src = fs.readFileSync(bundlePath, "utf8");
  console.log(`  bundle: ${bundle} (${src.length} octets)`);

  let count = 0, i = -1;
  while ((i = src.indexOf(KEEPALIVE_OLD, i + 1)) !== -1) count++;
  check("KEEPALIVE_OLD présent exactement 1×", count === 1, `count=${count}`);

  const r = patchStreamSessionRequestSource(src);
  check("transform ok+patched", r.ok && r.patched, JSON.stringify(r));
  check("NEW présent", r.src && r.src.includes(KEEPALIVE_NEW));
  check("OLD absent", r.src && !r.src.includes(KEEPALIVE_OLD));

  // node --check sur le module patché (fichier .mjs — imports ESM)
  const tmp = path.join(os.tmpdir(), `bx-keepalive-check-${Date.now()}.mjs`);
  fs.writeFileSync(tmp, r.src, "utf8");
  try {
    execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
    check("module patché syntaxiquement valide (node --check)", true);
  } catch (e) {
    check("module patché syntaxiquement valide (node --check)", false, String(e.stderr || e.message).slice(0, 200));
  } finally {
    fs.unlinkSync(tmp);
  }
}

console.log("\n== 2. Cas d'erreur ==");
{
  const noAnchor = patchStreamSessionRequestSource("var x = 1;");
  check("ancre absente → error anchor-not-found", !noAnchor.ok && noAnchor.error === "anchor-not-found");

  const dup = KEEPALIVE_OLD + ";var y=2;" + KEEPALIVE_OLD;
  const dupRes = patchStreamSessionRequestSource(dup);
  check("ancre dupliquée → error anchor-duplicated:2", !dupRes.ok && dupRes.error === "anchor-duplicated:2");

  const once = patchStreamSessionRequestSource(KEEPALIVE_OLD);
  const twice = patchStreamSessionRequestSource(once.src);
  check("déjà patché → skipped already-patched", twice.ok && !twice.patched && twice.skipped === "already-patched");

  check("entrée non-string → error not-a-string", !patchStreamSessionRequestSource(42).ok);
}

console.log("\n== 3. Runtime (installKeepAliveIdle en vm) ==");
{
  // window simulé : BxLogger + fetch qui sert le module réel
  const moduleSource = bundlePath ? fs.readFileSync(bundlePath, "utf8") : KEEPALIVE_OLD;
  const sandbox = {
    console,
    window: null,
    Response,
    Blob,
    BxLogger: { info: () => {} },
  };
  sandbox.window = sandbox;
  let served = 0;
  sandbox.fetch = (input) => {
    const url = typeof input === "string" ? input : input.url;
    served++;
    return Promise.resolve(new Response(moduleSource, { status: 200, headers: { "content-type": "text/javascript" } }));
  };
  vm.createContext(sandbox);
  vm.runInContext("(" + installKeepAliveIdle.toString() + ")();", sandbox);

  const newJson = JSON.stringify(KEEPALIVE_NEW);
  const oldJson = JSON.stringify(KEEPALIVE_OLD);
  return vm
    .runInContext(
      `window.fetch("https://xbox.com/assets/StreamSessionRequest-iiux1fqv.js")
         .then(function (resp) { return resp.text(); })
         .then(function (text) {
           return JSON.stringify({
             newPresent: text.indexOf(${newJson}) !== -1,
             oldAbsent: text.indexOf(${oldJson}) === -1,
           });
         });`,
      sandbox
    )
    .then((json) => {
      const out = JSON.parse(json);
      check("hook fetch : module renvoyé patché (NEW présent, OLD absent)", out.newPresent && out.oldAbsent, json);
      check("hook fetch : le fetch simulé a bien été appelé", served === 1, `served=${served}`);

      // wrapSession : la session factice intercepte WarningForBeingIdle
      const ws = vm.runInContext(
        `(function () {
           var keepAlives = 0, orgCalled = 0;
           var session = {
             sendKeepAlive: function () { keepAlives++; },
             onServerDisconnectMessage: function (e) { orgCalled++; }
           };
           var w = window.PreviewKeepAliveIdle.wrapSession(session);
           session.onServerDisconnectMessage(JSON.stringify({ reason: "WarningForBeingIdle", secondsUntilKick: 30 }));
           var afterWarning = { keepAlives: keepAlives, orgCalled: orgCalled };
           session.onServerDisconnectMessage(JSON.stringify({ reason: "KickForClosedGame" }));
           var afterKick = { keepAlives: keepAlives, orgCalled: orgCalled };
           var w2 = window.PreviewKeepAliveIdle.wrapSession(session);
           return JSON.stringify({ wrapped: w, rewrap: w2, afterWarning: afterWarning, afterKick: afterKick });
         })()`,
        sandbox
      );
      const wsOut = JSON.parse(ws);
      check("wrapSession : WarningForBeingIdle → sendKeepAlive (pas le handler d'origine)",
        wsOut.wrapped === true && wsOut.afterWarning.keepAlives === 1 && wsOut.afterWarning.orgCalled === 0, ws);
      check("wrapSession : raison non-idle → handler d'origine conservé", wsOut.afterKick.orgCalled === 1, ws);
      check("wrapSession : re-wrap idempotent", wsOut.rewrap === true, ws);
    });
}

console.log(failures === 0 ? "\nTous les tests passent ✅" : `\n${failures} échec(s) ❌`);
process.exit(failures === 0 ? 0 : 1);
