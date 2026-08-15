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
