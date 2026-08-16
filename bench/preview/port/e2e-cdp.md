# Protocole E2E — validation de l'interception CDP P3+P2

Valide en session réelle que `intercept-session.js` réécrit le protocole
comme prévu : **P3** (play request → `settings.osName` + `x-ms-device-info`)
et **P2** (réponse `/configuration` → fusion des overrides du stable dans
`clientStreamingConfigOverrides`). Deux runs comparés : **témoin** (sans
interception) vs **intercepté** (avec l'outil), critères vérifiables dans
l'onglet Network ET dans les logs de l'outil.

## Résultats réels (session Edge, 16 août 2026)

### Étape 0 — hors-navigateur (exécution 1, 16 août ~23:45)

| Gate | Commande | Résultat |
|---|---|---|
| A — document-start | `node bench/preview/port/fetch-early.test.js` | **17/17 OK ✅** (exit 0) — garde T6 neutralisé, hook posé avant entry.client, SDK `ub` capture notre hook |
| B — réécriture P2+P3 | `node bench/preview/port/userscript-rewrite.test.js` | **14/14 OK ✅** (exit 0) — play → tizen + x-ms-device-info ; configuration → overrides fusionnés, serveur préservé |
| Probe (recommandé) | `node bench/preview/probe-page.js 9222` | `hookActif: false` — page en **preview stock**, stream en cours (`readyState 4, paused:false`), aucun marqueur BX_* |

- **Lecture** : la logique de réécriture est verte (vm), le hook userscript
  n'est **pas** actif dans la page ouverte → le prochain run CDP verra le play
  en `original:windows` (interprétation directe de C1/C2, pas de double
  réécriture). Le stream en cours confirme que le câblage réseau est vivant ;
  reste à valider P2 (`[P2]` après `[P3]`, C4) et P1 (idle) en réel.

### Étape 0 — hors-navigateur (exécution 2, 16 août ~23:55 — gate D ajouté)

| Gate | Résultat |
|---|---|
| A — document-start | **17/17 OK ✅** (exit 0) |
| B — réécriture P2+P3 | **14/14 OK ✅** (exit 0) |
| C — probe | `hookActif: false` (stream en cours, preview stock) |
| D — chronologie play | **11/11 ancres stables ✅** (exit 0) — `node bench/preview/play-chain.js --soft` sur `D:/tmp/preview-player` |

- **Lecture** : la logique (vm), le câblage (probe) et la chronologie (play-chain)
  sont verts → les hypothèses de timing du Prérequis tiennent. Prêt pour le
  Run 1 CDP (P2 reste à valider en réel).

### Étape 0 — hors-navigateur (exécution 3, 17 août ~00:20 — hookActif:true)

| Gate | Résultat |
|---|---|
| A — document-start | **17/17 OK ✅** |
| B — réécriture P2+P3 | **14/14 OK ✅** |
| C — probe | **`hookActif: true` ✅** — `BX_FETCH: function`, `BX_EXPOSED: object`, `BX_FLAGS: object`, `BX_STREAM_SETTINGS: object`, `BX_CE: function` ; `fetchEstEnveloppe: true` (window.fetch = hook T5 chaîné sur BX_FETCH — normal après main()) |
| D — chronologie play | **ancres stables ✅** |

- **Le passage à `hookActif:true` a exigé un détour d'installation** (voir ci-dessous) :
  le profil edge-cdp ne peut pas exécuter d'userscript classique, la preview est
  injectée via une **mini-extension `content_scripts` + `world: "MAIN"`**
  (`.edge-inject/`, équivalent Tampermonkey `@grant none`).
- **Lecture** : la logique (vm), le câblage (probe avec hook actif) et la
  chronologie sont verts → prêt pour le Run 1 CDP (P2 reste à valider en réel).

### Installation dans le profil edge-cdp (le détour du 16/17 août)

Le profil edge-cdp ne peut pas exécuter d'userscript de façon classique :

1. **Pas de gestionnaire** : la détection (bench/preview/detect-userscript-mgr.js)
   a trouvé Tampermonkey BETA (`fcmfnp…`, installé) mais **MV3 + API
   userScripts → exige le mode développeur d'Edge**.
2. **Dev mode non activable** : l'UI edge://extensions ne se rend pas en CDP
   (shadow DOM vide), et Edge ne persiste pas `extensions.ui.developer_mode`
   dans Preferences (clé réécrite). Tampermonkey affiche « Please enable
   developer mode to allow userscript injection » et n'injecte rien.
3. **L'injection CDP directe échoue sur le realm** : `addInitScript` Playwright
   ET `Page.addScriptToEvaluateOnNewDocument` (sans worldName) s'exécutent dans
   un monde dont les wrappers DOM ne sont pas compatibles — le preview crash en
   « MutationObserver: parameter 1 is not of type Node » (cross-realm,
   reproductible avec un micro-script). `worldName:'main'` crée un monde nommé,
   pas le monde principal.
4. **Solution retenue** : mini-extension unpacked `.edge-inject/` avec
   `content_scripts: [{ matches: ["https://play.xbox.com/*"], js: ["preview.js"],
   run_at: "document_start", world: "MAIN" }]` (MV3, Chromium 111+) — monde
   principal, DOM compatible, globaux visibles de la page, hook fetch capturé
   par le SDK (chaîne T5 → BX_FETCH → NATIVE_FETCH).

Régénérer `preview.js` (entête userscript retirée) : `node` (extraction du
header `// ==UserScript== … ==/UserScript==` depuis better-xcloud-preview.user.js)
— et relancer Edge avec `--load-extension=…\.edge-inject` (plus TM unpacked).
Le harnais `bench/preview/inject-preview.js` (CDP) reste documenté mais n'est
pas la voie retenue (realm).

### Run 1 — P3 validé ✅

```
[intercept] attaché à https://play.xbox.com/products/9N683TDT5M7R/halo-campaign-evolved
[P3#1 20:33:07] play réécrit → osName=tizen (original:windows) + x-ms-device-info
  (https://uks.core.gssv-play-prod.xboxlive.com/v5/sessions/cloud/play)
```

- **C1+C2 verts** : le play request est intercepté au stage Request, `osName`
  réécrit `windows → tizen`, header `x-ms-device-info` ajouté, requête
  continuée sans erreur CDP.
- **Piège d'affichage constaté** : le panneau Network de DevTools montre le
  payload **original** (`osName: "windows"`) pour les requêtes réécrites par
  `Fetch.continueRequest` — la preuve fiable est le log `[P3#N]` de l'outil
  (osName réécrit + original), pas le panneau.
- **Fixes débloqués en réel** : (1) `postData` de `continueRequest` doit être
  **base64** (erreur « Invalid parameters » au 1er run) ; (2) la réponse
  `/configuration` exige l'interception en 2 temps (`interceptResponse:true`
  au stage Request pour que le stage Response se déclenche).

