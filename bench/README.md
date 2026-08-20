# bench/ — harnais de benchmark CPU

> **Vibe-coding** : ce harnais fait partie du projet **EvenBetterXcloud**, fork
> et améliorations co-créés avec l'assistance IA générative **Codebuff** (agent
> « Buffy ») sous la direction humaine d'**Endymi0n74** — les protocoles de
> mesure, les gates CI et les scripts de publication de ce dossier ont été
> écrits et validés par l'agent. Crédit original :
> [redphx](https://github.com/redphx) pour Better xCloud (MIT). Signature
> « Generated with Codebuff » dans chaque commit.

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
Le harnais ne télécharge **aucun navigateur** (canal `msedge` = Edge système).
Les éventuels binaires Playwright vont sur D: via
`PLAYWRIGHT_BROWSERS_PATH=D:\ms-playwright` (rien sur C:).

| Fichier | Mesure | Environnement |
|---|---|---|
| `parse.js` | Parse/compile (`new Function`, sans exécution, ×300/passe) | Node V8 |
| `hotloops.js` | Hot loops injectés ~60 Hz (controller, poll_gamepad, updateFrame, updateCanvas) | Node V8 |
| `page-eval.js` | Éval complète de page, injection au document-start, 20 runs — `--cold` : navigateur neuf par run (pile RTC froide, vrai 1er chargement par process) | Edge headless + Playwright |
| `startup-profile.js` | Profil CPU du startup : **self time par fonction** sur le eval document-start (CDP Profiler, échantillonnage 100 µs, 5 runs) — perf10 vs build | Edge headless + Playwright + CDP |
| `live-profile.js` | **Profil runtime en session réelle** : CDP Profiler N s pendant un stream vivant (xbox.com/play OU play.xbox.com), self time par fonction, dominante + non-attribué natif — complète les micro-benchmarks (voit la pipeline complète) | Edge (CDP brut, port 9222) |
| `streamstats-collect.js` | **Tick 1 Hz des stats** : `StreamStatsCollector.collect()` extrait de perf10 vs build, exécuté en vm sur un **report synthétique** (N entrées) — chiffre le gain du patch 9 (single-pass) | Node V8 (`--expose-gc`) |
| `cold-getcap.js` | Coût one-shot isolé de `getCapabilities` : navigateur neuf par run, 1er appel (pile RTC froide) vs 2e + eval document-start à froid perf10 vs build (5 runs × 2 versions) | Edge headless + Playwright |
| `freeze.sh` | Rejoue le protocole figé (3 seeds × 3 passes), capture l'état machine par seed hotloops et formate les tableaux markdown de `bench/README.md` | Node V8 (+ Edge si `--with-page-eval`) |
| `check-ratios.js` | CI : parse la sortie de `run-all.sh --skip-page-eval` (ratios hot loops) — `--startup-only` : borne de startup sur la sortie de `page-eval.js --cold` (build ≤ 50 ms, perf10 300–1200 ms) | Node V8 (workflow `.github/workflows/bench.yml`) |
| `update-startup-session.js` | Insère/remplace la ligne « Sessions startup » de `bench/README.md` à partir d'un résumé `check-ratios.js --startup-only` (artefact `startup-summary-<sha>`) — dédup par libellé, CRLF préservé | Node V8 |
| `release-prune.sh` | **Rétention des releases** : garde Latest + **le dernier preview** (tri par version, jamais `publishedAt` — une release recréée depuis git reprend une date récente) + le tag pinné par le `@updateURL` du build local + **le canal flottant preview `evenbetter-xcloud-preview-channel` (whitelist absolue — ne JAMAIS purger, il porte l'auto-update de tous les installés)**, purge le reste (release + tag, `--cleanup-tag`), vérifie les 4 liens d'auto-update (exit 1 = GATE ROUGE) — `--dry-run` pour prévisualiser | bash + gh (à lancer après chaque publication) |
| `stream-instrument.js` | **Observation écran noir pendant un stream** (WebView téléphone/box ou Edge) : états video (readyState/currentTime/error), frames RÉELLEMENT présentées (`requestVideoFrameCallback` → detection freeze compositor vs décodeur), événements page (video error/stalled/waiting, visibilitychange), exceptions JS + échecs réseau (CDP Runtime/Log/Network), et getStats WebRTC (framesDropped/packetsLost/ice) via le PC de session trouvé par walk des fibres React + wrap du constructeur (connexions suivantes). JSONL + résumé — `--duration`, `--interval`, `--out` | CDP brut (Node, WebSocket natif) |

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

### Canal flottant preview (auto-update — fix du 20 août)

Le `@updateURL`/`@downloadURL` du preview pointe **le canal**
`evenbetter-xcloud-preview-channel` (release dédiée, ré-uploadée à chaque
publication preview) et JAMAIS un tag versionné : la rétention purge
l'ancienne release → pin 404 pour tout install existant, et même vivante la
meta resterait figée à l'ancienne `@version` (TM/GM ne proposerait jamais la
suivante). À chaque publication preview :

```
gh release upload evenbetter-xcloud-preview-channel better-xcloud-preview.user.js better-xcloud-preview.meta.js --clobber
```

Le harnais `bench/update-test/update-mechanism.test.js` reproduit le
mécanisme exact de TM/GM (fetch de la meta au pin installé + comparaison
semver) sur les vraies URLs GitHub — à lancer en local après chaque
publication preview (il ne tourne pas au CI, réseau obligatoire) :

```
node bench/update-test/update-mechanism.test.js
```
```

`parse.js` chronomètre par itération en `process.hrtime.bigint()` (résolution
ns) : à ~130 µs/compile, `performance.now()` n'est pas assez fin pour une
mesure par itération fiable. Le `p95` de parse capture les outliers GC
(absorbés par la médiane) ; l'écart perf10/build est dans le bruit inter-seed
(≈ ±10-20 % run à run) — le protocole le montre au lieu de figer un chiffre.

## Feature « 📊 Données » — presets débit/résolution (v1.11.0, 19 août)

Nouvelle feature utilisateur via le pattern `feature-latency.js` :

- **`bench/feature-datasaver.js`** — injecte un groupe « 📊 Données » dans
  les settings (3 presets 🚀 Max / ⚖️ Équilibré / 🌱 Économe) avec gates
  (GATE ROUGE si une ancre dérive) + `--self-test` + idempotence. Basé sur
  les mesures du 18 août (le cap maxBitrate est le seul réglage qui
  économise sans perdre la définition).
- **`bench/feature-datasaver-probe.js`** — validation CDP en réel
  (Edge guard-badge + extension `.edge-inject-stable`) : groupe rendu même
  déconnecté, clic preset → prefs posées via `getGlobalPref`/`setGlobalPref`
  (`stream.video.*` sont des prefs **globales** — `getStreamPref` THROWE),
  restauration illimité.
- **Pièges** : `maxBitrate` a un `transformValue` (max slider 15360000 ↔
  stocké 0) — écrire 0 est clampé à 102400, écrire **15360000** = illimité ;
  l'extension d'injection lit `stable.js` au démarrage d'Edge (relancer
  Edge après un rebuild).

## Feature « 🔊 Son » — presets de volume (v1.13.0, 18 août)

Quatre presets en un clic dans le groupe « Audio » de l'onglet **stream**
(sous le slider natif `audio.volume`) : 🔇 Muet (0) / 🔉 Doux (50) /
🔊 Normal (100 + booster off) / 📢 Boost (200 + booster on). Mécanique :
`setStreamPref("audio.volume", v, "ui")` (pref STREAM) +
`setGlobalPref("audio.volume.booster.enabled", …)` (pref GLOBALE) — le 3e
argument `"ui"` émet `setting.changed` → le slider natif se sync et les
onChange s'appliquent (`SoundShortcut.setGainNodeVolume` en session).

- Injection : `node bench/feature-sound.js <bundle.js> [--dry-run]
  [--self-test]` — gates (GATE ROUGE si une ancre dérive) + idempotence +
  self-test sur copie corrompue. Gate CI : `bench/feature-sound.test.js`.
- Probe réelle : `node bench/feature-sound-probe.js [--port=9225]` — ouvre
  les settings, bascule l'onglet stream, vérifie le rendu des 4 presets puis
  joue le **cycle complet** avec vérification prefs + statut live à chaque
  étape.
- **Diagnostic 18 août (fausse alarme « clics morts »)** : un premier run de
  probe rapportait des clics sans effet. Cause réelle : les prefs
  **persistent** entre les runs (localStorage) — la probe cliquait « 🔉 Doux »
  alors qu'il était **déjà actif** (vol=50 posé par un run précédent) → no-op
  attendu, pas un bug. Pièges connexes : (1) `saveSettings` est débouncée
  ~100 ms → lire les prefs juste après le clic peut voir l'ancienne valeur ;
  (2) les labels contiennent emojis + parenthèses (« 🔊 Normal (défaut) ») →
  le matching par **regex construite** est fragile, `textContent.includes`
  est sûr. La probe blindée : bascule **forcée** vers un autre preset si la
  cible est déjà active (le clic testé est toujours une vraie transition),
  **poll** des prefs jusqu'au flush du debounce (pas de sleep fixe), matching
  par `includes`. Validé en réel le 18 août : cycle complet 4 presets OK dans
  les deux cas de départ (état Normal et état Boost déjà actif).

## Routine de purge des listeners de diagnostic — BX_PURGE_DIAG (19-20 août)

Pendant une session CDP on attache des listeners de diagnostic sur `window`
(convention : le marqueur `win-capture` dans la source). Un listener oublié à
fermeture cassée peut THROWER à chaque clic. La routine injectée au démarrage
(`bench/feature-diag-purge.js`, ancre BX_EXPOSED) hook `window.
addEventListener`/`removeEventListener`, enregistre les listeners marqués et
expose `window.BX_PURGE_DIAG()` (retire uniquement ceux-là, appelé au
démarrage + utilisable en fin de probe). Gate CI `bench/feature-diag-purge.
test.js` : présence stable+preview, ancres, **test fonctionnel vm** (2 marqués
purges, normal conservé) + self-test. Les probes CDP (`feature-sound-probe`,
`feature-datasaver-probe`, `feature-region-probe`) appellent `BX_PURGE_DIAG()`
en fin de run (best-effort, no-op si API absente) et documentent la
convention `win-capture` dans leurs entêtes. Pièges documentés : les
exceptions des listeners ne remontent PAS au dispatcher (compter via le
handler `error` de window) ; après purge du ScriptCache MV3 + relance
Edge, la page chargée avant l'extension n'a pas le bundle → un reload
suffit.

## Gate « README toujours à jour » — readme-version.test.js (20 août)

Règle utilisateur : « le README doit toujours être à jour » — le gate CI
`bench/readme-version.test.js` (step hotloops-ratios de bench.yml) lit
`VERSION` + `PREVIEW_VERSION` (source de vérité du bump) et vérifie :

1. **Ancres courantes** (READMEs front : README.md, README.en.md,
   mobile/README.md) — titre `# EvenBetterXcloud — v<VERSION>`, ligne
   `Version` de la table « Deux versions », tag d'auto-update du preview,
   lien release courante, APK `evenbetter-xcloud-<VERSION>.apk` /
   `-<PREVIEW>.apk`.
2. **Aucune référence périmée** (TOUS les READMEs, journaux compris) — un
   lien `releases/download/evenbetter-xcloud-v<tag>` ou un APK versionné
   dont le tag/version n'est ni VERSION ni PREVIEW_VERSION → GATE ROUGE
   (la rétention purge les anciennes releases → 404 auto-update). Les
   mentions historiques en prose (ex. « Nouveauté v1.13.0 ») sont tolérées.
3. **Bundles** — `@version` de better-xcloud.user.js/.meta.js (stable) et
   better-xcloud-preview.user.js/.meta.js (preview) doivent égaler
   VERSION/PREVIEW_VERSION, et le pin `@updateURL` du preview doit pointer
   le tag courant → piège **« bump sans rebuild »** couvert (un bump de
   fichier sans rebuild laisse l'ancienne version ET l'ancien pin → 404
   auto-update).
4. **APK** — `mobile/build.sh` doit dériver les noms d'APK de `${VERSION}`
   (stable) et `${PREVIEW_VERSION}` (preview) ; si des APK de release sont
   présents dans `mobile/out/`, leurs noms doivent être courants (les
   artefacts intermédiaires base.apk/app-unsigned.apk/app-aligned.apk sont
   ignorés). Noms d'APK périmés vérifiés dans les docs FRONT uniquement :
   un nom historique cité dans un journal bench/ est légitime (ce n'est pas
   un lien vers une release purgée — contrairement aux URLs, vérifiées
   partout).

`--self-test` : copies corrompues (titre + tag + APK + `@version` + pin +
build.sh) → le gate doit sortir ROUGE. Le CI lance le gate + son self-test
à chaque push/PR — un bump qui oublie la passe README OU le rebuild casse
le job immédiatement.

**Simulation bump 1.13.2 (20 août, clone local, rien publié)** : cycle
complet rejoué — `bump-version.sh 1.13.2` (VERSION/PREVIEW_VERSION, 5
@version, BX_VERSION, manifest vc 11) → `build-preview.js` (re-pin preview
sur `evenbetter-xcloud-v1.13.2-preview1`) → passe README structurelle →
**gate VERT de bout en bout** (self-test : 37 défaillances détectées sur les
copies corrompues). Contre-preuve : sans la passe README, le gate sort ROUGE
(27 défaillances, exit 1) — le bump seul ne suffit pas, la passe README est
bien exigée par le CI. Au passage : le gate flaggait les noms d'APK
historiques des journaux bench/ après bump → check restreint aux docs FRONT.

**Fixes collatéraux (20 août)** : `mobile/build.sh` hardcodait
`evenbetter-xcloud-${VERSION}-preview1.apk` — le suffixe `-previewN` vient
maintenant de `PREVIEW_VERSION` (GATE ROUGE si le fichier est absent, message
clair grâce à `|| true` sous `set -euo pipefail`). Idem `versionName` du
manifest : le template est bumpé avec la version stable (bump-version.sh),
le build force la version du variant (`VERSION_NAME`) pour que l'APK preview
annonce `1.13.1-preview1` et non `1.13.1`. Validé en réel le 20 août :
`evenbetter-xcloud-1.13.1.apk` (versionName 1.13.1, com.bxperf.app) et
`evenbetter-xcloud-1.13.1-preview1.apk` (versionName 1.13.1-preview1,
com.bxperf.preview) — piège `out/` qui se purge entre deux builds : sécuriser
le 1er APK hors de `out/` avant le 2e build.

## Gate « Défauts TV de l'APK » — tv-defaults.test.js (20 août)

La navigation télécommande de l'overlay sur les box (Freebox Pop, TV) repose
sur les défauts TV posés par l'APK via `JS_TV_DEFAULTS` de
`mobile/src/com/bxperf/app/MainActivity.java` (`ui.controllerFriendly=true`
+ `ui.layout="tv"` — la WebView de la box est « unknown », donc sans ce
réglage la navigation D-pad est coupée, piège du 20 août). Le gate vérifie
statiquement, sans build APK :
- **Tous les réglages** de la constante : marqueur d'idempotence lu/écrit à
  2, maxBitrate 5 Mbps, 720p, reduceAnimations, controllerFriendly, layout
  tv, rocket hide — formes Java échappées comparées via un helper `JQ`
  (l'échappement `\"` d'un littéral JS consommerait le backslash).
- **Les deux points d'injection** : évaluation au chargement
  (`JS_TV_DEFAULTS + "}}catch..."`) et application TV uniquement
  (`isTv ? JS_TV_DEFAULTS : ""`).
- **--self-test** : copie sans controllerFriendly → GATE ROUGE attendu.

Gate CI : `node bench/tv-defaults.test.js [--self-test]` (step preview de
bench.yml).

## Rebrand EvenBetterXcloud + feature Sound (v1.9.0, 18 août)

Le fork est **renommé EvenBetterXcloud** (repo `Endymi0n74/EvenBetter-Xcloud`)
et tout ce qui porte la marque a été mis à jour en une passe : headers
userscripts (@name/@namespace/@version/@updateURL/@downloadURL), badge du
menu (`EvenBetterXcloud 1.9.0` au lieu de `Better xCloud 6.7.12`), libellés
visibles, update-check (fetch vers NOTRE repo + comparaison sur BX_VERSION),
label/UA/logs de l'APK, icône APK (nuage + flèche verte).

**Outils rejouables** (la marque est un artefact de build, pas du manuel) :

- `bench/rebrand-bundle.js <bundle> [--version=X] [--no-sound] [--dry-run]`
  — applique le rebrand + la feature Sound à un bundle frais, avec **gates**
  (GATE ROUGE si un pattern a dérivé dans une future version du bundle).
  Idempotent (no-op si déjà rebrandé) ; `--bump-only` pour ne changer que la
  version (headers + BX_VERSION + commentaire OPTIMISATIONS).
- `bash bench/bump-version.sh <v> [--preview=...] [--build-apk] [--no-verify]`
  — bump CENTRALISÉ, **cycle complet en UNE commande** : VERSION (racine),
  stable, es2017 (régénéré), preview, metas, manifest APK
  (versionName/versionCode) + **passe README structurelle** (README.md /
  README.en.md / mobile/README.md : titre, table Deux versions, tags/liens,
  APK — les mentions historiques en prose ne sont pas touchées) + rebuild
  preview (build-preview.js re-pinne `@updateURL` sur le nouveau tag) + gate
  `readme-version.test.js` final (GATE ROUGE → exit 1 si un README ou un
  bundle garde l'ancienne version). `--no-verify` saute le rebuild + gate
  (rare). **À exécuter à chaque changement de version.**
- La version est lue par `mobile/build.sh` (`VERSION` racine) pour nommer les
  APK : `evenbetter-xcloud-<v>.apk` / `evenbetter-xcloud-<v>-preview1.apk`.
- `node bench/verify-badge.js [--port=9224] [--banner]` — valide EN RÉEL le
  badge du menu : charge xbox.com/play dans un Edge piloté par CDP (extension
  locale `.edge-inject-stable` = le bundle servi par releases/latest,
  équivalent Greasemonkey), ouvre les settings, lit le badge « EvenBetterXcloud
  <version> », vérifie que c'est un lien vers nos releases (`<a href="…/
  EvenBetter-Xcloud/releases" target="_blank">`) et qu'un vrai clic CDP
  ouvre bien cette page (preuve PNG dans /d/Codex). **`--banner`** : simule
  l'UA Android (la bannière n'apparaît que sur Android), vérifie que la
  bannière « 🔥 EvenBetterXcloud app for Android » pointe vers le
  téléchargement DIRECT de l'APK (`latest/download/evenbetter-xcloud.apk`),
  clique dessus et confirme le téléchargement RÉEL (événements CDP
  `downloadWillBegin` + `downloadProgress` 135788/135788 o). Validé 18 août :
  badge 1.9.0 + clic releases + bannière → APK téléchargé. ⚠ Pièges : les
  extensions `.edge-inject*` ne sont PAS commitées (outils locaux) ; Edge
  SmartScreen SUPPRIME l'APK téléchargé après réception (événement cancel +
  hub « fichier supprimé ») — la preuve passe par les événements CDP, pas par
  le fichier ; un clic juste après l'ouverture d'un onglet (badge) peut être
  avalé → pause 600 ms après `Page.bringToFront` (sinon retenter le clic).

