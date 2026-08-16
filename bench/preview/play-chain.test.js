#!/usr/bin/env node
/*
 * play-chain.test.js — test de la garde anti-dérive de la chronologie du
 * play request (bench/preview/play-chain.js).
 *
 * Vérifie sur des bundles factices (créés dans un tmp dédié, indépendants du
 * chemin réel des bundles preview) : ancres stables → exit 0 ; ancre absente
 * → drift détecté et exit 1 ; bundle absent → drift ; régénération de la
 * référence markdown.
 *
 * Usage : node bench/preview/play-chain.test.js
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT = path.join(__dirname, "play-chain.js");
let failures = 0;
function check(label, cond, extra) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures++; console.error(`  ❌ ${label}${extra ? " :: " + extra : ""}`); }
}

// bundles factices au format minifié (style rolldown, sans espaces) pour
// matcher les ancres exactes de play-chain.js
const ENTRY_CLIENT = `
const accs = {
  createMutations() {
    return { requestConnection: this.createMutation({ mutationFn: async () => {
      let e; try { e = await this.env.queryClient.fetchQuery(this.queries.connectionEligibility.getOptions()) } catch { return 'notEligible' }
      return e.status === 'eligible' ? (await this.syncConnectionState(e), 'connected') : 'notEligible'
    }}) }
  },
  async syncConnectionState(e) {
    let t = e || await this.queryClient.fetchQuery(this.queries.connectionEligibility.getOptions());
    if (this.connectionManager.canTransitionTo('sessionConnecting')) {
      console.info('Eligible, connecting to ACCS...');
      await this.connectionManager.connect(e.streamUser);
    }
  },
  async performConnect(e) {
    let t=await e.getToken();if(!t){this.logger.error('No token, cannot connect');return}
    let n=await this.createSession(t);this.setupSessionListeners(n);await n.connect({timeoutInMs:1})
  },
  async createSession(e) {
    let n=await this.queries.getHttpConfiguration(),r={getToken:async(t,n)=>({token:'Bearer '+e})};
    return this.accs.createSession({httpConfiguration:{...n,gsTokenProvider:r}})
  }
};
`;

const BOOTSTRAPPER = `
import{i as er,o as tr}from"./StreamSessionRequest-iiux1fqv.js";
export const boot = () => tr.createSession();
`;

const STREAM_SESSION = `
export class Session {
  async createSession(e,t){this.audioContext=t;await this.startProcessingRequest()}
  async startProcessingRequest(){this.logger.info('Creating new cloud session.');await this.triggerPlayRequest(r)}
  async triggerPlayRequest(r){const t=await this.sendPlayRequest(this.user,r,this.cv);this.logger.info(\`sessionPath: \${t.sessionPath}\`)}
  async sendPlayRequest(e,t){return this.playService.sendPlayCloud(e,t)}
}
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "playchain-"));
function writeTmp(name, content) {
  fs.writeFileSync(path.join(tmp, name), content, "utf8");
}

console.log("== ancres stables ==");
writeTmp("entry.client-good.js", ENTRY_CLIENT);
writeTmp("GameStreamBootstrapper-good.js", BOOTSTRAPPER);
writeTmp("StreamSessionRequest-good.js", STREAM_SESSION);
let r = spawnSync("node", [SCRIPT, tmp], { encoding: "utf8" });
check("ancres stables → exit 0", r.status === 0, `exit=${r.status} :: ${r.stderr}`);
check("chaîne OK affichée", r.stdout.includes("OK — ancres stables"));

console.log("== dérive : ancre manquante ==");
// même bundle sans la mutation requestConnection
writeTmp("entry.client-good.js", ENTRY_CLIENT.replace("requestConnection:", "requestReconnect:"));
r = spawnSync("node", [SCRIPT, tmp], { encoding: "utf8" });
check("ancre manquante → exit 1", r.status === 1, `exit=${r.status} :: ${r.stderr}`);
check("DRIFT signalé", r.stdout.includes("DRIFT"));

console.log("== dérive : import statique rompu ==");
writeTmp("entry.client-good.js", ENTRY_CLIENT); // restaurer
writeTmp("GameStreamBootstrapper-good.js", BOOTSTRAPPER.replace("import{i as er,o as tr}", "import{x as er}"));
r = spawnSync("node", [SCRIPT, tmp], { encoding: "utf8" });
check("import rompu → exit 1", r.status === 1, `exit=${r.status} :: ${r.stderr}`);

console.log("== dérive : bundle absent ==");
fs.rmSync(path.join(tmp, "StreamSessionRequest-good.js"));
r = spawnSync("node", [SCRIPT, tmp], { encoding: "utf8" });
check("bundle absent → exit 1", r.status === 1, `exit=${r.status} :: ${r.stderr}`);

console.log("== régénération de la référence ==");
fs.writeFileSync(path.join(tmp, "StreamSessionRequest-good.js"), STREAM_SESSION);
writeTmp("entry.client-good.js", ENTRY_CLIENT);
writeTmp("GameStreamBootstrapper-good.js", BOOTSTRAPPER);
r = spawnSync("node", [SCRIPT, tmp, "--write"], { encoding: "utf8" });
// --write écrit toujours dans bench/preview/play-chain.md (chemin fixe du script) —
// vérifier que la génération ne plante pas et que le fichier existe
check("--write : génération sans erreur", r.status === 0, `exit=${r.status} :: ${r.stderr}`);
check("--write : référence écrite", fs.existsSync(path.join(__dirname, "play-chain.md")), "play-chain.md absent");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? "\nTest play-chain : OK ✅" : `\n${failures} échec(s) ❌`);
process.exit(failures === 0 ? 0 : 1);