### Run 1 — P2 (résultat à compléter)

Le `[P2#N]` doit apparaître après le `[P3#N]` (provisioning). Si absent : la
réponse `/configuration` part du worker ou le stage Response ne se déclenche
pas — relancer avec `--sw` et vérifier la réponse dans Network
(`clientStreamingConfigOverrides` doit contenir `enableVibration:true`).

## Prérequis

- Session authentifiée play.xbox.com (compte Insider, Preview Features).
- Navigateur avec **remote debugging** : `chrome.exe --remote-debugging-port=9222`
  (mode connect) — ou mode launch de l'outil (profil persistant dédié).
- L'outil à jour : `node bench/preview/intercept-session.js` (self-test 51/51).
- **Chronologie du play connue** (session.md) : le play part peu après
  l'ouverture de la page stream (éligibilité → token → connect). L'interception
  doit donc être **active avant** d'ouvrir la page stream.

## Étape 0 — hors-navigateur (avant les runs CDP)

But : valider la logique de réécriture et l'hypothèse document-start **sans
session ni navigateur**, pour isoler « logique » vs « câblage réseau » si un
run réel échoue. Les deux harnais extraient `XcloudInterceptor` + helpers du
build preview réel et les exécutent en vm (pas de dépendance à la session
authentifiée ni aux bundles réseau) :

