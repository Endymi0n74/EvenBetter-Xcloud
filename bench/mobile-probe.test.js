/*
 * mobile-probe.test.js — teste bench/mobile-probe.js contre un FAUX endpoint
 * CDP (HTTP /json + mini serveur WebSocket maison), sans émulateur :
 *
 *   [1] sonde seule (sans --cycle) : marqueurs BX + bouton visible → exit 0
 *   [2] cycle complet : panne (navigate :444) → page d'erreur → retry auto
 *       simulé (+6 s) → récupération sur /play avec overlay → exit 0
 *   [3] path d'échec : bouton invisible → GATE ROUGE (exit 1)
 *   [4] aucune page xbox.com → GATE ROUGE (exit 1)
 *
 * Usage : node bench/mobile-probe.test.js
 */
"use strict";
const assert = require("assert");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");
const path = require("path");

const PROBE = path.join(__dirname, "mobile-probe.js");
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const LIVE = {
  pathname: "/fr-FR/play",
  title: "Xbox Cloud Gaming sur Xbox.com",
  readyState: "complete",
  BX_EXPOSED: "object",
  BX_FETCH: "function",
  BX_CE: "function",
  bxElements: 2,
  settingsBtn: true,
  settingsBtnVisible: true,
};
const BROKEN = { ...LIVE, settingsBtnVisible: false };

function parseFrame(buf) {
  const b0 = buf[0];
  const opcode = b0 & 0x0f;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    len = Number(buf.readBigUInt64BE(2));
    off = 10;
  }
  const mask = buf.slice(off, off + 4);
  off += 4;
  const payload = Buffer.alloc(len);
  for (let i = 0; i < len; i++) payload[i] = buf[off + i] ^ mask[i & 3];
  return { opcode, data: payload.toString("utf8") };
}

function sendFrame(socket, str) {
  const payload = Buffer.from(str, "utf8");
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

/**
 * Faux endpoint CDP.
 *  mode: "ok" | "broken-btn" | "no-xbox"
 */
function startFakeCdp(mode) {
  return new Promise((resolve) => {
    let state = "live"; // live → error → recovered
    let recoveredAt = 0;

    const server = http.createServer((req, res) => {
      if (req.url === "/json") {
        const wsUrl = `ws://127.0.0.1:${server.address().port}/devtools/page/FAKE`;
        const pages =
          mode === "no-xbox"
            ? [{ type: "page", url: "https://example.com/other", webSocketDebuggerUrl: wsUrl }]
            : [{ type: "page", url: "https://www.xbox.com/fr-FR/play", webSocketDebuggerUrl: wsUrl }];
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(pages));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    server.on("upgrade", (req, socket) => {
      const key = req.headers["sec-websocket-key"];
      const accept = crypto
        .createHash("sha1")
        .update(key + WS_GUID)
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
      );
      socket.on("error", () => {}); // ECONNRESET quand le probe ferme : sans handler, crash
      let buf = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
          const sz = frameSize(buf);
          if (buf.length < sz) break; // frame TCP incomplète : attendre la suite
          const f = parseFrame(buf);
          buf = buf.slice(sz);
          if (f.opcode !== 1) continue; // ping/close : ignorer
          let msg;
          try {
            msg = JSON.parse(f.data);
          } catch {
            continue;
          }
          const reply = (result) => sendFrame(socket, JSON.stringify({ id: msg.id, result }));
          if (msg.method === "Page.enable" || msg.method === "Runtime.enable") {
            reply({});
          } else if (msg.method === "Page.navigate") {
            state = "error";
            recoveredAt = Date.now() + 6000; // simule le retry auto à +5 s
            reply({});
          } else if (msg.method === "Runtime.evaluate") {
            const expr = msg.params && msg.params.expression ? msg.params.expression : "";
            let value;
            if (expr.includes("bx-header-settings-button")) {
              // PROBE_JS
              if (mode === "broken-btn") value = BROKEN;
              else if (state === "live" || state === "recovered") value = LIVE;
              else value = { pathname: "", BX_EXPOSED: "undefined", settingsBtn: false, settingsBtnVisible: false };
            } else if (expr.includes("Connexion impossible")) {
              // ERROR_JS
              value =
                state === "error"
                  ? { isErrorPage: true, title: "Connexion impossible", pathname: "" }
                  : { isErrorPage: false, title: "", pathname: "/fr-FR/play" };
            } else if (expr.includes("a.click()")) {
              // CLICK_RETRY_JS : le clic sur « Réessayer » ramène la page
              state = "recovered";
              value = true;
            } else {
              value = {};
            }
            if (state === "error" && Date.now() >= recoveredAt) state = "recovered";
            reply({ result: { type: "object", value } });
          } else {
            reply({});
          }
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        close: () => server.close(),
      });
    });
  });
}

