#!/usr/bin/env bash
# bump-version.sh — bump CENTRALISÉ de la version EvenBetterXcloud.
#
# « La version est mise à jour à chaque changement » : ce script est la seule
# porte de bump. Il met à jour TOUT ce qui porte la version, en une commande :
#   - VERSION            (source de vérité stable, racine du repo)
#   - PREVIEW_VERSION    (source de vérité PREVIEW — lue par build-preview.js,
#                         qui a un GATE si le fichier est absent : ne JAMAIS
#                         hardcoder la version preview dans le build)
#   - stable             better-xcloud.user.js  (header @version + BX_VERSION + badge)
#   - es2017             better-xcloud.es2017.user.js (régénéré depuis le stable)
#   - preview            better-xcloud-preview.user.js (@version + BX_VERSION)
#   - metas              better-xcloud.meta.js + better-xcloud-preview.meta.js
#   - manifest APK       mobile/AndroidManifest.template.xml (versionName + versionCode)
#   - passe README       README.md + README.en.md + mobile/README.md (titre,
#                        table Deux versions, tags/liens, APK mobile — les
#                        mentions historiques en prose ne sont pas touchées)
#
# Usage :
#   bash bench/bump-version.sh 1.9.1
#   bash bench/bump-version.sh 1.9.1 --preview=1.9.1-preview2   # version preview explicite
#   bash bench/bump-version.sh 1.9.1 --build-apk                # + rebuild des deux APK
#   bash bench/bump-version.sh 1.9.1 --no-verify                # sans rebuild preview + gate final
#
# CYCLE COMPLET EN UNE COMMANDE : bump → passe README structurelle →
# rebuild preview (build-preview.js re-pinne @updateURL sur le nouveau tag) →
# gate « README toujours à jour » (readme-version.test.js). Le script échoue
# (exit 1, GATE ROUGE) si un README ou un bundle garde l'ancienne version.
set -euo pipefail
cd "$(dirname "$0")/.."

NEW="${1:?usage: bash bench/bump-version.sh <1.9.1> [--preview=...] [--build-apk] [--no-verify]}"
PREVIEW="${2:-}"
if [[ "$PREVIEW" == --preview=* ]]; then PREVIEW="${PREVIEW#--preview=}"; else PREVIEW=""; fi
[ -z "$PREVIEW" ] && PREVIEW="$NEW-preview1"
BUILD_APK=0
NO_VERIFY=0
for a in "$@"; do
  [ "$a" = "--build-apk" ] && BUILD_APK=1
  [ "$a" = "--no-verify" ] && NO_VERIFY=1
done

# Anciennes versions capturées AVANT l'écriture (servent à la passe README :
# on remplace OLD → NEW, jamais les mentions historiques en prose).
OLD_VERSION="$(cat VERSION 2>/dev/null || true)"
OLD_PREVIEW="$(cat PREVIEW_VERSION 2>/dev/null || true)"

echo "== bump EvenBetterXcloud -> $NEW (preview: $PREVIEW) =="
echo "$NEW" > VERSION
echo "$PREVIEW" > PREVIEW_VERSION

node bench/rebrand-bundle.js better-xcloud.user.js --version="$NEW" --bump-only
bun bench/es2017-build.mjs
# Le preview a aussi sa transpilation ES2017 (vieux WebView Android TV /
# Freebox Pop) : générée au bump comme le stable, embarquée par build.sh
# (VARIANT=preview). IMPORTANT : rebrand du preview AVANT sa transpilation
# (sinon l'es2017 garderait l'ancienne version preview).
node bench/rebrand-bundle.js better-xcloud-preview.user.js --version="$PREVIEW" --bump-only
bun bench/es2017-build.mjs --src better-xcloud-preview.user.js --out better-xcloud-preview.es2017.user.js
node bench/rebrand-bundle.js better-xcloud.meta.js --version="$NEW" --bump-only
node bench/rebrand-bundle.js better-xcloud-preview.meta.js --version="$PREVIEW" --bump-only

# Manifest APK : versionName + versionCode (incrémenté)
sed -i "s/android:versionName=\"[^\"]*\"/android:versionName=\"$NEW\"/" mobile/AndroidManifest.template.xml
sed -i "s/android:versionCode=\"[0-9]*\"/android:versionCode=\"$(( $(grep -o 'android:versionCode=\"[0-9]*\"' mobile/AndroidManifest.template.xml | grep -o '[0-9]*') + 1 ))\"/" mobile/AndroidManifest.template.xml

