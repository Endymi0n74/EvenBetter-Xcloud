#!/usr/bin/env bash
# ============================================================================
# bench/release-guard.sh — Garde-fou quotidien des releases
#
# Détecte l'incident du 18 août (la release stable v1.9.0 avait disparu
# silencieusement — release ET tag supprimés, tous les liens latest en 404).
# Vérifie, en une passe :
#   1. la release stable marquée Latest existe, et son TAG pointe sur un
#      commit du repo (une release orpheline ne suffit pas) ;
#   2. les 4 liens d'auto-update (user.js/meta.js × stable/preview) répondent
#      200 ET servent les BYTES attendus — comparés aux bundles du commit
#      tagué (`git show <sha>:<fichier>`, insensible au CRLF du checkout) ;
#   3. les @version/@name servis sont cohérents : stable = VERSION du repo,
#      preview = sa propre version, noms EvenBetterXcloud (détecte un
#      re-upload du mauvais script) ;
#   4. les liens APK répondent 200 ET le NOM STABLE `evenbetter-xcloud.apk`
#      (le lien de la bannière Android, re-uploadé à CHAQUE release en plus du
#      nom versionné) doit servir les MÊMES bytes que le nom versionné
#      `evenbetter-xcloud-<v>.apk` — détecte un oubli de re-upload du nom
#      stable au bump (il servirait l'ancien APK pendant que le versionné sert
#      le nouveau). Preview via son tag pinné (200).
#
# GATE ROUGE (exit != 0) sur la première anomalie. Dans le workflow
# release-guard.yml (cron quotidien + dispatch), un échec = Actions rouge +
# notification email GitHub (réglage par défaut du repo) — c'est l'alerte.
#
# Contrat vérifié : l'asset `better-xcloud.user.js` servi sur latest EST le
# build ES2017 (politique v1.8.0) → comparé à better-xcloud.es2017.user.js du
# commit tagué. Si le pipeline de publication change (ex. servir l'ESNext),
# mettre à jour cette comparaison en même temps.
#
# Fin de ligne : les comparaisons sha normalisent CRLF→LF des DEUX côtés — le
# blob git est stocké en LF (autocrlf=true) alors que les releases sont
# publiées depuis un working tree Windows (CRLF) et le runner Linux (LF).
# Sans normalisation, le garde-fou serait un faux positif permanent.
#
# Usage  : ./bench/release-guard.sh [--repo=owner/repo]
#          depuis la racine du repo, avec l'historique complet (git show <tag>)
#          et gh authentifié. En local : git fetch --tags origin au préalable.
# ============================================================================
set -euo pipefail

REPO="Endymi0n74/EvenBetter-Xcloud"

for arg in "$@"; do
    case "$arg" in
        --repo=*) REPO="${arg#--repo=}" ;;
        *)
            echo "usage: $0 [--repo=owner/repo]" >&2
            exit 2
            ;;
    esac
done

log()  { echo "[guard] $*"; }
gate() { echo "[guard] GATE ROUGE : $*" >&2; exit 1; }

DL="https://github.com/$REPO/releases"

# --- 1. La release stable existe et son tag pointe sur un commit ------------
# 2>&1 (pas 2>/dev/null) : en cas d'échec gh, le message réel est propagé
# dans le GATE ROUGE (diagnostic CI) au lieu d'être avalé.
LATEST_TAG=$(gh release list --repo "$REPO" --limit 100 --json tagName,isLatest \
    --jq '.[] | select(.isLatest == true) | .tagName' 2>&1) \
    || gate "impossible de lister les releases de $REPO — $(printf '%s' "$LATEST_TAG" | head -1)"
# gh en échec → LATEST_TAG contient le message d'erreur (multi-lignes possible) ;
# un tag valide ne contient ni espace ni newline.
case "$LATEST_TAG" in
    ''|*' '*|*$'\n'*)
        gate "réponse gh inattendue pour le Latest : $(printf '%s' "$LATEST_TAG" | head -1)" ;;
esac

TAG_SHA=$(git rev-list -n 1 "$LATEST_TAG" 2>/dev/null) \
    || gate "le tag $LATEST_TAG est introuvable dans git (release orpheline ?)"
log "Latest : $LATEST_TAG → ${TAG_SHA:0:12}"

