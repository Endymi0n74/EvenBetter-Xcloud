# Portage app-shell du preview (play.xbox.com)

État : **v1 — infrastructure + détection + garde + entrée settings (candidats)**.
La branche de travail porte le build `better-xcloud-preview.user.js` (v1.7.0-preview1).

## Le constat de départ

Le preview n'est pas le stable : React Router 7 + rolldown (pas de
`chunkName`/`requireAsync`/`AppInsightsCore`), renderer Babylon.js (`thinEngine`,
pas de `WebGL2Player`/shader CAS), coquille SSR. Le seul point de partage est le
protocole de session (`StreamSessionConfiguration`, `adapter_core` RTC, WebCodecs).

→ Les **13 patches app-shell (01-12, 21) sont script-internes** (preuve dans
`classify.md`) : ils portent tels quels. Le portage se réduit à un **overlay**
qui rend le build v1.7.0 sûr et utilisable sur play.xbox.com.

## Ce qui est livré

| Fichier | Rôle |
|---|---|
| `build-preview.js` | build reproductible : `better-xcloud.user.js` → `better-xcloud-preview.user.js` (overlay T1-T4, CRLF pur, `node --check` + probes intégrés) |
| `classify.md` | classification des 13 patches (script-interne vs site-hook) avec preuves |
| `anchors.md` | ancres React Router 7 issues des statics (route `settings`, `systems.settings`, `streaming.settings.*`) + stratégie + checklist runtime |
| `session.md` | étude de la couche protocole de session (la surface partagée) : `clientStreamingConfigOverrides` wire-compatible 9/9, keep-alive `onServerDisconnectMessage` ancre identique, flags URL `session.configuration.*`, plan de portage P1-P3 |
| `keepalive-idle.js` + `.test.js` | **P1 implémenté** : interception du `WarningForBeingIdle` (transform source du bundle + runtime userscript : hook fetch du module + `wrapSession`) — 14/14 tests, embarqué par le build (T5) |

## L'overlay (T1-T4)

1. **T1 — header** : `@match https://play.xbox.com/*`, version `1.7.0-preview1`.
2. **T2 — détection** : `var BX_PREVIEW` (hostname `play.xbox.com`).
3. **T3 — garde du Patcher site** : `Patcher.init()` et `checkChunks` no-op sur
   preview → aucun patch site (chunkName/requireAsync) ne risque de matcher
   accidentellement le code rolldown.
4. **T4 — entrée settings** : `PreviewSettingsEntry` injecte le bouton
   `HeaderSection` (dialog 100 % autonome) dans le shell preview via
   MutationObserver délégué. **Sélecteurs candidats** — à affiner sur le DOM
   réel (CSS modules hashés, voir `anchors.md`).

## Usage

```bash
# build du preview userscript (à la racine du repo)
node bench/preview/port/build-preview.js
```

Le résultat `better-xcloud-preview.user.js` se charge dans Tampermonkey avec le
build stable (les deux matchent des domaines différents — pas de conflit).

## Ce qui reste (validation runtime — session authentifiée)

1. **Sélecteurs du header** : remplacer les candidats T4 par les classes réelles
   (capture DOM via `bench/preview/capture.js`).
2. **Fermeture du dialog** : le preview n'émet pas `dialog.shown`/`XCLOUD_GUIDE_MENU_SHOWN`
   → décider la fermeture sur `blur`/`visibilitychange` ou l'événement menu du preview.
3. **Startup** : établir les bornes du preview (les bornes stables ne
   s'appliquent pas — app différente).
4. **Stream** : vérifier que les overlays stats ne cassent pas le rendu Babylon
   (porte d'entrée des patches 13-20, hors périmètre app-shell).

## Non couvert par ce portage (volontairement)

- Patches 13-20 (webgl2) : le preview rend en Babylon.js → re-dériver les hooks
  Babylon (video texture, uniform cache, draw call) est un chantier de mesure
  séparé, qui commence par une capture runtime (`capture.js`, mesure du draw).
- Le système de settings natif du preview (`streaming.settings.*`) : le script
  garde son propre settings (storage `BetterXcloud.Stream`, codecProfile lazy) —
  l'intégration dans la route `settings` du preview est une option future.