**Feature Sound** (groupe « Son » dans l'onglet GLOBAL, visible même
**déconnecté**) : toggle « Activer la fonction de contrôle du volume »
(`audio.volume.booster.enabled`) + volume 0-600% (`audio.volume`, stepper
−/+/désactivé tant que le booster est off) — même mécanique que le groupe
Audio de l'onglet stream (gain node), mais accessible sans session.
Injectée par rebrand-bundle.js (2 ancres vérifiées). Validé en réel sur
l'APK (BlueStacks, déconnecté) : badge `EvenBetterXcloud 1.9.0` + groupe
`Son` + toggle + stepper volume (preuve `mobile/validation-ebx-son-1.9.0.png`).

**Perfs après rebrand (seed 42, 1 passe)** : parse plat (0,155 ms),
controller IDLE 37,6 ns (×8,7), updateCanvas 13 ns (×19), updateFrame
162 ns stable — aucune régression.

## Profil runtime en session réelle — VERDICT (18 août ~19:45, v1.9.0)

`node bench/live-profile.js --port=9225 --duration=15/20` sur un stream réel
(As Dusk Falls, www.xbox.com/play, build v1.9.0 injecté par extension
`.edge-inject-stable`, profil guard-badge connecté) :

| Run | Durée | JS total sur le main thread | Dominantes |
|---|---|---|---|
| 15 s | 15,9 s | ~3,5 ms (0,02 %) | fetch 2,0 ms · ls 1,5 ms |
| 20 s | 20,4 s | ~3,2 ms (0,02 %) | getGamepads 1,7 ms · Yt 1,5 ms |

