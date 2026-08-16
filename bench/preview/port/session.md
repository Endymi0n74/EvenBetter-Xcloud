# Couche protocole de session — étude de portage stable → preview

_La seule surface réellement partagée des deux clients. Méthode : lecture du
userscript stable (`better-xcloud.user.js`, build v1.7.0) et des bundles
preview capturés (`/d/tmp/preview-player`, session du 16 août). Chaque
affirmation porte une preuve (chaîne exacte + offset)._

## 1. Verdict : le protocole est le même, la plomberie diffère

Les deux clients parlent **le même protocole de session Microsoft** — prouvé
par trois concordances exactes :

1. **`clientStreamingConfigOverrides`** : le stable le lit dans la réponse
   `/configuration` et le réécrit ; le preview le reçoit dans la réponse de
   provisioning et le **valide avec le même nom Zod**
   (`validateClientStreamingConfigOverrides`, export `C` du module
   `StreamSessionConfiguration-n19hnhqy.js`).
2. **Compatibilité clé-à-clé 9/9** : les 9 clés que le stable injecte dans les
   overrides (`enableVibration`, `useUnreliableInput`, `enableMouseInput`,
   `enableKeyboardInput`, `enableTouchInput`, `maxTouchPoints`,
   `enableMicrophone`, `enableGamepadInput`, `enableAbsoluteMouse`) existent
   **toutes** dans le schéma Zod du preview. Vérifié machine.
3. **`WarningForBeingIdle` / `sendKeepAlive` / `onServerDisconnectMessage`** :
   le même message de protocole et le même nom de méthode des deux côtés.

La différence n'est pas le protocole, c'est **où le client applique la config** :
le stable la réécrit au niveau fetch (intercepteurs), le preview la fusionne
**côté client** avec une porte de sortie native (`options.ignoreServiceConfiguration`)
et un mécanisme de flags URL (`session.configuration.*`).

## 2. Surface par couche (stable vs preview)

| Couche | Stable (userscript) | Preview (bundles) | Portage |
|---|---|---|---|
| **Config de session** | `XcloudInterceptor.handleConfiguration` : parse la réponse `/configuration`, réécrit `obj.clientStreamingConfigOverrides` (vibration, mkb, touch, micro) | `StreamSessionRequest` (offset 80925) : `clientStreamingConfigOverrides` fusionné **par-dessus** la config client (`ae(configuration, overrides)`), sauf si `options.ignoreServiceConfiguration` | **re-dériver** — l'injection se fait dans la config client (factory `b()`), pas le fetch |
| **Play / provisioning** | `XcloudInterceptor.handlePlay` : réécrit `body.settings.osName` (résolution) + `body.settings.locale` + header `x-ms-device-info` sur `/sessions/cloud/play` | `StreamSessionRequest` : `settings.osName = E(t)` (helper osName du module config) depuis `deviceInformation` | **re-dériver** — piloter `deviceInformation`/config au lieu du fetch |
| **Keep-alive idle** | patch de chaîne `remotePlayKeepAlive` : `onServerDisconnectMessage(e){` intercepté → si `reason === "WarningForBeingIdle"` → `this.sendKeepAlive()` (au lieu de laisser déconnecter) | **même nom de méthode** `onServerDisconnectMessage(e){` (offset 68298) : cas `WarningForBeingIdle` → `eventTarget.dispatchEvent(new qe(secondsUntilKick))` (countdown UI) ; classe avec `sendKeepAlive()` (input virtuel gamepad, offset 50742) ; heartbeat natif `setInterval(heartBeatSession, keepAlivePulseInSeconds*1000)` (offset 27509) | **ancre identique** — le patch de chaîne du stable s'applique tel quel ou presque |
| **Serveurs / région** | `XcloudInterceptor.handleLogin` : `X-Forwarded-For` (bypass), sélection région depuis `offeringSettings.regions`, `gsToken` | login côté `auth-hooks`/`entry.client` (non disséqué — runtime requis) | **à étudier runtime** |
| **ICE** | `patchIceCandidates` : tri IPv6 (`preferIpv6Server`) | `adapter_core` (RTC, 154× RTCPeerConnection) | **à étudier runtime** |

## 3. Ce qui rend le portage preview plus simple que prévu

### 3.1 Flags URL natifs (la config client est surchargeable sans fetch)

`GameStreamBootstrapper` (offset 121961) expose un système de flags
(`setGateValue`) qui mappe des noms publics vers des chemins de config :

