#!/usr/bin/env node
/**
 * Transfert de session MSAL (localStorage play.xbox.com) d'un appareil connecté
 * vers un appareil dont le login est bloqué par l'anti-bot Microsoft (PPServer 404).
 *
 * Contexte (18 août 2026) : la Freebox Pop (Android 10, 32 bits) reçoit un 404
 * délibéré de l'anti-bot Microsoft sur POST login.live.com/GetCredentialType.srf
 * (header PPServer) — fingerprint TLS/HTTP2 de la WebView refusé. Le login natif
 * est impossible sur cet appareil. Le transfert des tokens MSAL (localStorage)
 * depuis un appareil déjà connecté (téléphone) contourne le login : la session
 * tient et le stream démarre (validé en réel : Halo 1280x720).
 *
 * Usage :
 *   node bench/mobile/session-transfer.js --from <adb-serial> --to <adb-serial>
 *   node bench/mobile/session-transfer.js --from QOGQ694DEE5PLBGI --to 192.168.1.24:5555
 *
 * Prérequis : adb dans le PATH (ou ADB=/chemin/adb), débogage USB activé et
 * autorisé sur les deux appareils, WebView débogable (apk de debug / debuggable).
 */
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const ADB = process.env.ADB || "adb";
const args = process.argv.slice(2);
const from = args[args.indexOf("--from") + 1];
const to = args[args.indexOf("--to") + 1];

if (!from || !to) {
  console.error("Usage: node bench/mobile/session-transfer.js --from <serial> --to <serial>");
  process.exit(1);
}

const CDP_BASE = 9228; // port local : --from, port local+1 : --to

function adb(serial, ...cmd) {
  const out = execFileSync(ADB, ["-s", serial, ...cmd], { encoding: "utf8" });
  return out.trim();
}

// Trouver le localabstract webview_devtools_remote_* du process qui affiche play.xbox.com
function findWebView(serial) {
  try {
    const out = adb(serial, "shell", "cat /proc/net/unix 2>/dev/null");
    const sockets = out.split("\n").filter((l) => l.includes("webview_devtools_remote_"));
    return sockets.map((l) => l.split(" ").pop()).filter(Boolean).pop();
  } catch {
    return null;
  }
}

(async () => {
  let fromC, toC;
  try {
    // 1. Forward CDP des deux appareils
    const sockFrom = findWebView(from);
    const sockTo = findWebView(to);
    if (!sockFrom || !sockTo) {
      console.error("WebView débogable introuvable sur un des appareils (processus play.xbox.com ouvert ?).");
      console.error("  from:", sockFrom, " to:", sockTo);
      process.exit(1);
    }
    adb(from, "forward", `tcp:${CDP_BASE}`, sockFrom);
    adb(to, "forward", `tcp:${CDP_BASE + 1}`, sockTo);
    console.log(`[transfer] CDP : from=127.0.0.1:${CDP_BASE} (${sockFrom}) · to=127.0.0.1:${CDP_BASE + 1} (${sockTo})`);

    // 2. Lire le localStorage de l'appareil source (origin play.xbox.com)
    fromC = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_BASE}`);
    const fromPage = fromC.contexts()[0].pages().find((p) => p.url().includes("xbox.com")) || fromC.contexts()[0].pages()[0];
    await fromPage.goto("https://play.xbox.com/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 4000));
    const ls = await fromPage.evaluate(() => {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        out[k] = localStorage.getItem(k);
      }
      return out;
    });
    const msal = Object.keys(ls).filter((k) => k.startsWith("msal.") || k.startsWith("00000000-")).length;
    console.log(`[transfer] source : ${Object.keys(ls).length} clés localStorage, dont ${msal} msal`);

    // 3. Injecter sur l'appareil cible (même origine)
    toC = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_BASE + 1}`);
    const toPage = toC.contexts()[0].pages().find((p) => p.url().includes("xbox.com")) || toC.contexts()[0].pages()[0];
    await toPage.goto("https://play.xbox.com/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 6000));
    await toPage.evaluate((data) => {
      for (const [k, v] of Object.entries(data)) {
        try { localStorage.setItem(k, v); } catch {}
      }
    }, ls);
    console.log("[transfer] localStorage injecté sur la cible — reload");
    await toPage.reload({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 8000));

    // 4. Verdict : la cible est-elle connectée ? (gamertag / Profil dans le DOM)
    const verdict = await toPage.evaluate(() => {
      const labels = [...document.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label"));
      const hasGamertag = labels.some((a) => a && a.trim().length > 2 && a.trim() !== "Profil" && !/accueil|bibliothèque|amis|guide|notifications/i.test(a));
      const hasProfil = labels.includes("Profil");
      return { hasProfil, hasGamertag, sample: labels.filter((a) => a && a.trim()).slice(0, 12) };
    });
    console.log("[transfer] verdict:", JSON.stringify(verdict));
    if (verdict.hasProfil) {
      console.log("✅ SESSION TRANSFÉRÉE — l'appareil cible est connecté (lancez un jeu pour streamer).");
    } else {
      console.log("⚠️  Session non détectée — vérifiez que les deux appareils sont sur play.xbox.com et réessayez.");
      process.exitCode = 2;
    }
  } catch (e) {
    console.error("ERREUR: " + e.message);
    process.exitCode = 1;
  } finally {
    if (fromC) await fromC.close().catch(() => {});
    if (toC) await toC.close().catch(() => {});
    process.exit();
  }
})();
