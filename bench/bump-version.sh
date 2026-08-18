#!/usr/bin/env bash
# bump-version.sh — bump CENTRALISÉ de la version EvenBetterXcloud.
#
# « La version est mise à jour à chaque changement » : ce script est la seule
# porte de bump. Il met à jour TOUT ce qui porte la version, en une commande :
#   - VERSION            (source de vérité, racine du repo)
#   - stable             better-xcloud.user.js  (header @version + BX_VERSION + badge)
#   - es2017             better-xcloud.es2017.user.js (régénéré depuis le stable)
#   - preview            better-xcloud-preview.user.js (@version + BX_VERSION)
#   - metas              better-xcloud.meta.js + better-xcloud-preview.meta.js
#   - manifest APK       mobile/AndroidManifest.template.xml (versionName + versionCode)
#
# Usage :
#   bash bench/bump-version.sh 1.9.1
#   bash bench/bump-version.sh 1.9.1 --preview=1.9.1-preview2   # version preview explicite
#   bash bench/bump-version.sh 1.9.1 --build-apk                # + rebuild des deux APK
#
# Le badge du menu affiche alors « EvenBetterXcloud <version> » (BX_VERSION),
# et le @version des userscripts / metas est à jour. Gates : le script échoue
# (exit 1, GATE ROUGE) si un pattern a dérivé dans les bundles.
set -euo pipefail
cd "$(dirname "$0")/.."

NEW="${1:?usage: bash bench/bump-version.sh <1.9.1> [--preview=...] [--build-apk]}"
PREVIEW="${2:-}"
if [[ "$PREVIEW" == --preview=* ]]; then PREVIEW="${PREVIEW#--preview=}"; else PREVIEW=""; fi
[ -z "$PREVIEW" ] && PREVIEW="$NEW-preview1"
BUILD_APK=0
for a in "$@"; do [ "$a" = "--build-apk" ] && BUILD_APK=1; done

echo "== bump EvenBetterXcloud -> $NEW (preview: $PREVIEW) =="
echo "$NEW" > VERSION

node bench/rebrand-bundle.js better-xcloud.user.js --version="$NEW" --bump-only
bun bench/es2017-build.mjs
node bench/rebrand-bundle.js better-xcloud-preview.user.js --version="$PREVIEW" --bump-only
node bench/rebrand-bundle.js better-xcloud.meta.js --version="$NEW" --bump-only
node bench/rebrand-bundle.js better-xcloud-preview.meta.js --version="$PREVIEW" --bump-only

# Manifest APK : versionName + versionCode (incrémenté)
sed -i "s/android:versionName=\"[^\"]*\"/android:versionName=\"$NEW\"/" mobile/AndroidManifest.template.xml
sed -i "s/android:versionCode=\"[0-9]*\"/android:versionCode=\"$(( $(grep -o 'android:versionCode=\"[0-9]*\"' mobile/AndroidManifest.template.xml | grep -o '[0-9]*') + 1 ))\"/" mobile/AndroidManifest.template.xml

echo
echo "== vérifications =="
grep -h "^// @version" better-xcloud.user.js better-xcloud.es2017.user.js better-xcloud-preview.user.js better-xcloud.meta.js better-xcloud-preview.meta.js
grep -h "BX_VERSION = \"" better-xcloud.user.js better-xcloud-preview.user.js
grep -h "versionName\|versionCode" mobile/AndroidManifest.template.xml
echo
echo "OK : version $NEW en place. Rappel : publier la release + rebuild/upload APK (--build-apk) à chaque bump."

if [ "$BUILD_APK" = "1" ]; then
  echo
  export JAVA_HOME="${JAVA_HOME:-/c/Program Files/Zulu/zulu-21}"
  bash mobile/build.sh
  VARIANT=preview bash mobile/build.sh
  echo "OK : APK stable + preview rebuildés (mobile/out/)"
fi
