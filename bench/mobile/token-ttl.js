#!/usr/bin/env node
/**
 * Mesure la durée de vie réelle des tokens MSAL de la session transférée.
 *
 * Lit le localStorage play.xbox.com (clés msal.*) sur l'appareil cible,
 * décode les JWT (idToken/accessToken) pour extraire iat/exp, et estime la
 * fenêtre restante du refresh token (politique AAD standard).
 *
 * Usage :
 *   node bench/mobile/token-ttl.js <port-cdp>   (ex. 9227 pour la Freebox preview)
 *
 * Interprétation :
 *   - accessToken/idToken : ~1 h, rafraîchis automatiquement par MSAL tant
 *     que le refresh token est valide — l'utilisateur ne les voit pas expirer.
 *   - refreshToken : opaque, durée de vie AAD par défaut 90 jours avec
 *     sliding window (chaque rafraîchissement le prolonge). S'il expire
 *     (appareil inactif >90 j, mot de passe changé, révocation, tenant
 *     policy), le prochain lancement de stream échouera (login requis) →
 *     relancer session-transfer.js.
 */
const { chromium } = require("playwright");

function decodeJwt(token) {
  try {
    const part = token.split(".")[1];
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function fmt(ms) {
  if (!ms || isNaN(ms)) return "?";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d} j ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

(async () => {
  const PORT = process.argv[2] || "9227";
  let c;
  try {
    c = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    const page = c.contexts()[0].pages().find((p) => p.url().includes("xbox.com"));
    const now = Date.now();
    const entries = await page.evaluate(() => {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith("msal.") || k.startsWith("00000000-")) out.push([k, localStorage.getItem(k)]);
      }
      return out;
    });

    console.log(`[ttl] ${entries.length} clés MSAL sur l'appareil (port ${PORT})`);
    console.log(`[ttl] maintenant : ${new Date(now).toISOString()}`);

    let refreshFound = false;
    for (const [k, v] of entries) {
      const kind = k.includes("idtoken") ? "idToken" : k.includes("accesstoken") ? "accessToken" : k.includes("refreshtoken") || k.includes("refresh-token") ? "refreshToken" : "autre";
      if (kind === "refreshToken") refreshFound = true;
      // Décoder le JWT si présent (JSON crédential ou token brut)
      let payload = null;
      try {
        const obj = JSON.parse(v);
        payload = obj.secret ? decodeJwt(obj.secret) : null;
      } catch {
        payload = v.startsWith("ey") ? decodeJwt(v) : null;
      }
      const exp = payload ? payload.exp * 1000 : null;
      const iat = payload ? payload.iat * 1000 : null;
      const line = `${kind.padEnd(12)} ${k.slice(0, 90)}`;
      console.log(`  ${line}`);
      if (kind === "refreshToken") {
        // MSAL stocke un JSON avec expiresOn/refreshOn (rotation réelle du RT)
        try {
          const obj = JSON.parse(v);
          const keys = ["credentialType", "expiresOn", "refreshOn", "cachedAt", "environment", "realm"];
          const info = {};
          for (const kk of keys) if (obj[kk] !== undefined) info[kk] = obj[kk];
          if (info.expiresOn) info.expiresOn = new Date(info.expiresOn * 1000).toISOString();
          if (info.refreshOn) info.refreshOn = new Date(info.refreshOn * 1000).toISOString();
          if (info.cachedAt) info.cachedAt = new Date(info.cachedAt * 1000).toISOString();
          console.log(`      RT JSON: ${JSON.stringify(info)}`);
          if (obj.expiresOn) console.log(`      RT expire réellement : ${new Date(obj.expiresOn * 1000).toISOString()} (reste ${fmt(obj.expiresOn * 1000 - now)})`);
        } catch {
          console.log(`      RT brut: ${String(v).slice(0, 120)}`);
        }
      } else if (payload) {
        console.log(`      iat=${iat ? new Date(iat).toISOString() : "?"} exp=${exp ? new Date(exp).toISOString() : "?"} reste=${fmt(exp - now)} iss=${(payload.iss || "").slice(0, 40)}`);
      }
    }

    console.log("\n=== VERDICT (mesure réelle 20 août) ===");
    if (refreshFound) {
      // Mesuré en réel sur le flux Xbox (login.live.com -> MSA) : le RT émis le
      // 19/08 13:21 UTC avait expiresOn 20/08 08:32 UTC = ~19 h de vie (pas 90 j).
      console.log("Refresh token présent mais expiresOn MSA ≈ 19-24 h (mesuré en réel, PAS 90 j AAD).");
      console.log("→ id/access tokens : ~1 h, auto-rafraîchis tant que le RT est valide.");
      console.log("→ La session tombe au premier refresh avec RT expiré → re-transférer depuis");
      console.log("  le téléphone (session fraîche) dès que la Freebox affiche « Se connecter ».");
      console.log("→ Règle pratique : re-transférer si le transfert date de >12 h, ou vérifier");
      console.log("  avec ce script (RT < 6 h restantes = re-transférer).");
    } else {
      console.log("Aucun refresh token détecté — seuls id/access tokens (1 h) sont présents.");
      console.log("→ La session risque d'expirer rapidement : vérifier le contenu réel des clés.");
    }
  } catch (e) {
    console.error("ERREUR: " + e.message);
    process.exitCode = 1;
  } finally {
    if (c) await c.close().catch(() => {});
    process.exit();
  }
})();