**Verdict : le main thread JS du renderer est ~99,98 % inactif/natif pendant
un stream.** Aucune dominante JS exploitable : la charge réelle (décodage
vidéo, rendu WebGL2) vit dans les process natifs/GPU, invisibles au CDP
Profiler du renderer. Le script EvenBetterXcloud (updateFrame/updateCanvas/
draw ~0,2 µs/frame) est sous le seuil d'échantillonnage — **la queue
d'optimisations JS du stable est au plancher, il n'y a plus de gain
mesurable côté script**. Le seul item JS visible est le polling
`navigator.getGamepads` (client xcloud + script, ~0,1 ms/s) — déjà couvert
par les PR upstream #999/#1000 et le hot loop bench (137 ns).

⚠️ Caveat rendu corrigé (18 août ~21:00) : le run initial était en onglet
**arrière-plan** (86 % de frames dropped, downscale 1440p→720p). En relançant
avec la fenêtre au premier plan (cycle minimiser→restaurer via
`Browser.setWindowBounds` → `visibilityState:visible`, cf. plus bas) :
**599 frames reçues sur 20 s, 0 dropped (0,00 %), 29,9 fps effectifs** — le
rendu est propre, sans throttle. live-profile au premier plan : 99,3 %
natif/inactif (même verdict JS), les callbacks du SDK tournent réellement
(scheduleTimer 2,7 ms · requestVideoFrameCallback 2,6 ms · calculateChanges
1,9 ms sur 15 s) — toujours négligeable. **Verdict rendu : 0 drop à 1440p30
quand l'onglet est visible** — le rendu natif ne dégrade rien.

⚠️ Opérationnel pour les futures sessions CDP : (1) les clics
`Input.dispatchMouseEvent` peuvent être interceptés par la page (banner
z-999) — utiliser `element.click()` en JS ; (2) un onglet CDP reste
`visibilityState:hidden` même après `Page.bringToFront` si la fenêtre OS est
occluse — le **cycle minimiser→restaurer** (`Browser.setWindowBounds`
`minimized` puis `normal`) force le premier plan et libère le rendu.

## Hors main thread — leviers réseau/décodage mesurés (18 août ~20:15, v1.9.0)