# --- 2. Contrat du stable : version + nom + bytes ----------------------------
EXPECT_VERSION=$(tr -d '\r' < VERSION)
[ -n "$EXPECT_VERSION" ] || gate "fichier VERSION absent/illisible"

SERVED_META=$(curl --noproxy "*" -s -L --max-time 30 "$DL/latest/download/better-xcloud.meta.js") \
    || gate "échec de téléchargement du meta stable"
[ -n "$SERVED_META" ] || gate "meta stable servi vide"
SERVED_VER=$(echo "$SERVED_META" | grep -m1 '^// @version' | sed 's/^\/\/ @version *//' | tr -d '\r')
SERVED_NAME=$(echo "$SERVED_META" | grep -m1 '^// @name' | sed 's/^\/\/ @name *//' | tr -d '\r')
[ "$SERVED_VER" = "$EXPECT_VERSION" ] \
    || gate "meta stable servi @version $SERVED_VER ≠ VERSION ($EXPECT_VERSION)"
[ "$SERVED_NAME" = "EvenBetterXcloud" ] \
    || gate "meta stable servi @name « $SERVED_NAME » ≠ EvenBetterXcloud"
log "stable : @version $SERVED_VER = VERSION ✓, @name $SERVED_NAME ✓"

# Byte-identique : user.js servi == build ES2017 du commit tagué, meta servi
# == meta du commit tagué (comparaison sur les bytes du blob, pas du checkout).
sha_at() { # $1 = sha commit, $2 = chemin dans le repo — sha normalisé CRLF→LF
    git show "$1:$2" 2>/dev/null | tr -d '\r' | sha256sum | awk '{print $1}'
}

check_bytes() { # $1 = label, $2 = url, $3 = sha attendu (normalisé CRLF→LF)
    local served
    served=$(curl --noproxy "*" -s -L --max-time 60 "$2" | tr -d '\r' | sha256sum | awk '{print $1}')
    [ -n "$served" ] || gate "$1 : téléchargement vide"
    [ "$served" = "$3" ] \
        || gate "$1 : bytes servis ≠ bundle du commit tagué (servi ${served:0:12}, attendu ${3:0:12})"
    log "$1 : byte-identique ✓"
}

EXP_USER=$(sha_at "$TAG_SHA" better-xcloud.es2017.user.js)
[ -n "$EXP_USER" ] || gate "better-xcloud.es2017.user.js absent du commit tagué (bundle ES2017 non commité ?)"
EXP_META=$(sha_at "$TAG_SHA" better-xcloud.meta.js)
[ -n "$EXP_META" ] || gate "better-xcloud.meta.js absent du commit tagué"

check_bytes "user.js stable (latest)" "$DL/latest/download/better-xcloud.user.js" "$EXP_USER"
check_bytes "meta.js stable (latest)"  "$DL/latest/download/better-xcloud.meta.js"  "$EXP_META"

# --- 3. Preview : canal pinné par le build (source de vérité) ---------------
# Le @updateURL/@downloadURL du preview pointe le CANAL flottant
# `evenbetter-xcloud-preview-channel` (depuis le fix auto-update du 19 août :
# un pin sur un tag versionné est purgé par la rétention → 404 auto-update,
# et même vivant, sa meta figée ne propose jamais la version suivante).
# Le canal est une release à part, ré-uploadée à chaque publication preview :
# la comparaison se fait contre le BUILD LOCAL (dernier build généré), pas
# contre un commit tagué (le canal n'est pas un tag git).
PINNED_TAG=$(grep -o 'releases/download/[^/]*' better-xcloud-preview.user.js | head -1 | cut -d/ -f3)
[ -n "$PINNED_TAG" ] || gate "aucun tag pinné dans better-xcloud-preview.user.js (@updateURL absent ?)"
log "preview pinné : $PINNED_TAG (canal flottant — comparé au build local)"

PREVIEW_META=$(curl --noproxy "*" -s -L --max-time 30 "$DL/download/$PINNED_TAG/better-xcloud-preview.meta.js") \
    || gate "échec de téléchargement du meta preview"
