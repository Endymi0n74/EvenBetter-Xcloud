#!/usr/bin/env bash
# bench/es2017-check.sh — Garde-fou reproductibilité du build ES2017.
#
# Reconstruit les deux bundles ES2017 (stable + preview) dans un dossier
# temporaire via bench/es2017-build.mjs (node, pas bun) et compare aux fichiers
# committés (normalisé CRLF→LF). GATE ROUGE si le build dérive : version
# d'esbuild différente, bundle source modifié sans rebuild, ou régression du
# script de build. Le bump régénère ces fichiers (bump-version.sh) — ce gate
# détecte l'oubli.
#
# Usage : bash bench/es2017-check.sh [--keep-tmp]
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
[ "${1:-}" = "--keep-tmp" ] && { trap - EXIT; echo "tmp gardé : $TMP"; }

node bench/es2017-build.mjs --out "$TMP/stable.es2017.js" > /dev/null
node bench/es2017-build.mjs --src better-xcloud-preview.user.js --out "$TMP/preview.es2017.js" > /dev/null

fails=0
check() { # $1 = label, $2 = committé, $3 = rebuild
  local a b
  a=$(tr -d '\r' < "$2" | sha256sum | cut -c1-16)
  b=$(tr -d '\r' < "$3" | sha256sum | cut -c1-16)
  if [ "$a" = "$b" ]; then echo "  ✅ $1 ($a)"; else echo "  ❌ $1 : committé=$a rebuild=$b" >&2; fails=$((fails + 1)); fi
}
echo "== build ES2017 reproductible =="
check "stable  better-xcloud.es2017.user.js"         better-xcloud.es2017.user.js         "$TMP/stable.es2017.js"
check "preview better-xcloud-preview.es2017.user.js" better-xcloud-preview.es2017.user.js "$TMP/preview.es2017.js"

if [ "$fails" -gt 0 ]; then
  echo "❌ GATE ROUGE : $fails bundle(s) ES2017 non reproductible(s) — rebuild via 'node bench/es2017-build.mjs' (+ variant preview) puis committer" >&2
  exit 1
fi
echo "✅ GATE VERT — builds ES2017 reproductibles"
