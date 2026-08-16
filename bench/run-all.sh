#!/bin/bash
# Lance tous les harnais CPU de benchmark : perf10 (baseline 055d3a0) vs build courant.
#
# Préparation des builds : la baseline est extraite du git du repo (commit 055d3a0),
# le build courant est better-xcloud.user.js à la racine.
#
# Prérequis page-eval / startup-profile / cold-getcap : Playwright + Edge (canal
# msedge). Sans Playwright local, installer avec `npm i -D playwright`, ou pointer
# NODE_PATH vers un install existant (ex. export NODE_PATH=/d/Codex/koharu/node_modules).
#
# Usage : ./bench/run-all.sh [--skip-page-eval] [--skip-startup-profile] [--skip-cold-getcap] [--cold-page-eval]
set -e
cd "$(dirname "$0")/.."

SKIP_PAGE_EVAL=0
SKIP_STARTUP_PROFILE=0
SKIP_COLD_GETCAP=0
COLD_PAGE_EVAL=0
for a in "$@"; do
  [ "$a" = "--skip-page-eval" ] && SKIP_PAGE_EVAL=1
  [ "$a" = "--skip-startup-profile" ] && SKIP_STARTUP_PROFILE=1
  [ "$a" = "--skip-cold-getcap" ] && SKIP_COLD_GETCAP=1
  [ "$a" = "--cold-page-eval" ] && COLD_PAGE_EVAL=1
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
echo "== 1/5 Parse/compile (Node) =="
node --expose-gc bench/parse.js "$TMP/perf10.js" "$TMP/build.js"

echo
echo "== 2/5 Hot loops ~60 Hz (Node) =="
node --expose-gc bench/hotloops.js "$TMP/perf10.js" "$TMP/build.js"

# Les étapes 3-5 exigent Playwright + Edge : on ne les lance que si la lib est
# là. --skip-page-eval coupe toute la suite Edge (CI ubuntu sans Playwright).
if node -e "require('playwright')" 2>/dev/null || node -e "require('playwright-core')" 2>/dev/null; then
  PW=1
else
  PW=0
fi

if [ "$SKIP_PAGE_EVAL" = "1" ]; then
  echo
  echo "== 3/5 Éval page (Edge) : ignoré (--skip-page-eval) =="
  echo "== 4/5 Profil startup (Edge) : ignoré =="
  echo "== 5/5 cold-getcap (Edge) : ignoré =="
  exit 0
fi

if [ "$PW" = "0" ]; then
  echo
  echo "== 3/5 Éval page (Edge) : Playwright introuvable, étape ignorée =="
  echo "== 4/5 Profil startup (Edge) : ignoré =="
  echo "== 5/5 cold-getcap (Edge) : ignoré =="
  echo "Pour les activer : npm i -D playwright (ou NODE_PATH vers un install existant),"
  echo "puis relancez ./bench/run-all.sh"
  exit 0
fi

echo
if [ "$COLD_PAGE_EVAL" = "1" ]; then
  echo "== 3/5 Éval page (Edge via Playwright, navigateur neuf par run — pile RTC froide) =="
  node bench/page-eval.js --cold "$TMP/perf10.js" "$TMP/build.js"
else
  echo "== 3/5 Éval page (Edge via Playwright) =="
  node bench/page-eval.js "$TMP/perf10.js" "$TMP/build.js"
fi

if [ "$SKIP_STARTUP_PROFILE" = "1" ]; then
  echo
  echo "== 4/5 Profil startup (Edge) : ignoré (--skip-startup-profile) =="
else
  echo
  echo "== 4/5 Profil CPU du startup (Edge via Playwright + CDP Profiler) =="
  node bench/startup-profile.js "$TMP/perf10.js" "$TMP/build.js" --runs=5
fi

if [ "$SKIP_COLD_GETCAP" = "1" ]; then
  echo
  echo "== 5/5 cold-getcap (Edge) : ignoré (--skip-cold-getcap) =="
else
  echo
  echo "== 5/5 Coût one-shot de getCapabilities (Edge via Playwright, navigateur neuf par run) =="
  node bench/cold-getcap.js "$TMP/perf10.js" "$TMP/build.js" --runs=5
fi
