# Programme PR upstream — proposer les optimisations à redphx/better-xcloud

But : porter les optimisations du fork (patches/) vers la **source** du repo
amont `redphx/better-xcloud` (branche `typescript`, baseline 6.7.12) via des
**PR petites et mesurées** — une par optimisation, jamais « tout d'un coup ».

## Environnement

- Clone de travail : `D:\Codex\EvenBetterXcloud\better-xcloud-upstream` (remote `origin` = redphx,
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
| 7 | streamstats hidden throttle | 08 | 59/60 des getStats() supprimés en arrière-plan | ✅ **PR #998 ouverte** (commit `0c22be3`, `stream-stats.ts` seul +45/−21 — `INTERVAL_BACKGROUND` existait déjà dans le collector amont, inutilisé ; `_cachedColors` du bundle fork NON porté, hors sujet #7) |
| 8 | controller skip idle | 12 | zéro allocation au repos | ✅ **PR #999 ouverte** (commit `311a31f`, `controller-customization.ts` seul +141/−117 — garde `anyInput` : 327 ns → 34 ns par poll IDLE (×9,5), corps citant l'issue #991) |
| 9 | structuredClone → référence | 15 | zéro allocation relâchement | ✅ **PR #1000 ouverte** (commit `74556a9`, `poll-gamepad.ts` seul +5/−1 — le clone défensif retiré : état jamais muté entre lecture et `=null`, 1236 → 280 ns (−77 %), corps citant l'issue #991) |
| 10 | settings Set + validateValue | 02/03 | lookups O(1) | ✅ **PR #1002 ouverte** (commit `19122a1`, 3 fichiers : `pref-keys.ts` + `pref-utils.ts` + `base-settings-storage.ts`, corps avec near-miss pref-keys.ts ↔ #908) |
| 11 | checkForUpdate throttle 2 h | 05 | 1 fetch/2 h max (API GitHub) | ✅ **PR #1003 ouverte** (commit `071bde7`, `utils.ts` seul — le fetch passe APRÈS le garde 2 h ; la baseline amont avait le garde mais fetchait quand même) |
| 12 | BxSelect observer délégué + debugger | 06/10 | un seul MutationObserver | ✅ **PR #1004 ouverte** (commit `b6b49ac`, 2 fichiers : `bx-select.ts` observer global délégué + `translation.ts` debugger retiré, corps avec near-miss translation.ts ↔ #908/#938/#468) |
| 13 | fix share-delete | 11 | bug fix | ✅ **PR #1001 ouverte** (commit `2eaa2ac`, `controller-customization.ts` seul +6/−2 — `delete mapping['Share']` retiré : `mapping` est une référence live vers les settings stockés, le delete détruisait la config Share de l'utilisateur au premier press) |
| 13b | opacity cache fix | 07 | bug fix | **annulé — no-op amont** : `_cachedOpacity`/`_cachedTextSize` n'ont **jamais existé** dans l'historique amont (`git log -S` vide) — le cache était un ajout du fork, retiré par son propre patch 07 ; `refreshStyles()` amont lit déjà `getStreamPref` directement. Rien à porter (comme #4/#11) |
| 14 | data usage presets (maxBitrate + resolution) | — | cap 10 Mbps → 6,6 Mbps réels (1440p conservé) ; 720p → 1280×720 réel | ✅ **PR #1006 ouverte** (commit `77c1fcf`, 2 fichiers : settings-dialog.ts + translation.ts — feature v1.11.0 du fork « 📊 Données ») |
| 15 | test latence serveur (ping gssv 19 régions) | — | ⭐ CSE 30 ms vs UKS défaut 43 ms en réel ; NATIVE_FETCH + `?probe=1` (mesure pure, hors interception) | ✅ **PR #1007 ouverte** (commit `071ff73`, 3 fichiers : latency-test.ts + settings-dialog.ts + translation.ts — feature v1.10.0 du fork « 📡 Latence serveur ») |

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
| #998 | streamstats hidden throttle | OPEN, mergeable, 1 commit — ouvert le 17 août ~23:25, aucun retour | idem |
| #999 | controller skip idle | OPEN, mergeable, 1 commit — ouvert le 17 août ~23:40, aucun retour | idem |
| #1000 | structuredClone → référence | OPEN, mergeable, 1 commit — ouvert le 17 août ~23:55, aucun retour | idem |
| #1001 | fix share-delete | OPEN, mergeable, 1 commit — ouvert le 18 août ~00:20, aucun retour | idem |
| #1002 | settings Set + validateValue | OPEN, mergeable, 1 commit — ouvert le 18 août ~00:35, aucun retour | idem |
| #1003 | checkForUpdate throttle | OPEN, mergeable, 1 commit — ouvert le 18 août ~00:35, aucun retour | idem |
| #1004 | BxSelect observer délégué | OPEN, mergeable, 1 commit — ouvert le 18 août ~00:35, aucun retour | idem |
| #1005 | fix #991 (garde `buttons?.[16]`) | OPEN, mergeable, 1 commit — ouvert le 18 août ~00:50, **lié sur l'issue #991** (commentaire pour le rapporteur), aucun retour | idem |
| #1006 | data usage presets | OPEN, mergeable, 1 commit — ouvert le 19 août ~14:20, aucun retour | idem |
| #1007 | server latency test (gssv ping) | OPEN, mergeable, 1 commit — ouvert le 19 août ~14:20, aucun retour | idem |

## Branches poussées + PR ouvertes — data presets + latence serveur (19 août)

Les deux features récentes du fork ont été poussées sur le fork
(`feat/data-presets` `77c1fcf`, `feat/latency-test` `071ff73`) et **ouvertes** :
- **PR #1006** data usage presets — `gh pr create -R redphx/better-xcloud -B typescript -H Endymi0n74:feat/data-presets`
- **PR #1007** server latency test — `-H Endymi0n74:feat/latency-test`
Les deux : MERGEABLE, 1 commit, build amont exit 0, feature présente dans le
bundle. Queue upstream complète : **15 PR ouvertes** (993-1007). Rappel
mainteneur prévu ~24 août.

Fix #991 (garde crash) : les objets Gamepad ne garantissent pas un tableau
`buttons` à chaque poll (GameSir G7 SE) — `buttons[16]` levait une exception
qui tuait la boucle de polling entière (input mort jusqu'au reload). Le
`?.` fait du bloc raccourcis un no-op pour ces gamepads ; la livraison
d'input continue. Corps de PR + commentaire issue #991 (lien #991 ↔ #1005).

## Couverture par d'autres contributeurs (vérifié le 17 août ~23:40)

Scan des PR ouvertes (fichiers) + issues ouvertes du repo amont — **aucun
chevauchement de sujet sur la queue**, deux signaux à suivre :

| Élément | Verdict |
|---|---|
| Queue #7 (streamstats) | déjà envoyée (#998) — **personne d'autre ne couvre le sujet** (aucune PR ouverte touche `stream-stats.ts` hors la nôtre) |
| Queue #10 (pref-keys Set) | **vierge** — aucune PR ne touche `pref-keys.ts`/`pref-utils.ts`/`base-settings-storage.ts` |
| Queue #11 (checkForUpdate) | **vierge** — rien sur le sujet (le throttle 2 h n'est dans aucune PR ouverte) |
| Queue #12 (bx-select) | **vierge** — aucune PR ne touche `bx-select.ts` |
| Queue #8-9 (controller) | ⚠️ **PR #938** (`claude/add-local-coop-controllers`, autre contributeur) touche `gamepad.ts` + `controller-extra.ts` — même domaine mais **fichiers différents** (`controller-customization.ts` pour nous) et sujet différent (slot co-op vs perf). Pas de conflit de merge direct — à mentionner quand on enverra #8-9 |
| **Issue #991** (15 août, fraîche) | 🚨 **`pollGamepad` crash `Cannot read properties of undefined (reading 'pressed')`** (GameSir G7 SE, chrome 151) — la zone exacte de nos patches **#8 (skip idle) et #9 (structuredClone→référence)** qui touchent `poll_gamepad_default`. Nos patches sont de la perf, PAS un fix de crash → ne pas mélanger. Décision : au moment d'envoyer #8-9, citer l'issue dans le corps (contexte = la fonction est sous pression) et proposer le garde `currentGamepad.buttons?.[16]` comme **PR fix séparée** (style patch 11 qui a déjà mis `?.` sur `buttons[17]`) |
| Issues features (settings/controller) | #934 Settings Profiles, #581 remap guide, #160 sensitivity… — **toutes des features**, aucune ne couvre nos optimisations |

### Vérification approfondie anti-doublon (#8-12, scan complet le 17 août ~23:45)

| Méthode | Portée | Résultat |
|---|---|---|
| PR par **fichiers** (open + closed) | ~500 PR scannées, cibles `controller-customization.ts`, `poll_gamepad`, `pref-keys.ts`, `pref-utils.ts`, `base-settings-storage.ts`, `bx-select.ts`, `translation.ts`, `utils.ts` | **0 hit** — aucun contributeur n'a jamais touché ces fichiers en PR |
| PR par **titre** (12 mots-clés : pollGamepad, structuredClone, checkForUpdate, idle, bx-select, validateValue…) | open + closed | **1 seul hit** : #21 « Add Check for update feature » (**MERGED**, l'origine du feature) — c'est ce qu'on optimise, pas un doublon |
| Issues par **titre** (11 mots-clés) | open + closed | **1 seul hit** : #991 pollGamepad crash (déjà documenté, notre PR fix séparée proposée) |

**Verdict** : #8-9 (controller) et #10-12 (settings/ui) sont **exclusifs au fork** —
rien à retirer de la queue, aucun conflit de sujet avec l'amont. Le seul
ancêtre commun est #21 (checkForUpdate), déjà mergé depuis longtemps ; notre
#11 est une optimisation de ce feature, pas une copie.

### Vérification de conflits avec les PR ouvertes des autres contributeurs
(18 août ~00:05)

5 PR ouvertes hors les nôtres (#468, #851, #908, #938, #988) — croisement
**bidirectionnel** des fichiers (`f===of || f.includes(of) || of.includes(f)`)
avec les fichiers réels de nos 8 PR (récupérés via l'API) :

| PR autre | Fichiers | Overlap avec nos 8 PR |
|---|---|---|
| #468 Record | screenshot.ts, translation.ts, game-bar… | **aucun** (nos 8 ne touchent pas ces fichiers) |
| #851 touch-layout json | a-plague-tale-requiem.json | **aucun** |
| #908 mkb zoom | pref-keys.ts, settings-dialog.ts, translation.ts, stream-settings-storage.ts | **aucun** sur les 8 ouvertes |
| #938 co-op controllers | gamepad.ts, controller-extra.ts, local-co-op-enable.ts, translation.ts… | **aucun** (fichiers différents de controller-customization/poll-gamepad) |
| #988 touch-layouts Halo | touch-layouts/*.json | **aucun** |

**Verdict : aucun conflit possible** — zéro fichier partagé entre nos 8 PR
(#993-1000) et les 5 PR ouvertes des autres contributeurs ; le test de merge
(lignes) est trivialement vide puisqu'aucun fichier commun n'existe.

⚠️ **Near-misses pour la queue non ouverte** : #10 (branche prête
`feat/settings-set-prefs`) touche `pref-keys.ts`, fichier aussi modifié par
**#908** (ouverte depuis mars, stale) ; #12 (`feat/bxselect-delegated-observer`)
touche `translation.ts`, aussi dans #908/#938/#468. Au moment d'ouvrir
#10-12 : le mentionner dans le corps et être prêt à rebaser si l'une de ces
PR merge d'abord (probabilité faible — #908 attend depuis mars, #468 depuis
2024).

## Rappel mainteneur (timing)

**Aucun retour au 18 août ~00:50** sur les 13 PR (0 commentaire mainteneur,
0 review — seul notre commentaire sur l'issue #991). Le mainteneur répond
en **semaines/mois** — voir `upstream-prs/reminder.md` (#468 attend depuis
juillet 2024, #851 depuis décembre 2025, dernier commit typescript : 14
juillet). **Ne pas pinger avant le 24 août** ; le commentaire groupé prêt
(sur #993, référence les 13) est dans `upstream-prs/reminder.md`.

Style observé du mainteneur : **« thank you. I'll take a look later. »** (PR
#908, 24 mars) puis silence de plusieurs mois ; la plupart de ses merges
récentes (avril-juin) sont des PR de custom touch controls (json/ids), la
dernière merge = #959 le 20 juin. Aucun commit sur `typescript` depuis le
14 juillet (bump 6.7.12). Ne pas insister : répondre si interrogé, sinon
laisser le rappel du 24 août faire le travail.

## Réponses préparées (si le mainteneur interroge)

**PR #993 — codecProfile lazy**

- **Pourquoi lire la valeur brute dans `STORAGE.Global.settings` au lieu de
  `getGlobalPref()` ?** `getGlobalPref(STREAM_CODEC_PROFILE)` déclenche
  `validateValue` → l'accesseur `options` (désormais paresseux) →
  `getSupportedCodecProfiles()` → `RTCRtpReceiver.getCapabilities()` = init
  de la pile WebRTC (~600 ms one-shot à froid). La valeur stockée brute vaut
  `'default'` sauf si l'utilisateur a configuré le réglage. Dans
  `patchRtcCodecs`, `'default'` court-circuite (retour immédiat). Dans
  `patchRtcPeerConnection`, un profil configuré implique qu'une session
  démarre → l'init WebRTC est de toute façon inévitable juste après ; la
  lecture brute n'enlève aucun coût utile.
- **`ready()` n'est plus un vrai `ready` : les getters sont-ils
  équivalents ?** Oui — `unsupported`, `unsupportedNote` et `suggest`
  reprennent exactement la logique d'origine (`keys.length <= 1` →
  unsupported ; `lowest`/`highest` identiques), calculés au premier accès.
  La valeur rendue à l'UI est bit pour bit la même ; seul le moment du
  calcul change.
- **La mémoïsation est-elle sûre ?** Oui : `getSupportedCodecProfiles()`
  était déjà évalué une seule fois (l'`options` était un objet calculé à
  l'init du module). Le cache reproduit cette sémantique — le support
  WebRTC d'un navigateur est constant pendant la session. Cas sans
  `getCapabilities` (Firefox, anciens) : retour `{ default }`, également mis
  en cache.
- **Le coût one-shot a-t-il disparu ou seulement bougé ?** Il est **différé,
  pas supprimé** : payé à la première ouverture des settings (rendu du
  select) ou à la première validation — jamais au démarrage. Et si une
  session démarre avant, l'init WebRTC est fait pour la session : le getter
  ne coûte plus rien (memo).
- **Preuves ?** Profil CDP du démarrage (navigateur neuf, 20 runs) : avant —
  `getSupportedCodecProfiles` dominante à 19,7 ms (78 % du temps JS) ;
  après — aucune fonction JS dominante, 76,8 % natif/GC. Build amont OK
  (gate eslint+TS, exit 0).

**PR #994-#997 — webgl2 (USM, dirty flag, texStorage, viewport/NoColor)**

- **Pourquoi plusieurs PR sur le même fichier ?** Chacune est un sujet isolé
  et indépendant (shader / uniforms / storage / viewport) ; elles
  s'empilent proprement, chaque diff est lisible seul. Si tu préfères une
  seule PR, dis-le — je les rebase en une série de commits.
- **Comment les mesures sont-elles faites ?** Harnais rejouables sur un
  vrai contexte WebGL2 (Edge/ANGLE, compteurs d'appels GL + GPU
  timestamps), comparaison perf10 (baseline) vs build, médiane sur 3 passes
  × seeds ; l'équivalence visuelle du shader USM est vérifiée pixel à pixel
  (diff sur vidéo de texte fin, maxAbs 0 à sharpness identique).
- **Le dirty flag et le cache uniforms (v1.5.0) se concurrencent-ils ?**
  Non : le flag dirty (#995) remplace le cache de valeurs (compare 8 champs
  par frame) par une lecture + branche — strictement supérieur ; c'est
  l'état final du build v1.8.0 du fork.
- **Pourquoi `gl.RGB8` et pas `gl.RGB` dans texStorage (#996) ?** `gl.RGB`
  est un format non-sized : `texStorage2D` le rejette (INVALID_ENUM) →
  storage jamais alloué → les uploads échouent → renderer noir.
  `texSubImage2D` garde `gl.RGB` côté upload ; seul le storage est `RGB8`.

**PR #998 — streamstats hidden throttle**

- **Pourquoi `setTimeout` auto-réarmé plutôt que `setInterval` ?** Pour
  réévaluer `document.hidden` à chaque tick (l'intervalle n'est pas figé au
  `start`) et garantir qu'un `collect()` async ne se chevauche pas (guard
  `isUpdating`). La constante `INTERVAL_BACKGROUND` existait déjà dans
  `StreamStatsCollector`, inutilisée — aucun comportement visible quand
  l'onglet est au premier plan.

## Conventions pour chaque PR

- Branche `feat/<sujet>` depuis `typescript`, **un seul sujet par PR**.
- Ne committer QUE les fichiers du sujet (le working tree contient du
  pré-existant d'autres sujets — `git add` sélectif).
- Vérifier : `bun build.ts --version 6.7.12 --variant full` (gate eslint+TS,
  exit 0) avant push.
- Corps de PR : quoi / pourquoi c'est sûr / mesure (les benchs du fork).
- Base : `redphx/better-xcloud:typescript`. Head : `Endymi0n74:feat/...`.
- Attendre le retour du mainteneur avant d'ouvrir la suivante.