[ -n "$PREVIEW_META" ] || gate "meta preview servi vide"
PREVIEW_VER=$(echo "$PREVIEW_META" | grep -m1 '^// @version' | sed 's/^\/\/ @version *//' | tr -d '\r')
PREVIEW_NAME=$(echo "$PREVIEW_META" | grep -m1 '^// @name' | sed 's/^\/\/ @name *//' | tr -d '\r')
[ -n "$PREVIEW_VER" ] || gate "meta preview servi sans @version"
[ "$PREVIEW_NAME" = "EvenBetterXcloud (Preview)" ] \
    || gate "meta preview servi @name « $PREVIEW_NAME » ≠ EvenBetterXcloud (Preview)"
PREVIEW_EXPECT=$(tr -d '\r' < PREVIEW_VERSION)
[ "$PREVIEW_VER" = "$PREVIEW_EXPECT" ] \
    || gate "meta preview servi @version $PREVIEW_VER ≠ PREVIEW_VERSION local ($PREVIEW_EXPECT) — le canal n'a pas été ré-uploadé au dernier bump"
log "preview : @version $PREVIEW_VER = PREVIEW_VERSION ✓, @name $PREVIEW_NAME ✓"

EXP_P_USER=$(cat better-xcloud-preview.user.js | tr -d '\r' | sha256sum | awk '{print $1}')
[ -n "$EXP_P_USER" ] || gate "better-xcloud-preview.user.js local illisible"
EXP_P_META=$(cat better-xcloud-preview.meta.js | tr -d '\r' | sha256sum | awk '{print $1}')
[ -n "$EXP_P_META" ] || gate "better-xcloud-preview.meta.js local illisible"
log "references build local : user=$(echo $EXP_P_USER | cut -c1-12) meta=$(echo $EXP_P_META | cut -c1-12)"

check_bytes "user.js preview (tag)" "$DL/download/$PINNED_TAG/better-xcloud-preview.user.js" "$EXP_P_USER"
check_bytes "meta.js preview (tag)"  "$DL/download/$PINNED_TAG/better-xcloud-preview.meta.js"  "$EXP_P_META"

# --- 4. APK : le lien stable et le lien versionné servent les MÊMES bytes ---
#      -f : fait échouer curl sur un HTTP != 200 (404 inclus — le body d'une
#      page d'erreur GitHub ne doit pas être hashé comme un APK valide).
apk_sha() { # $1 = url → sha256 des bytes servis ; exit != 0 si HTTP != 200
    curl --noproxy "*" -sfL --max-time 60 "$1" | sha256sum | awk '{print $1}'
}
STABLE_SHA=$(apk_sha "$DL/latest/download/evenbetter-xcloud.apk") \
    || gate "APK stable (bannière) : téléchargement échoué (HTTP != 200 ou réseau)"
VERSIONED_SHA=$(apk_sha "$DL/latest/download/evenbetter-xcloud-$EXPECT_VERSION.apk") \
    || gate "APK versionné ($EXPECT_VERSION) : téléchargement échoué (HTTP != 200 ou réseau)"
[ -n "$STABLE_SHA" ] || gate "APK stable (bannière) : téléchargement vide"
[ -n "$VERSIONED_SHA" ] || gate "APK versionné : téléchargement vide"
[ "$STABLE_SHA" = "$VERSIONED_SHA" ] \
    || gate "APK stable ≠ versionné (${STABLE_SHA:0:12} vs ${VERSIONED_SHA:0:12}) — oubli de re-upload du nom stable au bump ?"
log "APK stable (bannière) : HTTP 200 ✓, byte-identique au versionné ✓ (${STABLE_SHA:0:12})"

check_link() { # $1 = label, $2 = url
    local code
    code=$(curl --noproxy "*" -s -o /dev/null -w "%{http_code}" -L --max-time 30 "$2")
    [ "$code" = "200" ] || gate "$1 → HTTP $code"
    log "$1 : HTTP 200 ✓"
}
# l'APK preview est uploadé sur la RELEASE VERSIONNÉE (le canal ne porte que
# user.js + meta.js) — le nom dérive de PREVIEW_VERSION local (source de vérité)
PREVIEW_EXPECT=$(tr -d '\r' < PREVIEW_VERSION)
check_link "APK preview (release versionnée)" "$DL/download/evenbetter-xcloud-v$PREVIEW_EXPECT/evenbetter-xcloud-$PREVIEW_EXPECT.apk"

log "OK : release stable + tag présents, 4/4 liens byte-identiques, versions/names cohérents, APK 200"
