#!/usr/bin/env bash
# ============================================================================
# bench/release-prune.sh — Politique de rétention des releases
#
# Garde  : la release stable marquée Latest + la release preview « courante »
#          (le tag pinné par le @updateURL du build local better-xcloud-preview.user.js —
#          source de vérité ; repli sur la prerelease la plus récente si absent).
# Purge  : toutes les autres (release + tag, --cleanup-tag).
# Après  : vérifie les 4 liens d'auto-update (user.js/meta.js × stable/preview).
#
# Usage  : ./bench/release-prune.sh [--dry-run] [--repo=owner/repo]
#          --dry-run : liste ce qui serait supprimé, ne touche à rien.
#
# À exécuter après chaque publication (stable ou preview).
# Exit != 0 (GATE ROUGE) si : pas de Latest, pas de preview, lien 404.
#
# Pièges documentés (Windows/Git Bash) :
#   - le preview « le plus récent » par publishedAt est un mauvais critère
#     (une release recréée depuis git reprend une date récente) — toujours
#     privilégier le tag pinné par le @updateURL du build.
#   - `gh release view --json id` renvoie l'ID GraphQL (RE_kw...) — l'API REST
#     des assets exige l'ID numérique : gh api .../releases/tags/<tag> --jq .id
#   - la suppression d'asset se fait via /releases/assets/{id} (pas
#     /releases/{rid}/assets/{id} → 404)
#   - `gh release upload` mangle les fichiers cachés en "default.*" et ne
#     supporte pas le renommage fichier#nom — nommer les fichiers locaux
#     exactement comme les assets voulus
# ============================================================================
set -euo pipefail

REPO="Endymi0n74/better-xcloud-perf"
DRY_RUN=0

for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        --repo=*)  REPO="${arg#--repo=}" ;;
        *)
            echo "usage: $0 [--dry-run] [--repo=owner/repo]" >&2
            exit 2
            ;;
    esac
done

log()  { echo "[prune] $*"; }
gate() { echo "[prune] GATE ROUGE : $*" >&2; exit 1; }

log "repo : $REPO"

# --- 1. Releases (jq intégré de gh — pas de dépendance jq) ------------------
LATEST_TAG=$(gh release list --repo "$REPO" --limit 100 --json tagName,isLatest \
    --jq '.[] | select(.isLatest == true) | .tagName' 2>/dev/null) \
    || gate "impossible de lister les releases de $REPO"
[ -n "$LATEST_TAG" ] || gate "pas de release Latest sur $REPO"

# Preview courant = tag pinné par le @updateURL du build local (source de vérité)
PINNED_TAG=""
if [ -f better-xcloud-preview.user.js ]; then
    PINNED_TAG=$(grep -o 'releases/download/[^/]*' better-xcloud-preview.user.js | head -1 | cut -d/ -f3)
fi

PREVIEW_TAG=""
if [ -n "$PINNED_TAG" ] && gh release view "$PINNED_TAG" --repo "$REPO" >/dev/null 2>&1; then
    PREVIEW_TAG="$PINNED_TAG"
    log "preview courant : $PREVIEW_TAG (pinné par le build local)"
else
    [ -z "$PINNED_TAG" ] || log "⚠️  tag pinné ($PINNED_TAG) introuvable — repli sur le plus récent"
    PREVIEW_TAG=$(gh release list --repo "$REPO" --limit 100 --json tagName,isPrerelease,publishedAt \
        --jq '[.[] | select(.isPrerelease == true)] | sort_by(.publishedAt) | last | .tagName' 2>/dev/null)
    log "preview courant : $PREVIEW_TAG (prerelease la plus récente)"
fi
[ -n "$PREVIEW_TAG" ] && [ "$PREVIEW_TAG" != "null" ] || gate "aucune release prerelease sur $REPO"

KEEP="$LATEST_TAG $PREVIEW_TAG"
log "garde : $LATEST_TAG (Latest) + $PREVIEW_TAG (preview)"

# --- 2. Purge ---------------------------------------------------------------
DELETED=0
for tag in $(gh release list --repo "$REPO" --limit 100 --json tagName --jq '.[].tagName' 2>/dev/null); do
    if [[ " $KEEP " != *" $tag "* ]]; then
        if [ "$DRY_RUN" -eq 1 ]; then
            log "[dry-run] supprimerait : $tag"
        else
            log "suppression : $tag"
            gh release delete "$tag" --repo "$REPO" --cleanup-tag --yes
            DELETED=$((DELETED + 1))
        fi
    fi
done

if [ "$DRY_RUN" -eq 1 ]; then
    log "dry-run terminé — rien supprimé"
    exit 0
fi

# --- 3. Vérification des liens d'auto-update --------------------------------
log "vérification des 4 liens d'auto-update"
check_link() { # $1 = url
    local code
    code=$(curl --noproxy "*" -s -o /dev/null -w "%{http_code}" -L --max-time 15 "$1")
    echo "[prune] $code  ${1##*/}"
    [ "$code" = "200" ] || gate "$1 → HTTP $code"
}

check_link "https://github.com/$REPO/releases/latest/download/better-xcloud.user.js"
check_link "https://github.com/$REPO/releases/latest/download/better-xcloud.meta.js"
check_link "https://github.com/$REPO/releases/download/$PREVIEW_TAG/better-xcloud-preview.user.js"
check_link "https://github.com/$REPO/releases/download/$PREVIEW_TAG/better-xcloud-preview.meta.js"

log "OK : $DELETED release(s) purgée(s), $(echo "$KEEP" | wc -w) conservée(s), 4/4 liens 200"