Session stable réelle (As Dusk Falls, www.xbox.com/play, onglet au premier
plan) : lecture de la config d'input effective (`window.BX_EXPOSED.inputChannel.
configuration`) + doubles échantillons `getStats` (deltas sur timestamps RTP,
10 s) :

| Métrique | Valeur mesurée | Scriptable ? |
|---|---|---|
| Main thread JS (live-profile) | **~0,02 %** du temps (3,2 ms/20 s) | plancher |
| getGamepads polling | ~85 µs/s (0,0085 %), ~0,34 µs/appel | knob `controller.pollingRate` (déjà scripté) |
| Décodage vidéo | **0,50 ms/frame** (16,2 ms/s) — H.264 High 2560×1440@30 | NON (media stack natif) |
| Bitrate réseau | **~24,8 Mbps** (1440p30) | cap via `stream.video.maxBitrate` → patch SDP `b=AS:` (mécanisme vérifié dans le bundle) |
| RTT / pertes | 22 ms · 0 paquet perdu · 0 frame dropped | non pertinent |
| **Config input effective** | `useIntervalWorkerThreadForInput:true` · `enableVibration:true` · `useUnreliableInput:true` · `enableClientRenderedCursor:true` | **déjà tous actifs par défaut** |

**Inventaire des leviers réseau/décodage du client stable (tous déjà scriptés
par upstream, mécanismes vérifiés dans le bundle) :** `stream.video.maxBitrate`
(SDP `b=AS:`), `stream.video.codecProfile` (`RTCRtpTransceiver.setCodecPreferences`
+ patch SDP), `stream.video.resolution`, `stream.video.preventResolutionDrops`
(patchStreamMetadata), `video.maxFps`, `video.player.powerPreference`,
`video.player.type` (renderer), `server.bypassRestriction`/`server.region`
(routage), `stream.video.combineAudio` (streamCombineSources patch),
`controller.pollingRate` (boucle pollGamepads).

**Verdict : rien à optimiser côté script hors main thread.** Contrairement au
preview (où la fusion P2 des overrides apportait `useIntervalWorkerThreadForInput`
et `enableVibration`), le client stable les a **nativement activés** — la
config d'input effective le prouve en session réelle. Le polling getGamepads
est le seul item JS visible et son gain potentiel (~0,007 % du temps) est
sous le bruit. Le décodage (0,50 ms/frame) est natif. Les seuls leviers
restants (bitrate/résolution/FPS) sont des **préférences utilisateur**, pas
des optimisations — leurs mécanismes (patch SDP, codec prefs) fonctionnent
déjà. Axe infra restant, hors script : **AV1** (non utilisé sur ce setup —
H.264 High) via `stream.video.codecProfile` si le navigateur le supporte.

## A/B codec AV1 vs H.264 — verdict : backend xCloud encode H.264 uniquement (18 août ~23:00, v1.10.0)

Son **AV1 sur le client stable** : le navigateur le supporte parfaitement,
mais le serveur ne peut pas l'encoder — l'A/B mesuré le prouve.

### 1. Support navigateur (Edge 152, `bench/av1-probe.js`)

| Sonde | Résultat |
|---|---|
| `RTCRtpReceiver.getCapabilities("video")` | **`video/AV1` présent** (avec VP8/VP9/H264) |
| MediaCapabilities AV1 1080p60 file | `supported:true` · `powerEfficient:true` |
| MediaCapabilities AV1 1440p60 file | `supported:true` · `powerEfficient:true` |
| MediaCapabilities AV1 webrtc (recevoir) | `supported:true` · `powerEfficient:true` |
| `getSupportedCodecProfiles()` (bundle) | **n'expose que H.264** low/normal/high — AV1 jamais proposé dans le setting |

**Liste RTP complète observée** (`RTCRtpReceiver.getCapabilities("video")`,
Edge 152 — identique côté preview) :

```
video/VP8 · video/rtx · video/VP9 (profile 0/1/2/3) · video/H264 (×9) ·
video/AV1 (×2) · video/red · video/ulpfec · video/flexfec-03
```

➡️ **Pas de HEVC (H.265)** dans la pile WebRTC — ni offert, ni négociable.
H.264 est le seul codec que le serveur retient (AV1/VP9 présents dans l'offre,
absents de la réponse).

### 2. A/B mesuré sur un stream réel (As Dusk Falls, 20 s, premier plan)

| Métrique | Run A (défaut) | Run B (offre AV1 forcée) |
|---|---|---|
| Codec négocié | **video/H264** | **video/H264** (le serveur ignore AV1) |
| Résolution | 2560×1440@30 | 2560×1440@30 |
| Bitrate | **24,2 Mbps** | **24,7 Mbps** |
| Décodage | 0,51 ms/frame | 0,46 ms/frame |
| Frames dropped | 0 | 0 |

### 3. Preuve SDP (`bench/sdp-inspect.js`)

Run B : l'**offre locale contient bien AV1** (payloads `AV1/90000` présents,
patch `setLocalDescription` installé — reorder AV1 en tête + neutralisation
`setCodecPreferences`) mais la **réponse serveur (`remoteDescription`) ne
liste QUE du H.264** — le backend a même retiré VP8/VP9 de la réponse.
L'encodeur xCloud côté serveur est **H.264 uniquement**.

**Verdict : AV1 est un cul-de-sac pour le stable (et le preview) — le goulot
est l'encodeur serveur, pas le client.** Pas d'option à ajouter au bundle ;
le setting `codecProfile` reste limité aux profils H.264 (comportement
correct). Harnais ajoutés : `bench/av1-probe.js` (support navigateur),
`bench/launch-game.js` (lancement jeu + `--av1` patch SDP),
`bench/stream-stats-capture.js` (stats getStats 20 s),
`bench/sdp-inspect.js` (SDP local/remote), `bench/page-probe.js` (sonde DOM),
`bench/kill-edge-profile.ps1` (fermeture propre d'un profil Edge).

## Effet réel des préférences utilisateur — maxBitrate + résolution mesurés (18 août ~23:30, v1.10.0)

Même jeu (As Dusk Falls), sessions de 15-20 s au premier plan, préférence
posée dans `localStorage["BetterXcloud"]` avant le lancement
(`bench/set-pref.js` — merge + reload + attente du bundle) :

| Config posée | Résolution effective | Bitrate reçu | Décodage | Drops |
|---|---|---|---|---|
| Défaut (`auto`, sans cap) | **2560×1440@30** | **24,2 Mbps** | 0,51 ms/f | 0 |
| `maxBitrate` 10 Mbps | 2560×1440@30 | **6,6 Mbps** | 0,42 ms/f | 0 |
| `maxBitrate` 5 Mbps | 2560×1440@30 | **4,7 Mbps** | 0,43 ms/f | 0 |
| `resolution` **720p** | **1280×720@30** | **6,4 Mbps** | 0,40 ms/f | 0 |
| `resolution` 1080p | 2560×1440@30 (**no-op**) | 24,4 Mbps | 0,48 ms/f | 0 |
| `resolution` 1080p-hq | 2560×1440@30 (**no-op**) | 20,6 Mbps | 0,51 ms/f | 0 |

### Mécanisme (vérifié dans `handlePlay` du bundle)

`XcloudInterceptor.handlePlay` applique la résolution par **spoof
`osName`** (le même mécanisme P3 qu'on a retiré du preview) :
`x-ms-device-info` + `body.settings.osName` selon
`getOsNameFromResolution()` — **`720p`→android**, **`1080p`→windows**,
**`1080p-hq`→tizen**.

- **720p fonctionne** : android → le serveur envoie 1280×720 (6,4 Mbps).
- **1080p = no-op sur PC** : windows = natif → le serveur garde 1440p.
- **1080p-hq = no-op sur PC** : tizen ignoré (cohérent avec l'A/B P3 du
  preview — osName=tizen ne change rien sur un client PC).

### Verdict — réglage recommandé

1. **`stream.video.maxBitrate` est fiable et sans perte de résolution** : le
   cap SDP `b=AS:` est honoré par l'encodeur (10 Mbps → 6,6 reçus, 5 Mbps →
   4,7). Recommandé pour économiser la bande passante tout en gardant la
   définition native : **cap 10-15 Mbps**.
2. **`resolution` 720p** : le seul réglage de résolution qui change
   réellement quelque chose sur PC (6,4 Mbps) — utile pour très faible débit.
3. **1080p / 1080p-hq trompeurs sur PC** : ils ne changent rien (toujours
   1440p natif). Ne pas les recommander.
4. Décodage constant (~0,4-0,5 ms/frame) dans tous les cas — le décodage
   n'est jamais le goulot, même à 1440p.

Caveat : bitrate variable selon le contenu (jeu à faible mouvement) — les
chiffres comparent le même jeu/scène, l'ordre de grandeur est fiable.
Harnais ajoutés : `bench/set-pref.js` (pose de préférence + reload).

## A/B profils H.264 — le setting fonctionne, le défaut est déjà le meilleur (18 août ~23:50, v1.10.0)

`stream.video.codecProfile` réordonne les profils H.264 dans l'offre SDP
(`patchRtcPeerConnection` → `setCodecPreferences`) — le serveur répond avec le
profil demandé. Prouvé en session réelle via le `profile-level-id` négocié
(lu dans le stat codec de `getStats`, ajouté au capture) :

| Setting | profile-level-id négocié | Profil réel | Bitrate (15-20 s) | Décodage | Drops |
|---|---|---|---|---|---|
| `default` | `4d001f` | **Constrained High** | 20,7 Mbps | 0,44 ms/f | 0 |
| `high` | `4d001f` | **Constrained High** | 10,4 Mbps | 0,39 ms/f | 0 |
| `normal` | `42e01f` | **Constrained Baseline** | 20,5 Mbps | 0,43 ms/f | 0 |
| `low` | `42001f` | **Baseline** | 20,5 Mbps | 0,45 ms/f | 0 |

Screenshots de preuve : `bench/.h264-high.png` / `bench/.h264-low.png`
(scènes différentes — pas comparables entre eux, preuve du run seulement).

### Verdict

1. **Le setting fonctionne** : le profil demandé est réellement négocié
   (4d / 42e / 420). Mécanisme vérifié de bout en bout.
2. **`default` == `high`** : le SDK négocie déjà Constrained High par défaut
   — mettre « high » ne change rien.
3. **`low` / `normal` ne font que dégrader** : Baseline/Constrained Baseline =
   pas de B-frames (CAVLC au lieu de CABAC) → compression moins efficace. Le
   serveur encode le même contenu moins bien ; théoriquement bitrate en hausse
   à qualité égale (ou qualité en baisse à bitrate égal).
4. **⚠️ Caveat bitrate** : les valeurs ci-dessus sont **confondues par le
   contenu** (As Dusk Falls avance — le run « high » a attrapé une scène
   statique à 10,4 Mbps). La NÉGOCIATION du profil est la preuve fiable ; les
   deltas de bitrate inter-runs ne sont pas comparables.
5. **Recommandation : laisser `codecProfile` à `default`** — c'est déjà le
   meilleur profil disponible. Les seuls leviers utiles restent
   `maxBitrate` (cap) et `resolution` 720p.

## Verdict codec preview (play.xbox.com) — même backend H.264-only (19 août ~00:05, v1.10.0-preview1)

Session preview réelle (Among Us, `bench/launch-preview-game.js` + `bench/preview-codec-probe.js`) :

- **Codec négocié : `video/H264` `4d001f` (Constrained High)** — **identique au
  stable**. Le backend Azure encode en H.264 Constrained High pour les deux
  clients.
- **AV1 proposé, ignoré** : l'offre locale contient AV1
  (`localSdpHasAV1:true`) mais la réponse serveur non (`remoteSdpHasAV1:false`)
  — même verdict que le stable. Pas de VP9 ni HEVC dans la réponse non plus.
- Liste RTP = la même pile navigateur (VP8/VP9×4/H264×9/AV1×2) — le
  navigateur est identique, seule la couche SDK diffère, et elle négocie le
  même H.264.
- Détail : 1440p @ **60 fps** sur Among Us (le fps dépend du jeu, pas du
  client — As Dusk Falls est en 30 fps).

**Conclusion codec (stable ET preview) : H.264 Constrained High par défaut,
rien d'autre proposé par le serveur. Le sujet codec est clos.**

## Feature v1.10.0 — 📡 Test de latence serveur (18 août ~21:30)

Bouton « 📡 Tester la latence des serveurs » dans le groupe **SERVER** des
settings globaux : ping chaque région gssv (`STATES.serverRegions`, la liste
réelle chargée par le client) via `NATIVE_FETCH` (le fetch ORIGINAL capturé
par le script — ni le hook BX_FETCH ni l'XcloudInterceptor), mesure le RTT
(timeout 3 s), affiche le tri du meilleur au pire et marque « ⭐ région
recommandée ». Objectif : choisir le meilleur `server.region` avec des
mesures réelles.

- Injection : `node bench/feature-latency.js <bundle.js> [--dry-run]
  [--self-test]` — déterministe, gates (GATE ROUGE si une ancre a dérivé),
  idempotent, self-test sur copie corrompue. À rejouer après chaque rebuild
  upstream (comme rebrand-bundle.js).
- ⚠ Pièges découverts en validation : (1) `shortName` contient l'emoji
drapeau (« 🇺🇸 EUS ») → l'hôte dérivé est invalide — utiliser **`baseUri`**
(`https://eus.core.gssv-play-prod.xboxlive.com`), le champ propre de la
région ; (2) l'XcloudInterceptor route les URLs finissant par
`/sessions/cloud/play` vers handlePlay → suffixe `?probe=1` + NATIVE_FETCH
pour une mesure pure ; (3) `networkTestHostname` (gssv-fastlane) ne résout
pas depuis ce PC — inutilisable. Libellés inline en anglais (pas de clé de
traduction) — traduction à ajouter si besoin.
- **Validé en réel (profil guard-badge, connecté, 19 régions)** : tous les
RTT réels, cohérents géographiquement — ⭐ CSE (Suède) 30 ms, WEU
(Pays-Bas) 41 ms, UKS (défaut) 43 ms, MXC 104 ms, Japan 804 ms. Preuve :
`bench/.latency-feature-proof.png`. Aucun timeout, < 1 s par région.

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

