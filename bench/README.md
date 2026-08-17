# bench/ — harnais de benchmark CPU

Mesures **perf10 (baseline `055d3a0`)** vs **build courant** (`better-xcloud.user.js`
à la racine du repo). Tout se lance d'un coup :

```bash
./bench/run-all.sh                     # les 5 harnais
./bench/run-all.sh --skip-page-eval   # sans Playwright/Edge (pas de page-eval, de profil ni de cold-getcap)
./bench/run-all.sh --skip-startup-profile # sans le profil CDP du startup
./bench/run-all.sh --skip-cold-getcap # sans la mesure one-shot de getCapabilities
./bench/run-all.sh --cold-page-eval # éval page à froid (navigateur neuf par run, pile RTC froide)
```

Prérequis : Node. Pour l'éval page : Playwright + Edge (canal `msedge`) — installer
avec `npm i -D playwright` ou pointer `NODE_PATH` vers un install existant.

| Fichier | Mesure | Environnement |
|---|---|---|
| `parse.js` | Parse/compile (`new Function`, sans exécution, ×300/passe) | Node V8 |
| `hotloops.js` | Hot loops injectés ~60 Hz (controller, poll_gamepad, updateFrame, updateCanvas) | Node V8 |
| `page-eval.js` | Éval complète de page, injection au document-start, 20 runs — `--cold` : navigateur neuf par run (pile RTC froide, vrai 1er chargement par process) | Edge headless + Playwright |
| `startup-profile.js` | Profil CPU du startup : **self time par fonction** sur le eval document-start (CDP Profiler, échantillonnage 100 µs, 5 runs) — perf10 vs build | Edge headless + Playwright + CDP |
| `live-profile.js` | **Profil runtime en session réelle** : CDP Profiler N s pendant un stream vivant (xbox.com/play OU play.xbox.com), self time par fonction, dominante + non-attribué natif — complète les micro-benchmarks (voit la pipeline complète) | Edge (CDP brut, port 9222) |
| `streamstats-collect.js` | **Tick 1 Hz des stats** : `StreamStatsCollector.collect()` extrait de perf10 vs build, exécuté en vm sur un **report synthétique** (N entrées) — chiffre le gain du patch 9 (single-pass) | Node V8 (`--expose-gc`) |
| `cold-getcap.js` | Coût one-shot isolé de `getCapabilities` : navigateur neuf par run, 1er appel (pile RTC froide) vs 2e + eval document-start à froid perf10 vs build (5 runs × 2 versions) | Edge headless + Playwright |
| `freeze.sh` | Rejoue le protocole figé (3 seeds × 3 passes), capture l'état machine par seed hotloops et formate les tableaux markdown du README | Node V8 (+ Edge si `--with-page-eval`) |
| `check-ratios.js` | CI : parse la sortie de `run-all.sh --skip-page-eval` (ratios hot loops) — `--startup-only` : borne de startup sur la sortie de `page-eval.js --cold` (build ≤ 50 ms, perf10 300–1200 ms) | Node V8 (workflow `.github/workflows/bench.yml`) |
| `update-startup-session.js` | Insère/remplace la ligne « Sessions startup » du README à partir d'un résumé `check-ratios.js --startup-only` (artefact `startup-summary-<sha>`) — dédup par libellé, CRLF préservé | Node V8 |
| `release-prune.sh` | **Rétention des releases** : garde Latest + le preview pinné par le `@updateURL` du build local (repli : prerelease la plus récente), purge le reste (release + tag, `--cleanup-tag`), vérifie les 4 liens d'auto-update (exit 1 = GATE ROUGE) — `--dry-run` pour prévisualiser | bash + gh (à lancer après chaque publication) |

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

```bash
node bench/page-eval.js [--cold] <perf10.js> <build.js>   # --cold : 20 runs à froid, navigateur neuf par run
node bench/startup-profile.js <perf10.js> <build.js> [--runs=N] [--top=N] [--channel=msedge|chromium]
node bench/cold-getcap.js <perf10.js> <build.js> [--runs=N] [--channel=msedge|chromium]
node bench/update-startup-session.js startup-summary.md [--label=...] [--print-only] [--readme=...]

./bench/release-prune.sh --dry-run   # prévisualiser la purge (ne supprime rien)
./bench/release-prune.sh             # purge + vérifie les 4 liens d'auto-update
```

