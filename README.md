# better-xcloud-perf — v1.6.0

[![Release](https://img.shields.io/github/v/release/Endymi0n74/better-xcloud-perf?style=for-the-badge&color=green)](https://github.com/Endymi0n74/better-xcloud-perf/releases/latest)
[![Install](https://img.shields.io/badge/Install-userscript-blue?style=for-the-badge)](https://github.com/Endymi0n74/better-xcloud-perf/releases/latest/download/better-xcloud.user.js)

Fork performance du userscript [Better xCloud](https://github.com/redphx/better-xcloud)
(redphx), orienté **performance**. Dernière release :
[better-xcloud-perf-v1.6.0](https://github.com/Endymi0n74/better-xcloud-perf/releases/tag/better-xcloud-perf-v1.6.0).

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

L'historique perf1–perf10 (Set O(1) du patcher, debounce localStorage, cache
`getBattery()`, uniform locations pré-calculées, etc.) est conservé dans
l'en-tête du script.

## Benchmarks

Mesures **perf10 (baseline)** vs **v1.3.0**, même machine (Windows, Edge
headless, Node V8), harnais jetables dédiés. L'objectif n'est pas la précision
absolue mais la comparaison relative entre les deux builds.

### Chargement (parse + éval de page)

| Mesure | perf10 | v1.6.0 | Δ |
|---|---|---|---|
| Parse/compile (Node `new Function`, ×300/passe, protocole stabilisé : médiane de 3 passes × 3 seeds) | ~0,11–0,11 ms | ~0,10–0,11 ms | non mesurable : ≈ ±10–20 % run à run (bruit sub-ms) |
| Éval complète de page (Edge headless, injection `document-start`, 20 runs, médiane) | ~24 ms (min 21) | ~25 ms (min 22) | ~-4,7 % |

La série perf11 (re-mesurée sur le build v1.6.0 officiel — v1.5.0 a remplacé
les 7 `gl.uniform*` par un cache de valeurs dans `updateCanvas`, v1.6.0 par un
flag dirty) visait le
**runtime** (hot loops, GPU, caches), pas le chargement — confirmé : le coût de
démarrage est identique (le `p95` de perf10 présente des outliers
environnementaux, la médiane est stable).

### Hot loops (~60 Hz)

Protocole figé — seeds 42 / 2024 / 999 × 3 passes × 200 000 itérations ; chaque cellule = médiane des médianes, plage = min–max inter-seeds. Les absolus varient ~±10–30 % run à run, les ratios sont stables.

| Hot loop | perf10 | v1.6.0 | Gain |
|---|---|---|---|
| Controller customization — **IDLE** (aucun input, sticks centrés) | ~333 ns/poll (303–335) | **~29,8 ns/poll (30–38)** | **-91,1 % (×11,2)** |
| Controller customization — ACTIF (bouton + stick) | ~387 ns/poll (385–408) | ~397 ns/poll (382–456) | équivalent |
| `poll_gamepad_default` — chemin commun (Home jamais pressé) | ~12,8 ns/poll (11–17) | ~11,8 ns/poll (11–13) | identique |
| `poll_gamepad_default` — relâchement du bouton Home | ~1224 ns/poll (1189–1234) | **~152 ns/poll (150–159)** | **-87,6 % (×8,1)** |
| `WebGL2Player.updateFrame` — chemin stable (coût JS seul) | ~173 ns/frame (169–174) | ~142 ns/frame (141–152) | équivalent (voir note) |
| `WebGL2Player.updateCanvas` — valeurs inchangées (chemin 60 Hz, coût JS seul) | ~246 ns/frame (239–253) | **~12,7 ns/frame (13–13)** | **-94,8 % (×19,4)** |

Notes :

- Le **skip idle** (patch 12) divise par ~×6,5 à ×9 le coût du poll au repos — le cas
  commun en jeu (pauses entre inputs) : plus d'allocations
  `pressedButtons`/`releasedButtons`, plus d'itération du mapping à chaque poll.
- Le relâchement du bouton Home passait par un `structuredClone` inutile
  (l'objet `{shortcutPressed, timestamp}` n'est jamais muté entre la lecture et
  le `=null` qui suit) — remplacé par une référence directe (patch 15).
- `updateFrame` a un coût JS négligeable dans les deux versions : le gain réel
  est côté driver GPU — `texImage2D` → `texSubImage2D` (plus de réallocation de
  texture à chaque frame) et suppression du `bindTexture` par frame (60 appels
  GL/s en moins). Ces effets ne sont pas mesurables dans un micro-benchmark JS.
- Le cache des **uniforms** (`updateCanvas`, patch 19) supprimait les 7
  `gl.uniform*` par frame quand rien ne change (options, taille du canvas),
  par comparaison de valeurs (~22 ns/frame) ; depuis la **v1.6.0** (patch 20)
  un **flag dirty** posé par `updateOptions`/`refreshPlayer` remplace la
  comparaison : le chemin stable (60 Hz, rien ne change) coûte une lecture +
  une branche — ~12,7 ns/frame (**×19,4** vs perf10, ~×1,7 vs v1.5.0).
- En absolu, les économies sont de l'ordre de la microseconde par opération :
  l'intérêt est l'élimination des **allocations à 60 Hz** (pression GC) et du
  travail driver répété, pas le temps CPU brut.

### GPU — renderer WebGL2 (mesures réelles)

Harnais : Edge avec **GPU réel (NVIDIA RTX 3070 via ANGLE/D3D11)**, y compris
en headless, vidéo de test 640×360 (VP9) générée en navigateur, classe
`WebGL2Player` extraite de chaque build et exécutée dans un vrai contexte
WebGL2, méthodes GL instrumentées (compteurs) et rasterisation mesurée via
`EXT_disjoint_timer_query_webgl2` (`TIME_ELAPSED` autour de `drawArrays`),
120 frames × 3 passes (ordre mélangé par seed), protocole stabilisé (cf. Repro).

> Table mesurée sur **v1.4.0** — **confirmée sur v1.5.0** (protocole 6 seeds,
> classe extraite `gpu-v150-webgl2player.txt`, `--label-new=v1.5.0`, une
> commande : `./bench/gpu/run-gpu-ci.sh --cls-new=bench/gpu/gpu-v150-webgl2player.txt
> --label-new=v1.5.0`) : upload ×2,10, wallTotal ×1,49, draw 10,2 vs 9,2 µs
> (ratio 1,11 — drift inter-session documenté), chemin GL `texSubImage2D`
> intact. Entre v1.4.0 et v1.5.0 seul `updateCanvas` (cache des valeurs de
> uniforms, côté CPU) a changé ; **v1.6.0** ne change que `updateCanvas`
> (flag dirty, côté CPU) — `updateFrame` et le shader sont octet pour octet
> identiques à v1.5.0 (vérifié sur la classe extraite
> `gpu-v160-webgl2player.txt`) → **la table GPU reste valide**. Le coût CPU du
> chemin stable 60 Hz est couvert par la table « Hot loops ».
> **Re-confirmée sur v1.6.0** (protocole 6 seeds local, même jour que la
> release) : **PASS** — upload perf10 52,25 (48–61) vs v1.6.0 10,75
> (8,5–11,3) µs (**×4,86**), wallTotal 0,052 vs 0,017 ms (**×3,00**),
> draw **10,2 µs identique partout**, chemin GL `texSubImage2D` fonctionnel
> (0 `texImage2D`, 0 `bindTexture`). Les absolus sont nettement inférieurs à
> la session v1.5.0 (~61 µs pour le même code) — **dérive d'état GPU
> inter-sessions** (clocks/power state) : un contrôle même-session avec la
> classe v1.5.0 mesure les mêmes bas absolus → v1.5.0 et v1.6.0 sont
> identiques sur le chemin GPU (updateFrame byte-identique), seuls les
> ratios intra-session (perf10 vs build) comptent.

| Mesure | perf10 | v1.6.0 | Δ |
|---|---|---|---|
| Appels GL par frame | `texImage2D` + `drawArrays` (0 allocation) | `texSubImage2D` + `drawArrays` (0 allocation) | même nombre d'appels |
| Upload vidéo — boucle tight (µs/upload) | ~48–61 µs | ~8–11 µs | **×4,9** |
| Rasterisation `drawArrays` (µs/draw, médiane GPU) | 10,2 µs | 10,2 µs | identique (même shader) |
| `updateFrame` — wall total (ms/frame, boucle complète / FRAMES) | ~0,049–0,061 ms | ~0,011–0,022 ms | **×3,0** |

Lecture des résultats :

- Le **draw** (rasterisation) coûte pareil dans les deux versions — même
  shader, même résolution : attendu.
- Le vrai levier est l'**upload vidéo** : `texImage2D` **réalloue le storage
  GPU de la texture à chaque frame** (~×2,1 le coût d'un `texSubImage2D` dans
  un storage immuable). C'est le bénéfice mesurable des patches 13/16 côté GPU
  — invisible dans les micro-benchmarks JS (d'où l'écart avec la table
  « Hot loops » ci-dessus).
- Le wall de `updateFrame` suit (~×3,0 avec la métrique `wallTotal`
  stabilisée sur v1.6.0) : la partie synchronisée du chemin d'upload domine la frame.
- **Protocole figé** (cf. Repro — seeds 100/200/300/400/500/600 × 3 passes,
  commandes exactes) : re-mesure complète — upload perf10 98,5 / 113,5 /
  119,0 / 136,5 / 139,0 / 150,7 µs vs v1.4.0 54,7 / 58,2 / 62,8 / 65,2 /
  69,3 / 74,5 µs (médiane des médianes : 136,5 vs 65,2 µs, **×2,1**) ;
  wallTotal 0,097–0,136 vs 0,059–0,085 ms (**×1,5**) ; draw 0,01024 ms
  (**10,2 µs**) identique partout (un seed perf10 à 9,2 µs — état driver).
  **Deuxième session indépendante** du même protocole (mêmes seeds, mêmes
  commandes) : absolus décalés (session 1 : 80,5–93 / 43,8–50,3 µs) mais
  **draw, compteurs GL et ratios identiques** — la rejouabilité porte sur le
  draw, les compteurs et les ratios, pas sur les absolus (drift des clocks
  GPU inter-sessions documenté). **Re-mesure v1.6.0** du même protocole
  (mêmes seeds 100–600, même jour que la release) : upload 48–61 vs 8–11 µs
  (**×4,86**), wallTotal 0,052 vs 0,017 ms (**×3,00**), draw 10,2 µs
  identique partout — cf. la note au-dessus du tableau.

> **⚠️ Bug (corrigé en v1.4.0) — builds v1.2.0 et v1.3.0 (et TS upstream)** :
> `gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGB, …)` utilisait un **format
> non-sized** (`gl.RGB`) → `INVALID_ENUM` à chaque changement de résolution →
> l'allocation échouait, les uploads vidéo échouaient (`CopySubTextureCHROMIUM`)
> et le renderer WebGL2 rendait un **écran noir** (vérifié par `readPixels` :
> pixels 100 % noirs avec `gl.RGB`, vidéo réelle avec `gl.RGB8`).
> **Corrigé dans la v1.4.0** (`gl.RGB` → `gl.RGB8`, patch 18). Les mesures
> GPU du tableau ont été **re-mesurées sur le build v1.4.0 officiel sans
> aucune correction du harnais** (le fix est intégré au build ; la classe
> WebGL2Player de v1.3.0 est octet pour octet identique à celle de v1.4.0
> hormis ce fix — vérifié par `diff` des classes extraites)
> (le renderer WebGL2 n'est pas le défaut — `video.player.type` — donc
> l'impact de l'ancien bug se limitait aux sessions qui l'activaient).

## Repro — comment les mesures sont faites

Les chiffres du chapitre Benchmarks viennent des harnais du dossier
**`bench/`** de ce repo (autonomes, cf. `bench/README.md`) :

```bash
./bench/run-all.sh                   # parse + hot loops + éval page (Edge)
./bench/run-all.sh --skip-page-eval  # sans Playwright
```

Chaque harnais prend deux builds en argument (`<perf10.js> <build.js>`) ;
`run-all.sh` extrait la baseline depuis git (`git show 055d3a0:better-xcloud.user.js`)
et utilise `better-xcloud.user.js` à la racine. Détails ci-dessous (paramètres +
pièges) pour les adapter.

**CI** : le workflow `.github/workflows/bench.yml` lance
`run-all.sh --skip-page-eval` à chaque push sur `ubuntu-latest`, puis
`bench/check-ratios.js` échoue si un ratio de hot loop régresse au-delà de
son seuil (plancher ×4 pour IDLE/relâchement, ×12 pour updateCanvas avec le
flag dirty v1.6.0, fourchette 0,5–2,0 pour les scénarios équivalents) — le
scénario updateCanvas vérifie aussi **structurellement** les compteurs
`gl.uniform*` (le build ne doit plus émettre ses 7 appels qu'au warmup) —
voir `bench/README.md`.

### Protocole figé (tables « Hot loops » et « Chargement »)

Les tables du chapitre Benchmarks sont produites par ces **commandes exactes**
(build v1.6.0 de la racine — le code des hot loops est inchangé depuis
v1.3.0 ; le renderer WebGL2 a reçu le fix RGB8 en v1.4.0, le cache uniforms
en v1.5.0 et le flag dirty en v1.6.0) :

```bash
# 0. Préparer les builds
TMP=$(mktemp -d)
git show 055d3a0:better-xcloud.user.js > "$TMP/perf10.js"
cp better-xcloud.user.js "$TMP/build.js"

# 1. Hot loops : 3 seeds × 3 passes × 200 000 itérations — chaque run imprime
#    médiane/min/max sur les passes ; les tables prennent la médiane des
#    médianes et la plage min–max entre les 3 seeds
for S in 42 2024 999; do
  node --expose-gc bench/hotloops.js "$TMP/perf10.js" "$TMP/build.js" \
    --passes=3 --seed=$S --iters=200000
done

# 2. Parse/compile (ligne « Chargement ») : mêmes seeds, ×300 itérations/passe
for S in 42 2024 999; do
  node --expose-gc bench/parse.js "$TMP/perf10.js" "$TMP/build.js" \
    --passes=3 --seed=$S --iters=300
done

# 3. Éval page (ligne « Chargement ») : 20 runs, médiane/p95
node bench/page-eval.js "$TMP/perf10.js" "$TMP/build.js"
```

`--expose-gc` est obligatoire (préchauffage + `global.gc()` avant chaque
chrono) ; `--passes=3` (médiane/min/max sur les passes) et `--seed=`
(croisement version × scénario, mulberry32) rendent chaque run reproductible
et empêchent qu'une version soit systématiquement mesurée en premier.

**Rejouer les tables en une commande** : `./bench/freeze.sh` exécute ce bloc
à l'identique et `bench/freeze-format.js` formate la sortie en tableaux
markdown prêts à coller (médiane des médianes + plage inter-seeds, label de
version lu dans `@version`) — voir `bench/README.md`. Avec
`--update-readme`, les sections « Hot loops » et « Chargement » sont
**régénérées en place** dans le README (ancres `Notes :` / `La série perf11`
préservées ; `--with-page-eval` pour conserver la ligne « Éval »).

### Environnement commun

- Windows, **Edge** (canal `msedge` via Playwright) pour les mesures navigateur,
  **Node V8** pour les micro-benchmarks CPU.
- Les deux builds comparés : baseline **perf10** (`git show
  055d3a0:better-xcloud.user.js`) et **v1.6.0** (`better-xcloud.user.js` du repo).
- Page de test servie par un **serveur HTTP local 127.0.0.1** : une origine
  réelle est obligatoire (pas de `localStorage` sur `about:blank`).

### Parse / compile (`bench/parse.js`)

- `new Function(code)` **sans exécution** (l'exécution réelle est mesurée dans
  Edge), ×300 itérations par passe.
- **Stabilisation** (même protocole que hotloops/GPU) : préchauffage explicite
  en 2 phases (10 + 20 compiles) puis `global.gc()` avant le chrono
  (`node --expose-gc`, fait par `run-all.sh`) ; **runs croisés** : l'ordre des
  mesures (version × passe) est mélangé par seed reproductible (`--seed=N`,
  mulberry32) ; **médiane / min / max sur 3 passes** (`--passes=N`).
- Chrono par itération en `process.hrtime.bigint()` (résolution ns) : une
  compile ~110-150 µs est trop proche de la résolution de `performance.now()`
  pour une mesure par itération fiable. Le `p95` capture les outliers GC
  (absorbés par la médiane).
- Sub-ms → bruité : l'écart perf10/build est **dans le bruit inter-seed
  (≈ ±10-20 % run à run)** — le protocole le rend visible au lieu de figer un
  chiffre tiré d'une session chanceuse ; seule la comparaison relative compte.

### Éval complète de page (`bench/page-eval.js`, Edge, document-start)

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

### Hot loops ~60 Hz (`bench/hotloops.js`, Node)

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
- **Stabilisation** (réduction de la variance run à run, même recette que le
  GPU) : préchauffage explicite en 2 phases (5 000 + 10 000 itérations) puis
  `global.gc()` avant le chrono (`node --expose-gc`, fait par `run-all.sh` —
  sans ça la poubelle du warmup est purgée pendant la mesure) ; **runs
  croisés** : l'ordre des mesures (version × scénario) est mélangé par seed
  reproductible (`--seed=N`, PRNG mulberry32) ; **médiane / min / max sur
  3 passes** (`--passes=N`).
- 200 000 itérations par scénario. Le relâchement Home conserve son **ctx
  neuf** (le fragment met `bxHomeStates[index]` à `null` au premier
  relâchement — un ctx réutilisé retomberait sur le chemin rapide) mais
  `buttons` est **hoisté hors de la closure** (le créer par itération ajouterait
  20 allocations/poll et gonflerait la mesure).

### GPU — renderer WebGL2 (Edge réel, `bench/gpu/`)

Le harnais complet vit dans **`bench/gpu/` de ce repo** (autonome, cf.
`bench/gpu/README.md`) : `gen-video.js` (vidéo de test), `extract-class.js`
(extraction des classes), `gpu-runner.js`, classes extraites, `agg-seeds.js`,
`gpu-update-readme.js`. `test.webm` et les `run-s*.json` sont **gitignorés**
(artefacts générés) — les classes extraites, elles, sont versionnées.
Prérequis : Node + Playwright (canal `msedge`) + GPU réel. Points clés :

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
- `gpu-runner.js` est paramétrable : `--cls-p10=`/`--cls-new=` (classes
  extraites), `--label-new=`, `--frames=`, `--passes=`, `--seed=N`, `--no-fix`.
  Le correctif `gl.RGB → gl.RGB8` ne s'applique que si le code extrait contient
  encore `gl.RGB` (builds ≤ v1.3.0) ; le build v1.4.0 contient déjà le fix →
  mesuré avec `--no-fix`, strictement le build publié.
- **Stabilisation** (réduction de la variance inter-sessions) : préchauffage
  GPU explicite — 3 bursts × 200 frames séparés par `flush()` + 50 ms, puis
  30 frames, puis préchauffage de la boucle d'upload (50 uploads non
  chronométrés) ; **runs croisés mélangés** par seed reproductible
  (`--seed=N`, PRNG mulberry32) pour qu'aucune version ne soit
  systématiquement mesurée en premier ; **médiane sur 3 passes** (absorbe les
  outliers « première passe ») ; métrique **`wallTotal`** (temps de la boucle
  entière / FRAMES) — stable face à la résolution ~100 µs de `performance.now()`
  par frame (le wall par frame médian sature à 0,000).

**Protocole figé (GPU)** — rejouer la table « GPU » telle quelle (depuis la
racine du repo) :

```bash
# En une commande (même chaîne que le job CI gpu-upload : gen-video →
# 6 seeds × gpu-runner → agg-seeds → check-gpu) :
./bench/gpu/run-gpu-ci.sh                      # protocole complet (~30–40 min)

# Équivalent à la main (Prérequis : test.webm généré, Playwright via NODE_PATH,
# ex. NODE_PATH=/d/Codex/koharu/node_modules) :
for S in 100 200 300 400 500 600; do
  node bench/gpu/gpu-runner.js \
    --cls-p10=bench/gpu/gpu-perf10-webgl2player.txt \
    --cls-new=bench/gpu/gpu-v140-webgl2player.txt \
    --label-new=v1.4.0 \
    --no-fix --frames=120 --passes=3 --seed=$S \
    > bench/gpu/run-s$S.json
done
node bench/gpu/agg-seeds.js 100 200 300 400 500 600
node bench/gpu/check-gpu.js 100 200 300 400 500 600
```

`run-gpu-ci.sh` : canal auto-détecté (`msedge` Windows / `chromium` Linux),
`--seeds=`, `--keep-video`/`--force-video`, `--label-new=` (propagé à
`agg-seeds.js` — ex. `--cls-new=... --label-new=v1.5.0` pour mesurer un autre
build), `--no-fix` par défaut. Voir `bench/gpu/README.md` pour toutes les options.

Règles d'agrégation : chaque run imprime l'`agg` par version (médiane sur
les 3 passes de l'upload, du wallTotal et du draw) ; `agg-seeds.js` agrège
les 6 seeds (min / max / médiane des médianes par métrique) et les ratios.
`--no-fix` mesure **strictement le build publié** (la classe v1.4.0 contient
déjà `gl.RGB8` — le correctif ne s'applique qu'aux builds ≤ v1.3.0). Les
compteurs GL (par frame : `texImage2D`/`texSubImage2D` + `drawArrays`, 0
`bindTexture`) confirment le chemin fonctionnel à chaque rejeu.

**Régénérer la table GPU en place** : `bench/gpu/gpu-update-readme.js` agrège
les `bench/gpu/run-s<seed>.json` et remplace la table « GPU » du README
directement — équivalent de `--update-readme` côté GPU :

```bash
node bench/gpu/gpu-update-readme.js 100 200 300 400 500 600   # patche README.md (racine)
node bench/gpu/gpu-update-readme.js 100 200 300 400 500 600 --print-only
```

(ancré sur la ligne unique `| Appels GL par frame |` — la ligne `| Mesure |
perf10 | v… | Δ |` existe deux fois dans le README, table Chargement incluse.
Seule la table est régénérée : le bullet « Protocole figé » de la section
« Lecture des résultats » reste curé car il documente protocole et sessions.)

## Historique du dépôt

```
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

- `patches/` : 20 patches individuels (un par optimisation), chacun applicable
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