```
Session: {
  ignoreServiceConfiguration: 'session.configuration.options.ignoreServiceConfiguration',
  systemUpdateGroup:         'session.configuration.options.systemUpdateGroup',
  releaseChannel:            'session.configuration.options.releaseChannel',
  showStreamStatisticsOverlay:'session.configuration.video.showStreamStatisticsOverlay',
  useSoftwareRendering:      'session.configuration.video.useSoftwareRendering',
  videoDecoderType:          'session.configuration.video.videoDecoderType',
  enableHevc:                'session.configuration.video.enableHevc',
  useHardwareAudioDecoding:  'session.configuration.audio.useHardwareAudioDecoding',
  videoLatencyPreset:        'session.configuration.video.videoLatencyPreset',
  ipAddress: 'ipAddress', secureWebsocketsMode: 'wssMode', ...
}
```

→ la config du preview se pilote par URL/flag, y compris
`ignoreServiceConfiguration` (ignorer les overrides serveur) — la capacité que
le stable obtient en réécrivant la réponse.

### 3.2 Le merge des overrides est côté client

`StreamSessionRequest` (offset 80925) :
```
if (e.clientStreamingConfigOverrides) {
  if (this.configuration.options.ignoreServiceConfiguration) { /* ignoré */ }
  else {
    // retirer les clés client-exclusives (liste `ie` : options, systemUiHandler,
    // touchControlHandler, nexusButtonHandler, clientDeviceCapabilities, pollingConfiguration)
    // puis fusion PAR-DESSUS la config client
    r = ae(this.configuration, overrides)
  }
}
```

→ l'équivalent du `handleConfiguration` stable s'injecte dans la **construction
de la config client** (factory `b()` du module `StreamSessionConfiguration`,
export `t`), pas dans un intercepteur fetch. Le schema Zod
(`validateClientStreamingConfigOverrides`, export `C`) est la **garde de
conformité** : toute clé hors schéma serait rejetée.

### 3.3 La résolution : `osName` existe déjà dans le play request preview

`StreamSessionRequest` : `settings.osName = E(t)` où `E` = helper osName du
module config (export `l`/`s`), calculé depuis `deviceInformation`
(`clientDeviceCapabilities` dans la config, mise à jour via
`updateClientDeviceCapabilitiesAsync`). Le trick résolution du stable
(`body.settings.osName` + `x-ms-device-info`) a donc un équivalent natif.

## 4. Plan de portage (3 pièces, par risque croissant)

### P1 — Keep-alive idle (ancre identique, quasi gratuit) — **IMPLEMENTE v1**

Le stable : `remotePlayKeepAlive` patche `onServerDisconnectMessage(e){` pour
intercepter `WarningForBeingIdle` et appeler `this.sendKeepAlive()`.
Le preview a **le même nom de méthode** sur sa classe de session
(offset 68298) et une méthode `sendKeepAlive()` (input virtuel, offset 50742) —
**même classe** (classe `e` du module, vérifié : offsets 50742 et 67876).

Implémentation livrée (`bench/preview/port/keepalive-idle.js`, source unique) :
- **Transform source** `patchStreamSessionRequestSource(src)` : remplace la
  branche `WarningForBeingIdle` du handler (le compte à rebours
  `dispatchEvent(new qe(...))`) par `this.sendKeepAlive()`. Validé sur le
  bundle capturé (ancre 1×, `node --check` du module patché, 14/14 tests).
- **Runtime userscript** `installKeepAliveIdle()` (embarqué en fin de build,
  transform T5 — après `main();` pour se chaîner au hook fetch final) :
  1. hook `window.fetch` du module `StreamSessionRequest-*.js` (si le runtime
     le charge via fetch — à confirmer en session) ;
  2. api `window.PreviewKeepAliveIdle.wrapSession(session)` — wrapper
     `onServerDisconnectMessage` interceptant `WarningForBeingIdle` →
     `sendKeepAlive()`, à brancher dès que la session est localisée
     (capture runtime / hook React).

Risque : faible (ancre identique, `sendKeepAlive` existe, méthode gardée
`if(!this.stream?.getInputChannel())`). Reste à valider en session : la voie
réelle de chargement du module (fetch vs ESM natif → le hook fetch serait
inactif, le wrapSession reste la voie principale), et que l'input virtuel
`sendKeepAlive` reset bien le timer d'idle serveur.