### Re-baseline du 18 août ~10:10 (post-harnais mobile, avant APK) — mêmes bornes

Harnais complet `run-all.sh` (sans `--cold-page-eval`) sur le build stable
courant (481 974 o, fixes document-start inclus) : **toutes les bornes CI
tiennent**, aucune régression depuis la séquence upstream.

| Harnais | perf10 | build | Verdict |
|---|---|---|---|
| Parse/compile | 0,103 ms | 0,104 ms | négligeable (sub-ms bruité) |
| Hot loop controller IDLE | 281,2 ns | 29,3 ns | ×9,6 [≥ 4] ✅ |
| poll_gamepad relâchement Home | 1 212,6 ns | 137,5 ns | ×8,8 [≥ 4] ✅ |
| updateCanvas (chemin 60 Hz) | 209,3 ns | 9,5 ns | ×22,0 [≥ 12] ✅ |
| updateFrame | 149,2 ns | 130,3 ns | stable [0,5–2] ✅ |
| Éval page (20 runs) | 20,0 ms méd | 17,3 ms méd (p95 28,4) | build plat, p95 ≪ borne 50 ms ✅ |
| Profil startup | one-shot codec 77,4 % | plat (76,8 % natif/GC) | différé intact ✅ |
| cold-getcap | 535,8 ms (one-shot) | eval 23,6 ms (Δ −95,6 %) | one-shot stable, 2e appel 0,1 ms ✅ |

Commandes exactes : `NODE_PATH=/d/Codex/koharu/node_modules bash bench/run-all.sh`
(Edge 152.0.4191.19 headless, profil D:\Codex\EvenBetterXcloud\edge-profiles).

### Re-baseline du 18 août ~01:00 (post-séquence upstream) — mêmes bornes

