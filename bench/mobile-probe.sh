#!/usr/bin/env bash
# mobile-probe.sh — rejoue la validation APK complète en une commande :
#
#   build (mobile/build.sh) → install → lancement → adb forward vers le
#   socket devtools du WebView → sonde CDP (overlay + marqueurs BX) →
#   cycle panne→récupération (page d'erreur + retry auto).
#
# Usage :
#   bash bench/mobile-probe.sh              # tout : build + install + sonde + cycle
#   bash bench/mobile-probe.sh --skip-build # réutilise l'APK déjà buildé
#   bash bench/mobile-probe.sh --no-cycle   # sonde seule, sans le test panne→récup
#   bash bench/mobile-probe.sh --manual     # récupération manuelle (clic « Réessayer »)
#   bash bench/mobile-probe.sh --serial emulator-5554
#
# Prérequis : SDK à /d/android-sdk (build-tools 34.0.0), device adb connecté
# (émulateur ou téléphone, debug USB), JAVA_HOME pour le build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADB=/d/android-sdk/platform-tools/adb.exe
PKG=com.bxperf.app
ACTIVITY=com.bxperf.app/.MainActivity
APK_OUT="$ROOT/mobile/out/better-xcloud-perf-1.8.0.apk"
PORT=9341
SERIAL=""
DO_BUILD=1
DO_CYCLE=1
DO_MANUAL=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-build) DO_BUILD=0 ;;
    --no-cycle)   DO_CYCLE=0 ;;
    --manual)     DO_MANUAL=1 ;;
    --serial=*)   SERIAL="${1#--serial=}" ;;
    --serial)     [ "$#" -ge 2 ] || { echo "usage: --serial <id> manquant" >&2; exit 2; }
                  SERIAL="$2"; shift ;;
    *) echo "usage: bash bench/mobile-probe.sh [--skip-build] [--no-cycle] [--manual] [--serial <id>]"; exit 2 ;;
  esac
  shift
done

echo "==> device adb"
if [ -n "$SERIAL" ]; then
  DEV="$SERIAL"
else
  DEV=$("$ADB" devices | awk 'NR>1 && $2=="device" {print $1; exit}')
fi
if [ -z "$DEV" ]; then
  echo "❌ aucun device adb connecté (émulateur à lancer ou téléphone en debug USB)" >&2
  exit 1
fi
echo "    device : $DEV"
"$ADB" -s "$DEV" get-state >/dev/null

if [ "$DO_BUILD" = "1" ]; then
  echo "==> build APK"
  export JAVA_HOME="${JAVA_HOME:-C:\\Program Files\\Zulu\\zulu-21}"
  (cd "$ROOT" && bash mobile/build.sh)
else
  echo "==> build APK (skip — réutilise mobile/out/)"
fi
[ -f "$APK_OUT" ] || { echo "❌ APK absent : $APK_OUT (lance sans --skip-build)" >&2; exit 1; }

echo "==> install + lancement"
"$ADB" -s "$DEV" install -r "$APK_OUT" >/dev/null
"$ADB" -s "$DEV" shell am force-stop "$PKG" >/dev/null 2>&1 || true
"$ADB" -s "$DEV" shell am start -n "$ACTIVITY" >/dev/null

echo "==> attente du process + socket devtools du WebView"
PID=""
for i in $(seq 1 30); do
  PID=$("$ADB" -s "$DEV" shell pidof "$PKG" | tr -d '\r' || true)
  [ -n "$PID" ] && break
  sleep 1
done
if [ -z "$PID" ]; then
  echo "❌ process $PKG introuvable après 30 s" >&2
  exit 1
fi
echo "    pid : $PID"

echo "==> adb forward tcp:$PORT → webview_devtools_remote_$PID"
"$ADB" -s "$DEV" forward --remove "tcp:$PORT" >/dev/null 2>&1 || true
"$ADB" -s "$DEV" forward "tcp:$PORT" "localabstract:webview_devtools_remote_$PID" >/dev/null

echo "==> sonde CDP (+ panne→récupération)"
ARGS=("$PORT")
if [ "$DO_MANUAL" = "1" ]; then
  ARGS+=(--manual)
elif [ "$DO_CYCLE" = "1" ]; then
  ARGS+=(--cycle)
fi
node "$ROOT/bench/mobile-probe.js" "${ARGS[@]}"
RC=$?

echo "==> logcat BXPerf (30 dernières lignes)"
"$ADB" -s "$DEV" logcat -d -s BXPerf | tail -30 || true

"$ADB" -s "$DEV" forward --remove "tcp:$PORT" >/dev/null 2>&1 || true
exit $RC
