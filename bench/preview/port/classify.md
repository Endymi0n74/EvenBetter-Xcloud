# Classification des patches app-shell (01-12, 21) — portage preview

_Méthode : pour chaque patch, recherche des ancres site (chunkName, requireAsync,
requireSync, pathname, location.href, Header-module, `__PRELOADED_STATE__`,
gamepass-root, goBack, getIsAnyDialogOpen, dialogRoutes, launch/,
StreamMenu-module) dans le corps du patch. Aucun hit → le patch ne touche que le
code du script → il porte tel quel sur le preview._

**Verdict global : les 13 patches app-shell sont script-internes. Ils sont déjà
dans le build v1.7.0 (`better-xcloud.user.js`) et le build preview
(`better-xcloud-preview.user.js`) les hérite sans modification.**

| Patch | Zone | Anchres site ? | Portage |
|---|---|---|---|
| `01-version-header` | en-tête userscript + commentaire | ✗ | **direct** (bump fait par l'overlay T1) |
| `02-allprefs-set` | `ALL_PREFS` → `Set` (lookups O(1)) | ✗ | **direct** — storage script |
| `03-settings-validatevalue-filter` | `validateValue` : `filter` + `Set` | ✗ | **direct** — storage script |
| `04-settings-deletesettings-batch` | `deleteSettings` batch + mono-`saveSettings` | ✗ | **direct** — storage script |
| `05-checkforupdate-throttle` | garde 2 h avant le fetch GitHub | ✗ | **direct** — logique script |
| `06-bxselect-delegated-observer` | un seul `MutationObserver` délégué pour bx-select | ✗ | **direct** — UI kit script (les sélecteurs bx-* sont les siens) |
| `07-streamstats-opacity-cache-fix` | fix cache opacity/textSize | ✗ | **direct** — StreamStats script |
| `08-streamstats-hidden-throttle` | throttle `document.hidden` 60 s | ✗ | **direct** — StreamStats script |
| `09-collect-single-pass` | `collect()` un seul parcours du report | ✗ | **direct** — StreamStats script |
| `10-translations-debugger-removed` | `debugger` retiré de `downloadTranslations` | ✗ | **direct** — script |
| `11-controller-custom-share-delete-fix` | fix `delete mapping.Share` | ✗ | **direct** — contrôleur script |
| `12-controller-custom-skip-idle` | skip idle (zéro allocation au repos) | ✗ | **direct** — contrôleur script |
| `21-getcodecprofiles-lazy` | `getCapabilities` paresseux + mémoïsé | ✗ | **direct** — settings/RTC script |

## Pourquoi c'est script-interne (et pas site)

Les 13 patches optimisent **le code propre de Better xCloud** : son storage de
settings (`BaseSettingsStorage`/`StreamSettingsStorage`), son UI kit
(`bx-select`, `createButton`), ses overlays (`StreamStats`), son contrôleur,
et son évaluation RTC (`RTCRtpReceiver.getCapabilities`). Ils ne touchent ni le
chunk loader du site, ni le DOM de xbox.com, ni le système de dialogs du site.

La preuve inverse, par contraste : les patches 13-20 (webgl2) et les ancres du
Patcher (`injectHeaderUseEffect`, `exposeDialogRoutes`, `homePageBeforeLoad`,
`patchBeforePageLoad` avec `chunkName:()=>"...-page"` et `requireAsync(e){`) —
ceux-là sont bien des ancres site (présentes dans `better-xcloud.user.js` mais
absentes des bundles preview, voir `static-matrix.md` et `anchors.md`).

## Ce que le portage app-shell ajoute réellement (l'overlay)

Puisque les patches portent tels quels, le travail restant est l'overlay de
`build-preview.js` :

| Transform | Rôle | Pourquoi |
|---|---|---|
| T1 header | `@match https://play.xbox.com/*` + version `1.7.0-preview1` | le script doit tourner sur le domaine preview |
| T2 détection | `var BX_PREVIEW` (hostname) | point de branche runtime |
| T3 garde Patcher | `Patcher.init()` et `checkChunks` no-op sur preview | **éviter un match accidentel** des patches site (chunkName/requireAsync) sur le code rolldown du preview — les ancres n'existent pas, un patch « générique » pourrait corrompre un chunk |
| T4 entrée settings | `PreviewSettingsEntry` : injection du bouton `HeaderSection` dans le shell preview (MutationObserver délégué, sélecteurs candidats) | le stable injecte le bouton via le hook React du header (`injectHeaderUseEffect` → `ui.header.rendered`) — ancre absente du preview |

Le dialog de settings (`SettingsDialog`/`NavigationDialogManager`) est autonome
(ses propres overlay/container) → aucune re-dérivation nécessaire de ce côté.
