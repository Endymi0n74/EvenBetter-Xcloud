# Protocole E2E — validation de l'interception CDP P3+P2

Valide en session réelle que `intercept-session.js` réécrit le protocole
comme prévu : **P3** (play request → `settings.osName` + `x-ms-device-info`)
et **P2** (réponse `/configuration` → fusion des overrides du stable dans
`clientStreamingConfigOverrides`). Deux runs comparés : **témoin** (sans
interception) vs **intercepté** (avec l'outil), critères vérifiables dans
l'onglet Network ET dans les logs de l'outil.

## Prérequis

- Session authentifiée play.xbox.com (compte Insider, Preview Features).
- Navigateur avec **remote debugging** : `chrome.exe --remote-debugging-port=9222`
  (mode connect) — ou mode launch de l'outil (profil persistant dédié).
- L'outil à jour : `node bench/preview/intercept-session.js` (self-test 45/45).
- **Chronologie du play connue** (session.md) : le play part peu après
  l'ouverture de la page stream (éligibilité → token → connect). L'interception
  doit donc être **active avant** d'ouvrir la page stream.

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

## Rejouabilité

Le protocole est manuel (2 runs × ~2 min) tant que la session est
authentifiée. L'outil et ses self-tests sont rejouables :
`node bench/preview/intercept-session.test.js` (45/45) — la logique de
réécriture est couverte sans navigateur ; ce protocole valide la partie
réseau réelle (patterns CDP, SW éventuel, corps réels).