En une commande (échoue si un gate est rouge ; probe informatif par défaut —
navigateur injoignable ou hookActif:false → warning, pas d'échec ; gate D soft
sans bundles capturés ; `--strict-probe` rend le gate C dur : hookActif:true
exigé) :

```bash
./bench/preview/port/run-e2e0.sh [--port=9222] [--dir=/d/tmp/preview-player] [--skip-probe|--strict-probe]
```

Équivalent détaillé (les trois étapes séparées) :

```bash
# A — document-start viable (T6 garde neutralisé, hook posé avant entry.client,
#     SDK preview capture NOTRE hook : classe ub, i=fetch) — 17/17
node bench/preview/port/fetch-early.test.js

# B — réécriture P2+P3 en vm sur le build réel — 14/14
#     P3 : play → osName=tizen + x-ms-device-info (URL sans GUID)
#     P2 : réponse /configuration → overrides fusionnés (enableVibration, mkb,
#          mic) par-dessus les overrides serveur, champs racine intacts
node bench/preview/port/userscript-rewrite.test.js

# C — hook userscript actif dans la page ? change la lecture de C1/C2 (soft)
node bench/preview/probe-page.js 9222   # hookActif: true/false

# D — anti-dérive de la chronologie requestConnection → play (le timing
#     d'attache du CDP, Prérequis, repose dessus). Sans bundles capturés :
#     warning (--soft, exit 0) ; un bundle présent mais des ancres dérivées :
#     DRIFT = échec
node bench/preview/play-chain.js --soft   # ou --dir=<capture>
```

