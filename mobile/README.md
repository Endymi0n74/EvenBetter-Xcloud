# APK Android — Better xCloud Perf

Wrapper WebView minimal qui charge **https://www.xbox.com/play** et injecte le
build **stable** (`better-xcloud.user.js`, v1.8.0) dès le début de la page.

> Le wrapper upstream (`redphx/better-xcloud-android`) est **closed-source**
> jusqu'à sa v1.0 — ceci est notre propre wrapper, buildable depuis ce dossier.

## APK

`better-xcloud-perf-1.8.0.apk` (~140 Ko) — package `com.bxperf.app`, signé avec
le keystore local (`bxperf.keystore`, réutilisé depuis `D:\Codex\bx-apk` par
`build.sh` — la signature est stable d'un build à l'autre, les mises à jour
passent par-dessus l'APK installé).

**Téléchargement direct** (asset de la release v1.8.0) :

https://github.com/Endymi0n74/better-xcloud-perf/releases/download/better-xcloud-perf-v1.8.0/better-xcloud-perf-1.8.0.apk

**Installation (sideload)** :

1. Copier l'APK sur le téléphone (USB / Drive / téléchargement).
2. Autoriser « Installer des applications inconnues » pour le source
   (Explorateur de fichiers / navigateur).
3. Ouvrir l'APK → Installer.
4. Lancer « Better xCloud Perf » → connexion Xbox → jouer.

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
# → out/better-xcloud-perf-1.8.0.apk
```

`build.sh` prépare tout seul l'asset : il copie le **build stable courant** de
la racine du repo (`../better-xcloud.user.js`) vers `assets/` et réutilise le
keystore d'origine s'il existe (`D:\Codex\bx-apk\bxperf.keystore`) — une
nouvelle clé ne serait générée que si aucun keystore n'est trouvé.

Pipeline sans Gradle : `aapt2 compile/link` → `javac` → `d8` → assemblage
(`jar` du JDK, pas de `zip` en Git Bash) → `zipalign` → `apksigner`.

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
- Logs de diagnostic tagués `BXPerf` (logcat) sur chaque étape du cycle
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
  logs `BXPerf` : `showErrorPage → scheduleAutoRetry → AutoRetry.run →
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
(`better-xcloud-perf-1.8.0-test.apk`, bundle **ES2017** re-minifié embarqué) :

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

`bxperf.keystore` (copié depuis `D:\Codex\bx-apk\bxperf.keystore` au premier
build dans ce dossier, mot de passe `bxperf-keystore`). **Le garder
précieusement** : le re-signer change l'empreinte, l'APK ne se mettra plus à
jour par-dessus l'ancien (désinstallation requise). `assets/`, `out/`,
`gen/` et `bxperf.keystore` sont gitignorés — l'APK signé lui-même est le
fichier suivi (`mobile/better-xcloud-perf-1.8.0.apk`).
