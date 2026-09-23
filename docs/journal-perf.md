# Journal — mesures & verdicts perf

> **Archive — extrait de `bench/README.md` le 2026-09-23.** Journal daté,
> conservé pour l'historique : ne pas mettre à jour (les versions et liens
> cités sont ceux de l'époque). Verdicts de mesure (main thread, codecs, bitrate, baselines), dans l'ordre d'origine.

## Profil runtime en session réelle — VERDICT (18 août ~19:45, v1.9.0)

`node bench/live-profile.js --port=9225 --duration=15/20` sur un stream réel
(As Dusk Falls, www.xbox.com/play, build v1.9.0 injecté par extension
`.edge-inject-stable`, profil guard-badge connecté) :

| Run | Durée | JS total sur le main thread | Dominantes |
|---|---|---|---|
| 15 s | 15,9 s | ~3,5 ms (0,02 %) | fetch 2,0 ms · ls 1,5 ms |
| 20 s | 20,4 s | ~3,2 ms (0,02 %) | getGamepads 1,7 ms · Yt 1,5 ms |

**Verdict : le main thread JS du renderer est ~99,98 % inactif/natif pendant
un stream.** Aucune dominante JS exploitable : la charge réelle (décodage
vidéo, rendu WebGL2) vit dans les process natifs/GPU, invisibles au CDP
Profiler du renderer. Le script EvenBetterXcloud (updateFrame/updateCanvas/
draw ~0,2 µs/frame) est sous le seuil d'échantillonnage — **la queue
d'optimisations JS du stable est au plancher, il n'y a plus de gain
mesurable côté script**. Le seul item JS visible est le polling
`navigator.getGamepads` (client xcloud + script, ~0,1 ms/s) — déjà couvert
par les PR upstream #999/#1000 et le hot loop bench (137 ns).

⚠️ Caveat rendu corrigé (18 août ~21:00) : le run initial était en onglet
**arrière-plan** (86 % de frames dropped, downscale 1440p→720p). En relançant
avec la fenêtre au premier plan (cycle minimiser→restaurer via
`Browser.setWindowBounds` → `visibilityState:visible`, cf. plus bas) :
**599 frames reçues sur 20 s, 0 dropped (0,00 %), 29,9 fps effectifs** — le
rendu est propre, sans throttle. live-profile au premier plan : 99,3 %
natif/inactif (même verdict JS), les callbacks du SDK tournent réellement
(scheduleTimer 2,7 ms · requestVideoFrameCallback 2,6 ms · calculateChanges
1,9 ms sur 15 s) — toujours négligeable. **Verdict rendu : 0 drop à 1440p30
quand l'onglet est visible** — le rendu natif ne dégrade rien.

⚠️ Opérationnel pour les futures sessions CDP : (1) les clics
`Input.dispatchMouseEvent` peuvent être interceptés par la page (banner
z-999) — utiliser `element.click()` en JS ; (2) un onglet CDP reste
`visibilityState:hidden` même après `Page.bringToFront` si la fenêtre OS est
occluse — le **cycle minimiser→restaurer** (`Browser.setWindowBounds`
`minimized` puis `normal`) force le premier plan et libère le rendu.

## Hors main thread — leviers réseau/décodage mesurés (18 août ~20:15, v1.9.0)

