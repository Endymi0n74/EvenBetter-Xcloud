"use strict";
// Payload + ancres de la feature « ⚡ Appliquer la meilleure région »
// (v1.12.0). Réutilise l'IMPL latence depuis src/features/latency.js
// (avant : lecture regex de feature-latency.js — couplage fragile).
//
// Source unique consommée par bench/feature-region.js (require) et lue par
// bench/feature-region.test.js (regex d'extraction —
// garder la syntaxe `const NAME = ...;` exacte).
const ANCHOR_PUSH = "results.push({code: r.shortName || r.name || name, label: r.displayName || name, ms: ms, isDefault: !!r.isDefault});";

const ANCHOR_DONE = 'btn.disabled = false, btn.innerText = "📡 Relancer le test";';

const IMPL = `
window.BX_REGION_APPLY = {render: function ($parent) {
  var box = CE("div", {});
  var status = CE("div", {class: "bx-region-status", style: "padding:6px 0 4px;font-weight:600;"}, "Lancez d'abord « 📡 Tester la latence des serveurs » pour obtenir la meilleure région.");
  var btn = CE("button", {class: "bx-focusable bx-region-apply", style: "width:100%;margin:4px 0;padding:8px 10px;border-radius:4px;background:#7d4fc9;color:#fff;cursor:pointer;font-weight:600;"}, "⚡ Appliquer la meilleure région");
  btn.disabled = true; // état par défaut correct même si aucun refresh ne passe
  btn.addEventListener("click", function () {
    var best = window.BX_REGION_APPLY.best();
    if (!best) return;
    setGlobalPref("server.region", best.key, "ui");
    status.innerText = "✅ " + best.code + " appliquée — en vigueur au prochain lancement de session.";
    btn.disabled = true;
  });
  box.appendChild(status), box.appendChild(btn), $parent.appendChild(box);
  // Refresh RETARDÉ : le dialog attache le groupe APRÈS avoir rendu tous les
  // items — un refresh synchrone ne trouve pas encore status/btn dans le
  // document. On pole jusqu'à ce que le groupe soit attaché (borné 6 s), puis
  // chaque ré-ouverture re-rend les items → nouveau refresh retardé.
  (function waitReady(attempt) {
    if (attempt > 30) return;
    if (document.querySelector(".bx-settings-dialog .bx-region-status")) {
      window.BX_REGION_APPLY.refresh();
      return;
    }
    setTimeout(function () { waitReady(attempt + 1); }, 200);
  })(0);
}, best: function () {
  var res = window.BX_LATENCY_TEST && window.BX_LATENCY_TEST.lastResults;
  if (!res || !res.length) return null;
  return res.filter(function (r) { return r.ms >= 0 && r.key; }).sort(function (a, b) { return a.ms - b.ms; })[0] || null;
}, refresh: function () {
  var status = document.querySelector(".bx-settings-dialog .bx-region-status");
  var btn = document.querySelector(".bx-settings-dialog .bx-region-apply");
  if (!status || !btn) return;
  var best = window.BX_REGION_APPLY.best();
  if (!best) {
    status.innerText = "Lancez d'abord « 📡 Tester la latence des serveurs » pour obtenir la meilleure région.";
    btn.disabled = true;
    return;
  }
  var cur = getGlobalPref("server.region");
  if (cur === best.key) {
    status.innerText = "⭐ " + best.code + " (" + Math.round(best.ms) + " ms) — déjà appliquée ✅";
    btn.disabled = true;
    return;
  }
  status.innerText = "⭐ " + best.code + " (" + Math.round(best.ms) + " ms) · actuelle : " + (cur || "défaut") + " — cliquer pour appliquer";
  btn.disabled = false;
}};`;

const ANCHOR_BX = "window.BX_EXPOSED = BxExposed;";

const ANCHOR_ITEM = ",($parent) => {window.BX_LATENCY_TEST.render($parent);}]}";

module.exports = { IMPL, ANCHOR_BX, ANCHOR_ITEM, ANCHOR_PUSH, ANCHOR_DONE };