Harnais **complet** cette fois : `run-all.sh --cold-page-eval` (parse + hot
loops + éval page à froid + profil startup + cold-getcap), build stable
inchangé (481 772 o — la séquence de PR upstream n'a touché que le clone).
Verdict `check-ratios.js` : **PASS 6/6**.

| Harnais | perf10 | build | Verdict CI |
|---|---|---|---|
| Parse/compile | 0,123 ms | 0,110 ms | négligeable (sub-ms bruité) |
| Hot loop controller IDLE | 389,7 ns | 53,4 ns (30,2 au 2e run) | ×7,3–9,5 [≥ 4] ✅ |
| poll_gamepad relâchement Home | 1 448,6 ns | 168,2 ns | ×8,6 [≥ 4] ✅ |
| updateCanvas (chemin 60 Hz) | 268,8 ns | 12,6 ns | ×21,3 [≥ 12] ✅ + flag dirty (4 vs 860 004 uniform1f) |
| updateFrame | 187,7 ns | 181,8 ns | stable [0,5–2] ✅ |
| ACTIF / commun | — | — | 0,91–0,94 [0,5–2] ✅ |
| Éval page à froid (20 runs) | 630,8 ms | **24,6 ms** | build ≤ 50 ms ✅ · perf10 ∈ [300, 1200] ✅ (Δ −96,1 %) |
| Profil startup | `getSupportedCodecProfiles` 76,4 % | plat, 81,2 % natif/GC | one-shot différé intact |
| cold-getcap | 566,2 ms (one-shot) | eval 30,9 ms (Δ −94,7 %) | one-shot stable, 2e appel 0,1 ms |

### Re-validation du 19 août ~14:00 (post-réorganisation EvenBetterXcloud) — mêmes bornes ✅

Harnais **complet** `run-all.sh` (parse + hot loops + éval page 20 runs +
profil startup + cold-getcap) relancé depuis les nouveaux chemins
(`D:\Codex\EvenBetterXcloud\better-xcloud-fork`, workspace réorganisé) sur le
build stable v1.11.0 (487 269 o, feature « 📊 Données » incluse) vs perf10
(055d3a0). Verdict `check-ratios.js` : **PASS 6/6**. Aucune régression — la
réorganisation n'a rien cassé.

| Harnais | perf10 | build | Verdict CI |
|---|---|---|---|
| Parse/compile | 0,118 ms | 0,117 ms | négligeable (sub-ms bruité) |
| Hot loop controller IDLE | 378,4 ns | 40,7 ns | ×9,30 [≥ 4] ✅ (état haut) |
| poll_gamepad relâchement Home | 1 247,2 ns | 163,5 ns | ×7,63 [≥ 4] ✅ |
| updateCanvas (chemin 60 Hz) | 255,1 ns | 15,2 ns | ×16,78 [≥ 12] ✅ + flag dirty (4 vs 860 004 uniform1f) |
| updateFrame | 178,0 ns | 171,2 ns | stable [0,5–2] ✅ · ACTIF/commun 0,98–1,24 ✅ |
| Éval page (20 runs) | 29,9 ms méd (p95 640,4) | 26,1 ms méd (p95 36,9) | build ≤ 50 ms ✅ · écart médiane −12,7 % |
| Profil startup | `getSupportedCodecProfiles` 19,1 ms (75,7 %) | plat (71,9 % natif/GC) | one-shot différé intact ✅ |
| cold-getcap | 553,6 ms (one-shot) | eval 33,7 ms (Δ −94,0 %) | one-shot stable, 2e appel 0,1 ms ✅ |

### Re-baseline du 19 août ~15:30 (post-release v1.12.0 + feature région) — mêmes bornes ✅

`run-all.sh` complet (parse + hot loops + éval page + profil startup +
cold-getcap), build stable **v1.12.0** (489 673 o, feature « ⚡ Appliquer la
meilleure région » incluse) vs perf10 (055d3a0). Verdict : **PASS 6/6** —
aucune régression. Publication v1.12.0 + preview1 validée juste avant
(garde-fou 10/10, 4/4 liens byte-identiques).

| Harnais | perf10 | build | Verdict CI |
|---|---|---|---|
| Parse/compile | 0,123 ms | 0,128 ms | négligeable (sub-ms bruité, +3,8 %) |
| Hot loop controller IDLE | 312,2 ns | 38,1 ns | ×8,19 [≥ 4] ✅ |
| poll_gamepad relâchement Home | 1 405,7 ns | 162,8 ns | ×8,63 [≥ 4] ✅ |
| updateCanvas (chemin 60 Hz) | 272,9 ns | 13,1 ns | ×20,8 [≥ 12] ✅ + flag dirty (4 vs 860 004 uniform1f) |
| updateFrame | 176,2 ns | 150,9 ns | stable [0,5–2] ✅ |
| Éval page | 24,3 ms méd | 21,4 ms méd | build ≤ 50 ms ✅ · écart médiane −11,9 % |
| Éval page à froid (5 runs) | 574,9 ms | 25,6 ms (23,9–32,1) | build ≤ 50 ms ✅ · Δ −95,5 % |
| cold-getcap | 528,2 ms (one-shot) | eval 25,6 ms | one-shot stable, 2e appel 0,1 ms ✅ |

### Re-baseline du 19 août ~19:15 (post-doc-start APK + passe de cohérence) — mêmes bornes ✅

`run-all.sh` complet, build stable **v1.12.0** (inchangé) vs perf10 (055d3a0),
relancé après la validation mobile doc-start (APK preview) et la passe de
cohérence docs. Verdict : **PASS 6/6** — aucune régression, bornes CI tiennent.

| Harnais | perf10 | build | Verdict CI |
|---|---|---|---|
| Parse/compile | 0,125 ms | 0,135 ms | négligeable (sub-ms bruité, +8,4 %) |
| Hot loop controller IDLE | 364,4 ns | 34,8 ns | ×10,5 [≥ 4] ✅ |
| poll_gamepad relâchement Home | 1 406,8 ns | 196,2 ns | ×7,2 [≥ 4] ✅ |
| updateCanvas (chemin 60 Hz) | 239,9 ns | 14,2 ns | ×16,9 [≥ 12] ✅ + flag dirty (4 vs 860 004 uniform1f) |
| updateFrame | 187,8 ns | 185,7 ns | stable [0,5–2] ✅ |
| Éval page (20 runs) | 28,2 ms méd (p95 547,0) | 25,6 ms méd (p95 28,9) | build ≤ 50 ms ✅ · écart médiane −9,2 % |
| Profil startup | `getSupportedCodecProfiles` 18,42 ms (71,1 %) | plat (72,4 % natif/GC) | one-shot différé intact ✅ |
| Éval page à froid (5 runs) | 528,7 ms (505,0–532,4) | 33,9 ms (27,0–34,6) | build ≤ 50 ms ✅ · Δ −93,6 % |
| cold-getcap | 526,3 ms (one-shot) | eval 33,9 ms | one-shot stable, 2e appel 0,1 ms ✅ |

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

## Protocole figé (tables de ce fichier)

Les tables « Hot loops » et « Chargement » de ce fichier sont produites par ces
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
./bench/freeze.sh --update-readme    # régénère les sections de ce fichier EN PLACE
./bench/freeze.sh --update-readme=chemin.md --with-page-eval  # + éval page, autre cible
```

`freeze.sh` exécute exactement le bloc ci-dessus (mêmes commandes, mêmes
builds), puis `freeze-format.js` agrège (médiane des médianes + plage
inter-seeds) et imprime les sections « Hot loops » et « Chargement » de ce
fichier au format markdown, avec le label de version lu dans `@version`.

**État machine** (depuis la v1.6.0) : `freeze.sh` capture l'état GPU/CPU via
`bench/gpu/machine-state.js` (partagé avec le harnais GPU) avant et après
CHAQUE seed hotloops, dans `bench/state-cpu-s<seed>.{before,after}.json`
(gitignorés) — `--no-state` pour désactiver. Objectif : corréler la
**classification d'état haut/bas CPU** (ratio IDLE perf10/build : `bas` ≥ ~10,
`haut` ≤ ~9,5 — cf. tableau « Sessions hot loops » de ce fichier) avec
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

Détails des pièges de chaque harnais dans la section « Repro » de ce fichier.
Le harnais **GPU** (renderer WebGL2, compteurs GL, GPU timestamps) vit dans
**`bench/gpu/`** de ce repo (autonome : `gen-video.js`, `extract-class.js`,
`gpu-runner.js`, `agg-seeds.js`, `gpu-update-readme.js`, classes extraites ;
`test.webm` et `run-s*.json` gitignorés) — voir `bench/gpu/README.md` et la
section « Repro » de ce fichier.

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

## Benchmarks

Mesures **perf10 (baseline)** vs **v1.3.0**, même machine (Windows, Edge
headless, Node V8), harnais jetables dédiés. L'objectif n'est pas la précision
absolue mais la comparaison relative entre les deux builds.

### Chargement (parse + éval de page)

| Mesure | perf10 | v1.6.0 | v1.8.0 | Δ v1.8.0 vs perf10 |
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
| 19 août (v1.12.0, re-baseline) | 574,9 (520,8–613,1) | 25,6 (23,9–32,1) | −95,5 % | bas | ✅ |
| 19 août (v1.12.0, soir) | 528,7 (505,0–532,4) | 33,9 (27,0–34,6) | −93,6 % | bas | ✅ |

La série perf11 (re-mesurée sur le build v1.6.0 officiel) visait le **runtime**
(hot loops, GPU, caches), pas le chargement — confirmé v1.6.0 : coût de démarrage identique.

**Le chargement a été attaqué en v1.7.0** (éval paresseuse de `codecProfile`),
**conservé inchangé en v1.8.0** : `stream.video.codecProfile` était évalué
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
| 19 août (v1.12.0, soir) | 364,4 (328,1–409,4) | 34,8 (31,4–58,6) | **×10,5** | bas | 1406,8 → 196,2 (−86 %) |

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
> **v1.8.0 — shader USM 4 taps** (patch 22, release du 17 août) : le fragment
> shader WebGL2 passe de 9 fetches à une gaussienne 3×3 exacte en 4
> échantillons bilinéaires (±0,5 texel) — draw GPU **10,24 → 7,17 µs (−30 %)**
> (re-mesure seed 42 du build réel, identique au prototype sur les 3 passes) ;
> upload et wall **inchangés** (le patch ne touche que le shader). Équivalence
> visuelle validée (`bench/gpu/visual-diff.js`) : sharpness bit-identique
> (maxAbs 0), ≤ 0,002 % des pixels à ±1 ULP fp32 — gate CI au job gpu-upload.

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
| 17 août — build v1.8.0 USM (seed 42, re-mesure du build réel) | v1.8.0 | — | — | — | — | — | — | 10,24 vs **7,17** | draw ≤ 25,00 µs · émission ≤ 25,00 µs · wall ≤ 0,10 ms | ✅ |

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

- Le **draw** (rasterisation) coûtait pareil dans les deux versions (10,2 vs
  9,2 µs, ratio 1,1) — même shader ; **depuis v1.8.0**, le shader USM 4 taps
  (gaussienne 3×3 exacte en 4 échantillons bilinéaires au lieu de 9 fetches)
  le fait passer à **7,17 µs (−30 %)** côté build (perf10 inchangé, 10,24 µs),
  équivalence visuelle validée (gate CI).
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
**`bench/`** de ce repo (autonomes, cf. ce fichier) :

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
voir ce fichier.

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
version lu dans `@version`) — voir ce fichier. Avec
`--update-readme`, les sections « Hot loops » et « Chargement » sont
**régénérées en place** dans ce fichier (ancres `Notes :` / `La série perf11`
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

### Build ES2017 pour vieux WebView (`bench/es2017-build.mjs`)

Le bundle stable (`better-xcloud.user.js`) est buildé par bun en **ESNext**
(minify **syntaxe seule**, pas le whitespace). Un vieil Android System WebView
(Chrome < 80 : pas de `?.` / `??` / class fields) ne peut pas le parser → script
mort silencieusement. `bench/es2017-build.mjs` re-transpile le bundle en
**ES2017** avec esbuild (`bun bench/es2017-build.mjs`, sortie
`better-xcloud.es2017.user.js`) :

- **Header userscript préservé** (esbuild supprimerait `// ==UserScript==` en
  minifiant : le header est extrait avant transpile, ré-attaché après).
