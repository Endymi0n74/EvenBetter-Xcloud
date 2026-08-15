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
| `gpu-v130-webgl2player.txt` | Classe v1.3.0 (historique, bug `gl.RGB` non corrigé) |
| `gpu-runner.js` | Harnais : serveur local, injection, instrumentation GL, GPU timestamps, agrégation par seed |
| `agg-seeds.js` | Agrège les runs (`run-s<seed>.json`) : min / max / médiane des médianes + ratios |
| `gpu-update-readme.js` | Régénère la table « GPU » du README en place |
| `check-gpu.js` | CI : vérifie upload/wallTotal/draw (seuils) + chemin GL fonctionnel (compteurs) ; résumé markdown + exit code |

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

## Pièges du harnais

- **Wrapper GL** : les méthodes instrumentées doivent **`return orig(...)`**
  (sinon `createTexture()` renvoie `undefined` → « no texture bound »).
- **Timing GPU** : Edge/ANGLE n'expose pas `createQueryEXT` sur
  `EXT_disjoint_timer_query_webgl2` → utiliser l'API native `gl.createQuery()`
  + `gl.beginQuery(ext.TIME_ELAPSED_EXT, q)` + `gl.endQuery(...)`, résultats
  lus via `getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE / QUERY_RESULT)`.
- **Unités** : `uploadNs` est en **ns** (→ ÷1000 pour µs) ; `gpuMed` est en
  **ms** (→ ×1000 pour µs). `agg-seeds.js` applique ces conversions (SCALE
  par métrique) — les versions antérieures affichaient les valeurs brutes
  sous de mauvaises étiquettes.
- **Rejouabilité** : la rejouabilité porte sur le **draw, les compteurs GL et
  les ratios** — les absolus (upload, wallTotal) varient ~±10–30 % entre
  sessions (drift des clocks GPU) et entre seeds d'une même session. Les
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
même sans régression de timing). Les `run-s*.json` sont uploadés en artefact
en cas d'échec. Les seuils sont ajustables au premier run sur une machine
réelle : `node bench/gpu/check-gpu.js 100 200 300 400 500 600
[--upload-min=…] [--wall-min=…] [--draw-min=…] [--draw-max=…]`.

Le harnais CPU (parse, hot loops, éval page) vit dans `bench/` — voir
`bench/README.md`. La section « Repro » du README principal documente les
deux protocoles.
