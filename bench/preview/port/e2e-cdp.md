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
| B — réécriture P2+P3 | `node bench/preview/port/userscript-rewrite.test.js` | **15/15 OK ✅** (exit 0) — play INCHANGÉ (T8, osName=tizen retiré) ; configuration → overrides fusionnés, serveur préservé |
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

### Run 1 — P2 (exécution 3, 17 août ~12:43) ✅ VALIDÉ

Le `[P2#N]` doit apparaître après le `[P3#N]` (provisioning). Si absent : la
réponse `/configuration` part du worker ou le stage Response ne se déclenche
pas — relancer avec `--sw` et vérifier la réponse dans Network
(`clientStreamingConfigOverrides` doit contenir `enableVibration:true`).

**Exécution 3 (17 août, ~12:43) — chaîne complète + preuve session :**

```
[P3#1 12:43:28] play réécrit → osName=tizen (original:windows) + x-ms-device-info
[P2-staging 12:43:35] /configuration vue (stage Request) ×2 (page + service worker)
[P2#1 12:43:35] /configuration réécrite → inputConfiguration,nqiConfiguration,
                statisticsConfiguration,videoConfiguration,audioConfiguration
```

Commandes : Étape 0 `--strict-probe` passée (A+B+C+D, hookActif:true), puis
`intercept-session.js --connect=9222 --resolution=1080p-hq --vibration=on
--mkb=on --mic=on --sw` (SW attaché : `[sw] interception attachée à
entry.worker.js (CDP brut)`). Stream : `launch-stream.js` + Retry (blip
« offline » d'Edge contourné, cf. piège).

**Preuve C4 dans la session live** (hunt-session → fibre `.Connection` →
`_session`, stream en cours video ready=4) :

| Chemin | Valeur | Origine |
|---|---|---|
| `_configuration.inputConfiguration.enableVibration` | **`true`** | notre fusion (le natif n'envoie que `useUnreliableInput` dans inputConfiguration) |
| `_configuration.audioConfiguration.enableMicrophone` | **`true`** | `--mic=on` (aucun override audio natif) |
| `_configuration.statisticsConfiguration.useQosChannel` | `true` | natif conservé |
| `_configuration.nqiConfiguration.consecutiveBadIntervalsForTrigger` | `10` | natif conservé (le seuil `pingMsBadThreshold:100` aussi) |
| `stream.inputConfiguration` / `sourceManagedInputSink` / `physicalInputSink` | `enableVibration:true` | la config est propagée aux canaux d'input réels |
| `_bxKeepAliveWrapped` | présent | P1 wrapSession branchée (bénéfice collatéral) |

- **Lecture** : le `fulfillRequest` CDP a bien remplacé la réponse `/configuration`
  vue par le SDK — la session a été construite AVEC les overrides du stable
  (vibration, micro). Le critère C4 est satisfait par la config effective, ce
  qui est plus fort que la seule présence dans Network.
- Piège rencontré : le blip « You're offline » d'Edge (déjà vu) bloque le
  chargement de la page stream → le play ne part pas. Contournement : clic
  sur `retryButton` (ou reload) une fois le réseau rétabli ; l'interception
  reste attachée entre-temps.

**Vérification rendu effectif (session CF49BC01, 17 août ~15:30)** — la
résolution 1080p-hq (osName=tizen via P3) est appliquée au rendu :

| Métrique | Valeur | Preuve |
|---|---|---|
| Chaîne CDP de la session | `[P3#3]` play→tizen + `[P2#3]` config réécrite | log intercept-session |
| Résolution décodée | **1920×1080** | `video.videoWidth/videoHeight` (élément vidéo, pas l'upscale canvas) |
| FPS effectif | **59,98 fps** (180 frames / 3,0 s, **0 dropped**) | sampling `getVideoPlaybackQuality()` |
| Render target canvas | 2326×1308 (upscale plein écran) | `_renderTargetWidth/Height` |

- **Lecture** : le serveur a répondu au play `osName=tizen` par un flux
  **1080p60 réel** — la réécriture P3 agit sur la qualité sélectionnée côté
  serveur. `session.deviceInformation.osName` reste `windows` (c'est la
  télémétrie du client, pas le paramètre envoyé au serveur — ne pas s'y
  fier pour vérifier P3).
- **Piège manette (découvert le 17 août, même session)** : sur CF49BC01,
  `enableVibration` était **false** sur TOUTES les inputConfiguration alors
  que sessions 1-2 avaient true — cause : **0 manette connectée**
  (`navigator.getGamepads()` vide) ; le SDK met la vibration à false sans
  gamepad. Vérifier `manettes: N` avant de conclure sur P2 via la config
  (la preuve C4 de la vibration reste la session 1, manette branchée).
- **Rejouable** : `node bench/preview/render-check.js 9222 --sample=3
  --chain=<log>` — gates A résolution / B FPS / C dropped / D chaîne
  P3→P2 (self-test sans navigateur : `--self-test`).

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
./bench/preview/port/run-e2e0.sh [--port=9222] [--dir=/d/tmp/preview-player] [--skip-probe|--strict-probe] [--self-test]
```

`--self-test` rejoue le **chemin d'échec** sans toucher au build réel : il
corrompt une **copie** du build (tronquée à 2 Ko) et relance l'Étape 0 contre
elle via `BX_PREVIEW_BUILD` (surcharge lue par fetch-early + userscript-rewrite)
— exit 1 attendu avec `GATE A/B ROUGE`. Vérifie que le CI échouerait bien si
la logique dérivait ; build réel vérifié intact (copie supprimée).

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
## Gap régions preview — analyse du 19 août (v1.12.0-preview1)

Le test latence / « Appliquer la meilleure région » (v1.10/v1.12) affiche
« Aucune région disponible » sur play.xbox.com alors qu'il fonctionne sur le
stable (probe 15/15). `STATES.serverRegions` reste vide.

**Ce qui EXISTE déjà dans le bundle (vérifié statiquement) :**
- `XcloudInterceptor.handleLogin` (groupe du routeur BX_FETCH) traite la
  réponse `POST /v2/login/user` : lit `obj.gsToken` →
  `RemotePlayManager.setXcloudToken`, puis `obj.offeringSettings.regions`
  (serverOrder + SERVER_EXTRA_INFO) → peuple `STATES.serverRegions` +
  `STATES.selectedRegion` + `STATES.gsToken`. Le code du stable peuple donc
  DÉJÀ les régions si la requête passe par notre hook.
- Le routeur matche bien l'URL du preview :
  `url.endsWith("/v2/login/user")` → handleLogin — vérifié sur
  `https://cloudgaming.gssv-play-prod.xboxlive.com/v2/login/user`.

**La vraie cause (découverte 19 août) — le SDK capture fetch à
l'instanciation, PAS au premier appel :**
- Le client HTTP du SDK preview (`entry.client-h6o444u3.js`, classe `ub`,
  minifiée) a un constructeur `(e,t,n,r,i=fetch)` : le défaut `i=fetch`
  est évalué au moment du `new` (vérifié : un hook window.fetch posé
  avant l'instanciation EST capturé). Le keepalive (60 s) passe bien par
  `window.fetch` (vu sur le téléphone : fetch=3 dont keepalive=3) → le
  SDK utilise window.fetch pour le protocole.
- **Contradiction résolue par le timing** : le `login/user` part au TOUT
  DÉBUT du lancement (avant le stream), le keepalive après. Sur l'APK
  (injection `evaluateJavascript` dans `onPageStarted` de MainActivity),
  l'injection arrive APRÈS l'évaluation des modules ESM → le `new ub()`
  du SDK a déjà mémorisé le fetch NATIF → notre hook ne voit JAMAIS le
  login → `STATES.serverRegions` vide. En Tampermonkey document-start
  (navigateur desktop), l'injection précède les modules → le hook serait
  capturé et les régions se peupleraient (à valider en réel).
- **Pistes de fix** (à tester en session réelle, pas validables sans
  compte connecté) : (a) rendre l'injection APK vraiment document-start
  (WebView.setWebContentsDebuggingEnabled + addJavascriptInterface ne le
  permettent pas directement — `evaluateJavascript` est post-modules) ;
  (b) sur preview, déclencher nous-mêmes le login/user avec le token du
  preview (header Authorization Bearer MSAL — `getAuthorizationHeader()`
  du client) si on arrive à lire le token ; (c) intercepteur CDP
  Fetch.fulfillRequest sur la réponse login/user (outillage bench, pas
  userscript).
- **Localisation du login preview** : intercepteur `RQe` d'entry.client
  (priority 0) matche `/v2/login/user` + `/v2/login/user/delegated`, ajoute
  `Authorization` via `user.getAuthorizationHeader()` (MSAL, pas de token
  dans le corps contrairement au stable). Auth XDS/MSAL en mémoire +
  sessionStorage — le preview ne stocke presque rien en localStorage
  (seule clé littérale : `query-tracker:isEnabled`).
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

## Critère de départ des runs CDP (hook T6 exigé)

Tout run CDP qui exige la preview T6 **active dans la page** — Run 1
(intercepté) et P1-B (AFK) — démarre obligatoirement par :

```bash
./bench/preview/port/run-e2e0.sh --strict-probe
```

**exit 0 requis** = gates **A+B+C+D** verts, avec le probe C en
`hookActif:true` (vérifié en réel le 17 août, session active ou non — le hook
est posé en document-start). Si l'Étape 0 échoue ou sort rouge :

- **A/B/D rouges** → la logique dérive (ancres/minifier) : corriger avant tout
  run — le résultat réseau serait ininterprétable.
- **C rouge (strict)** → le hook n'est pas actif dans la page : le play partira
  non réécrit au niveau page (lecture C1/C2 ambiguë) et P1 ne peut rien
  intercepter. **Aucun run ne part sans hook vérifié.**

Exception assumée : le **Run 0 (témoin)** veut au contraire l'absence de hook
(probe `hookActif:false` acceptable) — la lecture des critères C1/C2 dépend de
l'état vérifié au départ du run, consigné dans le journal.

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

### Run 0 — exécution réelle du contrôle A/B (17 août ~15:27) — P3 sans gain de résolution

**Piège découvert** : un premier « témoin » était **contaminé par la reprise de
session** — après teardown incomplet, le serveur a rendu le **même GUID** que la
session tizen (CF49BC01) au play natif (resource timing : tous les appels gssv
depuis la navigation portaient CF49BC01). Contrôle invalide.

Contrôle propre : teardown complet (navigation vers la home → session tizen
terminée) → observateur passif `observe-play.js` (Fetch log seul, continueRequest
inchangé) → stream natif → **GUID neuf 1156AA48-8AEB-4026-AE50-0297D2564CFB**.

| Métrique | Tizen (P3, CF49BC01) | **Natif windows (1156AA48)** |
|---|---|---|
| play envoyé | osName=tizen (réécrit) + x-ms-device-info | osName=**windows**, x-ms-device-info complet (displayInfo 2560×1392) |
| Résolution décodée | 1920×1080 | **1920×1080** |
| FPS | 59,98 | **60,3** |
| Frames perdues | 0 % | 0,6 % |
| Overrides P2 dans le play | absents (P2 fusionne dans /configuration) | absents (natif) |

**Verdict : P3 n'apporte AUCUN gain de résolution sur ce titre (Halo CE) en
PC cloud gaming — les deux profils reçoivent 1080p60.** Le serveur plafonne le
stream PC à 1080p quelle que soit la qualité demandée ; osName ne change pas la
résolution allouée.

### A/B bitrate (17 août ~13:45-13:58) — P3 sans gain de bitrate non plus

Mesuré avec `bitrate-check.js` (nouveau — localise la session dans les fibers,
`pc = session.streamStats.stream.peerConnection`, `getStats()` ×2 sur 12 s,
Δbytes×8/Δt) :

| Échantillon | Natif windows | Tizen (P3) |
|---|---|---|
| 1 | 6 576 kbps | 6 654 kbps |
| 2 | 4 395 kbps | 4 610 kbps |
| 3 | 5 954 kbps | 5 746 kbps |
| **Médiane** | **~5 954 kbps** | **~5 746 kbps** |

Tous les échantillons : **1080p60**, audio ~130 kbps. Les deux distributions
se recouvrent intégralement (4,4-6,6 Mbps) — l'écart médian ~3 % est du bruit
de contenu, pas un effet osName.

**Réserve méthodologique** : la session tizen a servi sur le même slot serveur
que le natif (GUID 7C346491 — la reprise de session persiste même après
navigation home, redémarrage complet d'Edge et `session.disconnect()` SDK : le
slot est lié au compte/titre). Le play tizen a bien été ré-émis et la
/configuration re-servie à chaque fois, mais la re-provisioning de l'encodeur
côté serveur n'est pas prouvée. Malgré cette réserve, **aucun des 6 échantillons
tizen ne dépasse le max natif** — s'il y avait un effet qualité, on l'attendrait
systématiquement au-dessus.

**Décision P3 (17 août)** : l'override `osName=tizen` (+ device-info tizen) est
un **no-op mesuré** sur PC — résolution ET bitrate identiques.

**Application (17 août, build preview3)** : l'override est RETIRÉ du build —
patch T8 de build-preview.js remplace la condition de réécriture par
`if (false)` (le play passe donc natif, sans osName ni x-ms-device-info
réécrits). L'outil `intercept-session.js` devient **observateur passif** : le
play est loggé (`[P3#n] play observé → osName=… · device-info os=…`) puis
continué SANS modification — `--resolution` est un no-op documenté. P2 (fusion
/configuration) est conservé ; `userscript-rewrite` vérifie désormais que le
play ressort inchangé (osName=windows, aucun device-info ajouté) et que P2
fusionne toujours les overrides. Les fonctions de réécriture
(getOsNameFromResolution/generateMsDeviceInfo/rewritePlayBody) restent dans
l'outil comme référence de test.

## Run 1 — intercepté

But : prouver que l'outil réécrit les deux cibles sans casser le flux.

0. **Critère de départ** : Étape 0 en `--strict-probe` passée (exit 0,
   A+B+C+D, `hookActif:true`) — voir « Critère de départ des runs CDP ».
1. Lancer l'outil **avant d'ouvrir la page stream** :
   ```bash
   node bench/preview/intercept-session.js --connect=9222 --resolution=1080p-hq \
       --vibration=on --mkb=on --mic=on
   ```
   (optionnel : `--sw` pour couvrir aussi les service workers.)
2. Ouvrir le jeu et lancer le stream. Attendre que la session démarre.
3. Vérifier les **logs de l'outil** (preuves directes) :
   - `[P3] play observé → osName=windows (natif, non réécrit) · device-info os=…`
     → doit apparaître **dans les premières secondes** du lancement (P3 est
     passif depuis le 17 août — osName=tizen retiré, voir A/B bitrate).
   - `[P2] /configuration réécrite → inputConfiguration,nqiConfiguration,… (…)`
     → apparaît après le play (provisioning).

## Validation P1 — idle serveur (fenêtre AFK)

But : prouver que la preview T6 intercepte le `WarningForBeingIdle` et empêche
le kick d'idle serveur pendant une fenêtre AFK (aucun input utilisateur).
**État au 17 août** : `wrapSession` est branchée **automatiquement** (locator
fibers intégré au build, voir session.md) → le run P1-B peut valider le kick
en réel. Le run P1-A (témoin, exécution 1) a montré un seuil d'idle du preview
> 10 min : il faut une fenêtre longue pour voir le warning.

### Recherche statique du seuil (17 août — bundles capturés D:\tmp\preview-player)

**Verdict : il n'y a PAS de constante de seuil côté client — le seuil est
CALCULÉ PAR LE SERVEUR.** Recherche exhaustive dans tous les bundles
(`WarningForBeingIdle`, `secondsUntilKick`, `BeingIdle`, `KickForBeingIdle`,
`idleTimeout`, `idleTimer`, `countdown`, `sessionIdleWarningEvent`) :

| Fait | Preuve (StreamSessionRequest-iiux1fqv.js) |
|---|---|
| Le client reçoit `secondsUntilKick` du serveur | `t.reason===WarningForBeingIdle` → log `Warning for being idle; secondsUntilKick:${t.secondsUntilKick}` + trackEvent + dispatch |
| L'événement dispatché n'a AUCUN écouteur | `qe=class … { static type=sessionIdleWarningEvent }` — la chaîne `sessionIdleWarningEvent` n'existe QUE dans la définition du SDK, aucun `.on(` dans entry.client |
| Pas de countdown/kick local | aucun texte « disconnect in », aucun timer d'idle UI dans entry.client |
| Le kick est un message SÉPARÉ du serveur | `KickForBeingIdle` → `doDisconnect()` (pas de minuterie locale) |

- **Conséquence pour P1** : notre wrapSession sur `onServerDisconnectMessage`
  est la SEULE ligne de défense possible (rien d'autre ne traite le warning
  côté client) — architecture confirmée.
- **Calibrage** : empiriquement seuil > 60 min (exécution 2 : 1 h AFK sans
  warning). La prochaine fenêtre ne peut pas être calibrée par le statique ;
  si une fenêtre 1 h ne montre toujours rien, conclure « pas de kick d'idle
  observable en fenêtre raisonnable » plutôt que de chercher la constante.

### Décision P1 (17 août) — validation clôturée, risque résiduel accepté

**Fenêtre longue abandonnée** : une fenêtre AFK de 2 h (seuil supposé > 1 h)
aurait été nécessaire pour borner le seuil serveur au-delà de 60 min —
**impossible : le PC doit rester sans aucune interaction 2 h de suite**
(indisponibilité utilisateur réelle, pas une limite technique). Aucune
alternative : le timer d'idle est **serveur et basé sur l'absence d'input** —
il ne peut être ni accéléré ni simulé (envoyer de l'input virtuel, c'est
précisément ce que fait P1 et ça reset le timer).

**État des preuves** :

| Élément | Valeur |
|---|---|
| Seuil serveur | **> 60 min** (exécution 2 : 1 h AFK sans warning, 16 août) |
| Défense en place | `wrapSession` branchée automatiquement (locator fibers, 16/16 tests) — `wrapped:true` vérifié en réel sur les sessions 17 août |
| Seule ligne de défense possible | wrapSession sur `onServerDisconnectMessage` (rien d'autre ne traite le warning côté client — recherche statique) |
| Mécanismes indépendants | heartbeat natif /keepalive (connexion) ≠ timer d'idle (input) — pas de conflit |

**Décision** : P1 est classé **« défendu, seuil > 1 h, calibration au-delà non
faite »** — validation clôturée. Le risque résiduel (kick possible entre 1 h et
un seuil inconnu) est **accepté** : il est non quantifiable sans une fenêtre
que l'utilisateur ne peut pas se permettre. Si un kick d'idle survient en
usage réel, une fenêtre longue sera faite à ce moment-là — la défense
(wrapSession) est déjà en place et n'a rien à changer.

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

0. **Critère de départ** : Étape 0 en `--strict-probe` passée (A+B+C+D,
   `hookActif:true`) — sans elle, rien à intercepter (voir « Critère de
   départ des runs CDP »).
1. Même protocole, `hookActif: true` — `wrapSession` est branchée
   **automatiquement** par le locator du build (17 août : la session est
   localisée dans les fibers React, fibre `.Connection` → `data._session`,
   et wrapper au montage — détail dans session.md). Vérifiable en direct :
   `session._bxKeepAliveWrapped === true` sur l'objet trouvé par
   `bench/preview/hunt-session.js`.
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

#### Exécution 2 — P1-B fenêtre 3600 s (17 août, 09:10:59 → 10:10:59)

- Contexte : profil edge-cdp, `hookActif:true`, stream Halo Campaign en cours
  (`play.xbox.com/stream/9N683TDT5M7R/halo-campaign-evolved`), fenêtre
  `monitor-idle.js --duration=3600`, zéro input pendant toute l'heure.
- **Gate P1-B passé avant la fenêtre** : `wrapSession branchée ✅ — 3/3
  sessions wrapées` (`_bxKeepAliveWrapped: true` sur la session trouvée dans
  les fibers) — rendu possible par le fix du locator (fallback `document.body`,
  le preview monte sans `#root` — commit `fa5fa6e`).
- **Heartbeat natif `/keepalive` : 60 requêtes, toutes les 60 s**
  (09:11:50 → 10:10:50) — la connexion de session n'a jamais bronché sans le
  moindre input, avec P1 en place : **aucun conflit** entre le heartbeat natif
  et P1 (P1 n'a rien émis, les deux mécanismes ne se sont pas marchés dessus).
- **Warning d'idle : aucun** — ni `Warning for being idle;` (natif) ni
  `BX keep-alive: idle warning intercepted` (P1 jamais exercé).
- Vidéo : `readyState 4, paused:false` constant ; **session vivante à la fin**
  (verdict monitor-idle : `session vivante à la fin : ✅ OUI`).
- **Verdict : P1-B NON concluant pour l'interception** — le warning n'a pas
  atteint son seuil dans **1 h** d'AFK totale → **seuil d'idle du preview
  > 60 min** (ou pas de kick du tout sur cette session/ce jeu). Conséquence
  pratique pour l'usage réel : le preview ne coupe pas après 1 h d'inactivité.
  P1 reste branché comme filet de sécurité, mais sa preuve d'interception
  nécessite une fenêtre au-delà du vrai seuil.
- Prochaine : **chercher statiquement le seuil d'idle dans les bundles**
  (constante serveur côté SDK, comme play-chain) au lieu d'une fenêtre de
  2 h à l'aveugle — calibrer la fenêtre sur la valeur trouvée, ou conclure
  « pas de kick idle preview ».

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

## Journal CI — garde existsSync du step commentaire (17 août)

Le step « Commente la PR — section hot loops » (même logique pour startup /
gpu) porte `always()` pour commenter même quand le bench échoue, mais lisait
le résumé SANS garde : un échec AVANT `check-ratios` (ex. gate rouge au step
Build preview) → `ENOENT: bench-summary.md` + crash du step (vu sur la PR
#15 de contrôle).

- **Fix `8bd1341`** : `fs.existsSync(sectionPath)` avant la lecture — résumé
  absent → log « résumé absent (…) — échec avant sa production, commentaire
  skippé (mode) » + return (aucun appel API → aucun commentaire partiel).
  Résumé présent → comportement inchangé (commentaire même si le job échoue,
  le `always()` garde sa valeur).
- **Validation réelle (PR #16 de contrôle, run 32002128606, 17 août)** : gate
  A volontairement rouge au step Build preview → job hotloops en échec, mais
  le step « Commente la PR » **passe** avec la ligne
  `résumé absent (/home/runner/work/_temp/bench-summary.md) — … skippé
  (hotloops)`. Job startup-cold (succès) : commentaire normal émis — chemin
  heureux intact.
- PR #16 fermée sans merge — le commit de contrôle n'a jamais touché main.

## Validation overlay 1.8.0-preview1 en réel (17 août) ✅

But : prouver que la preview (T1-T7) affiche l'overlay et le bouton settings
dans le header de play.xbox.com, et que le dialog settings s'ouvre.
**Résultat : VALIDÉ** — trois problèmes réels trouvés et corrigés dans
`build-preview.js` (sélecteurs T4, pointer-events, résilience T7) :

### 1. Sélecteurs T4 — le shell preview est du Tailwind, pas de `<header>`

`document.querySelector('header')` → **null** sur play.xbox.com : pas de
header sémantique ni de classe `Header-*` (anchors.md §4 confirmé). Le vrai
top bar est `nav.col-container` (h 73, rangée interne `[class*='flex-row']`
h 48 — logo, nav, spacer, avatar). Fix : `nav.col-container` en tête des
SELECTORS, `[class*='flex-row']` en tête des TARGET_SELECTORS.

### 2. pointer-events — le container z-shell-top est `pointer-events:none`

Le top bar vit dans un container `fixed z-100 pointer-events-none` : chaque
élément interactif du site se ré-arme en `pointer-events:auto`, notre wrapper
non → les clics traversaient vers `<main>` (Playwright : « subtree intercepts
pointer events », elementFromPoint = contenu). Fix :
`wrapper.style.pointerEvents = "auto"` à l'injection.

### 3. T7 — le shell preview REMPLACE le document (nœuds + CSS orphelins)

Observé : le manager de dialogs survit (show() tourne, `bx-no-scroll` posé,
contenu monté) mais **rien ne s'affiche** — l'overlay/container finissent sous
un **ancien `<html>` détaché** (parentNode `isConnected:false`), et la feuille
de style du script (`addCss()` → `<style>` sur documentElement) est effacée
avec lui (zéro règle `bx-*` → dialog `position:static` hors-écran, rect
h=32388). Mécanisme probable : `document.open()` du shell (les références JS
survivent, le DOM est vidé). Fix T7 (interval 2 s, coût nul) : ré-append
overlay + container au documentElement courant si `!isConnected`, et
re-lancer `addCss()` si aucun `<style>` porteur de
`.bx-navigation-dialog-overlay{` (garde anti-doublon).

### 4. Résilience SPA — observer ne disconnete plus

L'ancien T4 disconnectait l'observer après la 1re injection : le nav est
re-rendu par React (hydratation) → le wrapper se faisait détacher sans
ré-injection. Nouveau T4 : observer permanent, coalescé 150 ms, ré-append
seulement si le wrapper est détaché (`isConnected`).

### Résultats du run de validation (profil edge-cdp, 17 août)

| Vérification | Résultat |
|---|---|
| hook fetch actif (`hookActif`, fetch enveloppé) | ✅ `true` |
| Bouton `bx-header-settings-button` injecté | ✅ visible, dans `nav.col-container`, `pointer-events:auto` |
| Clic → dialog settings | ✅ `overlayVisible:true`, `containerVisible:true`, `kids:1`, `.bx-settings-dialog` à l'écran (y=0, 498×1308), zéro erreur console |
| T7 ré-append overlay/container | ✅ `overlayLive:1` après remplacement document |
| T7 ré-injection CSS | ✅ `cssPresent:true` (`.bx-navigation-dialog-overlay{` retrouvé) |

**Attention** : ces fixes sont dans le build local (`better-xcloud-preview.user.js`)
mais **pas** dans la release 1.8.0-preview1 publiée (17 août, avant la
validation). Prochaine release preview requise pour que les utilisateurs en
bénéficient.

## Validation preview3 en réel (17 août ~19:30) ✅ — play natif

But : confirmer que le build **1.8.0-preview3** (T8 : override `osName=tizen`
retiré) est installé et fonctionne en réel — overlay + settings OK, et le
play partant **natif** (osName=windows) sans aucune réécriture.

Méthode : extension `.edge-inject/preview.js` mise à jour avec le build
preview3, Edge relancé sur le profil `C:\edge-cdp` (port 9222), puis
`intercept-session.js --connect=9222` (P3 passif) + lancement d'un stream
Halo CE depuis la page produit.

### Résultats

| Vérification | Résultat |
|---|---|
| Build injecté (extension `.edge-inject`) | ✅ `1.8.0-preview3` (vérifié dans le fichier + script) |
| Overlay | ✅ `BX_PREVIEW` + `BxLogger` + `BX_EXPOSED` présents (monde MAIN, document-start) |
| Bouton settings T4 | ✅ visible dans `nav.col-container` (60×40, `pointer-events:auto`) |
| Dialog settings | ✅ s'ouvre au clic réel — « Better xCloud 6.7.12 », sections Server/Stream/MKB/Touch/UI, Language |
| Session | ✅ authentifiée (cookies `__Host-MSAAUTHP` + `MSPAuth` vivants) |
| **Play natif (T8)** | ✅ `[P3#1 19:29:12] play observé → osName=windows (natif, non réécrit) · device-info os=windows` |
| Stream | ✅ 1920×1080 @ 60 fps, 2482 frames, readyState 4 — session laissée en cours |

**Lecture** : T8 est confirmé en session réelle — le play part sans
modification (`osName=windows`, device-info `os=windows`), la surface de
réécriture du play est bien retirée du build livré. P2 (fusion
/configuration) reste le vrai bénéfice, inchangé dans le build.

Note : sur la page stream immersive (vue jeu plein écran), il n'y a pas de
`<nav>`/header — le bouton du top bar n'y est pas ; l'accès aux settings en
session passe par la **game bar** du script (`bx-game-bar-container`, cachée
par défaut, visible au mouvement de souris). Depuis **T9 (build preview4)**, la
game bar porte un bouton Settings qui ouvre le même dialog (voir section
suivante).

## T9 — bouton settings dans la game bar (17 août ~21:45) ✅

Problème : sur la page stream du preview (`/stream/...`), il n'y a AUCUN
`<nav>`/header (observé : `navs: []`, body = 9 enfants) — le T4 n'a pas
d'ancre d'injection en session, impossible d'ouvrir les settings en cours de
jeu. La seule surface utilisateur du script en session est la **game bar**
(`bx-game-bar`, cachée, visible au mouvement de souris — actions :
screenshot, speaker, renderer, micro, TrueAchievements).

Fix (`build-preview.js`, patch **T9**, preview-only) :
- **`SettingsAction extends BaseGameBarAction`** — bouton icône engrenage
  (`BxIcon.STREAM_SETTINGS`), title « Settings », `onClick` →
  `SettingsDialog.getInstance().show()` (même dialog que le bouton du
  header) + `super.onClick()` (cache la bar, comme les autres actions).
- Injecté en 2e position de `this.actions` du GameBar (après Take screenshot).

Résultats (session réelle, Halo CE, profil edge-cdp, build 1.8.0-preview4) :

| Vérification | Résultat |
|---|---|
| Bouton « Settings » dans la game bar | ✅ 2e action (engrenage), title « Settings » |
| Clic → dialog | ✅ panneau complet ouvert en stream : 498×1440, 5 onglets, 66 lignes |
| Fermeture (Escape) | ✅ dialog fermé, session intacte (1920×1080 en cours) |
| Tests | ✅ userscript-rewrite / intercept-session / Étape 0 verts |

## Validation preview4 publiée en réel (17 août ~22:00) ✅ — asset GitHub

But : valider l'ASSET PUBLIÉ (release `better-xcloud-perf-1.8.0-preview4`),
pas le build local — ce que recevra l'utilisateur via Tampermonkey.

Méthode : téléchargement de `releases/download/.../better-xcloud-preview.user.js`,
comparaison au build local (doit être byte-identique), installation dans
`.edge-inject/preview.js`, Edge relancé sur le profil edge-cdp, puis même
protocole que la validation locale (overlay → stream → game bar).

| Vérification | Résultat |
|---|---|
| Asset GitHub vs build local | ✅ **byte-identique** (494 246 octets, `cmp` OK, `@version 1.8.0-preview4`) |
| Overlay play.xbox.com | ✅ BX_PREVIEW + BX_EXPOSED + BxLogger présents |
| Bouton settings top bar (T4) | ✅ 🇬🇧 UKS, 60×40, dialog ouvert (498×1308, 5 onglets) |
| Stream lancé | ✅ Halo CE (1920×1080, 2041 frames) |
| Game bar en session (T9) | ✅ boutons `[Take screenshot, Settings]` |
| Dialog depuis la game bar | ✅ 498×1440, 5 onglets, 66 lignes — ouvert en session |
| Fermeture | ✅ Escape → dialog fermé, session intacte |

**Lecture** : l'utilisateur recevra exactement le fichier validé — l'asset
publié est identique au build testé en réel (overlay + settings dans le top
bar des pages app + bouton Settings dans la game bar en session).

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

## Validation T10 — gate navigateur play.xbox.com (19 août) ✅ — Firefox OK sans réglage

### Contexte : le gate est Chromium-only

play.xbox.com affiche « Votre navigateur ne prend pas en charge la
diffusion en continu » sur Firefox. Cause dans `entry.client` du site :
`isSupportedChromiumBasedBrowser = (isChrome && >=106) || (isBlinkEngine &&
>=106)`, fallback `satisfies(chrome/edge >=106, safari >=17)` — **Firefox
n'est pas dans la liste**. Check basé sur l'UA détectée (Firefox n'a pas
`userAgentData` → le site parse `navigator.userAgent`), donc **spoofable**.
Le stream WebRTC H.264 fonctionne pourtant sous Firefox (support confirmé,
r/xcloud fév. 2025 « play Xcloud on Firefox », décode hw).

### T10 — auto-spoof UA non-Chromium (build-preview.js)

Si le navigateur réel n'est pas Chromium (regex `chrom(e|ium)|edg/|crios`)
ET que `userAgent.profile` = « default », forcer `windows-edge` par défaut à
`UserAgent.init()`. Le setting garde la main (profil explicite jamais
écrasé), guard `BX_PREVIEW` → stable inchangé. Vérifié statiquement (build,
node --check, probes) et logiquement (Firefox/Safari → spoof ; Edge/Chrome →
inchangé).

### Validation réelle sous Firefox (utilisateur, 19 août ~01:00)

| Build | Réglage UA | Résultat |
|---|---|---|
| **1.10.0-preview1** | `userAgent.profile` = « Edge + Windows » (manuel) | ✅ gate passé — stream OK |
| **1.10.0-preview2** | `userAgent.profile` = « default » (T10 auto-spoof) | ✅ gate passé — stream OK, **sans réglage** |

Le workaround manuel (preview1) et l'auto-spoof (preview2) sont tous les
deux validés en réel : le dialog disparaît et le stream tourne sous Firefox.
T10 = le même contournement, sans intervention. Release publiée :
`evenbetter-xcloud-v1.10.0-preview2` (3 assets dont APK preview), garde-fou
10/10 vert.

**Complément utilisateur (19 août ~01:30)** : sous preview2 + default,
**Halo lancé et joué au pad** dans Firefox — le flux complet (gate → stream
→ input gamepad) passe. La validation n'est plus « le dialog disparaît »
mais le jeu jouable de bout en bout sur Firefox.

### Contre-test Chromium (T10 ne casse rien sur Edge) — 18 août

`node bench/t10-counters-test.js --port=9222` sur Edge 152 réel (profil
edge-cdp + extension preview2) :

| Vérification | Résultat |
|---|---|
| UA détectée | `Edg/152.0.0.0` — **intacte, non spoofée** |
| Script chargé | `BX_EXPOSED` présent (build 1.10.0-preview2) |
| Dialog « navigateur non pris en charge » | **absent** |
| Home play.xbox.com | 10 cartes de jeux, chargement normal |

**Verdict** : T10 est conditionné à la regex non-Chromium — sur un
navigateur Chromium réel, aucun spoof, aucun effet de bord. Le comportement
est donc symétrique : Firefox → auto-spoof (gate passé), Edge/Chrome →
UA native (aucun changement). Validation T10 bouclée des deux côtés.

## T4 mobile — overlay settings invisible en WebView téléphone (19 août) ✅ FAB

**Symptôme (réservé 18 août)** : sur le téléphone, le preview est loggé
(script actif) mais l'overlay/settings n'apparaît pas sur play.xbox.com.

**Diagnostic (BlueStacks, émulation CDP 390×844)** : sur viewport <768 px,
le shell mobile de play.xbox.com n'a **ni `nav.col-container` ni `<header>`**
— le T4 ne trouvait aucune ancre → aucun bouton injecté, aucun accès aux
settings. Sur viewport ≥768 px (1280 testé) le top bar existe et le bouton
s'injecte (validé : clic → dialog). Reproduit puis corrigé.

**Fix (build-preview.js T4, preview3)** : si `window.innerWidth < 768`,
injecter un **FAB fixe** (`.bx-mobile-fab`) au-dessus de la mini-nav basse
(`nav.z-shell-bottom`) — pilule 48 px, radius 999 px, label EvenBetterXcloud,
indépendant de la structure du site. Le chemin desktop est inchangé.

**Validé en WebView réelle (BlueStacks, APK preview3)** :

| Vérification | Résultat |
|---|---|
| FAB injecté (390 px) | `.bx-mobile-fab` présent |
| Bouton stylé | 174×48, `border-radius:999px`, label visible |
| Clic FAB → dialog | `.bx-settings-dialog` ouvert ✅ |
| Desktop (1280 px) | bouton top bar 154×40, pas de FAB, dialog ✅ |
| Gate navigateur | toujours passé (UA Chromium Android) |

Harnais : `bench/mobile-t4-diagnose.js` (modes fab/desktop/shell/bottomnav/
html — l'override CDP est par-session, appliqué PUIS probe dans le même
script). Screenshot `/tmp/mobile-fab-preview2.png`.

## T4 — résilience au remplacement du document (19 août ~13:00, v1.11.0-preview2) ✅

**Symptôme utilisateur (19 août)** : APK preview sur téléphone — le jeu se
lance mais « des fois écran noir et pas de menu EvenBetterXcloud ».

**Reproduction en WebView (BlueStacks, APK preview, 390 px)** :

1. FAB présent et connecté (état initial).
2. `document.open()` + `document.write(minimal)` + `document.close()`
   (simulation du remplacement du shell au démarrage du stream — le même
   mécanisme que la section T7 : les nœuds finissent sous un ancien `<html>`
   détaché).
3. **Sans fix** : après 5 s le FAB est `false` — l'observer T4 observe
   l'ancien `document.body` (mort), et T7 ne ré-injectait que dialog + CSS
   → le bouton ne revient JAMAIS. C'est le « pas de menu » intermittent :
   il dépend de si le remplacement a eu lieu pendant la session.

**Fix (build-preview.js)** : `PreviewSettingsEntry.arm()` réutilisable
(re-crée l'observer sur le document courant, stocke `_observer`/`_root`),
`start()` l'appelle, et l'interval T7 a un point 3 — si
`document.documentElement` change d'identité → re-arm + log « observer
re-arme » ; si le wrapper est détaché ou `_injected` false → `tryInject()`
(ré-appende le FAB au document courant).

**Validé en réel (bundle preview2 sur BlueStacks)** :

| Étape | Résultat |
|---|---|
| FAB initial (390 px) | présent, connecté |
| document.open (shell stream) | FAB détaché |
| Après 6-7 s (interval T7 = 2 s) | **FAB revenu**, connecté ✅ |
| Clic FAB après re-arm | dialog ouvert ✅ |
| Gate navigateur + version | UA Chromium, `@version 1.11.0-preview2`, 18 patches |

Sans fix (bundle précédent), le même scénario laissait le FAB définitivement
absent. ⚠ Le black screen vidéo, lui, n'a PAS pu être reproduit (BlueStacks
non connecté à un compte Xbox) — à re-tester par l'utilisateur sur téléphone
avec preview2 ; si l'écran noir persiste, `adb logcat -s EvenBetterXcloud`
pour diagnoser.

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
