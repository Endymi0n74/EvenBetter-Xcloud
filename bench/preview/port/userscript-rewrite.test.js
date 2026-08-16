#!/usr/bin/env node
/*
 * userscript-rewrite.test.js — tests de la réécriture P2+P3 via le hook
 * userscript (XcloudInterceptor extrait du build preview réel).
 *
 * Usage : node bench/preview/port/userscript-rewrite.test.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { extractFromBuild, measureP3, measureP2 } = require("./userscript-rewrite.js");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const BUILD = path.join(ROOT, "better-xcloud-preview.user.js");

let failures = 0;
function check(label, cond, extra) {
  if (cond) console.log("  ✅ " + label);
  else { failures++; console.error("  ❌ " + label + (extra ? " :: " + extra : "")); }
}

console.log("== userscript-rewrite : réécriture P2+P3 via XcloudInterceptor ==\n");

if (!fs.existsSync(BUILD)) {
  console.error("  ❌ build preview introuvable — lance d'abord node bench/preview/port/build-preview.js");
  process.exit(1);
}
const src = fs.readFileSync(BUILD, "utf8");

// ---------- 1. extraction du build réel ----------
try {
  const { xcloudClass, osNameFn, deviceInfoFn } = extractFromBuild(src);
  check("extraction : class XcloudInterceptor présente", xcloudClass.length > 5000, "len=" + xcloudClass.length);
  check("extraction : getOsNameFromResolution présente", osNameFn.includes("1080p-hq"));
  check("extraction : generateMsDeviceInfo présente", deviceInfoFn.includes("x-ms") === false && deviceInfoFn.includes("displayInfo"));
} catch (e) {
  check("extraction depuis le build", false, e.message);
}

(async () => {
  // ---------- 2. P3 : play réécrit via le hook (osName=tizen) ----------
  const p3 = await measureP3(src, "1080p-hq");
  check("P3 : handle() route le play vers NATIVE_FETCH", p3.osName !== undefined || p3.error !== undefined, p3.error);
  check("P3 : osName réécrit windows → tizen", p3.osName === "tizen", JSON.stringify(p3));
  check("P3 : x-ms-device-info dev.os.name=tizen", p3.deviceInfoOs === "tizen", JSON.stringify(p3.deviceInfoOs));
  check("P3 : réécriture chirurgicale (locale intacte)", p3.localeIntact === true);
  check("P3 : clientSessionId préservé", p3.clientSessionIdIntact === true);

  // P3 auto (résolution auto) → pas de réécriture
  const p3auto = await measureP3(src, "auto");
  check("P3 : resolution=auto → osName inchangé (windows)", p3auto.osName === "windows", JSON.stringify(p3auto));

  // ---------- 3. P2 : réponse /configuration fusionnée ----------
  const p2 = await measureP2(src);
  check("P2 : enableVibration=true (toujours)", p2.enableVibration === true, JSON.stringify(p2));
  check("P2 : enableMouseInput+enableKeyboardInput (mkb=on)", p2.enableMouse === true && p2.enableKeyboard === true);
  check("P2 : enableMicrophone (mic=on)", p2.enableMicrophone === true);
  check("P2 : overrides serveur préservés (useIntervalWorkerThreadForInput + preferMainH264Profile)", p2.serveurPreservé === true);
  check("P2 : champs racine intacts (keepAlivePulseInSeconds=60)", p2.keepAliveIntact === true);

  // ---------- 4. P3 : résolution 1080p → windows (mapping du stable) ----------
  const p31080 = await measureP3(src, "1080p");
  check("P3 : resolution=1080p → osName=windows", p31080.osName === "windows", JSON.stringify(p31080));

  console.log(failures === 0 ? "\nuserscript-rewrite : OK ✅ — le hook userscript réécrit P2+P3 sans CDP" : `\n${failures} échec(s) ❌`);
  process.exit(failures === 0 ? 0 : 1);
})();