`parse.js` chronomètre par itération en `process.hrtime.bigint()` (résolution
ns) : à ~130 µs/compile, `performance.now()` n'est pas assez fin pour une
mesure par itération fiable. Le `p95` de parse capture les outliers GC
(absorbés par la médiane) ; l'écart perf10/build est dans le bruit inter-seed
(≈ ±10-20 % run à run) — le protocole le montre au lieu de figer un chiffre.

## Re-baseline du 17 août (v1.8.0) — bornes confirmées

Run complet sur le build v1.8.0 (`better-xcloud.user.js`, 481 772 o — inchangé
depuis la baseline précédente : les commits preview4/T9/docs n'ont pas touché
le stable). `run-all.sh --skip-page-eval --skip-cold-getcap` +
`startup-profile.js --runs=5` :

| Harnais | perf10 | build | Lecture |
|---|---|---|---|
| Parse/compile | 0,117 ms | 0,112 ms | négligeable (écart dans le bruit inter-seed) |
| Hot loop controller IDLE | 327,4 ns | **34,4 ns** | ×9,5 — au plancher |
| poll_gamepad relâchement Home | 1 137,7 ns | **165,9 ns** | ×6,9 — au plancher |
| updateCanvas (chemin 60 Hz) | 243,3 ns | **15,6 ns** | ×15,6 (uniforms 1/2/4 appels vs 215k/430k/860k) |
| updateFrame | 167,6 ns | 165,2 ns | stable (texSubImage2D, alloc stable) |
| Startup CDP — perf10 | `getSupportedCodecProfiles` 19,1 ms (78 %) | — | dominante intacte (cible PR upstream #993) |
| Startup CDP — build | — | aucune fonction JS dominante, **76,8 % natif/GC** | plat |

Aucune régression mesurée : hot loops au plancher, startup plat, parse
négligeable. Les bornes CI (build plat, perf10 dominé par `getSupportedCodecProfiles`)
restent valides pour alerter si le startup régresse.



## Profil CPU du startup (fonction-par-fonction)

`startup-profile.js` échantillonne le **eval document-start** (même protocole que
`page-eval.js`) via le **CDP Profiler** et agrège le **self time** par fonction sur
`--runs` exécutions (contexte neuf à chaque run, même process navigateur). C'est ce
profil qui a révélé `getSupportedCodecProfiles` (667 ms de
`RTCRtpReceiver.getCapabilities` à froid = 96 % du eval, sorti du chargement en
v1.7.0) : la dominante fonction-par-fonction reste visible à chaque session.

Sortie par version : médiane du eval (ms), top `--top` fonctions par self time
(ms/run + % des échantillons), et le % **non-attribué** (idle/program/GC : temps
natif hors frames JS).

Pièges :

- le userscript est **strict** → internes non globaux ; le profil n'accède à rien,
  il échantillonne (frames nommées du eval).
- la **pile RTC froide** fait exploser le 1er run de perf10 (~600 ms) : la médiane
  du eval l'absorbe, mais la **masse d'échantillons du run froid** domine l'agrégat
  (getSupportedCodecProfiles ~70 % des échantillons de perf10) — c'est le signal
  voulu : le vrai coût du 1er chargement.
- bruit exclu du classement : `(idle)`, `(program)`, `(garbage collector)`,
  `tryRun`/`InjectedScript`/`UtilityScript` (harnais + DevTools).

## Coût one-shot de getCapabilities (Edge à froid)

`cold-getcap.js` quantifie le coût one-shot de `RTCRtpReceiver.getCapabilities("video")` — la fonction qui monopolisait le startup avant la v1.7.0 — avec un **navigateur neuf par run** (process distinct → pile RTC froide) :

- **one-shot isolé** (indépendant du script, mesuré pour les 2 versions) : chrono in-page du 1er appel (~640 ms sur Edge froid : la pile RTC s'initialise intégralement dedans), du 2e et d'`audio` (~0,1 ms), plus une baseline vide (0,0 ms → zéro bruit de mesure).
- **eval document-start à froid** (perf10 vs build, même protocole que `page-eval.js`) : l'écart perf10/build = exactement le one-shot — perf10 572 ms vs v1.7.0 31 ms (**−94,5 %**).

Pièges :

- `about:blank` (origine opaque) fait échouer le userscript (localStorage) → l'éval passe par une page HTTP servie localement ; la partie isolée n'injecte aucun script et reste sur about:blank.
- l'éval exige un navigateur **neuf** : dans un process partagé la pile RTC survit d'un run à l'autre et le one-shot disparaît (le warm ne voit que −8,7 %, le froid −95 %).
- écart isolé/in-eval (~100 ms) : variance d'environnement de la même init native (540–670 ms), même ordre, même lecture.

## CI — job `startup-cold` (workflow bench.yml, pull_request + workflow_dispatch)

Le job hotloops (ubuntu-latest) n'a ni Playwright ni la pile RTC Edge/Windows : les bornes mesurées (build ~30 ms, perf10 550–660 ms) ne s'y appliquent pas. Le job `startup-cold` tourne donc sur le **runner self-hosted Windows** (labels `self-hosted, windows, gpu`, même machine que le protocole GPU) : `page-eval.js --cold` (20 runs, navigateur neuf par run) puis `check-ratios.js --startup-only` — échec si le build dépasse **50 ms** (un coût one-shot est revenu au chargement), notice si perf10 sort de [300, 1200] ms (dérive d'environnement). Artefacts : `startup-summary-<sha>` (tableau markdown), `cold-eval-<sha>` (sortie complète, en cas d'échec). Le job s'exécute sur chaque **PR de branche interne** (les PR de forks ne peuvent pas utiliser les runners self-hosted — job en attente/skip) et sur chaque **workflow_dispatch** — le runner étant partagé avec le job GPU, une PR le mobilise ~2-3 min.

**PR de forks (externes)** : GitHub bloque les runners self-hosted **quel que soit l'OS** pour les PR de forks des repos publics (sécurité plateforme — « forks of your public repository can potentially run dangerous code on your self-hosted runner machine ») → un runner Linux ne lèverait pas la limite. La couverture des forks passe par un job dédié `startup-cold-fork` sur **runner GitHub-hosted `ubuntu-latest`** (autorisé pour les forks, gratuit pour les repos publics, Edge préinstallé → même canal `msedge`, même moteur que le runner Windows) : `page-eval.js --cold` + `check-ratios.js --startup-only`, artefacts `startup-summary-fork-<sha>` / `cold-eval-fork-<sha>`. **Mesure réelle Linux (PR #8) : pas de one-shot RTC** — perf10 ≈ build ~40 ms (43,6 vs 38,9) au lieu de ~570 ms Windows (l'énumération de codecs coûteuse du one-shot Windows n'existe pas sous Linux) → la **borne build ≤ 50 ms transfère telle quelle**, mais la bande perf10 [300, 1200] n'a pas de sens : le job fork utilise une **bande Linux dédiée (15-200 ms)** via les env `STARTUP_P10_MIN_MS`/`STARTUP_P10_MAX_MS` (les consts de `check-ratios.js` sont overridables par env, défauts Windows intacts). Le job tourne sur **toutes** les PR — les PR internes l'exercent en continu (validation permanente du chemin fork) et il devient l'unique check startup des PR externes. Token read-only sur les forks : **pas de commentaire** (les steps de commentaire hot loops/startup sont gardés par `head.repo.full_name == github.repository` → une PR de fork ne 403 plus) — le résultat est porté par le statut du check + l'artefact. `startup-cold` (self-hosted) est de son côté limité aux PR internes + dispatches.

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

**État machine** (depuis la v1.6.0) : `freeze.sh` capture l'état GPU/CPU via
`bench/gpu/machine-state.js` (partagé avec le harnais GPU) avant et après
CHAQUE seed hotloops, dans `bench/state-cpu-s<seed>.{before,after}.json`
(gitignorés) — `--no-state` pour désactiver. Objectif : corréler la
**classification d'état haut/bas CPU** (ratio IDLE perf10/build : `bas` ≥ ~10,
`haut` ≤ ~9,5 — cf. tableau « Sessions hot loops » du README principal) avec
la charge/clocks/temp réels. Données initiales : re-mesure v1.4.0 = état
haut (×9,5, perf10 IDLE 368 ns), v1.6.0 = état bas (×11,2, perf10 IDLE
~333 ns) — alignés sur les états GPU des mêmes sessions.

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
**Un seul commentaire pour les trois jobs** : les sections hot loops, startup
et GPU (marqueurs `<!-- bench-startup -->` / `<!-- bench-gpu -->`, placés
AVANT leur contenu) vivent dans le même commentaire, chaque job mettant à jour
SA section en préservant les autres (layout canonique : [hot loops] [SEC]
[startup] [GPU] [MAIN]). La logique de fusion est un **module committé**
(`bench/pr-comment-merge.js`, fonction pure `mergeComment` testable
localement) requis par les steps github-script des trois jobs — plus de copie
**Harnais de test committé `bench/pr-comment-merge.test.js` (31 cas, lancé par
tout run CI dans le job hotloops) : ordres de mise à jour (6 permutations),
idempotence, édition manuelle (sections réordonnées — plus aucune perte,
doublons de markers — dernière occurrence gagne, MAIN manquant/anticipé,
contenu après MAIN ignoré), sections vides (purge), mode inconnu (throw),
CRLF/whitespace, et vérification byte-identique sur le commentaire réel.**
du script dans le workflow. Le job GPU étant dispatch-only (ou label-gated :
label `bench-gpu` sur une PR interne), sa section ne se poste que dans un
contexte PR (le step est inerte sur les dispatches, qui n'ont pas de PR à
commenter).

**Trigger label-gated — piège du type `labeled` (vérifié en réel, 16 août) :**
le trigger `pull_request` inclut le type `labeled` (nécessaire pour démarrer
sur l'ajout du label), mais GitHub **ne livre pas toujours l'événement**
`labeled` à Actions : 4 poses du label sur la PR #13 enregistrées dans la
timeline, 0 run créé — alors que `opened`/`synchronize`/`reopened`
fonctionnent systématiquement. Le `labeled` est conservé dans le workflow
(harmless — si GitHub corrige la livraison, l'ajout du label déclenchera
directement). **Flux fiable documenté** : poser le label `bench-gpu`, puis
déclencher un run PR par un push sur la branche (synchronize) ou un
close/reopen (reopened) — le job gpu-upload s'active dès que le label est
présent (gate vérifié en réel : run 31935334373, job `in_progress` sur le
label seul).

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

Le harnais **preview** (`bench/preview/`) capture les bundles runtime du
nouveau client web xCloud (play.xbox.com, renderer Babylon.js) en session
authentifiée : `capture.js` (bookmarklet/console : dump modules + signatures +
mesure du draw Babylon), `self-test.js` (moteur de signatures rejouable sur
les bundles locaux, drift check de `static-matrix.md`) — voir
`bench/preview/README.md`.

Le **portage app-shell vers le preview** (`bench/preview/port/`) produit le
build `better-xcloud-preview.user.js` (v1.8.0-preview4) : `build-preview.js`
(overlay détection `play.xbox.com` + garde du Patcher site + entrée settings + T8
retrait osName=tizen + T9 settings dans la game bar de la page stream),
`classify.md` (les 13 patches app-shell 01-12/21 sont script-internes, preuve à
l'appui) et `anchors.md` (ancres React Router 7 issues des statics : route
`settings`, `systems.settings`, `streaming.settings.*`) — voir
`bench/preview/port/README.md`.
