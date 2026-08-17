# Programme PR upstream — proposer les optimisations à redphx/better-xcloud

But : porter les optimisations du fork (patches/) vers la **source** du repo
amont `redphx/better-xcloud` (branche `typescript`, baseline 6.7.12) via des
**PR petites et mesurées** — une par optimisation, jamais « tout d'un coup ».

## Environnement

- Clone de travail : `D:\Codex\better-xcloud-upstream` (remote `origin` = redphx,
  remote `mine` = fork `Endymi0n74/better-xcloud`).
- Le repo amont est **source-based** (src/, build via `bun build.ts
  --version 6.7.12 --variant full [--pretty|--meta]` — bun 1.3.14 requis,
  `bun install` fait). `dist/` est tracké mais régénéré par le build.
- ⚠️ Le working tree du clone contient des **fichiers sources pré-existants
  (15 août)** d'une session précédente : un portage partiel NON commité de
  plusieurs patches (webgl2-player.ts dirty flag patch 20, bx-flags patch 17,
  controller-customization patches 11/12/15, poll-gamepad, touch-controller,
  types/index.d.ts, dist/ modifiés/supprimés). C'est très probablement le
  « trop d'un coup » reproché. **Ne pas committer en bloc** : à éclater par PR
  (un fichier/une zone par PR).

## Mapping bundle → source

| Patch fork | Zone | Fichier(s) source amont |
|---|---|---|
| 21 codecProfile lazy | settings/rtc | `src/utils/settings-storages/global-settings-storage.ts`, `src/utils/monkey-patches.ts` |
| 13-20, 22 webgl2 | render | `src/modules/player/webgl2/webgl2-player.ts` (+ shader) |
| 17 DEFAULT_FLAGS | render | `src/utils/bx-flags.ts` |
| 07-09 streamstats | stats | `src/modules/stream/stream-stats.ts` |
| 02-05 settings | settings | `src/utils/settings-storages/*.ts` |
| 06, 10 ui | ui | `src/modules/ui/*` |
| 11, 12, 15 controller | controller | `src/modules/patcher/patches/src/controller-customization.ts` |

## Queue de PR (une à la fois — attendre le retour avant la suivante)

| # | Sujet | Patch | Mesure | État |
|---|---|---|---|---|
| 1 | codecProfile lazy (WebRTC init différé) | 21 | ~600 ms one-shot cold startup, 19,7 ms dominant profil | ✅ **PR #993 ouverte** (commits `bd63e92`) |
| 2 | USM 4 taps shader | 22 | draw −30 % (10,24→7,17 µs), visual-diff | ✅ **PR #994 ouverte** (commit `81d5ffc`, `clarity-boost.fs` seul) |
| 3 | updateCanvas dirty flag | 20 | ×19,4 (jusqu'à ×22 avec le cache uniforms) | ✅ **PR #995 ouverte** (commit `6a2a9ed`, `webgl2-player.ts` seul — le portage pré-existant texStorage/viewport/NoColorConversion a été **sauvegardé** dans `upstream-prs/.work/webgl2-player-full-port.ts` et restauré dans le working tree pour les PR 5/6) |
| 4 | updateCanvas uniform cache | 19 | ×22 (état v1.5.0) | **obsolète — subsumé par le dirty flag #995** (le cache de valeurs compare 8 champs par frame ; le flag dirty ne fait qu'une lecture + branche, strictement supérieur ; dans le build v1.8.0 le flag a remplacé le cache) |
| 5 | texStorage/RGB8/bindTexture | 13/18/16 | upload ×5,5, wall ×2,8 + fix renderer noir | ✅ **PR #996 ouverte** (commit `dacc024`, `webgl2-player.ts` seul — dirty flag exclu, déjà #995) |
| 6 | viewport fix + NoColorConversion | 14/17 | fixes | ✅ **PR #997 ouverte** (commit `c97c334`, 3 fichiers : `webgl2-player.ts` +7/−1, `bx-flags.ts` +1, `types/index.d.ts` +1 — le flag `WebGL2NoColorConversion` n'existait pas côté amont, ajouté opt-in désactivé) |
| 7 | streamstats hidden throttle | 08 | throttle document.hidden | à faire |
| 8 | controller skip idle | 12 | zéro allocation au repos | partiel (controller-customization 15 août) |
| 9 | structuredClone → référence | 15 | zéro allocation relâchement | à faire |
| 10 | settings Set + validateValue | 02/03 | lookups O(1) | à faire |
| 11 | checkForUpdate throttle 2 h | 05 | 1 fetch/jour max | à faire |
| 12 | BxSelect observer délégué + debugger | 06/10 | un seul MutationObserver | à faire |
| 13 | fixes (share-delete, opacity cache) | 11/07 | bug fixes | à faire |

**À NE PAS proposer** : patch 01 (header/version fork), patch 09 (single-pass
collect — mesuré ~7 % réaliste, négatif à 500 entrées), portage preview
(T1-T9, P2/P3 — client Microsoft, pas le repo redphx).

## États des PR (suivi)

| PR | Sujet | État au 17 août 22:30 | CI amont |
|---|---|---|---|
| #993 | codecProfile lazy | OPEN, mergeable, 1 commit — **aucun retour mainteneur** (pas de commentaire/review) | aucun (repo amont : seul `stale.yaml`, revue manuelle) |
| #994 | USM 4 taps | OPEN, mergeable, 1 commit — ouvert le 17 août, aucun retour | idem |
| #995 | updateCanvas dirty flag | OPEN, mergeable, 1 commit — ouvert le 17 août, aucun retour | idem |
| #996 | texStorage2D/RGB8 + bindTexture | OPEN, mergeable, 1 commit — ouvert le 17 août, aucun retour | idem |
| #997 | viewport fix + NoColorConversion | OPEN, mergeable, 1 commit — ouvert le 17 août ~23:20, aucun retour | idem |

## Rappel mainteneur (timing)

**Aucun retour au 17 août ~23:20** sur les 5 PR (0 commentaire, 0 review).
Le mainteneur répond en **semaines/mois** — voir `upstream-prs/reminder.md`
(#468 attend depuis juillet 2024, #851 depuis décembre 2025, dernier commit
typescript : 14 juillet). **Ne pas pinger avant le 24 août** ; le commentaire
groupé prêt (sur #993, référence les 5) est dans `upstream-prs/reminder.md`.

## Conventions pour chaque PR

- Branche `feat/<sujet>` depuis `typescript`, **un seul sujet par PR**.
- Ne committer QUE les fichiers du sujet (le working tree contient du
  pré-existant d'autres sujets — `git add` sélectif).
- Vérifier : `bun build.ts --version 6.7.12 --variant full` (gate eslint+TS,
  exit 0) avant push.
- Corps de PR : quoi / pourquoi c'est sûr / mesure (les benchs du fork).
- Base : `redphx/better-xcloud:typescript`. Head : `Endymi0n74:feat/...`.
- Attendre le retour du mainteneur avant d'ouvrir la suivante.
