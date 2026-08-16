# bench/gpu/ — harnais GPU (renderer WebGL2, mesures réelles)

Mesures **perf10 (baseline `055d3a0`)** vs **build v1.4.0** du renderer
`WebGL2Player` dans un **vrai contexte WebGL2** : compteurs d'appels GL
(instrumentation) et rasterisation mesurée par GPU timestamp
(`EXT_disjoint_timer_query_webgl2`). C'est la source de la table « GPU » du
chapitre Benchmarks du README principal.

## Prérequis

- **Node** + **Playwright** avec le canal **Edge `msedge`** (`npm i -D
  playwright`, ou `NODE_PATH` vers un install existant, ex.
  `export NODE_PATH=/d/Codex/koharu/node_modules`).
- **GPU réel** : Edge headless conserve le GPU (renderer observé :
  « ANGLE (NVIDIA, … D3D11) ») — pas besoin de `--headed`, mais une machine
  avec GPU actif est requise.
- **Vidéo de test** (`test.webm`, **non versionnée** — cf. `.gitignore`) :
  générée en navigateur car le ffmpeg de Playwright n'a pas `lavfi`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `gen-video.js` | Génère `test.webm` (640×360, VP9, ~4,5 s) en navigateur |
| `extract-class.js` | Extrait `class WebGL2Player` d'un build minifié (parenthésage string-aware pour les shaders) |
| `gpu-perf10-webgl2player.txt` | Classe extraite de la baseline perf10 |
| `gpu-v140-webgl2player.txt` | Classe extraite du build v1.4.0 (contient déjà `gl.RGB8`) |
| `gpu-v150-webgl2player.txt` | Classe extraite du build v1.5.0 (idem v1.4.0 + cache uniforms `updateCanvas` — chemin GPU identique, re-mesure ×2,10/×1,49) |
| `gpu-v160-webgl2player.txt` | Classe extraite du build v1.6.0 (idem v1.5.0 + flag dirty `updateCanvas` — `updateFrame` et shader octet pour octet identiques, table GPU v1.4.0/v1.5.0 valide) |
| `gpu-v170-webgl2player.txt` | **Prototype candidat v1.7.0** : classe v1.6.0 avec le chemin USM du fragment shader remplacé — gaussienne 3×3 exacte en 4 échantillons bilinéaires (±0,5 texel) au lieu de 9 fetches. Seed 42 : draw GPU 10,24 → 7,17 µs (−30 %), ratio perf10/build 1,43. Non intégré au build (prototype à valider visuellement) |
| `gpu-v130-webgl2player.txt` | Classe v1.3.0 (historique, bug `gl.RGB` non corrigé) |
| `gpu-runner.js` | Harnais : serveur local, injection, instrumentation GL, GPU timestamps, agrégation par seed — upload décomposé **émission** (boucle tight) vs **sync** (readback `readPixels`) |
| `machine-state.js` | Capture l'état machine avant/après chaque seed (GPU nvidia-smi : temp/util/clocks/puissance/P-state ; CPU : charge %, % de la fréquence de base si compteurs perf OK, fréquence base via WMI ; top 5 processus) — JSON tolérant (outil absent → champ null) |
| `agg-seeds.js` | Agrège les runs (`run-s<seed>.json`) : min / max / médiane des médianes + ratios, et affiche l'état machine par seed (corrélation état haut/bas des uploads) |
| `gpu-update-readme.js` | Régénère la table « GPU » du README en place |
| `check-gpu.js` | CI : vérifie upload/wallTotal/draw (seuils) + chemin GL fonctionnel (compteurs) ; résumé markdown + **ligne de session** (état haut/bas + date, prête à coller dans le tableau « Sessions GPU » du README) + exit code |

## Setup (une fois)

```bash
# 1. Vidéo de test (test.webm est gitignoré)
node bench/gpu/gen-video.js bench/gpu/test.webm

# 2. (Optionnel) ré-extraire les classes depuis les builds
git show 055d3a0:better-xcloud.user.js > /tmp/perf10.js
node bench/gpu/extract-class.js /tmp/perf10.js bench/gpu/gpu-perf10-webgl2player.txt
node bench/gpu/extract-class.js better-xcloud.user.js bench/gpu/gpu-v140-webgl2player.txt
```

