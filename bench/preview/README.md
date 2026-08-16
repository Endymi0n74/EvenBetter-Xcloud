# Harnais de capture du preview xCloud (play.xbox.com)

Capture les **bundles runtime d'une session authentifiée** du preview Microsoft
(le nouveau client web xCloud, app SSR React Router 7 + renderer Babylon.js —
cf. mémo projet §10) avec leurs **signatures**, et mesure le **coût de rendu
Babylon** (draw/upload) pendant un stream réel.

Ce que les bundles statiques ne peuvent pas donner (ils sont récupérables sans
auth, cf. `/d/tmp/preview-player`) : les modules chargés **pendant le stream**,
le shader réel, la boucle de draw à l'exécution — indispensables pour décider
ce qui est portable de nos optimisations webgl2 (patches 13-20) vers le preview.

## Prérequis

- Navigateur **connecté** à play.xbox.com (compte Xbox + programme **Insider**,
  toggle **Preview Features** activé — l'accès au preview est opt-in).
- DevTools ouvert sur l'onglet Console.
- Un **stream actif** de préférence (ouvrir un jeu) pour des mesures de draw
  significatives.

## Usage — console (recommandé)

1. Démarrer un stream sur play.xbox.com.
2. DevTools → Console : coller le **contenu complet de `bench/preview/capture.js`**
   (sélectionner tout le fichier → copier → coller → Entrée).
3. L'injection fait tout automatiquement :
   - installe les hooks (`fetch` + PerformanceObserver) — les chunks chargés
     APRÈS l'injection sont aussi attrapés ;
   - collecte les modules déjà chargés et **récupère leurs sources** (fetch) ;
   - extrait les **signatures** (Babylon, appels GL, WebCodecs, RTC, ancres
     du client stable…) ;
   - mesure le **draw pendant 8 s** (hooks sur `WebGL2RenderingContext` /
     `WebGLRenderingContext` / `GPUQueue.submit` + comptage rAF) ;
   - affiche le résumé markdown dans la console.
4. Récupérer les données :
   - `window.BX_PREVIEW_CAPTURE.download()` → rapport **JSON complet**
     (meta + modules avec sources + hits + draw) ;
   - `window.BX_PREVIEW_CAPTURE.downloadAll()` → chaque module brut (.js) ;
   - `window.BX_PREVIEW_CAPTURE.report()` → re-afficher le résumé markdown ;
   - `window.BX_PREVIEW_CAPTURE.stop()` → retirer les hooks (état figé).

## Usage — bookmarklet

Créer un favori dont l'URL est :

```
javascript:(()=>{ /* coller le contenu de capture.js ici */ })()
```

Cliquer sur le favori **sur la page du stream** (même comportement que la
console). Le code fait ~10 Ko — un bookmarklet les accepte sans problème.

## Injection AVANT le stream (facultatif)

Le preview est une SPA React Router : changer de route (home → jeu) **ne
recharge pas le document**. Un harnais injecté sur la home **survit** au
démarrage du stream et attrape les chunks chargés à l'ouverture du jeu via son
hook `fetch` + le PerformanceObserver. Flux conseillé : injecter sur la home,
ouvrir un jeu, laisser tourner le stream ~30 s, puis `download()`.

## Ce que le rapport contient

| Bloc | Contenu |
|---|---|
| Meta | date ISO, URL, user-agent |
| Modules | liste `url / octets / load ms / signatures` (hits par module) |
| Matrice signatures × modules | qui contient quoi (compacité : seules les signatures avec hits) |
| **Draw Babylon** | FPS, drawArrays+drawElements/frame, uploads tex*/frame, **GL total µs/frame** (médiane, p90, max), **upload µs/call** (médiane), submits GPU/frame |
| Ligne de session | au format du projet, prête pour une future table Preview |

### Interprétation des métriques draw

- **uploads tex\*/frame + µs/call** = le proxy « émission » du protocole GPU du
  repo (bench/gpu/) : c'est là que notre patch `texSubImage2D` (storage
  immuable) gagne ×5 vs `texImage2D`. La mesure JS (`performance.now`) est le
  temps wall — le readback/sync GPU (queries `EXT_disjoint_timer_query`) est un
  prolongement prévu.
- **GL total µs/frame** = le budget de rendu Babylon par frame : à comparer au
  `updateFrame`/`updateCanvas` du stable (~10-20 µs build vs ~40-75 µs perf10).
- **submits GPU/frame** : si Babylon tourne en WebGPU (`isWebGPU`), la boucle
  passe par `GPUQueue.submit` — les optimisations à porter seraient alors
  côté pass/encodage, pas côté texSubImage2D.

## Rejouabilité hors navigateur

`node bench/preview/self-test.js` rejoue le **moteur de signatures** (extrait
de capture.js — source unique) sur les bundles locaux et vérifie que
`bench/preview/static-matrix.md` (référence committée) n'a pas dérivé :

```
node bench/preview/self-test.js [dirA dirB ...] [--print] [--write]
```

- défauts : `D:/tmp/preview-player D:/tmp/stable-client` (les bundles statiques
  déjà capturés — mémo §10) ;
- `--write` : régénère `static-matrix.md` (à faire quand les bundles changent) ;
- exit 1 si capture.js casse, si les signatures dérivent, ou si la matrice
  dérive.

### Lecture de la matrice de référence (17 août 2026)

Ancres clés dans le preview statique :

| Module preview | Rôle | Signatures notables |
|---|---|---|
| `thinEngine-*.js` | renderer Babylon.js | Babylon ×25/×11, texImage2D ×6, texSubImage2D ×1, drawArrays ×7, drawElements ×6, bindTexture ×33 |
| `dist-jl9agyah.js` | rendu WebGL1 (fallback ?) | drawElements ×13, drawArrays ×2, bindTexture ×11, createImageBitmap |
| `adapter_core-*.js` | couche RTC | RTCPeerConnection ×154, setLocalDescription ×9, getStats ×6 |
| `StreamSessionRequest-*.js` | protocole session | StreamSessionConfiguration ×5 |
| `entry.client-*.js` | app shell (4 Mo) | VideoDecoder ×2, getGamepads ×6, RTC ×2 |
| `GameStreamBootstrapper-*.js` | orchestration stream | — (le setting `clarityBoostSetting` n'est PAS le shader CAS) |

Stable (référence du portage) : le player réel (`WebGL2Player`, CAS shader)
est **lazy** — absent des chunks statiques, il se charge en session ; la
matrice statique n'attrape que sa couche RTC (`2091`, RTCPeerConnection ×154)
et son core vidéo (`8128`, VideoFrame ×29, requestVideoFrameCallback ×14,
pollGamepads ×1). La **comparaison signature-à-signature avec le stable se
fera donc à partir des captures de session** (ce harnais) : si les ancres
Babylon du preview (texSubImage2D, iResolution…) matchent celles que nos
patches 13-20 ciblent, le portage devient mesurable.

## Limites connues

- La mesure GL est **JS-side** (wall time) — pas de timestamps GPU (à ajouter
  via `EXT_disjoint_timer_query_webgl2` sur le contexte réel).
- Le fetch des sources peut être lourd (entry.client ~4 Mo) ; `cfg.dumpSources`
  est activé par défaut, désactivable dans le harnais.
- Un marker de section de commentaire dans un résumé fausserait le découpage
  (cf. bench/pr-comment-merge.test.js) — sans rapport ici, juste par acquis.
- Le preview évolue vite (public preview) : régénérer `static-matrix.md` après
  chaque capture significative (`--write` + commit).
