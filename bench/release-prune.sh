#!/usr/bin/env bash
# ============================================================================
# bench/release-prune.sh — Politique de rétention des releases
#
# Garde  : la release stable marquée Latest + le dernier preview (le plus
#          récent par VERSION — jamais publishedAt : une release recréée depuis
#          git reprend une date récente et tromperait le tri), plus le tag pinné
#          par le @updateURL du build local s'il n'est pas déjà le dernier
#          (source de vérité — ne jamais purger l'ancre d'auto-update).
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

REPO="Endymi0n74/EvenBetter-Xcloud"
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

# Le preview conservé = le plus récent par VERSION COMPLÈTE (tri semver sur
# la version de base PUIS le numéro de preview — preview9 < preview10, et
# 1.13.1-preview2 > 1.8.0-preview4 : trier seulement previewN tromperait,
# « 4 » > « 2 »). Jamais publishedAt.
PREVIEWS=$(gh release list --repo "$REPO" --limit 100 --json tagName,isPrerelease \
    --jq '[.[] | select(.isPrerelease == true) | {tag: .tagName, m: (.tagName | capture("(?<base>[0-9]+\\.[0-9]+\\.[0-9]+).*preview(?<n>[0-9]+)$")?)} | {tag: .tag, base: ((.m.base // "0.0.0") | split(".") | map(tonumber)), n: ((.m.n // "0") | tonumber)}] | sort_by([.base[0], .base[1], .base[2], .n]) | reverse | .[:1] | .[].tag' 2>/dev/null)
[ -n "$PREVIEWS" ] || gate "aucune release prerelease sur $REPO"
# gh sort les tags par newline — normaliser en espaces pour les tests de présence
PREVIEWS=$(echo "$PREVIEWS" | tr '\n' ' ' | sed 's/  */ /g; s/^ //; s/ $//')

# + le tag pinné par le @updateURL du build local (source de vérité) s'il n'est pas déjà le dernier
PINNED_TAG=""
if [ -f better-xcloud-preview.user.js ]; then
    PINNED_TAG=$(grep -o 'releases/download/[^/]*' better-xcloud-preview.user.js | head -1 | cut -d/ -f3)
    if [ -n "$PINNED_TAG" ] && ! gh release view "$PINNED_TAG" --repo "$REPO" >/dev/null 2>&1; then
        log "⚠️  tag pinné ($PINNED_TAG) introuvable — ignoré"
        PINNED_TAG=""
    fi
    if [ -n "$PINNED_TAG" ] && [[ " $PREVIEWS " != *" $PINNED_TAG "* ]]; then
        log "⚠️  tag pinné par le build ($PINNED_TAG) plus récent que le dernier preview — conservé en plus"
        PREVIEWS="$PREVIEWS $PINNED_TAG"
    fi
fi

# Preview courant (vérification des liens) = tag pinné, sinon le plus récent des 2
PREVIEW_CURRENT="$PINNED_TAG"
[ -n "$PREVIEW_CURRENT" ] || PREVIEW_CURRENT=$(echo "$PREVIEWS" | awk '{print $1}')

KEEP="$LATEST_TAG $PREVIEWS"
log "garde : $LATEST_TAG (Latest) + $PREVIEWS (dernier preview)"

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
check_link "https://github.com/$REPO/releases/download/$PREVIEW_CURRENT/better-xcloud-preview.user.js"
check_link "https://github.com/$REPO/releases/download/$PREVIEW_CURRENT/better-xcloud-preview.meta.js"

log "OK : $DELETED release(s) purgée(s), $(echo "$KEEP" | wc -w) conservée(s), 4/4 liens 200"