- Downlevel complet hors template literals : `?.` → ternaires, `??` → `||`,
  class/private fields → `defineProperty`/WeakMap. Les rares `?.` restants
  sont des **snippets de patches dans des template literals** (évalués dans le
  contexte du site, pas du script — non transpilables par esbuild).
- Vérifications intégrées : `node --check` implicite (le fichier est
  ré-écrit), compteurs de syntaxe ES2020+ résiduelle, header présent.

**Mesures (18 août, build v1.8.0, Edge 152)** :

| Build | Taille | Parse (Node) | Éval page (Edge) |
|---|---|---|---|
| `better-xcloud.user.js` (bun, ESNext) | 481 974 o | 0,110 ms | 23,1 ms |
| esbuild ES2020 (minify complet) | 399 693 o | — | 10,8 ms |
| esbuild ES2017 (minify complet) | 403 105 o | 0,092 ms | 11,4 ms |

- **Le downlevel seul coûte peu** : +3,4 Ko (+0,9 %) et +0,6 ms (+5,6 %)
  d'éval par rapport à l'ES2020 re-minifié esbuild (à minification égale).
- **Le vrai gain vient de la re-minification complète** : le build bun ne
  minifie que la syntaxe → esbuild `minify` (whitespace + identifiants)
  ramène 481 → 400 Ko (**−17 %**) et l'éval page 23,1 → 10,8 ms
  (**−53 %**), sans changer la cible ES.
- Verdict : l'ES2017 est un **sous-produit quasi gratuit** de la
  re-minification (gain de taille/startup identique à l'ES2020, coût
  downlevel +0,9 %/+5,6 %) — c'est le build à embarquer dans l'APK pour
  couvrir les vieux WebView **et** gagner sur tous les navigateurs.

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
les `bench/gpu/run-s<seed>.json` et remplace la table « GPU » de ce fichier
directement — équivalent de `--update-readme` côté GPU :

```bash
node bench/gpu/gpu-update-readme.js 100 200 300 400 500 600   # patche bench/README.md (défaut)
node bench/gpu/gpu-update-readme.js 100 200 300 400 500 600 --print-only
```

### Mobile — APK (émulateur, `bench/mobile-probe.sh`)

Harnais de validation rejouable de l'APK Android (`mobile/`), en une
commande : **build → install → lancement → adb forward → sonde CDP → cycle
panne→récupération**. Reproduit la validation du 18 août (overlay vérifié
dans le WebView + page d'erreur + retry auto) à chaque rebuild.

```bash
bash bench/mobile-probe.sh               # tout : build + install + sonde + cycle
bash bench/mobile-probe.sh --skip-build  # réutilise mobile/out/
bash bench/mobile-probe.sh --no-cycle    # sonde seule (sans le test panne→récup)
bash bench/mobile-probe.sh --manual      # récupération par clic « Réessayer » (au lieu du retry auto)
bash bench/mobile-probe.sh --serial emulator-5554
```

Ce que fait le script :

1. **device adb** — premier device `adb` connecté (`--serial` pour en choisir
   un autre) ; échoue proprement si aucun.
2. **build** — `mobile/build.sh` (asset = stable courant, keystore stable,
   gate dex).
3. **install + lancement** — `adb install -r` puis `am start` sur
   `com.bxperf.app/.MainActivity`.
4. **forward** — `adb forward tcp:9341 localabstract:webview_devtools_remote_<pid>`
   (le socket devtools du WebView, activé par
   `WebView.setWebContentsDebuggingEnabled(true)`).
5. **sonde CDP** (`bench/mobile-probe.js`) — vérifie `pathname /play`,
   `BX_EXPOSED=object`, `BX_FETCH=function`, `BX_CE=function`, bouton
   settings `.bx-header-settings-button` présent **et visible** ; GATE ROUGE
   (exit 1) si un point échoue.
6. **cycle panne→récupération** (`--cycle`, défaut) — navigue le WebView
   vers `https://www.xbox.com:444/` (port fermé → erreur réseau), attend la
   page d'erreur « Connexion impossible », puis le **retry auto à +5 s** et
   vérifie le retour sur `/play` avec l'overlay. Variante **`--manual`** :
   clic CDP sur le bouton « Réessayer » de la page d'erreur (le lien absolu
   vers START_URL) — la récupération manuelle quand le réseau revient ; le
   logcat confirme que le clic **annule le retry auto en attente**
   (`resetLoadState` avant le backoff de 5 s, pas de double navigation).
