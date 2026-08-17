# APK Android — Better xCloud Perf

Wrapper WebView minimal qui charge **https://www.xbox.com/play** et injecte le
build **stable** (`better-xcloud.user.js`, v1.8.0) dès le début de la page.

> Le wrapper upstream (`redphx/better-xcloud-android`) est **closed-source**
> jusqu'à sa v1.0 — ceci est notre propre wrapper, buildable depuis ce dossier.

## APK

`better-xcloud-perf-1.8.0.apk` (~140 Ko) — package `com.bxperf.app`, signé avec
le keystore local (`bxperf.keystore`, généré par `build.sh`).

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
cp ../better-xcloud.user.js assets/
export JAVA_HOME="C:\Program Files\Zulu\zulu-21"
bash build.sh
# → out/better-xcloud-perf-1.8.0.apk
```

Pipeline sans Gradle : `aapt2 compile/link` → `javac` → `d8` → assemblage
(`jar` du JDK, pas de `zip` en Git Bash) → `zipalign` → `apksigner`.

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

`bxperf.keystore` (généré au premier build, mot de passe `bxperf-keystore`).
**Le garder précieusement** : le re-signer change l'empreinte, l'APK ne se
mettra plus à jour par-dessus l'ancien (désinstallation requise).
