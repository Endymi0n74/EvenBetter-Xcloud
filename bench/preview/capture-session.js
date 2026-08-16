/*
 * capture-session.js — capture ciblée de la couche protocole de session (P3).
 *
 * À lancer dans une SESSION AUTHENTIFIÉE (play.xbox.com, compte Insider,
 * Preview Features activé) — DevTools → Console → coller le contenu → Entrée.
 * Survivre à la navigation SPA : le harnais hooke fetch/xhr/ws + l'historique.
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
 * Transports couverts (v2 — le protocole preview peut passer ailleurs que par
 * window.fetch) :
 *   - fetch (page)          — hook direct
 *   - XMLHttpRequest        — hook open/send + loadend (statut + responseText)
 *   - WebSocket             — hook constructeur (URL + état open/close)
 *   - Resource timing       — dump performance.getEntriesByType('resource') :
 *     la trace réseau DU NAVIGATEUR lui-même, qui voit les requêtes faites par
 *     workers/iframes/WS même si les hooks les ratent.
 *
 * Diagnostic intégré : un compteur global de requêtes VUES par transport vs
 * MATCHÉES (patterns endpoint) — pour distinguer « hooks morts » (0 vue),
 * « patterns faux » (vues ≫ matchées) et « session jamais démarrée ».
 *
 * API (sur window) :
 *   BX_SESSION_CAPTURE.diag()    -> état compact en direct (vue live)
 *   BX_SESSION_CAPTURE.report()  -> résumé markdown (console) — colle-le ici
 *   BX_SESSION_CAPTURE.download() -> rapport JSON complet
 *   BX_SESSION_CAPTURE.stop()    -> retire les hooks
 */
