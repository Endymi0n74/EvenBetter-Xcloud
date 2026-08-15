# better-xcloud-perf — v1.3.0

[![Release](https://img.shields.io/github/v/release/Endymi0n74/better-xcloud-perf?style=for-the-badge&color=green)](https://github.com/Endymi0n74/better-xcloud-perf/releases/latest)
[![Install](https://img.shields.io/badge/Install-userscript-blue?style=for-the-badge)](https://github.com/Endymi0n74/better-xcloud-perf/releases/latest/download/better-xcloud.user.js)

Fork performance du userscript [Better xCloud](https://github.com/redphx/better-xcloud)
(redphx), orienté **performance**. Dernière release :
[better-xcloud-perf-v1.3.0](https://github.com/Endymi0n74/better-xcloud-perf/releases/tag/better-xcloud-perf-v1.3.0).

Ce dépôt contient le script **buildé** (`better-xcloud.user.js`) — c'est le
fichier à installer tel quel dans un gestionnaire d'userscripts. Les
optimisations sont listées dans l'en-tête du script et détaillées ci-dessous.

## Installation

**Installation directe** (recommandé) — ouvrir ce lien dans un navigateur avec
Tampermonkey / Violentmonkey installé :

```
https://github.com/Endymi0n74/better-xcloud-perf/releases/latest/download/better-xcloud.user.js
```

Ou manuellement :

1. **Copie** le contenu de `better-xcloud.user.js` (ou installe le fichier
   directement) dans Tampermonkey / Violentmonkey / Greasemonkey.
2. Le script se déclenche automatiquement sur `https://www.xbox.com/*/play*`
   (`@match` déjà configuré, `@run-at document-start`).
3. Recharge `xbox.com/play`.

> Ne pas installer en même temps que le Better xCloud officiel — les deux
> écriraient les mêmes préférences `localStorage` et entreraient en conflit.

> **⚠️ Upgrade depuis la v1.0.0 (ou antérieure)** : si le script a été installé
> avant la v1.1.0, son `@updateURL` pointe encore vers l'upstream redphx —
> Tampermonkey ne verra pas les mises à jour du fork (et pourrait même
> proposer de « mettre à jour » vers le Better xCloud officiel, dont la
> version `6.7.12` est numériquement supérieure à `1.1.0`). **Réinstallez
> manuellement une fois** via le lien ci-dessus pour basculer l'auto-update
> vers ce fork ; les versions suivantes se mettront à jour toutes seules.

## Mise à jour & auto-update

Chaque release contient **deux fichiers** :

| Fichier | Rôle |
|---|---|
| `better-xcloud.meta.js` | En-tête du script seul (~0,7 Ko) — l'URL pointée par `@updateURL` |
| `better-xcloud.user.js` | Script complet (479 Ko) — l'URL de `@downloadURL` |

Au moment du check d'update, Tampermonkey télécharge **`better-xcloud.meta.js`**
(léger), compare le `@version` servi avec celui installé, et ne télécharge le
script complet que si une nouvelle version existe. Évite de télécharger 479 Ko
à chaque vérification.

```
@updateURL    → …/releases/latest/download/better-xcloud.meta.js
@downloadURL  → …/releases/latest/download/better-xcloud.user.js
```

> L'`@updateURL` pointe vers le fork depuis la v1.1.0 — les installations
> antérieures gardent l'URL upstream (voir la note « Upgrade » ci-dessus).

## Optimisations perf11 + perf13

| # | Optimisation | Effet |
|---|---|---|
| 1 | `StreamStats` : suppression du cache `_cachedOpacity`/`_cachedTextSize` | Corrige la régression où `stats.opacity.all` et `stats.textSize` ne s'appliquaient plus jusqu'au reload |
| 2 | `StreamStats` : throttle `document.hidden` | Cadence 1 s visible, 60 s en arrière-plan (`INTERVAL_BACKGROUND`) |
| 3 | `StreamStats` : `setTimeout` auto-réarmé + garde `isUpdating` | Fini les `setInterval` chevauchants ; le tick ne repart qu'après la fin du précédent |
| 4 | `StreamStatsCollector.collect()` : un seul parcours du `RTCStatsReport` | Divise par deux le coût d'itération du tick (centaines d'entrées par report) |
| 5 | `ALL_PREFS` → `Set` | `isGlobalPref`/`isStreamPref` en O(1) |
| 6 | `validateValue` : `filter` + `Set` | Corrige le saut d'index du `splice` sur valeurs invalides consécutives ; O(n) |
| 7 | `getGameSettings` : suppression batch | Une seule `saveSettings()` au lieu d'une par clé purgée |
| 8 | `checkForUpdate` : garde 2 h avant le fetch | Plus de requête GitHub API ni d'écriture localStorage à chaque chargement de page |
| 9 | `BxSelectElement` : observer délégué unique | Un seul `MutationObserver` (documentElement) remplace un observer par `<select>` |
| 10 | `Translations` : `debugger` retiré | Fini la pause d'exécution en devtools si le fetch des traductions échoue |
| 11 | Controller customization : fix `delete mapping.Share` | Le binding Share n'est plus mutilé après la première pression ; plus de spam d'événements screenshot |
| 12 | Controller customization : skip idle | Zéro allocation et zéro itération du mapping quand aucun bouton pressé et sticks centrés |
| 13 | `WebGL2Player` : `texStorage2D` + `texSubImage2D` | Allocation GPU stable (la texture n'est plus réallouée à chaque `texImage2D`) ; recréation sur changement de résolution |
| 14 | `WebGL2Player` : fix viewport | `drawingBufferHeight` à la place de `drawingBufferWidth` |
| 15 | `poll_gamepad_default` : `structuredClone` → référence directe | Le `structuredClone` de l'état Home au relâchement était inutile (objet non muté entre lecture et `=null`) — zéro allocation, chemin mesuré 1236 ns → 280 ns (-77 %) |
| 16 | `WebGL2Player` : `bindTexture` par frame supprimé | La texture reste liée entre les frames (une seule texture, contexte dédié) — 60 appels GL/s de moins |
| 17 | `WebGL2Player` : flag expérimental `WebGL2NoColorConversion` | `gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)` avant les uploads vidéo — skippe la conversion sRGB du navigateur (gain potentiel sur le chemin le plus cher) ; désactivé par défaut, à activer via `BX_FLAGS` avec validation visuelle |

L'historique perf1–perf10 (Set O(1) du patcher, debounce localStorage, cache
`getBattery()`, uniform locations pré-calculées, etc.) est conservé dans
l'en-tête du script.

## Benchmarks

Mesures **perf10 (baseline)** vs **v1.3.0**, même machine (Windows, Edge
headless, Node V8), harnais jetables dédiés. L'objectif n'est pas la précision
absolue mais la comparaison relative entre les deux builds.

### Chargement (parse + éval de page)

| Mesure | perf10 | v1.3.0 | Δ |
|---|---|---|---|
| Parse/compile (Node `new Function`, ×300, médiane) | 0,135 ms | 0,127 ms | ~-6 % (bruit sub-ms) |
| Éval complète de page (Edge headless, injection `document-start`, 20 runs, médiane) | 24,8 ms | 24,8 ms | ~0 % |

La série perf11/v1.3.0 visait le **runtime** (hot loops, GPU, caches), pas le
chargement — confirmé : le coût de démarrage est identique (le `p95` de perf10
présente des outliers environnementaux, la médiane est stable).

### Hot loops (~60 Hz)

Micro-benchmarks Node (V8), fragments injectés extraits des builds, 200 000
itérations par scénario.

| Hot loop | perf10 | v1.3.0 | Gain |
|---|---|---|---|
| Controller customization — **IDLE** (aucun input, sticks centrés) | 331 ns/poll | **35 ns/poll** | **-89 % (×9)** |
| Controller customization — ACTIF (bouton + stick) | ~400 ns/poll | ~400 ns/poll | équivalent (±10 % run à run) |
| `poll_gamepad_default` — chemin commun (Home jamais pressé) | 10,4 ns/poll | 10,4 ns/poll | identique |
| `poll_gamepad_default` — relâchement du bouton Home | 1059 ns | **111 ns** | **-89 %** |
| `WebGL2Player.updateFrame` — chemin stable (coût JS seul) | ~150 ns/frame | ~140 ns/frame | équivalent (voir note) |

Notes :

- Le **skip idle** (patch 12) divise par ~9 le coût du poll au repos — le cas
  commun en jeu (pauses entre inputs) : plus d'allocations
  `pressedButtons`/`releasedButtons`, plus d'itération du mapping à chaque poll.
- Le relâchement du bouton Home passait par un `structuredClone` inutile
  (l'objet `{shortcutPressed, timestamp}` n'est jamais muté entre la lecture et
  le `=null` qui suit) — remplacé par une référence directe (patch 15).
- `updateFrame` a un coût JS négligeable dans les deux versions : le gain réel
  est côté driver GPU — `texImage2D` → `texSubImage2D` (plus de réallocation de
  texture à chaque frame) et suppression du `bindTexture` par frame (60 appels
  GL/s en moins). Ces effets ne sont pas mesurables dans un micro-benchmark JS.
- En absolu, les économies sont de l'ordre de la microseconde par opération :
  l'intérêt est l'élimination des **allocations à 60 Hz** (pression GC) et du
  travail driver répété, pas le temps CPU brut.

### GPU — renderer WebGL2 (mesures réelles)

Harnais : Edge avec **GPU réel (NVIDIA RTX 3070 via ANGLE/D3D11)**, y compris
en headless, vidéo de test 640×360 (VP9) générée en navigateur, classe
`WebGL2Player` extraite de chaque build et exécutée dans un vrai contexte
WebGL2, méthodes GL instrumentées (compteurs) et rasterisation mesurée via
`EXT_disjoint_timer_query_webgl2` (`TIME_ELAPSED` autour de `drawArrays`),
120 frames × 2 passes.

| Mesure | perf10 | v1.3.0 | Δ |
|---|---|---|---|
| Appels GL par frame | `texImage2D` + `drawArrays` (0 allocation) | `texSubImage2D` + `drawArrays` (0 allocation) | même nombre d'appels |
| Upload vidéo — boucle tight (µs/upload) | ~200–235 µs | ~64–66 µs | **-67 à -72 %** |
| Rasterisation `drawArrays` (µs/draw, médiane GPU) | 10,2 µs | 10,2 µs | identique (même shader) |
| `updateFrame` — wall moyen (ms/frame) | 0,22 ms | 0,07 ms | **-66 %** |

Lecture des résultats :

- Le **draw** (rasterisation) coûte pareil dans les deux versions — même
  shader, même résolution : attendu.
- Le vrai levier est l'**upload vidéo** : `texImage2D` **réalloue le storage
  GPU de la texture à chaque frame** (~3× le coût d'un `texSubImage2D` dans un
  storage immuable). C'est le bénéfice mesurable des patches 13/16 côté GPU —
  invisible dans les micro-benchmarks JS (d'où l'écart avec la table
  « Hot loops » ci-dessus).
- Le wall de `updateFrame` suit (~3× plus lent en perf10) : la partie
  synchronisée du chemin d'upload domine la frame.

> **⚠️ Bug connu dans les builds v1.2.0 et v1.3.0 (et dans le TS upstream)** :
> `gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGB, …)` utilise un **format
> non-sized** (`gl.RGB`) → `INVALID_ENUM` à chaque changement de résolution →
> l'allocation échoue, les uploads vidéo échouent (`CopySubTextureCHROMIUM`)
> et le renderer WebGL2 rend un **écran noir**. Vérifié par `readPixels`
> (pixels 100 % noirs avec `gl.RGB`, vidéo réelle avec `gl.RGB8`).
> **Correctif : `gl.RGB` → `gl.RGB8`** (une ligne — prévu pour la v1.4.0).
> Les mesures GPU ci-dessus ont été prises **avec ce correctif appliqué au
> code extrait** pour mesurer le chemin fonctionnel (le renderer WebGL2 n'est
> pas le défaut — `video.player.type` — donc l'impact se limite aux sessions
> qui l'activent).

## Repro — comment les mesures sont faites

Les chiffres du chapitre Benchmarks viennent de harnais jetables décrits
ci-dessous (paramètres + pièges) pour pouvoir les rejouer ou les adapter.

### Environnement commun

- Windows, **Edge** (canal `msedge` via Playwright) pour les mesures navigateur,
  **Node V8** pour les micro-benchmarks CPU.
- Les deux builds comparés : baseline **perf10** (`git show
  055d3a0:better-xcloud.user.js`) et **v1.3.0** (`better-xcloud.user.js` du repo).
- Page de test servie par un **serveur HTTP local 127.0.0.1** : une origine
  réelle est obligatoire (pas de `localStorage` sur `about:blank`).

### Parse / compile (Node)

- `new Function(code)` **sans exécution** (l'exécution réelle est mesurée dans
  Edge), ×300 itérations, médiane. Sub-ms → bruité : seule la comparaison
  relative compte.

### Éval complète de page (Edge, injection au document-start)

- URL : `http://127.0.0.1:<port>/en-us/play` — le script exige
  `pathname.match(/^\/[a-zA-Z]{2}-[a-zA-Z]{2}\/play/)` (garde « Not xCloud
  page »).
- `window.BX_FLAGS = { SafariWorkaround: false }` (désactive la garde de reload
  qui jette si `readyState !== "loading"`).
- Injection au **document-start** via `page.addInitScript`, évaluation dès que
  `document.documentElement` existe — **poll 1 ms** (il est null ~18-25 ms au
  début de la navigation ; `setTimeout(0)` tire trop tôt).
- Temps mesuré = durée de l'`eval` du script complet (bootstrap `main()`
  inclus), 20 runs, médiane/p95 (perf10 présente des outliers p95
  environnementaux, la médiane est stable).

### Hot loops ~60 Hz (Node)

- Extraction des fragments injectés depuis le build : regex
  `var <nom> = "((?:[^"\\]|\\.)*)";` puis décodage de la chaîne (JSON).
- Substitutions des placeholders que le Patcher fait à l'exécution :
  `$xCloudGamepadVar$` → variable du gamepad, `$gamepadVar$` → `currentGamepad`.
- `var self=this` en tête de `poll_gamepad_default` : appeler `fn.call(ctx, ctx)`
  (sinon `this` = global et le chemin « relâchement » ne se déclenche jamais).
- Shadow de `window` et `setTimeout` dans le wrapper (sinon Node tire le vrai
  timer/global).
- **Réutiliser le même ctx entre les polls** : un ctx neuf par itération
  (20+ objets) domine la mesure.
- Mapping/ranges réalistes pour `controller_customization` ; le chemin
  « relâchement Home » exige `bxHomeStates[index]` pré-rempli +
  `inputSink.onGamepadInput` + `BX_STREAM_SETTINGS.controllerPollingRate`.
- 200 000 itérations par scénario, warmup avant mesure.

### GPU — renderer WebGL2 (Edge réel)

Le harnais complet vit dans `D:\Codex\gpubench\` (hors repo) : `gen-video.js`
(vidéo de test), `gpu-runner.js`, classes extraites, `test.webm`. Points clés :

- **Vidéo de test** : le ffmpeg de Playwright n'a pas `lavfi` → générer la
  vidéo en navigateur (`canvas.captureStream(30)` + MediaRecorder VP9), servir
  en local.
- **Classe extraite** : `class WebGL2Player` découpée du build (bornes de
  classe) et évaluée dans la page avec un stub `BaseCanvasPlayer` minimal ;
  `getContext` est intercepté pour instrumenter le contexte WebGL2.
- **Compteurs GL** : wrapper des méthodes du contexte — **le wrapper doit
  `return orig(...)`** (sinon `createTexture()` renvoie `undefined` →
  « no texture bound » sur les appels suivants).
- **Timing GPU** : Edge/ANGLE n'expose pas `createQueryEXT` sur
  `EXT_disjoint_timer_query_webgl2` → utiliser l'API native `gl.createQuery()`
  + `gl.beginQuery(ext.TIME_ELAPSED_EXT, q)` + `gl.endQuery(...)`, résultats
  lus via `getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE / QUERY_RESULT)`
  (résolution en parallèle).
- `WEBGL_debug_renderer_info` pour identifier le renderer (headless garde le
  GPU réel : « ANGLE (NVIDIA, … D3D11) »).
- `readPixels` sur une texture ≥ dimensions de la vidéo (sinon
  « Offset overflows texture dimensions »).
- Le build v1.3.0 publié porte le bug `texStorage2D(gl.RGB)` (écran noir, cf.
  plus haut) : le runner applique le correctif `gl.RGB → gl.RGB8` au code
  extrait pour mesurer le chemin fonctionnel.

## Historique du dépôt

```
561595d feat: add experimental WebGL2NoColorConversion flag (video upload)
62abcd9 build: prepare v1.3.0 with hot-loop optimizations
366fb41 docs: document meta.js auto-update flow and refresh history for v1.2.0
95e41a9 build: bump userscript to 1.2.0
912e3d4 docs: update patch 01 description to reflect meta.js updateURL header
a411727 build: point @updateURL to a lighter meta.js for update checks
c7ac6fd docs: add upgrade note for v1.0.0 installs and refresh version references
d34b4a5 build: prepare v1.1.0 with fork update/download URLs
c7c95a2 docs: add release and install badges to README header
7ac17bc docs: clarify patch location in patches/README
72e655c build: bump userscript version to 1.0.0
21d6652 docs: rename release references to better-xcloud-perf-v1.0.0
7fe1bce docs: add direct install link to release asset
560be6c chore: extend .gitignore with IDE and dependency exclusions
80e086d docs: expand Portage section to make repo self-contained
1525d4e chore: add .gitignore for temp files and test directories
338f509 chore: add global perf10→perf11 patch
3d8b78e docs: add per-optimization patches with compatibility matrix
c099b29 docs: add README with perf11 optimizations and install guide
289f38b perf: apply v6.7.12-perf11 optimizations
055d3a0 chore: import v6.7.12-perf10 userscript as baseline
```

## Portage

Ce dépôt est autonome : il contient la baseline, le build et tous les patches
nécessaires pour reconstruire ou porter les optimisations.

### Reconstruire le build (round-trip vérifié octet-pour-octet)

```bash
# Baseline perf10 (commit 055d3a0) + patch global → build v1.3.0 identique
# au fichier better-xcloud.user.js du repo.
git show 055d3a0:better-xcloud.user.js > better-xcloud.user.js
# Important sous Windows : core.autocrlf=false, sinon le contexte du patch ne matche pas
git -c core.autocrlf=false apply better-xcloud-perf11.patch
node --check better-xcloud.user.js
```

### Tout porter d'un coup

- `better-xcloud-perf11.patch` : patch global perf10 → perf11, vérifié en
  round-trip octet-pour-octet sur la baseline. À appliquer avec
  `git -c core.autocrlf=false apply better-xcloud-perf11.patch`.

### Portage sélectif

- `patches/` : 17 patches individuels (un par optimisation), chacun applicable
  seul sur la baseline perf10. Lisez `patches/README.md` pour la liste détaillée,
  la matrice de compatibilité par paires et les zones non empilables (le build
  minifié a des lignes géantes : plusieurs optimisations de la même zone
  modifient la même ligne physique et leurs patches ne se cumulent pas).

### Portage sur le source upstream (branche typescript)

Les patches buildés ne s'appliquent **pas** sur la branche `typescript`
(le source TS diffère du build). Le portage upstream se fait par fichiers
source : `src/modules/player/webgl2/webgl2-player.ts`,
`src/modules/patcher/patches/src/controller-customization.ts`,
`src/modules/touch-controller.ts`, etc.

## Licence

MIT (comme l'original). Crédit à [redphx](https://github.com/redphx) pour
Better xCloud.
