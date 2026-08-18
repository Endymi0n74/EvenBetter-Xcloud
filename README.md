# EvenBetterXcloud — v1.9.0

[![Release](https://img.shields.io/github/v/release/Endymi0n74/EvenBetter-Xcloud?style=for-the-badge&color=green)](https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest)
[![Install](https://img.shields.io/badge/Install-userscript-blue?style=for-the-badge)](https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest/download/better-xcloud.user.js)
[![CI](https://img.shields.io/github/actions/workflow/status/Endymi0n74/EvenBetter-Xcloud/bench.yml?style=for-the-badge)](https://github.com/Endymi0n74/EvenBetter-Xcloud/actions/workflows/bench.yml)

**🇫🇷 Français** · [🇬🇧 English](README.en.md)

Fork performance du userscript [Better xCloud](https://github.com/redphx/better-xcloud)
(redphx), orienté **performance**. Dernière release :
[evenbetter-xcloud-v1.9.0](https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/tag/evenbetter-xcloud-v1.9.0).

Ce dépôt contient le script **buildé** (`better-xcloud.user.js`) — c'est le
fichier à installer tel quel dans un gestionnaire d'userscripts. Les
optimisations sont listées dans l'en-tête du script et détaillées ci-dessous.

## Installation

**Installation directe** (recommandé) — ouvrir ce lien dans un navigateur avec
Tampermonkey / Violentmonkey installé :

```
https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest/download/better-xcloud.user.js
```

Ou manuellement :

1. **Copie** le contenu de `better-xcloud.user.js` (ou installe le fichier
   directement) dans Tampermonkey / Violentmonkey / Greasemonkey.
2. Le script se déclenche automatiquement sur `https://www.xbox.com/*/play*`
   (`@match` déjà configuré, `@run-at document-start`).
3. Recharge `xbox.com/play`.

> Ne pas installer en même temps que le Better xCloud officiel — les deux
> écriraient les mêmes préférences `localStorage` et entreraient en conflit.

> **⚠️ Upgrade depuis la v1.8.0 (ou antérieure)** : le **rebrand v1.9.0** a
> changé l'identité du script (`@name` `Better xCloud` → `EvenBetterXcloud`,
> `@namespace` redphx → `Endymi0n74/EvenBetter-Xcloud`, `@updateURL` → ce
> repo). Les gestionnaires d'userscripts (Greasemonkey, Tampermonkey…) traitent
> ce changement comme un **script différent** : l'auto-update ne migre pas
> entre deux identités. **Désinstallez l'ancien « Better xCloud » à la main**
> (dashboard du gestionnaire) puis installez la v1.9.0 via le lien ci-dessus —
> une seule fois ; les versions suivantes se mettront à jour toutes seules via
> `@updateURL`. ⚠ Ne gardez pas les deux installés (double injection :
> l'ancien badge « Better xCloud » peut recouvrir le nouveau).
>
> Même principe pour les très vieilles installations (avant la v1.1.0) : leur
> `@updateURL` pointe encore vers l'upstream redphx et elles pourraient
> proposer de « mettre à jour » vers le Better xCloud officiel (version
> `6.7.12` numériquement supérieure à `1.1.0`) — désinstallez et réinstallez
> une fois via ce repo.

## Mise à jour & auto-update

Chaque release contient **deux fichiers** :

| Fichier | Rôle |
|---|---|
| `better-xcloud.meta.js` | En-tête du script seul (~0,7 Ko) — l'URL pointée par `@updateURL` |
| `better-xcloud.user.js` | Script complet (470 Ko) — l'URL de `@downloadURL` |

Au moment du check d'update, Tampermonkey télécharge **`better-xcloud.meta.js`**
(léger), compare le `@version` servi avec celui installé, et ne télécharge le
script complet que si une nouvelle version existe. Évite de télécharger 470 Ko
à chaque vérification.

```
@updateURL    → …/releases/latest/download/better-xcloud.meta.js
@downloadURL  → …/releases/latest/download/better-xcloud.user.js
```

> L'`@updateURL` pointe vers le fork depuis la v1.1.0 — les installations
> antérieures gardent l'URL upstream (voir la note « Upgrade » ci-dessus).

## Installation mobile (Android & iOS)

Le même userscript fonctionne sur mobile — xCloud web est responsive et les
`@match` couvrent `xbox.com/play` sur tous les appareils.

| Plateforme | Navigateur | Installation |
|---|---|---|
| **Android** | **App native `evenbetter-xcloud-1.9.0.apk`** (wrapper WebView, ~140 Ko) | [Téléchargement direct](https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/download/evenbetter-xcloud-v1.9.0/evenbetter-xcloud-1.9.0.apk) → sideload (voir `mobile/README.md`) — script embarqué, écran maintenu, fullscreen géré |
| **Android** | Kiwi Browser (ou Edge Android) + Tampermonkey | Ouvrir le lien d'installation directe ci-dessus (section Installation) → Tampermonkey propose l'installation |
| **iOS** | Safari + l'app **« Userscripts »** (gratuite, open source) | Dans Userscripts, « + » → coller l'URL `…/releases/latest/download/better-xcloud.user.js`, puis activer l'extension dans Safari |

**Attention** :

- Les gains de perf mesurés (GPU WebGL2, startup, hot loops) le sont sur le
  **client desktop** (Chrome/Edge). Sur mobile, l'overlay, les settings et
  l'auto-update fonctionnent, mais le rendu xCloud mobile diffère et les
  chiffres ne sont pas transposables — surtout sur Safari/WebKit.
- L'auto-update (`@updateURL`) fonctionne de la même façon sur mobile :
  Tampermonkey/userscripts vérifient `better-xcloud.meta.js` à chaque lancement.
- Le **preview** (play.xbox.com) n'a pas d'intérêt sur mobile — c'est un
  client desktop uniquement.

## Deux versions — stable et preview (play.xbox.com)

Le repo maintient **deux builds indépendants, jamais fusionnés** (contrat
détaillé dans `bench/preview/port/README.md`) :

| | **Stable** (production) | **Preview** (play.xbox.com) |
|---|---|---|
| Rôle | Le fork optimisé classique — xbox.com/play (SPA Webpack, renderer WebGL2) | La variante du nouveau client web (React Router 7 + rolldown, renderer Babylon.js) |
| Fichier | `better-xcloud.user.js` | `better-xcloud-preview.user.js` (+ `.meta.js`) |
| Version | `1.9.0` | `1.9.0-preview1` (prerelease) |
| `@name` | `EvenBetterXcloud` | `EvenBetterXcloud (Preview)` |
| `@match` | `www.xbox.com/*/play*` | `play.xbox.com/*` uniquement |
| Auto-update | `releases/latest` (canal stable) | tag dédié `evenbetter-xcloud-v1.9.0-preview1` (jamais le `latest`) |

Les deux builds **cohabitent sans se confondre** : identité distincte
(name/version/updateURL) et matches disjoints (le preview ne s'exécute jamais
sur `www.xbox.com`). La séparation est vérifiée à chaque PR/push par le CI
(step « Build preview — contrat deux versions ») — toute évolution du stable
qui casserait le preview ou la séparation fait échouer le job.

### Installation

**Stable** (canal `latest`) :

```
https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest/download/better-xcloud.user.js
```

**Preview** (prerelease — à tester sur play.xbox.com, compte Insider avec
Preview Features activé) :

```
https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/download/evenbetter-xcloud-v1.9.0-preview1/better-xcloud-preview.user.js
```

Le preview est **jouable et validé en réel (17 août)** : bouton settings dans le
top bar + dialog ouvert (T4/T7 — résilience au remplacement du document par le
shell), réécriture P2 de la session prouvée (`enableVibration`/mkb/mic dans la
configuration de la session live). P1 (anti-kick idle) est en place via
`wrapSession` — seuil d'idle serveur observé > 1 h. Depuis **preview3**, le
build n'override plus `osName=tizen` (A/B mesuré : no-op en PC — résolution ET
bitrate identiques au natif) — le play part sans réécriture. Depuis
**preview4**, le bouton settings est aussi dans la **game bar** en session (la
page stream immersive de play.xbox.com n'a ni header ni nav — T9). Le stable
n'est jamais affecté.

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
| 18 | `WebGL2Player` : fix `texStorage2D` | `gl.RGB` (format **non-sized** → `INVALID_ENUM`, renderer WebGL2 **écran noir**) → `gl.RGB8` — corrige le bug introduit par l'opti 13 (présent aussi dans le TS upstream) |
| 19 | `WebGL2Player.updateCanvas` : cache des valeurs de uniforms | 7 `gl.uniform*` sautés par frame quand rien ne change (invalidation par comparaison de valeurs) — chemin stable ~296 → ~22 ns/frame (**×13,7**) |
| 20 | `WebGL2Player.updateCanvas` : skip par flag dirty | Le recalcul des uniforms n'est relancé que si `updateOptions`/`refreshPlayer` a invalidé le flag (options/canvas inchangés = 1 lecture + branche) — chemin stable ~22 → ~12,7 ns/frame (**×19,4** vs perf10) |
| 21 | `stream.video.codecProfile` : évaluation **paresseuse + mémoïsée** | `RTCRtpReceiver.getCapabilities("video")` (667 ms à froid = 96 % du eval de démarrage dans un Edge neuf) n'est plus appelé au chargement — options/unsupported/suggest sont calculés à la 1re lecture réelle (ouverture des settings / validation d'une valeur) puis mis en cache (constant par navigateur). Éval de page à froid 656,8 → 32,9 ms (**−95 %**), warm 26,5 → 24,2 ms (**−8,7 %**) |

L'historique perf1–perf10 (Set O(1) du patcher, debounce localStorage, cache
`getBattery()`, uniform locations pré-calculées, etc.) est conservé dans
l'en-tête du script.

## Benchmarks — synthèse

Mesures **perf10 (baseline)** vs **build courant**, même machine, harnais
rejouables (protocoles, tables détaillées et historique des sessions dans
[`bench/README.md`](bench/README.md)) :

| Mesure | perf10 | build | Gain |
|---|---|---|---|
| Parse/compile (Node) | ~0,117 ms | ~0,112 ms | négligeable |
| Hot loop controller IDLE | 327 ns | 34 ns | **×9,5** |
| updateCanvas (chemin 60 Hz) | 243 ns | 16 ns | **×15,6** |
| Éval de page — chaud (Edge, 20 runs) | 26,5 ms | 24,2 ms | **−8,7 %** |
| Éval de page — **froid** (navigateur neuf, pile RTC froide) | 657 ms | 33 ms | **−95 %** |
| Upload vidéo GPU (WebGL2, µs/upload) | ~42–78 µs | ~8–12 µs | **×5,5** |
| Draw GPU (shader USM 4 taps, v1.8.0) | 10,2 µs | 7,2 µs | **−30 %** |

Tables « Chargement », « Hot loops » et « GPU » complètes, sessions
(startup / hot loops / GPU, avec état haut-bas), protocole figé et repro :
[`bench/README.md`](bench/README.md).

## Historique du dépôt

```
a299c38 build: prepare v1.7.0 with lazy + memoized codecProfile (getCapabilities out of startup)
089375e bench: extend updateCanvas scenario to the dirty-flag steady state and add a GL-count check
b4821d8 build: prepare v1.6.0 with dirty-flag skip in WebGL2 updateCanvas
17dfaad bench: add --resume mode to run-gpu-ci.sh to skip completed seeds
e89cf2f bench: add one-command GPU protocol runner and confirm v1.5.0 GPU parity
dd2a604 docs: v1.5.0 benchmark tables, patch 19 matrix and GPU version note
24011f3 bench: add updateCanvas hot-loop scenario and CI threshold
20773ae build: prepare v1.5.0 with WebGL2 uniform value cache in updateCanvas
f43a372 ci: enrich the bench workflow with markdown summaries, artifacts and a GPU job
3963c44 docs: regenerate benchmark tables and document bench tooling and CI
90fb7ac bench: port GPU harness into bench/gpu so the Repro section is self-contained
e1d6dbc bench: add --update-readme mode and CI hot-loop ratio checks
579442f docs: freeze the GPU benchmark protocol and add one-shot freeze.sh re-measure
0db349e bench: stabilize parse harness and freeze the reproducible measurement protocol
178d886 bench: stabilize CPU hot-loop harness with warmup, seeded crossover and median
c413f17 docs: stabilize GPU benchmark harness and update measured figures
fc13e66 docs: re-measure GPU benchmarks on official v1.4.0 build
faafb72 docs: document v1.4.0 RGB8 fix, 18-patch matrix and benchmark harnesses
f6d0911 build: prepare v1.4.0 with texStorage2D RGB8 fix
82b35ec docs: add real-GPU benchmarks and reproduction section
82d0778 docs: add benchmarks chapter comparing perf10 vs v1.3.0
ca0f7dd docs: document WebGL2NoColorConversion flag and extend patch matrix to 17
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
# Baseline perf10 (commit 055d3a0) + patch global → build v1.6.0 identique
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

- `patches/` : 22 patches individuels (un par optimisation), chacun applicable
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
