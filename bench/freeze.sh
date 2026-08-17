#!/bin/bash
# Rejoue EXACTEMENT le protocole figé (cf. bench/README.md « Protocole figé »)
# et formate la sortie en tableaux markdown prêts à coller dans bench/README.md
# (chapitre Benchmarks).
#
# Le script exécute les mêmes commandes que la section Repro de bench/README.md :
#   - hotloops : 3 seeds (42/2024/999) × 3 passes × 200 000 itérations
#   - parse    : mêmes seeds × 3 passes × 300 itérations
#   - éval page (optionnel, --with-page-eval) : 20 runs Edge
# puis agrège (médiane des médianes + plage inter-seeds) via
# bench/freeze-format.js.
#
# Usage : ./bench/freeze.sh [--seeds="42 2024 999"] [--passes=3] [--with-page-eval]
#                                [--update-readme[=chemin]] (régénère le README en place)
#
# État machine : avant et après CHAQUE seed hotloops, machine-state.js
# (bench/gpu/, partagé avec le harnais GPU) capture l'état GPU/CPU dans
# bench/state-cpu-s<seed>.{before,after}.json (gitignorés) — pour corréler
# l'état « haut » / « bas » CPU (classification par ratio IDLE, cf. README)
# avec la charge/clocks/temp réels. --no-state pour désactiver.
set -e
cd "$(dirname "$0")/.."

SEEDS="42 2024 999"
PASSES=3
WITH_PAGE_EVAL=0
UPDATE_README=0
README_PATH="bench/README.md"
STATE=1
for arg in "$@"; do
  case "$arg" in
    --seeds=*)        SEEDS="${arg#--seeds=}" ;;
    --passes=*)       PASSES="${arg#--passes=}" ;;
    --with-page-eval) WITH_PAGE_EVAL=1 ;;
    --no-state)       STATE=0 ;;
    --update-readme)  UPDATE_README=1 ;;
    --update-readme=*) UPDATE_README=1; README_PATH="${arg#--update-readme=}" ;;
    *) echo "Option inconnue : $arg" >&2; exit 1 ;;
  esac
done

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "== Préparation des builds (baseline 055d3a0 vs better-xcloud.user.js) =="
git show 055d3a0:better-xcloud.user.js > "$TMP/perf10.js"
cp better-xcloud.user.js "$TMP/build.js"
echo "  perf10 : $(wc -c < "$TMP/perf10.js") o | build : $(wc -c < "$TMP/build.js") o"

echo
echo "== Hot loops : $(echo $SEEDS | wc -w) seed(s) × $PASSES passes × 200 000 itérations$([ "$STATE" = "1" ] && echo " + état machine") =="
for S in $SEEDS; do
  if [ "$STATE" = "1" ]; then
    node bench/gpu/machine-state.js before > "bench/state-cpu-s$S.before.json" 2>/dev/null || true
  fi
  node --expose-gc bench/hotloops.js "$TMP/perf10.js" "$TMP/build.js" \
    --passes=$PASSES --seed=$S --iters=200000 > "$TMP/hotloops-$S.txt"
  if [ "$STATE" = "1" ]; then
    node bench/gpu/machine-state.js after > "bench/state-cpu-s$S.after.json" 2>/dev/null || true
    echo "  seed $S : OK (état machine → bench/state-cpu-s$S.{before,after}.json)"
  else
    echo "  seed $S : OK"
  fi
done

echo
echo "== Parse/compile : $(echo $SEEDS | wc -w) seed(s) × $PASSES passes × 300 itérations =="
for S in $SEEDS; do
  node --expose-gc bench/parse.js "$TMP/perf10.js" "$TMP/build.js" \
    --passes=$PASSES --seed=$S --iters=300 > "$TMP/parse-$S.txt"
  echo "  seed $S : OK"
done

if [ "$WITH_PAGE_EVAL" = "1" ]; then
  echo
  echo "== Éval page (Edge, 20 runs) =="
  if node -e "require('playwright')" 2>/dev/null || node -e "require('playwright-core')" 2>/dev/null; then
    node bench/page-eval.js "$TMP/perf10.js" "$TMP/build.js" > "$TMP/page-eval.txt"
    echo "  OK"
  else
    echo "  Playwright introuvable — ligne « Éval page » omise." >&2
    WITH_PAGE_EVAL=0
  fi
fi

BUILD_LABEL=$(grep -m1 '^// @version' better-xcloud.user.js | sed 's/.*@version[[:space:]]*//')

if [ "$UPDATE_README" = "1" ] && [ "$WITH_PAGE_EVAL" != "1" ]; then
  echo "⚠ La ligne « Éval complète de page » sera retirée de la table Chargement"
  echo "  (elle n'est régénérée qu'avec --with-page-eval)."
fi

echo
echo "========== Tableaux markdown (chapitre Benchmarks) =========="
echo
if [ "$UPDATE_README" = "1" ]; then
  node bench/freeze-format.js "$TMP" "$PASSES" "$SEEDS" "$WITH_PAGE_EVAL" "$BUILD_LABEL" --update-readme="$README_PATH"
  echo
  echo "(README modifié en place — vérifiez le diff avant de commiter.)"
else
  node bench/freeze-format.js "$TMP" "$PASSES" "$SEEDS" "$WITH_PAGE_EVAL" "$BUILD_LABEL"
fi
