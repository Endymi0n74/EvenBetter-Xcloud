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

```bash
# A — document-start viable (T6 garde neutralisé, hook posé avant entry.client,
#     SDK preview capture NOTRE hook : classe ub, i=fetch) — 17/17
node bench/preview/port/fetch-early.test.js

# B — réécriture P2+P3 en vm sur le build réel — 14/14
#     P3 : play → osName=tizen + x-ms-device-info (URL sans GUID)
#     P2 : réponse /configuration → overrides fusionnés (enableVibration, mkb,
#          mic) par-dessus les overrides serveur, champs racine intacts
node bench/preview/port/userscript-rewrite.test.js
```

- **Sortie attendue** : les deux harnais en « OK ✅ » (exit 0). Sinon la
  logique dérive (minifier, ancres) → corriger avant tout run réseau.
- **Optionnel mais recommandé** (navigateur ouvert, 5 s) : vérifier si le
  hook userscript est actif dans la page — il change la lecture des critères
  C1/C2 :

```bash
node bench/preview/probe-page.js 9222   # hookActif: true/false
```

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
