"use strict";
// Payload + ancres de la routine BX_PURGE_DIAG (v1.13.0) : purge en un
// appel des listeners de diagnostic marqués win-capture.
//
// Source unique consommée par bench/feature-diag-purge.js (require) et lue par
// bench/feature-diag-purge.test.js (regex d'extraction —
// garder la syntaxe `const NAME = ...;` exacte).
const IMPL = `
(function () {
  if (window.BX_PURGE_DIAG) return; // déjà installé (double injection)
  var DIAG = [];
  var MARKER = /win-capture/;
  var origAdd = window.addEventListener.bind(window);
  var origRemove = window.removeEventListener.bind(window);
  window.addEventListener = function (type, fn, opts) {
    try {
      if (typeof fn === "function" && MARKER.test(Function.prototype.toString.call(fn))) {
        DIAG.push({ type: type, fn: fn, opts: opts });
      }
    } catch (e) {}
    return origAdd(type, fn, opts);
  };
  window.removeEventListener = function (type, fn, opts) {
    for (var i = 0; i < DIAG.length; i++) {
      if (DIAG[i].fn === fn) { DIAG.splice(i, 1); break; }
    }
    return origRemove(type, fn, opts);
  };
  window.BX_PURGE_DIAG = function () {
    var n = 0;
    for (var i = 0; i < DIAG.length; i++) {
      var d = DIAG[i];
      try {
        origRemove(d.type, d.fn, d.opts === true || (d.opts && d.opts.capture));
        n++;
      } catch (e) {}
    }
    DIAG.length = 0;
    return n;
  };
  window.BX_PURGE_DIAG(); // au démarrage : purge les restes éventuels (page neuve = no-op)
})();
`;

const ANCHOR_BX = "window.BX_EXPOSED = BxExposed;";

module.exports = { IMPL, ANCHOR_BX };