# Passe README structurelle : remplace OLD → NEW sur les patterns structurés
# uniquement (titre, tags evenbetter-xcloud-v*, APK versionnés, ligne Version
# de la table, revendication « v<OLD> » de mobile/README.md). Les mentions
# historiques en prose (« Nouveauté v1.13.1 ») ne sont PAS touchées — c'est
# ce que le gate readme-version (CI) exige.
if [ -n "$OLD_VERSION" ] && [ -n "$OLD_PREVIEW" ]; then
  esc() { printf '%s' "$1" | sed 's/\./\\\./g'; }
  E_OLDV="$(esc "$OLD_VERSION")"; E_NEWV="$(esc "$NEW")"
  E_OLDP="$(esc "$OLD_PREVIEW")"; E_NEWP="$(esc "$PREVIEW")"
  for f in README.md README.en.md mobile/README.md; do
    [ -f "$f" ] || continue
    sed -i \
      -e "s/evenbetter-xcloud-v$E_OLDP/evenbetter-xcloud-v$E_NEWP/g" \
      -e "s/evenbetter-xcloud-v$E_OLDV/evenbetter-xcloud-v$E_NEWV/g" \
      -e "s/evenbetter-xcloud-$E_OLDP\.apk/evenbetter-xcloud-$E_NEWP.apk/g" \
      -e "s/evenbetter-xcloud-$E_OLDV\.apk/evenbetter-xcloud-$E_NEWV.apk/g" \
      -e "s/# EvenBetterXcloud — v$E_OLDV/# EvenBetterXcloud — v$E_NEWV/" \
      -e "s/| Version | \`$E_OLDV\` | \`$E_OLDP\` (prerelease) |/| Version | \`$E_NEWV\` | \`$E_NEWP\` (prerelease) |/" \
      "$f"
  done
  # mobile/README.md : revendication courante « v<OLD> » (stable) en prose
  sed -i "s/v$E_OLDV/v$E_NEWV/g" mobile/README.md
  echo "passe README : OLD_VERSION=$OLD_VERSION → $NEW · OLD_PREVIEW=$OLD_PREVIEW → $PREVIEW"
else
  echo "WARN : anciennes versions illisibles — passe README ignorée (aucun remplacement)" >&2
fi

echo
echo "== vérifications =="
echo "VERSION=$(cat VERSION) · PREVIEW_VERSION=$(cat PREVIEW_VERSION)"
grep -h "^// @version" better-xcloud.user.js better-xcloud.es2017.user.js better-xcloud-preview.user.js better-xcloud.meta.js better-xcloud-preview.meta.js
grep -h "BX_VERSION = \"" better-xcloud.user.js better-xcloud-preview.user.js
grep -h "versionName\|versionCode" mobile/AndroidManifest.template.xml
grep -h "^# EvenBetterXcloud — v" README.md README.en.md
grep -h "^| Version |" README.md README.en.md
echo
echo "OK : version $NEW en place (bump + passe README)."

# Cycle complet : rebuild preview (re-pin @updateURL sur le nouveau tag) puis
# gate final — sans rebuild, le pin preview resterait sur l'ancien tag (404
# auto-update après rétention) et le gate sortirait ROUGE.
if [ "$NO_VERIFY" = "1" ]; then
  echo "[--no-verify] rebuild preview + gate final ignorés — penser à lancer build-preview.js + readme-version.test.js manuellement"
else
  echo
  echo "== rebuild preview (re-pin @updateURL) =="
  node bench/preview/port/build-preview.js
  echo
  echo "== gate « README toujours à jour » =="
  node bench/readme-version.test.js
  echo
  echo "OK : cycle bump → rebuild → README → gate VERT."
fi

if [ "$BUILD_APK" = "1" ]; then
  echo
  export JAVA_HOME="${JAVA_HOME:-/c/Program Files/Zulu/zulu-21}"
  bash mobile/build.sh
  VARIANT=preview bash mobile/build.sh
  echo "OK : APK stable + preview rebuildés (mobile/out/)"
fi