(() => {
  "use strict";

  const NS = "BX_SESSION_CAPTURE";
  if (window[NS] && window[NS].diag) {
    // v2 déjà active (elle seule expose diag) — ne pas re-hooker
    console.warn("[BX-SESSION-CAPTURE] v2 déjà injectée — API existante sur window." + NS);
    return window[NS];
  }
  if (window[NS]) {
    // v1 (sans diag) encore active : la remplacer proprement (stop + delete) —
    // évite le reload de page quand on recolle par-dessus l'ancienne version.
    console.warn("[BX-SESSION-CAPTURE] v1 détectée — remplacement par la v2 (hooks relancés)");
    try { window[NS].stop(); } catch (e) {}
    delete window[NS];
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
    requests: [],          // { ts, url, method, status, endpoint, reqBody, resBody, via }
    counts: { fetch: 0, xhr: 0, ws: 0 },  // requêtes VUES par transport (toutes)
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
    if (!m) return null;
    if (m[0] !== "gssv") return m[0]; // pattern path explicite
    // match par domaine : retourner le pathname (label plus lisible)
    try { return new URL(url).pathname.slice(0, 48) || "gssv"; } catch (e) { return "gssv"; }
  }

  // ---------- 1. hook fetch : capture des requêtes du protocole ----------
  function hookFetch() {
    const orig = window.fetch;
    if (typeof orig !== "function") return;
    window.fetch = function (input, init) {
      state.counts.fetch++;
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const ep = endpointOf(url);
      if (ep) {
        const rec = { ts: Date.now(), url, method: (init && init.method) || (input && input.method) || "GET", status: null, endpoint: ep, reqBody: null, resBody: null, via: "fetch" };
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

  // ---------- 1bis. hook XMLHttpRequest (même logique) ----------
  function hookXHR() {
    const X = window.XMLHttpRequest;
    if (typeof X !== "function" || !X.prototype) return;
    const origOpen = X.prototype.open;
    const origSend = X.prototype.send;
    X.prototype.open = function (method, url) {
      this.__bx = { method, url: typeof url === "string" ? url : String(url) };
      return origOpen.apply(this, arguments);
    };
    X.prototype.send = function (body) {
      const meta = this.__bx;
      if (meta) {
        state.counts.xhr++;
        const ep = endpointOf(meta.url);
        if (ep) {
          const rec = { ts: Date.now(), url: meta.url, method: meta.method, status: null, endpoint: ep, reqBody: null, resBody: null, via: "xhr" };
          state.requests.push(rec);
          meta.rec = rec;
          if (meta.method !== "GET" && meta.method !== "HEAD" && body != null) {
            try { rec.reqBody = trunc(typeof body === "string" ? body : JSON.stringify(body)); } catch (e) {}
          }
        }
      }
      this.addEventListener("loadend", () => {
        if (meta && meta.rec) {
          meta.rec.status = this.status;
          if (cfg.captureResponse && RESPONSE_JSON_RE.test(meta.url)) {
            try { if (this.responseText) meta.rec.resBody = trunc(this.responseText); } catch (e) {}
          }
        }
      });
      return origSend.apply(this, arguments);
    };
    unHook(() => { X.prototype.open = origOpen; X.prototype.send = origSend; });
  }

  // ---------- 1ter. hook WebSocket (URL + cycle de vie) ----------
  function hookWebSocket() {
    const W = window.WebSocket;
    if (typeof W !== "function") return;
    function HookedWS(url, protocols) {
      state.counts.ws++;
      const ep = endpointOf(url);
      const inst = new W(url, protocols);
      if (ep) {
        const rec = { ts: Date.now(), url: typeof url === "string" ? url : String(url), method: "WS", status: null, endpoint: ep, reqBody: null, resBody: null, via: "ws" };
        state.requests.push(rec);
        inst.addEventListener("open", () => { rec.status = "open"; });
        inst.addEventListener("error", () => { rec.status = "error"; });
        inst.addEventListener("close", (e) => { rec.status = "close:" + (e && e.code != null ? e.code : "?"); });
      }
      return inst;
    }
    HookedWS.prototype = W.prototype;
    for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) {
      if (k in W) HookedWS[k] = W[k];
    }
    window.WebSocket = HookedWS;
    unHook(() => { window.WebSocket = W; });
  }

  // ---------- 1quater. resource timing : la trace réseau du navigateur ----------
  function resourceTiming() {
    const per = (typeof performance !== "undefined" && typeof performance.getEntriesByType === "function") ? performance : null;
    if (!per) return { available: false, total: 0, protocol: [] };
    const entries = per.getEntriesByType("resource") || [];
    const names = entries.map((e) => e.name).filter(Boolean);
    const protocol = names.filter((u) => endpointOf(u)).map((u) => ({ url: u, endpoint: endpointOf(u) }));
    return { available: true, total: names.length, protocol };
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

  function diag() {
    const rt = resourceTiming();
    const byVia = (v) => state.requests.filter((r) => r.via === v).length;
    return {
      active: state.active,
      vues: { fetch: state.counts.fetch, xhr: state.counts.xhr, ws: state.counts.ws },
      matchées: { fetch: byVia("fetch"), xhr: byVia("xhr"), ws: byVia("ws") },
      resourceTiming: { disponible: rt.available, totales: rt.total, protocolaires: rt.protocol.length },
      depuis: state.startedAt,
    };
  }

  function report() {
    const rt = resourceTiming();
    const lines = [];
    lines.push("# Capture session — protocole (P3)");
    lines.push("");
    lines.push("- Date : " + state.startedAt);
    lines.push("- Nav : " + state.nav.map((n) => new Date(n.ts).toISOString().slice(11, 19) + " " + n.href).join(" | "));
    lines.push("- Requêtes capturées : " + state.requests.length);
    lines.push("- Vues par transport (toutes requêtes, même non-matchées) : fetch=" + state.counts.fetch + " · xhr=" + state.counts.xhr + " · ws=" + state.counts.ws);
    lines.push("- Resource timing : " + (rt.available ? rt.total + " ressources chargées, " + rt.protocol.length + " protocolaires" : "API indisponible"));
    if (state.requests.length === 0 && state.counts.fetch + state.counts.xhr + state.counts.ws === 0 && (!rt.available || rt.protocol.length === 0)) {
      lines.push("");
      lines.push("⚠️ DIAGNOSTIC : aucune requête vue nulle part — soit la session n'a PAS démarré");
      lines.push("  (page /stream ouverte sans lancer le jeu), soit tout le trafic passe par un");
      lines.push("  worker/iframe isolé. Réessaie avec le stream en cours (image du jeu visible).");
    }
    lines.push("");
    lines.push("## Endpoints");
    lines.push("");
    lines.push("| Heure | Méthode | Statut | Endpoint | URL |");
    lines.push("|---|---|---|---|---|");
    for (const r of state.requests) {
      lines.push(`| ${new Date(r.ts).toISOString().slice(11, 19)} | ${r.method} | ${r.status ?? "…"} | ${esc(r.endpoint)} | ${esc(r.url.slice(0, 160))} |`);
    }
    if (rt.available && rt.protocol.length) {
      lines.push("");
      lines.push("## Trace réseau protocolaire (resource timing — ce que le navigateur a réellement chargé)");
      lines.push("");
      for (const p of rt.protocol) {
        lines.push("- `" + esc(p.endpoint) + "` → " + esc(p.url.slice(0, 200)));
      }
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
    const rt = resourceTiming();
    const payload = { startedAt: state.startedAt, nav: state.nav, requests: state.requests, counts: state.counts, resourceTiming: rt.protocol.map((p) => p.url) };
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
  hookXHR();
  hookWebSocket();
  hookNav();

  const api = { report, download, stop, diag, state };
  window[NS] = api;
  console.log(
    "[BX-SESSION-CAPTURE] actif (fetch + xhr + ws + resource timing) — lance le stream puis :\n" +
    "  BX_SESSION_CAPTURE.diag()       (état live : vues vs matchées)\n" +
    "  BX_SESSION_CAPTURE.report()     (colle-le ici)\n" +
    "  BX_SESSION_CAPTURE.download()   (rapport JSON)\n" +
    "  BX_SESSION_CAPTURE.stop()"
  );
  return api;
})();