7. **logcat** — dernières lignes `EvenBetterXcloud` (trace du cycle
   `showErrorPage → scheduleAutoRetry → AutoRetry.run → resetLoadState`).

Test sans émulateur : `node bench/mobile-probe.test.js` valide la sonde et
les deux récupérations contre un **faux endpoint CDP** (mini serveur
WebSocket maison) — 5 cas : sonde OK, cycle OK, clic Réessayer OK, bouton
invisible → GATE ROUGE, aucune page xbox.com → GATE ROUGE.

**Validé en réel sur BlueStacks le 18 août** (`adb connect 127.0.0.1:5555`) :
les deux voies passent — retry auto (`MOBILE PROBE OK (… auto (+5 s))`) et
récupération manuelle (`… manuelle (Réessayer)`, `clic « Réessayer » → true`,
retour `/fr-FR/play` + overlay, logcat `resetLoadState`).

**Pièges rencontrés** (le 18 août, documentés pour les prochains runs) :

- `spawnSync` bloque l'event loop → le mock CDP (même process) ne répond
  jamais ; le test utilise `spawn` async.
- Le faux serveur WS doit **relire la longueur étendue 16-bit** des frames
  (un header `126` signifie « longueur sur 16 bits qui suit », pas une frame
  de 126 octets) — sinon les grosses réponses CDP sont mal découpées.
- Le probe doit faire un `process.exit(0)` explicite en fin de cycle : le
  handle WS/HTTP keep-alive du mock garde le process vivant sinon.

(ancré sur la ligne unique `| Appels GL par frame |` — la ligne `| Mesure |
perf10 | v… | Δ |` existe deux fois dans ce fichier, table Chargement incluse.
Seule la table est régénérée : le bullet « Protocole figé » de la section
« Lecture des résultats » reste curé car il documente protocole et sessions.)

### Session mobile transférée — `bench/mobile/` (Freebox Pop, 20 août)

Deux scripts pour la Freebox Pop (login natif bloqué par l'anti-bot
Microsoft, voir MEMORY.md) :

- **`session-transfer.js`** — copie le localStorage MSAL (clés `msal.*`)
  d'un appareil connecté vers un autre, même origine play.xbox.com :
  `node bench/mobile/session-transfer.js --from <serial> --to <serial>`
  (adb forward CDP + copie + verdict gamertag/Profil).
- **`token-ttl.js`** — mesure la durée de vie restante des tokens :
  `node bench/mobile/token-ttl.js <port-cdp>` (décode les JWT id/access et
  affiche l'expiration réelle du refresh token).

**Durée de vie mesurée en réel (20 août)** : le refresh token MSA du flux
Xbox a une fenêtre de **~19-24 h** (pas 90 j AAD) — émis 19/08 13:21 UTC,
`expiresOn` 20/08 08:32 UTC. Les id/access tokens font ~1 h et sont
rafraîchis automatiquement tant que le RT est valide. **Règle : re-transférer
depuis le téléphone si le transfert date de >12 h, ou si `token-ttl.js`
annonce un RT à <6 h restantes.**

**Piège documenté** : le transfert de ce matin a copié un RT déjà expiré
(30 min restantes) — la session Freebox a tenu grâce à l'accessToken copié
(exp 13:26 UTC) puis sera morte au premier refresh. Toujours vérifier avec
`token-ttl.js` après un transfert.

### Mode « Importer la session » dans l'APK (20 août ~11:00) — sans ligne de commande

La feature **« 📥 Session »** (groupe des settings globaux, visible même
DÉCONNECTÉ — c'est son but) remplace la ligne de commande pour transférer la
session entre appareils du même WiFi :

- **« 📥 Importer la session »** (receveur, ex. Freebox) : appelle le bridge
  Android `window.BXSessionImport.startServer()` → mini serveur HTTP LAN
  (port 8765, code à 6 chiffres, CORS) → affiche l'URL à saisir sur le donneur.
- **« 📤 Envoyer la session »** (donneur, ex. téléphone) : lit le localStorage
  (clés msal.*) et l'envoie via `window.BXSessionImport.send()` — le POST
  passe par **Java** (HttpURLConnection), pas fetch : le fetch de la page vers
  http://LAN est bloqué par le mixed content (MIXED_CONTENT_NEVER_ALLOW).
  L'URL du donneur est mémorisée (localStorage BX_SESSION_IMPORT_URL).
- Le receveur écrit le localStorage quand la page est sur l'origin du donneur
  (sinon navigation différée via `PendingImport` + onPageFinished) puis reload.

**Pièges rencontrés** (20 août, validés en réel sur la Freebox) :

- **Cleartext HTTP** : Android 9+ bloque le HTTP en clair →
  `usesCleartextTraffic="true"` dans le manifest (le site xbox.com reste
  https ; le cleartext ne concerne que le POST LAN).
- **Commentaire XML cassant aapt2** : un commentaire dans le template de
  manifest avec caractères spéciaux faisait échouer le link (invalid token) —
  garder les commentaires du manifest minimalistes.
- **Filtre « rendu déconnecté » partagé** : datasaver (data) avait étendu le
  filtre ; session l'étend encore (data+session). feature-datasaver.test.js
  vérifie maintenant le PRÉFIXE (sound+data) et strippe par regex — robuste
  aux extensions postérieures.
- **État transitoire post-install** : juste après `adb install -r` + relance,
  la 1re page peut avoir le marqueur `__EBX_INJECTED` sans le bundle exécuté
  (cache) — un reload règle l'injection complète.
- **Conflit de port entre les deux APK** (stable + preview installés côte à
  côte sur le même appareil) : chacun peut lancer son serveur d'import — le
  premier bind 8765, le second essaie 8766… (+10 max) via la boucle
  `SessionImportServer`. Le port réellement bindé est renvoyé dans `describe()`
  (`"port":8766`), donc l'URL affichée est toujours la bonne.

Gates : `bench/feature-session-import.test.js` (présence stable+preview,
ancres, rejeu + self-test) branché au step preview de bench.yml. La feature
est injectée dans le stable (`node bench/feature-session-import.js
better-xcloud.user.js`) et héritée par le preview (build-preview.js).

**Validé en réel (Freebox, 20 août ~11:05)** : startServer →
`http://192.168.1.24:8765/import/<code>` ; POST (curl puis bridge `send()`
Java) → `{ok:true}` → clé écrite dans le localStorage de la WebView → reload
→ profil + gamertag affichés. Le vrai flux téléphone → Freebox reste à
rejouer une fois le téléphone re-branché (mécanisme identique).

**E2E cross-APK (20 août ~11:20, session autonome)** : les DEUX APK sur la
Freebox avec le fix de port — preview (donneur, session play.xbox.com
réelle) → `send()` Java → stable (receveur, même origine) : 4 clés msal
écrites, cookies de session régénérés (XBXXtk, xbl_pa, ASLBSA). Serveurs
simultanés : stable 8765 + preview 8766, les deux répondent `{ok:true}` — le
fallback de port est validé.
