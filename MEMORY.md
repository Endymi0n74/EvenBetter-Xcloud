# MEMORY — état courant du projet (17 août 2026)

Mémoire de travail des sessions. Détails dans `bench/preview/port/session.md`
(étude protocole), `bench/preview/port/e2e-cdp.md` (protocole E2E + journal),
`bench/preview/port/anchors.md`, `bench/preview/port/classify.md`.

## Discipline de mémoire

L'utilisateur demande une mise à jour de ce fichier **au moins toutes les
~2 h de travail cumulé** (et à chaque fin de session), sans attendre d'être
relancé : après ~2 h d'actions, journaliser l'état (fichiers touchés,
verdicts, pièges nouveaux, en attente). Dernière passe : 17 août ~22:50.

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
  Solution : mini-extension `.edge-inject/` (`content_scripts` +
  `world:"MAIN"` + `document_start` — équivalent `@grant none`), lancée avec
  `--load-extension=…\.edge-inject`. **Ne pas** injecter via Playwright
  addInitScript / `Page.addScriptToEvaluateOnNewDocument` (realm : crash
  « MutationObserver: parameter 1 is not of type Node »).

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
  `enableVibration:true` dans Network, preuve CDP). **P2 pas encore validé en
  réel** — à faire dès un stream + session. Prérequis : Étape 0
  `--strict-probe` passée (critère de départ).
- **P1 réel** : `monitor-idle.js` (fenêtre AFK, log « BX keep-alive: idle
  warning intercepted » + session survivante) — à valider (P1-B). Prérequis :
  Étape 0 `--strict-probe` passée.

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

- **État au 17 août ~23:30 (rétention appliquée)** : 12 anciennes releases
  purgées (v1.0.0 → v1.7.0 stables, 1.7.0-preview1, 1.8.0-preview1/2/3).
  Restent : **v1.8.0 (stable, Latest)** — tag `better-xcloud-perf-v1.8.0`,
  assets `better-xcloud.user.js` + `better-xcloud.meta.js`, auto-update
  `releases/latest/download/*` ; **1.8.0-preview4 (preview courant)** — tag
  `better-xcloud-perf-1.8.0-preview4`, assets `better-xcloud-preview.*`,
  auto-update preview **pinné sur SON tag** (jamais le latest — un utilisateur
  d'une preview ANCIENNE réinstalle manuellement).
- **Rétention automatisée** : `bench/release-prune.sh` — garde Latest + **le
  dernier preview** (tri par VERSION numérique, jamais `publishedAt`
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
  1. Bump stable : `better-xcloud.user.js` (@version + header
     « OPTIMISATIONS v1.X.Y: ») ET `better-xcloud.meta.js` (@version).
  2. Bump preview : `build-preview.js` — **3 ancres** : `PREVIEW_VERSION`,
     `versionAnchor` (« // @version      1.X.0 ») et `headerAnchor`
     (« /* OPTIMISATIONS v1.X.0: »). Oubli d'une → build-preview échoue
     (ancre introuvable) : lire le message avant de corriger.
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
  msedge.exe //T` + `Start-Process` (PowerShell) avec profil `C:\edge-cdp` +
  `--load-extension=D:\Codex\better-xcloud-fork\.edge-inject` (depuis bash,
  passer par `powershell -Command "Start-Process …"`, pas Start-Process
  direct).
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
  « résumé absent … skippé », plus de crash ENOENT (validé PR #16, run
  32002128606 ; journal dans e2e-cdp.md). Runner edge-cdp : port 9222,
  profil `C:\edge-cdp`, relance : `Start-Process msedge.exe -ArgumentList
  '--remote-debugging-port=9222','--user-data-dir=C:\edge-cdp','--no-first-run',
  '--load-extension=D:\Codex\better-xcloud-fork\.edge-inject'`.

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
   si aucun `<style>` porteur). **À faire : republier la preview** (les fixes
   ne sont PAS dans la release 1.8.0-preview1).
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
   clavier, mémorisé dans le profil C:\edge-cdp). **DÉCISION P1 (17 août) :
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
12. ✅ **Fait (18 août ~00:50) — portage upstream complet, 13 PR ouvertes**
    sur `redphx/better-xcloud:typescript` : #993 codecProfile lazy · #994 USM
    4 taps · #995 dirty flag · #996 texStorage/RGB8 · #997 viewport/NoColor ·
    #998 hidden throttle · #999 controller skip idle · #1000 structuredClone
    → réf. · #1001 fix share-delete · #1002 settings Set · #1003 checkForUpdate
    throttle · #1004 BxSelect observer délégué · **#1005 fix #991** (garde
    `currentGamepad.buttons?.[16]`, commentaire posté sur l'issue #991 avec
    test demandé au rapporteur GameSir). Toutes OPEN/MERGEABLE, une par
    sujet, builds amont exit 0, zéro fuite inter-PR. **Queue épuisée et
    AUCUNE branche en attente** : plus rien à porter — #4 (uniform cache)
    subsumé par #995, patch 07 (opacity cache) **no-op amont** (le cache n'a
    jamais existé dans l'historique upstream, `git log -S` vide), patch 09
    exclu (négatif à 500 entrées). Corps des PR avec mentions near-miss
    (#10-12 : pref-keys.ts ↔ #908, translation.ts ↔ #908/#938/#468). Rappel
    groupé préparé dans `upstream-prs/reminder.md` : **ne pas pinger avant le
    24 août** (rythme mainteneur = semaines/mois, #468 attend depuis juillet
    2024), un seul commentaire sur #993 référençant les 13. Programme détaillé
    dans `upstream-prs/README.md`.
13. ✅ **Fait (18 août ~00:10) — APK Android du build stable** : wrapper
    WebView `mobile/better-xcloud-perf-1.8.0.apk` (~140 Ko, package
    `com.bxperf.app`, signé keystore local, minSdk 24/target 34). Injecte le
    userscript stable (v1.8.0, `@grant none`, zéro GM_*) via
    `evaluateJavascript` en `onPageStarted` — équivalent document-start,
    écran maintenu, fullscreen géré. Build **sans Gradle ni Android Studio**
    : SDK sur `D:/android-sdk`, pipeline aapt2 → javac → d8 → jar → zipalign
    → apksigner (`mobile/build.sh` rejouable). Keystore HORS git :
    `D:\Codex\bx-apk\bxperf.keystore` (mots de passe `bxperf-keystore`,
    à garder pour les mises à jour). Limites : script embarqué (update =
    rebuild), gains GPU desktop non transposables, iOS impossible sans
    Mac/Xcode. README FR/EN : ligne « App native » en tête du tableau mobile.
    Non testé en réel (pas d'appareil Android).
