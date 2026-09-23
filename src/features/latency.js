"use strict";
// Payload + ancres de la feature « 📡 Test de latence » (v1.10.0) : RTT
// vers les 19 régions gssv via NATIVE_FETCH, meilleure région marquée ⭐.
//
// Source unique consommée par bench/feature-latency.js (require) et lue par
// bench/feature-latency.test.js (regex d'extraction —
// garder la syntaxe `const NAME = ...;` exacte).
const IMPL = `
window.BX_LATENCY_TEST = {render: function ($parent) {
  var box = CE("div", {});
  var list = CE("div", {});
  var btn = CE("button", {class: "bx-focusable", style: "width:100%;margin:6px 0;padding:8px 10px;border-radius:4px;background:#107c10;color:#fff;cursor:pointer;font-weight:600;"}, "📡 Tester la latence des serveurs");
  btn.addEventListener("click", function () {window.BX_LATENCY_TEST.run(btn, list);});
  box.appendChild(btn), box.appendChild(list), $parent.appendChild(box);
}, run: async function (btn, list) {
  var regions = (window.STATES && STATES.serverRegions) || {};
  var names = Object.keys(regions).sort();
  btn.disabled = true;
  var orig = btn.innerText;
  btn.innerText = "📡 Test en cours…";
  list.innerText = "";
  if (names.length === 0) {
    list.appendChild(CE("div", {style: "opacity:.7;padding:6px 0;"}, "Aucune région disponible."));
    btn.disabled = false, btn.innerText = orig;
    return;
  }
  var fetchFn = typeof NATIVE_FETCH === "function" ? NATIVE_FETCH : window.fetch.bind(window);
  var results = [];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var r = regions[name] || {};
    // hôte propre : baseUri (ex. https://eus.core.gssv-play-prod.xboxlive.com) —
    // PAS shortName (contient l'emoji drapeau « 🇺🇸 EUS » → hôte invalide)
    var url = (r.baseUri || ("https://" + (r.name || name).toLowerCase() + ".core.gssv-play-prod.xboxlive.com")) + "/v5/sessions/cloud/play?probe=1";
    var t0 = performance.now(), ms = -1;
    try {
      await Promise.race([
        fetchFn(url, {mode: "no-cors", cache: "no-store"}),
        new Promise(function (resolve, reject) {setTimeout(function () {reject(new Error("timeout"));}, 3000);}),
      ]);
      ms = performance.now() - t0;
    } catch (e) {ms = -1;}
    results.push({code: r.shortName || r.name || name, label: r.displayName || name, ms: ms, isDefault: !!r.isDefault});
    list.appendChild(CE("div", {style: "display:flex;justify-content:space-between;gap:8px;padding:2px 4px;"},
      CE("span", {}, (r.shortName || r.name || name) + " — " + (r.displayName || name) + (r.isDefault ? " (défaut)" : "")),
      CE("span", {}, ms >= 0 ? Math.round(ms) + " ms" : "—")));
  }
  results.sort(function (a, b) {return (a.ms < 0 ? 1e5 : a.ms) - (b.ms < 0 ? 1e5 : b.ms);});
  if (results.length && results[0].ms >= 0) {
    var best = results[0];
    list.insertBefore(CE("div", {style: "padding:6px 4px;font-weight:700;color:#7ed321;"}, "⭐ " + best.code + " (" + Math.round(best.ms) + " ms) — région recommandée"), list.firstChild);
  }
  btn.disabled = false, btn.innerText = "📡 Relancer le test";
}};`;

const ANCHOR_BX = "window.BX_EXPOSED = BxExposed;";

const ANCHOR_SERVER = '{group: "server",label: t("server"),items: [{pref: "server.region",multiLines: !0},{pref: "stream.locale",multiLines: !0},"server.ipv6.prefer"]}';

module.exports = { IMPL, ANCHOR_BX, ANCHOR_SERVER };
