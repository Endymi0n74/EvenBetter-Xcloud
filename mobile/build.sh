#!/usr/bin/env bash
# Build the Better xCloud Perf Android APK without Gradle.
# Requires: JDK (JAVA_HOME), Android SDK at /d/android-sdk, our stable build copied to assets/.
set -euo pipefail

SDK=/d/android-sdk
BT="$SDK/build-tools/34.0.0"
PLATFORM="$SDK/platforms/android-34/android.jar"
JAVA="$JAVA_HOME/bin"
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/out"
STORE_PASS="bxperf-keystore"
ORIG_KEYSTORE="/d/Codex/bx-apk/bxperf.keystore"

# Version : source de vérité = VERSION (racine du repo), bumpée par
# bench/bump-version.sh — les noms d'APK suivent (rebrand 18 août :
# EvenBetterXcloud, tag evenbetter-xcloud-v*).
VERSION=$(cat "$ROOT/../VERSION")

# VARIANT (env) : stable (défaut, www.xbox.com/play + better-xcloud.user.js)
# ou preview (play.xbox.com + better-xcloud-preview.user.js + package
# com.bxperf.preview — les deux APK s'installent côte à côte).
VARIANT="${VARIANT:-stable}"
if [ "$VARIANT" = "preview" ]; then
  START_URL="https://play.xbox.com"
  BUNDLE_SRC_DEFAULT="$ROOT/../better-xcloud-preview.user.js"
  PACKAGE="com.bxperf.preview"
  APP_LABEL="EvenBetterXcloud Preview"
  APK_NAME="evenbetter-xcloud-${VERSION}-preview1.apk"
else
  START_URL="https://www.xbox.com/play"
  BUNDLE_SRC_DEFAULT="$ROOT/../better-xcloud.user.js"
  PACKAGE="com.bxperf.app"
  APP_LABEL="EvenBetterXcloud"
  APK_NAME="evenbetter-xcloud-${VERSION}.apk"
fi

# Asset : le build à jour (la racine du repo), jamais une copie périmée.
# BUNDLE_SRC (env) : bundle alternatif à embarquer (ex. better-xcloud.es2017.user.js
# pour un APK de test compatible vieux WebView). Défaut : stable ou preview selon VARIANT.
mkdir -p "$ROOT/assets"
BUNDLE_SRC="${BUNDLE_SRC:-$BUNDLE_SRC_DEFAULT}"
cp "$BUNDLE_SRC" "$ROOT/assets/better-xcloud.user.js"
echo "    asset : $(wc -c < "$ROOT/assets/better-xcloud.user.js") o ($(basename "$BUNDLE_SRC"))"
echo "    variant: $VARIANT | START_URL=$START_URL | package=$PACKAGE | apk=$APK_NAME"

# Keystore : réutiliser la clé d'origine (D:\Codex\bx-apk) pour que les
# mises à jour d'un APK déjà installé restent valides. Générer une nouvelle
# clé changerait la signature et forcerait une désinstallation/réinstallation.
if [ ! -f "$ROOT/bxperf.keystore" ]; then
  if [ -f "$ORIG_KEYSTORE" ]; then
    cp "$ORIG_KEYSTORE" "$ROOT/bxperf.keystore"
    echo "    keystore réutilisé depuis $ORIG_KEYSTORE (signature stable)"
  else
    echo "    ⚠ aucun keystore trouvé ($ROOT/bxperf.keystore ni $ORIG_KEYSTORE) — nouvelle clé générée"
  fi
fi

# L'icône est régénérée pour chaque variant (sinon cache du même fichier).
echo "==> 1/7 icône"
node "$ROOT/gen-icon.js"

echo "==> 2/7 aapt2 compile + link"
rm -rf "$OUT" "$ROOT/gen"
mkdir -p "$OUT" "$ROOT/gen"

# START_URL/package/label sont injectés dans le manifest au moment du link :
# on régénère un manifest avec la bonne valeur (le .xml source garde stable).
MANIFEST="$OUT/AndroidManifest.xml"
sed -e "s|@START_URL@|$START_URL|" -e "s|@PACKAGE@|$PACKAGE|" -e "s|@APP_LABEL@|$APP_LABEL|" "$ROOT/AndroidManifest.template.xml" > "$MANIFEST"

# MainActivity lit START_URL depuis une constante statique : on génère une
# petite classe de config à la compilation (mêmes règles que R.java).
mkdir -p "$OUT/gen-src/com/bxperf/app"
cat > "$OUT/gen-src/com/bxperf/app/BuildConfig.java" <<EOF
package com.bxperf.app;
public final class BuildConfig {
    public static final String START_URL = "$START_URL";
}
EOF