function frameSize(buf) {
  // ⚠ doit RELIRE la longueur étendue (16/64-bit) : un header 126 ne veut pas
  // dire « frame de 126 octets » mais « longueur sur 16 bits qui suit ».
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    len = Number(buf.readBigUInt64BE(2));
    off = 10;
  }
  return off + 4 + len;
}

// spawn ASYNC : spawnSync bloquerait l'event loop du process parent et le
// mock HTTP/WS (même process) ne pourrait jamais répondre → timeout.
function runProbe(port, args) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [PROBE, String(port), "--wait-ms", "3000", ...args], {
      encoding: "utf8",
    });
    let out = "";
    let err = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => c.kill(), 30_000);
    c.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout: out, stderr: err });
    });
  });
}

(async () => {
  let passed = 0;
  const t = (name, fn) => {
    fn();
    passed++;
    console.log(`✅ ${name}`);
  };

  // [1] sonde seule, tout bon
  {
    const fake = await startFakeCdp("ok");
    const r = await runProbe(fake.port, []);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes("bouton settings visible"), r.stdout);
    assert.ok(r.stdout.includes("SONDE OK"), r.stdout);
    t("sonde seule → exit 0 + bouton visible", () => {});
    fake.close();
  }

  // [2] cycle complet panne → récupération
  {
    const fake = await startFakeCdp("ok");
    const r = await runProbe(fake.port, ["--cycle"]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes("page d'erreur affichée"), r.stdout);
    assert.ok(r.stdout.includes("récupération sur /play"), r.stdout);
    assert.ok(r.stdout.includes("MOBILE PROBE OK"), r.stdout);
    t("cycle panne→récupération → exit 0", () => {});
    fake.close();
  }

  // [3] bouton invisible → GATE ROUGE
  {
    const fake = await startFakeCdp("broken-btn");
    const r = await runProbe(fake.port, []);
    assert.strictEqual(r.status, 1);
    assert.ok(r.stdout.includes("bouton settings visible"), r.stdout);
    assert.ok(r.stderr.includes("GATE ROUGE"), r.stderr);
    t("bouton invisible → exit 1 + GATE ROUGE", () => {});
    fake.close();
  }

  // [4] aucune page xbox.com → GATE ROUGE
  {
    const fake = await startFakeCdp("no-xbox");
    const r = await runProbe(fake.port, []);
    assert.strictEqual(r.status, 1);
    assert.ok(r.stderr.includes("aucune page xbox.com"), r.stderr);
    t("aucune page xbox.com → exit 1", () => {});
    fake.close();
  }

  // [5] récupération MANUELLE : clic « Réessayer » → retour /play + overlay
  {
    const fake = await startFakeCdp("ok");
    const r = await runProbe(fake.port, ["--manual"]);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes("clic « Réessayer »"), r.stdout);
    assert.ok(r.stdout.includes("récupération sur /play"), r.stdout);
    assert.ok(r.stdout.includes("MOBILE PROBE OK"), r.stdout);
    t("récupération manuelle (clic Réessayer) → exit 0", () => {});
    fake.close();
  }

  console.log(`\n✅ mobile-probe.test.js : ${passed} tests OK`);
})().catch((e) => {
  console.error("❌ test échoué :", e);
  process.exit(1);
});
