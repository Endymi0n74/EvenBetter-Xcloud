# bench/ — harnais de benchmark CPU

Mesures **perf10 (baseline `055d3a0`)** vs **build courant** (`better-xcloud.user.js`
à la racine du repo). Tout se lance d'un coup :

```bash
./bench/run-all.sh                 # les 3 harnais
./bench/run-all.sh --skip-page-eval # sans Playwright/Edge
```

Prérequis : Node. Pour l'éval page : Playwright + Edge (canal `msedge`) — installer
avec `npm i -D playwright` ou pointer `NODE_PATH` vers un install existant.

| Fichier | Mesure | Environnement |
|---|---|---|
| `parse.js` | Parse/compile (`new Function`, sans exécution, ×300/passe) | Node V8 |
| `hotloops.js` | Hot loops injectés ~60 Hz (controller, poll_gamepad, updateFrame, updateCanvas) | Node V8 |
| `page-eval.js` | Éval complète de page, injection au document-start, 20 runs | Edge headless + Playwright |
| `freeze.sh` | Rejoue le protocole figé (3 seeds × 3 passes) et formate les tableaux markdown du README | Node V8 (+ Edge si `--with-page-eval`) |
| `check-ratios.js` | CI : parse la sortie de `run-all.sh --skip-page-eval` et échoue si un ratio de hot loop régresse au-delà de son seuil | Node V8 (workflow `.github/workflows/bench.yml`) |

`hotloops.js` et `parse.js` sont stabilisés (même recette que le harnais GPU) :

- **Préchauffage explicite** en 2 phases puis `global.gc()` avant le chrono —
  l'équivalent CPU du `flush()` GPU. Nécessite `node --expose-gc` (fait par
  `run-all.sh`) : sans le flag, la poubelle du warmup est purgée pendant la
  mesure et fausse le chrono. Tailles adaptées à chaque harnais (hotloops :
  5 000 + 10 000 itérations à ~ns/op ; parse : 10 + 20 compiles à ~130 µs/op).
- **Runs croisés par seed** : l'ordre des mesures (version × scénario/passe)
  est mélangé par un PRNG déterministe (`--seed=N`, mulberry32) pour qu'aucune
  version ne soit systématiquement mesurée en premier/dernier.
- **Médiane / min / max sur `--passes` passes** (défaut 3) — absorbe les
  outliers (tier-up JIT, GC ponctuel).

Usages :

```bash
node --expose-gc bench/hotloops.js <perf10.js> <build.js> [--passes=N] [--seed=N] [--iters=N]
node --expose-gc bench/parse.js  <perf10.js> <build.js> [--passes=N] [--seed=N] [--iters=N]
```

`parse.js` chronomètre par itération en `process.hrtime.bigint()` (résolution
ns) : à ~130 µs/compile, `performance.now()` n'est pas assez fin pour une
mesure par itération fiable. Le `p95` de parse capture les outliers GC
(absorbés par la médiane) ; l'écart perf10/build est dans le bruit inter-seed
(≈ ±10-20 % run à run) — le protocole le montre au lieu de figer un chiffre.

## Protocole figé (tables du README principal)

Les tables « Hot loops » et « Chargement » du README sont produites par ces
**commandes exactes** (builds : baseline perf10 `055d3a0` extraite de git vs
`better-xcloud.user.js` de la racine) — c'est le protocole à rejouer tel quel
pour comparer :

```bash
# 1. Préparer les builds
TMP=$(mktemp -d)
git show 055d3a0:better-xcloud.user.js > "$TMP/perf10.js"
cp better-xcloud.user.js "$TMP/build.js"

# 2. Hot loops : 3 seeds × 3 passes × 200 000 itérations
for S in 42 2024 999; do
  node --expose-gc bench/hotloops.js "$TMP/perf10.js" "$TMP/build.js" \
    --passes=3 --seed=$S --iters=200000
done

# 3. Parse/compile : mêmes seeds, ×300 itérations/passe
for S in 42 2024 999; do
  node --expose-gc bench/parse.js "$TMP/perf10.js" "$TMP/build.js" \
    --passes=3 --seed=$S --iters=300
done

# 4. Éval page : 20 runs, médiane/p95
node bench/page-eval.js "$TMP/perf10.js" "$TMP/build.js"
```

Règles d'agrégation pour les tables :

- Chaque run imprime **médiane / min / max sur les `--passes`** (3 par défaut).
- Les tables prennent ensuite la **médiane des médianes** sur les 3 seeds et
  affichent la **plage min–max inter-seeds** entre parenthèses (ex. IDLE :
  médiane 368 ns, plage 352–398).