"$BT/aapt2.exe" compile --dir "$ROOT/res" -o "$OUT/res.zip"
"$BT/aapt2.exe" link -o "$OUT/base.apk" \
    -I "$PLATFORM" \
    --manifest "$MANIFEST" \
    --java "$ROOT/gen" \
    --auto-add-overlay \
    "$OUT/res.zip"

echo "==> 3/7 javac"
mkdir -p "$OUT/classes"
# R.java est généré par aapt2 dans le dossier du PACKAGE du manifest :
# com/bxperf/app (stable) OU com/bxperf/preview (preview) — on le cherche
# dynamiquement au lieu d'un chemin en dur (sinon javac: file not found).
R_JAVA=$(find "$ROOT/gen" -name R.java | head -1)
if [ -z "$R_JAVA" ]; then
  echo "❌ GATE R.java : aapt2 n'a pas généré R.java dans $ROOT/gen" >&2
  exit 1
fi
"$JAVA/javac.exe" -source 8 -target 8 -nowarn \
    -bootclasspath "$PLATFORM" \
    -d "$OUT/classes" \
    "$R_JAVA" \
    "$OUT/gen-src/com/bxperf/app/BuildConfig.java" \
    "$ROOT/src/com/bxperf/app/MainActivity.java"

echo "==> 4/7 d8 (dex)"
mkdir -p "$OUT/dex"
# ⚠ TOUTES les classes (le glob), pas seulement MainActivity/R : les classes
# anonymes MainActivity$1/$2 (WebViewClient/WebChromeClient) sont des .class
# séparés — si on ne les passe pas à d8, elles manquent au dex et l'app
# crashe au lancement (NoClassDefFoundError MainActivity$1, reproduit 18 août).
# R.class est dans le dossier du package du manifest (app ou preview) : on
# passe TOUS les .class (find), pas un glob en dur (sinon le dex du variant
# preview sort sans R.class → crash au lancement).
CLASSES=$(find "$OUT/classes" -name '*.class')
"$BT/d8.bat" --release --lib "$PLATFORM" --output "$OUT/dex" \
    $CLASSES

echo "==> 5/7 assemblage (dex + assets) — zip indisponible en Git Bash, jar du JDK"
cp "$OUT/base.apk" "$OUT/app-unsigned.apk"
"$JAVA/jar.exe" uf "$OUT/app-unsigned.apk" -C "$OUT/dex" classes.dex
"$JAVA/jar.exe" uf "$OUT/app-unsigned.apk" -C "$ROOT" assets

# Auto-vérification du dex : TOUTES les classes attendues doivent être
# présentes (le 18 août, les classes anonymes manquaient au dex et l'app
# crasheait au lancement — NoClassDefFoundError MainActivity\$1).
# R.class suit le package du manifest (com/bxperf/app ou com/bxperf/preview).
R_DESC="L${PACKAGE//./\/}/R;"
EXPECTED="Lcom/bxperf/app/MainActivity; Lcom/bxperf/app/MainActivity\$BxWebViewClient; Lcom/bxperf/app/MainActivity\$BxWebChromeClient; $R_DESC"
DEX_CLASSES=$("$BT/dexdump.exe" "$OUT/dex/classes.dex" 2>/dev/null | grep 'Class descriptor' | sed 's/.*: //')
for c in $EXPECTED; do
  if ! echo "$DEX_CLASSES" | grep -q "$c"; then
    echo "❌ GATE DEX : classe manquante dans classes.dex : $c" >&2
    exit 1
  fi
done
echo "    dex vérifié : $(echo "$DEX_CLASSES" | wc -l) classes, toutes présentes"

echo "==> 6/7 zipalign"
"$BT/zipalign.exe" -f 4 "$OUT/app-unsigned.apk" "$OUT/app-aligned.apk"

echo "==> 7/7 signature"
if [ ! -f "$ROOT/bxperf.keystore" ]; then
  "$JAVA/keytool.exe" -genkeypair -keystore "$ROOT/bxperf.keystore" \
    -alias bxperf -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$STORE_PASS" -keypass "$STORE_PASS" \
    -dname "CN=Better xCloud Perf, O=BXPerf, C=FR"
fi
"$BT/apksigner.bat" sign --ks "$ROOT/bxperf.keystore" \
    --ks-key-alias bxperf --ks-pass "pass:$STORE_PASS" --key-pass "pass:$STORE_PASS" \
    --out "$OUT/$APK_NAME" "$OUT/app-aligned.apk"

echo "==> vérifications"
"$BT/apksigner.bat" verify --print-certs "$OUT/$APK_NAME" | head -3
"$BT/aapt.exe" dump badging "$OUT/$APK_NAME" | head -6
ls -la "$OUT/$APK_NAME"
echo "OK: $OUT/$APK_NAME (variant=$VARIANT)"
