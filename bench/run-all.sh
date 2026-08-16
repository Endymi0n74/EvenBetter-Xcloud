#!/bin/bash
# Lance tous les harnais CPU de benchmark : perf10 (baseline 055d3a0) vs build courant.
#
# Préparation des builds : la baseline est extraite du git du repo (commit 055d3a0),
# le build courant est better-xcloud.user.js à la racine.
#
# Prérequis page-eval + startup-profile : Playwright + Edge (canal msedge). Sans
# Playwright local, installer avec `npm i -D playwright`, ou pointer NODE_PATH
# vers un install existant (ex. export NODE_PATH=/d/Codex/koharu/node_modules).
#
# Usage : ./bench/run-all.sh [--skip-page-eval] [--skip-startup-profile]
set -e
cd "$(dirname "$0")/.."

SKIP_PAGE_EVAL=0
SKIP_STARTUP_PROFILE=0
for a in "$@"; do
  [ "$a" = "--skip-page-eval" ] && SKIP_PAGE_EVAL=1
  [ "$a" = "--skip-startup-profile" ] && SKIP_STARTUP_PROFILE=1
done

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "== Préparation des builds =="
git show 055d3a0:better-xcloud.user.js > "$TMP/perf10.js"
cp better-xcloud.user.js "$TMP/build.js"
node --check "$TMP/perf10.js"
node --check "$TMP/build.js"
echo "  perf10 : $(wc -c < "$TMP/perf10.js") o | build : $(wc -c < "$TMP/build.js") o (syntaxe OK)"

echo
echo "== 1/4 Parse/compile (Node) =="
node --expose-gc bench/parse.js "$TMP/perf10.js" "$TMP/build.js"

echo
echo "== 2/4 Hot loops ~60 Hz (Node) =="
node --expose-gc bench/hotloops.js "$TMP/perf10.js" "$TMP/build.js"

if [ "$SKIP_PAGE_EVAL" = "1" ]; then
  echo
  echo "== 3/4 Éval page (Edge) : ignoré (--skip-page-eval) =="
  if [ "$SKIP_STARTUP_PROFILE" = "1" ]; then
    echo "== 4/4 Profil startup (Edge) : ignoré (--skip-startup-profile) =="
  fi
  exit 0
fi

echo
echo "== 3/4 Éval page (Edge via Playwright) =="
if node -e "require('playwright')" 2>/dev/null || node -e "require('playwright-core')" 2>/dev/null; then
  node bench/page-eval.js "$TMP/perf10.js" "$TMP/build.js"
else
  echo "Playwright introuvable — étape ignorée."
  echo "Pour l'activer : npm i -D playwright (ou NODE_PATH vers un install existant),"
  echo "puis relancez ./bench/run-all.sh"
fi

if [ "$SKIP_STARTUP_PROFILE" = "1" ]; then
  echo
  echo "== 4/4 Profil startup (Edge) : ignoré (--skip-startup-profile) =="
  exit 0
fi

echo
echo "== 4/4 Profil CPU du startup (Edge via Playwright + CDP Profiler) =="
if node -e "require('playwright')" 2>/dev/null || node -e "require('playwright-core')" 2>/dev/null; then
  node bench/startup-profile.js "$TMP/perf10.js" "$TMP/build.js" --runs=5
else
  echo "Playwright introuvable — étape ignorée."
  echo "Pour l'activer : npm i -D playwright (ou NODE_PATH vers un install existant),"
  echo "puis relancez ./bench/run-all.sh"
fi
