# APK Android — EvenBetterXcloud

Wrapper WebView minimal qui charge **https://www.xbox.com/play** et injecte le
build **stable** (`better-xcloud.user.js`, v1.13.3) dès le début de la page.

> Le wrapper upstream (`redphx/better-xcloud-android`) est **closed-source**
> jusqu'à sa v1.0 — ceci est notre propre wrapper, buildable depuis ce dossier.

## APK

`evenbetter-xcloud-1.13.3.apk` (~1,1 Mo) — package `com.bxperf.app`, signé avec
le keystore local (`bxperf.keystore`, réutilisé depuis `D:\Codex\EvenBetterXcloud\bx-apk` par
`build.sh` — la signature est stable d'un build à l'autre, les mises à jour
passent par-dessus l'APK installé).

**Téléchargement direct** (lien stable `evenbetter-xcloud.apk` — toujours le
dernier build, re-uploadé sous ce nom à chaque release) :

https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest/download/evenbetter-xcloud.apk

**Installation (sideload)** :

1. Copier l'APK sur le téléphone (USB / Drive / téléchargement).
2. Autoriser « Installer des applications inconnues » pour le source
   (Explorateur de fichiers / navigateur).
3. Ouvrir l'APK → Installer.
4. Lancer « EvenBetterXcloud » → connexion Xbox → jouer.

## Fonctionnement

- `WebView` (Chrome/Chromium) avec JS, DOM storage et média sans geste activés.
- Le userscript est injecté via `evaluateJavascript()` dans
  `onPageStarted()` sur toute page `xbox.com` — équivalent document-start pour
  un script `@grant none` (aucune API `GM_*` dans le build, vérifié).
- Le script s'auto-neutralise sur les pages non-play (garde interne).
- Écran maintenu allumé, fullscreen vidéo du player géré
  (`onShowCustomView`), back = navigation arrière.

## Build depuis la source (Windows, sans Android Studio ni Gradle)

Prérequis : JDK 21 (JAVA_HOME) + Android SDK
(`cmdline-tools` → `platforms;android-34` + `build-tools;34.0.0`).

```bash
export JAVA_HOME="C:\Program Files\Zulu\zulu-21"
bash build.sh
# → out/evenbetter-xcloud-1.13.3.apk
```

`build.sh` prépare tout seul l'asset : il copie le **build stable courant** de
la racine du repo (`../better-xcloud.user.js`) vers `assets/` et réutilise le
keystore d'origine s'il existe (`D:\Codex\EvenBetterXcloud\bx-apk\bxperf.keystore`) — une
nouvelle clé ne serait générée que si aucun keystore n'est trouvé.

Pipeline sans Gradle : `aapt2 compile/link` → `javac` → `d8` → assemblage
(`jar` du JDK, pas de `zip` en Git Bash) → `zipalign` → `apksigner`.

## Deux variants (stable / preview, 18 août)

`build.sh` build **deux APK distincts, installables côte à côte** (même
signature, packages différents) :

| Variant | `VARIANT=stable` (défaut) | `VARIANT=preview` |
|---|---|---|
| START_URL | `https://www.xbox.com/play` | `https://play.xbox.com` |
| Asset embarqué | `better-xcloud.user.js` (stable) | `better-xcloud-preview.user.js` (preview) |
| Package | `com.bxperf.app` | `com.bxperf.preview` |
| Label | « EvenBetterXcloud » | « EvenBetterXcloud Preview » |
| APK | `evenbetter-xcloud-1.13.3.apk` | `evenbetter-xcloud-1.13.3-preview1.apk` |

```bash
bash build.sh                    # stable
VARIANT=preview bash build.sh    # preview → out/evenbetter-xcloud-1.13.3-preview1.apk
```

Mécanique du variant : le START_URL est injecté via une classe `BuildConfig`
générée au build (pas de placeholder manifest), le label/package via le
template `AndroidManifest.template.xml`. Le chemin de `R.java` généré par
aapt2 suit le package du manifest — il est résolu dynamiquement (sinon
`javac: file not found` sur le variant preview), idem pour le glob d8 et la
vérification apksigner. Le dex est auto-vérifié (8 classes attendues, dont
`R` dans le package du variant).

**Validé sur BlueStacks le 18 août** : les deux APK s'installent côte à
côte, le preview ouvre `play.xbox.com` et le script preview s'exécute
(`BX_EXPOSED=object`, `BX_FETCH=function`, bouton overlay présent).

### Rebrand EvenBetterXcloud + nouvelle icône (v1.9.0, 18 août)

- **Label** : « EvenBetterXcloud » (stable) / « EvenBetterXcloud Preview »
  (preview) — l'identité visible porte le nom du repo, plus « Perf ».
- **Icône** : `gen-icon.js` v2 — **nuage + flèche montante verte** sur fond
  dégradé sombre (l'identité « even better »), rendu supersamplé 4× sans
  dépendance. Remplacée dans les deux APK.
- **UA / logs** : `EvenBetterXcloud/1.9.0` (UA), tag logcat `EvenBetterXcloud`.
- **Package** : `com.bxperf.app` / `com.bxperf.preview` **conservés** (la
  signature + le package définissent l'identité d'installation : les changer
  forcerait une désinstallation/réinstallation et perdrait la session
  connectée).
- **Version** : lue depuis `VERSION` (racine) par `build.sh` → noms d'APK
  `evenbetter-xcloud-<v>.apk`. Bump centralisé : `bench/bump-version.sh`.
- **Menu** : badge `EvenBetterXcloud <version>` + groupe « Son » (toggle
  booster + volume) visible même déconnecté — preuve
  `validation-ebx-son-1.9.0.png` (BlueStacks).

## Robustesse (18 août)

- **Erreurs réseau / HTTP / SSL** de la frame principale → **page d'erreur
  lisible** (plus d'écran blanc) : titre + message + bouton « Réessayer ».
- **Retry automatique 3× avec backoff 5 s / 15 s / 30 s**, remis à zéro
  dès qu'une vraie page xbox.com se charge ; un retry en attente est
  annulé si la page revient entre-temps.
- **Liens externes** (hors xbox.com / login.live.com / account.microsoft.com)
  → navigateur système (la session de jeu n'est pas quittée).
- Piège corrigé : `onPageFinished` est appelé aussi pour les navigations
  ÉCHOUÉES (avec l'URL fautive) — l'état d'erreur (`errorPageShowing`)
  garde le retry vivant jusqu'à un vrai succès.
- Logs de diagnostic tagués `EvenBetterXcloud` (logcat) sur chaque étape du cycle
  erreur → retry → succès.

## Validation (émulateur, 18 août 2026)

Overlay vérifié en réel dans le WebView de l'APK (émulateur Android 9,
`www.xbox.com/fr-FR/play`) :

- **0 FATAL EXCEPTION**, activity resumed, app vivante.
- Sonde CDP (debug WebView activé, `adb forward` → chrome://inspect) :
  `BX_EXPOSED=object` (script initialisé), `BX_FETCH=function` (hook
  posé), **bouton settings `.bx-header-settings-button` présent ET
  visible** (`settingsBtnVisible:true`).
- **Cycle panne → récupération validé** : navigation vers un port fermé
  (`www.xbox.com:444`) → page d'erreur affichée (screenshot
  `validation-apk-errorpage.png`) → **retry auto à +5 s → retour sur
  `/fr-FR/play` avec l'overlay** (screenshot `validation-apk-recovered.png`,
  logs `EvenBetterXcloud` : `showErrorPage → scheduleAutoRetry → AutoRetry.run →
  resetLoadState`).
- Preuves commitées : `validation-apk-overlay.png`, `validation-apk-probe.json`,
  `validation-apk-2026-08-18.txt`, `validation-apk-errorpage.png`,
  `validation-apk-recovered.png`.
- Le debug WebView (`WebView.setWebContentsDebuggingEnabled(true)` dans
  MainActivity) reste activé pour rejouer cette validation à tout moment.

**Rejouer cette validation à chaque rebuild — une commande :**

```bash
bash bench/mobile-probe.sh                # build → install → forward → sonde CDP + cycle panne→récup
bash bench/mobile-probe.sh --skip-build   # réutilise l'APK déjà buildé
bash bench/mobile-probe.sh --manual       # récupération par clic « Réessayer » (au lieu du retry auto)
bash bench/mobile-probe.sh --serial 127.0.0.1:5555   # BlueStacks (adb connect requis)
```

Le harnais (détaillé dans `bench/README.md`) vérifie les marqueurs BX +
le bouton settings dans le WebView, puis rejoue le cycle
`www.xbox.com:444` → page d'erreur → retour `/play` avec l'overlay, par le
**retry auto (+5 s)** ou par le **clic sur « Réessayer »** (`--manual`).
Sans émulateur : `node bench/mobile-probe.test.js` (faux endpoint CDP,
5 cas, GATE ROUGE inclus).

**Validé sur BlueStacks le 18 août** (émulateur `127.0.0.1:5555`, Android 9,
profil Samsung SM-G998B) : build → install → sonde → panne → récupération
→ logcat — `MOBILE PROBE OK` sur les **deux voies** (retry auto +5 s et
clic « Réessayer » ; le clic annule le retry auto en attente, pas de double
navigation).

### Validation téléphone réel (18 août soir, APK ES2017)

**Validé par l'utilisateur sur un vrai téléphone** avec l'APK de test
(`evenbetter-xcloud-1.9.0-test.apk`, bundle **ES2017** re-minifié embarqué) :

- **Les jeux se lancent** — le stream xCloud démarre dans le WebView.
- **Le menu settings complet est là** après connexion Xbox dans l'appli
  (le WebView a ses propres cookies, séparés du navigateur).
- **Visual joypad actif** : les jeux nécessitant une manette utilisent le
  touch controller de Better xCloud (comportement natif du script quand un
  device tactile est détecté — pas un ajout du wrapper).

**Piège documenté** : déconnecté, le menu settings est **réduit** (Langue /
Région / Profil UA / Effacer les données) — c'est le comportement upstream
`renderFullSettings = supportedRegion && isSignedIn`, pas un bug. Se
connecter dans l'appli (bouton « CONNEXION » de la page) débloque toutes les
options (résolution, bitrate, MKB, touch…).

## Compatibilité Android TV / Freebox Pop (19 août)

La Freebox Pop (Player TV Free 4K, Android TV 9) a un **AOSP System WebView
~Chromium 61** : il ne supporte ni l'optional chaining (`?.`) ni le nullish
(`??`) du bundle moderne → l'APK moderne plantait en SyntaxError (écran vide
/ « ne fait rien »). La compatibilité box est assurée par 4 mécanismes :

1. **Double bundle embarqué** — `build.sh` embarque le build moderne
   (`better-xcloud.user.js` **et** `better-xcloud-preview.user.js` pour le
   variant preview) **plus** sa transpilation ES2017 (`better-xcloud.es2017.user.js`
   / `better-xcloud-preview.es2017.user.js`, générées par `bun bench/es2017-build.mjs`
   au bump — `bench/bump-version.sh` les régénère automatiquement).
2. **Choix du bundle au runtime par l'UA** — `MainActivity.chooseBundle()` :
   `Chrome/≥80` (ou WebView moderne) → bundle moderne ; `Chrome/<80` ou
   absence de token Chrome (vieux AOSP) → **es2017**. Choix **synchrone** :
   un callback `ValueCallback` asynchrone plante le d8 34.0.0 (classe
   implémentant une interface du `--lib`).
3. **Défauts « box » une fois** — sur Android TV (`UI_MODE_TYPE_TELEVISION`,
   détecté au `onCreate`), avant l'injection du script : preset **Économe**
   (cap 5 Mbps + 720p), animations réduites et pas de fusée au loading,
   posés dans le localStorage du script (`_bxTvDefaults`, idempotent).
4. **Télécommande D-pad → clavier** — sur TV, les touches D-pad
   (UP/DOWN/LEFT/RIGHT/CENTER/ENTER) sont traduites en `Arrow*` / `Enter`
   dispatchés à la page (le client xCloud écoute ces touches ; sans ça, le
   D-pad natif ne fait que le focus HTML). `Enter` clique aussi l'élément
   actif (`BUTTON`/`A`/`INPUT`/`SELECT`).

**Leanback** : catégorie `LEANBACK_LAUNCHER` ajoutée au manifest (sans elle,
 l'app n'apparaît pas dans la rangée du launcher TV), bannière TV
 `tv_banner.png` (320×180, générée depuis le logo par `mobile/gen-tv-banner.js`
 — même décodeur PNG que `gen-icon.js`), et `hardwareAccelerated=true`
 (rendu WebView + fullscreen vidéo).

**Validé (19 août ~14:00)** :
- Les **deux APK** (stable + preview) buildent avec l'es2017 embarqué
  (asset `assets/better-xcloud.es2017.user.js` présent, badging
  `leanback-launchable-activity` OK).
- **Chemin moderne en réel sur BlueStacks** (Android 13, WebView moderne) :
  `bundle choisi: modern`, page `/fr-FR/play` chargée, `mobile-probe.js`
  **SONDE OK** (`BX_EXPOSED=object`, `BX_FETCH=function`, bouton settings
  présent + visible).
- **Logique de fallback UA** vérifiée (4/4) : Chromium 61 → es2017,
  Chrome/120 → modern, AOSP sans token → es2017, UA iOS sans Chrome → es2017.
- Le bundle es2017 ne contient aucun `?.`/`??` hors chaînes littérales
  (les sources de patches dans les template literals sont du texte, jamais
  parsées par le vieux moteur).

À tester en réel sur la box (non disponible ici) : le stream xCloud sur un
vrai AOSP WebView — si un écran noir apparaît, diagnostiquer avec
`adb logcat -s EvenBetterXcloud` pendant le stream.

## Limites connues

- **WebView ≠ navigateur complet** : le client xCloud web s'affiche en plein
  écran, mais certains comportements spécifiques au navigateur (extensions,
  certains gestures) peuvent différer.
- **Gains de perf mesurés = desktop** (GPU WebGL2, startup, hot loops). Sur
  mobile, l'overlay/settings/keep-alive fonctionnent, les chiffres GPU ne
  sont pas transposables.
- L'auto-update userscript (Tampermonkey) n'existe pas ici : le script est
  **embarqué dans l'APK** — une nouvelle release = rebuild de l'APK.
- iOS : pas d'app native possible sans Mac/Xcode (voir README principal).

## Keystore

`bxperf.keystore` (copié depuis `D:\Codex\EvenBetterXcloud\bx-apk\bxperf.keystore` au premier
build dans ce dossier, mot de passe `bxperf-keystore`). **Le garder
précieusement** : le re-signer change l'empreinte, l'APK ne se mettra plus à
jour par-dessus l'ancien (désinstallation requise). `assets/`, `out/`,
`gen/` et `bxperf.keystore` sont gitignorés — l'APK signé lui-même est le
fichier suivi (`mobile/better-xcloud-perf-1.8.0.apk`, reliquat de l'ancien
nommage — les builds récents, gitignorés dans `out/`, ne sont pas commités ;
chaque release re-upload les APK signés comme assets GitHub).

## Crédits & vibe-coding

Ce wrapper Android fait partie du projet **EvenBetterXcloud**, **vibe-codé** :
fork et améliorations co-créés avec l'assistance IA générative **Codebuff**
(agent « Buffy ») sous la direction humaine de **Endymi0n74** — l'APK lui-même
(WebView, injection document-start, écran maintenu, robustesse panne/réseau)
a été écrit et validé en réel par l'agent. Crédit original :
[redphx](https://github.com/redphx) pour Better xCloud (MIT). La signature
« Generated with Codebuff » apparaît dans chaque commit du repo.
