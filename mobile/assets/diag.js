/* Badge de diagnostic — build de TEST uniquement.
 * Affiche en haut à gauche (~10 s) l'état de l'injection et de la session :
 *   - WebView Chrome <N>          → version du moteur (un vieux WebView casse le bundle ES2020)
 *   - BX_EXPOSED / BX_FETCH       → le userscript s'est-il injecté ?
 *   - settings btn visible/hidden → l'overlay est-il là ?
 *   - signed in YES/NO            → la session Xbox est-elle détectée ?
 * ES5 pur : doit s'exécuter même si le bundle ES2020 du userscript a échoué
 * (c'est le but du badge : différencier « WebView trop vieux » de « pas
 * connecté »).
 */
(function () {
  try {
    var b = document.createElement('div');
    var ua = navigator.userAgent || '';
    var i = ua.indexOf('Chrome/');
    var wv = i >= 0 ? parseInt(ua.substring(i + 7), 10) : 0;
    var btn = document.querySelector('.bx-header-settings-button');
    var bv = false;
    if (btn) {
      var s = getComputedStyle(btn);
      var r = btn.getBoundingClientRect();
      bv = (s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0);
    }
    var signed = !!(window.xbcUser && window.xbcUser.isSignedIn);
    var nl = String.fromCharCode(10);
    var lines = [
      'EvenBetterXcloud diag',
      'WebView Chrome ' + wv,
      'BX_EXPOSED: ' + (typeof window.BX_EXPOSED),
      'BX_FETCH: ' + (typeof window.BX_FETCH),
      'settings btn: ' + (btn ? (bv ? 'visible' : 'hidden') : 'absent'),
      'signed in: ' + (signed ? 'YES' : 'NO'),
      'path: ' + (location.pathname || '')
    ];
    b.style.cssText = 'position:fixed;top:8px;left:8px;z-index:999999;background:rgba(0,0,0,0.88);color:#0f0;font:11px/1.5 monospace;padding:8px 10px;border-radius:6px;max-width:85vw;white-space:pre;pointer-events:none;';
    b.textContent = lines.join(nl);
    document.documentElement.appendChild(b);
    setTimeout(function () { if (b.parentNode) { b.parentNode.removeChild(b); } }, 10000);
  } catch (e) { /* silencieux : badge best-effort */ }
})();
