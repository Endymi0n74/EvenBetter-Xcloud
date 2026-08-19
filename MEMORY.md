# MEMORY — état courant du projet (19 août 2026)

Mémoire de travail des sessions. Détails dans `bench/preview/port/session.md`
(étude protocole), `bench/preview/port/e2e-cdp.md` (protocole E2E + journal),
`bench/preview/port/anchors.md`, `bench/preview/port/classify.md`.

## Discipline de mémoire

L'utilisateur demande une mise à jour de ce fichier **au moins toutes les
~2 h de travail cumulé** (et à chaque fin de session), sans attendre d'être
relancé : après ~2 h d'actions, journaliser l'état (fichiers touchés,
verdicts, pièges nouveaux, en attente). Dernière passe : 19 août ~16:00
(15 PR ouvertes #1006/#1007, garde-fou 4/4 vert, audit MEMORY, décision
preview non-proposable + brouillon de commentaire).

## Réorganisation du workspace (19 août ~11:30) — tout sous EvenBetterXcloud

Plus rien de nos outils à la racine `D:\Codex` ni à `D:\edge-profiles` :
- `D:\Codex\EvenBetterXcloud\better-xcloud-fork` (repo de travail — déplacé),
  `…\better-xcloud-upstream` (clone amont PR), `…\bx-apk` (build APK +
  keystore), `…\bx-android-ref` (référence Android).
- `…\edge-profiles\` (edge-cdp, guard-badge, datasaver — venus de
  `D:\edge-profiles`).
- `…\artifacts\` (banner-dl, badge-proof png, anciens bundles/APK),
  `…\legacy\` (anciens harnais v1.6 : gpubench, patches, regen*, …).
Chemins mis à jour dans : verify-badge.js (DL_DIR/proof/load-extension),
update-startup-session.js, gpu-update-readme.js, mobile/build.sh
(ORIG_KEYSTORE), mobile/README.md, upstream-prs/README.md, MEMORY.md,
bench/README.md. ⚠ Piège : `D:\Codex\.git` est le repo git du projet
utilisateur ratio-spoof-manager-tauri — ne pas y toucher (rien de nous n'y
est tracké). ⚠ Le dossier vide `D:\Codex\better-xcloud-fork` (verrou
Windows : cwd d'un process) reste tant que la session n'est pas finie — il
est VIDE et sans conséquence. Edge de test relancé depuis
`D:\Codex\EvenBetterXcloud\edge-profiles\datasaver` + extension
`.edge-inject-stable` (dans le repo) : feature-datasaver-probe 20/20 vert
après le déplacement.

## v1.11.0 — Feature « 📊 Données » (presets débit/résolution) — 19 août

- **Feature utilisateur** (hors perf, la queue JS étant au plancher) :
  `bench/feature-datasaver.js` injecte un groupe « 📊 Données » dans les
  settings (pattern feature-latency : gates + self-test + idempotence).
  3 presets basés sur nos mesures réelles : 🚀 Max (illimité),
  ⚖️ Équilibré (cap 10 Mbps, 1440p conservé) et 🌱 Économe (5 Mbps + 720p).
  Visible même déconnecté (ajout au filtre renderFullSettings=false).
- **Piège storage** : `stream.video.*` sont des prefs **GLOBALES**
  (ALL_PREFS.global) — `getStreamPref`/`setStreamPref` THROWE pour ces clés
  (définitions absentes du storage stream). Utiliser
  `getGlobalPref`/`setGlobalPref(key, value, "ui")`.
- **Piège maxBitrate** : la pref a `transformValue` (max slider 15360000 ↔
  stocké 0 = illimité). Écrire 0 → clampé à 102400 (min) ! Le preset « Max »
  écrit **15360000** (la forme get persistée par setSetting est 15360000,
  équivalente au défaut 0 — le stocké 0 n'est que le défaut initial).
- **Validé en réel** (Edge guard-badge, `feature-datasaver-probe.js`) :
  15 checks verts — groupe rendu, 3 presets, clic Équilibré → prefs posées
  (10240000/auto, persisté), restauration Max → 15360000 (illimité).
  Piège extension : `stable.js` est lu au **démarrage** d'Edge — copier le
  bundle ne suffit pas, il faut relancer Edge (ou le fichier est servi
  périmé ; un onglet restauré de session peut aussi ne pas re-injecter).
- **Build-preview.js** : les ancres `@version` et header OPTIMISATIONS
  étaient durcies à 1.10.0 → rendues **dynamiques** (stableVersion extraite
  du bundle source) pour survivre aux bumps.
- **Bump centralisé** `bash bench/bump-version.sh 1.11.0` : stable 1.11.0,
  es2017 −16,2 %, preview 1.11.0-preview1 (rebuild build-preview + probes
  OK), metas, manifest versionCode 5. APK stable (es2017 embarqué) +
  preview rebuildés. README FR/EN mis à jour (table Deux versions →
  1.11.0 / 1.11.0-preview1).
- **⚠ Piège CDN GitHub (nouveau, 19 août)** : juste après une publication, le
  lien public `releases/download/<tag>/better-xcloud.user.js` peut 404
  (XML Azure `BlobNotFound`) pendant **plusieurs minutes** — le redirect
  302 du CDN pointe vers un blob stale (les autres assets du même tag
  servent 200, et l'API `Accept: application/octet-stream` sert le bon
  blob). Le garde-fou release peut donc **faux-positiver** immédiatement
  après une publication : attendre ~10-30 min puis relancer
  `bash bench/release-guard.sh`. Si le 404 persiste : supprimer/recréer la
  release (le tag reste) et re-tester. Autre piège : le rename `#` de
  `gh release create`/`upload` ne fonctionne PAS avec des chemins relatifs
  (l'asset garde le nom source) — passer par des copies /tmp avec le nom
  cible exact.

## v1.11.0-preview2 — icône APK officielle + fix overlay preview (19 août ~13:00)

- **Icône APK depuis le logo officiel** (fourni par l'utilisateur, banner
  1024×559 « EvenBetterXcloud ») : `mobile/gen-icon.js` réécrit — décodeur
  PNG pur Node (zlib + unfilter), découpe de l'emblème (anneau + X vert,
  détecté x 341-681 y 44-384, centre (511,214), texte sous le cercle exclu),
  512×512 coins arrondis, repli sur l'ancienne icône procédurale si le
  banner manque. Source committée : `mobile/assets/evenbetterxcloud-logo.png`
  (exception .gitignore `mobile/assets/*` + négation — un répertoire exclu
  ne peut PAS ré-inclure un fichier dedans).