- **Sortie attendue** : A/B/D en « OK ✅ » (exit 0), + C en « OK ✅ » avec
  `--strict-probe` (hookActif:true exigé). Sinon la logique dérive
  (minifier, ancres) → corriger avant tout run réseau. D alerte si la
  chronologie du play bouge — la fenêtre d'attache de l'outil (avant
  l'ouverture de la page stream) deviendrait caduque.
- **Probe C (informatif par défaut, gate dur avec `--strict-probe`)** : le
  résultat `hookActif` change la lecture des critères C1/C2. En mode strict,
  navigateur injoignable, hookActif:false ou Playwright absent → GATE C ROUGE
  (utile en session réelle quand on exige la preview T6 active avant un run).
  En CI (step preview de bench.yml), le probe est ignoré (`--skip-probe` —
  pas de navigateur CDP sur le runner) :

  - `hookActif: false` → le run CDP voit le play **original**
    (`original:windows`), interprétation directe des critères.
  - `hookActif: true` → le hook a déjà réécrit le play **au niveau page**
    avant le réseau → l'outil logue `original:tizen` et Network montre
    `tizen` même sans CDP : C1/C2 sont « verts » pour la mauvaise raison.
    Pour valider le CDP proprement : désactiver le userscript (ou profil sans
    script), OU lire les logs `[P3] original:` qui tranchent la cause.
  - La réécriture de la **réponse** `/configuration` (P2) reste page-level →
    **invisible dans Network** ; seul le `[P2]` CDP (`fulfillRequest`) ou le
    ressenti en jeu prouvent la voie userscript. C4 ne se lit que sur le run
    intercepté.

## Run 0 — témoin (sans interception)

But : figer la baseline non modifiée, à comparer au run 1.

1. Navigateur normal (pas d'outil attaché), ouvrir play.xbox.com, lancer le stream.
2. Onglet **Network** → filtrer `play` → requête `…/v5/sessions/cloud/play` :
   - **Payload** → `settings.osName` = valeur native (`windows`).
   - **Headers** → pas de `x-ms-device-info` (ou valeur native).
3. Filtrer `configuration` → réponse `…/configuration` :
   - `clientStreamingConfigOverrides` = overrides **serveur uniquement**
     (`useIntervalWorkerThreadForInput`, `nqiConfiguration`,
     `statisticsConfiguration`, `videoConfiguration`) — **aucune** de nos clés
     (`enableVibration`, `enableTouchInput`, `enableMicrophone`…).
4. Noter l'URL complète du play et de la configuration (elles servent de
   référence de forme pour le run 1).

## Run 1 — intercepté

But : prouver que l'outil réécrit les deux cibles sans casser le flux.

1. Lancer l'outil **avant d'ouvrir la page stream** :
   ```bash
   node bench/preview/intercept-session.js --connect=9222 --resolution=1080p-hq \
       --vibration=on --mkb=on --mic=on
   ```
   (optionnel : `--sw` pour couvrir aussi les service workers.)
2. Ouvrir le jeu et lancer le stream. Attendre que la session démarre.
3. Vérifier les **logs de l'outil** (preuves directes) :
   - `[P3] play réécrit → settings.osName=tizen + x-ms-device-info (…)`
     → doit apparaître **dans les premières secondes** du lancement.
   - `[P2] /configuration réécrite → inputConfiguration,nqiConfiguration,… (…)`
     → apparaît après le play (provisioning).

## Validation P1 — idle serveur (fenêtre AFK)

But : prouver que la preview T6 intercepte le `WarningForBeingIdle` et empêche
le kick d'idle serveur pendant une fenêtre AFK (aucun input utilisateur).
**État au 17 août** : le runtime P1 expose `wrapSession` mais ne la branche
encore sur aucune session (localisation de l'instance = pièce manquante) →
les runs actuels sont des **témoins** : ils confirment que le kick idle est
réel sur le preview et en figent le timing.

### Les 3 mécanismes (étude session.md — à ne pas confondre)

| Mécanisme | Fonction | Effet sur l'idle |
|---|---|---|
| Heartbeat HTTP natif (`keepAlivePulseInSeconds: 60` → POST `/keepalive`) | garde la **connexion de session** vivante | aucun — n'alimente PAS l'activité utilisateur |
| Détection d'idle serveur (`WarningForBeingIdle` → `secondsUntilKick` → dispatch) | kick si **aucun input** pendant le countdown | c'est lui qui coupe |
| P1 (`sendKeepAlive` sur interception du warning) | input virtuel gamepad → reset du timer d'idle | seul mécanisme qui empêche le kick |

Un AFK garde la connexion vivante (le heartbeat continue de tourner) mais le
timer d'idle expire quand même → kick. Le heartbeat ne protège donc PAS du
kick idle : les deux mécanismes sont indépendants, et seul P1 fausse l'input.

### Run P1-A — témoin (sans P1 branché)

But : figer le comportement natif — le warning part et son timing de kick.

1. Profil edge-cdp, page play.xbox.com (probe `hookActif: false` pour un
   témoin propre ; `true` sans wrapSession branchée = même résultat).
2. Lancer un stream, **plein écran**, laisser la session se stabiliser ~2 min.
3. Lancer la surveillance **sans toucher à rien** :
   ```bash
   node bench/preview/monitor-idle.js --port=9222 --duration=600
   ```
4. **Ne toucher à RIEN** pendant la fenêtre (souris, clavier, manette — tout
   input reset le timer d'idle serveur).

Signaux attendus : warning **natif** `Warning for being idle; secondsUntilKick:…`
(sans préfixe `BX`) puis kick au countdown (`paused`/navigation →
`survived:false`). Le heartbeat `/keepalive` continue de tourner pendant toute
la fenêtre (preuve de l'indépendance des deux mécanismes).

### Run P1-B — T6 (wrapSession branchée sur la session réelle)

1. Même protocole, mais `hookActif: true` **et** `wrapSession` branchée
   (localisation de l'instance de session au runtime : capture / hook React —
   pièce manquante, voir session.md).
2. Signaux attendus : `BX keep-alive: idle warning intercepted (secondsUntilKick:…)`
   puis **session vivante à la fin** (`survived:true`) — `sendKeepAlive` a
   reset le timer à chaque warning.

### Lecture des signaux (monitor-idle.js)

| Signal (console) | Sens |
|---|---|
| `BX keep-alive: idle warning intercepted (secondsUntilKick:…)` | P1 INTERCEPTÉ ✅ (module patché par `installKeepAliveIdle`) |
| `Warning for being idle; secondsUntilKick:…` (sans préfixe `BX`) | P1 NON actif ❌ — countdown natif → risque de kick |
| `/keepalive` en réseau (~60 s) | heartbeat natif — connexion vivante (indépendant de l'idle) |
| vidéo `readyState`/`paused` + URL | la session survit / a été coupée |

Verdict : **P1 VALIDÉ ✅** = warning intercepté **et** session vivante en fin
de fenêtre. Tout autre combinaison → re-tenter avec les signaux, ou fenêtre
sans warning (ni BX ni natif) = run invalide (le timer n'a pas atteint son
seuil : jeu qui « bouge » tout seul, session trop courte) → allonger
`--duration`.

### Contraintes du protocole

- **Zéro input** pendant la fenêtre : même bouger la souris sur la page reset
  le timer d'idle. La fenêtre longue (défaut 600 s) est le plus dur du
  protocole — prévoir de s'éloigner du PC.
- Chaque run coûte ~10 min d'AFK → faire P1-A d'abord (données de contrôle et
  timing), puis P1-B quand `wrapSession` sera branchée.

### Exécutions P1

#### Exécution 1 — P1-A témoin, 600 s (17 août, ~00:31-00:41)

- Contexte : profil edge-cdp, `hookActif:true`, stream Halo Campaign en cours
  (`play.xbox.com/stream/9N683TDT5M7R/halo-campaign-evolved`), fenêtre
  `monitor-idle.js --duration=600`, zéro input pendant toute la fenêtre.
- **Heartbeat natif `/keepalive` : 11 requêtes, toutes les 60 s**
  (00:31:49 → 00:40:49) — la connexion de session n'a jamais bronché sans le
  moindre input : indépendance heartbeat/idle **confirmée en réel**.
- **Warning d'idle : aucun** — ni `Warning for being idle;` (natif) ni
  `BX keep-alive: idle warning intercepted` (P1 — N/A de toute façon,
  wrapSession non branchée).
- Vidéo : `readyState 4, paused:false` constant ; **session vivante à la fin**
  (vérifiée par probe après la fenêtre : toujours en stream).
- **Verdict : run témoin NON concluant pour le kick** — le warning n'a pas
  atteint son seuil dans 10 min d'AFK totale → **seuil d'idle du preview
  > 10 min** (ou pas de kick sur cette session/ce jeu). Donnée utile pour
  P1-B : rien à intercepter avant ~10 min.
- Prochaine : fenêtre **1800 s** pour rattraper le warning natif et figer le
  timing du kick ; P1-B après branchement de `wrapSession`.

## Critères de succès

| # | Où | Run 0 (témoin) | Run 1 (intercepté) | Statut |
|---|---|---|---|---|
| C1 | Network → play → Payload `settings.osName` | `windows` (natif) | **`tizen`** | |
| C2 | Network → play → Headers `x-ms-device-info` | absent/natif | **présent, `dev.os.name=tizen`** | |
| C3 | Network → play → Payload (autres clés) | `titleId`, `locale`, `timezoneOffsetMinutes`… intacts | **identiques au témoin** (réécriture chirurgicale) | |
| C4 | Network → configuration → response `clientStreamingConfigOverrides` | serveur seul | **serveur + `enableVibration:true`** (+ `enableMouseInput`/`enableKeyboardInput` si `--mkb=on`, `enableMicrophone` si `--mic=on`) | |
| C5 | Network → configuration → response (racine) | `keepAlivePulseInSeconds`, `serverDetails` | **intacts** (fusion, pas remplacement) | |
| C6 | Logs outil | — | `[P3]` puis `[P2]` émis | |
| C7 | Stream | tourne | **tourne toujours** (aucune requête bloquée : continueRequest/fulfillRequest systématiques) | |
| C8 | Ordre | — | `[P3]` avant `[P2]` (play → provisioning) | |

**Critère global** : C1+C2+C4+C7 verts = l'interception fonctionne de bout en
bout (réécriture requête + réponse, flux non bloqué). C3/C5 = la réécriture
est chirurgicale. C6/C8 = l'outil a bien vu le flux dans l'ordre attendu.

## Collecte des preuves

- Copier les **logs complets** de l'outil (stdout).
- Pour chaque critère : capture d'écran ou copie du Payload/Headers/Response
  de l'onglet Network, ou bien `BX_SESSION_CAPTURE` v4 collé en parallèle
  (report complet) pour les URLs et le body du play.
- Journal des runs : date, résolution cible, options P2, URLs play/config,
  état final du stream.

## Pièges connus

1. **Timing** : si `[P3]` n'apparaît pas dans les premières secondes, le
   play est déjà parti — l'interception doit être active AVANT l'ouverture
   de la page stream (le module est lazy, la fenêtre éligibilité→play est
   courte).
2. **Colonne Initiator** : sur le play, elle montre où la requête est
   initiée (page vs worker). Si `entry.worker.js` apparaît, refaire avec
   `--sw`.
3. **Body base64** : dans l'onglet Network, le payload JSON est lisible
   directement ; ne pas confondre avec la forme base64 côté CDP (l'outil
   gère la conversion).
4. **Overrides serveur** : ne pas s'attendre à une réponse `configuration`
   sans `clientStreamingConfigOverrides` — le serveur en envoie toujours
   (le preview merge `ae()` après filtre `ie`). C4 vérifie l'ajout de NOS
   clés, pas la création de l'objet.
5. **Double réécriture (hook userscript actif)** : si T6 tourne dans la page
   (Étape 0, probe-page), le play part déjà `osName=tizen` → l'outil logue
   `[P3] original:tizen` (pas `windows`) et Network montre `tizen` sans CDP.
   Lire les logs `[P3] original:` pour distinguer la cause.
6. **Réponse invisible côté userscript** : la fusion P2 du hook mute le
   `Response` au niveau page → jamais visible dans Network. Si le run
   intercepté montre `enableVibration` dans Network, c'est forcément le
   `fulfillRequest` CDP (C4 = preuve CDP, pas userscript).

## Rejouabilité

Le protocole est manuel (2 runs × ~2 min) tant que la session est
authentifiée. L'outil et ses self-tests sont rejouables :
`node bench/preview/intercept-session.test.js` (51/51) — la logique de
réécriture est couverte sans navigateur ; ce protocole valide la partie
réseau réelle (patterns CDP, SW éventuel, corps réels).

Les étapes **hors-navigateur** (Étape 0) sont rejouables sans session et
sans navigateur : `fetch-early.test.js` (17/17) + `userscript-rewrite.test.js`
(14/14) — elles doivent être vertes avant chaque session CDP (garde la
logique, les runs réels gardent le câblage réseau).

La validation P1 est rejouable **par fenêtre AFK** via
`bench/preview/monitor-idle.js` (session réelle requise — un run = une
fenêtre de surveillance ; les signaux et le verdict sont déterministes).