- Les **ratios** (×N / %) sont calculés sur les médianes des médianes.
- `--expose-gc` est obligatoire (préchauffage + `global.gc()` avant le chrono) ;
  `--seed=` mélange l'ordre version × scénario/passe (mulberry32) — sans lui,
  aucune reproductibilité et une version toujours mesurée en premier.

**Une seule commande pour tout rejouer et formater :**

```bash
./bench/freeze.sh                    # 3 seeds × 3 passes → tableaux markdown prêts à coller
./bench/freeze.sh --with-page-eval   # + éval page Edge (Playwright requis)
./bench/freeze.sh --seeds="42 999"   # jeu de seeds personnalisé
./bench/freeze.sh --update-readme    # régénère les sections du README EN PLACE
./bench/freeze.sh --update-readme=chemin.md --with-page-eval  # + éval page, autre cible
```

`freeze.sh` exécute exactement le bloc ci-dessus (mêmes commandes, mêmes
builds), puis `freeze-format.js` agrège (médiane des médianes + plage
inter-seeds) et imprime les sections « Hot loops » et « Chargement » du
README au format markdown, avec le label de version lu dans `@version`.

**`--update-readme`** : au lieu d'imprimer, `freeze-format.js` remplace les
sections « Hot loops » et « Chargement » **dans le fichier** (ancres :
`### Hot loops (~60 Hz)` … `Notes :` et `### Chargement (parse + éval de
page)` … `La série perf11` — tolérantes LF/CRLF), en préservant le reste
(commentaires « Notes : » / « La série perf11 »). La ligne « Éval complète de
page » n'est régénérée qu'avec `--with-page-eval` (sinon avertissement).
Toujours vérifier `git diff` avant de commiter.

**CI (GitHub Actions, `.github/workflows/bench.yml`)** : à chaque push,
`bench/run-all.sh --skip-page-eval` tourne sur `ubuntu-latest` (checkout
historique complet pour la baseline `055d3a0`) puis `bench/check-ratios.js`
compare les 6 ratios perf10/build (IDLE, ACTIF, commun, relâchement,
updateFrame, updateCanvas) à des seuils — plancher ×4 pour les gains attendus
(skip idle, structuredClone), ×12 pour updateCanvas (flag dirty v1.6.0),
fourchette 0,5–2,0 pour les scénarios « équivalents » — le scénario
updateCanvas vérifie aussi structurellement les compteurs `gl.uniform*`
(le build v1.6.0 ne doit émettre ses 7 appels qu'au warmup : `uniform1f` ≤ 20,
contre ≥ 1000 pour perf10).
Un ratio hors seuil = échec du workflow (annotations `::error::`) :

```bash
bash bench/run-all.sh --skip-page-eval > bench-out.txt
node bench/check-ratios.js bench-out.txt                   # exit 0 = PASS, exit 1 = régression
node bench/check-ratios.js bench-out.txt --markdown=out.md # + résumé markdown (tableau + statut)
```

Le workflow enrichit le signal : en cas d'échec, `bench-out.txt` est uploadé
en artefact (`actions/upload-artifact`, `if: failure()`), et sur les PR le
tableau des ratios est posté en commentaire (`actions/github-script`,
marqueur `<!-- bench-ratios -->` → mis à jour au run suivant, pas de doublon).
Nécessite la permission `pull-requests: write` sur le job.

**Job GPU optionnel** (`workflow_dispatch` + input `gpu`) : le workflow
contient aussi `gpu-upload`, qui rejoue le protocole 6 seeds de `bench/gpu/`
sur un **runner self-hosted avec GPU** (labels `self-hosted, linux, gpu`) et
échoue si `bench/gpu/check-gpu.js` détecte une régression d'upload (ratio
perf10/build < 1,3), de wallTotal (< 1,2), de draw, ou un chemin GL non
fonctionnel (compteurs `texSubImage2D`) — voir `bench/gpu/README.md`.

Détails des pièges de chaque harnais dans la section « Repro » du README principal.
Le harnais **GPU** (renderer WebGL2, compteurs GL, GPU timestamps) vit dans
**`bench/gpu/`** de ce repo (autonome : `gen-video.js`, `extract-class.js`,
`gpu-runner.js`, `agg-seeds.js`, `gpu-update-readme.js`, classes extraites ;
`test.webm` et `run-s*.json` gitignorés) — voir `bench/gpu/README.md` et la
section Repro du README.
