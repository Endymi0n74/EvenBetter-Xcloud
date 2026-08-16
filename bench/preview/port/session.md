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
> **Le trafic part d'un worker** → les hooks fetch/xhr/ws de la page ne
> voient pas les BODIES : seul le resource timing (URLs) est accessible côté
> page. Pour la forme `deviceInformation` (body du play request), la voie est
> l'onglet **Network de DevTools** (le worker y apparaît) → filtrer `play` →
> onglet Payload/Response.

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
   devtools ?
4. **Événement `qe`** (WarningForBeingIdle) : qui l'écoute, et un keep-alive
   envoyé reset-il bien le compteur serveur ?
5. **`deviceInformation`** — **FORME CONFIRMÉE 16 août** (body play request
   capturé, wire-compatible stable). `osName` est dérivé de
   `playService.deviceInformation` (pas des options) → P3 exige une
   interception réseau CDP ou un hook du module `playServiceAdaptor`/`te`
   (deviceInformation) si le module vit dans la page — la voie « flags URL »
   est exclue (aucune flag osName/resolution dans GameStreamBootstrapper).
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
