#!/bin/bash
# Rejoue EN UNE COMMANDE le protocole GPU figé — équivalent local du job CI
# `gpu-upload` de `.github/workflows/bench.yml` :
#   gen-video (test.webm) → 6 seeds × gpu-runner.js → agg-seeds.js → check-gpu.js
#
# Ce script exécute exactement les commandes de la section Repro GPU du README :
#   - génération de la vidéo de test (640×360 VP9) si absente (ou --force-video)
#   - protocole figé : seeds 100/200/300/400/500/600 × 3 passes × 120 frames
#     (ordre mélangé par seed), `--no-fix` (mesure strictement le build publié)
#   - agrégation (médiane des médianes + plage inter-seeds) puis vérification
#     des seuils CI (upload ≥ 1,3 / wallTotal ≥ 1,2 / draw 0,5–2,0 + chemin GL)
#
# Canal navigateur : auto-détecté — `msedge` sous Windows (GPU via ANGLE/D3D11),
# `chromium` ailleurs (Linux/CI, Chromium fourni par Playwright) ; surchargable
# avec --channel=.
#
# Usage :
#   ./bench/gpu/run-gpu-ci.sh                       # protocole complet (≈30–40 min)
#   ./bench/gpu/run-gpu-ci.sh --seeds="100 200"     # sous-ensemble (test rapide)
#   ./bench/gpu/run-gpu-ci.sh --keep-video           # réutilise test.webm existant
#   ./bench/gpu/run-gpu-ci.sh --label-new=v1.5.0 --cls-new=bench/gpu/gpu-v150-webgl2player.txt
#
# Options :
#   --seeds="100 200 ..."  seeds (défaut : 100 200 300 400 500 600)
#   --channel=msedge|chromium  canal navigateur (défaut : auto)
#   --frames=N   frames par passe (défaut 120)        --passes=N  passes (défaut 3)
#   --cls-p10=FILE   classe perf10 (défaut gpu-perf10-webgl2player.txt)
#   --cls-new=FILE   classe build récent (défaut gpu-v140-webgl2player.txt)
#   --label-new=VER  label du build (défaut v1.4.0, passé à runner + agg-seeds)
#   --fix        applique le correctif RGB8 du runner (par défaut : --no-fix)
#   --force-video  régénère test.webm même s'il existe
#   --keep-video   réutilise test.webm existant
#   --markdown=PATH  résumé markdown de check-gpu.js (défaut : console seule)
#   --update-readme[=label]  insère la ligne de session dans le tableau
#                            « Sessions GPU » du README (check-gpu.js,
#                            idempotent) ; le label personnalise la colonne
#                            Session (défaut : <date> (N seeds))
#   --session-label=LABEL  label de la colonne Session (avec --update-readme)
#   --resume       saute les seeds dont run-s<seed>.json est déjà COMPLET (JSON
#                  valide, les 2 versions aggées, toutes les passes terminées) —
#                  après un run timeout/partiel, seuls les seeds manquants ou
#                  corrompus sont re-mesurés
#   --no-state     désactive la capture d'état machine (défaut : activée)
#
# État machine : avant et après CHAQUE seed, machine-state.js capture l'état
# GPU (nvidia-smi : température, utilisation, clocks SM/mémoire, puissance,
# P-state) et CPU (charge %, % de la fréquence de base si compteurs perf
# disponibles, fréquence de base via WMI, top 5 processus en temps CPU) dans
# bench/gpu/state-s<seed>.{before,after}.json (gitignorés). Objectif : corréler
# l'état « haut » / « bas » des uploads GPU (backpressure/sync du pipeline —
# mémo projet §7) avec l'état réel de la machine. Tolérant : outil absent →
# champ null, le protocole continue. Affichage par seed dans agg-seeds.js.
#
# Les run-s<seed>.json sont conservés (gitignorés) : agg-seeds.js et
# check-gpu.js peuvent être relancés sans re-mesurer. Nettoyage manuel :
#   rm bench/gpu/run-s*.json bench/gpu/state-s*.json
set -e
cd "$(dirname "$0")/../.."

SEEDS="100 200 300 400 500 600"
CHANNEL=""
FRAMES=120
PASSES=3
CLS_P10="bench/gpu/gpu-perf10-webgl2player.txt"
CLS_NEW="bench/gpu/gpu-v140-webgl2player.txt"
LABEL_NEW="v1.4.0"
SESSION_LABEL=""
NO_FIX=1
FORCE_VIDEO=0
KEEP_VIDEO=0
MARKDOWN=""
UPDATE_README=""
RESUME=0
STATE=1
for arg in "$@"; do
  case "$arg" in
    --seeds=*)     SEEDS="${arg#--seeds=}" ;;
    --channel=*)   CHANNEL="${arg#--channel=}" ;;
    --frames=*)    FRAMES="${arg#--frames=}" ;;
    --passes=*)    PASSES="${arg#--passes=}" ;;
    --cls-p10=*)   CLS_P10="${arg#--cls-p10=}" ;;
    --cls-new=*)   CLS_NEW="${arg#--cls-new=}" ;;
    --label-new=*) LABEL_NEW="${arg#--label-new=}" ;;
    --fix)         NO_FIX=0 ;;
    --force-video) FORCE_VIDEO=1 ;;
    --keep-video)  KEEP_VIDEO=1 ;;
    --markdown=*)  MARKDOWN="${arg#--markdown=}" ;;
    --update-readme) UPDATE_README=1 ;;
    --update-readme=*) UPDATE_README="${arg#--update-readme=}" ;;
    --session-label=*) SESSION_LABEL="${arg#--session-label=}" ;;
    --resume)      RESUME=1 ;;
    --no-state)    STATE=0 ;;
    *) echo "Option inconnue : $arg" >&2; exit 1 ;;
  esac
