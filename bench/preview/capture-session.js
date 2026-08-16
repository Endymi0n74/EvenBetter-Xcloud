/*
 * capture-session.js — capture ciblée de la couche protocole de session (P3).
 *
 * À lancer dans une SESSION AUTHENTIFIÉE (play.xbox.com, compte Insider,
 * Preview Features activé) — DevTools → Console → coller le contenu → Entrée.
 * Survivre à la navigation SPA : le harnais hooke fetch + l'historique.
 *
 * Ce que ça capture (pour le portage P3 résolution + l'étude session) :
 *   1. Les ENDPOINTS du protocole : play (v5/.../play), configuration,
 *      waittime, ice, sdp, usersigls, sessions — URL exacte + méthode.
 *   2. Le BODY du play request (JSON) — contient les settings dérivés de
 *      deviceInformation (osName, locale, timezoneOffsetMinutes, sdkType…) :
 *      c'est LA forme à piloter pour le portage résolution.
 *   3. Les BODIES response des endpoints clés (play/configuration) — la forme
 *      de la réponse de provisioning (clientStreamingConfigOverrides, etc.).
 *
 * API (sur window) :
 *   BX_SESSION_CAPTURE.report()   -> résumé markdown (console) — colle-le ici
 *   BX_SESSION_CAPTURE.download() -> rapport JSON complet
 *   BX_SESSION_CAPTURE.stop()     -> retire les hooks
 */