> **Verdict étude 16 août — le hook fetch ne couvre PAS le keep-alive, P1
> reste nécessaire** :
>
> 1. **Routage `XcloudInterceptor.handle`** (stable ET preview — identiques) :
>    seules routes traitées = `login/user` (auth, `offeringId: "xhome"`),
>    `sessions/cloud/play` (P3), `waittime/` (UX file), `configuration` (P2),
>    `ice` GET — tout le reste (dont `/keepalive`) passe par `NATIVE_FETCH`
>    **sans réécriture**.
> 2. **`handleLogin` ≠ keep-alive** : réécrit l'offering vers xhome et la base
>    d'URL (authentification/région) — aucun lien avec le heartbeat.
> 3. **`handleWaitTime` ≠ keep-alive** : lit `estimatedAllocationTimeInSeconds`
>    pour afficher le temps de file sur l'écran de chargement — UX pure.
> 4. **P1 vs heartbeat natif : complémentaires, pas redondants** — trois
>    mécanismes distincts dans le preview :
>    - heartbeat HTTP natif (`keepAlivePulseInSeconds: 60` →
>      `setInterval(heartBeatSession)` → POST `/v5/sessions/cloud/{id}/keepalive`)
>      : garde la **connexion de session** vivante (niveau réseau) ;
>    - détection d'idle serveur (`WarningForBeingIdle` → countdown
>      `secondsUntilKick` → `dispatchEvent(new qe(...))` → UI) : déclenchée par
>      l'**inactivité utilisateur** (pas d'input), indépendante du heartbeat ;
>    - P1 : intercepte le Warning → `sendKeepAlive()` (input virtuel gamepad)
>      → reset du **timer d'idle serveur**.
>    Un utilisateur AFK garde la connexion vivante (heartbeat) mais le timer
>    d'idle expire quand même → kick. Seul P1 fausse l'input pour le reset.
>    La présence de la branche `WarningForBeingIdle` dans le bundle preview
>    prouve que le kick idle est réel (même SDK de session que le stable).
> 5. **Cohérence avec le stable** : son keep-alive passe par
>    `remotePlayKeepAlive` (patch de classe `onServerDisconnectMessage`), pas
>    par `XcloudInterceptor` — le build preview reproduit exactement cette
>    architecture (T5), il n'y a **pas** de régression de build sur ce point.

### P2 — Config overrides (vibration, mkb, touch, micro)

Le `handleConfiguration` stable réécrit la réponse ; sur le preview, injecter
dans la **config client** avant le merge :

- **Hook constructeur** `StreamSessionRequest` (ou la factory `b()`) : forcer
  `configuration.inputConfiguration.enableVibration`, `enableMouseInput`,
  `enableKeyboardInput`, `enableTouchInput`, `maxTouchPoints`,
  `audioConfiguration.enableMicrophone` selon les prefs script — **les mêmes
  clés que le stable** (9/9 compatibles avec le schéma).
- Option `ignoreServiceConfiguration: true` pour empêcher le serveur d'écraser
  les choix du script (équivalent du « le stable a le dernier mot »).