- **Fix overlay preview — « des fois pas de menu »** : reproduit en WebView
  (BlueStacks, 390 px) — quand le shell preview remplace le document
  (document.open au démarrage du stream), l'observer T4 meurt (il observe
  l'ancien body) et le FAB ne revient JAMAIS (reproduit : FAB false après
  remplacement, sans fix). Fix dans build-preview.js : `arm()` réutilisable
  (re-crée l'observer sur le document courant) + point 3 dans l'interval T7
  (re-arm si documentElement change d'identité + ré-injection tryInject si
  wrapper détaché). Validé en réel BlueStacks : FAB revient en 7 s après
  document.open, clic → dialog OK. Tests CI (feature-datasaver, t10,
  keepalive, self-test) verts.
- **Livré** : commits `1283528` (self-test feature-datasaver + fix CRLF/LF)
  et `f2ea3ce` (icône + fix T4 + bundle preview2), poussés. Release
  `evenbetter-xcloud-v1.11.0-preview2` (bundle preview2 + meta + APK),
  APK stable re-uploadé sur v1.11.0 avec la nouvelle icône (les DEUX noms
  d'asset : versionné + stable, mêmes bytes). Garde-fou 10/10 vert, rétention
  OK (v1.11.0 + preview2 + preview4 secours).
- **Piège build** (rappel) : `VARIANT=preview bash mobile/build.sh` purge
  `mobile/out/` (rm -rf $OUT) → l'APK stable builté avant est perdu.
  Toujours rebuild le stable APRÈS le preview, ou copier l'APK stable avant.
- **Restant utilisateur** : tester preview2 sur téléphone — si l'écran noir
  vidéo persiste (le menu, lui, est corrigé), capturer logcat
  (`adb logcat -s EvenBetterXcloud`) pendant le stream noir pour diagnoser.

## Gate CI feature-datasaver — validation PR #17 (gate ROUGE en réel, 19 août)

- **`bench/feature-datasaver.test.js` branché au step preview de bench.yml**
  (job `hotloops-ratios`, étape « Build preview — contrat deux versions ») :
  présence feature stable+preview, ancres d'injection extraites DEPUIS
  feature-datasaver.js (une const renommée = extraction échoue = rouge),
  rejeu d'injection + self-test sur copie strippée.
- **Validation ROUGE en réel (PR #17 `ci/control-gate-datasaver`)** : ancre
  `ANCHOR_GROUP` corrompue dans le bundle stable (`t("server")` →
  `t("server_CHANGED")`, 1 occurrence — scénario « rebuild dérivé »).
  - Pré-validation locale : 3 échecs, exit 1.
  - Run CI push `32237377296` : job `hotloops-ratios` → **failure** au step
    « Build preview », log : `❌ ancre groupe server ×1 :: n=0`,
    `❌ copie sans feature obtenue (injection inversée, ancres revenues)`,
    `❌ rejeu non exécuté (strip invalide)`, `3 échec(s) Feature Data saver`.
  - PR fermée avec commentaire de validation, branche supprimée (local +
    distant), run PR orphelin resté « queued » annulé. main == origin/main.
- **`--self-test` (commits 1283528)** : corrompt l'ancre ANCHOR_GROUP sur une
  COPIE temporaire et vérifie le GATE ROUGE (exit 0 si détecté, bundle réel
  intact) — le chemin d'échec est rejouable localement sans PR de contrôle.
  ⚠ Piège CRLF/LF découvert en route : le bundle sur disque est CRLF
  (autocrlf Windows) vs source LF → normalisation avant comparaison, et
  regex `([^]*?)` au lieu de `[\s\S]`.

## Harnais preview — réécriture injection (18 août ~07:00)

- **`inject-preview.js` réécrit en WebSocket CDP brut + wrapper IIFE** :
  Playwright `newCDPSession` + `Page.addScriptToEvaluateOnNewDocument` ne
  fonctionne PAS sur Edge 152 (script jamais appliqué aux nouveaux
documents — vérifié par tests croisés ; le CDP brut WS, si).
  **Wrapper IIFE obligatoire** (mécanique Tampermonkey) : le preview
  déclare des classes top-level (`HeaderSection`, `KeyHelper`…) qui
  **collident avec les bundles ESM du site** en injection directe et
  cassent l'évaluation des modules (page blanche, `scripts:0`). Le probe
  ne lit que `BX_FETCH`/`BX_EXPOSED`/`BX_CE` (assignés à window) → IIFE
  sûr.
- **Fixes document-start dans le build** (les deux se produisent quand
  `document.documentElement` est null — jamais en Tampermonkey, mais le
  contexte d'injection CDP les expose) :
  - `BxSelectElement.ensureObserver()` : `observe(document.documentElement
    || document, …)` — crash « parameter 1 is not of type 'Node' » qui
    tuait `main()` avant le hook fetch → « aucun overlay ».
  - `addCss()` : `if (document.documentElement) …appendChild($style);
    else document.addEventListener("DOMContentLoaded", …)` — le premier
    fix `|| document` (append direct sur le noeud document) **corrompait
    l'arbre et vidait la page** (page blanche, uniquement notre `<style>`,
    `scripts:0` — bisect 4 variantes : control/full/noaddcss/orig).
    Le différé DOMContentLoaded est le bon fix : site boot 3297 nodes +
    hook fetch installé.
- **Validation finale sur profil D:** (18 août ~07:20) : injection WS brut
  document-start sur onglet play.xbox.com neuf → site boot complet
  (3297 nodes, 7 scripts), `bxFetch: function`, bouton présent. Les 4
exceptions restantes viennent toutes du **document initial about:blank**
(hostname vide → garde « Not xCloud page » + 3 fetch) — bruit attendu sur
profil déconnecté, zéro exception sur la page réelle.
- **Profil de test sur D:** (18 août) : `D:\Codex\EvenBetterXcloud\edge-profiles\edge-cdp`
  (plus jamais C:\edge-*) ; relance Edge : `powershell -Command
  "Start-Process '…msedge.exe' -ArgumentList
  '--remote-debugging-port=9222','--user-data-dir=D:\Codex\EvenBetterXcloud\edge-profiles\edge-cdp',
  '--no-first-run'"`.

## Projet

Fork better-xcloud (redphx) avec **deux versions contractuelles** :
- `better-xcloud.user.js` (stable, www.xbox.com) — upstream.
- `better-xcloud-preview.user.js` (preview, play.xbox.com) — build depuis le
  stable via `bench/preview/port/build-preview.js` (transforms T1-T6).
  `@name`/`@version`/`@updateURL`/`@match` disjoints (invariants au build).

Bench rejouable : `bench/` (CPU/GPU/startup) + `bench/preview/` (portage).

## État preview (17 août)

- **T6** : garde « Not xCloud page » neutralisé sur preview (il tuait `main()`
  → « aucun overlay » constaté sur preview1).
- **P2/P3 réécriture** (XcloudInterceptor, hook fetch posé en document-start) :
  prouvée en vm (fetch-early 17/17, userscript-rewrite 14/14) ET **actifs en
  réel** (chaîne `window.fetch` = hook T5 → `BX_FETCH` → NATIVE_FETCH, SDK
  capture la chaîne). Play : `osName=tizen` (1080p) + `x-ms-device-info`.
  Réponse `/configuration` : fusion `enableVibration`/mkb/mic dans
  `clientStreamingConfigOverrides` (schéma Zod validé — p2-schema.test.js).
  **A/B P3 mesuré 17 août** : résolution (contrôle propre GUID neuf
  1156AA48, `observe-play.js`) ET bitrate (`bitrate-check.js`, 3 échantillons
  ×12 s par profil) — natif windows = **1920×1080 @ 60 fps, ~5,95 Mbps**,
  tizen = **1920×1080 @ 60 fps, ~5,75 Mbps** → **P3 sans gain mesurable en PC
  cloud gaming** (résolution ET bitrate identiques).  **Décision : retirer
  l'override osName=tizen — APPLIQUÉ au build preview3 (17 août)** : patch T8
  de build-preview.js (condition de réécriture → `if (false)`, le play part
  natif) ; `intercept-session.js` devient **observateur passif** (`[P3] play
  observé → osName=… · device-info os=…`, continué SANS modification) ;
  `userscript-rewrite` vérifie le play inchangé + P2 toujours fusionné. P2
  (fusion /configuration) reste le vrai bénéfice ; `--resolution` est un
  no-op documenté. Les fonctions de réécriture restent en référence (tests). **Validé en réel (preview3, 17 août ~19:30,
  profil edge-cdp)** : extension `.edge-inject` à jour, overlay + settings OK
  (bouton `nav.col-container`, dialog « Better xCloud 6.7.12 »), play
  observé **natif** (`[P3#1] osName=windows, non réécrit`) — journal :
  e2e-cdp.md « Validation preview3 en réel ». Piège reprise : le slot de session est lié au
  compte/titre — navigation home, redémarrage Edge ET `session.disconnect()`
  ne changent pas le GUID (7C346491 persistant) ; seul un 2e onglet (kick) ou
  un long délai libère le slot.
- **T9 — settings dans la game bar (17 août ~21:45, build preview4)** : la
  page stream du preview est immersive, SANS `<nav>`/header (navs:[] observé)
  → le T4 n'a pas d'ancre en session, settings inaccessibles en cours de
  jeu. Fix (build-preview.js, preview-only) : `SettingsAction extends
  BaseGameBarAction` (engrenage `BxIcon.STREAM_SETTINGS`, title
  « Settings », onClick → `SettingsDialog.getInstance().show()`) injectée en
  2e position de `this.actions` du GameBar. **Validé en réel** (profil
  edge-cdp, Halo CE) : bouton dans la bar, dialog complet ouvert en stream
  (498×1440, 5 onglets, 66 lignes), Escape ferme, session intacte. Journal :
  e2e-cdp.md « T9 ».
- **P1 keep-alive idle** : `keepalive-idle.js` (T5). **Verdict 16 août** : le
  module StreamSessionRequest est chargé en **ESM natif** → le hook fetch ne
  peut pas se brancher ; **wrapSession est la seule voie runtime**.
  **Localisation résolue 17 août** : la session est dans l'état React du
  stream (fibre `.Connection` → chaîne `memoizedState.next…` →
  `memoizedState.data._session`, objet avec sendKeepAlive +
  onServerDisconnectMessage) — outils find/dump/hunt-session.js + **locator
  auto dans le build** (walk par forme, wrap dès montage, 16/16 tests).
  `session.stream` null si stream fermé (le gate getInputChannel() de
  sendKeepAlive ne s'applique qu'en stream actif). Le heartbeat natif
  /keepalive (60 s) est complémentaire (connexion), pas un substitut
  (timer d'idle = inactivité utilisateur).
- **hookActif en réel (edge-cdp)** : le profil NE PEUT PAS exécuter d'userscript
  (Tampermonkey MV3 exige le mode développeur d'Edge, inactivable en CDP).
  Solutions : (1) mini-extension `.edge-inject/` (`content_scripts` +
  `world:"MAIN"` + `document_start` — équivalent `@grant none`), lancée avec
  `--load-extension=…\.edge-inject` ; (2) **`inject-preview.js` (WS brut
  + IIFE, 18 août)** — le Playwright `newCDPSession` n'applique pas
  `addScriptToEvaluateOnNewDocument` sur Edge 152 ; le WS brut si.
  **Wrapper IIFE requis** (collisions de classes top-level avec les bundles
  du site) ; les crashs document-start (`ensureObserver`, `addCss`) sont
  corrigés dans le build (voir section « Harnais preview »).

## Protocole E2E (e2e-cdp.md)

- **Étape 0** (hors-navigateur, avant les runs CDP) : `run-e2e0.sh` — gates
  A fetch-early / B userscript-rewrite / D play-chain (échec si rouge) + probe
  C (info par défaut).
  - **`--strict-probe` = gate C dur** : exige `hookActif:true` (navigateur
    injoignable, hookActif:false ou Playwright absent → exit 1 + GATE C ROUGE).
    **Usage** : session réelle exigeant la preview T6 active avant un run CDP.
  - **`--self-test`** : rejoue le chemin d'échec sur une COPIE corrompue du
    build (GATE A/B ROUGE + exit 1 vérifiés, build réel intact).
  - **`--skip-probe`** : CI (pas de navigateur CDP sur le runner).
  - **Critère de départ des runs T6 (Run 1, P1-B) : `run-e2e0.sh
    --strict-probe` exit 0 = A+B+C+D avec hookActif:true, sinon AUCUN run**
    (section « Critère de départ » d'e2e-cdp.md). Exceptions : Run 0 témoin
    (hookActif:false OK). Exécutions journalisées : 1-3 + run strict 17 août
    (A+B+C+D, hookActif:true).
- **Run 1 CDP** : `intercept-session.js --connect=9222` — `[P3]` play réécrit,
  `[P2-staging]` puis `[P2]` sur la réponse /configuration (C4 =
  `enableVibration:true` dans Network, preuve CDP). **P2 VALIDÉ en réel**
  (17 août ~12:43, run 1 exécution 3 — preuve session live
  `_configuration.inputConfiguration.enableVibration:true`, voir item 2 de
  « En attente »). Prérequis : Étape 0 `--strict-probe` passée.
- **P1 réel** : `monitor-idle.js` — **DÉCISION CLÔTURÉE** (17 août) : fenêtre
  1 h survivante sans warning → seuil d'idle > 60 min, wrapSession branchée
  (`wrapped:true`), risque résiduel accepté (voir item 3 de « En attente »).

## État stable v1.8.0 — RELEASED (17 août)

- **USM 4 taps WebGL2 intégré** (patch 22) : re-mesure seed 42 du **build réel**
  (`gpu-v170-usm-webgl2player.txt`) — draw 10,24 → 7,17 µs (**−30,0 %**),
  identique au prototype. Patch généré dynamiquement
  (`patches/gen-patch-22.js`) : numéro de ligne calculé depuis le patch global
  (283, pas 281 codé en dur) + **hunk 3 lignes avec contexte** (un hunk
  zéro-contexte est refusé par git apply sur ligne géante même contenu
  identique). Piège : `git apply` **hors repo no-op silencieusement** — lancer
  depuis la racine du repo.
- **USM WebGPU : REJETÉ** — 4 taps mesuré **PLUS LENT** sur Dawn/D3D12 (s42
  +7,1 %, s99 +3,0 % ; harnais `gpu-runner-webgpu.js`, batch hors-écran 1080p,
  `onSubmittedWorkDone` car timestamp queries mortes sur Edge 152). Le gain
  WebGL2 était spécifique à ANGLE/D3D11. Build reverté, pas de patch 23 —
  le shader WebGPU garde le 9 taps.
- **Validé visuellement** (`bench/gpu/visual-diff.js` + `report-html.js`) :
  gate v1.6.0 (9 taps) → v1.8.0 (4 taps) sur texte fin — identité sharpness 0
  bit-identique (maxAbs 0), équivalence ±1-ULP fp32 sur ≤ 0,002 % des pixels
  (640×360 et 960×540). Le diff perf10 → v1.8.0 (maxAbs 44-74, ~0,4 %) vient
  du chemin d'upload (texImage2D → texStorage2D/RGB8), pas du patch 22.
  Sortie images par cas (screenshots 3 variantes, diff mask, montage, heatmap
  16×9 → `shots/`) + rapport HTML autonome (base64). Seeks ordonnés en t
  croissant + retry + échec dur (seek arrière → currentTime remis à 0).
- **Gate CI gpu-upload** : visual-diff (exit 0/1) + report-html (`if:
  always()`) + artefacts visual-diff-<sha> (rapport + shots/) — validé E2E le
  17 août (dispatch 32026644870 : protocole ×1,80, gate visuel PASS).
  **RESTE pour boucler la v1.8.0** : sanity check session réelle optionnel.

## Releases & pipeline de publication

- **ÉTAT COURANT (19 août ~14:30)** : **v1.11.0** (Latest,
  `evenbetter-xcloud-v1.11.0` — user.js ES2017 + meta + APK versionné +
  APK stable) · **1.11.0-preview2** (`evenbetter-xcloud-v1.11.0-preview2` —
  preview user/meta + APK) · **1.8.0-preview4** (cran de secours). 4/4 liens
  d'auto-update 200 + byte-identiques (garde-fou vert, relancé après la
  publication preview2). Les paragraphes ci-dessous sont l'historique depuis
  le 17 août — la section « En attente » + `upstream-prs/README.md` portent
  l'état vivant.
- **État au 17 août ~23:30 (rétention appliquée, historique)** : 12
  anciennes releases purgées (v1.0.0 → v1.7.0 stables, 1.7.0-preview1,
  1.8.0-preview1/2/3).
  Restent : **v1.8.0 (stable, Latest)** — tag `better-xcloud-perf-v1.8.0`,
  assets `better-xcloud.user.js` + `better-xcloud.meta.js`, auto-update
  `releases/latest/download/*` ; **1.8.0-preview4 (preview courant)** — tag
  `better-xcloud-perf-1.8.0-preview4`, assets `better-xcloud-preview.*`,
  auto-update preview **pinné sur SON tag** (jamais le latest — un utilisateur
  d'une preview ANCIENNE réinstalle manuellement).
- **Rétention automatisée** : `bench/release-prune.sh` — garde Latest + **les
  2 derniers previews** (tri par VERSION numérique, jamais `publishedAt`
  trompeur pour une release recréée) + le tag pinné par le `@updateURL` du
  build local, purge le reste (release + tag, `--cleanup-tag`), vérifie les 4
  liens d'auto-update (GATE ROUGE si 404), `--dry-run` pour prévisualiser. À
  lancer après chaque publication (le workflow `release-prune` le fait
  automatiquement sur `release: published`). **Testé en réel (17 août ~23:10,
  release de contrôle preview10)** : le tri par VERSION choisit bien
  preview10 (et non preview4 — piège lexicographique « 1 » < « 4 ») +
  conserve le pinné preview4 ; le test a révélé que le bit exécutable du
  script n'était PAS versionné (100644 → Permission denied sur le runner
  Linux, workflow en échec) — corrigé (`git update-index --chmod=+x`,
  commit `d7878e0`), workflow rejoué en success. Release de contrôle
  supprimée, état revenu à v1.8.0 + preview4.
- **Pipeline d'une release** (répéter à chaque bump) :
  1. Bump stable : `bash bench/bump-version.sh <v>` (VERSION racine + bundles
     + metas + manifest APK versionCode + es2017) — source unique depuis
     v1.11.0.
  2. Bump preview : `build-preview.js` — **une seule ancre** :
     `PREVIEW_VERSION` (les ancres `versionAnchor`/`headerAnchor` sont
     DYNAMIQUES depuis v1.11.0 — extraites du bundle source, plus de hardcode
     1.10.0).
  3. Rebuild : `node bench/preview/port/build-preview.js` (invariants deux
     versions + node --check + probes + P1 self-test sur le bundle capturé).
  4. Commit + push, puis `gh release create` (stable : défaut Latest ;
     preview : `--prerelease`) avec les 2 assets .user.js + .meta.js.
  5. **Rétention AUTOMATIQUE** : le workflow `release-prune` (bench.yml à
     côté) se déclenche sur `release: published` et exécute
     `bench/release-prune.sh` — garde Latest + **le dernier preview**
     (tri par version), purge le reste (release + tag), vérifie les 4 liens
     (GATE ROUGE si 404). `workflow_dispatch` pour une re-purge manuelle /
     un contrôle.
- **Incident 18 août ~17:00 — release v1.9.0 disparue** : après la
  suppression de la release de contrôle 1.9.1, `gh release edit … --latest`
  a fini par **supprimer la release v1.9.0 ET son tag** (plus que preview1 +
  preview4 → tous les liens `releases/latest` en 404, auto-update mort).
  Détecté via le badge « Better xCloud 6.7.12 » encore affiché (ancien
  script). **Restauré** : recréation du tag/release `evenbetter-xcloud-v1.9.0`
  (Latest) avec assets corrects — ⚠ piège `gh release upload
  'fichier#newname'` **non supporté** (monte sous le basename) → upload sous
  `/tmp/better-xcloud.user.js` pour forcer le nom. Politique v1.8.0
  confirmée : l'asset `better-xcloud.user.js` = **bundle ES2017** (403 394 o).
  Vérifié : 5/5 liens 200 + byte-identiques (sha256), CDN propagé immédiat.
  **Bannière Android rebrandée** dans la foulée : « 🔥 EvenBetterXcloud app
  for Android » → `…/releases/latest` (fin du lien vers l'app officielle
  `better-xcloud.github.io/android`), propagée aux 3 bundles + 2 APK
  (commit `23e8601`). ⚠ Prochaine migration du badge chez l'utilisateur :
  l'ancien script (badge « Better xCloud 6.7.12 ») tourne encore dans son
  Greasemonkey — désinstaller l'ancien, réinstaller depuis
  `releases/latest/download/better-xcloud.user.js`, recharger.
- **Garde-fou quotidien (18 août)** : `bench/release-guard.sh` + workflow
  `release-guard.yml` (cron 05:17 UTC + dispatch) — détecte une disparition
  silencieuse de release : pas de Latest, tag orphelin, lien 404, bytes servis
  ≠ bundle du commit tagué, version/name incohérents, APK 404. Badge
  « release guard » dans les README. Validé : run CI 32156497961 success,
  chemin d'échec testé (exit 1). ⚠ Piège CI : `gh` sur le runner exige
  `GH_TOKEN: ${{ github.token }}` explicite (le fallback implicite sur
  GITHUB_TOKEN a échoué au 1er run — erreur avalée par 2>/dev/null,
  maintenant propagée dans le GATE ROUGE). ⚠ Piège CRLF : le blob git des
  bundles est en LF (autocrlf=true) mais les releases sont publiées depuis un
  working tree Windows CRLF — toute comparaison sha doit normaliser CRLF→LF
  des deux côtés (fait dans le garde-fou). Tag preview1 réaligné sur main
  (servait des assets plus récents que son commit 6c1b42a → forcé sur
  077297e).
- **SmartScreen supprime l'APK téléchargé (18 août)** : dans un Edge piloté
  par CDP, le clic sur la bannière télécharge bien l'APK (événements
  `Browser.downloadWillBegin` + `downloadProgress` 135788/135788 o reçus)
  puis le téléchargement est ANNULÉ et le fichier retiré (hub « fichier
  supprimé ») — vérification de sécurité d'Edge sur les APK. La preuve de
  téléchargement passe donc par les événements CDP + le sha de l'asset servi
  (vérifié par release-guard), jamais par le fichier sur disque.
- **Lien stable de l'APK (18 août)** : la bannière Android du script
  (« 🔥 EvenBetterXcloud app for Android ») pointe vers
  `releases/latest/download/evenbetter-xcloud.apk` (téléchargement DIRECT,
  fini la page des releases). ⚠ **À chaque publication, uploader l'APK sous
  le NOM STABLE `evenbetter-xcloud.apk`** (en plus du nom versionné
  `evenbetter-xcloud-<v>.apk`) — sinon ce lien casse au prochain bump. Le
  garde-fou release-guard vérifie ce lien ET que le nom stable sert les
  MÊMES bytes que le nom versionné (un oubli de re-upload du nom stable au
  bump = GATE ROUGE « APK stable ≠ versionné »). Tags v1.9.0 + preview1
  réalignés sur
  `4261a42` (commit bannière → APK direct) pour garder l'invariant
  tag=bytes-servis.
- **CAUSE RÉELLE des deux disparitions de la v1.9.0 (18 août) — auto-prune !**
  Pendant le test du cycle bannière (release de contrôle 1.9.1 publiée), le
  workflow `release-prune.yml` (déclenché sur `release: published`) a purgé
  la v1.9.0 : elle n'était plus Latest (la 1.9.1 l'était) et n'était ni un
  preview ni le tag pinné → release + tag supprimés. Le premier incident
  (attribué à tort à `gh release edit --latest`) a la même cause : la
  publication de la 1.9.1 de contrôle. ⚠ **Publier une release stable de
  contrôle DÉTRUIT la release stable courante** (rétention par design).
  Restauration (validée) : re-push du tag local (`git push origin
  evenbetter-xcloud-v1.9.0`, tag local conservé même si le distant est
  purgé) → `gh release create` → re-upload des 4 assets (user.js ES2017,
  meta, APK versionné, APK stable) → `gh api --method PATCH
  repos/…/releases/{id} -f make_latest=true` (GitHub ne ré-attribue PAS
  latest après une purge). Le CDN web met ~2-3 min à propager le redirect
  `latest/download` dans les DEUX sens (l'API, elle, est immédiate).
  Cycle validé quand même : le lien stable a bien suivi la 1.9.1
  (a63670f3) pendant la fenêtre, et est revenu à b9d20aef après restauration.

## Pièges mémorisés

- URL **play SANS GUID** (`…/v5/sessions/cloud/play`) ; state/configuration
  AVEC GUID. Le hook route par `endsWith("/sessions/cloud/play")`.
- Réécriture **réponse** page-level (userscript) = invisible dans Network ;
  seul `Fetch.fulfillRequest` CDP l'affiche. Réécriture **requête** = visible.
- **Reprise de session (17 août)** : après un teardown incomplet, le play natif
  se voit rendre le MÊME GUID que la session tizen précédente (CF49BC01)
  — contrôle A/B invalide. Teardown propre = navigation home (session
  terminée) → play → vérifier GUID **neuf** dans le resource timing.
- **P3 ne change pas la résolution en PC** : natif windows et tizen reçoivent
  tous deux 1080p60 sur Halo CE (contrôle propre 17 août).
- Double réécriture : hook actif → le CDP logue `[P3] original:tizen` (déjà
  réécrit avant le réseau).
- `probe-page.js` : `hookActif` = présence de `window.BX_FETCH` (ne pas exiger
  `window.fetch === BX_FETCH` — T5 enveloppe après main()).
- **Shell preview = Tailwind, pas de `<header>`** : le top bar est
  `nav.col-container` (h 73, rangée `[class*='flex-row']`), le `<html>` porte
  la classe `global sbar …`. Le container z-shell-top est `fixed z-100
  pointer-events-none` — tout élément injecté doit se ré-armer en
  `pointer-events:auto` (sinon les clics traversent vers `<main>`).
- **Le shell preview REPLACE le document au démarrage** (probable
  `document.open()`) : les nœuds du userscript (overlay/container du
  NavigationDialogManager, feuille `<style>` d'`addCss()`) finissent orphelins
  sous un ancien `<html>` détaché — le manager survit (show() tourne,
  `bx-no-scroll` posé) mais rien ne s'affiche et le CSS disparaît (dialog
  `position:static` hors-écran). T7 (build-preview.js) : interval 2 s,
  ré-append si `!isConnected` + re-`addCss()` si aucun `<style>` porteur de
  `.bx-navigation-dialog-overlay{`. Edge cache le contenu des extensions
  MV3 : après `cp` dans `.edge-inject/preview.js`, un reload ne suffit pas —
  **redémarrer Edge**.
- **L'extension `.edge-inject` doit être relancée** : `taskkill //F //IM
  msedge.exe //T` + `Start-Process` (PowerShell) avec profil
  `D:\Codex\EvenBetterXcloud\edge-profiles\edge-cdp` +
  `--load-extension=D:\Codex\EvenBetterXcloud\better-xcloud-fork\.edge-inject` (depuis bash,
  passer par `powershell -Command "Start-Process …"`, pas Start-Process
  direct). Profils de test sur D: uniquement (18 août).
- **Blip « You're offline » d'Edge** (vu 2× le 17 août) : le site se charge en
  « offline » alors que le réseau va bien (curl 200) → la page stream ne part
  pas, le play ne s'émet pas. Contournement : clic `retryButton` ou reload ;
  l'interception CDP reste attachée entre-temps (aucun impact).
- **Preuve P2 = config effective de la session live** (plus fort que Network) :
  `hunt-session.js` → fibre `.Connection` → `_session` →
  `_configuration.inputConfiguration.enableVibration` etc. — le natif n'envoie
  que `useUnreliableInput` dans inputConfiguration, donc toute clé
  supplémentaire vient de notre fusion CDP.
- `class` est lexicale dans un vm (évaluer en class expression).
- Le preview CSP bloque raw.githubusercontent.com (listes native-mkb /
  local-co-op) → « Failed to fetch » (non fatals, rejets non gérés).
- **Flake CI gpu-runner (17 août, dispatch 32024511950)** : gpu-runner écrivait
  le JSON complet puis rejetait sur `browser.close()` (un Edge utilisateur
  ouvert sur la machine tue le process Playwright) → exit 1 SILENCIEUX → le
  `|| exit 1` du workflow court-circuitait agg-seeds (zéro sortie au log).
  Fix `db8de27` : close en try/catch dans gpu-runner.js + visual-diff.js ;
  report-html.js sort exit 0 si le JSON est absent (step `if: always()` ne
  s'ajoute plus en rouge). Diagnostiquer un exit 1 silencieux : télécharger
  l'artefact `gpu-runs-<sha>` et rejouer localement.
- `git apply` **hors repo no-op silencieusement** ; hunk **zéro-contexte**
  refusé sur ligne géante (contexte 3 lignes requis). Node `/tmp` ≠ bash
  `/tmp` sous Git Bash (utiliser des chemins projet ou bash tools).
- Conventions merge : rebase + fast-forward + suppression de branche ; badge
  Closed/Merged trompeur (§5 mémo projet).
- Step « Commente la PR » (`always()` + readFileSync du résumé) : garde
  `fs.existsSync` (`8bd1341`) — job échoué AVANT check-ratios → skip propre
  « résumé absent … skippé », plus de crash ENOENT  (validé PR #16, run
  32002128606 ; journal dans e2e-cdp.md). Runner edge-cdp : port 9222,
  profil `D:\Codex\EvenBetterXcloud\edge-profiles\edge-cdp`, relance : `Start-Process msedge.exe
  -ArgumentList
  '--remote-debugging-port=9222','--user-data-dir=D:\Codex\EvenBetterXcloud\edge-profiles\edge-cdp',
  '--no-first-run',
  '--load-extension=D:\Codex\EvenBetterXcloud\better-xcloud-fork\.edge-inject'`.

## Profil runtime en session réelle — VERDICT (18 août ~19:45, v1.9.0)

`bench/live-profile.js` exécuté sur un stream réel (As Dusk Falls,
www.xbox.com/play, build v1.9.0 injecté via `.edge-inject-stable` sur le
profil guard-badge, lancé depuis la page play par clic CDP sur « JOUER
MAINTENANT ») : 15 s → ~3,5 ms de JS total ; 20 s → ~3,2 ms (getGamepads
1,7 ms · Yt 1,5 ms). **Le main thread JS du renderer est ~99,98 %
inactif/natif pendant un stream** — la dominante réelle (décodage vidéo,
WebGL2) est côté process natifs/GPU, invisible au CDP Profiler. Verdict :
**la queue d'optimisations JS du stable est au plancher**, plus de gain
mesurable côté script (nos hot loops ~0,2 µs/frame sont sous le seuil
échantillonnage). Seul item JS visible : le polling getGamepads (~0,1 ms/s),
déjà couvert (PR #999/#1000 + bench 137 ns). Journal dans bench/README.md
(« Profil runtime — VERDICT »). ⚠ Caveat : onglet CDP en arrière-plan →
throttling rendu (86 % dropped, downscale 1440p→720p), le profil JS reste
valide, pas de conclusion qualité.

## Feature v1.10.0 — 📡 Test de latence serveur (18 août ~21:30)

Nouvelle fonctionnalité utilisateur (le JS étant au plancher) : bouton
« Tester la latence des serveurs » dans le groupe SERVER des settings globaux
— ping chaque région gssv (`STATES.serverRegions`, 19 régions réelles) via
NATIVE_FETCH + `?probe=1` (mesure pure, l'XcloudInterceptor route les URLs
finissant par /sessions/cloud/play vers handlePlay), timeout 3 s, tri du
meilleur au pire, « ⭐ région recommandée ». Validé en réel (guard-badge,
connecté) : RTT cohérents géographiquement — ⭐ CSE 30 ms, WEU 41 ms, UKS
(défaut) 43 ms, Japan 804 ms. Preuve `bench/.latency-feature-proof.png`.

Injection : `bench/feature-latency.js` (gates, idempotent, self-test sur
copie corrompue — piège : corrompre le contenu PRÉ-injection sinon
l'idempotence sort en no-op). ⚠ **Piège shortName** : `STATES.serverRegions[x]`
a `shortName` = « 🇺🇸 EUS » (emoji drapeau + espace) → hôte invalide — utiliser
**`baseUri`** (`https://eus.core.gssv-play-prod.xboxlive.com`).
`networkTestHostname` (gssv-fastlane) ne résout pas depuis ce PC. Libellés
inline EN (pas de clés de traduction — à ajouter si besoin).

**Bump v1.10.0 appliqué** (bump-version.sh) : VERSION 1.10.0, bundles stable/
es2017/preview 1.10.0 + 1.10.0-preview1, metas, manifest APK versionCode 3.
Rebuilds : es2017 ✓, preview (build-preview.js — ⚠ ancres T1 à bumper :
PREVIEW_VERSION + versionAnchor + headerAnchor) ✓, APK stable
`mobile/out/evenbetter-xcloud-1.10.0.apk` (148 Ko) ✓. **En attente : publier
la release v1.10.0 + v1.10.0-preview1 (+ APK stable + nom stable
`evenbetter-xcloud.apk`) et vérifier les liens — N'oublier AUCUNE release de
contrôle stable (l'auto-prune purge la courante).**

## Rendu premier plan — 0 % de drop (18 août ~21:00, v1.9.0)

Run de contrôle live-profile avec fenêtre au premier plan (As Dusk Falls,
1440p30) : **599 frames reçues sur 20 s, 0 dropped (0,00 %), 29,9 fps
effectifs**, `visibilityState:visible` — le 86 % de drops du run initial était
bien le throttling d'onglet arrière-plan (confirme la correction du caveat).
live-profile au premier plan : 99,3 % natif/inactif (même verdict JS), les
callbacks SDK tournent réellement (scheduleTimer 2,7 ms · requestVideoFrame
Callback 2,6 ms · calculateChanges 1,9 ms / 15 s) — toujours négligeable.
⚠️ Opérationnel CDP retenu : (1) les clics `Input.dispatchMouseEvent` peuvent
être interceptés par la page (banner z-999) → utiliser `element.click()` en
JS ; (2) un onglet CDP reste hidden après `Page.bringToFront` si la fenêtre
OS est occluse → **cycle minimiser→restaurer** (`Browser.setWindowBounds`
minimized puis normal) force le premier plan et libère le rendu.

## Hors main thread — VERDICT mesuré (18 août ~20:15, v1.9.0)

Session stable réelle (As Dusk Falls, onglet premier plan) : config d'input
effective lue dans `window.BX_EXPOSED.inputChannel.configuration` →
`useIntervalWorkerThreadForInput:true` · `enableVibration:true` ·
`useUnreliableInput:true` · `enableClientRenderedCursor:true` — **le client
stable les a TOUS actifs nativement** (contrairement au preview où la fusion
P2 les apportait). Double échantillon getStats (deltas timestamps RTP, 10 s) :
bitrate **~24,8 Mbps** (1440p30 H.264 High), décodage **0,50 ms/frame**
(natif, non scriptable), RTT 22 ms, 0 perte, 0 drop. getGamepads ~85 µs/s
(0,0085 %) — gain potentiel sous le bruit. **Verdict : rien à optimiser côté
script hors main thread** — les leviers réseau/décodage (maxBitrate → patch
SDP b=AS:, codecProfile → setCodecPreferences, resolution, maxFps,
powerPreference, region) existent et fonctionnent déjà (mécanismes vérifiés
dans le bundle) ; ce sont des préférences utilisateur, pas des optimisations.
Seul axe infra restant : AV1 (non utilisé sur ce setup, H.264 High) via
`stream.video.codecProfile`. Détail : bench/README.md « Hors main thread ».

## SNAPSHOT 18 août ~20:00 — avant reboot (tout commité + poussé)

**État git** : `main` == `origin/main` @ **`66ef734`** (verify-badge --banner).
Arbre propre sauf : `.edge-inject-stable/` (extension d'injection LOCALE, NON
commitée — convention comme `.edge-inject`) et `better-xcloud-perf-1.8.0-
test.apk` (artefact périmé, à supprimer).

**Versions / releases** (repo `Endymi0n74/EvenBetter-Xcloud`) :
- `VERSION` = **1.9.0** ; bundle stable servi = ES2017 (`better-xcloud.user.js`, ~403 Ko).
- Releases : **evenbetter-xcloud-v1.9.0** (Latest ; 4 assets : user.js ES2017,
  meta, `evenbetter-xcloud-1.9.0.apk` versionné, **`evenbetter-xcloud.apk` =
  nom STABLE**), **evenbetter-xcloud-v1.9.0-preview1** (prerelease),
  `better-xcloud-perf-1.8.0-preview4` (cran de secours).
- Liens : auto-update via `latest/download/*` ; **bannière Android →
  `latest/download/evenbetter-xcloud.apk`** (le nom stable doit être re-uploadé
  à CHAQUE release — le garde-fou vérifie stable == versionné).
- Tags v1.9.0 + preview1 → commit `4261a42` (bundles servis).

**Validations en réel terminées (18 août)** : badge « EvenBetterXcloud 1.9.0 »
affiche + clic → releases (verify-badge.js) ; bannière Android (UA simulé) →
APK direct, clic → téléchargement réel 135788/135788 o (preuve = événements
CDP, SmartScreen retire le fichier) ; release-guard VERT (local + CI).

**Outils clés** : `bench/release-guard.sh` + `.github/workflows/release-guard.yml`
(cron 05:17 UTC + dispatch) ; `bench/verify-badge.js [--banner]` ;
`bench/release-prune.sh` ; `bench/bump-version.sh` + `VERSION` racine ;
`mobile/build.sh` (`VARIANT=preview`, `BUNDLE_SRC=…es2017.user.js`) ;
`bench/preview/port/build-preview.js` (builds preview depuis le stable).

**Chemins** : repo `D:\Codex\EvenBetterXcloud\better-xcloud-fork` ; JDK `C:\Program Files\Zulu\zulu-21` ;
SDK `/d/android-sdk` ; keystore `D:\Codex\EvenBetterXcloud\bx-apk\bxperf.keystore` ; profils Edge
`D:\Codex\EvenBetterXcloud\edge-profiles\` (edge-cdp = play.xbox.com preview) ; extension locale
`.edge-inject-stable/stable.js` = copie statique du bundle → **RESYNC après
chaque changement de bundle**. PC : aucune instance Edge de test ouverte, rien
en cours d'exécution.

**Pièges récents (détail plus bas)** : publier une release stable de contrôle →
l'auto-prune (release-prune.yml sur `release: published`) PURGE la stable
courante ; SmartScreen supprime les APK téléchargés ; redirect web `latest` =
cache CDN ~2-3 min (l'API est immédiate) ; blob git LF vs releases CRLF →
normaliser CRLF→LF dans les comparaisons sha ; gh en CI exige `GH_TOKEN`
explicite ; `gh release upload fichier#nom` non supporté (copier sous le bon
nom) ; GitHub ne ré-attribue pas Latest après purge (`PATCH make_latest=true`).

**Prochaines étapes candidates** : (a) valider la migration Greasemonkey chez
l'utilisateur (badge 1.9.0 en Firefox — le build est bon, l'ancien script peut
tourner encore) ; (b) ~~supprimer `better-xcloud-perf-1.8.0-test.apk`~~ **fait le 19
août — l'asset n'existait plus nulle part** (purge avec l'ancienne release
`better-xcloud-perf-v1.8.0` lors de la rétention du 18 août : aucun asset
« test » sur GitHub, aucun fichier local, garde-fou 10/10 vert après
vérification) ; (c)
reprendre la queue du stable : `bench/live-profile.js` pour identifier la
dominante runtime réelle ; (d) upstream : 15 PR ouvertes (redphx), politique
sans rappel (décision 19 août — on propose, on ne pinge pas) ; (e) APK
preview : overlay absent sur play.xbox.com en WebView (réservé, priorité
basse — résolu par le FAB 19 août).

## Verdict AV1 (18 août ~23:00) — backend xCloud encode H.264 uniquement

- **Support navigateur OK** (Edge 152, `bench/av1-probe.js`) : `video/AV1`
dans les codecs RTP + MediaCapabilities `supported`/`powerEfficient` (hw)
pour 1080p60/1440p60 file et webrtc. Mais `getSupportedCodecProfiles()` du
bundle n'expose que H.264 (low/normal/high) — AV1 jamais proposé.
- **A/B mesuré** (As Dusk Falls, 20 s, premier plan) : Run A défaut =
video/H264 1440p30 **24,2 Mbps** 0,51 ms/frame ; Run B offre AV1 forcée
(`bench/launch-game.js --av1` : reorder AV1 en tête du m=video + no-op
setCodecPreferences) = **toujours video/H264** 24,7 Mbps. Preuve
`bench/sdp-inspect.js` : l'offre contient AV1 mais la réponse serveur ne
liste QUE du H.264 (VP8/VP9 aussi retirés) → **l'encodeur xCloud est
H.264-only, AV1 = cul-de-sac** (stable ET preview). Aucune option à ajouter.
- Harnais ajoutés (bench/) : av1-probe.js, launch-game.js (+`--av1`),
stream-stats-capture.js (fix : codec lookup en 2 passes — l'ordre du report
getStats met les codec AVANT inbound-rtp), sdp-inspect.js, page-probe.js,
kill-edge-profile.ps1 (tue un profil Edge précis — `$_` mangé par bash →
fichier .ps1 obligatoire).

## Préférences utilisateur mesurées — maxBitrate fiable, résolution 720p seule efficace (18 août ~23:30)

- **`stream.video.maxBitrate` (SDP b=AS:) honoré par l'encodeur** : défaut
  24,2 Mbps (1440p30) → cap 10 Mbps = **6,6 Mbps**, cap 5 Mbps = **4,7 Mbps**,
  résolution inchangée (1440p), 0 drop. Réglage recommandé pour économiser
  la bande passante : cap 10-15 Mbps (préférence utilisateur, pas une opti).
- **`stream.video.resolution` = spoof osName** (handlePlay, même mécanisme
  P3 retiré du preview) : `720p`→android (**1280×720, 6,4 Mbps — fonctionne**),
  `1080p`→windows = natif → **no-op** (1440p), `1080p-hq`→tizen = **no-op sur
  PC** (1440p, cohérent avec l'A/B P3 preview). Seul 720p change quelque
  chose ; 1080p/1080p-hq sont trompeurs sur PC.
- Harnais ajouté : `bench/set-pref.js` (fusion préférence dans
  localStorage["BetterXcloud"] + reload + attente bundle) — la clé est un
  objet plat de settings. Valeur « unlimited » stockée = 15360000 (max).
  Piège : la home xbox.com peut atterrir sur le shell complet après un
  reload — renaviguer explicitement vers /play.

## Boucle fermée — queue d'optimisations stable terminée (18 août ~23:45)

- **README principal** : la section « Benchmarks — synthèse » est remplacée
  par « Queue d'optimisations terminée — réglages recommandés » (FR + EN) —
  verdict live-profile (main thread 99,98 % inactif), tableau des réglages
  recommandés mesurés (maxBitrate 10-15 Mbps, 720p, 1080p/1080p-hq no-op,
  région + test latence) et note codec H.264-only. Les chiffres perf restent
  dans bench/README.md (source unique).
- **Fermeture de la queue** : plus d'optimisation script à chercher côté
  stable — prochaines features = utilisateur (pattern feature-latency.js),
  upstream = 15 PR ouvertes, politique sans rappel (19 août).

## A/B profils H.264 mesuré (18 août ~23:50) — le setting fonctionne, le défaut est déjà le meilleur

- `stream.video.codecProfile` réordonne les profils H.264 dans l'offre SDP —
  prouvé en réel via le `profile-level-id` négocié : `default`/`high` →
  **4d001f (Constrained High)**, `normal` → **42e01f (Constrained Baseline)**,
  `low` → **42001f (Baseline)**. Le défaut du SDK est DÉJÀ le meilleur
  profil → « high » = no-op, `low`/`normal` ne font que dégrader (pas de
  B-frames). Recommandation : laisser à `default`.
- ⚠️ **Piège mesure** : les bitrates inter-runs sont confondus par le contenu
  (jeu qui avance — le run « high » a attrapé une scène statique à 10,4 Mbps).
  Seule la négociation du profil est une preuve fiable ; les deltas de bitrate
  entre sessions du même jeu ne sont PAS comparables.
- Le capture de stats lit maintenant le `profile-level-id` du codec
  (2e champ, sdpFmtpLine). Screenshots : bench/.h264-high.png / .h264-low.png.

## Verdict codec preview (19 août ~00:05) — même backend H.264-only que le stable

- Session preview réelle (play.xbox.com, Among Us) : codec négocié =
  **video/H264 `4d001f` Constrained High — identique au stable**. L'offre
  contient AV1 mais la réponse serveur non → le backend encode H.264 pour
  les deux clients, rien d'autre (pas de VP9/HEVC). Sujet codec CLOS.
- ⚠ Piège : l'extension `.edge-inject` (preview) était une copie pré-rebrand
  — RESYNC après chaque build preview (même convention que
  `.edge-inject-stable`). La page stream immersive du preview est en plein
  écran → le cycle min/restore du capture exige d'abord un retour à
  « normal » (fix dans stream-stats-capture.js).
- Harnais ajoutés : `bench/launch-preview-game.js` (produit → Jouer → stream
  sur play.xbox.com), `bench/preview-codec-probe.js` (codec + stats brutes +
  présence AV1 dans les SDP).

## Gate navigateur du preview (19 août ~00:30) — Firefox bloqué par check Chromium-only, workaround UA

- play.xbox.com affiche « Votre navigateur ne prend pas en charge la
  diffusion en continu » sur Firefox. Cause dans `entry.client` du site :
  `isSupportedChromiumBasedBrowser = (isChrome && >=106) || (isBlinkEngine &&
  >=106)` ou fallback `satisfies(chrome/edge >=106, safari >=17)` — **Firefox
  n'est pas dans la liste**. Check basé sur l'UA détectée → **spoofable**.
- Workaround (pas besoin de code) : le setting preview `userAgent.profile`
  = « Edge + Windows » existe déjà (spoof document-start) → gate passé. OU
  Firefox `about:config` → `general.useragent.override` = UA Edge.
- Le stream lui-même tourne sous Firefox (support WebRTC H.264 confirmé —
  post r/xcloud fév. 2025 « play Xcloud on Firefox », décode hw Linux).
- Sonde ajoutée : `bench/ua-spoof-probe.js` (UA Firefox via CDP
  Emulation → vérifie l'absence de dialog).

## T4 mobile — overlay settings invisible en WebView téléphone (19 août ~09:45, preview3) ✅ FAB

- **Symptôme** (réservé 18 août) : sur téléphone le preview est loggé mais
  l'overlay/settings n'apparaît pas sur play.xbox.com en WebView.
- **Diagnostic (BlueStacks, émulation CDP 390×844)** : viewport <768 px → le
  shell mobile n'a NI `nav.col-container` NI `<header>` (top bar desktop
  absente) → T4 sans ancre → aucun bouton. ≥768 px : top bar présent, bouton
  injecté + dialog (validé). Shell mobile = `nav.z-shell-bottom` (mini-nav
  basse, items dans des spans `display:contents`).
- **Fix (build-preview.js T4, 1.10.0-preview3)** : `innerWidth < 768` → FAB
  fixe `.bx-mobile-fab` au-dessus de la mini-nav (pilule 48 px radius 999,
  label EvenBetterXcloud), CSS scoped `[class*="bx-header-settings"]` (la
  classe réelle est `bx-header-settings-button`). Desktop inchangé.
  ⚠ échappement template : `\"` dans le template littéral → `\\\"` pour
  sortir `\"` valide dans le bundle (node --check a attrapé l'erreur).
- **Validé WebView réelle** (APK preview3) : FAB 174×48 radius 999 injecté à
  390 px, clic → `.bx-settings-dialog` ouvert ; desktop (1280) bouton top bar
  154×40 sans FAB ; gate toujours passé. Harnais :
  `bench/mobile-t4-diagnose.js` (fab/desktop/shell/bottomnav/html — override
  CDP par-session → appliqué PUIS probe dans le même script).
- **⚠ Piège timing prune (19 août ~09:40)** : publier une release preview
  SANS avoir poussé le bump d'abord → le prune CI (release: published) lit le
  tag pinné depuis le bundle COMMITÉ (encore l'ancien preview2) → il purge la
  nouvelle release preview3 et garde l'ancienne + preview4. **Ordre imposé :
  bump + build + commit + push PUIS publier.** Recréée ensuite sur le bon
  commit (tag 5a59c3b), prune correct : preview3 + v1.10.0 + preview4,
  preview2 purgée, garde-fou 10/10.

## T10 — auto-spoof UA non-Chromium dans le preview (19 août ~00:45, preview2)

- Le gate play.xbox.com est Chromium-only (`isSupportedChromiumBasedBrowser`
  dans entry.client — Firefox non listé, dialog « ne prend pas en charge la
  diffusion en continu »). Le stream WebRTC H.264 fonctionne pourtant sous
  Firefox → **T10** dans build-preview.js : si le navigateur réel n'est pas
  Chromium (regex `chrom(e|ium)|edg/|crios`, vérifiée : Firefox/Safari →
  spoof, Edge/Chrome → inchangé) ET que `userAgent.profile` est « default »,
  forcer `windows-edge` par défaut au moment de `UserAgent.init()` — le gate
  passe sans réglage manuel. Le setting garde la main (profil explicite non
  écrasé). Guard `BX_PREVIEW` → stable inchangé (vérifié 0 occurrence).
- Bump preview → **1.10.0-preview2** (PREVIEW_VERSION, tag v1.10.0-preview2,
  README Deux versions FR/EN). Ancre T10 :
  `if (!UserAgent.#config.custom) UserAgent.#config.custom = "";UserAgent.spoof();`
  (unique). Probes + node --check OK.
- **Validé en réel par l'utilisateur (19 août, Firefox)** : preview2 avec
  `userAgent.profile` = default → gate passé, **Halo lancé et jouable au pad**
  sous Firefox. Contre-test Chromium automatisé (`bench/t10-counters-test.js`,)
  : UA intacte, script actif, pas de dialog, home OK — T10 ne spoofe que hors
  Chromium. Validation T10 bouclée des deux côtés (commit `a34d5d9`).
- **Gate CI T10 branché (19 août ~09:00)** : `bench/preview/port/t10-auto-spoof.test.js`
  dans le step preview de bench.yml — extraction du statement T10 du build +
  pureté du stable + comportement vm sur mock UserAgent (13 checks) +
  `--self-test` du chemin d'échec. CI main vert (run 32226542845). Commit `2f36360`.
- **APK preview en WebView Android (19 août ~09:15, BlueStacks)** : l'APK
  preview2 embarque bien le T10 (1 marker, `windows-edge` ×3, version
  1.10.0-preview2, byte-identique à la release). Gate validé dans la WebView :
  UA Chromium Android (Chrome/129) → **pas de dialog** (T10 correctement
  inactif — la WebView est déjà Chromium, pas de spoof), script preview actif
  (18 patches), 9 jeux. Nouveau harnais : `bench/mobile-preview-gate.js`.
- **Fix UA suffix APK (19 août)** : `MainActivity.java` durcissait
  `EvenBetterXcloud/1.9.0` dans l'UA → lit maintenant le `versionName` du
  manifest (1.10.0). versionCode 3→4. APK stable + preview rebuildés et
  re-uploadés (assets versionnés + nom stable byte-identiques), garde-fou 10/10.

## Publication v1.10.0 (18 août ~22:30) — feature latence + releases

- **Feature** : « 📡 Tester la latence » (groupe SERVER) — ping des 19 régions
gssv (hôte depuis `baseUri` — pas `networkTestHostname`/`fastlane` qui ne
résout pas ; `shortName` contient l'emoji drapeau → libellé seul, pas hôte ;
`NATIVE_FETCH` bypass l'interception ; URL `?probe=1` évite le dispatcher
`sessions/cloud/play`). Validé en réel : CSE 30 ms ⭐ (France), WEU 41, UKS 43
(défaut), JP 804. Injecté par `bench/feature-latency.js` (gates + self-test),
present dans les 3 bundles + APK. Bump v1.10.0 : VERSION, versionCode 3, 3
ancres build-preview. Commit `6079b2c`.
- **Releases publiées (18 août ~22:28)** : **`evenbetter-xcloud-v1.10.0`**
(Latest, 4 assets : user.js ES2017 ~405 Ko, meta, `evenbetter-xcloud-1.10.0.apk`
versionné + nom STABLE `evenbetter-xcloud.apk`) et
**`evenbetter-xcloud-v1.10.0-preview1`** (prerelease, 3 assets : user.js +
meta + **APK preview**). Auto-prune (workflow release-prune) a purgé v1.9.0 +
v1.9.0-preview1 ; conservés : Latest + preview1 1.10.0 (pinné) +
1.8.0-preview4 (cran de secours). Garde-fou **10/10 VERT**.
- ⚠ **Convention : la release preview porte AUSSI son APK**
(`evenbetter-xcloud-<ver>-preview1.apk`, VARIANT=preview de build.sh, package
`com.bxperf.preview`) — le garde-fou vérifie `APK preview (tag)` en 200.
Oubli → GATE ROUGE (404). Premier upload = 404 cache CDN ~1 min, pas un bug.
- README FR/EN « Deux versions » : 1.10.0 / 1.10.0-preview1, lien preview →
tag dédié v1.10.0-preview1.

## En attente / prochaines étapes

1. ✅ **Fait (17 août soir) — overlay preview validé en réel** : bouton
   settings injecté dans le top bar de play.xbox.com + dialog settings ouvert
   (journal complet dans e2e-cdp.md, section « Validation overlay
   1.8.0-preview1 »). Trois fixes dans build-preview.js : sélecteurs T4
   (`nav.col-container` + cible `[class*='flex-row']` — pas de `<header>`
   dans le shell Tailwind), `pointer-events:auto` sur le wrapper (le
   container z-shell-top est `pointer-events:none`, clics traversés),
   **T7 résilience** (le shell REMPLACE le document au démarrage →
   overlay/container orphelins sous l'ancien `<html>` détaché ET feuille de
   style effacée ; interval 2 s : ré-append si `!isConnected` + re-`addCss()`
   si aucun `<style>` porteur). ~~À faire : republier la preview~~ —
   **SUPERSÉDÉ** : republiée plusieurs fois depuis (preview2/3/4, puis
   v1.9.0-preview1, 1.10.0-preview*, 1.11.0-preview1/2 — fix T7 inclus dans
   tous les builds depuis).
2. ✅ **Fait (17 août ~12:43) — Run 1 CDP P2 VALIDÉ (C4)** : Étape 0
   `--strict-probe` passée, `intercept-session.js --sw` (SW attaché CDP brut),
   chaîne `[P3]` → `[P2-staging]` ×2 (page+SW) → `[P2]` (5 groupes réécrits).
   **Preuve session live** (hunt-session, fibre `.Connection` → `_session`) :
   `_configuration.inputConfiguration.enableVibration:true` (le natif n'envoie
   que `useUnreliableInput`), `audioConfiguration.enableMicrophone:true`,
   config propagée aux 3 canaux d'input, `_bxKeepAliveWrapped` présent.
   Journal : e2e-cdp.md « Run 1 — P2 (exécution 3) ».
3. P1-B AFK : fenêtre 1 h exécutée (17 août, 09:10:59→10:10:59) — session
   survivante, AUCUN warning → **seuil d'idle preview > 60 min** (exécution 2
   journalisée dans e2e-cdp.md). **Recherche statique faite (17 août)** : PAS
   de constante de seuil côté client — le serveur envoie `secondsUntilKick`
   dans le message `WarningForBeingIdle` (StreamSessionRequest-iiux1fqv.js),
   l'événement `sessionIdleWarningEvent` dispatché n'a AUCUN écouteur (pas de
   countdown UI, pas de kick local — le kick est un message `KickForBeingIdle`
   séparé). WrapSession sur onServerDisconnectMessage = SEULE ligne de
   défense. Nouvelle fenêtre 1 h relancée 17 août 15:09 (monitor-afk-1h-v2.log,
   session CF49BC01) après que la 1re tentative (15:02) est morte à 4,5 min
   (reload du shell + dialog permission micro réapparu — cliqué Autoriser au
   clavier, mémorisé dans le profil D:\Codex\EvenBetterXcloud\edge-profiles\edge-cdp). **DÉCISION
  P1 (17 août) :
   validation clôturée.** Fenêtre longue (2 h) abandonnée — PC indisponible
   2 h de suite, et le timer d'idle serveur ne peut être ni accéléré ni
   simulé. Seuil > 60 min établi (exécution 2), wrapSession en place et
   branchée en réel (`wrapped:true`), risque résiduel (kick entre 1 h et un
   seuil inconnu) **accepté** — si un kick survient en usage réel, fenêtre
   longue à ce moment-là. Journal : e2e-cdp.md « Décision P1 ».
4. ✅ Fait — `run-e2e0.sh` au CI (step preview, `--skip-probe`) +
   `--strict-probe` (hookActif:true exigé) + chemin d'échec testé.
5. ✅ Fait — localisation de la session au runtime + locator auto (voir P1).
6. ✅ Fait — v1.8.0 (USM) + 1.8.0-preview1 publiées (17 août 12:11).
7. ✅ Fait — preview2 publiée (fixes overlay T4/T7) puis **preview3 (17 août)
   : retrait osName=tizen (T8, A/B mesuré) + intercept-session passif**.
   Releases : 1.8.0 (stable, latest) / 1.8.0-preview2 / 1.8.0-preview3.
8. ✅ **Fait (17 août ~19:30) — preview3 validée en réel** (profil edge-cdp,
   extension `.edge-inject` à jour) : overlay + bouton settings + dialog OK,
   play **natif** confirmé (`osName=windows`, non réécrit — T8), stream live
   1920×1080. Journal : e2e-cdp.md « Validation preview3 en réel ».
9. ✅ **Fait (17 août ~21:45) — T9 (build preview4)** : bouton Settings dans
   la game bar de la page stream immersive (le seul accès settings en
   session, le top bar n'existe pas sur /stream/). Validé en réel : dialog
   complet ouvert depuis la bar en cours de jeu. Journal : e2e-cdp.md « T9 ».
10. ✅ **Fait (17 août ~22:00) — preview4 publiée validée** (release
    better-xcloud-perf-1.8.0-preview4) : asset GitHub **byte-identique** au
    build local (494 246 o, cmp OK) — ce que recevra Tampermonkey est
    exactement le fichier testé en réel (overlay + top bar + game bar
    settings en session). Journal : e2e-cdp.md « Validation preview4
    publiée ».
11. ✅ **Fait (17 août ~23:30) — rétention des releases** : 12 anciennes
    purgées (v1.0.0→v1.7.0, 1.7.0-preview1, 1.8.0-preview1/2/3 — release +
    tag). Reste **v1.8.0 (Latest) + preview4** (preview3 recréée depuis git
    sur demande comme cran de secours, puis purgée le 17 août soir par
    `release-prune.sh` une fois le cran jugé inutile — builds toujours
    reconstruisibles depuis git). Script `bench/release-prune.sh` commité
    (politique latest + dernier preview, vérification des 4 liens
    d'auto-update). README + docs : README.en.md
    (traduction complète, sélecteur 🇫🇷/🇬🇧), notes de release bilingues
    FR/EN (5 releases), fix rendu GitHub (@name/@match backtiqués), badge CI
    bench.
12. ✅ **Fait (18 août ~00:50 puis 19 août ~14:20) — portage upstream complet,
    15 PR ouvertes** sur `redphx/better-xcloud:typescript` : #993 codecProfile
    lazy · #994 USM 4 taps · #995 dirty flag · #996 texStorage/RGB8 · #997
    viewport/NoColor · #998 hidden throttle · #999 controller skip idle ·
    #1000 structuredClone → réf. · #1001 fix share-delete · #1002 settings Set
    · #1003 checkForUpdate throttle · #1004 BxSelect observer délégué ·
    **#1005 fix #991** (garde `currentGamepad.buttons?.[16]`, commentaire
    posté sur l'issue #991) · **#1006 data usage presets** (feature
    « 📊 Données » v1.11.0, commit `77c1fcf`) · **#1007 server latency test**
    (feature « 📡 Latence serveur » v1.10.0, commit `071ff73`). Toutes
    OPEN/MERGEABLE, une par sujet, builds amont exit 0, zéro fuite inter-PR.
    Queue épuisée : plus rien à porter — #4 (uniform cache) subsumé par #995,
    patch 07 (opacity cache) **no-op amont**, patch 09 exclu (négatif à 500
    entrées). Corps des PR avec mentions near-miss (#10-12 : pref-keys.ts ↔
    #908, translation.ts ↔ #908/#938/#468). **Politique 19 août : PLUS
    AUCUN rappel** — on propose (les 15 PR), le mainteneur fait sa vie,
    `upstream-prs/reminder.md` supprimé ; seule interaction restante :
    répondre si interrogé. Programme détaillé dans `upstream-prs/README.md`
    (source de vérité).
- **Décision (19 août ~15:00) — le preview n'est PAS proposable en PR
  upstream, vérifié dans le source amont** : le preview (play.xbox.com) est
  le NOUVEAU client Microsoft — bundle minifié, sans repo source public, et
  le repo redphx ne contient que le client stable. Surtout : **P2 et P1
  existent déjà côté stable amont** — `xcloud-interceptor.ts` L218-251
  (enableVibration/mkb/mic/touch dans clientStreamingConfigOverrides =
  notre P2, c'en est la source) et `remote-play-keep-alive.ts`
  (WarningForBeingIdle → sendKeepAlive = notre P1). Notre travail preview
  est une RE-dérivation pour le nouveau client, pas une évolution du
  script stable → rien de nouveau à proposer. Le preview reste la valeur
  ajoutée du fork (contrat « Deux versions »).
- **Commentaire d'information POSTÉ (19 août ~16:30) sur la PR #993**
  (`upstream-prs/comment-preview-port.md`,
  `#issuecomment-5340919050`) : annonce au mainteneur qu'on a un portage
  complet de play.xbox.com (FAB + game bar, résilience document,
  keep-alive idle, overrides /configuration, auto-spoof UA) dispo sur
  demande. Informatif — la seule interaction hors les PR (aucun rappel ne
  sera envoyé, politique 19 août).
13. ✅ **Fait (18 août ~00:10 puis ~08:30) — APK Android du build stable** :
    wrapper WebView `mobile/better-xcloud-perf-1.8.0.apk` (~144 Ko, package
    `com.bxperf.app`, signé keystore local, minSdk 24/target 34). Injecte le
    userscript stable (v1.8.0, `@grant none`, zéro GM_*) via
    `evaluateJavascript` en `onPageStarted` — équivalent document-start,
    écran maintenu, fullscreen géré. **CRASH DE LA V1 CORRIGÉ (18 août
    ~08:11, reproduit sur l'émulateur)** : le d8 de build-tools 34.0.0 (R8
    8.2.2-dev) plante en NullPointerException sur une classe ANONYME avec
    référence externe (this$0) ET superclasse du `--lib` (android.jar) — le
    dex sortait SANS `MainActivity$1/$2` (WebViewClient/WebChromeClient) et
    l'app crasheait au lancement sur TOUT appareil (`NoClassDefFoundError
    MainActivity$1`, MainActivity.java:67). Fix : classes internes STATIQUES
    nommées (`BxWebViewClient`/`BxWebChromeClient`/`AutoRetry`, référence
    d'activité au constructeur) + **gate dex dans build.sh** (dexdump +
    vérification des classes attendues, exit 1 sinon — plus jamais d'APK
    cassé). **Robustesse (18 août ~08:30)** : erreurs réseau/HTTP/SSL de la
    frame principale → **page d'erreur lisible** (plus d'écran blanc) avec
    bouton « Réessayer » ; **retry auto 3× backoff 5/15/30 s** ; liens
    externes → navigateur système. Pièges corrigés en test : (1) lambda
    interdite (`-source 8` + bootclasspath android.jar n'a pas
    LambdaMetafactory) → classe nommée `AutoRetry implements Runnable` ;
    (2) `onPageFinished` est appelé AUSSI pour les navigations ÉCHOUÉES
    (URL fautive) → annulait le retry — machine à états `errorPageShowing`
    (markRealPageStarted/onPageFinished garde). **Cycle panne→récupération
    validé sur l'émulateur** (navig CDP vers `www.xbox.com:444`) : page
    d'erreur affichée puis retry auto +5 s → retour `/fr-FR/play` avec
    overlay (`bx:true`), logs `EvenBetterXcloud` complets. **Overlay validé** :
    BX_EXPOSED=object, BX_FETCH=function, bouton settings visible (sonde
    CDP via `adb forward` + debug WebView activé). Preuves dans
    `mobile/validation-*.png/json/txt` (overlay, page d'erreur, récupéré).
    **Attaché comme asset de la release v1.8.0** (lien direct
    `releases/download/better-xcloud-perf-v1.8.0/better-xcloud-perf-1.8.0.apk`,
    re-uploadé et vérifié byte-identique). `mobile/build.sh` : prépare
    l'asset tout seul (copie du stable courant) et **réutilise le keystore
    d'origine** `D:\Codex\EvenBetterXcloud\bx-apk\bxperf.keystore` (empreinte SHA-256
    `63382a05…` inchangée → mise à jour par-dessus l'ancien OK).
    `mobile/assets/`, `out/`, `gen/`, `bxperf.keystore` gitignorés ; l'APK
    signé est le fichier suivi. Build **sans Gradle ni Android Studio** :
    SDK sur `D:/android-sdk`, pipeline aapt2 → javac → d8 → jar → zipalign
    → apksigner (`mobile/build.sh` rejouable). Limites : script embarqué
    (update = rebuild), gains GPU desktop non transposables, iOS impossible
    sans Mac/Xcode.    README FR/EN : ligne « App native » en tête du tableau
    mobile. ~~Testé sur émulateur ; appareil réel Android toujours à
    valider~~ — **RÉSOLU** : téléphone réel validé 18 août soir (item 16 :
    jeux lancés, menu complet, visual joypad).
14. ✅ **Fait (18 août ~10:05) — harnais mobile-probe + validation BlueStacks** :
    `bench/mobile-probe.sh` rejoue la validation APK en UNE commande (build →
    install → adb forward → sonde CDP → panne→récup → logcat). `--skip-build`,
    `--no-cycle`, `--manual` (récup par clic « Réessayer » au lieu du retry
    auto), `--serial` (fixé : le `for` ne doit PAS être utilisé pour parser
    `--serial <valeur>` — la valeur retombe dans `*)` → `while` + shift).
    `bench/mobile-probe.js` : sonde BX_EXPOSED/BX_FETCH/BX_CE + bouton
    settings **visible** (patience : la page peut démarrer en `readyState:
    loading` sur émulateur → attendre /play + BX_EXPOSED + bouton, pas
    d'assert au 1er essai) ; GATE ROUGE exit 1. `--cycle` = retry auto +5 s ;
    `--manual` = clic `<a href="…xbox.com/play">Réessayer</a>` (annule le
    retry auto en attente : logcat `resetLoadState` avant le backoff — pas de
    double navigation). `bench/mobile-probe.test.js` : 5 cas contre un FAUX
    endpoint CDP (mini serveur WebSocket maison, HTTP /json + handshake
    SHA-1 + frames masquées) — pièges : `spawnSync` bloque l'event loop du
    mock (utiliser `spawn` async) ; **relire la longueur étendue 16-bit des
    frames** (header 126 = « longueur sur 16 bits qui suit », pas 126 octets) ;
    `process.exit(0)` explicite en fin de probe (handle keep-alive).
    **Validé en réel sur BlueStacks (18 août ~09:55) — `adb connect
    127.0.0.1:5555`** (émulateur BlueStacks 5, profil Samsung SM-G998B
    spoofé, Android 9, x86_64) : les DEUX voies passent (`MOBILE PROBE OK`
    auto + manuelle), logcat EvenBetterXcloud complet. BlueStacks expose son adb sur le
    port 5555 (`adb connect`) — device `127.0.0.1:5555`. L'APK de la release
    = build local (dex + asset byte-identiques ; les hash APK diffèrent par
    les timestamps zip du rebuild uniquement, sans impact — vérifié par
    extraction dex/asset avant de re-uploader).
15. ✅ **Fait (18 août ~10:10) — re-baseline stable post-harnais** :
    `run-all.sh` complet sur le build courant (481 974 o, fixes document-start
    inclus) — toutes les bornes CI tiennent (table dans bench/README.md,
    « Re-baseline du 18 août ~10:10 ») : parse 0,104 ms · controller IDLE
    29,3 ns (×9,6) · poll_gamepad Home 137,5 ns (×8,8) · updateCanvas 9,5 ns
    (×22,0) · updateFrame 130,3 ns stable · éval page 17,3 ms méd (p95 28,4)
    · profil startup plat (one-shot codec différé intact) · cold-getcap eval
    23,6 ms (Δ −95,6 %). CI bench main : success (run 32114282345).
16. ✅ **Fait (18 août ~16:00) — build ES2017 + validation téléphone réel APK** :
    le bundle stable (build bun ESNext, 481 974 o, minify **syntaxe seule**)
    est re-transpilé en **ES2017** par `bench/es2017-build.mjs` (esbuild,
    `bun bench/es2017-build.mjs` → `better-xcloud.es2017.user.js`, 403 109 o
    −16 %). Header userscript préservé (esbuild le supprimerait : extrait
    avant transpile, ré-attaché après). Mesures (Edge 152) : bun ESNext éval
    page 23,1 ms → esbuild ES2020 10,8 ms → **ES2017 11,4 ms** — le gain
    vient de la **re-minification complète esbuild** (−17 % taille, −53 %
    startup, tous navigateurs), le downlevel pur coûte +3,4 Ko / +0,6 ms.
    Build à embarquer dans l'APK (couvre les vieux WebView Chrome < 80 :
    `?.`/`??`/class fields transpilés ; les ~9 `?.` résiduels sont dans des
    **template literals de patches**, évalués dans le contexte du site, non
    transpilables — sans impact, le site exige déjà ES2020). **Badge de
    diagnostic APK** (`mobile/assets/diag.js`, ES5, auto-masqué 10 s) :
    WebView Chrome <N> / BX_EXPOSED / BX_FETCH / settings btn / signed in
    / path — injecté en `onPageFinished` — répond « WebView trop vieux ? »
    vs « pas connecté ? ». `mobile/build.sh` : `BUNDLE_SRC` (env) pour
    embarquer un bundle alternatif. **VALIDATION TÉLÉPHONE RÉEL (18 août
    soir, utilisateur, APK de test ES2017) : les jeux se lancent, le menu
    settings COMPLET apparaît après connexion dans l'appli (WebView = ses
    propres cookies), et le visual joypad est actif pour les jeux manette
    (comportement natif du script sur device tactile).** Piège documenté :
    déconnecté le menu est réduit (`renderFullSettings = supportedRegion &&
    isSignedIn`, upstream) — se connecter dans l'appli débloque tout.
    Release v1.8.0 basculée sur l'ES2017 (user.js + APK re-uploadés,
    byte-identique vérifié ; ⚠ cache CDN GitHub : après `--clobber`, le lien
    peut servir l'ancien asset quelques minutes — piège du nommage). esbuild
    ajouté en devDependency.
17. ✅ **Fait (18 août ~16:25) — APK preview (deuxième version, contrat « Deux versions »)** :
    `mobile/build.sh` build deux APK installables côte à côte via `VARIANT`
    (env) : **stable** (défaut, `com.bxperf.app`, www.xbox.com/play +
    better-xcloud.user.js) et **preview** (`VARIANT=preview`, `com.bxperf.preview`,
    play.xbox.com + better-xcloud-preview.user.js, label distinct). START_URL
    injecté par une classe `BuildConfig` générée au build (pas de placeholder
    manifest) ; `AndroidManifest.template.xml` pour label/package ; **piège
    corrigé** : `R.java` généré par aapt2 suit le package du manifest
    (app/preview) → résolu dynamiquement, idem glob d8 (toutes les classes,
    pas un glob en dur) + gate dex (`R` dans le package du variant) + verify
    apksigner sur `$APK_NAME`. ⚠ L'output `out/` est écrasé à chaque build
    (`rm -rf` au step 2) : copier l'APK preview ailleurs avant de rebuild
    stable. **Validé BlueStacks (18 août)** : les deux APK installés côte à
    côte, le preview ouvre play.xbox.com et le script preview s'exécute
    (`BX_EXPOSED=object`, `BX_FETCH=function`, bouton overlay présent).
    APK preview : `mobile/out/better-xcloud-perf-1.8.0-preview.apk` (148 077 o)
    — publié sur la release preview4 (lien vérifié 200). ⚠ ~~RÉSERVÉ (18 août
    ~16:30) : overlay preview absent en WebView~~ — **RÉSOLU le 19 août** :
    cause = shell mobile sans ancre T4 (<768 px) → **FAB** (section « T4
    mobile »), puis bouton perdu quand le shell remplace le document →
    **re-arm T4** (v1.11.0-preview2, section dédiée).
18. ✅ **Fait (18 août ~17:00) — REBRAND EvenBetterXcloud + feature Sound + nouvelle icône (v1.9.0)** :
    le repo GitHub a été renommé `Endymi0n74/EvenBetter-Xcloud` (remote local
    mis à jour). **Marque** : tout ce qui porte notre version porte le nom —
    headers userscripts (@name EvenBetterXcloud, @namespace/@author Endymi0n74,
    @updateURL/@downloadURL → nouveau repo), badge du menu
    « **EvenBetterXcloud 1.9.0** » (au lieu de « Better xCloud 6.7.12 » :
    constante **BX_VERSION** injectée, SCRIPT_VERSION upstream CONSERVÉ pour le
    cache des patches), update-check rebranché sur NOTRE repo (fetch API +
    comparaisons BX_VERSION + parse de tag `evenbetter-xcloud-v1.9.0`),
    libellés t("better-xcloud") → littéral "EvenBetterXcloud" (non traduit),
    README/mobile/bench docs, label APK « EvenBetterXcloud », UA
    `EvenBetterXcloud/1.9.0`, tag logcat, diag.js. **Feature Sound** : groupe
    « Son » dans l'onglet GLOBAL (toggle booster `audio.volume.booster.enabled`
    + volume 0-600%, stepper désactivé tant que booster off), **visible même
    déconnecté** (ajout "sound" à la liste des groupes rendus sans connexion).
    **Nouvelle icône APK** (gen-icon.js v2) : nuage + flèche montante verte
    sur fond dégradé, supersamplée 4×, sans dépendance. **Outils rejouables** :
    `bench/rebrand-bundle.js` (gates, idempotent, --bump-only) +
    `bench/bump-version.sh` (VERSION racine + bundles + metas + manifest APK)
    — le badge suit la version à chaque changement (discipline : bump à chaque
    release). build-preview.js mis à jour (ancres rebrandées, PREVIEW_VERSION
    1.9.0-preview1, tag evenbetter-xcloud-v*, BX_VERSION preview substituée).
    **Validé** : BlueStacks APK v1.9.0 (ES2017) — badge « EvenBetterXcloud
    1.9.0 », groupe Son + toggle + stepper (preuve mobile/validation-ebx-son-
    1.9.0.png), perfs intactes (parse plat, controller ×8,7, updateCanvas ×19).
    ⚠ En attente release : publier v1.9.0 + v1.9.0-preview1 (le banner
    « Version 1.8.0 disponible » actuel est correct — latest = encore l'ancien
    tag — il disparaîtra après publication). **Package Android conservé**
    (com.bxperf.app) : identité d'installation, sinon désinstallation requise.
    Anciens tags de release conservés (historique + liens stables).
19. ✅ **Fait (18 août ~17:15) — rétention appliquée après le rebrand v1.9.0** :
    `bench/release-prune.sh` exécuté (dry-run puis réel). État final : **3
    releases conservées** — `evenbetter-xcloud-v1.9.0` (Latest), `evenbetter-
    xcloud-v1.9.0-preview1` (prerelease, tag pinné par le @updateURL du build)
    et `better-xcloud-perf-1.8.0-preview4` (cran de secours, sélectionné par le
    tri "dernier preview" via capture `preview(?<n>)`). L'ancienne stable
    `better-xcloud-perf-v1.8.0` a été purgée. **4/4 liens d'auto-update 200 +
    byte-identiques** (latest/user+meta, tag preview/user+meta). ⚠ Piège
    connu du tri preview : `preview(?<n>)` capture l'INDEX de preview
    (preview4 > preview1) pas la version de base — le tag pinné compense
    (source de vérité), mais le tri seul donnerait le mauvais preview si le
    pinné manquait. À améliorer si la nomenclature évolue (capture semver
    complet).
