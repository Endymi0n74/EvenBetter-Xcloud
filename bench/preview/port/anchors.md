# Ancres React Router 7 du preview — re-dérivation pour les settings

_Issues de l'analyse statique des bundles preview (`/d/tmp/preview-player`,
capture du 16 août — `entry.client-h6o444u3.js`, 51 modules de la route
`stream/:productId`). À valider sur une session authentifiée runtime._

## Rappel : pourquoi les ancres stables ne marchent pas

Le stable (www.xbox.com/play) est la SPA Webpack classique : le Patcher
s'accroche à `chunkName:()=>"home-page"` / `requireAsync(e){` /
`AppInsightsCore.initialize` et aux modules CSS (`Header-module__header`,
`StreamMenu-module__container`, `getIsAnyDialogOpen`/`goBack` pour les dialogs).
Le preview (play.xbox.com) est une **app React Router 7 + rolldown** : aucun de
ces hooks n'existe (vérifié dans `static-matrix.md` — 0 hit sur les 14
signatures critiques).

## Ce que les statics révèlent (ancres candidates)

### 1. Route settings (React Router 7)

```
entry.client : ...({getParentRoute:()=>V_,path:`settings`})), W_=m_(B_,K({getParentRoute:()=>V_,path:`game-stream`})), G_=m_(B_,K({getParentRoute:()=>V_,path:`product-filter`,...
```

- La route `settings` existe, déclarée en **route imbriquée** (React Router 7
  manifest, `getParentRoute`), dans le shell (`entry.client`).
- Structure : `path:"settings"` + tabs (`settings:Object.assign(U_,{tabs:dy.tabsRoute,...})`).

### 2. Système de settings (couche requêtes/mutations)

```
entry.client : env.systems.settings.queries.* / env.systems.settings.mutations.*
  - queries.selectedMicrophoneDeviceIdSetting
  - queries.partyActionNotificationEnabledSetting
  - queries.accountMismatchLastPromptedPairSetting
  - mutations.setPreviousThemeSetting
  - mutations.setAccountMismatchLastPromptedPairSetting
```

- Un **système de settings** propre au preview (`systems.settings`), du type
  React Query : `queries.*` (lecture) / `mutations.*` (écriture), chacun avec
  `getOptions()`.

### 3. Settings de streaming (la zone « vidéo » du preview)

```
streaming.settings.userRequestedResolution.isEnabled
streaming.settings.userRequestedResolution.enableHQResolutions
streaming.settings.userRequestedResolution.autoResolutionAlias.xGPU / .nonXGPU
streaming.settings.userRequestedResolution.bandwidthGBPerHour
```

- Les settings vidéo du preview vivent sous `streaming.settings.*` — des keys
  de type `"nom.clef"` avec schémas Zod (`Qge=X({...})`).
- **C'est ici que vivrait le « codecProfile » du preview** (non capturé : il est
  probablement dans un module runtime non statique ou sous une autre key).

### 4. Le shell / header

```
entry.client : 26× "Shell", 25× "shell", isShell, shellComponent, DialogShellContext
```

- Composant `Shell` du preview — **CSS modules hashés** : les noms de classes
  exacts (`Header-module__header` du stable n'existe pas) ne sont pas
  déchiffrables en statique → **les sélecteurs du bouton settings (T4) sont des
  candidats à affiner sur le DOM réel**.

## Stratégie d'injection (ce que build-preview.js implémente)

| Pièce | Stable (ancre) | Preview (re-dérivation) | État |
|---|---|---|---|
| **Bouton settings** | `injectHeaderUseEffect` → `ui.header.rendered` → `HeaderSection.checkHeader()` (`#gamepass-root header[class^=Header-module__header]`) | `PreviewSettingsEntry` : MutationObserver délégué + sélecteurs candidats (`header[class*='Header']`, `[class*='AppHeader']`, `[class*='shell'] header`, `header`), cible `[class*='right'/'actions'/'nav'/'menu'/'buttons']` | **implémenté (candidats), à valider runtime** |
| **Dialog settings** | dialog du site (`exposeDialogRoutes`, `goBack`, `getIsAnyDialogOpen`) | aucun — `NavigationDialogManager` crée ses propres overlay/container (`bx-navigation-dialog`) | **aucun portage nécessaire** |
| **Détection page** | `PatcherCache.constructor` (pathname `/play*`) | preview : pathnames `/`, `/stream/:productId`, `/settings` — pas de patches site (garde T3) | **implémenté (garde)** |
| **getCapabilities lazy** | patch 21 (settings script) | idem — le preview a SON propre système (`streaming.settings.*`) ; le codecProfile du script reste indépendant | **hérité tel quel** |

## Checklist de validation runtime (session authentifiée)

Lancer `bench/preview/capture.js` dans une session connectée à play.xbox.com
(voir `bench/preview/README.md`), puis :

1. **DOM du header** : capturer `document.querySelectorAll("header")` + classes
   réelles du shell → remplacer les sélecteurs candidats de T4 par les vrais.
2. **Route settings** : naviguer vers les settings du preview, vérifier que la
   route `settings` s'ouvre sans conflit avec le dialog du script
   (le dialog script est indépendant — vérifier que l'overlay ne gêne pas la
   navigation du preview).
3. **Événements guide/dialog** : le stable émet `dialog.shown`/`dialog.dismissed`
   depuis le système du site pour fermer ses dialogs quand le guide s'ouvre
   (`NavigationDialogManager` écoute `BxEvent.XCLOUD_GUIDE_MENU_SHOWN`). Sur le
   preview, cet événement n'existe pas → **le dialog script restera ouvert si le
   menu du preview s'ouvre** — à décider : fermer sur `blur`/`visibilitychange`
   ou brancher sur l'événement de menu du preview.
4. **Stream** : lancer un stream (`/stream/:productId`) et vérifier que
   l'overlay des stats/quick glance du script ne casse pas le rendu Babylon
   (c'est le point d'entrée du portage des patches 13-20, hors app-shell).
5. **Startup** : rejouer le protocole froid (`page-eval --cold`) sur le build
   preview — les bornes (perf10 550-660 ms) ne s'appliquent pas telles quelles
   au preview (app différente) → établir de nouvelles bornes.