Risque : moyen. Les clés sont compatibles (prouvé), mais le point de hook exact
(constructeur vs flags) se confirme runtime — et le schéma Zod rejette toute
clé inconnue (garde stricte, à connaître avant d'injecter).

### P3 — Play request (résolution, locale) — **harnais de capture prêt, à lancer en session**

Le stable réécrit le payload `/sessions/cloud/play` ; sur le preview, piloter
`deviceInformation`/`clientDeviceCapabilities` (osName) avant le play.

**Ce que les statics prédisent déjà :**
- Endpoint : log « Subsequent **v5/.../play** calls » (`StreamSessionRequest`,
  offset 75005) ; domaines `gssv` (relying parties `gssv.xboxlive.com` /
  `connect.gssv.xboxlive.com`, `entry.client` @1799230 ; exemple réel
  `gssv-sigl-prod.xboxlive.com/v1/usersigls`). Le PlayService est lazy
  (`playServiceAdaptor`, `entry.client` @3072649 — module runtime non
  statique, `capture.js` le dump en session).
- Forme du play request : `settings.osName = E(t)`, `settings.locale`,
  `settings.timezoneOffsetMinutes`, `settings.sdkType:"web"`, `settings.highContrast`
  (`StreamSessionRequest`, offsets ~69600) — la forme dérivée de
  `deviceInformation` (classe `te`/`wd` d'entry.client, non résolue en
  statique — à capturer).

**Harnais livré** (`bench/preview/capture-session.js`, smoke 11/11) : capture
en session authentifiée des endpoints du protocole (play/configuration/
waittime/ice/sdp/usersigls/sessions) avec méthode + body request/response.
Procédure dans `bench/preview/README.md` — coller le script dans la console
avant de lancer le stream, puis `BX_SESSION_CAPTURE.report()` / `.download()`.

Risque : le plus élevé — dépend du runtime (endpoint exact + forme du
device-info), désormais mesurables par la capture.

## 4 bis. État du plan de portage

| Pièce | État | Détail |
|---|---|---|
| **P1 keep-alive idle** | ✅ implémenté v1 | `keepalive-idle.js` + T5 dans le build — 14/14 tests, à valider en session (voie de chargement + reset du timer) |
| **P2 config overrides** | à faire | injection dans la config client (factory `b()`) — mêmes clés (9/9 compatibles) |
| **P3 play/résolution** | à faire | piloter `deviceInformation`/osName — runtime requis |

## 5. Ce qui reste à valider en session runtime

> **Essai réel 16 août (P3)** : premier report `capture-session` — **0 requête
> capturée** alors que la page `/stream/9N683TDT5M7R/...` s'était ouverte.
> Le harnais v1 ne hookait que `window.fetch` de la page → il ne voyait ni
> XHR, ni WebSocket, ni le trafic d'un éventuel worker/iframe, et ne pouvait
> pas distinguer « session jamais démarrée ». Le harnais v2 couvre
> fetch+XHR+WS+resource timing avec compteurs vues/matchées (`diag()`)
> pour trancher ces cas.

> **Validation runtime 16 août (P3, 2e essai)** — trace resource timing du
> navigateur (le protocole passe par un **worker** : fetch=1, xhr=0, ws=0
> mais 224 ressources dont 11 protocolaires) :
>
> | Endpoint réel (session 8A7F6A20-…) | Rôle |
> |---|---|
> | `cloudgaming.gssv-play-prod.xboxlive.com/v2/login/user` | login cloud |
> | `uks.core.gssv-play-prod.xboxlive.com/v5/sessions/cloud/play` | **provisioning** (P3) |
> | `…/v5/sessions/cloud/{id}/state` (×3) | polling état |
> | `…/v5/sessions/cloud/{id}/configuration` | config serveur |
> | `…/v5/sessions/cloud/{id}/sdp` (×2) | négociation WebRTC |
> | `…/v5/sessions/cloud/{id}/ice` (×2) | ICE |
> | `…/v5/sessions/cloud/{id}/keepalive` | **heartbeat HTTP natif** (P1) |
>
> Le protocole est le **même gssv v5 que le stable** (la prédiction
> `v5/.../play` était juste) — seule diffère la base d'URL
> (`uks.core.gssv-play-prod` vs `westus.gssv-prod` du stable, région
> `uks` = UK South). Le preview a aussi un **endpoint keepalive HTTP dédié**
> en plus du heartbeat `keepAlivePulseInSeconds` : P1 (interception
> `WarningForBeingIdle` → `sendKeepAlive`) reste complémentaire.
>
> **Localisation du protocole (analyse statique 16 août, corrigée)** : le
> service worker `entry.worker.js` (récupéré sans auth, 262 Ko) est un
> **précache Workbox pur** — 0 import ESM dans le code exécuté (les modules
> de session n'y figurent QUE dans le manifeste de précache, strings +
> integrity), routes = navigation same-origin (`NetworkFirst` timeout 3 s) +
> images (`StaleWhileRevalidate`), aucune route gssv, et le code déclare que
> les requêtes non-matchées passent au réseau « as if there were no service
> worker present ». Le protocole ne tourne PAS dans le SW. La chaîne réelle :
> `entry.client` → (lazy React Router) → `GameStreamBootstrapper` → import
> STATIQUE de `StreamSessionRequest` (Bootstrapper sans aucun `new Worker`/
> `importScripts`/`blob:`) → le protocole s'exécute **dans la page**.
>
> **Paradoxe restant** : si le protocole vit dans la page, pourquoi les hooks
> `window.fetch` n'ont rien vu ? Le play part au tout début du lancement — si
> le harnais est collé APRÈS le démarrage, il ne reste que state/keepalive
> (espacés, parfois au-delà de la fenêtre) et d'éventuels transports non
> couverts (sendBeacon/keepalive fetch, couverts depuis la v4). À trancher
> par une capture avec harnais collé **avant** le lancement + ligne workers.
> Conséquence pour P2/P3 : si la page porte le protocole, le hook fetch
> devient de nouveau possible (comme le stable) et l'interception CDP reste
> la voie robuste (page ET worker).

> **Paradoxe résolu — capture décisive 16 août (20:45, harnais v5 collé sur
> la HOME avant l'ouverture de la page stream)** : le timing était parfait
> (collage 20:45:01 sur home, page stream ouverte 20:45:32) et pourtant :
>
> ```
> Requêtes capturées : 0
> Vues par transport : fetch=3 (dont keepalive=3) · xhr=0 · ws=0 · beacon=0
> Resource timing : 250 ressources chargées, 1 protocolaires
> → /v2/login/user (cloudgaming.gssv-play-prod.xboxlive.com)
> ⚠️ DIAGNOSTIC : resource timing VOIT 1 requêtes protocolaires mais les hooks
>    page ne les ont pas capturées — transport non couvert
> ```
>
> **La cause, prouvée statiquement** (`entry.client`, offsets 777849/780497) :
> le SDK preview construit ses clients HTTP avec une **référence `fetch`
> capturée au chargement du bundle** :
>
> ```js
> ub=class{constructor(e,t=[],n=[],r=[],i=fetch){ … this._baseFetchImpl=i … }}
> …
> this.httpClient=new ub(void 0,[i])        // ← fetch capturé ICI
> this.signedHttpClient=kM(n,r).requestInterceptor(i).build()  // build() → new ub(…) → fetch par défaut
> ```
>
> `entry.client` étant chargé **dès la home**, la référence `fetch` d'origine
> est figée AVANT qu'un harnais collé en console (après chargement) puisse la
> remplacer. Toutes les requêtes du protocole (login/play/state/…) passent par
> cette référence → invisibles pour `window.fetch` hooké, quel que soit le
> timing du collage. **Le paradoxe des « hooks muets » est définitivement
> expliqué : ce n'était ni le timing, ni un worker — c'est la référence
> `fetch` capturée au bootstrap.**
>
> Conséquences :
> - **Les hooks JS de page sont impuissants sur le preview** (contrairement au
>   stable qui appelle `window.fetch` à chaud). La capture en console ne peut
>   PAS voir le protocole — elle ne voit que le resource timing (niveau
>   navigateur) et la télémétrie.
> - **CDP reste la voie unique côté page** : `Fetch.requestPaused` travaille au
>   niveau navigateur, avant que la référence `fetch` du SDK ne soit utilisée
>   → c'est pourquoi la validation P3 réelle a fonctionné (`[P3#1] play
>   réécrit → osName=tizen (original:windows)`), et pourquoi `--sw` n'est pas
>   nécessaire (le protocole est bien en page, pas dans le SW — seulement
>   invisible aux hooks JS).
> - Alternative d'injection pour le build preview : hooker la référence
>   capturée n'est pas possible, mais le userscript peut s'exécuter **avant**
>   entry.client (`@run-at document-start`) et wrapper `fetch` avant que le
>   SDK ne le capture — à étudier pour P2/P3 côté build.

> **Injection document-start : VIABLE pour P2/P3 côté userscript (étude +
> mesure 16 août, `bench/preview/port/fetch-early.js`)**. Le paradoxe (réf.
> ci-dessus) disait « hooks JS impuissants, CDP seule voie ». L'étude corrige
> la conclusion : les hooks posés en console (après entry.client) sont
> impuissants, MAIS le build preview est `@run-at document-start` +
> `@grant none` — s'il pose `window.fetch` AVANT le chargement d'entry.client,
> la classe `ub` du SDK capture NOTRE hook (`i=fetch` par défaut évalué à
> l'instanciation, au bootstrap d'entry.client).
>
> **Le blocage réel n'était pas le timing : c'était le garde `Not xCloud page`**
> du stable, qui throw si le pathname n'est pas `/<locale>/play` — sur
> play.xbox.com le pathname est `/`, `/stream/...`, `/products/...` → le garde
> tuait TOUT le script AVANT `main()`, donc sans hook fetch, sans overlay
> complet, sans T5. Fix livré : **T6** dans `build-preview.js` — le garde est
> neutralisé sur preview (`if (!BX_PREVIEW && …)`), main() tourne, le hook
> est posé en document-start. (C'est très probablement la cause du « aucun
> overlay » signalé sur la preview1.)
>
> **Mesure (fetch-early.js, 17/17)** :
>
> | Volet | Résultat |
> |---|---|
> | Garde T6 sur preview (`/stream/…`, `/products/…`, `/`) | ✅ `main()` atteint |
> | Garde stable préservée (`/fr-fr/play` passe, hors-xCloud throw) | ✅ protection intacte |
> | Build : `@run-at document-start` + `@grant none` | ✅ |
> | Build : `main()` au top-level, hook `BX_FETCH = window.fetch =` avant main() | ✅ |
> | SDK : `new ub(void 0,[i])` et `build()` → `_baseFetchImpl === window.fetch` (NOTRE hook) | ✅ |
> | NATIVE_FETCH préservé (pas de boucle) | ✅ |
>
> **Conséquence pour P2/P3** : si le hook du stable (XcloudInterceptor, qui
> gère déjà play/configuration/login/ice) est posé avant entry.client, les
> requêtes du SDK preview passent dedans → **les handlers existants du stable
> s'appliquent tels quels** : `handlePlay` (osName + x-ms-device-info),
> `handleConfiguration` (overrides), etc. La voie CDP reste un filet de
> sécurité ; l'injection document-start rend P2/P3 possibles **sans CDP**.
> Reste à valider en session réelle : que main() ne rencontre pas d'autre
> garde/erreur sur play.xbox.com (le pathname n'est pas xCloud, certaines
> ancres DOM du stable peuvent manquer — à confirmer avec la preview1
> réinstallée) et que le hook intercepte réellement le play preview
> (log XcloudInterceptor / vérif osName dans la réponse).

> **Réécriture userscript P2+P3 prouvée en vm (16 août,
> `bench/preview/port/userscript-rewrite.js`, 14/14)** : la classe
> `XcloudInterceptor` est extraite **du build preview réel** et exécutée dans
> un vm avec `NATIVE_FETCH` simulé — les requêtes réelles du protocole y
> passent et ressortent réécrites, SANS CDP :
>
> | Scénario | Résultat |
> |---|---|
> | P3 play POST (URL sans GUID `…/v5/sessions/cloud/play`, forme réelle) | `settings.osName` windows → **tizen** + header `x-ms-device-info` `dev.os.name=tizen` |
> | P3 chirurgical | `locale`, `clientSessionId` intacts ; `resolution=auto` → inchangé ; `1080p` → windows |
> | P2 réponse `/configuration` (avec GUID, forme réelle) | `enableVibration:true` + `enableMouseInput`/`enableKeyboardInput` (mkb=on) + `enableMicrophone` (mic=on) **fusionnés par-dessus** les overrides serveur (`useIntervalWorkerThreadForInput`, `videoConfiguration` préservés) ; `keepAlivePulseInSeconds` intact |
>
> → le hook userscript (posé en document-start par T6, capturé par le SDK
> via la classe `ub`) réécrit play + configuration **sans CDP**. Détails de
> mise en garde pour la mesure : le play est routé par
> `url.endsWith("/sessions/cloud/play")` → l'URL play est **sans GUID** (les
> state/configuration l'ont) ; `class` est lexicale dans le vm (évaluation en
> class expression pour l'attacher au sandbox) ; le sandbox doit fournir
> `window.location.host` (lu par `generateMsDeviceInfo`).
>
> **Indice runtime réel (16 août, log CDP 21:16) : `[P3#1] play réécrit →
> osName=tizen (original:tizen)`** — le play partait déjà avec `osName=tizen`
> AVANT l'interception CDP, cohérent avec la voie userscript active (le hook
> document-start l'a réécrit en amont) — à confirmer en session avec la
> preview1 reconstruite installée.

> **Chronologie du play (analyse statique 16 août)** — la chaîne complète du
> play request, dans l'ordre du lancement :
>
> ```
> mutation requestConnection (accs.system, entry.client 845296)
>   → fetch connectionEligibility
>   → si eligible : syncConnectionState (846616)
>     → connectionManager.connect(streamUser) (847002, « Eligible, connecting to ACCS... »)
>       → performConnect (830243) : getToken() → createSession(token)
>         → Ude.createSession (831367) : getHttpConfiguration → t.createSession({httpConfiguration, gsTokenProvider})
>           → StreamSessionRequest.createSession (76006) : validité navigateur → startProcessingRequest()
>             → triggerPlayRequest (82607/83548, « Creating new cloud session »)
>               → sendPlayRequest → playService.sendPlayCloud → POST /v5/sessions/cloud/play
> ```
>
> **Conclusion timing** : le play est déclenché par la mutation
> `requestConnection`, APRÈS un fetch d'éligibilité — c'est-à-dire dès que la
> page stream décide de lancer (auto-start ou clic), et tout de suite après
> le chargement du module `StreamSessionRequest` (lazy, chargé à l'ouverture
> de la page). La fenêtre entre le chargement du module et le play est
> **courte** (éligibilité + token) : un harnais collé après ce moment rate
> forcément le play — cohérent avec les captures à 0 requête. Seule une
> capture collée **avant l'ouverture de la page stream** (sur la home) peut
> espérer voir le play passer par le fetch de la page.

> **Réponse `/configuration` capturée (16 août, session réelle)** :
>
> ```json
> {
>   "keepAlivePulseInSeconds": 60,
>   "timeoutForNoConnectionSeconds": 300,
>   "serverDetails": { "ipAddress": "13.104.113.180", "port": 1059,
>     "srtp": { "key": "…" }, "ipV4List": [{ "address": "…", "port": 1059,
>     "rigPort": 1291, "routingPreference": "AZURE" }] },
>   "clientStreamingConfigOverrides": "{\"inputConfiguration\":{\"useIntervalWorkerThreadForInput\":true,\"useUnreliableInput\":true},\"nqiConfiguration\":{\"consecutiveBadIntervalsForTrigger\":10,\"pingMsBadThreshold\":100},\"statisticsConfiguration\":{\"useQosChannel\":true},\"videoConfiguration\":{\"preferMainH264Profile\":true}}"
> }
> ```
>
> Confirmations pour P2/P1 : `keepAlivePulseInSeconds: 60` (P1, heartbeat
> HTTP natif toutes les 60 s) ; `clientStreamingConfigOverrides` est **déjà
> présent** (le serveur en envoie) → P2 doit **fusionner** ses overrides dans
> ce JSON, pas le remplacer. Le handler client (StreamSessionRequest offset
> 80925) filtre d'abord la liste **client-exclusive** `ie` (`options`,
> `systemUiHandler`, `touchControlHandler`, `nexusButtonHandler`,
> `clientDeviceCapabilities`, `pollingConfiguration` — clés RACINE du
> module config, export `v`/`r`), puis merge `ae(configuration, overrides)`.
> Les overrides du stable (sous-clés `inputConfiguration.enableVibration`/
> `enableTouchInput`/`maxTouchPoints`/`enableMouseInput`/`enableKeyboardInput`,
> `audioConfiguration.enableMicrophone`…) ne sont **pas** dans `ie` → P2 est
> **wire-viable** : ils passent le filtre et sont mergés par `ae()`.

> **Réponse de provisioning capturée (16 août, play request réel)** :
>
> ```json
> {
>   "sessionPath": "v5/sessions/cloud/8A7F6A20-DA4A-4607-9B45-29180C93730B",
>   "queueConfig": "5edc6781f2323dd74abd82dd2794e07026810ca25e8cb42ae63f6cf4eb8086a0"
> }
> ```
>
> `sessionPath` est la **base des endpoints subséquents** (state/configuration/
> sdp/ice/keepalive) — le client le parse dans `setSessionPath` (regex GUID)
> puis `triggerPlayRequest` log `sessionPath: ${t.sessionPath}` avant
> `continueWithPolling()`. **Pas de `clientStreamingConfigOverrides` dans la
> réponse play** : comme sur le stable, il arrive dans la réponse
> `/configuration` (le `handleConfiguration` du stable réécrit cette réponse
> — même route `…/configuration` côté preview) → P2 cible la réponse
> `/configuration`, P3 cible la REQUÊTE play (osName + x-ms-device-info).

> **Forme `deviceInformation` capturée (play request réel, 16 août)** :
> wire-compatible avec le stable (mêmes clés `body.settings.*`).
>
> ```json
> {
>   "nanoVersion": "V3;WebrtcTransport.dll",
>   "enableTextToSpeech": false,
>   "highContrast": 0,
>   "locale": "fr-FR",
>   "useIceConnection": false,
>   "timezoneOffsetMinutes": 120,
>   "sdkType": "web",
>   "osName": "windows",
>   "enableOptionalDataCollection": false
> }
> ```
>
> **Analyse du build du body (StreamSessionRequest, offset 84276)** :
>
> ```js
> let t = this.playService.deviceInformation,   // ← osName vient d'ICI
>     n = { nanoVersion: k(this.streamType),
>           enableTextToSpeech: this.configuration.options.enableNarrator,
>           magnifier: this.configuration.options.enableMagnifier,
>           highContrast: this.configuration.options.highContrastMode,
>           locale: this.locale,
>           useIceConnection: !1,
>           timezoneOffsetMinutes: this.configuration.options.timezoneOffsetMinutes,
>           sdkType: `web`,
>           osName: E(t),                         // E = module osName
>           enableOptionalDataCollection: this.configuration.options.enableOptionalDataCollection }
> ```
>
> Conséquence pour P3 : la plupart des champs sont pilotables par
> `configuration.options.*` (donc par flags URL / overrides client), mais
> **`osName` est dérivé de `playService.deviceInformation`**, PAS des options
> — le trick résolution (osName windows/tizen/android → résolution servie)
> ne se pilote pas par une option native. Et comme le play request part du
> **worker**, le hook fetch de page du stable (`handlePlay` réécrit
> `body.settings.osName` + header `x-ms-device-info`) n'est pas portable tel
> quel. Voies possibles pour P3 : (a) interception réseau CDP
> (`Fetch.requestPaused` → `continueRequest` avec body/headers réécrits,
> fonctionne page ET worker), (b) hook du module `playServiceAdaptor`/`te`
> (deviceInformation) si le module s'exécute dans la page, (c) confirmé par
> le mapping flags de GameStreamBootstrapper : aucune flag URL `osName`/
> `resolution` n'existe (flags = video/audio/devkit uniquement).

1. **Endpoint de provisioning** du preview — **CONFIRMÉ runtime 16 août** :
   `uks.core.gssv-play-prod.xboxlive.com/v5/sessions/cloud/play` (base gssv
   v5 identique au stable, région `uks`).
2. **Mécanisme flags URL réel** : `setGateValue`/`session.configuration.*` —
   s'applique-t-il avant la construction de `StreamSessionRequest` ?
3. **`ignoreServiceConfiguration`** : accessible en flag public ou réservé
   devtools ? (le handler le lit via `configuration.options.ignoreServiceConfiguration`
   — flag URL `session.configuration.options.ignoreServiceConfiguration`
   probable, à confirmer)

> **P2 : wire-viabilité CONFIRMÉE machine 16 août** — le schéma réel du
> module `StreamSessionConfiguration-n19hnhqy.js` (capturé, 5 Ko — la source
> du `validateClientStreamingConfigOverrides` Zod) vérifie :
> - **liste `v` (client-exclusives)** = `options`, `systemUiHandler`,
>   `touchControlHandler`, `nexusButtonHandler`, `clientDeviceCapabilities`,
>   `pollingConfiguration` — exactement la liste `ie` documentée ;
> - **toutes les clés P2 existent dans le schéma** : `enableVibration`,
>   `useUnreliableInput`, `enableMouseInput`, `enableKeyboardInput`,
>   `enableTouchInput`, `maxTouchPoints` (inputConfiguration) et
>   `enableMicrophone` (audioConfiguration) ;
> - **aucune clé P2 dans la liste client-exclusive** → le filtre `ie` ne les
>   retire pas avant le merge `ae()`.
>
> → **`bench/preview/p2-schema.test.js` (15/15)** : chaque clé injectée par
> `p2-inject.js` est comparée au schéma extrait du bundle réel (rejouable à
> chaque re-capture — si Microsoft ajoute/renomme une clé, le test échoue
> avant de laisser P2 injecter une clé que le Zod `throwErrors:true`
> rejetterait).

> **Point d'injection CHOISI : interception CDP** (`bench/preview/intercept-session.js`,
> livré avec self-test 38/38) — le trafic partant d'un worker, les hooks de
> page sont impuissants ; `Fetch.enable` au niveau navigateur couvre
> page ET worker. P3 = stage Request sur la requête play (réécriture
> `settings.osName` + `x-ms-device-info`) ; P2 = stage Response sur la
> réponse `/configuration` (`Fetch.getResponseBody` → fusion →
> `Fetch.fulfillRequest`). Deux modes : `--connect=PORT` (navigateur existant
> avec remote-debugging) ou launch avec profil persistant dédié.
4. **Événement `qe`** (WarningForBeingIdle) : qui l'écoute, et un keep-alive
   envoyé reset-il bien le compteur serveur ?
5. **`deviceInformation`** — **FORME CONFIRMÉE 16 août** (body play request
   capturé, wire-compatible stable). `osName` est dérivé de
   `playService.deviceInformation` (pas des options) → P3 exige une
   interception réseau CDP ou un hook du module `playServiceAdaptor`/`te`
   (deviceInformation) si le module vit dans la page — la voie « flags URL »
   est exclue (aucune flag osName/resolution dans GameStreamBootstrapper).
   **Le hook du module est lui-même compromis** : la référence `fetch` du SDK
   est capturée au chargement d'entry.client (voir « Paradoxe résolu ») —
   seule l'interception CDP (déjà validée P3 en réel) ou l'injection
   document-start avant entry.client restent viables.
6. **Login/région** : `auth-hooks` + sélection de région du preview
   (l'équivalent `handleLogin`).

## 6. Notes de preuve (offsets dans les bundles)

- `StreamSessionConfiguration-n19hnhqy.js` (5 Ko, entier) : schémas
  audio/input/network/stats/video, factory `b` (export `t`), `x` (export `n`,
  retire `directIpAddress`), `validateClientStreamingConfigOverrides` (export
  `C`/`i`), osName (export `l`/`s`), liste clés client-exclusives (export
  `v`/`r`).
- `StreamSessionRequest-iiux1fqv.js` :
  - import du module config : offset 1032 (`n as re, r as ie, s as E, t as ae`)
  - heartbeat : offset 27509 (`heartBeatSession`, `keepAlivePulseInSeconds`)
  - `sendKeepAlive` : offset 50742 (input virtuel gamepad)
  - `onServerDisconnectMessage` : offset 68298 (`WarningForBeingIdle` → `qe`)
  - merge overrides : offset 80925 (`ae(configuration, overrides)`,
    `ignoreServiceConfiguration`, liste `ie`)
- `GameStreamBootstrapper-f0xgky2u.js` : flags URL — offset 121961
  (`session.configuration.options.*`).
