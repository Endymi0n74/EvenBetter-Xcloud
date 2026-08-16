# better-xcloud-perf — v1.7.0

[![Release](https://img.shields.io/github/v/release/Endymi0n74/better-xcloud-perf?style=for-the-badge&color=green)](https://github.com/Endymi0n74/better-xcloud-perf/releases/latest)
[![Install](https://img.shields.io/badge/Install-userscript-blue?style=for-the-badge)](https://github.com/Endymi0n74/better-xcloud-perf/releases/latest/download/better-xcloud.user.js)

Fork performance du userscript [Better xCloud](https://github.com/redphx/better-xcloud)
(redphx), orienté **performance**. Dernière release :
[better-xcloud-perf-v1.7.0](https://github.com/Endymi0n74/better-xcloud-perf/releases/tag/better-xcloud-perf-v1.7.0).

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
| 21 | `stream.video.codecProfile` : évaluation **paresseuse + mémoïsée** | `RTCRtpReceiver.getCapabilities("video")` (667 ms à froid = 96 % du eval de démarrage dans un Edge neuf) n'est plus appelé au chargement — options/unsupported/suggest sont calculés à la 1re lecture réelle (ouverture des settings / validation d'une valeur) puis mis en cache (constant par navigateur). Éval de page à froid 656,8 → 32,9 ms (**−95 %**), warm 26,5 → 24,2 ms (**−8,7 %**) |

L'historique perf1–perf10 (Set O(1) du patcher, debounce localStorage, cache
`getBattery()`, uniform locations pré-calculées, etc.) est conservé dans
l'en-tête du script.

## Benchmarks

Mesures **perf10 (baseline)** vs **v1.3.0**, même machine (Windows, Edge
headless, Node V8), harnais jetables dédiés. L'objectif n'est pas la précision
absolue mais la comparaison relative entre les deux builds.

### Chargement (parse + éval de page)

| Mesure | perf10 | v1.6.0 | v1.7.0 | Δ v1.7.0 vs perf10 |
|---|---|---|---|---|
| Parse/compile (Node `new Function`, ×300/passe, médiane de 3 passes) | ~0,11–0,12 ms | ~0,10–0,11 ms | ~0,12 ms | non mesurable : bruit sub-ms ±10–20 % |
| Éval complète de page (Edge headless, `document-start`, 20 runs, médiane — pile RTC chaude) | 26,5 ms (min 23,7) | ~25 ms (min 22) | **24,2 ms** (min 21,1) | **−8,7 %** |
| Éval complète de page **à froid** (navigateur neuf par run, 1er chargement — pile RTC froide, médiane 8 runs) | 656,8 ms (min 597,5) | ≈ perf10 (même appel eager) | **32,9 ms** (min 27,9) | **−95 %** |

**Sessions startup — état** (éval page à froid, navigateur neuf par run — le one-shot RTC est par-process, le build ~30 ms est stable ; **état dérivé du perf10** : `bas` = perf10 ≤ 620 ms — init RTC nominale ; `haut` = perf10 > 620 ms — machine chargée (c'est perf10, pas le build, qui porte la dérive d'environnement). Bornes CI : build ≤ 50 ms (échec = coût one-shot revenu au chargement), perf10 dans [300, 1200] ms.)

| Session | perf10 éval (ms) | build éval (ms) | Δ perf10/build | État | Statut |
|---|---|---|---|---|---|
| Nuit 15 août (8 runs) | 656,8 | 32,9 | −95,0 % | haut | ✅ |
| Matin 16 août (8 runs) | 572,4 (541–581) | 31,3 (26–34,5) | −94,5 % | bas | ✅ |
| Midi 16 août (5 runs) | 587,8 (577–623) | 31,9 (31–43) | −94,6 % | bas | ✅ |
| Après-midi 16 août (20 runs) | 566,1 (531–712) | 29,8 (23–37,6) | −94,7 % | bas | ✅ |
| CI 16 août (dispatch) | 567,7 (529–689) | 31,9 (27,5–38,8) | −94,4 % | bas | ✅ |
| CI 16 août (PR #6) | 594,4 (551,2–717,4) | 29,9 (24,3–40,6) | −95,0 % | bas | ✅ |
| CI 16 août (PR #7) | 650,5 (604,0–838,7) | 36,6 (27,9–54,5) | −94,4 % | haut | ✅ |
| CI 16 août (dispatch validation) | 609,9 (553,1–824,5) | 29,3 (22,8–41,3) | −95,2 % | bas | ✅ |
| CI 16 août (dispatch, après merge) | 576,0 (528,9–639,0) | 27,1 (22,8–34,8) | −95,3 % | bas | ✅ |

La série perf11 (re-mesurée sur le build v1.6.0 officiel) visait le **runtime**
(hot loops, GPU, caches), pas le chargement — confirmé v1.6.0 : coût de démarrage identique.

**v1.7.0 attaque enfin le chargement** : `stream.video.codecProfile` était évalué
au chargement (options statiques des définitions), et `RTCRtpReceiver.getCapabilities("video")`
coûte **667 ms à froid** (96 % du eval document-start) dans un Edge neuf — l'init de la
pile RTC est synchrone et bloquante. L'évaluation est maintenant **paresseuse** (1re
lecture réelle : rendu des settings ou validation d'une valeur) et **mémoïsée** (le
résultat est constant par navigateur ; `validateValue`/`getValueText` relisent le cache).
Les gardes de `patchRtcCodecs`/`patchRtcPeerConnection` lisent la valeur stockée brute
(déjà validée par le getter `settings`) — le cas « aucune valeur stockée » ne déclenche
plus l'appel au chargement, la sémantique est inchangée (valeur invalide → `default`).
Gain mesuré : **−95 % à froid** (656,8 → 32,9 ms), **−8,7 % à chaud** (26,5 → 24,2 ms).

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

_Table v1.6.0 mesurée en **état bas CPU** (ratio IDLE perf10/build ×11,2) — cf.
tableau « Sessions hot loops » ci-dessous pour la comparabilité inter-sessions.
Depuis la v1.6.0, `freeze.sh` capture l'état machine avant/après chaque seed
(`bench/state-cpu-s<seed>.*.json`, `--no-state` pour désactiver)._ 

**Sessions hot loops — état haut/bas** (état dérivé du **ratio IDLE**
perf10/build : `bas` = ratio ≥ ~10 — machine calme (perf10 IDLE ≤ ~340 ns) ;
`haut` = ratio ≤ ~9,5 — machine chargée (perf10 IDLE ≥ ~360 ns). Comme côté
GPU, un coût fixe d'environnement (charge CPU, clocks, contention) gonfle les
deux versions et écrase l'avantage du build — le ratio IDLE est le plus
sensible, le relâchement Home l'est moins (voir colonne). **Attribut de
session, pas du build** : le même code mesure ×9,5 en état haut et ×11,2 en
état bas. Données encore minces (3 sessions) — la capture d'état machine
alimentera la classification.

| Session | perf10 IDLE (ns/poll) | build IDLE (ns/poll) | Ratio IDLE | État | Relâchement Home (perf10 → build) |
|---|---|---|---|---|---|
| Re-mesure v1.4.0 (3 seeds) | 368 (352–398) | 39 (36–41) | **×9,5** | haut | 1427 → 163 (−89 %) |
| v1.6.0 (3 seeds, release) | ~333 (303–335) | ~29,8 (30–38) | **×11,2** | bas | ~1224 → ~152 (−87,6 %) |
| CI 2026-08-16 (hotloops, dispatch GPU) | 487,50 (458,00–487,80) | 49,70 (48,00–50,20) | **×9,81** | transitionnel | 1374,20 → 205,60 (−85 %) |
| CI 2026-08-16 (hotloops, PR #9) | 506,80 (502,80–530,70) | 46,70 (44,10–46,70) | **×10,85** | bas | 1439,50 → 207,30 (−86 %) |

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
> la session v1.5.0 (~61 µs pour le même code) — **dérive d'état machine
> inter-sessions** (backpressure/sync du pipeline vidéo/GPU, cf. tableau
> « Sessions GPU » ci-dessous et mémo projet §7) : un contrôle même-
> session avec la classe v1.5.0 mesure les mêmes bas absolus → v1.5.0 et
> v1.6.0 sont
> identiques sur le chemin GPU (updateFrame byte-identique), seuls les
> ratios intra-session (perf10 vs build) comptent.
> **Re-mesure v1.6.0 du soir (6 seeds, état machine capturé)** : upload perf10
> 42,2–77,7 (méd. 54,7) vs v1.6.0 7,7–11,8 (méd. 10,0) µs (**×5,47**) ;
> wallTotal **×2,82** ; draw 10,2 vs 9,2 µs — **état bas** (ratio ≥ 4),
> machine froide et peu chargée (GPU 50-53 °C, SM 1725 MHz / P0 constants,
> CPU load 22-69 %) — cohérent avec la session du soir. Split émission/sync
> (nouveau) : v1.6.0 emit 7,7–11,8 (stable) / sync 19,5–75,0 / total 29–84 µs
> selon le seed (contrôle seed 42 : ~31 µs, dans la fourchette basse) ;
> perf10 emit 42,2–77,7 / sync 69,7–112,0 / total 112–165 µs — la **sync
> readback est le composant volatile** (pas l'émission) : la prédiction
> « total stable » n'est pas confirmée (cf. tableau des sessions).
> **Corrélation état machine : négative** (6 seeds) — l’état capturé était
> quasi constant (SM 1725 MHz épinglé, temp 50-53 °C, puissance 48-57 W) et
> ne corrèle avec rien (|r| ≤ 0,68, non significatif à n=6). La variance de
> sync est **temporelle : effet première passe** — la 1re mesure upload de
> chaque seed a une sync élevée (65-239 µs) puis chute à 13-24 µs dès la
> 2e passe (5/6 seeds) ; le préchauffage (50 uploads) ne stabilise pas le
> readback (amélioration harnais à faire : préchauffer le readback).

| Mesure | perf10 | v1.6.0 | Δ |
|---|---|---|---|
| Appels GL par frame | `texImage2D` + `drawArrays` (0 allocation) | `texSubImage2D` + `drawArrays` (0 allocation) | même nombre d'appels |
| Upload vidéo — boucle tight (µs/upload) | ~42–78 µs | ~8–12 µs | **×5,5** |
| Rasterisation `drawArrays` (µs/draw, médiane GPU) | 10,2 µs | 9,2 µs | ×1,1 |
| `updateFrame` — wall total (ms/frame, boucle complète / FRAMES) | ~0,043–0,074 ms | ~0,011–0,020 ms | **×2,8** |

_Table v1.6.0 — re-mesure du soir (15 août), **état bas** (ratio upload
×5,47) — cf. tableau « Sessions GPU » ci-dessous pour la comparabilité
inter-sessions._

**Sessions GPU — état haut/bas** (état dérivé du **ratio upload** perf10/build :
`bas` = ratio ≥ ~4 — émission pure, l'avantage `texSubImage2D` ressort à plein ;
`haut` = ratio ≤ ~2,5 — un coût fixe de sync/backpressure (~50-70 µs/upload,
cf. mémo projet §7) masque l'avantage ; `transitionnel`/`mixte` entre les deux
ou quand la session contient les deux états). **L'état est un attribut de la
session, pas du build** : le même code mesure ×1,8-2,1 en état haut et
×4,3-6,6 en état bas — comparer deux sessions = comparer les ratios et le
draw, jamais les absolus.

| Session | Version | Upload perf10 (µs) | Upload build — émission (µs) | Ratio upload | État | Sync build (µs) | Total build (µs) | Draw (µs) | Borne | Statut |
|---|---|---|---|---|---|---|---|---|---|---|
| Origine (sans stabilisation) | v1.3.0 | 200–235 | 64–66 | ×3,3 | transitionnel | — | — | — | — | — |
| Session 1 (6 seeds stabilisés) | v1.4.0 | 80,5–93 | 43,8–50,3 | **×1,8** | haut | — | — | 10,2 | — | — |
| Session 2 (protocole figé) | v1.4.0 | 98,5–150,7 | 54,7–74,5 | **×2,1** | haut | — | — | 10,2 | — | — |
| Matin 15 août (6 seeds) | v1.5.0 | 61,8–137 | 10,3–76,8 | **×1,7** (s300 : ×6,0) | mixte | — | — | 10,2 | — | — |
| Soir 15 août (6 seeds) | v1.6.0 | 48,2–61,3 | 8,5–11,3 | **×4,86** | bas | — | — | 10,2 | émission ≤ 25,00 µs · wall ≤ 0,10 ms · draw ≤ 25,00 µs | ✅ |
| Soir 15 août — re-mesure (6 seeds + état machine) | v1.6.0 | 42,2–77,7 | 7,7–11,8 | **×5,47** | bas | 24,5 (19,5–75) | **33,3** (29–83,8) | 10,2 vs 9,2 | émission ≤ 25,00 µs · wall ≤ 0,10 ms · draw ≤ 25,00 µs | ✅ |
| Nuit 15 août — phase capturée (6 seeds) | v1.6.0 | 57,25 (51,25–60,50) | 11,00 (9,00–11,75) | **×5,20** | bas | 16,75 (15,00–26,25) | **26,25** (25,25–34,25) | 11,26 vs 10,24 | émission ≤ 25,00 µs · wall ≤ 0,10 ms · draw ≤ 25,00 µs | ✅ |
| CI 15 août (6 seeds, runner self-hosted Windows/GPU) | v1.6.0 | 47,50 (45,50–52,50) | 10,00 (8,25–11,75) | **×4,75** | bas | 17,25 (14,75–25,25) | **26,75** (24,25–35,50) | 10,24 vs 10,24 | émission ≤ 25,00 µs · wall ≤ 0,10 ms · draw ≤ 25,00 µs | ✅ |
| CI 2026-08-16 (6 seeds) | v1.6.0 | 53,75 (47,75–79,00) | 11,25 (9,50–44,75) | **×4,78** | bas | 25,50 (15,25–64,00) | **35,50** (25,75–110,75) | 10,24 vs 10,24 | émission ≤ 25,00 µs · wall ≤ 0,10 ms · draw ≤ 25,00 µs | ✅ |

_Colonnes **Borne**/**Statut** : bornes absolues du build (émission ≤ 25 µs, wall ≤ 0,10 ms, draw ≤ 25 µs — calibrées sur le runner CI). Les sessions antérieures au split émission/sync ou en état haut/mixte (absolus non comparables, « seuls les ratios comptent ») sont marquées « — ». Générées par `check-gpu.js` (`--update-readme`)._

_Split émission/sync (readback `readPixels`, cf. bench/gpu/README.md) mesuré
seulement depuis la re-mesure du soir (gpu-runner.js v2) — les sessions
antérieures n'ont que l'émission (uploadNs historique = colonne « Upload
build — émission »). **Prédiction « total stable » (backpressure) : non
confirmée** — la **sync readback est le composant volatile** (v1.6.0 :
19,5–75,0 µs selon le seed, total 29–83,8 µs ; perf10 : sync 69,7–112,0,
total 111,7–165,5 µs) alors que l'émission reste stable (7,7–11,8 µs). La
bimodalité (état haut/bas) s'exprime donc dans la sync readback ET dans
l'émission selon les sessions, pas comme un total stable — à affiner avec
une session en état haut._

_Rejouabilité inter-sessions (soir → re-mesure, mêmes seeds 100-600,
même build) : ratios de médianes reproductibles à ~±15 % (upload ×4,86 →
×5,47, wall ×3,00 → ×2,82, draw v1.6.0 10,2 → 9,2) ; absolus par seed
±10-30 % (méd. |Δ| 11-23 %) ; ratios par seed ±20-37 % (les seeds
individuels ne sont pas stables, seule l’agrégat compte) ; le draw perf10
anomal (15,4 µs) n’est pas reproductible (artéfact ponctuel)._

Lecture des résultats :

- Le **draw** (rasterisation) coûte pareil dans les deux versions (10,2 vs
  9,2 µs, ratio 1,1) — même shader, même résolution : attendu.
- Le vrai levier est l'**upload vidéo** : `texImage2D` **réalloue le storage
  GPU de la texture à chaque frame** (~×2,1 le coût d'un `texSubImage2D` dans
  un storage immuable). C'est le bénéfice mesurable des patches 13/16 côté GPU
  — invisible dans les micro-benchmarks JS (d'où l'écart avec la table
  « Hot loops » ci-dessus).
- Le wall de `updateFrame` suit (~×2,8 sur la re-mesure avec la métrique
  `wallTotal` stabilisée sur v1.6.0) : la partie synchronisée du chemin
  d'upload domine la frame.
- **Protocole figé** (cf. Repro — seeds 100/200/300/400/500/600 × 3 passes,
  commandes exactes) : re-mesure complète — upload perf10 98,5 / 113,5 /
  119,0 / 136,5 / 139,0 / 150,7 µs vs v1.4.0 54,7 / 58,2 / 62,8 / 65,2 /
  69,3 / 74,5 µs (médiane des médianes : 136,5 vs 65,2 µs, **×2,1**) ;
  wallTotal 0,097–0,136 vs 0,059–0,085 ms (**×1,5**) ; draw 0,01024 ms
  (**10,2 µs**) identique partout (un seed perf10 à 9,2 µs — état driver).
  **Deuxième session indépendante** du même protocole (mêmes seeds, mêmes
  commandes) : absolus décalés (session 1 : 80,5–93 / 43,8–50,3 µs) mais
  **draw, compteurs GL et ratios identiques** — la rejouabilité porte sur le
  draw, les compteurs et les ratios, pas sur les absolus (drift d'état
  machine inter-sessions documenté, cf. tableau « Sessions GPU »).
  **Re-mesure v1.6.0** du même protocole (mêmes seeds 100–600, même jour
  que la release) : upload 48–61 vs 8–11 µs (**×4,86**, état **bas**),
  wallTotal 0,052 vs 0,017 ms (**×3,00**), draw 10,2 µs identique partout —
  cf. le tableau « Sessions GPU » ci-dessus. **Re-mesure (soir, mêmes
  seeds)** : upload 42,2–77,7 vs 7,7–11,8 µs (**×5,47**, état **bas**),
  wallTotal **×2,82**, draw 10,2 vs 9,2 µs — même état que la session du
  soir (machine froide, cf. note ci-dessus).

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