## Protocole figé (rejouer la table « GPU » telle quelle)

**En une commande** (équivalent local du job CI `gpu-upload` — même chaîne
que le workflow : gen-video → 6 seeds × gpu-runner → agg-seeds → check-gpu) :

```bash
./bench/gpu/run-gpu-ci.sh                     # protocole complet (≈30–40 min)
./bench/gpu/run-gpu-ci.sh --seeds="100 200"   # sous-ensemble (test rapide)
```

Canal auto-détecté (`msedge` Windows / `chromium` Linux), Playwright requis
(`NODE_PATH` vers un install existant sinon), `--no-fix` par défaut (mesure
strictement le build publié), vidéo régénérée si absente (`--keep-video`
pour réutiliser, `--force-video` pour forcer). `agg-seeds.js` accepte
`--label-new=` (défaut `v1.4.0`) — permet de mesurer un autre build (ex.
v1.5.0) avec `--cls-new=... --label-new=v1.5.0`. Les `run-s*.json` produits
sont conservés (gitignorés) pour relancer l'agrégation/vérification sans
re-mesurer.

**`--resume`** : saute les seeds dont `run-s<seed>.json` est **déjà complet**
(JSON valide, `agg` avec les 2 versions — dont le label demandé — et toutes
les passes terminées). Un fichier partiel (run timeout, JSON corrompu) ou
avec un label incohérent (ex. fichiers mesurés avec `--label-new=v1.4.0`
mais relance avec `v1.5.0`) est **re-mesuré** — après un run interrompu, seuls
les seeds manquants/corrompus sont re-mesurés, les autres sont skippés.
Validé : skip 6/6 sur jeu complet, re-mesure ciblée sur fichier manquant et
sur label incohérent.

**État machine par seed** (activé par défaut, `--no-state` pour désactiver) :
avant et après chaque seed, `machine-state.js` écrit
`state-s<seed>.before.json` / `state-s<seed>.after.json` (gitignorés) — GPU
via `nvidia-smi` (température, utilisation, clocks SM/mémoire, puissance,
P-state) et CPU (charge %, % de la fréquence de base si les compteurs perf
sont enregistrés — désactivés sur la machine de bench → repli
`Win32_Processor.LoadPercentage` ; fréquence de base via WMI ; top 5
processus en temps CPU cumulé). Objectif : corréler l'état « haut »/« bas »
des uploads GPU (backpressure/sync du pipeline — mémo projet §7) avec l'état
réel de la machine au moment de la mesure. `agg-seeds.js` affiche la capture
« avant » de chaque seed à côté des ordres de passes.