Session stable réelle (As Dusk Falls, www.xbox.com/play, onglet au premier
plan) : lecture de la config d'input effective (`window.BX_EXPOSED.inputChannel.
configuration`) + doubles échantillons `getStats` (deltas sur timestamps RTP,
10 s) :

| Métrique | Valeur mesurée | Scriptable ? |
|---|---|---|
| Main thread JS (live-profile) | **~0,02 %** du temps (3,2 ms/20 s) | plancher |
| getGamepads polling | ~85 µs/s (0,0085 %), ~0,34 µs/appel | knob `controller.pollingRate` (déjà scripté) |
| Décodage vidéo | **0,50 ms/frame** (16,2 ms/s) — H.264 High 2560×1440@30 | NON (media stack natif) |
| Bitrate réseau | **~24,8 Mbps** (1440p30) | cap via `stream.video.maxBitrate` → patch SDP `b=AS:` (mécanisme vérifié dans le bundle) |
| RTT / pertes | 22 ms · 0 paquet perdu · 0 frame dropped | non pertinent |
| **Config input effective** | `useIntervalWorkerThreadForInput:true` · `enableVibration:true` · `useUnreliableInput:true` · `enableClientRenderedCursor:true` | **déjà tous actifs par défaut** |

**Inventaire des leviers réseau/décodage du client stable (tous déjà scriptés
par upstream, mécanismes vérifiés dans le bundle) :** `stream.video.maxBitrate`
(SDP `b=AS:`), `stream.video.codecProfile` (`RTCRtpTransceiver.setCodecPreferences`
+ patch SDP), `stream.video.resolution`, `stream.video.preventResolutionDrops`
(patchStreamMetadata), `video.maxFps`, `video.player.powerPreference`,
`video.player.type` (renderer), `server.bypassRestriction`/`server.region`
(routage), `stream.video.combineAudio` (streamCombineSources patch),
`controller.pollingRate` (boucle pollGamepads).

**Verdict : rien à optimiser côté script hors main thread.** Contrairement au
preview (où la fusion P2 des overrides apportait `useIntervalWorkerThreadForInput`
et `enableVibration`), le client stable les a **nativement activés** — la
config d'input effective le prouve en session réelle. Le polling getGamepads
est le seul item JS visible et son gain potentiel (~0,007 % du temps) est
sous le bruit. Le décodage (0,50 ms/frame) est natif. Les seuls leviers
restants (bitrate/résolution/FPS) sont des **préférences utilisateur**, pas
des optimisations — leurs mécanismes (patch SDP, codec prefs) fonctionnent
déjà. Axe infra restant, hors script : **AV1** (non utilisé sur ce setup —
H.264 High) via `stream.video.codecProfile` si le navigateur le supporte.

## A/B codec AV1 vs H.264 — verdict : backend xCloud encode H.264 uniquement (18 août ~23:00, v1.10.0)

Son **AV1 sur le client stable** : le navigateur le supporte parfaitement,
mais le serveur ne peut pas l'encoder — l'A/B mesuré le prouve.

### 1. Support navigateur (Edge 152, `bench/av1-probe.js`)

| Sonde | Résultat |
|---|---|
| `RTCRtpReceiver.getCapabilities("video")` | **`video/AV1` présent** (avec VP8/VP9/H264) |
| MediaCapabilities AV1 1080p60 file | `supported:true` · `powerEfficient:true` |
| MediaCapabilities AV1 1440p60 file | `supported:true` · `powerEfficient:true` |
| MediaCapabilities AV1 webrtc (recevoir) | `supported:true` · `powerEfficient:true` |
| `getSupportedCodecProfiles()` (bundle) | **n'expose que H.264** low/normal/high — AV1 jamais proposé dans le setting |

**Liste RTP complète observée** (`RTCRtpReceiver.getCapabilities("video")`,
Edge 152 — identique côté preview) :

```
video/VP8 · video/rtx · video/VP9 (profile 0/1/2/3) · video/H264 (×9) ·
video/AV1 (×2) · video/red · video/ulpfec · video/flexfec-03
```

➡️ **Pas de HEVC (H.265)** dans la pile WebRTC — ni offert, ni négociable.
H.264 est le seul codec que le serveur retient (AV1/VP9 présents dans l'offre,
absents de la réponse).

### 2. A/B mesuré sur un stream réel (As Dusk Falls, 20 s, premier plan)

| Métrique | Run A (défaut) | Run B (offre AV1 forcée) |
|---|---|---|
| Codec négocié | **video/H264** | **video/H264** (le serveur ignore AV1) |
| Résolution | 2560×1440@30 | 2560×1440@30 |
| Bitrate | **24,2 Mbps** | **24,7 Mbps** |
| Décodage | 0,51 ms/frame | 0,46 ms/frame |
| Frames dropped | 0 | 0 |

### 3. Preuve SDP (`bench/sdp-inspect.js`)

Run B : l'**offre locale contient bien AV1** (payloads `AV1/90000` présents,
patch `setLocalDescription` installé — reorder AV1 en tête + neutralisation
`setCodecPreferences`) mais la **réponse serveur (`remoteDescription`) ne
liste QUE du H.264** — le backend a même retiré VP8/VP9 de la réponse.
L'encodeur xCloud côté serveur est **H.264 uniquement**.

**Verdict : AV1 est un cul-de-sac pour le stable (et le preview) — le goulot
est l'encodeur serveur, pas le client.** Pas d'option à ajouter au bundle ;
le setting `codecProfile` reste limité aux profils H.264 (comportement
correct). Harnais ajoutés : `bench/av1-probe.js` (support navigateur),
`bench/launch-game.js` (lancement jeu + `--av1` patch SDP),
`bench/stream-stats-capture.js` (stats getStats 20 s),
`bench/sdp-inspect.js` (SDP local/remote), `bench/page-probe.js` (sonde DOM),
`bench/kill-edge-profile.ps1` (fermeture propre d'un profil Edge).

## Effet réel des préférences utilisateur — maxBitrate + résolution mesurés (18 août ~23:30, v1.10.0)

Même jeu (As Dusk Falls), sessions de 15-20 s au premier plan, préférence
posée dans `localStorage["BetterXcloud"]` avant le lancement
(`bench/set-pref.js` — merge + reload + attente du bundle) :

| Config posée | Résolution effective | Bitrate reçu | Décodage | Drops |
|---|---|---|---|---|
| Défaut (`auto`, sans cap) | **2560×1440@30** | **24,2 Mbps** | 0,51 ms/f | 0 |
| `maxBitrate` 10 Mbps | 2560×1440@30 | **6,6 Mbps** | 0,42 ms/f | 0 |
| `maxBitrate` 5 Mbps | 2560×1440@30 | **4,7 Mbps** | 0,43 ms/f | 0 |
| `resolution` **720p** | **1280×720@30** | **6,4 Mbps** | 0,40 ms/f | 0 |
| `resolution` 1080p | 2560×1440@30 (**no-op**) | 24,4 Mbps | 0,48 ms/f | 0 |
| `resolution` 1080p-hq | 2560×1440@30 (**no-op**) | 20,6 Mbps | 0,51 ms/f | 0 |

### Mécanisme (vérifié dans `handlePlay` du bundle)

`XcloudInterceptor.handlePlay` applique la résolution par **spoof
`osName`** (le même mécanisme P3 qu'on a retiré du preview) :
`x-ms-device-info` + `body.settings.osName` selon
`getOsNameFromResolution()` — **`720p`→android**, **`1080p`→windows**,
**`1080p-hq`→tizen**.

- **720p fonctionne** : android → le serveur envoie 1280×720 (6,4 Mbps).
- **1080p = no-op sur PC** : windows = natif → le serveur garde 1440p.
- **1080p-hq = no-op sur PC** : tizen ignoré (cohérent avec l'A/B P3 du
  preview — osName=tizen ne change rien sur un client PC).

### Verdict — réglage recommandé

1. **`stream.video.maxBitrate` est fiable et sans perte de résolution** : le
   cap SDP `b=AS:` est honoré par l'encodeur (10 Mbps → 6,6 reçus, 5 Mbps →
   4,7). Recommandé pour économiser la bande passante tout en gardant la
   définition native : **cap 10-15 Mbps**.
2. **`resolution` 720p** : le seul réglage de résolution qui change
   réellement quelque chose sur PC (6,4 Mbps) — utile pour très faible débit.
3. **1080p / 1080p-hq trompeurs sur PC** : ils ne changent rien (toujours
   1440p natif). Ne pas les recommander.
4. Décodage constant (~0,4-0,5 ms/frame) dans tous les cas — le décodage
   n'est jamais le goulot, même à 1440p.

Caveat : bitrate variable selon le contenu (jeu à faible mouvement) — les
chiffres comparent le même jeu/scène, l'ordre de grandeur est fiable.
Harnais ajoutés : `bench/set-pref.js` (pose de préférence + reload).

## A/B profils H.264 — le setting fonctionne, le défaut est déjà le meilleur (18 août ~23:50, v1.10.0)

`stream.video.codecProfile` réordonne les profils H.264 dans l'offre SDP
(`patchRtcPeerConnection` → `setCodecPreferences`) — le serveur répond avec le
profil demandé. Prouvé en session réelle via le `profile-level-id` négocié
(lu dans le stat codec de `getStats`, ajouté au capture) :

| Setting | profile-level-id négocié | Profil réel | Bitrate (15-20 s) | Décodage | Drops |
|---|---|---|---|---|---|
| `default` | `4d001f` | **Constrained High** | 20,7 Mbps | 0,44 ms/f | 0 |
| `high` | `4d001f` | **Constrained High** | 10,4 Mbps | 0,39 ms/f | 0 |
| `normal` | `42e01f` | **Constrained Baseline** | 20,5 Mbps | 0,43 ms/f | 0 |
| `low` | `42001f` | **Baseline** | 20,5 Mbps | 0,45 ms/f | 0 |

Screenshots de preuve : `bench/.h264-high.png` / `bench/.h264-low.png`
(scènes différentes — pas comparables entre eux, preuve du run seulement).

### Verdict

1. **Le setting fonctionne** : le profil demandé est réellement négocié
   (4d / 42e / 420). Mécanisme vérifié de bout en bout.
2. **`default` == `high`** : le SDK négocie déjà Constrained High par défaut
   — mettre « high » ne change rien.
3. **`low` / `normal` ne font que dégrader** : Baseline/Constrained Baseline =
   pas de B-frames (CAVLC au lieu de CABAC) → compression moins efficace. Le
   serveur encode le même contenu moins bien ; théoriquement bitrate en hausse
   à qualité égale (ou qualité en baisse à bitrate égal).
4. **⚠️ Caveat bitrate** : les valeurs ci-dessus sont **confondues par le
   contenu** (As Dusk Falls avance — le run « high » a attrapé une scène
   statique à 10,4 Mbps). La NÉGOCIATION du profil est la preuve fiable ; les
   deltas de bitrate inter-runs ne sont pas comparables.
5. **Recommandation : laisser `codecProfile` à `default`** — c'est déjà le
   meilleur profil disponible. Les seuls leviers utiles restent
   `maxBitrate` (cap) et `resolution` 720p.

## Verdict codec preview (play.xbox.com) — même backend H.264-only (19 août ~00:05, v1.10.0-preview1)

Session preview réelle (Among Us, `bench/launch-preview-game.js` + `bench/preview-codec-probe.js`) :

- **Codec négocié : `video/H264` `4d001f` (Constrained High)** — **identique au
  stable**. Le backend Azure encode en H.264 Constrained High pour les deux
  clients.
- **AV1 proposé, ignoré** : l'offre locale contient AV1
  (`localSdpHasAV1:true`) mais la réponse serveur non (`remoteSdpHasAV1:false`)
  — même verdict que le stable. Pas de VP9 ni HEVC dans la réponse non plus.
- Liste RTP = la même pile navigateur (VP8/VP9×4/H264×9/AV1×2) — le
  navigateur est identique, seule la couche SDK diffère, et elle négocie le
  même H.264.
- Détail : 1440p @ **60 fps** sur Among Us (le fps dépend du jeu, pas du
  client — As Dusk Falls est en 30 fps).

**Conclusion codec (stable ET preview) : H.264 Constrained High par défaut,
rien d'autre proposé par le serveur. Le sujet codec est clos.**

## Re-baseline du 17 août (v1.8.0) — bornes confirmées

Run complet sur le build v1.8.0 (`better-xcloud.user.js`, 481 772 o — inchangé
depuis la baseline précédente : les commits preview4/T9/docs n'ont pas touché
le stable). `run-all.sh --skip-page-eval --skip-cold-getcap` +
`startup-profile.js --runs=5` :

| Harnais | perf10 | build | Lecture |
|---|---|---|---|
| Parse/compile | 0,117 ms | 0,112 ms | négligeable (écart dans le bruit inter-seed) |
| Hot loop controller IDLE | 327,4 ns | **34,4 ns** | ×9,5 — au plancher |
| poll_gamepad relâchement Home | 1 137,7 ns | **165,9 ns** | ×6,9 — au plancher |
| updateCanvas (chemin 60 Hz) | 243,3 ns | **15,6 ns** | ×15,6 (uniforms 1/2/4 appels vs 215k/430k/860k) |
| updateFrame | 167,6 ns | 165,2 ns | stable (texSubImage2D, alloc stable) |
| Startup CDP — perf10 | `getSupportedCodecProfiles` 19,1 ms (78 %) | — | dominante intacte (cible PR upstream #993) |
| Startup CDP — build | — | aucune fonction JS dominante, **76,8 % natif/GC** | plat |

Aucune régression mesurée : hot loops au plancher, startup plat, parse
négligeable. Les bornes CI (build plat, perf10 dominé par `getSupportedCodecProfiles`)
restent valides pour alerter si le startup régresse.

### Re-baseline du 18 août ~10:10 (post-harnais mobile, avant APK) — mêmes bornes

Harnais complet `run-all.sh` (sans `--cold-page-eval`) sur le build stable
courant (481 974 o, fixes document-start inclus) : **toutes les bornes CI
tiennent**, aucune régression depuis la séquence upstream.

| Harnais | perf10 | build | Verdict |
|---|---|---|---|
| Parse/compile | 0,103 ms | 0,104 ms | négligeable (sub-ms bruité) |
| Hot loop controller IDLE | 281,2 ns | 29,3 ns | ×9,6 [≥ 4] ✅ |
| poll_gamepad relâchement Home | 1 212,6 ns | 137,5 ns | ×8,8 [≥ 4] ✅ |
| updateCanvas (chemin 60 Hz) | 209,3 ns | 9,5 ns | ×22,0 [≥ 12] ✅ |
| updateFrame | 149,2 ns | 130,3 ns | stable [0,5–2] ✅ |
| Éval page (20 runs) | 20,0 ms méd | 17,3 ms méd (p95 28,4) | build plat, p95 ≪ borne 50 ms ✅ |
| Profil startup | one-shot codec 77,4 % | plat (76,8 % natif/GC) | différé intact ✅ |
| cold-getcap | 535,8 ms (one-shot) | eval 23,6 ms (Δ −95,6 %) | one-shot stable, 2e appel 0,1 ms ✅ |

Commandes exactes : `NODE_PATH=/d/Codex/koharu/node_modules bash bench/run-all.sh`
(Edge 152.0.4191.19 headless, profil D:\Codex\EvenBetterXcloud\edge-profiles).

### Re-baseline du 18 août ~01:00 (post-séquence upstream) — mêmes bornes

Harnais **complet** cette fois : `run-all.sh --cold-page-eval` (parse + hot
loops + éval page à froid + profil startup + cold-getcap), build stable
inchangé (481 772 o — la séquence de PR upstream n'a touché que le clone).
Verdict `check-ratios.js` : **PASS 6/6**.

| Harnais | perf10 | build | Verdict CI |
|---|---|---|---|
| Parse/compile | 0,123 ms | 0,110 ms | négligeable (sub-ms bruité) |
| Hot loop controller IDLE | 389,7 ns | 53,4 ns (30,2 au 2e run) | ×7,3–9,5 [≥ 4] ✅ |
| poll_gamepad relâchement Home | 1 448,6 ns | 168,2 ns | ×8,6 [≥ 4] ✅ |
| updateCanvas (chemin 60 Hz) | 268,8 ns | 12,6 ns | ×21,3 [≥ 12] ✅ + flag dirty (4 vs 860 004 uniform1f) |
| updateFrame | 187,7 ns | 181,8 ns | stable [0,5–2] ✅ |
| ACTIF / commun | — | — | 0,91–0,94 [0,5–2] ✅ |
| Éval page à froid (20 runs) | 630,8 ms | **24,6 ms** | build ≤ 50 ms ✅ · perf10 ∈ [300, 1200] ✅ (Δ −96,1 %) |
| Profil startup | `getSupportedCodecProfiles` 76,4 % | plat, 81,2 % natif/GC | one-shot différé intact |
| cold-getcap | 566,2 ms (one-shot) | eval 30,9 ms (Δ −94,7 %) | one-shot stable, 2e appel 0,1 ms |

### Re-validation du 19 août ~14:00 (post-réorganisation EvenBetterXcloud) — mêmes bornes ✅

Harnais **complet** `run-all.sh` (parse + hot loops + éval page 20 runs +
profil startup + cold-getcap) relancé depuis les nouveaux chemins
(`D:\Codex\EvenBetterXcloud\better-xcloud-fork`, workspace réorganisé) sur le
build stable v1.11.0 (487 269 o, feature « 📊 Données » incluse) vs perf10
(055d3a0). Verdict `check-ratios.js` : **PASS 6/6**. Aucune régression — la
réorganisation n'a rien cassé.

| Harnais | perf10 | build | Verdict CI |
|---|---|---|---|
| Parse/compile | 0,118 ms | 0,117 ms | négligeable (sub-ms bruité) |
| Hot loop controller IDLE | 378,4 ns | 40,7 ns | ×9,30 [≥ 4] ✅ (état haut) |
| poll_gamepad relâchement Home | 1 247,2 ns | 163,5 ns | ×7,63 [≥ 4] ✅ |
| updateCanvas (chemin 60 Hz) | 255,1 ns | 15,2 ns | ×16,78 [≥ 12] ✅ + flag dirty (4 vs 860 004 uniform1f) |
| updateFrame | 178,0 ns | 171,2 ns | stable [0,5–2] ✅ · ACTIF/commun 0,98–1,24 ✅ |
| Éval page (20 runs) | 29,9 ms méd (p95 640,4) | 26,1 ms méd (p95 36,9) | build ≤ 50 ms ✅ · écart médiane −12,7 % |
| Profil startup | `getSupportedCodecProfiles` 19,1 ms (75,7 %) | plat (71,9 % natif/GC) | one-shot différé intact ✅ |
| cold-getcap | 553,6 ms (one-shot) | eval 33,7 ms (Δ −94,0 %) | one-shot stable, 2e appel 0,1 ms ✅ |

### Re-baseline du 19 août ~15:30 (post-release v1.12.0 + feature région) — mêmes bornes ✅

`run-all.sh` complet (parse + hot loops + éval page + profil startup +
cold-getcap), build stable **v1.12.0** (489 673 o, feature « ⚡ Appliquer la
meilleure région » incluse) vs perf10 (055d3a0). Verdict : **PASS 6/6** —
aucune régression. Publication v1.12.0 + preview1 validée juste avant
(garde-fou 10/10, 4/4 liens byte-identiques).

| Harnais | perf10 | build | Verdict CI |
|---|---|---|---|
| Parse/compile | 0,123 ms | 0,128 ms | négligeable (sub-ms bruité, +3,8 %) |
| Hot loop controller IDLE | 312,2 ns | 38,1 ns | ×8,19 [≥ 4] ✅ |
| poll_gamepad relâchement Home | 1 405,7 ns | 162,8 ns | ×8,63 [≥ 4] ✅ |
| updateCanvas (chemin 60 Hz) | 272,9 ns | 13,1 ns | ×20,8 [≥ 12] ✅ + flag dirty (4 vs 860 004 uniform1f) |
| updateFrame | 176,2 ns | 150,9 ns | stable [0,5–2] ✅ |
| Éval page | 24,3 ms méd | 21,4 ms méd | build ≤ 50 ms ✅ · écart médiane −11,9 % |
| Éval page à froid (5 runs) | 574,9 ms | 25,6 ms (23,9–32,1) | build ≤ 50 ms ✅ · Δ −95,5 % |
| cold-getcap | 528,2 ms (one-shot) | eval 25,6 ms | one-shot stable, 2e appel 0,1 ms ✅ |

### Re-baseline du 19 août ~19:15 (post-doc-start APK + passe de cohérence) — mêmes bornes ✅

`run-all.sh` complet, build stable **v1.12.0** (inchangé) vs perf10 (055d3a0),
relancé après la validation mobile doc-start (APK preview) et la passe de
cohérence docs. Verdict : **PASS 6/6** — aucune régression, bornes CI tiennent.

### Re-baseline du 20 août ~15:00 (v1.13.4, post-fix D-pad capture) — mêmes bornes ✅

`run-all.sh --skip-page-eval` (parse + hot loops), build stable **v1.13.4** vs
perf10 (055d3a0), après le fix Freebox : gate `/play` relaxé + navigation
D-pad du dialog (listener keydown capture au constructeur du
NavigationDialogManager). Verdict : **PASS — aucune régression, bornes CI
tiennent** (le listener capture n'ajoute rien au hot path).

| Harnais | perf10 | build | Verdict CI |
|---|---|---|---|
| Parse/compile | 0,107 ms | 0,111 ms | négligeable (sub-ms bruité, +3,2 %) |
| Hot loop controller IDLE | 279,2 ns | 37,4 ns | ×7,5 [≥ 4] ✅ |
| poll_gamepad relâchement Home | 1 190,5 ns | 152,4 ns | ×7,8 [≥ 4] ✅ |
| updateCanvas (chemin 60 Hz) | 218,9 ns | 13,3 ns | ×16 [≥ 12] ✅ + flag dirty |
| updateFrame | 154,0 ns | 142,3 ns | stable [0,5–2] ✅ |

### Fix oscillation D-pad des steppers/selects (20 août, bundle 1.13.4+) — validé Freebox

Trois problèmes de télécommande sur les box (Freebox Pop), corrigés dans le
**NavigationDialogManager** :

1. **Course listener vs page** — le listener keydown capture du dialog était
   enregistré à la **création paresseuse** du manager (premier `show()`), donc
   APRÈS le handler clavier React de play.xbox.com (capture +
   `stopImmediatePropagation`) → la première flèche fuyait vers la page et les
   presses semblaient mortes. Fix : `NavigationDialogManager.getInstance()`
   **eager au document-start** (à côté de `window.BX_EXPOSED = BxExposed`)
   → le listener gagne l'ordre d'enregistrement, `isShowing()` le rend inerte
   hors dialog.
2. **←/→ sur un bouton `<`/`>` de select ou stepper** — au lieu de déplacer le
   focus (voire de sauter aux tabs via le walk horizontal), la flèche
   **cycle l'option** (clic simulé sur le bouton : `BxSelectElement.onPrevNext` /
   `BxNumberStepper.onClick`). Validé : `←` sur la résolution de
   `1080p-hq` → `1080p`, focus resté dans la row.
3. **Garde du walk horizontal** — `findNextTarget(..., _startRow)` : les
   directions 2/4 ne remontent plus au-delà de la row `.bx-settings-row`
   d'origine (plus de saut vers les tabs / le footer).

Validation : gates verts (t10, tv-defaults + APK embarqués, feature gates,
Étape 0 A+B+D), nav ↓/↑ **row par row** sur la box (KeyboardEvent réels dans
le DOM — les `input keyevent` adb ne sont pas délivrés au WebView TV, et la
NotificationShade de la box restait coincée : validation finale à la
télécommande physique). ⚠ Les touches CDP `page.keyboard` ne parviennent PAS
au WebView TV (artefact de harnais, vu au 20 août) — toujours dispatcher des
`KeyboardEvent` dans la page pour tester la nav.

| Harnais | perf10 | build | Verdict CI |
|---|---|---|---|
| Parse/compile | 0,125 ms | 0,135 ms | négligeable (sub-ms bruité, +8,4 %) |
| Hot loop controller IDLE | 364,4 ns | 34,8 ns | ×10,5 [≥ 4] ✅ |
| poll_gamepad relâchement Home | 1 406,8 ns | 196,2 ns | ×7,2 [≥ 4] ✅ |
| updateCanvas (chemin 60 Hz) | 239,9 ns | 14,2 ns | ×16,9 [≥ 12] ✅ + flag dirty (4 vs 860 004 uniform1f) |
| updateFrame | 187,8 ns | 185,7 ns | stable [0,5–2] ✅ |
| Éval page (20 runs) | 28,2 ms méd (p95 547,0) | 25,6 ms méd (p95 28,9) | build ≤ 50 ms ✅ · écart médiane −9,2 % |
| Profil startup | `getSupportedCodecProfiles` 18,42 ms (71,1 %) | plat (72,4 % natif/GC) | one-shot différé intact ✅ |
| Éval page à froid (5 runs) | 528,7 ms (505,0–532,4) | 33,9 ms (27,0–34,6) | build ≤ 50 ms ✅ · Δ −93,6 % |
| cold-getcap | 526,3 ms (one-shot) | eval 33,9 ms | one-shot stable, 2e appel 0,1 ms ✅ |

