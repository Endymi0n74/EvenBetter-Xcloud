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

# Asset : le build stable à jour (la racine du repo), jamais une copie périmée.
# BUNDLE_SRC (env) : bundle alternatif à embarquer (ex. better-xcloud.es2017.user.js
# pour un APK de test compatible vieux WebView). Défaut : le stable courant.
mkdir -p "$ROOT/assets"
BUNDLE_SRC="${BUNDLE_SRC:-$ROOT/../better-xcloud.user.js}"
cp "$BUNDLE_SRC" "$ROOT/assets/better-xcloud.user.js"
echo "    asset : $(wc -c < "$ROOT/assets/better-xcloud.user.js") o ($(basename "$BUNDLE_SRC"))"

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

echo "==> 1/7 icône"
node "$ROOT/gen-icon.js"

echo "==> 2/7 aapt2 compile + link"
rm -rf "$OUT" "$ROOT/gen"
mkdir -p "$OUT" "$ROOT/gen"
"$BT/aapt2.exe" compile --dir "$ROOT/res" -o "$OUT/res.zip"
"$BT/aapt2.exe" link -o "$OUT/base.apk" \
    -I "$PLATFORM" \
    --manifest "$ROOT/AndroidManifest.xml" \
    --java "$ROOT/gen" \
    --auto-add-overlay \
    "$OUT/res.zip"

echo "==> 3/7 javac"
mkdir -p "$OUT/classes"
"$JAVA/javac.exe" -source 8 -target 8 -nowarn \
    -bootclasspath "$PLATFORM" \
    -d "$OUT/classes" \
    "$ROOT/gen/com/bxperf/app/R.java" \
    "$ROOT/src/com/bxperf/app/MainActivity.java"

echo "==> 4/7 d8 (dex)"
mkdir -p "$OUT/dex"
# ⚠ TOUTES les classes (le glob), pas seulement MainActivity/R : les classes
# anonymes MainActivity$1/$2 (WebViewClient/WebChromeClient) sont des .class
# séparés — si on ne les passe pas à d8, elles manquent au dex et l'app
# crashe au lancement (NoClassDefFoundError MainActivity$1, reproduit 18 août).
"$BT/d8.bat" --release --lib "$PLATFORM" --output "$OUT/dex" \
    "$OUT"/classes/com/bxperf/app/*.class

echo "==> 5/7 assemblage (dex + assets) — zip indisponible en Git Bash, jar du JDK"
cp "$OUT/base.apk" "$OUT/app-unsigned.apk"
"$JAVA/jar.exe" uf "$OUT/app-unsigned.apk" -C "$OUT/dex" classes.dex
"$JAVA/jar.exe" uf "$OUT/app-unsigned.apk" -C "$ROOT" assets

# Auto-vérification du dex : TOUTES les classes attendues doivent être
# présentes (le 18 août, les classes anonymes manquaient au dex et l'app
# crasheait au lancement — NoClassDefFoundError MainActivity\$1).
EXPECTED="Lcom/bxperf/app/MainActivity; Lcom/bxperf/app/MainActivity\$BxWebViewClient; Lcom/bxperf/app/MainActivity\$BxWebChromeClient; Lcom/bxperf/app/R;"
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
    --out "$OUT/better-xcloud-perf-1.8.0.apk" "$OUT/app-aligned.apk"

echo "==> vérifications"
"$BT/apksigner.bat" verify --print-certs "$OUT/better-xcloud-perf-1.8.0.apk" | head -3
"$BT/aapt.exe" dump badging "$OUT/better-xcloud-perf-1.8.0.apk" | head -6
ls -la "$OUT/better-xcloud-perf-1.8.0.apk"
echo "OK: $OUT/better-xcloud-perf-1.8.0.apk"