**Décomposition upload : émission vs sync** (runs récents) : `uploadNs` garde
sa sémantique historique (boucle tight d'émission seule) ; `uploadEmitNs` =
même mesure (alias) ; `uploadSyncNs` = **readback** `gl.readPixels(1×1)`
timé après la file émise (÷ `UPLOADS`) — l'ordre GL garantit que les uploads
précédents sont exécutés avant la lecture ; `uploadTotalNs` = émission + sync
(coût réel par upload). Pièges vécus sur ce stack : `gl.finish()` est un quasi
no-op sous ANGLE/D3D11 (~0 µs) et `fenceSync` + `clientWaitSync` **ne signale
jamais** (timeout 5 s même après les 400 uploads) → `readPixels` est la seule
sonde de complétion fiable. Interprétation : une sync significative
(15-110 µs/upload sur un seed de contrôle) montre que les uploads ont un vrai
travail GPU différé — `uploadNs` (émission seule) **sous-estime le coût total**.
Prédiction à vérifier sur une session avec état « haut » : la backpressure
doit gonfler l'**émission** (blocage CPU dans l'appel d'upload) et dégonfler la
sync (travail déjà fait) → **total stable** — à croiser avec l'état machine
(capture ci-dessus). `agg-seeds.js` affiche le split par version
(`upload split (médianes) : emit … / sync … / total … us`).

**Préchauffage du readback** (depuis le fix du spike de 1re passe) : avant la
mesure timée, 2 cycles de « 100 uploads émis + readPixels drain + flush »
(réutilise la même sonde, délai 25 ms entre les cycles) pour que le chemin de
complétion GPU soit chaud. **Validation sur les 6 seeds du protocole** (sync
v1.6.0 en µs, par ordre d'apparition) :

| | Avant (re-mesure) | Après (avec préchauffage) |
|---|---|---|
| 1re sync de chaque seed | 65 – 239 (méd. 77) | 37 – 68, avec un outlier à 190,7 (méd. ~49) |
| Syncs suivantes | 13 – 75 (souvent « mixte ») | 12,5 – 26,3 (méd. 15-16) |
| Médiane des médianes par seed | 23,3 | 16,8 – 18,0 |

Le fix **divise par ~2 la médiane du spike de 1re passe** (méd. 77 → ~49) mais
**n'élimine pas les extrêmes** : sur le 2e run du protocole, s300 a mesuré
190,7 µs en 1re passe malgré le préchauffage — le spike est réduit en médiane,
pas en queue. L'état stable (passes suivantes) est inchangé (12,5-26,3 µs).
Conséquence pratique : les médianes de seeds sont resserrées (16,8-18,0 vs
23,3 à la re-mesure), mais un seed isolé peut encore sortir haut si sa 1re
passe tombe sur le spike (s300 : 2 passes hautes sur 3 → médiane 47,7-190,7).

**Capture de la phase du pipeline vidéo** (depuis le test de l’hypothèse
temporelle) : chaque passe enregistre 4 snapshots du décodeur — `videoPhase`
{ frames, emit0, emit1, sync1 } — avec `currentTime`, `readyState`,
`droppedFrames`/`totalFrames` (getVideoPlaybackQuality) et le compteur/mediaTime
de la dernière frame présentée (requestVideoFrameCallback).
**Résultat (6 seeds, 36 passes) : l’hypothèse « phase du pipeline vidéo » est
RÉFUTÉE au niveau de la présentation de frames** — (a) la fraîcheur de la
dernière frame à l’entrée de chaque mesure est uniforme (0,0-0,3 ms) ; (b) le
décodeur est **figé pendant la fenêtre de mesure** : 0 frame présentée et
currentTime constant sur 36/36 fenêtres de 10-82 ms (la boucle synchrone
émission+readPixels bloque la présentation — le harnais mesure donc toujours
dans le même état vidéo) ; (c) aucune corrélation sync ↔ phase (r ≤ 0,09 pour
la fraîcheur, -0,44 pour mediaTime = proxy de la position de passe). La
variance dominante reste la 1re mesure de chaque seed (effet contexte
GPU/driver, pas vidéo).

Commandes équivalentes, à la main :

```bash
cd <racine du repo>
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

Canal navigateur : `--channel=msedge` par défaut (Windows, GPU via
ANGLE/D3D11) ; **`--channel=chromium`** pour Linux/CI (Chromium fourni par
Playwright — le générateur de vidéo accepte le même flag :
`node bench/gpu/gen-video.js bench/gpu/test.webm --channel=chromium`).

Règles d'agrégation : chaque run imprime l'`agg` par version (médiane sur
les 3 passes de l'upload, du wallTotal et du draw) ; `agg-seeds.js` agrège
les 6 seeds (min / max / médiane des médianes par métrique) et les ratios.
`--no-fix` mesure **strictement le build publié** (la classe v1.4.0 contient
déjà `gl.RGB8` — le correctif du runner ne s'applique qu'aux builds ≤ v1.3.0
qui contiennent encore `gl.RGB`). Les `run-s*.json` sont gitignorés
(artefacts transitoires).

**Régénérer la table GPU du README en place** :

```bash
node bench/gpu/gpu-update-readme.js 100 200 300 400 500 600   # patche README.md (racine)
node bench/gpu/gpu-update-readme.js 100 200 300 400 500 600 --print-only  # affiche seulement
```

L'updater est **ancré sur la ligne unique `| Appels GL par frame |`** : la
ligne `| Mesure | perf10 | v… | Δ |` existe deux fois dans le README (table
Chargement + table GPU) — un regex non ancré supprimerait tout le bloc
intermédiaire. Seule la table est régénérée ; le bullet « Protocole figé »
de la section « Lecture des résultats » reste curé (il documente le protocole
et les sessions, pas seulement des nombres).


## Candidat v1.7.0-proto — draw GPU du shader (mesure seed de contrôle)

Le draw GPU (10,24 µs à 640×360 dans toutes les sessions) est la dernière
partie du hot path jamais touchée : le shader est resté octet pour octet
identique à perf10. Le filtre USM par défaut fait 9 fetches texture par pixel.
Une gaussienne 3×3 [1,2,1;2,4,2;1,2,1]/16 est **exactement** la somme de 4
échantillons bilinéaires aux milieux des arêtes (chaque tap = moyenne 2×2,
Σ/4 = (a+2b+c+2d+4e+2f+g+2h+i)/16) — vérifié bit-identique en fp64
(100k tirages). `gpu-v170-webgl2player.txt` porte cette variante (CAS et
qualityMode inchangés).

Reproduction (2 runs back-to-back, même seed, même ancre perf10) :

```bash
# référence v1.6.0
node bench/gpu/gpu-runner.js --seed=42 --no-fix \
  --cls-new=bench/gpu/gpu-v160-webgl2player.txt --label-new=v1.6.0 \
  > /tmp/run-s42-v160.json 2>&1
# candidat v1.7.0-proto
node bench/gpu/gpu-runner.js --seed=42 --no-fix \
  --cls-new=bench/gpu/gpu-v170-webgl2player.txt --label-new=v1.7.0-proto \
  > /tmp/run-s42-v170.json 2>&1
```

Résultat (16 août, soirée, upload en état haut ×1,8 — le draw n'en dépend pas) :

| Mesure seed 42 | perf10 | build | Ratio |
|---|---|---|---|
| draw GPU (réf. v1.6.0) | 10,24 µs | 10,24 µs | 1,00 |
| draw GPU (v1.7.0-proto) | 10,24 µs | **7,17 µs** | **1,43** |
| wall updateFrame (ms) | 0,10 | ~0,00 | inchangé |
| upload émission/sync (µs) | 74,5 / 90,3 | 41,8 / 59,8 | inchangé |

Le gain est strictement GPU-side (compteurs GL identiques : texSubImage2D 1,
drawArrays 1, 0 uniform/frame). À 1080p (9× les pixels) il extrapole ~30 µs/frame.
Intégration au build = patch 21 (v1.7.0) après validation visuelle du rendu.
## Pièges du harnais

- **Wrapper GL** : les méthodes instrumentées doivent **`return orig(...)`**
  (sinon `createTexture()` renvoie `undefined` → « no texture bound »).
- **Timing GPU** : Edge/ANGLE n'expose pas `createQueryEXT` sur
  `EXT_disjoint_timer_query_webgl2` → utiliser l'API native `gl.createQuery()`
  + `gl.beginQuery(ext.TIME_ELAPSED_EXT, q)` + `gl.endQuery(...)`, résultats
  lus via `getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE / QUERY_RESULT)`.
- **Unités** : `uploadNs`, `uploadEmitNs`, `uploadSyncNs`, `uploadTotalNs`
  sont en **ns** (→ ÷1000 pour µs) ; `gpuMed` est en **ms** (→ ×1000 pour µs).
  `agg-seeds.js` applique ces conversions (SCALE par métrique) — les versions
  antérieures affichaient les valeurs brutes sous de mauvaises étiquettes.
- **Rejouabilité** : la rejouabilité porte sur le **draw, les compteurs GL et
  les ratios** — les absolus (upload, wallTotal) varient ~±10–30 % entre
  sessions (drift d’état machine — backpressure/sync du pipeline vidéo/GPU,
  mémo projet §7) et entre seeds d'une même session. Les
  outliers « première passe » (ex. draw perf10 à 15,4 µs ou upload ~10 µs
  ponctuels, état driver) sont absorbés par la médiane sur 6 seeds — d'où
  l'exigence de **6 seeds** pour la table publiée, pas 1-2.
- `readPixels` sur une texture ≥ dimensions de la vidéo (sinon
  « Offset overflows texture dimensions »).
- `WEBGL_debug_renderer_info` pour identifier le renderer.

## CI GPU (optionnel, workflow_dispatch)

Le job `gpu-upload` de `.github/workflows/bench.yml` rejoue le protocole sur
un **runner self-hosted avec GPU** (labels `self-hosted`, `linux`, `gpu` —
les runners GitHub hébergés n'ont pas de GPU), lancé manuellement via
`workflow_dispatch` + input `gpu` : installation Playwright (Chromium +
dépendances système), génération de `test.webm`, 6 seeds × 3 passes
(`--channel=chromium`), agrégation, puis `check-gpu.js`.

`check-gpu.js` échoue le job si : upload ratio perf10/build < `--upload-min`
(défaut **1,3** — Windows observe 1,5-2,2, plancher bas car machine/driver
CI inconnus), wallTotal < `--wall-min` (1,2), draw hors `--draw-min/--draw-max`
(0,5-2,0), ou **chemin GL non fonctionnel** (le build récent doit uploader par
`texSubImage2D` avec 0 `texImage2D` — un revert du patch 13/16 est détecté
même sans régression de timing). **Bornes absolues du build** (garde-fou : le
ratio perf10/build peut passer même si le build régresse, quand perf10 régresse
aussi — ex. driver ou harnais ; un build qui remonte vers le niveau perf10
échappe au ratio) : émission upload ≤ `--build-upload-max` (défaut **25 µs** —
nominal ~10 sur le runner CI), wallTotal ≤ `--build-wall-max` (défaut
**0,10 ms** — nominal ~0,015) et draw ≤ `--build-draw-max` (défaut **25 µs** —
nominal ~10,2 ; couvre une régression de shader qui ralentirait les DEUX
versions : le ratio draw resterait ~1,0 et passerait sans cette borne). Calibrées sur le runner CI ; les flags
permettent de les élargir pour une session locale en état haut. **Comparables
en état bas uniquement** (doctrine du projet, validé en réel le 16 août) : en
état haut/transitionnel, le coût fixe de backpressure (~50-70 µs/upload)
gonfle les absolus du build — l'émission mesurée 52 µs (ratio ×1,63, haut)
déclenchait un faux positif. Les bornes passent alors en **n/a non bloquant**
(seuil « n/a », session marquée `— | —` pour Borne/Statut) : les ratios
restent les seuls garants dans ces états. Le résumé
markdown (`--markdown=`) contient en plus la **ligne de session** — date
(capture `state-s<seed>.before.json` du 1er seed, sinon date courante), plages
upload, ratio, **état** (bas ≥ ×4 / haut ≤ ×2,5 / transitionnel, mêmes seuils
que le README), draw et les colonnes **Borne**/**Statut** (les 3 bornes
absolues du build et leur résultat ✅/❌ — même principe que la table
Sessions startup) — prête à coller telle quelle dans le tableau « Sessions
GPU » du README. Le workflow capture l'état machine avant/après chaque seed et
upload `gpu-summary.md` en artefact (`gpu-summary-<sha>`) en plus des
`run-s*.json` en cas d'échec. Les seuils sont ajustables au premier run sur une
machine réelle :
`node bench/gpu/check-gpu.js 100 200 300 400 500 600
[--upload-min=…] [--wall-min=…] [--draw-min=…] [--draw-max=…]
[--build-upload-max=…] [--build-wall-max=…] [--build-draw-max=…]`.

Le harnais CPU (parse, hot loops, éval page) vit dans `bench/` — voir
`bench/README.md`. La section « Repro » du README principal documente les
deux protocoles.