(() => {
  "use strict";

  const NS = "BX_SESSION_CAPTURE";
  if (window[NS]) {
    console.warn("[BX-SESSION-CAPTURE] déjà injecté — API existante sur window." + NS);
    return window[NS];
  }

  // Patterns endpoint prédits des statics (StreamSessionRequest / entry.client) :
  // v5/.../play, configuration, waittime, ice, sdp, usersigls, sessions, domaine gssv.
  const ENDPOINT_RE = /(\/v5\/.*\/play|\/play$|\/play\?|\/configuration|\/waittime|\/ice|\/sdp|usersigls|\/sessions\/|gssv)/i;
  // Endpoints dont on lit aussi le body response (JSON)
  const RESPONSE_JSON_RE = /(\/play|\/configuration|\/waittime)/i;

  const cfg = {
    maxBodyChars: 12000,   // troncature des corps (JSON)
    captureResponse: true,
  };

  const state = {
    active: true,
    startedAt: new Date().toISOString(),
    nav: [{ ts: Date.now(), href: location.href }],
    requests: [],          // { ts, url, method, status, endpoint, reqBody, resBody }
    hooks: [],
  };
  const unHook = (fn) => state.hooks.push(fn);

  const esc = (s) => String(s).replace(/[|]/g, "\\|");
  const trunc = (s, n = cfg.maxBodyChars) => {
    if (s == null) return null;
    const str = String(s);
    return str.length > n ? str.slice(0, n) + "\n…TRONQUÉ (" + str.length + " octets)…" : str;
  };
  const tryJson = (text) => {
    try { return JSON.parse(text); } catch (e) { return null; }
  };

  function endpointOf(url) {
    const m = ENDPOINT_RE.exec(url);
    return m ? m[0] : null;
  }

  // ---------- 1. hook fetch : capture des requêtes du protocole ----------
  function hookFetch() {
    const orig = window.fetch;
    if (typeof orig !== "function") return;
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const ep = endpointOf(url);
      if (ep) {
        const rec = { ts: Date.now(), url, method: (init && init.method) || (input && input.method) || "GET", status: null, endpoint: ep, reqBody: null, resBody: null };
        state.requests.push(rec);
        // body request (JSON) sans toucher au flux : clone parallèle
        try {
          if (input && typeof input.clone === "function" && input.method !== "GET" && input.method !== "HEAD") {
            input.clone().text().then((t) => { rec.reqBody = trunc(t); }).catch(() => {});
          }
        } catch (e) { /* non bloquant */ }
        return orig.apply(this, arguments).then((resp) => {
          rec.status = resp && resp.status || null;
          if (cfg.captureResponse && resp && RESPONSE_JSON_RE.test(url) && typeof resp.clone === "function") {
            try {
              resp.clone().text().then((t) => { rec.resBody = trunc(t); }).catch(() => {});
            } catch (e) { /* non bloquant */ }
          }
          return resp;
        });
      }
      return orig.apply(this, arguments);
    };
    unHook(() => { window.fetch = orig; });
  }

  // ---------- 2. corrélation : navigation SPA ----------
  function hookNav() {
    state.nav.push({ ts: Date.now(), href: location.href });
    const onPop = () => state.nav.push({ ts: Date.now(), href: location.href });
    window.addEventListener("popstate", onPop);
    unHook(() => window.removeEventListener("popstate", onPop));
    // pushState/replaceState
    for (const m of ["pushState", "replaceState"]) {
      const orig = window.history[m];
      if (typeof orig !== "function") continue;
      window.history[m] = function (...args) {
        state.nav.push({ ts: Date.now(), href: args[2] ? new URL(args[2], location.href).href : location.href });
        return orig.apply(this, args);
      };
      unHook(() => { window.history[m] = orig; });
    }
  }

  // ---------- 3. rapport ----------
  function playRequestBodies() {
    return state.requests.filter((r) => /\/play/.test(r.url));
  }

  function report() {
    const lines = [];
    lines.push("# Capture session — protocole (P3)");
    lines.push("");
    lines.push("- Date : " + state.startedAt);
    lines.push("- Nav : " + state.nav.map((n) => new Date(n.ts).toISOString().slice(11, 19) + " " + n.href).join(" | "));
    lines.push("- Requêtes capturées : " + state.requests.length);
    lines.push("");
    lines.push("## Endpoints");
    lines.push("");
    lines.push("| Heure | Méthode | Statut | Endpoint | URL |");
    lines.push("|---|---|---|---|---|");
    for (const r of state.requests) {
      lines.push(`| ${new Date(r.ts).toISOString().slice(11, 19)} | ${r.method} | ${r.status ?? "…"} | ${esc(r.endpoint)} | ${esc(r.url.slice(0, 160))} |`);
    }
    const plays = playRequestBodies();
    if (plays.length) {
      lines.push("");
      lines.push("## Body du/des play request (forme de deviceInformation)");
      lines.push("");
      plays.forEach((r, i) => {
        lines.push("### Play #" + (i + 1) + " — " + r.url);
        lines.push("");
        if (r.reqBody) {
          const j = tryJson(r.reqBody);
          lines.push(j ? "```json\n" + JSON.stringify(j, null, 2).slice(0, cfg.maxBodyChars) + "\n```" : "```\n" + r.reqBody + "\n```");
        } else {
          lines.push("_(body request non capturé — GET ou non JSON)_");
        }
        if (r.resBody) {
          lines.push("");
          lines.push("### Response play #" + (i + 1) + " (statut " + r.status + ")");
          lines.push("");
          const j = tryJson(r.resBody);
          lines.push(j ? "```json\n" + JSON.stringify(j, null, 2).slice(0, cfg.maxBodyChars) + "\n```" : "```\n" + r.resBody + "\n```");
        }
      });
    }
    lines.push("");
    lines.push("## Fichiers");
    lines.push("");
    lines.push("`BX_SESSION_CAPTURE.download()` — rapport JSON complet.");
    return lines.join("\n");
  }

  function download() {
    const payload = { startedAt: state.startedAt, nav: state.nav, requests: state.requests };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bx-session-capture-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function stop() {
    if (!state.active) return;
    state.active = false;
    state.hooks.forEach((fn) => { try { fn(); } catch (e) {} });
    state.hooks = [];
    console.log("[BX-SESSION-CAPTURE] hooks retirés");
  }

  // ---------- 4. démarrage ----------
  hookFetch();
  hookNav();

  const api = { report, download, stop, state };
  window[NS] = api;
  console.log(
    "[BX-SESSION-CAPTURE] actif — lance le stream puis :\n" +
    "  BX_SESSION_CAPTURE.report()     (colle-le ici)\n" +
    "  BX_SESSION_CAPTURE.download()   (rapport JSON)\n" +
    "  BX_SESSION_CAPTURE.stop()"
  );
  return api;
})();
