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

### P1 — Keep-alive idle (ancre identique, quasi gratuit)

Le stable : `remotePlayKeepAlive` patche `onServerDisconnectMessage(e){` pour
intercepter `WarningForBeingIdle` et appeler `this.sendKeepAlive()`.
Le preview a **le même nom de méthode** sur sa classe de session
(offset 68298) et une méthode `sendKeepAlive()` (input virtuel, offset 50742).

Deux options :
- **Patch de chaîne** (même approche que le stable) : dans le corps de
  `onServerDisconnectMessage`, remplacer le `dispatchEvent(new qe(...))` du cas
  `WarningForBeingIdle` par un appel à `this.sendKeepAlive()`.
- **Événement** (plus propre, pas de patch) : l'événement `qe`
  (`WarningForBeingIdle`, porte `secondsUntilKick`) est dispatché sur
  l'EventTarget de la session — y écouter et envoyer le keep-alive via
  l'input virtuel. À valider : qui écoute `qe` (UI countdown) et si le
  keep-alive reset le compteur.

Risque : faible. Ancre de chaîne identique au stable, `sendKeepAlive` existe.

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

### P3 — Play request (résolution, locale)

Le stable réécrit le payload `/sessions/cloud/play` ; sur le preview, piloter
`deviceInformation`/`clientDeviceCapabilities` (osName) avant le play.
À confirmer runtime : le endpoint exact de provisioning du preview (le
`StreamSessionRequest` construit les URLs depuis `serviceSettings`, pas en
dur) et la forme de `deviceInformation` (le champ `osName: E(t)` s'en déduit).

Risque : le plus élevé — dépend du runtime (endpoint, forme du device-info).

## 5. Ce qui reste à valider en session runtime

1. **Endpoint de provisioning** du preview (équivalent `/sessions/cloud/play`
   et `/configuration`) — pour l'interception fetch si les hooks internes ne
   suffisent pas.
2. **Mécanisme flags URL réel** : `setGateValue`/`session.configuration.*` —
   s'applique-t-il avant la construction de `StreamSessionRequest` ?
3. **`ignoreServiceConfiguration`** : accessible en flag public ou réservé
   devtools ?
4. **Événement `qe`** (WarningForBeingIdle) : qui l'écoute, et un keep-alive
   envoyé reset-il bien le compteur serveur ?
5. **`deviceInformation`** : sa forme exacte et le calcul d'`osName` — pour le
   portage résolution.
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
