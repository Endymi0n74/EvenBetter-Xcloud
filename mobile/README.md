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

## Validation (émulateur, 18 août 2026)

Overlay vérifié en réel dans le WebView de l'APK (émulateur Android 9,
`www.xbox.com/fr-FR/play`) :

- **0 FATAL EXCEPTION**, activity resumed, app vivante.
- Sonde CDP (debug WebView activé, `adb forward` → chrome://inspect) :
  `BX_EXPOSED=object` (script initialisé), `BX_FETCH=function` (hook
  posé), **bouton settings `.bx-header-settings-button` présent ET
  visible** (`settingsBtnVisible:true`).
- Preuves commitées : `validation-apk-overlay.png` (screenshot 1920×1080),
  `validation-apk-probe.json` (sonde CDP), `validation-apk-2026-08-18.txt`
  (état logcat).
- Le debug WebView (`WebView.setWebContentsDebuggingEnabled(true)` dans
  MainActivity) reste activé pour rejouer cette validation à tout moment.

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