done

# Canal navigateur : msedge (Windows) par défaut, chromium (Linux/CI) sinon
if [ -z "$CHANNEL" ]; then
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) CHANNEL="msedge" ;;
    *) CHANNEL="chromium" ;;
  esac
fi

if ! node -e "require('playwright')" 2>/dev/null && ! node -e "require('playwright-core')" 2>/dev/null; then
  echo "Playwright introuvable — installe-le (npm i -D playwright) ou pointe" >&2
  echo "NODE_PATH vers un install existant (ex. export NODE_PATH=/d/Codex/koharu/node_modules)." >&2
  exit 1
fi

# Un seed est considéré « déjà mesuré » (--resume) si son run-s<seed>.json est
# complet : JSON valide, `agg` avec les 2 versions (perf10 + label), et toutes
# les passes terminées (PASSES × 2 mesures). Un fichier partiel (run timeout,
# JSON corrompu) est ignoré et re-mesuré.
run_is_complete() {
  node -e "
    const fs = require('fs');
    const PASSES = parseInt(process.argv[1], 10);
    const LABEL = process.argv[2];
    const file = process.argv[3];
    if (!fs.existsSync(file)) process.exit(1);
    const txt = fs.readFileSync(file, 'utf8');
    try {
      const res = JSON.parse(txt.slice(txt.indexOf('{')));
      const okAgg = res.agg && res.agg.perf10 && res.agg[LABEL];
      const okPasses = Array.isArray(res.passes) && res.passes.length === PASSES * 2;
      process.exit(okAgg && okPasses ? 0 : 1);
    } catch (e) { process.exit(1); }
  " "$PASSES" "$LABEL_NEW" "bench/gpu/run-s$1.json"
}

VIDEO="bench/gpu/test.webm"
if [ "$KEEP_VIDEO" = "1" ] && [ -f "$VIDEO" ]; then
  echo "== Vidéo : réutilisation de $VIDEO (--keep-video) =="
elif [ "$FORCE_VIDEO" = "1" ] || [ ! -f "$VIDEO" ]; then
  echo "== Génération de la vidéo de test ($VIDEO, canal $CHANNEL) =="
  node bench/gpu/gen-video.js "$VIDEO" --channel="$CHANNEL"
else
  echo "== Vidéo : $VIDEO existe déjà (utilise --force-video pour la régénérer) =="
fi

echo
echo "== Protocole figé — $(echo $SEEDS | wc -w) seed(s) × $PASSES passes × $FRAMES frames (canal $CHANNEL, $LABEL_NEW)$([ "$RESUME" = "1" ] && echo ", --resume") =="
for S in $SEEDS; do
  if [ "$RESUME" = "1" ] && run_is_complete "$S"; then
    echo "  seed $S : déjà mesuré (run-s$S.json complet) — skip (--resume)"
    continue
  fi
  if [ "$STATE" = "1" ]; then
    echo "  seed $S : état machine (avant)..."
    node bench/gpu/machine-state.js before > "bench/gpu/state-s$S.before.json" 2>/dev/null || true
  fi
  echo "  seed $S ..."
  node bench/gpu/gpu-runner.js \
    --cls-p10="$CLS_P10" \
    --cls-new="$CLS_NEW" \
    --label-new="$LABEL_NEW" \
    --frames="$FRAMES" --passes="$PASSES" --seed="$S" \
    --channel="$CHANNEL" \
    $([ "$NO_FIX" = "1" ] && echo --no-fix) \
    > "bench/gpu/run-s$S.json"
  if [ "$STATE" = "1" ]; then
    echo "  seed $S : état machine (après)..."
    node bench/gpu/machine-state.js after > "bench/gpu/state-s$S.after.json" 2>/dev/null || true
  fi
  echo "  seed $S : OK"
done

echo
echo "== Agrégation des seeds =="
node bench/gpu/agg-seeds.js $SEEDS --label-new="$LABEL_NEW"

echo
echo "== Vérification (seuils CI : upload ≥ 1,3 / wallTotal ≥ 1,2 / draw 0,5–2,0 + chemin GL) =="
UPD_RM=""
if [ -n "$UPDATE_README" ]; then
  if [ "$UPDATE_README" = "1" ]; then
    UPD_RM="--update-readme"
  else
    UPD_RM="--update-readme=$UPDATE_README"
  fi
fi
node bench/gpu/check-gpu.js $SEEDS ${MARKDOWN:+--markdown="$MARKDOWN"} $UPD_RM ${SESSION_LABEL:+--session-label="$SESSION_LABEL"}

echo
echo "Terminé. Les run-s*.json sont conservés (gitignorés) — relance possible de"
echo "agg-seeds.js / check-gpu.js sans re-mesurer. Nettoyage : rm bench/gpu/run-s*.json"
