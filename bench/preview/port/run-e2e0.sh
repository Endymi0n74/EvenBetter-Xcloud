#!/bin/bash
# Étape 0 du protocole E2E preview (e2e-cdp.md) en une commande :
#   A. fetch-early.test.js      — document-start viable (T6 garde, hook avant
#                                 entry.client, SDK ub capture notre hook) 17/17
#   B. userscript-rewrite.test.js — réécriture P2+P3 en vm sur le build réel 14/14
#   C. probe-page.js            — hookActif sur le navigateur CDP (info, soft)
#
# Échoue (exit 1) si un GATE (A/B) est rouge. Le probe est informatif : navigateur
# injoignable → warning, pas d'échec. À lancer AVANT chaque session CDP réelle.
#
# Usage : ./bench/preview/port/run-e2e0.sh [--port=9222] [--skip-probe]
cd "$(dirname "$0")/../../.."

PORT=9222
SKIP_PROBE=0
for a in "$@"; do
  case "$a" in
    --port=*) PORT="${a#--port=}" ;;
    --skip-probe) SKIP_PROBE=1 ;;
    *) echo "option inconnue : $a (usage : --port=9222, --skip-probe)" >&2; exit 2 ;;
  esac
done

FAIL=0

echo "== Étape 0 — hors-navigateur (protocole E2E preview) =="
echo

echo "== A — document-start (fetch-early) =="
node bench/preview/port/fetch-early.test.js
[ $? -eq 0 ] || { FAIL=1; echo "  ❌ GATE A ROUGE"; }
echo

echo "== B — réécriture P2+P3 (userscript-rewrite) =="
node bench/preview/port/userscript-rewrite.test.js
[ $? -eq 0 ] || { FAIL=1; echo "  ❌ GATE B ROUGE"; }
echo

if [ "$SKIP_PROBE" = "1" ]; then
  echo "== C — probe-page : ignoré (--skip-probe) =="
else
  echo "== C — probe-page (hookActif sur le navigateur CDP) =="
  if node -e "require('playwright')" 2>/dev/null || node -e "require('playwright-core')" 2>/dev/null; then
    if node bench/preview/probe-page.js "$PORT"; then
      echo "  (probe OK — hookActif true/false : voir ci-dessus)"
    else
      echo "  ⚠️ probe injoignable (navigateur CDP sur $PORT ?) — pas un échec de gate"
    fi
  else
    echo "  ⚠️ Playwright introuvable — probe ignoré (npm i -D playwright)"
  fi
fi

echo
if [ "$FAIL" = "0" ]; then
  echo "Étape 0 : OK ✅ — gates verts (A+B), prêt pour les runs CDP (Run 0 témoin / Run 1 intercepté)"
  exit 0
else
  echo "Étape 0 : ÉCHEC ❌ — au moins un gate rouge, corriger avant tout run CDP (e2e-cdp.md : la logique dérive, ancres/minifier ?)"
  exit 1
fi
