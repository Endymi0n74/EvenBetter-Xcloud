"use strict";
// Payload + ancres de la feature « 📥 Session » (v1.13.1) : transfert
// pair-à-pair WiFi de la session MSAL (bridge Java BXSessionImport).
//
// Source unique consommée par bench/feature-session-import.js (require) et lue par
// bench/feature-session-import.test.js (regex d'extraction —
// garder la syntaxe `const NAME = ...;` exacte).
const IMPL = `
window.BX_SESSION_IMPORT = {render: function ($parent) {
  var bridge = window.BXSessionImport;
  var box = CE("div", {});
  var note = CE("div", {style: "opacity:.75;font-size:12px;padding:2px 0 6px;"}, "Transfère la session Xbox d'un autre appareil du même réseau WiFi (utile quand le login est bloqué, ex. Freebox Pop).");
  var status = CE("div", {style: "padding:2px 0 6px;font-weight:600;white-space:pre-wrap;"});
  function btn(label, onClick) {
    var b = CE("button", {class: "bx-focusable", style: "display:block;width:100%;margin:4px 0;padding:8px 10px;border-radius:4px;background:#1f2937;color:#fff;cursor:pointer;text-align:left;"}, label);
    b.addEventListener("click", onClick);
    return b;
  }
  if (!bridge) {
    box.appendChild(CE("div", {style: "padding:6px 0;color:#f87171;"}, "⚠️ Disponible uniquement dans l'application EvenBetterXcloud Android."));
    box.appendChild(note);
    $parent.appendChild(box);
    return;
  }
  var urlInput = CE("input", {type: "text", placeholder: "URL affichée par le téléviseur (http://192.168.1.24:8765/import/123456)", value: localStorage.getItem("BX_SESSION_IMPORT_URL") || "", style: "width:100%;box-sizing:border-box;padding:8px;margin:4px 0;border-radius:4px;border:1px solid #374151;background:#111827;color:#fff;"});
  box.appendChild(btn("📥 Importer la session (cet appareil reçoit)", function () {
    try {
      var r = JSON.parse(bridge.startServer());
      if (!r.ok) { status.innerText = "❌ " + (r.error || "serveur indisponible"); return; }
      status.innerText = "Code : " + r.code + "\\nURL : " + r.url + "\\n\\nSur le téléphone : Session → « Envoyer la session » → collez cette URL.";
    } catch (e) { status.innerText = "❌ " + e.message; }
  }));
  box.appendChild(urlInput);
  box.appendChild(btn("📤 Envoyer la session (cet appareil envoie)", function () {
    try {
      var url = (urlInput && urlInput.value || "").trim();
      if (!url) { status.innerText = "❌ Collez d'abord l'URL affichée par l'autre appareil."; return; }
      localStorage.setItem("BX_SESSION_IMPORT_URL", url);
      var storage = {};
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); storage[k] = localStorage.getItem(k); }
      var payload = JSON.stringify({ origin: location.origin, storage: storage });
      status.innerText = "Envoi de la session (" + Object.keys(storage).length + " clés)…";
      var r = JSON.parse(bridge.send(url, payload));
      if (r.ok) status.innerText = "✅ Session envoyée — l'autre appareil recharge avec la session importée.";
      else status.innerText = "❌ " + (r.error || ("HTTP " + r.status));
    } catch (e) { status.innerText = "❌ " + e.message; }
  }));
  box.appendChild(note);
  box.appendChild(status);
  $parent.appendChild(box);
}};`;

const ANCHOR_BX = "window.BX_EXPOSED = BxExposed;";

const ANCHOR_OTHER = '{group: "other",label: t("other"),items: ["block.tracking"]}';

const ANCHOR_FILTER = 'section.group !== "sound" && section.group !== "data") continue;';

module.exports = { IMPL, ANCHOR_BX, ANCHOR_OTHER, ANCHOR_FILTER };
