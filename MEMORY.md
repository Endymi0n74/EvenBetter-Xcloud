# MEMORY — état courant du projet (17 août 2026)

Mémoire de travail des sessions. Détails dans `bench/preview/port/session.md`
(étude protocole), `bench/preview/port/e2e-cdp.md` (protocole E2E + journal),
`bench/preview/port/anchors.md`, `bench/preview/port/classify.md`.

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

## État stable v1.7.0 (17 août)

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
- **Reste pour boucler la v1.7.0** : validation visuelle du USM WebGL2 (texte
  fin en session) + push du lot en attente (2 commits + intégration USM).

## Pièges mémorisés

- URL **play SANS GUID** (`…/v5/sessions/cloud/play`) ; state/configuration
  AVEC GUID. Le hook route par `endsWith("/sessions/cloud/play")`.
- Réécriture **réponse** page-level (userscript) = invisible dans Network ;
  seul `Fetch.fulfillRequest` CDP l'affiche. Réécriture **requête** = visible.
- Double réécriture : hook actif → le CDP logue `[P3] original:tizen` (déjà
  réécrit avant le réseau).
- `probe-page.js` : `hookActif` = présence de `window.BX_FETCH` (ne pas exiger
  `window.fetch === BX_FETCH` — T5 enveloppe après main()).
- `class` est lexicale dans un vm (évaluer en class expression).
- Le preview CSP bloque raw.githubusercontent.com (listes native-mkb /
  local-co-op) → « Failed to fetch » (non fatals, rejets non gérés).
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

1. Run 1 CDP : valider `[P2]` réel (C4) — stream requis. Prêt : bug `--sw`
   corrigé (double tiret) + attache SW par **CDP brut** (Playwright ne sait
   pas newCDPSession sur un Worker) — `intercept-session.js --sw`.
2. P1-B AFK : fenêtre longue (1800 s) — exécution 1 témoin journalisée
   (600 s : 11 heartbeats, aucun warning → seuil d'idle preview > 10 min).
   Le locator wrappera la session automatiquement au prochain stream.
3. ✅ Fait — `run-e2e0.sh` au CI (step preview, `--skip-probe`) +
   `--strict-probe` (hookActif:true exigé) + chemin d'échec testé.
4. ✅ Fait — localisation de la session au runtime + locator auto (voir P1).
