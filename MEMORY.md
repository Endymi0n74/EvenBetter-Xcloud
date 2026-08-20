# MEMORY — état courant du projet (20 août 2026)

Mémoire de travail des sessions. Détails dans `bench/preview/port/session.md`
(étude protocole), `bench/preview/port/e2e-cdp.md` (protocole E2E + journal),
`bench/preview/port/anchors.md`, `bench/preview/port/classify.md`.

## Session autonome 20 août ~11:15-13:15 (utilisateur absent 2 h — « je te laisse les rennes »)

**Mandat** : utiliser BlueStacks + Freebox Pop, mettre à jour le GitHub
Endymi0n74, n'installer RIEN hors du dossier de travail, mémo à chaque action.

**Plan** :
1. Rebuild APK stable (feature « 📥 Session » à jour) + install Freebox → les
   deux packages (app + preview) ont la feature pour le flux donneur/receveur.
2. Validation E2E APK↔APK : BlueStacks (donneur) → Freebox (receveur) — le
   vrai parcours sans téléphone (mécanisme déjà prouvé, reste le parcours
   complet inter-appareils).
3. UI réelle du groupe « 📥 Session » sur l'écran de la Freebox (screenshot).
4. Si le temps : mesures lag manette Freebox (réglages stream 720p/maxBitrate).
5. Mémo de fin + commit/push de tout le lot.

**État de départ** : Freebox en adb (192.168.1.24:5555, sockets WebView
stable 13536 + preview 30464) ; BlueStacks lancé + connecté (127.0.0.1:5555).
Session Freebox : valide jusqu'à ~15:26 locale (RT MSA expiré, accessToken
encore bon). Dernier commit main : 4796080 (feature Session import).

**Actions ~11:20 (mémo)** : rebuild des deux APK (fix fallback de port) +
install Freebox ; E2E cross-APK validé — preview (donneur, session réelle
play.xbox.com) → `send()` Java → stable (receveur même origine) : 4 clés
msal écrites + cookies XBXXtk/xbl_pa/ASLBSA régénérés. Conflit de port
validé : les deux serveurs vivent ensemble (stable 8765 + preview 8766),
les deux répondent `{ok:true}` — fallback 8765→8766 (+10 max) prouvé en
réel. Les deux APK ont maintenant la feature « 📥 Session » à jour.

**Actions ~11:25-11:40 (mémo)** :
- **UI du groupe « 📥 Session » vérifiée en réel sur la Freebox** : settings
  globaux → groupe « 📥 Session » présent (boutons Importer/Envoyer + note
  Freebox). Preuve : `bench/mobile/session-import-ui-freebox.png` (screencap
  TV 1920×1080).
- **Expiration de session confirmée (prédiction token-ttl)**: la WebView
  preview de la Freebox affiche « Votre session a expiré » — le RT transféré
  ce matin était déjà expiré (expiresOn 08:32Z) → au premier refresh MSAL a
  purgé le cache. La WebView stable (import ~11:20) tient encore (cookies
  présents, pas d'écran d'expiration) mais sur les MÊMES tokens → elle peut
  mourir au prochain refresh. Le seul vrai correctif = re-transférer depuis
  le téléphone (session fraîche) quand il sera re-branché.
- **Stream baseline Freebox** : lancement par URL directe OK sur la WebView
  stable (1280×720, lecture réelle). Mesure FPS impossible en autonomie :
  l'app preview est au premier plan → la WebView stable est en arrière-plan
  (rAF=0, getVideoPlaybackQuality 100% « dropped » = chemin overlay du
  background, pas une métrique). Le lag manette reste à mesurer en présence
  (contrôleur physique + app au premier plan).

**Publication 1.13.2 + 1.13.2-preview1 (~11:35-11:45, mémo)** : le
release-guard a détecté les deux releases périmées (feature « 📥 Session »
ajoutée APRÈS v1.13.1 — stable ET canal preview servaient un bundle sans la
feature, auto-update muet). Cycle complet : `bump-version.sh 1.13.2
--preview=1.13.2-preview1 --build-apk` (gate ROUGE initial : vieil APK
1.13.1 dans mobile/out/ → nettoyé + rebuild) → commit 8cc4787 → releases
créées (preview --prerelease, stable Latest) → canal ré-uploadé --clobber →
tags locaux alignés (gh release create ne pousse PAS le tag local — piège,
tag distant OK mais `git tag` local absent → guard ROUGE « tag introuvable »
jusqu'au `git tag HEAD && git push`) → auto-prune a purgé v1.13.1 +
v1.13.1-preview2 (état final : v1.13.2 Latest + v1.13.2-preview1 + canal) →
**guard 4/4 VERT + mécanisme TM validé**.

**Fix build.sh — out dir par variant (commit c50265a)** : `rm -rf $OUT`
sur un dossier partagé faisait disparaître l'APK stable après le rebuild
preview (piège vécu DEUX fois le 20 août, « failed to stat »). OUT =
out-stable/out-preview ; gate readme-version scanne les deux dossiers,
mobile-probe + bump mis à jour, .gitignore couvert.

⚠ **Pour le retour utilisateur** : le téléphone aura l'APK 1.13.2 à
réinstaller (feature Session + port fallback) ; la Freebox les deux APK
1.13.2 (déjà installés, rebuild à jour) ; le flux « Importer la session »
fonctionne maintenant en vrai téléphone → Freebox (mécanisme cross-APK
prouvé dans cette session). Les tokens MSAL de la Freebox sont en fin de vie
(re-transférer depuis le téléphone — règle token-ttl).

## Lag manette Freebox — profil de latence mesuré (20 août ~12:00)

**Demande** : « mesure le lag manette sur la Freebox avec le stream en
cours et applique le réglage qui réduit le plus la latence perçue ».

**Mesures (stream Halo CE direct, app stable au premier plan, session
vivante)** :
- **Polling manette du client : sain** — médiane 5,8 ms, p95 14,8 ms
  (instrumentation non-invasive de `navigator.getGamepads`, convention
  win-capture, restaurée après). Aucune famine main thread.
- **Régime établi (~2-3 min après lancement)** : ~59 fps décodés / 60 source,
  ~4-10 fps dropés (8-17 %), **~57 fps présentés à l'écran (rAF)** — le
  pipeline vidéo tient ~95 % de la cadence source.
- **Phase de démarrage = le vrai problème perçu** : provisioning lent sur
  cette box (~27 s jusqu'à l'élément vidéo, puis démarrage très progressif —
  ~22-30 fps / 50 % dropés mesurés dans la 1re minute, 51 fps à t≈230 s).
  C'est la fenêtre « ça laggue » que l'utilisateur ressent au lancement.
- **Aucun contrôleur connecté pendant la mesure** (getGamepads vide) → la
  latence entrée→écran réelle (RTT réseau + buffer client) n'est pas
  mesurable sans manette physique.

**Verdict + réglage appliqué** : les réglages étaient DÉJÀ optimaux sur la
box — preset Économe (cap maxBitrate 5 Mbps + 720p) + `_bxTvDefaults` déjà
en place. Le levier restant : `ui.splashVideo.skip=true` (appliqué,
persisté — coupe le splash au lancement suivant). Le codecProfile low/high
ne change rien au décodage (A/B du 18 août : 0,43 ms/f des deux côtés).
Résidu incompressible : provisioning (~2 min) + RTT réseau + 8-17 % de
frames dropées par le compositeur WebView de cette box — ni le cap ni la
résolution ne le réduisent plus (déjà au plancher). Recommandation pratique :
WiFi 5 GHz / signal fort sur la box (box en WiFi uniquement) ; relancer le
transfert de session quand les tokens tombent.

## Auto-update 1.13.1 → 1.13.2 validé EN RÉEL dans Tampermonkey (20 août ~12:45)

**Demande** : « vérifie en réel que TM/GM propose la mise à jour 1.13.2
depuis une installation 1.13.1, via le meta pinné ».

**Protocole réel exécuté** : profil Edge neuf `D:\edge-profiles\tm-update`
(port 9230) + **Tampermonkey BETA v5.5.6237** (ID `fcmfnpggmnlmfebfghbfnillijihnkoh`
— le store Edge sert la BÊTA « fcmf », PAS la stable `dhdgffkkebhmkfjojejmpbldmpobfkfo`)
+ serveur local 8933 pour installer le bundle 1.13.1 publié extrait du tag git
(`git show evenbetter-xcloud-v1.13.1:better-xcloud.es2017.user.js`, pin
`releases/latest/download/better-xcloud.meta.js` vérifié).

**Preuve en 4 liens** :
1. Le meta stocké par TM à l'install : `@version 1.13.1`, `updateURL` =
   `releases/latest/download/better-xcloud.meta.js`, `check_for_updates:true`
   (chrome.storage.local `!extdb.@meta#<uid>`).
2. Le meta servi au pin : HTTP 200, `@version 1.13.2` (fetch réel).
3. Déclenchement : bouton par-script « Vérifier les mises à jour » (colonne
   Actions) PUIS action de masse « Lancer une MàJ » → TM fetch la meta.
4. Résultat : le meta stocké passe à **1.13.2** (lastModified ~10:42Z),
   nouveau record `!misc.scripts.update`, et le dashboard affiche
   « EvenBetterXcloud **1.13.2** · 414 KB ».

**Verdict** : le cycle est VALIDÉ de bout en bout dans un vrai navigateur —
une installation 1.13.1 est bien mise à jour vers 1.13.2 via le meta pinné
(releases/latest pour le stable, canal flottant pour le preview).

## Freebox : overlay stable absent + preview non navigable (20 août ~13:00)

**Demande** : « la version normale sur la freebox n'affiche pas l'overlay et
la version preview affiche l'overlay mais je n'arrive pas à naviguer dedans ».

**Diagnostic (prouvé en réel)** :
- **Stable sans overlay** : l'APK stable navigue vers `www.xbox.com/play`
  SANS locale → le gate du bundle `if (!pathname.match(/^\/[a-z]{2}-[a-z]{2}\/play/)) throw "Not xCloud page"` refuse → `__EBX_INJECTED: null`, 0 nœud bx-*.
- **Preview non navigable** : l'overlay s'affiche mais la navigation télécommande
  ne marche pas. Cause : `ui.controllerFriendly` par défaut =
  `DeviceInfo.deviceType !== "unknown"` → la WebView de la box est « unknown »
  → défaut à false → selects/boutons non pilotables au D-pad. Et
  `JS_TV_DEFAULTS` de l'APK (Économe + 720p + reduceAnimations) n'activait PAS
  controllerFriendly.

**Fixes appliqués (build local, non publié)** :
1. **Gate stable relaxé** : `match(/^\/(?:[a-z]{2}-[a-z]{2}\/)?play/)` — accepte
   `/play` sans locale (et `/XX-XX/play` inchangé, le reste throw toujours).
   Ancre T6 de build-preview.js + invariant mis à jour (le preview garde son
   bypass `!BX_PREVIEW &&`). Testé en vm : 8 cas (accepte /play, /fr-fr/play,
   /play/launch/… ; rejette /, /stream/…, /products/…, /fr-fr/home).
2. **JS_TV_DEFAULTS** : + `ui.controllerFriendly=true` + `ui.layout="tv"`
   (layout Smart TV) — appliqués une fois via `_bxTvDefaults` au premier
   lancement sur la box.

**État** : bundles + es2017 + preview rebuildés (gates verts : readme-version,
feature-session, feature-data, t10), APK stable + preview rebuildés. ⚠ La
Freebox a décroché pendant le diagnostic (nav `/fr-fr/play` → reboot/adb WiFi
offline) — installation + validation réelle en attente du retour de la box
(réactiver le débogage adb dessus). ⚠ PAS de bump : VERSION reste 1.13.2
(gate readme-version vert) — prochaine release (1.13.3) portera ce fix.

**Suite ~13:20 — la vraie cause du D-pad + fix validé en réel sur la box** :
une fois la box revenue, l'APK v2 (tvDefaults marker 2) installé et le focus
forcé dans le dialog, la nav restait bloquée après 1 déplacement. Cause
racine trouvée par instrumentation CDP : **le handler clavier de la page
play.xbox.com vole les flèches en phase CAPTURE sur window** (avec
stopImmediatePropagation, enregistré par React après notre bundle) — le
listener keydown du NavigationDialogManager est en BUBBLE sur
`.bx-navigation-dialog` → il ne s'exécute jamais ; pire, la page focus sa
game card, `getFocusedElement()` renvoie null, et `focusIfNeeded()`
re-focus le header (la bannière « Installer l'application » = le cul-de-sac
observé). **Fix** : un listener keydown CAPTURE sur window ajouté au
constructeur du NavigationDialogManager (bundle = document-start → enregistré
AVANT le handler React), qui ne s'active que si `isShowing()`, rejoue la
logique de handleEvent (handleKeyPress → focusDirection → Enter/Space/Escape)
et appelle `stopImmediatePropagation()` quand handled. **Validé en réel sur
la Freebox** (APK preview rebuildé) : Économe → Emplacement du serveur →
steppers → « 📡 Tester la latence » → remontée ↑, plus aucune fuite vers la
page (le 1er run montrait la game card « Absolum » avant le fix). ⚠ Quirk
amont résiduel : 2 selects adjacents oscillent (le « > » d'un stepper et
l'input du select suivant) — comportement de l'algorithme upstream
(focusDirection identique), pas une régression. Les 4 bundles + 2 APK
rebuildés, gates verts (readme-version 1.13.2, t10, datasaver). Commit :
fix-dpad-capture. Pas de bump — la release 1.13.3 (stable+preview)
portera gate relaxé + tvDefaults + fix D-pad.

**Pièges mémorisés (TM BETA MV3)** :
- Le store Edge installe la BÊTA (`fcmf...`), pas la stable — le dashboard
  stable `dhdgffkkebhmkfjojejmpbldmpobfkfo` est introuvable (ERR_BLOCKED).
- Les données TM vivent dans `chrome.storage.local` (records `!extdb.*`,
  `!misc.*`), PAS localStorage/IndexedDB de la page options.
- Le check d'update du MV3 tourne dans le service worker `background.js` ;
  le bouton par-script « Vérifier les mises à jour » et l'action de masse
  « Lancer une MàJ » (select d'actions → Démarrer) sont les déclencheurs
  fiables ; l'intervalle est `scriptUpdateCheckPeriod` (ms) dans
  `!extdb.#config` (modifiable via l'UI Réglages).
- `kill` ciblé d'une instance Edge : `Get-CimInstance Win32_Process -Filter
  "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*<profil>*' }
  | Stop-Process` via un fichier .ps1 (le quoting bash/PowerShell inline
  casse sur `$_`).

## Publication v1.13.3 + v1.13.3-preview1 (20 août ~13:30)

**Demande** : « Fais le bump 1.13.3 (gate stable relaxé + navigation TV) et
publie les releases stable + preview avec les APK ».

**Cycle exécuté** : `bump-version.sh 1.13.3 --preview=1.13.3-preview1
--build-apk` → gate ROUGE initial (vieil APK 1.13.2 dans out-stable/out-
preview — le rebuild APK vient APRÈS le gate) → rebuild des deux APK manuel
→ gate VERT + feature gates (t10, datasaver, keepalive) → commit d2b2163
(READMEs, bundles, metas, manifest) → push → releases : preview1
(prerelease, tag evenbetter-xcloud-v1.13.3-preview1) puis stable (Latest,
tag evenbetter-xcloud-v1.13.3) → canal flottant evenbetter-xcloud-preview-
channel re-uploadé (--clobber, 2 assets preview) → tags locaux alignés (déjà
à jour : gh create pousse le tag distant, `git tag HEAD` + push = up-to-date)
→ **guard 4/4 VERT** (stable→d2b2163, user.js stable = ES2017 byte-
identique, preview canal byte-identique au build local, APK stable = bannière
byte-identique au versionné, APK preview 200). Auto-prune a purgé v1.13.2 +
v1.13.2-preview1 (état final : v1.13.3 Latest + v1.13.3-preview1 + canal).

**Contenu de la release** : gate stable `/play` sans locale (c3cfdec), défauts
TV versionnés marqueur 2 (controllerFriendly + layout tv, MainActivity),
fix D-pad preview (capture keydown, 2c7bbe7). Notes FR/EN avec la signature
vibe-coding/Codebuff. ⚠ Piège re-mémorisé : le gate readme-version ROUGE au
bump quand le rebuild APK n'a pas tourné — le script s'arrête avant
l'étape APK, il faut rebuild manuel puis re-gate.

## Gate « Défauts TV de l'APK » — tv-defaults.test.js (20 août ~13:45)

**Demande** : « Ajoute un gate CI qui vérifie que les défauts TV de l'APK
(controllerFriendly, layout tv) restent présents dans MainActivity ».

**Fait** : `bench/tv-defaults.test.js` branché au step preview de bench.yml
(+ --self-test au CI, comme les autres gates). Vérifie statiquement (pas de
build APK) : tous les réglages de `JS_TV_DEFAULTS` (marqueur idempotence
2, maxBitrate 5 Mbps, 720p, reduceAnimations, controllerFriendly, layout
tv, rocket hide) + les 2 points d'injection (évaluation au chargement
`JS_TV_DEFAULTS + "}}catch..."` et application TV uniquement `isTv ?
JS_TV_DEFAULTS : ""`). ⚠ **Piège d'échappement vécu** : les littéraux Java
du fichier contiennent `\"` (backslash + quote) ; dans un littéral JS
simple, `\"` consomme le backslash → l'aiguille ne matchait pas. Solution :
helper `JQ(s) = s.replace(/"/g, '\\"')` qui reproduit l'échappement Java —
plus aucune ambiguïté. Self-test validé : copie sans controllerFriendly →
GATE ROUGE. Commit `15a9c61` (gate + bench.yml + bench/README.md section).

## CI : gate tv-defaults vert + réparation du rouge pré-existant (20 août ~14:00)

Après le push du gate, le CI était ROUGE — mais pas à cause du gate : le
run 11:29 (74b0fef, AVANT le gate) échouait déjà pareil. Cause : **GATE A
(fetch-early) rouge depuis c3cfdec** — le gate /play relaxé a changé la
forme du garde (regex `(?:[a-zA-Z]{2}-[a-zA-Z]{2}/)?play`), les deux probes
statiques « T6 garde neutralisé » et « T6 avant main() » attendaient
l'ancienne regex stricte → mise à jour des needles (commit 4885962).
**Piège du gate D (play-chain)** : sur le CI sans bundles capturés, le
script affiche « DRIFT (11 ancres) ❌ — bundle absent » PUIS sort en soft
exit 0 — c'est du bruit, pas un échec (le check soft est APRÈS l'affichage).
**Verdict** : CI vert sur 4885962 — le gate tv-defaults (normal +
--self-test) tourne en réel sur GitHub, tous les autres gates passent.

## PR de contrôle gate tv-defaults (#18) — validée fermée (20 août ~14:15)

**Demande** : « Ouvre une PR de contrôle avec un réglage TV volontairement
retiré de MainActivity (copie) pour vérifier que le gate tv-defaults échoue
réellement sur GitHub, comme pour feature-datasaver ».

**Déroulé** : branche `ci/control-tv-defaults` depuis main, retrait de
`s[\"ui.controllerFriendly\"]=true;` de `JS_TV_DEFAULTS` (vérifié en local :
gate ROUGE exit 1), commit edc1772, PR #18. **Résultat GitHub** : job
`hotloops-ratios` **fail** (runs push 32365751974 + pull_request
32365754862) au step « Build preview » avec la ligne exacte : `❌
controllerFriendly (nav télécommande) :: n=0` / `1 échec(s) Défauts TV
APK` — le garde bloque bien une perte de réglage TV. PR fermée + branche
supprimée (rien à merge). ⚠ Piège run : le job `startup-cold` (runner
Windows self-hosted `[self-hosted, windows, gpu]`) reste QUEUED quand le
runner est offline — le run global ne passe pas à completed et les logs CLI
sont indisponibles ; la preuve se lit au niveau JOB (steps → Build preview
→ failure) ou sur le run push (qui n'a pas ce job).

## Gate tv-defaults étendu aux APK embarqués (20 août ~14:30)

**Demande** : « Étends le gate tv-defaults pour vérifier aussi que les APK
rebuildés (out-stable/out-preview) contiennent bien controllerFriendly dans
le bundle embarqué ».

**Fait** (commit deb8623) : section 3 du gate — chaque `evenbetter-xcloud-*.apk`
de `mobile/out-stable` + `out-preview` est ouvert en zip (`unzip -p`, dispo
ubuntu + Git Bash) ; les assets `assets/better-xcloud.user.js` (+ es2017)
doivent être **byte-identiques aux bundles courants du repo** (sha256, CRLF
normalisé) ET contenir le marqueur `controllerFriendly`. ⚠ Piège : build.sh
copie l'asset sous le MÊME nom pour les deux variants → le contenu attendu
diffère (preview vs stable) — vérifié en réel : sha des 4 assets = bundles
du repo (fce58791 / cf22d9fc stable, 48d486d2 / 5ab08dc6 preview). En CI
(sans build mobile) : APK absents → warn + skip (comme readme-version).
Self-test étendu : bundles attendus corrompus sur COPIE (le zip réel est
extrait — l'échec vient de la comparaison) → ROUGE attendu. CI vert sur
deb8623 avec le warn « AUCUN APK local » attendu dans le log.

## Session autonome 20 août ~14:45-15:30 (utilisateur absent, « pense à éteindre la tv »)

**Mandat** : tests + évolutions jugés nécessaires, mémo à chaque action,
GitHub autorisé, rien hors du dossier de travail, éteindre la Freebox.

**Actions (mémo)** :
1. **Run PR orphelin annulé** : le run pull_request du commit de contrôle
eDc1772 (branche supprimée) restait queued sur startup-cold (runner Windows
offline) — `gh run cancel` (preuve dans la liste des runs : les 3 derniers
pushes verts 47c021c/deb8623/3d9b03a).
2. **Preuve ROUGE « APK périmé » en réel** : simulation d'un APK 1.13.2 avec
un bundle corrompu (controllerFriendly retiré) fabriqué via `jar cf`
(tmp/.tmp-stale, zip assets/better-xcloud.user.js + es2017) ajouté à
mobile/out-stable → gate tv-defaults sort ROUGE (3 ❌ : sha ≠ sur les 2
assets + controllerFriendly n=0) pendant que les vrais APK 1.13.3 passent →
APK retiré, gate vert. Le chemin d'échec de la section 3 est prouvé sans
self-test.
3. **Oscillation D-pad des steppers — cause racine documentée, PAS de
patch** : les boutons `<`/`>` d'un select sont des FRÈRES DOM des rows
(layout plat : [label row][<][>]) — le walk `nextElementSibling` +
`findFocusableElement` descendant retombe sur le stepper de la row suivante
dans l'ordre DOM, qui peut être VISUELLEMENT au-dessus → aller-retour
perçu. Comportement de l'algorithme upstream (présent aussi sur desktop
original) ; patcher = divergence upstream + risque de casser la nav D-pad
validée → quirk documenté, accepté.
4. **Re-baseline v1.13.3 post-fix D-pad** : `run-all.sh --skip-page-eval`
— parse 0,111 ms (+3,2 % sub-ms), controller IDLE 37,4 ns (×7,5), poll
relâchement 152 ns (×7,8), updateCanvas 13,3 ns (×16), updateFrame 142 ns
stable → **PASS, bornes CI tiennent** (journalisé dans bench/README.md
« Re-baseline du 20 août ~15:00 »).
5. **Garde-fou release 4/4 VERT** (stable → d2b2163, user.js ES2017
byte-identique, preview canal byte-identique, APK bannière = versionné,
APK preview 200).
6. **Freebox** : dialog settings laissé ouvert pendant le diagnostic fermé
via CDP ; TV éteinte en fin de session (KEYCODE_SLEEP).

## Freebox Pop — login bloqué par l'anti-bot Microsoft + contournement session (20 août ~09:30)

**Problème** : sur la Freebox Pop (Android 10, armeabi-v7a 32 bits, WebView 152),
l'APK stable ne trouve pas le compte Xbox : alerte « Un problème s'est produit
lors de la recherche de votre compte ».

**Cause racine (prouvée par séquence de tests)** : l'anti-bot Microsoft
(header `PPServer` sur la réponse) renvoie un **404 délibéré** sur
`POST login.live.com/GetCredentialType.srf` depuis la WebView de la Freebox.
Le même POST exact (headers+body+cookies) passe en **200 depuis le PC** et
depuis le téléphone (Android 16, WebView 152.0.7977.54). Ce n'est ni l'UA
ni le suffixe `EvenBetterXcloud/1.13.1` (neutralisé sans effet), ni le réseau
(ping/DNS/heure OK), ni les cookies. C'est le **fingerprint TLS/HTTP2 de la
pile BoringSSL d'Android 10** que Microsoft blackliste pour le flux de login
(des `ERR_HTTP2_PROTOCOL_ERROR` sur fpt.live.com/ipv6.live.com corroborent
une pile HTTP/2 dégradée). Le téléphone passe car sa pile est récente.

**Parade Custom Tabs morte** : la Freebox est en 32 bits → Chrome moderne
n'existe plus pour armeabi-v7a.

**Contournement validé en réel (20 août ~09:40)** : la session vit dans le
**localStorage** de play.xbox.com (clés `msal.*`, tokens MSAL), pas dans les
cookies. Transfert du localStorage complet du téléphone (connecté) vers la
Freebox sur le **même origine play.xbox.com** → la page se connecte (gamertag
« Stabiloboss82 », cookies `XBXXtk`/`xbl_pa` créés) et **le stream démarre**
(Halo : Campaign Evolved, vidéo 1280×720 en lecture réelle).

**Script rejouable** : `bench/mobile/session-transfer.js --from <serial> --to <serial>`
(adb forward CDP + copie localStorage + verdict gamertag/Profil). Prérequis :
les deux appareils en adb autorisé, WebView débogable, page play.xbox.com
ouverte. Limite : les tokens expirent (refresh ~semaines) — à ré-exécuter quand
la session tombe. Le login natif reste impossible sur cet appareil (fingerprint
non modifiable depuis l'APK).

## Validation APK preview sur la Freebox Pop (20 août ~10:00) — overlay OK en stream

**Validation complète en réel** (APK preview `com.bxperf.preview` 1.13.1-preview2
buildé + installé côte à côte avec le stable) :

1. **Session transférée tient dans l'APK preview** : page play.xbox.com connectée
   (gamertag « Stabiloboss82 », « endymi0n74 », cookies XBXXtk/xbl_pa créés).
   Le localStorage MSAL n'est PAS partagé entre packages (com.bxperf.app vs
   com.bxperf.preview) → re-transférer après install du 2e APK (session-transfer).
2. **Bundle preview actif** : clés `BetterXcloud.*` écrites, CSS/injection `bx-*`
   présente dans le DOM.
3. **Stream lancé et overlay visible en jeu** : game bar EvenBetterXcloud
   (`bx-game-bar` + `bx-game-bar-container bx-show`, 11 boutons `bx-button
   bx-ghost` dont 4 `bx-activated`) + `bx-stats-bar` + `bx-video-css`.
   Vidéo 1280×720 en lecture réelle (readyState 4, non-paused).

**Piège trouvé en route — page produit /products/... cassée sur cette WebView** :
l'erreur **React #418 (hydration mismatch)** apparaît sur play.xbox.com ET sur
la WebView stable SANS bundle actif → bug du SITE sur WebView lente (Android
10), pas notre code. Conséquence : le bouton « Préparez-vous à streamer » ne
déclenche RIEN (handlers React jamais attachés). **Workaround** : lancer le
stream par URL directe `https://play.xbox.com/stream/<titleId>/<slug>` — le
provisioning part immédiatement (« Je mets les choses en avant... »). Le clic
« Ultimate Abonné » depuis le dialogue d'édition (section scrollable, y=1342)
ne lance rien non plus. Sur la Freebox : lancer les jeux par URL directe.

**Note lancement** : le réseau/serveur étaient sains (POST /v2/login/user 200,
POST /v2/titles 200, StreamSessionConfiguration chargé) ; un 503/404 isolé vu
sur la page produit était transitoire.

## Durée de vie de la session transférée — MESURE RÉELLE (20 août ~10:50)

**Mesure faite avec `bench/mobile/token-ttl.js`** sur le localStorage de la
Freebox (session copiée du téléphone) :

- **idToken / accessToken** : ~1 h de vie, auto-rafraîchis par MSAL tant que
  le refresh token est valide.
- **RefreshToken MSA** : `expiresOn` = 20/08 08:32 UTC pour une émission le
  19/08 13:21 UTC → **durée de vie réelle ≈ 19-24 h, PAS 90 j AAD**. C'est la
  politique de session du flux Xbox (login.live.com → MSA).
- **Conséquence pour le transfert de ce matin** : le RT copié expirait à
  08:32 UTC (il en restait 30 min au moment du transfert) → la session
  Freebox tient encore grâce à l'accessToken copié (exp 13:26 UTC ≈ 15:26
  locale) puis **tombera au premier refresh** (RT mort + login bloqué par
  l'anti-bot → « Se connecter » affiché → re-transférer).
- Vérifié en réel à 08:50 UTC : reload home → profil + gamertag toujours là
  (accessToken encore valide).

**Règle pratique (documentée bench/README.md) : re-transférer depuis le
téléphone si le transfert date de >12 h, ou si `token-ttl.js` annonce un RT
à <6 h restantes.** Le téléphone doit avoir sa propre session fraîche (ouvrir
play.xbox.com dessus le jour même).

## Feature « 📥 Session » dans l'APK — import sans ligne de commande (20 août ~11:00)

**Demande** : « Ajoute un mode “Importer la session” dans l'APK qui automatise
le transfert MSAL depuis un autre appareil sans ligne de commande. »

**Conception** (sans caméra — la Freebox Pop n'en a pas) : transfert
pair-à-pair WiFi via un mini serveur HTTP LAN dans l'APK (receveur) + envoi
par le bundle (donneur). Le POST passe par **Java** (bridge
`window.BXSessionImport.send()`, HttpURLConnection) car le fetch de la page
vers http://LAN est bloqué par le mixed content (MIXED_CONTENT_NEVER_ALLOW).

**Livré** (validé en réel sur la Freebox ~11:05) :

- `MainActivity.java` : bridge `BXSessionImport` (startServer / stopServer /
send), serveur LAN port 8765 (ServerSocket brut, code 6 chiffres, CORS),
écriture localStorage par evaluateJavascript (navigation différée via
PendingImport si l'origin diffère). Classes nommées (piège d8), pas de lambdas.
- `bench/feature-session-import.js` : groupe « 📥 Session » dans les settings
globaux, visible même DÉCONNECTÉ (filtre rendu déconnecté étendu), 2 boutons
(Importer / Envoyer), URL donneur mémorisée.
- `bench/feature-session-import.test.js` : gate CI (présence stable+preview,
ancres, rejeu + self-test) branché au step preview de bench.yml.
- `AndroidManifest.template.xml` : `usesCleartextTraffic="true"` (Android 9+
bloque le HTTP en clair sinon).
- Rebuild APK preview installé sur la Freebox ; bundle stable + preview à jour.

**Validé en réel** : startServer → `http://192.168.1.24:8765/import/<code>` ;
POST (curl puis bridge send() Java) → `{ok:true}` → clé écrite dans le
localStorage de la WebView → reload → profil + gamertag. Feature exposée
(`window.BX_SESSION_IMPORT` = object) + bridge (`window.BXSessionImport`).

**Pièges** : cleartext Android 9+ (manifest) ; commentaire XML spécial dans le
manifest → aapt2 « invalid token » (garder les commentaires minimalistes) ;
feature-datasaver.test.js robustifié (filtre partagé vérifié par préfixe +
strip par regex) ; état transitoire post-install (1re page sans bundle → reload).

**Reste** : rejouer le vrai flux téléphone (donneur, APK à jour) → Freebox
(receveur) quand le téléphone sera re-branché — le mécanisme est validé des
deux côtés (send() Java + serveur + écriture).

## Auto-update preview : canal flottant `evenbetter-xcloud-preview-channel` (20 août ~09:00)

**Demande** : « Vérifie en réel que Greasemonkey/Tampermonkey propose la mise
à jour 1.13.1-preview2 depuis la 1.13.1-preview1 via le meta pinné. »

**Verdict de la vérification — ça NE POUVAIT PAS marcher par conception, deux
défauts indépendants :**
1. **Pin tag-figé 404** : le bundle preview1 publié (commit 304891e) pointait
   `releases/download/evenbetter-xcloud-v1.13.1-preview1/...` — release purgée
   par la rétention (le prune ne garde que le dernier preview + le tag pinné) →
   HTTP 404 vérifié. Tout utilisateur installé en preview1 avait un pin mort.
2. **Meta figée à l'ancienne version** : même si la release avait survécu, la
   meta à cette URL dit `@version 1.13.1-preview1` → TM compare servi vs
   installé = égal → jamais de proposition. Le stable marche car son pin
   pointe `releases/latest/download/...` (URL flottante) ; le preview pinnait
   SON tag (fixe).

**Fix — canal flottant preview** (symétrique du latest stable ; GitHub ne
sert pas les prereleases par `releases/latest`, donc un tag fixe dédié) :
- `build-preview.js` : pin `@updateURL`/`@downloadURL` du preview →
  `releases/download/evenbetter-xcloud-preview-channel/...` ; invariants +
  probes interdisent désormais détournement vers le latest stable ET pin sur
  un tag versionné (GATE ROUGE).
- `release-prune.sh` : whitelist absolue du canal dans KEEP (jamais purgé).
- `release-guard.sh` : preview comparé au **build local** (le canal n'est pas
  un tag git — plus de `git rev-list` dessus), `@version` servi =
  PREVIEW_VERSION, APK preview vérifié sur la release versionnée.
- `readme-version.test.js` : pin attendu = canal + garde anti-tag-versionné ;
  self-test reproduit le bug réel (pin tag → ROUGE, 33 défaillances).
- `bench/update-test/update-mechanism.test.js` : harnais rejouable du
  mécanisme TM/GM (fetch meta au pin + comparaison semver) sur les vraies
  URLs GitHub — scénarios 404 (repro avant fix) et canal (proposition
  preview2 depuis preview1, VERT). Réseau obligatoire : local seulement.

**Opérations** : commit `2ae4cfd` + push. Piège vécu : le workflow
`release-prune.yml` (sur `release: published`) utilise le script de MAIN —
la première création du canal a été purgée par l'ancien script (deux runs
06:47/06:48) ; il faut pousser AVANT, puis créer. Découverte collatérale : le
check APK preview du guard (préexistant) était déjà en échec (l'APK preview
n'avait jamais été uploadé sur preview1/preview2) → buildé via
`VARIANT=preview bash mobile/build.sh` et uploadé sur
`evenbetter-xcloud-v1.13.1-preview2`. Garde-fou final vert : 4/4 liens
byte-identiques + APK 200.

**À retenir pour la suite** : (1) après chaque publication preview, uploader
les 2 assets sur le canal (`gh release upload evenbetter-xcloud-preview-channel ... --clobber`)
; (2) un utilisateur installé avec l'ANCIEN pin (tag purgé) ne peut pas être
réparé automatiquement — réinstaller manuellement depuis le lien preview2
(son pin devient le canal) ; (3) le canal n'est jamais purgé par le prune.

## Fix preview v1.13.1-preview2 — overlay en jeu (T11) + volume live (T12) + bug de tri prune (20 août)

**Signal utilisateur** : « tout est ok sur la normal. sur la preview par contre la
partie son ne fonctionne pas et l'overlay n'apparait pas en jeu. »

**Diagnostic (reproduction en réel, session signée edge-cdp + stream)** :
- **Overlay** : la game bar EXISTE en jeu (`GameBar.instance` présent,
  `#bx-game-bar` — c'est un id, PAS une classe `.bx-game-bar` — mon premier
  sélecteur ne matchait pas) mais son conteneur reste `bx-offscreen` (hidden).
  **Cause racine** : le polling du client preview (`xCloudPollingMode: "all"`
  en jeu, `"none"` sur le stable) appelle `disable()` sur la game bar.
  `showBar()` manuel fonctionnait → T11 : neutraliser le disable preview dans
  le handler polling + résilience si le shell a remplacé le document
  (ré-append + ré-attache au document courant, même classe de bug que T7).
  Validé : après redémarrage Edge (piège MV3 ScriptCache — la page servait
  l'ANCIEN bundle en mémoire), le dispatch polling ne cache plus la bar
  (`bx-show` stable), bar visible en jeu avec l'action Settings.
- **Son** : le hook audio du script patchait le SDK **stable**
  (`.srcObject=this.audioMediaStream`) — absent du SDK preview → aucun gain
  node créé. **Solution T12** : le client preview joue l'audio via un
  `<audio>` (muted=false, 1 piste MediaStream) + `audioContext` présent →
  brancher le gain node existant (`setupGainNode`) sur cet élément dans
  l'interval T7. Validé en réel : `audioGainNode` créé, l'élément audio est
  mute (l'audio passe par le gain), **gain.value suit les presets en direct**
  (Doux 0.5 / Normal 1 / Boost 2 / Muet 0).
- **Piège MV3 revécu** : copier le nouveau bundle dans l'extension ne suffit
  pas — Edge sert le fichier chargé en mémoire ; redémarrer Edge (ou purge
  ScriptCache) pour tester le nouveau build.

**Livré** : commits `d3f5c4b` (fix T11+T12) + `2e0298f` (bump preview2 via
`bash bench/bump-version.sh 1.13.1 --preview=1.13.1-preview2` — passe README
+ re-pin @updateURL automatisés). Release `evenbetter-xcloud-v1.13.1-preview2`
(prerelease, notes FR/EN, assets preview user+meta). Gates locaux tous verts
avant publication.

**BUG DE TRI DÉCOUVERT dans release-prune.sh (corrigé)** : la sélection du
« dernier preview » triait uniquement le numéro `preview<N>` →
`better-xcloud-perf-1.8.0-preview4` (n=4) passait DEVANT
`evenbetter-xcloud-v1.13.1-preview2` (n=2) et était conservée (le tag pinné
par le build était gardé en plus par sécurité — d'où l'état 3 releases au
lieu de 2). Fix : tri **semver complet** (version de base major.minor.patch
PUIS n de preview) dans le jq. Après fix : dry-run → purge de
1.8.0-preview4, purge réelle OK, état = v1.13.1 (Latest) + preview2, 4/4
liens 200.

## Discipline de mémoire — « mémoire avant tout » (19 août, directive utilisateur)

**Règle stricte posée par l'utilisateur : « mémoire avant tout, quoi que je
fasse, mémoire. »** — cette mémoire est le fil conducteur de toutes les
sessions (les restarts Freebuff effacent le contexte ; seul ce fichier
survit). Application concrète :
- Journaliser **à chaque étape significative**, pas seulement toutes les 2 h :
  avant une séquence longue → où j'en suis ; après chaque verdict/validation/
  échec → le résultat, le « pourquoi », les pièges nouveaux. Un commit de
  MEMORY.md accompagne chaque fin de séquence.
- Commencer chaque session en **relisant l'état courant** (sections récentes +
  « En attente ») et terminer par une passe de journalisation AVANT de
  répondre.
- Priorité à la **reproductibilité** : commandes exactes, chemins, versions,
  sorties chiffrées, pièges (un piège oublié = temps perdu en re-diagnostic).
- La règle s'applique aussi aux actions en cours : si une étape a des
  chances de planter ou de prendre du temps, noter au fil de l'eau ce qui
  est déjà acquis (le contexte ne survit pas à un restart).

## Règle — crédits & vibe-coding (19 août, directive utilisateur)

**« Préciser le vibe-code et ton nom/signature à minima sur le README et
partout où utile »** — règle encodée :
- **Toujours mentionner le vibe-coding + la signature Codebuff (agent
  Buffy)** dans les documents publics et l'en-tête des bundles.
- **README.md + README.en.md** : section « Crédits & vibe-coding »
  (co-créé avec Codebuff — agent « Buffy » — sous direction humaine
  Endymi0n74, crédit original redphx, signature « Generated with
  Codebuff » dans chaque commit).
- **En-tête des bundles** (`better-xcloud.user.js` + preview) : bloc
  OPTIMISATIONS → ligne « Vibe-codé avec Codebuff (agent Buffy) ». Les
  es2017 (minifiés, `legalComments:none`) ne portent pas la signature —
  normal.
- **Notes de release** : penser à mentionner le vibe-coding / Codebuff à
  chaque publication.
- Appliquer aussi dans les nouveaux fichiers publics (docs, inventaires)
  quand c'est pertinent — pas dans le code technique des harnais bench.

Dernière passe : **19 août ~23:30 — PREVIEW_VERSION branché sur le bump
(source de vérité unique, GATE si absent) + ordre es2017 preview corrigé**
(commit en cours).

## Règle — le README doit toujours être à jour (20 août, directive utilisateur)

**« J'ajoute une règle, le README doit toujours être à jour »** — règle
encodée :
- **Après chaque changement de version (bump, release, feature), vérifier et
  mettre à jour TOUS les READMEs** qui mentionnent une version : `README.md`
  (principal, version + liens release + table Deux versions + lien preview),
  `README.en.md`, `bench/README.md`, `mobile/README.md` (versions d'APK,
  exemples de build, tableau des variants), `bench/preview/port/README.md`.
- **Une référence de version périmée = bug de doc** : l'audit grep
  `grep -rn "<ancienne version>" <READMEs>` doit revenir vide (sauf
  mentions historiques datées, ex. « Feature Son v1.13.0 » dans un journal).
- **Au même rythme que le commit du bump** : jamais de commit bump sans la
  passe README qui suit (ou précède) dans le même lot.

## Gate CI « README toujours à jour » — readme-version.test.js (20 août)

Règle utilisateur : « le README doit toujours être à jour » → automatisée :
`bench/readme-version.test.js` (step hotloops-ratios de bench.yml, lancé avec
son `--self-test`) lit `VERSION` + `PREVIEW_VERSION` (source de vérité) et :
1. ancres courantes dans README.md/README.en.md/mobile/README.md (titre,
   table Deux versions, tag preview, lien release, APK versionnés) ;
2. aucun lien `releases/download/evenbetter-xcloud-v<tag>` ni APK versionné
   périmé dans AUCUN README (journaux compris) — la rétention purge les
   anciennes releases → 404 auto-update. Mentions historiques en prose
   tolérées (regex ciblées : tags `evenbetter-xcloud-vX.Y.Z[-previewN]` et
   APK `evenbetter-xcloud-<semver>.apk` uniquement — `1.9.0-test.apk`
   historique n'est pas flagué).
Self-test : copies corrompues → exit 1. Un README/bundle qui garde
l'ancienne version casse le CI immédiatement. **Nuance journal** : les noms
d'APK périmés ne sont vérifiés que dans les docs FRONT (un nom historique
cité dans un journal bench/ est légitime — seules les URLs sont vérifiées
partout).

**Passe README AUTOMATISÉE dans le bump (20 août)** : `bump-version.sh`
fait maintenant le cycle complet en UNE commande — bump → passe README
structurelle (titre, table Deux versions, tags/liens, APK mobile ; les
mentions historiques en prose « Nouveauté v1.13.1 » ne sont pas touchées,
remplacement OLD→NEW sur patterns structurés uniquement) → rebuild preview
(build-preview.js re-pinne @updateURL) → gate readme-version final (exit 1
si quelque chose garde l'ancienne version). `--no-verify` saute rebuild +
gate. Validé en clone : bump 1.13.2 une commande → gate VERT ; cas
`--preview=1.13.2-preview3` (changement de suffixe) OK ; prose historique
intacte. Le gate flaggait les noms d'APK historiques des journaux → check
restreint aux docs FRONT (commité).

**Extension (20 août, directive) — gate bundles + APK** : le même gate
vérifie aussi (1) les `@version` des 4 bundles (user/meta stable + preview)
vs VERSION/PREVIEW_VERSION et le pin `@updateURL` preview → piège « bump
sans rebuild » couvert (bump de fichier sans rebuild = ancienne version ET
ancien pin → 404 auto-update) ; (2) `mobile/build.sh` dérive les noms d'APK
de `${VERSION}` / `${PREVIEW_VERSION}` (APK de release présents dans
`mobile/out/` vérifiés, artefacts intermédiaires base/app-unsigned/
app-aligned ignorés). **Fixes collatéraux** : build.sh hardcodait
`evenbetter-xcloud-${VERSION}-preview1.apk` — le suffixe preview vient
maintenant de PREVIEW_VERSION, avec GATE ROUGE si absent (piège `set -e` :
`|| true` nécessaire pour que le message GATE s'affiche avant l'exit). Idem
`versionName` : le template manifest est bumpé avec la version stable, le
build force la version du variant (`VERSION_NAME`) → l'APK preview annonce
`1.13.1-preview1`. Rebuilds validés le 20 août (stable + preview, noms ET
versionName corrects) ; piège `out/` qui se purge entre deux builds →
sécuriser le 1er APK hors de `out/` avant le 2e build.

## Routine de purge des listeners de diagnostic — BX_PURGE_DIAG (19-20 août)

**Problème** : pendant une session CDP on attache des listeners de diagnostic
sur `window` (ex. `win-capture` pour observer les clics). Un listener oublié
dont la fermeture référence une variable morte (ex. `log.push(...)` avec
`log` non défini) THROWA à chaque clic (erreur propagée au handler `error`
de window — les exceptions des listeners ne remontent PAS au dispatcher,
piège de mesure) et pollue la console. Les listeners ne survivent pas au
reload, mais une session longue en accumule.

**Routine injectée au démarrage** (`bench/feature-diag-purge.js`, injectée à
l'ancre BX_EXPOSED comme les autres features) :
- hook `window.addEventListener`/`removeEventListener` UNIQUEMENT (pas
  EventTarget.prototype — coût ~0 hors window) ;
- enregistre tout listener dont la SOURCE contient le marqueur `win-capture`
  (convention des probes) ;
- `window.BX_PURGE_DIAG()` retire tous les marqués (les autres ne sont
  jamais touchés), appelé une fois au démarrage + exposé pour les probes.
- Gate CI `bench/feature-diag-purge.test.js` (présence stable+preview,
  ancres ×1, **test fonctionnel vm** : 3 listeners attachés dont 2 marqués →
  purge retire exactement 2, le normal reste, idempotent) + self-test
  chemin d'échec. Branché au step preview de bench.yml.

**Validation réelle 100 %** (edge-cdp + extension v1.3.3, bundle avec
BX_PURGE_DIAG) : avant purge le listener cassé throw (err=1 au handler
error), le normal tourne ; purge retire les 2 marqués ; après : 0 erreur,
normal conservé, purge idempotente. **Piège Edge revécu** : après purge du
ScriptCache + relance, la page chargée avant l'extension n'a PAS le bundle
(BX_EXPOSED false) — un `Page.reload` règle (l'extension est prête au
second chargement).

**Piège strip corrigé — feature-sound.test.js** : l'injection de la purge
(dernière feature à l'ancre) a cassé le strip de sound (`ANCHOR_BX + IMPL`
exact — la purge est passée DEVANT). Fix : strip par PLAGE
[ancre … fin d'IMPL] comme feature-datasaver.test.js (robuste à l'ajout de
nouvelles features). Appliqué aussi à feature-diag-purge.test.js par
précaution.

## Convention purge dans les probes + validation live Son + release v1.13.1 (19-20 août)

**Convention dans les probes** (commit 69e0a42) : les trois probes CDP
(`feature-sound-probe`, `feature-datasaver-probe`, `feature-region-probe`)
documentent la convention `win-capture` dans leurs entêtes et appellent
`window.BX_PURGE_DIAG()` en fin de run — best-effort (no-op si API absente),
informatif si des listeners marqués traînaient.

**Validation LIVE de la feature Son — mécanique gain node** : le volume réel
d'un stream ne passe PAS par `video.volume` (le video est `muted` par design
xCloud) mais par un **gain node WebAudio** : clic preset →
`setStreamPref("audio.volume", v, "ui")` → onChange de la pref →
`SoundShortcut.setGainNodeVolume(v)` → `STATES.currentStream.audioGainNode.
gain.value = v/100`. ⚠ Le gain node n'existe que si le booster
(`audio.volume.booster.enabled`) était activé AU SETUP du stream
(patchAudioMediaStream) — sinon la pref s'applique à la prochaine session.
Validé en réel (As Dusk Falls, reload du stream booster on) : 100→gain 1.0,
50→0.5, 200→2.0, 0→0, en direct < 1 s ; prefs restaurées au défaut ensuite.

**Release v1.13.1 (20 août) — bundles avec BX_PURGE_DIAG + APK vc 10** :
stable `evenbetter-xcloud-v1.13.1` (Latest) + preview `evenbetter-xcloud-
v1.13.1-preview1` (prerelease, auto-update pinné sur ce tag). Garde-fou
release 10/10 (4/4 liens byte-identiques, APK 200, stable=versionné),
rétention auto : v1.13.0 purgée, état final = v1.13.1 + preview1 + secours
1.8.0-preview4.

**Piège 1 — pin preview périmé au bump** : `rebrand-bundle.js --bump-only`
change @version mais PAS l'@updateURL/@downloadURL preview (posés par
build-preview.js depuis PREVIEW_VERSION). Sans rebuild post-bump, le preview
pointe l'ancien tag (purgé par la rétention → 404 sur l'auto-update).
Procédure : bump → `node bench/preview/port/build-preview.js` (re-pin) →
es2017 preview → COMMITTER user.js + meta régénérés.

**Piège 2 — meta régénéré non commité** : le rebuild preview régénère aussi
`better-xcloud-preview.meta.js` (nouveau pin) ; si on upload l'asset sans
commit, le garde-fou fait GATE ROUGE (bytes servis ≠ commit tagué). Fix :
commit du meta puis DÉPLACER les tags release (delete + recreate — GitHub
supprime la release avec le tag, et laisse des DRAFTS fantômes à nettoyer via
l'API `gh api -X DELETE /releases/<id>`), puis recréer les releases.

## Fix piège PREVIEW_VERSION — source de vérité unique (19 août ~23:30)

**Problème** (piège f39aeb2 revécu le 19 août) : `build-preview.js`
hardcodait `const PREVIEW_VERSION = "1.13.0-preview1"` alors que
bump-version.sh calcule sa propre version preview (`$NEW-preview1` ou
`--preview=...`) → un rebuild après bump re-réinitialisait le preview en
1.12.0-preview1.

**Fix** :
- **Nouveau fichier `PREVIEW_VERSION`** (racine, source de vérité UNIQUE,
  comme `VERSION` pour le stable) — écrit par bump-version.sh
  (`echo "$PREVIEW" > PREVIEW_VERSION`), lu par build-preview.js.
- **build-preview.js : GATE ROUGE (exit 1)** si PREVIEW_VERSION absent ou
  vide — un clone frais / bump incomplet se voit refuser le build au lieu de
  publier un preview mal versionné. Testé : exit 1 absent + exit 1 vide.
- **Bug latent d'ordre corrigé dans bump-version.sh** : le es2017 preview
  était généré AVANT le rebrand du preview (rebrand-bundle.js --version) →
  l'es2017 gardait l'ANCIENNE version preview. Ordre inversé : rebrand
  preview d'abord, puis sa transpilation ES2017.
- Vérifications du bump enrichies : `VERSION=… · PREVIEW_VERSION=…` affiché.

**Tests** : bump de contrôle 1.13.1 (defaut) + 1.13.2 --preview=1.13.2-preview3
(le cas explicite qui piégeait) → fichiers + bundles alignés, build-preview
lit le fichier (1.13.2-preview3), puis tout restauré depuis /tmp. Gates
tous verts (features ×3, p2-schema, e2e0).

⚠ Piège de chemin : p2-schema.test.js est à `bench/preview/` (PAS
`bench/preview/port/`) — bench.yml l'appelle correctement sans `port/`.

Rappel du contrat : release-guard.sh / release-prune.sh lisent le tag
pinné depuis le BUILD (`better-xcloud-preview.user.js` @updateURL), pas
depuis PREVIEW_VERSION — reste cohérent (le build est le reflet du fichier).

## Publication v1.13.0 + v1.13.0-preview1 (19 août ~23:00)

**Releases créées** (tags sur 0a94d4d = HEAD) :
- `evenbetter-xcloud-v1.13.0` (Latest) : better-xcloud.user.js (**build
  ES2017** — politique v1.8.0, copié depuis better-xcloud.es2017.user.js),
  meta, APK versionné + nom stable (byte-identiques, sha ce46cf28). Notes
  FR/EN avec bloc « 🤖 Vibe-coding » (Codebuff — agent Buffy).
- `evenbetter-xcloud-v1.13.0-preview1` (prerelease) : preview.user.js +
  meta (pinné sur ce tag), APK preview vc 9. Notes FR/EN idem.

**APK rebuildés** (vc 9, versionName 1.13.0) : `mobile/build.sh` (stable)
+ `VARIANT=preview` — piège connu : chaque build purge `mobile/out/` →
copier chaque APK vers /tmp AVANT de lancer l'autre build.

**Garde-fou release : 10/10 vert** (relancé APRÈS la purge) : 4/4 liens
byte-identiques, versions/names cohérents, APK 200. 6/6 liens curl 200
(user/meta ×2 + APK versionné + APK bannière).

**Rétention AUTOMATIQUE confirmée** : le workflow `release-prune.yml`
(déclencheur `release: published`) a tourné à chaque publication et purgé
les v1.12.0 + v1.12.0-preview1 tout seul (runs success 17:09Z). État :
v1.13.0 (Latest) + v1.13.0-preview1 + secours 1.8.0-preview4. Le prune
local `--dry-run` ne listait plus rien (déjà purgé).

## Feature « 🔊 Son » v1.13.0 (19 août ~21:00-21:30)

**Feature utilisateur v1.13.0** (la demande « gestion du son dans les
options » enfin traitée) : groupe « 🔊 Son » dans l'onglet **stream** des
settings (TAB_DISPLAY_ITEMS → groupe audio, item rendu APRÈS le slider
volume) avec 4 presets — 🔇 Muet (0), 🔉 Doux (50), 🔊 Normal (100 +
resetBoost), 📢 Boost (200 + booster) — posant `audio.volume` via
`setStreamPref` (événement UI natif → application LIVE sur la session via
`SoundShortcut.setGainNodeVolume`, le canal du slider natif) et
`audio.volume.booster.enabled` via `setGlobalPref`. Statut dédié
(`bx-sound-status`) avec classe propre (le sélecteur générique lisait le
statut du groupe Données).

**Livrables** (pattern feature-latency/region/datasaver) :
- `bench/feature-sound.js` — injection déterministe (ancre BX_EXPOSED +
ancre `audio.volume` onCreated du groupe stream) + `--self-test` chemin
d'échec.
- `bench/feature-sound.test.js` — gate CI (présence stable+preview, ancres
×1, rejeu sur copie strippée, self-test) branché au step preview de
bench.yml.
- `bench/feature-sound-probe.js` — sonde CDP (rendu du groupe, clic presets,
pref posée, statut).
- Bump `bash bench/bump-version.sh 1.13.0` → stable 1.13.0, preview
1.13.0-preview1, es2017 ×2, manifest vc 9. README FR/EN mis à jour
(v1.13.0 + bloc Nouveauté + table Deux versions + table réglages).

**Validation réelle 100 %** (profil edge-cdp, extension .edge-inject-stable
rechargée avec le bundle 1.13.0 — piège MV3 : copie compilée + bump manifest
+ purge ScriptCache) : rendu du groupe, clics presets → pref posée
(audio.volume 50/100/200), booster on/off, persistance après reload,
statut mis à jour. L'ancien profil datasaver avait une DOUBLE injection
(extension + script simulé 1.9.0→1.12.0 resté dans Tampermonkey BETA) —
passer sur le profil PROPRE (edge-cdp) pour la sonde.

**Piège réparé — strip feature-region** : après re-injection du son,
`feature-region.test.js` passait au ROUGE. Cause : mon strip manuel avait
avalé le `\n` de tête de l'IMPL région (bundle : `}};window.BX_REGION_APPLY`
au lieu de `}};\nwindow.BX_REGION_APPLY`) → l'IMPL extrait par le test ne
matchait plus (n=0) et le strip (indexOf) ne retirait rien. Fix : insertion
chirurgicale du `\n` dans better-xcloud.user.js (pattern unique vérifié),
puis rebuild preview + es2017 ×2.

**Piège réparé — PREVIEW_VERSION** (déjà vu en f39aeb2) : build-preview.js
hardcode `PREVIEW_VERSION = "1.12.0-preview1"` — mon rebuild après bump
avait re-réinitialisé le preview en 1.12.0-preview1. Fix : constante passée
à 1.13.0-preview1 puis rebuild. **TODO futur** : faire lire cette constante
depuis bump-version.sh pour éviter le dérapage.

**Piège réparé — p2-schema.test.js manquant** : le fichier (commit d143ef5)
n'était plus sur le disque (session perdue) alors que bench.yml l'appelle →
`git checkout d143ef5 -- bench/preview/p2-schema.test.js`.

**Gates locaux tous verts** : feature-datasaver/region/sound (avec
--self-test), keepalive-idle, t10-auto-spoof, p2-schema, run-e2e0 --skip-
probe (A+B+D), pr-comment-merge 31/31, mobile-probe 5/5, syntaxe des 4
bundles. Poussé sur main, CI à confirmer.

## Release v1.12.0 rafraîchie (APK doc-start) + cycle auto-update (19 août ~18:30)

**« Déjà fait ? » — OUI pour le fix BACK en stream** : le tag
`evenbetter-xcloud-v1.12.0` contient `6d4d63a` (BACK en stream = navigation
home) — l'APK publié depuis le 19 août ~13:30Z embarquait déjà les 2 fixes
BACK (back prédictif désactivé + double-BACK).

**Rafraîchi** : les 3 APK rebuildés avec l'injection document-start (commit
e8ef24e) ont été re-uploadés (gh release upload --clobber, copies /tmp au
nom exact — piège #newname) : v1.12.0 (`evenbetter-xcloud-1.12.0.apk` +
nom stable `evenbetter-xcloud.apk`, sha 928b6ea byte-identiques) et
v1.12.0-preview1 (`evenbetter-xcloud-1.12.0-preview1.apk`). Garde-fou
release 10/10 vert (4/4 liens, APK bannière 200 + byte-identique, APK
preview 200).

**Cycle d'auto-update vérifié (partie déterministe) :**
- Meta servie à `releases/latest/download/better-xcloud.meta.js` :
  @name EvenBetterXcloud, @version 1.12.0, @updateURL/@downloadURL
  corrects. Preview pinné : 1.12.0-preview1 → son tag.
- user.js servie = byte-identique au tag (garde-fou).
- Côté client réel : dans le Tampermonkey BETA du profil datasaver (Edge
  9225), version simulée **1.9.0** installée (gist temporaire + ask.html
  « EvenBetterXcloud v1.9.0 » → Installer) avec @updateURL → notre meta. Le
  **service worker** de TM (MV3 : `background.js`, pas la page) joint le
  meta (fetch 200 → release-assets) — donc 1.12.0 SERA proposée au prochain
  check (périodique ou manuel).
- **Limite rencontrée** : le clic final « Mettre à jour » dans le dashboard
  Tampermonkey BETA n'est pas automatisable en CDP — les actions batch
  (checkbox + select « Lancer une MàJ » + Démarrer) ne se déclenchent pas
  (les vrais clics souris CDP non plus) et la page se bloque. Quirk UI du
  dashboard MV3, PAS un problème du contrat release (le SW joint le meta).
  Pièges pour la prochaine fois : le check d'update tourne dans le SW (pas
  la page options.html) ; Tampermonkey n'intercepte PAS 127.0.0.1 (install
  via gist/GitHub URL) ; le dashboard ne se rafraîchit pas tout seul
  (reload requis) ; `Input.dispatchKeyEvent`/`mousePressed` sur le select
  natif peuvent laisser la page bloquée (reload pour repartir).
- **Restant** : le script simulé 1.9.0 est resté installé dans le
  Tampermonkey du profil datasaver (la suppression batch a planté) — il
  s'auto-mettra à jour vers 1.12.0 au prochain check (preuve vivante du
  cycle) ; sinon le supprimer depuis le dashboard. Greasemonkey réel de
  l'utilisateur : introuvable dans les profils Firefox de la machine
  (aucun manager userscript ni le script) — la vérification finale
  (badge → clic → 1.12.0) reste un test manuel de 30 s côté utilisateur.

## Re-validation mobile doc-start + re-baseline stable soir (19 août ~19:30)

**Mobile — doc-start re-validé sur le build APK preview actuel (BlueStacks,
emulator-5554, APK `evenbetter-xcloud-1.12.0-preview1.apk` doc-start réinstallé) :**
- Sonde CDP (port 9342 forwardé sur `webview_devtools_remote_<pid>`) :
  `ebxInjected:true` (script inline AVANT les modules), `BX_EXPOSED`/
  `BX_FETCH` actifs, `window.STATES` exposé (patch 23), `settingsBtn:true`
  avec EXACTEMENT 1 bouton — **idempotence vérifiée au reload** (re-injection
  à chaque GET main-frame par shouldInterceptRequest, marqueur
  `__EBX_INJECTED__` empêche le doublon). GATE VERT.
- **nbRegions:0 / isSignedIn:false** : BlueStacks n'a AUCUNE session Xbox →
  les régions se peuplent au LOGIN (interception du POST /v2/login/user par
  XcloudInterceptor.handleLogin) — impossible de valider le peuplement sans
  session authentifiée. **Le téléphone (session réelle) est le seul device
  valide** : quand il est branché → install APK preview, forward, sonde.
- **Nouvelle sonde permanente `bench/mobile-regions-probe.js`** (remplace le
  .tmp) : usage documenté en tête de fichier (force-stop → start → forward
  localabstract → sonde), vérifie les marqueurs doc-start + état session +
  nbRegions, exit 0/1. Flux complet rejouable en une commande quand le
  téléphone revient.

**Stable — re-baseline complète `run-all.sh` (soir, build v1.12.0 inchangé) :**
**PASS 6/6, bornes CI tiennent.** Parse 0,125→0,135 ms (bruité) · IDLE ×10,5
(364,4→34,8 ns) · Home ×7,2 (1406,8→196,2 ns) · updateCanvas ×16,9
(239,9→14,2 ns) · updateFrame stable · éval page 28,2→25,6 ms (−9,2 %) ·
profil startup plat (getSupportedCodecProfiles sorti du load) · cold eval
528,7→33,9 ms (−93,6 %) · cold-getcap 526,3 ms one-shot (2e appel 0,1 ms).
Lignes ajoutées aux tables Sessions startup + Sessions hot loops de
bench/README.md (état bas).

## Injection APK vraiment document-start — shouldInterceptRequest (19 août ~17:30)

**Demande** : peupler les régions sur mobile aussi (le gap preview venait du
`evaluateJavascript` d'onPageStarted qui arrive APRÈS le `new` du client HTTP
SDK — celui-ci capture `fetch` par défaut de paramètre).

**Implémentation (mobile/src/com/bxperf/app/MainActivity.java)** :
- `BxWebViewClient.shouldInterceptRequest` : main-frame GET https sur les
  domaines xbox.com (POST login.live.com exclus — relayer le corps serait
  risqué) → `proxyAndInject()`.
- `proxyAndInject` : HttpsURLConnection (follow redirects, timeouts 8/15 s),
  UA du WebView transmise (sinon le site sert un HTML « navigateur inconnu »),
  cookies du jar transmis + **Set-Cookie rejoués** dans CookieManager (session
  intacte), gzip géré si le serveur l'envoie quand même, charset depuis
  Content-Type. Échec → null (chargement normal WebView).
- **Injection** : `<script>` inline juste après `<head>` — AVANT tout module
  ESM. **IIFE obligatoire** (le bundle a 6 `let`/`const` top-level : inline
  brut colliderait avec les globals du site → SyntaxError). `window.STATES`
  reste exposé car le bundle le fait EXPLICITEMENT (patch 23). Idempotence
  par `window.__EBX_INJECTED__` (le bundle n'a PAS de garde interne —
  double-injection = overlay dupliqué).
- **CSP retirée** de la réponse proxied (script-src sans 'unsafe-inline'
  bloquerait notre inline ; on contrôle la réponse, pas le site).
  Content-Length/Content-Encoding/Transfer-Encoding retirés (corps modifié).
- **Fallback conservé** : onPageStarted re-évalue en evaluateJavascript si
  `documentInjected` est false (cache-hit du document, proxy KO) — avec le
  MÊME marqueur __EBX_INJECTED__ → jamais de double run.
- Vérifié avant build : 0 occurrence de `</script` dans les 4 bundles
  (injection inline sûre), minSdk 24 OK (WebResourceResponse 5-arg = API 21+).

**Validé en réel (BlueStacks, adb, APK preview v1.12.0-preview1 rebuildé)** :
- `ebxInjected:true` (le marqueur inline a tourné — injection AVANT les
  modules), `BX_EXPOSED:true`, `window.STATES` exposé, `settingsBtn:true`
  (overlay rendu), `window.fetch` = wrapper du hook (le SDK preview capturera
  NOTRE fetch au `new`). `isSignedIn:false` sur BlueStacks (session Xbox
  absente de cette instance) → les régions se peupleront au login au 1er
  stream en session authentifiée (mécanisme déjà prouvé desktop en
  Tampermonkey document-start).
- Les 2 variants buildent (stable + preview), APK installé côte à côte.

**APK rebuildés** : `mobile/out/evenbetter-xcloud-1.12.0.apk` +
`evenbetter-xcloud-1.12.0-preview1.apk`. Pas de bump (vc 8 inchangé —
changement d'implémentation, même versionName).

## Session autonome 19 août ~15:15-15:45 — publication v1.12.0 + gap régions + re-baseline

Pendant l'absence utilisateur (double-BACK validé en réel : « ça quitte ») :

**1. Publication v1.12.0 + preview1 (garde-fou 10/10 vert) :**
- `evenbetter-xcloud-v1.12.0` (Latest) : better-xcloud.user.js (**ES2017**,
  politique v1.8.0) + meta + evenbetter-xcloud-1.12.0.apk + nom stable
  evenbetter-xcloud.apk (byte-identique, vérifié).
- `evenbetter-xcloud-v1.12.0-preview1` (pre) : preview user/meta + APK,
  pinné sur son tag.
- **Piège attrapé avant publication** : PREVIEW_VERSION de build-preview.js
  était resté **1.11.0-preview2** (bump manuel du bundle à 1.12.0-preview1
  sans rebuild via le pipeline) → le @updateURL pinné sur l'ANCIEN tag =
  auto-update preview cassé. Rebuild build-preview.js (commit f39aeb2) +
  es2017 preview + APKs reconstruits. ⚠ **Toujours rebuilder le preview via
  build-preview.js après un bump — jamais bumper le bundle à la main**.
- Rétention auto (workflow release-prune) : v1.11.0 + v1.11.0-preview2
  purgées, 1.8.0-preview4 conservée (cran de secours).

**2. Gap régions preview — cause racine identifiée (analyse statique) :**
- Le code du bundle EXISTE déjà et est correct : XcloudInterceptor
  .handleLogin traite `POST /v2/login/user` (gsToken + offeringSettings
  .regions → STATES.serverRegions + STATES.gsToken + selectedRegion), le
  routeur matche l'URL du preview (vérifié).
- **La vraie cause** : le client HTTP du SDK preview (classe `ub`,
  entry.client) capture `fetch` par DÉFAUT DE PARAMÈTRE (`i=fetch`) au
  moment du **new** (vérifié : un hook posé avant l'instanciation EST
  capturé). Sur l'APK (evaluateJavascript d'onPageStarted), l'injection
  arrive APRÈS les modules ESM → le SDK a déjà mémorisé le fetch natif →
  notre hook ne voit JAMAIS le login → régions vides. En Tampermonkey
  document-start, le hook précéderait le new → régions peuplées (à valider
  en réel). Le keepalive (60 s) passe par window.fetch (prouvé téléphone).
- Pistes : injection APK vraiment document-start (non trivial en WebView),
  login auto avec le token MSAL du preview (getAuthorizationHeader —
  Bearer, pas dans le corps contrairement au stable), ou intercepteur CDP
  (outillage, pas userscript). Détail : e2e-cdp.md « Gap régions preview ».

**✅ GAP RÉSOLU EN RÉEL (19 août ~17:30) — validation Tampermonkey document-start :**
- Le login ÉTAIT déjà intercepté en Tampermonkey (serverRegions peuplé,
  isSignedIn=true via l'événement `xcloud.server ready`) — le gap n'était
  PAS l'interception.
- **Vraie cause** : `var STATES` fuit sur `window.STATES` UNIQUEMENT en
  world MAIN (extension .edge-inject-stable). En Tampermonkey (sandbox
  IIFE), `window.STATES` est undefined → le test latence lit
  `(window.STATES && STATES.serverRegions) || {}` → « Aucune région
  disponible ». Même bug potentiel sur le STABLE en Tampermonkey pur.
- **Fix** : patch `patches/23-expose-window-states.patch` — ajoute
  `window.STATES = STATES;` après la déclaration STATES. Appliqué aux deux
  bundles (stable + preview). Rejouable : testé en réel sur play.xbox.com
  (profil datasaver, Tampermonkey BETA, stream Among Us 2560×1440) :
  **19 régions listées avec latence + ⭐ UKS 41 ms recommandée** — plus de
  « Aucune région disponible ».
- ⚠ Réinstallation Tampermonkey : servir le bundle LOCAL via HTTPS local
  (pas l'URL GitHub qui a l'ancien code) ; boutons ask.html = INPUT, pas
  BUTTON ; « Réinstaller » si même version.

**3. Re-baseline v1.12.0 (run-all.sh complet) : PASS 6/6** — parse 0,123→
0,128 ms, IDLE ×8,19, Home ×8,63, updateCanvas ×20,8, updateFrame stable,
éval page −11,9 %, **cold eval 574,9→25,6 ms (−95,5 %)**, cold-getcap 528 ms
one-shot. Ligne ajoutée à la table Sessions startup (19 août v1.12.0). Les
bornes CI tiennent — rien à corriger.

## Fix « Quitter ça revient » — BACK Android (19 août ~15:00, APK vc 8)

L'utilisateur ne pouvait pas fermer l'appli : après avoir quitté un stream,
le geste BACK **re-rentrait dans le stream** au lieu de fermer l'appli.
**Cause racine en 2 couches** (téléphone Xiaomi 14T, Android 16) :
1. **Back prédictif Android 13+** : `onKeyDown(KEYCODE_BACK)` n'est PLUS
   appelé (le geste passe par `OnBackInvokedDispatcher` et c'est le WebView
   qui gère tout seul → `goBack()`). Notre gestion BACK était morte sur
   téléphone moderne. Fix : `android:enableOnBackInvokedCallback="false"`
   dans AndroidManifest.template.xml → `onKeyDown` reçoit le BACK.
2. **`onKeyDown` naïf** : `webView.goBack()` tant que `canGoBack()` (SPA =
   7 entrées d'historique) → rembobinait l'historique du site et RETOURNAIT
   dans le stream. Fix : hors URL `/stream/`, plus de goBack() — **double-
   BACK** (toast « Appuyez encore pour quitter », fenêtre 2 s) → `finish()`.
   En `/stream/`, goBack() conservé (quitter le stream).
**Validé en réel (adb)**: BACK #1 → appli reste (focus MainActivity),
BACK #2 à 1 s → appli fermée (focus rendu à l'appli précédente). Piège de
re-test : avec `sleep 2` entre les deux BACK, la fenêtre `< 2000 ms` est
ratée de justesse → re-toast (tester à 1 s). Preuves :
`mobile/validation-phone-back-fix-state.png` / `-toast.png`.
⚠ `VARIANT=preview bash build.sh` (env, pas argument) — `bash build.sh
preview` build le STABLE silencieusement. APK installé sur le téléphone :
`evenbetter-xcloud-1.12.0-preview1.apk` (vc 8, signé même clé, update in
place, session conservée).

## v1.12.0 — Feature « ⚡ Appliquer la meilleure région » — 19 août ~20:00

Suite logique du test latence (v1.10.0) : un bouton « Appliquer la meilleure
région » dans le groupe SERVER, sous le test. Après un test de latence, il
affiche la meilleure région mesurée et pose `server.region` (pref GLOBALE,
valeur = la CLÉ de la région dans STATES.serverRegions, ex. « CSE » — pas
shortName qui contient l'emoji drapeau) via `setGlobalPref(key, "ui")`.

- **`bench/feature-region.js`** (gates + self-test) : injecte `BX_REGION_APPLY`
  + PATCHE le test latence en 2 points minimaux (results.push → + `key`;
  fin de run → `lastResults` mémorisés + refresh du bouton en direct). Les
  ancres des 2 patches sont extraites du SOURCE de feature-latency.js.
- **`bench/feature-region.test.js`** (gate CI, step preview de bench.yml,
  après feature-datasaver) : présence stable+preview, 4 ancres, rejeu +
  self-test (corruption de la forme PATCHÉE — le bundle est déjà injecté,
  corrompre l'ancre brute ne ferait rien).
- **`bench/feature-region-probe.js`** (CDP, www.xbox.com/play) : simule
  lastResults (pas de vrai ping gssv — jusqu'à 30 s), vérifie état initial
  (bouton désactivé + message d'attente), clic → pref + persistance,
  « déjà appliquée », restauration de la valeur d'origine. **Probe 100 %
  vert en réel (15/15) sur la page live v1.12.0.**
- **Piège rendu dialog** : le dialog attache le groupe APRÈS le rendu des
  items → un refresh synchrone trouve rien. Solution : état par défaut
  SYNC (bouton disabled + texte d'attente) + waitReady pollé borné 6 s qui
  upgrade si des résultats existent (ré-ouverture settings).
- **Piège CRLF (Windows)** : le strip d'une feature du bundle échoue si les
  ancres extraites (LF) sont cherchées dans le bundle (CRLF) — normaliser
  avant tout strip/comparaison (déjà connu pour les gates, appliqué aussi
  au strip manuel).
- **Piège MV3 cache** : modifier stable.js de l'extension ne suffit pas —
  Edge sert une copie compilée. Bump manifest (version) + kill + purge
  `edge-profiles/datasaver/ScriptCache` + relance, sinon on débogue une
  version périmée (le vrai coupable des « status vide » initiaux : la page
  tournait encore la 1re version).
- **Datasaver gate adapté** : le strip de feature-datasaver.test.js
  supposait son IMPL ADJACENT à l'ancre BX_EXPOSED — cassé par l'ajout de
  la région (les features s'empilent sur la même ancre). Fix : retrait de
  la plage [ancre … fin d'IMPL data] (robuste à N features).

Version bumpée 1.12.0 / 1.12.0-preview1 (VERSION, bundles, metas, manifest
APK versionCode 6). Tous les gates CI verts en local (region, datasaver,
t10, keepalive, p2-schema, pr-comment-merge, Étape 0). Prochaine étape :
publier la release v1.12.0 + APK (bump --build-apk) et le rappel de la
validation sur téléphone si besoin.

## Compatibilité Freebox Pop / Android TV — 19 août ~14:15 (sieste utilisateur)

La box (Android TV 9, AOSP System WebView ~Chromium 61) ne supporte PAS
l'optional chaining du bundle moderne → l'APK moderne plantait (scénario
« ne fait rien » du 19 août). Pendant la sieste de l'utilisateur :

- **Double bundle embarqué** : `mobile/build.sh` embarque le build moderne
  + sa transpilation **ES2017** (`better-xcloud.es2017.user.js` /
  `better-xcloud-preview.es2017.user.js`). `bench/es2017-build.mjs`
  paramétrable (`--src`/`--out`), les deux transpilations régénérées par
  `bench/bump-version.sh` au bump.
- **Choix au runtime par l'UA** (`MainActivity.chooseBundle`) :
  `Chrome/≥80` → moderne ; `<80` ou pas de token Chrome (vieux AOSP) →
  es2017. SYNCHRONE (un `ValueCallback` asynchrone plante le d8 34.0.0).
- **Défauts « box » une fois** (TV détecté via `UI_MODE_TYPE_TELEVISION`) :
  preset Économe (5 Mbps + 720p) + animations réduites + pas de fusée,
  posés dans le localStorage du script avant injection (`_bxTvDefaults`,
  idempotent).
- **D-pad → clavier** (`onKeyDown`, TV only) : UP/DOWN/LEFT/RIGHT/CENTER/
  ENTER → `Arrow*`/`Enter` dispatchés à la page + `click()` sur l'élément
  actif pour Enter (le D-pad natif ne fait que le focus HTML).
- **Leanback** : `LEANBACK_LAUNCHER` + bannière TV 320×180
  (`mobile/gen-tv-banner.js`, réutilise le décodeur PNG de gen-icon.js
  paramétré par taille) + `hardwareAccelerated=true`.
- **Validé (14:00-14:15)** : les 2 APK (stable 1.12.0 + preview 1.12.0-preview1)
  buildent avec l'es2017 embarqué + badging leanback OK. **BlueStacks
  (Tiramisu64, adb connect 127.0.0.1:5555) : install stable → `bundle
  choisi: modern`, `mobile-probe.js` SONDE OK** (BX_EXPOSED object,
  BX_FETCH function, bouton settings présent + visible). Logique UA 4/4
  (Chromium 61 → es2017, Chrome/120 → modern, sans token → es2017, iOS →
  es2017). es2017 exempt de `?.`/`??` hors template literals (texte, jamais
  parsé par le vieux moteur).
- **Piège re-rencontré** : `VARIANT=preview build.sh` purge `mobile/out/` →
  l'APK stable buildé avant est perdu (rebuild stable après).
- **À tester en réel sur la box** (non disponible ici) : stream xCloud sur
  le vrai AOSP WebView — si écran noir, `adb logcat -s EvenBetterXcloud`.

## Validation téléphone preview v1.12.0-preview1 (19 août ~14:30) — FAB ✓, bouton région présent, GAP régions preview

`bump --build-apk` (vc 7→8) → APK preview `evenbetter-xcloud-1.12.0-preview1.apk` installé sur le téléphone (update in place, session conservée) → stream Beast of Reincarnation lancé en réel (tap CDP → dialog « Préparons-nous » → « Se connecter ultérieurement » → `play.xbox.com/stream/9NXWSWBM4H6T`).

**Validé en stream (CDP via adb forward) :**
- FAB visible en stream (badge « 🇬🇧 UKS »), tap réel → dialog settings complet.
- « ⚡ Appliquer la meilleure région » présent (disabled + « Lancez d'abord… ») + « 📡 Tester la latence des serveurs » + BX_REGION_APPLY/BX_LATENCY_TEST injectés (object).
- Pièges CDP WebView : un `element.click()` JS ne suffit PAS (le FAB/cartes écoutent les événements pointer réels) — utiliser `Input.dispatchMouseEvent`/`Input.dispatchTouchEvent`. Piège package preview : l'activity est `com.bxperf.preview/com.bxperf.app.MainActivity` (classe Java toujours com.bxperf.app).

**GAP RÉEL découvert (preview)** : `STATES.serverRegions` reste VIDE sur play.xbox.com (le test latence affiche « Aucune région disponible ») alors que le client stable les charge. Cause : le protocole gssv du preview (login/user → offeringSettings.regions) s'exécute dans le **service worker** (entry.worker.js) — notre hook fetch page (XcloudInterceptor.handleLogin, qui peuple DÉJÀ serverRegions+selectedRegion depuis `/v2/login/user`) ne voit jamais ces appels. De plus `GSSV_TOKEN` est lu de `xboxcom_xbl_user_info` (localStorage du client STABLE) — clé absente sur play.xbox.com → même le bootstrap xhome du script échoue (« Could not get GSSV_TOKEN »). Le compte est pourtant connecté (XUID/msal présents, stream tourne). Les régions du client preview ne sont pas non plus accessibles depuis la page (état React, rien dans globals/localStorage).
- **Impact** : la feature 📡/⚡ région (v1.10/v1.12) est fonctionnelle sur le STABLE (probe 15/15 sur www.xbox.com), mais inopérante sur le preview tant que les régions ne sont pas pontées. Fix possible : (a) pont SW → page des régions, (b) source token gssv alternative pour le bootstrap xhome du script, (c) hook réponse du login/user côté SW. À décider — c'est un vrai manque à combler pour que le bouton soit utilisable sur play.xbox.com.
- Preuve : `mobile/validation-phone-v1120p1-region-btn.png` (dialog ouvert sur téléphone avec le bouton).

## Mesure latence FAB téléphone réel (19 août ~14:45) — jamais disparu, aucun remplacement de document

Rejeu de la séquence quitter → relancer un stream (Beast of Reincarnation) sur le téléphone, avec traque `documentElement` (identité) + FAB à 250 ms via CDP :

- **Chemin 1 (relancer depuis la home)** : t0 = URL `/stream/` à +1,2 s après le tap ; vidéo live à ~+7 s ; **FAB présent à +1 s ✓, +3 s ✓, +8 s ✓ et en continu** — **aucun remplacement de document** (identité de `documentElement` inchangée), FAB jamais disparu.
- **Chemin 2 (page produit → « Préparez-vous à streamer »)** : t0 à +0,8 s, vidéo à ~+6 s, **même verdict : FAB stable, aucun remplacement**.
- **Interprétation** : le remplacement de document observé les 17/19 août était sur **desktop Edge + BlueStacks (émulation 390 px)** — sur le téléphone réel, le shell SPA navigue sans `document.open` sur ces chemins (ou le re-arm T7 rattrape en < 250 ms). La « latence de réapparition » est donc **nulle sur l'appareil** : rien à ré-apparaître. Les sondes +1/+3/+8 s demandées sont toutes `true`.
- **Piège réseau WebView rencontré** : après force-stop + relance, la page affichait « You're offline » persistant (fetch même même-origine = « Failed to fetch ») alors que `ping 8.8.8.8` passait ; DNS/SSL flaky dans logcat (`Failed to read DnsConfig`, handshake failed). Seul un **force-stop + relance complet** a rétabli le réseau WebView (un simple reload n'y suffisait pas). Point de robustesse pour la box/téléphone : un état « offline » WebView persistant = redémarrer l'app, pas la page.
- Preuve : `mobile/validation-phone-fab-latence-stream.png` (stream 1280×720 live + FAB visible).

## Harnais d'instrumentation écran noir — bench/stream-instrument.js (19 août ~15:00)

Outillage pour capturer l'événement EXACT d'un éventuel écran noir sur le téléphone/box pendant un stream (CDP brut, WebSocket natif) :

- **États video** : readyState, paused, currentTime, error, dimensions — sondés chaque seconde.
- **Frames réellement présentées** via `requestVideoFrameCallback` (presentedFrames, `--interval` 250 ms-1 s) → **détection freeze** : 0 frame présentée pendant ≥ 2 polls alors que la vidéo joue = FREEZE_CANDIDAT (bisect compositor vs décodeur : rVFC qui avance + écran noir = souci rendu/composition ; rVFC bloqué = décodeur/réseau).
- **Événements page** (délégation document, survit au remplacement de document) : video error/stalled/waiting/emptied, window error/unhandledrejection, visibilitychange, + événements RTCPeerConnection (wrap du constructeur, connexions futures).
- **CDP** : Runtime.exceptionThrown, Log.entryAdded, Network.loadingFailed (filtrés gssv/xbox, bruit d'injection exclu via T0).
- **getStats WebRTC** (framesDropped/packetsLost/jitter/ice/conn) : best-effort — PC de session courante introuvable par walk des fibres (le PC vit dans le SDK, pas dans l'état React accessible ; `STATES` n'est même pas sur window sur le preview) → le wrap couvre les sessions SUIVANTES.
- Sortie : JSONL (gitignoré) + résumé. Usage : `node bench/stream-instrument.js [--port 9231] [--duration 300] [--interval 1000] [--out ...]`.
- **Validé en réel (19 août ~14:50-15:00, téléphone, Beast of Reincarnation 1280×720)** : 2 fenêtres propres (30 s + 60 s + 15 s), **0 anomalie**, ~59-61 fps présentés en continu, zéro exception JS après T0, zéro échec réseau gssv — la session du jour n'a PAS reproduit l'écran noir (déjà le cas à 14:45). Les seuls événements CDP notables sont au démarrage de l'injection (télémétrie `Failed to fetch`, bruit connu).
- **Piège relevé** : le WebView CDP HTTP peut ne pas répondre après une longue session (forward à recréer, parfois 2 essais). Le PC de la session en cours n'est pas accessible (pas de `window.STATES` sur le preview, `BX_EXPOSED.streamSession` absent) — la preuve de santé passe par rVFC, pas par getStats pour la session courante.

## Réorganisation du workspace (19 août ~11:30) — tout sous EvenBetterXcloud

Plus rien de nos outils à la racine `D:\Codex` ni à `D:\edge-profiles` :
- `D:\Codex\EvenBetterXcloud\better-xcloud-fork` (repo de travail — déplacé),
  `…\better-xcloud-upstream` (clone amont PR), `…\bx-apk` (build APK +
  keystore), `…\bx-android-ref` (référence Android).
- `…\edge-profiles\` (edge-cdp, guard-badge, datasaver — venus de
  `D:\edge-profiles`).
- `…\artifacts\` (banner-dl, badge-proof png, anciens bundles/APK),
  `…\legacy\` (anciens harnais v1.6 : gpubench, patches, regen*, …).
Chemins mis à jour dans : verify-badge.js (DL_DIR/proof/load-extension),
update-startup-session.js, gpu-update-readme.js, mobile/build.sh
(ORIG_KEYSTORE), mobile/README.md, upstream-prs/README.md, MEMORY.md,
bench/README.md. ⚠ Piège : `D:\Codex\.git` est le repo git du projet
utilisateur ratio-spoof-manager-tauri — ne pas y toucher (rien de nous n'y
est tracké). ⚠ Le dossier vide `D:\Codex\better-xcloud-fork` (verrou
Windows : cwd d'un process) reste tant que la session n'est pas finie — il
est VIDE et sans conséquence. Edge de test relancé depuis
`D:\Codex\EvenBetterXcloud\edge-profiles\datasaver` + extension
`.edge-inject-stable` (dans le repo) : feature-datasaver-probe 20/20 vert
après le déplacement.

## v1.11.0 — Feature « 📊 Données » (presets débit/résolution) — 19 août

- **Feature utilisateur** (hors perf, la queue JS étant au plancher) :
  `bench/feature-datasaver.js` injecte un groupe « 📊 Données » dans les
  settings (pattern feature-latency : gates + self-test + idempotence).
  3 presets basés sur nos mesures réelles : 🚀 Max (illimité),
  ⚖️ Équilibré (cap 10 Mbps, 1440p conservé) et 🌱 Économe (5 Mbps + 720p).
  Visible même déconnecté (ajout au filtre renderFullSettings=false).
- **Piège storage** : `stream.video.*` sont des prefs **GLOBALES**
  (ALL_PREFS.global) — `getStreamPref`/`setStreamPref` THROWE pour ces clés
  (définitions absentes du storage stream). Utiliser
  `getGlobalPref`/`setGlobalPref(key, value, "ui")`.
- **Piège maxBitrate** : la pref a `transformValue` (max slider 15360000 ↔
  stocké 0 = illimité). Écrire 0 → clampé à 102400 (min) ! Le preset « Max »
  écrit **15360000** (la forme get persistée par setSetting est 15360000,
  équivalente au défaut 0 — le stocké 0 n'est que le défaut initial).
- **Validé en réel** (Edge guard-badge, `feature-datasaver-probe.js`) :
  15 checks verts — groupe rendu, 3 presets, clic Équilibré → prefs posées
  (10240000/auto, persisté), restauration Max → 15360000 (illimité).
  Piège extension : `stable.js` est lu au **démarrage** d'Edge — copier le
  bundle ne suffit pas, il faut relancer Edge (ou le fichier est servi
  périmé ; un onglet restauré de session peut aussi ne pas re-injecter).
- **Build-preview.js** : les ancres `@version` et header OPTIMISATIONS
  étaient durcies à 1.10.0 → rendues **dynamiques** (stableVersion extraite
  du bundle source) pour survivre aux bumps.
- **Bump centralisé** `bash bench/bump-version.sh 1.11.0` : stable 1.11.0,
  es2017 −16,2 %, preview 1.11.0-preview1 (rebuild build-preview + probes
  OK), metas, manifest versionCode 5. APK stable (es2017 embarqué) +
  preview rebuildés. README FR/EN mis à jour (table Deux versions →
  1.11.0 / 1.11.0-preview1).
- **⚠ Piège CDN GitHub (nouveau, 19 août)** : juste après une publication, le
  lien public `releases/download/<tag>/better-xcloud.user.js` peut 404
  (XML Azure `BlobNotFound`) pendant **plusieurs minutes** — le redirect
  302 du CDN pointe vers un blob stale (les autres assets du même tag
  servent 200, et l'API `Accept: application/octet-stream` sert le bon
  blob). Le garde-fou release peut donc **faux-positiver** immédiatement
  après une publication : attendre ~10-30 min puis relancer
  `bash bench/release-guard.sh`. Si le 404 persiste : supprimer/recréer la
  release (le tag reste) et re-tester. Autre piège : le rename `#` de
  `gh release create`/`upload` ne fonctionne PAS avec des chemins relatifs
  (l'asset garde le nom source) — passer par des copies /tmp avec le nom
  cible exact.

## v1.11.0-preview2 — icône APK officielle + fix overlay preview (19 août ~13:00)

- **Icône APK depuis le logo officiel** (fourni par l'utilisateur, banner
  1024×559 « EvenBetterXcloud ») : `mobile/gen-icon.js` réécrit — décodeur
  PNG pur Node (zlib + unfilter), découpe de l'emblème (anneau + X vert,
  détecté x 341-681 y 44-384, centre (511,214), texte sous le cercle exclu),
  512×512 coins arrondis, repli sur l'ancienne icône procédurale si le
  banner manque. Source committée : `mobile/assets/evenbetterxcloud-logo.png`
  (exception .gitignore `mobile/assets/*` + négation — un répertoire exclu
  ne peut PAS ré-inclure un fichier dedans).
- **Fix overlay preview — « des fois pas de menu »** : reproduit en WebView
  (BlueStacks, 390 px) — quand le shell preview remplace le document
  (document.open au démarrage du stream), l'observer T4 meurt (il observe
  l'ancien body) et le FAB ne revient JAMAIS (reproduit : FAB false après
  remplacement, sans fix). Fix dans build-preview.js : `arm()` réutilisable
  (re-crée l'observer sur le document courant) + point 3 dans l'interval T7
  (re-arm si documentElement change d'identité + ré-injection tryInject si
  wrapper détaché). Validé en réel BlueStacks : FAB revient en 7 s après
  document.open, clic → dialog OK. Tests CI (feature-datasaver, t10,
  keepalive, self-test) verts.
- **Livré** : commits `1283528` (self-test feature-datasaver + fix CRLF/LF)
  et `f2ea3ce` (icône + fix T4 + bundle preview2), poussés. Release
  `evenbetter-xcloud-v1.11.0-preview2` (bundle preview2 + meta + APK),
  APK stable re-uploadé sur v1.11.0 avec la nouvelle icône (les DEUX noms
  d'asset : versionné + stable, mêmes bytes). Garde-fou 10/10 vert, rétention
  OK (v1.11.0 + preview2 + preview4 secours).
- **Piège build** (rappel) : `VARIANT=preview bash mobile/build.sh` purge
  `mobile/out/` (rm -rf $OUT) → l'APK stable builté avant est perdu.
  Toujours rebuild le stable APRÈS le preview, ou copier l'APK stable avant.
- **Restant utilisateur** : tester preview2 sur téléphone — si l'écran noir
  vidéo persiste (le menu, lui, est corrigé), capturer logcat
  (`adb logcat -s EvenBetterXcloud`) pendant le stream noir pour diagnoser.

## Gate CI feature-datasaver — validation PR #17 (gate ROUGE en réel, 19 août)

- **`bench/feature-datasaver.test.js` branché au step preview de bench.yml**
  (job `hotloops-ratios`, étape « Build preview — contrat deux versions ») :
  présence feature stable+preview, ancres d'injection extraites DEPUIS
  feature-datasaver.js (une const renommée = extraction échoue = rouge),
  rejeu d'injection + self-test sur copie strippée.
- **Validation ROUGE en réel (PR #17 `ci/control-gate-datasaver`)** : ancre
  `ANCHOR_GROUP` corrompue dans le bundle stable (`t("server")` →
  `t("server_CHANGED")`, 1 occurrence — scénario « rebuild dérivé »).
  - Pré-validation locale : 3 échecs, exit 1.
  - Run CI push `32237377296` : job `hotloops-ratios` → **failure** au step
    « Build preview », log : `❌ ancre groupe server ×1 :: n=0`,
    `❌ copie sans feature obtenue (injection inversée, ancres revenues)`,
    `❌ rejeu non exécuté (strip invalide)`, `3 échec(s) Feature Data saver`.
  - PR fermée avec commentaire de validation, branche supprimée (local +
    distant), run PR orphelin resté « queued » annulé. main == origin/main.
- **`--self-test` (commits 1283528)** : corrompt l'ancre ANCHOR_GROUP sur une
  COPIE temporaire et vérifie le GATE ROUGE (exit 0 si détecté, bundle réel
  intact) — le chemin d'échec est rejouable localement sans PR de contrôle.
  ⚠ Piège CRLF/LF découvert en route : le bundle sur disque est CRLF
  (autocrlf Windows) vs source LF → normalisation avant comparaison, et
  regex `([^]*?)` au lieu de `[\s\S]`.

## Harnais preview — réécriture injection (18 août ~07:00)

- **`inject-preview.js` réécrit en WebSocket CDP brut + wrapper IIFE** :
  Playwright `newCDPSession` + `Page.addScriptToEvaluateOnNewDocument` ne
  fonctionne PAS sur Edge 152 (script jamais appliqué aux nouveaux
documents — vérifié par tests croisés ; le CDP brut WS, si).
  **Wrapper IIFE obligatoire** (mécanique Tampermonkey) : le preview
  déclare des classes top-level (`HeaderSection`, `KeyHelper`…) qui
  **collident avec les bundles ESM du site** en injection directe et
  cassent l'évaluation des modules (page blanche, `scripts:0`). Le probe
  ne lit que `BX_FETCH`/`BX_EXPOSED`/`BX_CE` (assignés à window) → IIFE
  sûr.
- **Fixes document-start dans le build** (les deux se produisent quand
  `document.documentElement` est null — jamais en Tampermonkey, mais le
  contexte d'injection CDP les expose) :
  - `BxSelectElement.ensureObserver()` : `observe(document.documentElement
    || document, …)` — crash « parameter 1 is not of type 'Node' » qui
    tuait `main()` avant le hook fetch → « aucun overlay ».
  - `addCss()` : `if (document.documentElement) …appendChild($style);
    else document.addEventListener("DOMContentLoaded", …)` — le premier
    fix `|| document` (append direct sur le noeud document) **corrompait
    l'arbre et vidait la page** (page blanche, uniquement notre `<style>`,
    `scripts:0` — bisect 4 variantes : control/full/noaddcss/orig).
    Le différé DOMContentLoaded est le bon fix : site boot 3297 nodes +
    hook fetch installé.
- **Validation finale sur profil D:** (18 août ~07:20) : injection WS brut
  document-start sur onglet play.xbox.com neuf → site boot complet
  (3297 nodes, 7 scripts), `bxFetch: function`, bouton présent. Les 4
exceptions restantes viennent toutes du **document initial about:blank**
(hostname vide → garde « Not xCloud page » + 3 fetch) — bruit attendu sur
profil déconnecté, zéro exception sur la page réelle.
- **Profil de test sur D:** (18 août) : `D:\Codex\EvenBetterXcloud\edge-profiles\edge-cdp`
  (plus jamais C:\edge-*) ; relance Edge : `powershell -Command
  "Start-Process '…msedge.exe' -ArgumentList
  '--remote-debugging-port=9222','--user-data-dir=D:\Codex\EvenBetterXcloud\edge-profiles\edge-cdp',
  '--no-first-run'"`.

## Projet

Fork better-xcloud (redphx) avec **deux versions contractuelles** :
- `better-xcloud.user.js` (stable, www.xbox.com) — upstream.
- `better-xcloud-preview.user.js` (preview, play.xbox.com) — build depuis le
  stable via `bench/preview/port/build-preview.js` (transforms T1-T6).
  `@name`/`@version`/`@updateURL`/`@match` disjoints (invariants au build).

Bench rejouable : `bench/` (CPU/GPU/startup) + `bench/preview/` (portage).

## État preview (17 août)

- **T6** : garde « Not xCloud page » neutralisé sur preview (il tuait `main()`
  → « aucun overlay » constaté sur preview1).
- **P2/P3 réécriture** (XcloudInterceptor, hook fetch posé en document-start) :
  prouvée en vm (fetch-early 17/17, userscript-rewrite 14/14) ET **actifs en
  réel** (chaîne `window.fetch` = hook T5 → `BX_FETCH` → NATIVE_FETCH, SDK
  capture la chaîne). Play : `osName=tizen` (1080p) + `x-ms-device-info`.
  Réponse `/configuration` : fusion `enableVibration`/mkb/mic dans
  `clientStreamingConfigOverrides` (schéma Zod validé — p2-schema.test.js).
  **A/B P3 mesuré 17 août** : résolution (contrôle propre GUID neuf
  1156AA48, `observe-play.js`) ET bitrate (`bitrate-check.js`, 3 échantillons
  ×12 s par profil) — natif windows = **1920×1080 @ 60 fps, ~5,95 Mbps**,
  tizen = **1920×1080 @ 60 fps, ~5,75 Mbps** → **P3 sans gain mesurable en PC
  cloud gaming** (résolution ET bitrate identiques).  **Décision : retirer
  l'override osName=tizen — APPLIQUÉ au build preview3 (17 août)** : patch T8
  de build-preview.js (condition de réécriture → `if (false)`, le play part
  natif) ; `intercept-session.js` devient **observateur passif** (`[P3] play
  observé → osName=… · device-info os=…`, continué SANS modification) ;
  `userscript-rewrite` vérifie le play inchangé + P2 toujours fusionné. P2
  (fusion /configuration) reste le vrai bénéfice ; `--resolution` est un
  no-op documenté. Les fonctions de réécriture restent en référence (tests). **Validé en réel (preview3, 17 août ~19:30,
  profil edge-cdp)** : extension `.edge-inject` à jour, overlay + settings OK
  (bouton `nav.col-container`, dialog « Better xCloud 6.7.12 »), play
  observé **natif** (`[P3#1] osName=windows, non réécrit`) — journal :
  e2e-cdp.md « Validation preview3 en réel ». Piège reprise : le slot de session est lié au
  compte/titre — navigation home, redémarrage Edge ET `session.disconnect()`
  ne changent pas le GUID (7C346491 persistant) ; seul un 2e onglet (kick) ou
  un long délai libère le slot.
- **T9 — settings dans la game bar (17 août ~21:45, build preview4)** : la
  page stream du preview est immersive, SANS `<nav>`/header (navs:[] observé)
  → le T4 n'a pas d'ancre en session, settings inaccessibles en cours de
  jeu. Fix (build-preview.js, preview-only) : `SettingsAction extends
  BaseGameBarAction` (engrenage `BxIcon.STREAM_SETTINGS`, title
  « Settings », onClick → `SettingsDialog.getInstance().show()`) injectée en
  2e position de `this.actions` du GameBar. **Validé en réel** (profil
  edge-cdp, Halo CE) : bouton dans la bar, dialog complet ouvert en stream
  (498×1440, 5 onglets, 66 lignes), Escape ferme, session intacte. Journal :
  e2e-cdp.md « T9 ».
- **P1 keep-alive idle** : `keepalive-idle.js` (T5). **Verdict 16 août** : le
  module StreamSessionRequest est chargé en **ESM natif** → le hook fetch ne
  peut pas se brancher ; **wrapSession est la seule voie runtime**.
  **Localisation résolue 17 août** : la session est dans l'état React du
  stream (fibre `.Connection` → chaîne `memoizedState.next…` →
  `memoizedState.data._session`, objet avec sendKeepAlive +
  onServerDisconnectMessage) — outils find/dump/hunt-session.js + **locator
  auto dans le build** (walk par forme, wrap dès montage, 16/16 tests).
  `session.stream` null si stream fermé (le gate getInputChannel() de
  sendKeepAlive ne s'applique qu'en stream actif). Le heartbeat natif
  /keepalive (60 s) est complémentaire (connexion), pas un substitut
  (timer d'idle = inactivité utilisateur).
- **hookActif en réel (edge-cdp)** : le profil NE PEUT PAS exécuter d'userscript
  (Tampermonkey MV3 exige le mode développeur d'Edge, inactivable en CDP).
  Solutions : (1) mini-extension `.edge-inject/` (`content_scripts` +
  `world:"MAIN"` + `document_start` — équivalent `@grant none`), lancée avec
  `--load-extension=…\.edge-inject` ; (2) **`inject-preview.js` (WS brut
  + IIFE, 18 août)** — le Playwright `newCDPSession` n'applique pas
  `addScriptToEvaluateOnNewDocument` sur Edge 152 ; le WS brut si.
  **Wrapper IIFE requis** (collisions de classes top-level avec les bundles
  du site) ; les crashs document-start (`ensureObserver`, `addCss`) sont
  corrigés dans le build (voir section « Harnais preview »).

## Protocole E2E (e2e-cdp.md)

- **Étape 0** (hors-navigateur, avant les runs CDP) : `run-e2e0.sh` — gates
  A fetch-early / B userscript-rewrite / D play-chain (échec si rouge) + probe
  C (info par défaut).
  - **`--strict-probe` = gate C dur** : exige `hookActif:true` (navigateur
    injoignable, hookActif:false ou Playwright absent → exit 1 + GATE C ROUGE).
    **Usage** : session réelle exigeant la preview T6 active avant un run CDP.
  - **`--self-test`** : rejoue le chemin d'échec sur une COPIE corrompue du
    build (GATE A/B ROUGE + exit 1 vérifiés, build réel intact).
  - **`--skip-probe`** : CI (pas de navigateur CDP sur le runner).
  - **Critère de départ des runs T6 (Run 1, P1-B) : `run-e2e0.sh
    --strict-probe` exit 0 = A+B+C+D avec hookActif:true, sinon AUCUN run**
    (section « Critère de départ » d'e2e-cdp.md). Exceptions : Run 0 témoin
    (hookActif:false OK). Exécutions journalisées : 1-3 + run strict 17 août
    (A+B+C+D, hookActif:true).
- **Run 1 CDP** : `intercept-session.js --connect=9222` — `[P3]` play réécrit,
  `[P2-staging]` puis `[P2]` sur la réponse /configuration (C4 =
  `enableVibration:true` dans Network, preuve CDP). **P2 VALIDÉ en réel**
  (17 août ~12:43, run 1 exécution 3 — preuve session live
  `_configuration.inputConfiguration.enableVibration:true`, voir item 2 de
  « En attente »). Prérequis : Étape 0 `--strict-probe` passée.
- **P1 réel** : `monitor-idle.js` — **DÉCISION CLÔTURÉE** (17 août) : fenêtre
  1 h survivante sans warning → seuil d'idle > 60 min, wrapSession branchée
  (`wrapped:true`), risque résiduel accepté (voir item 3 de « En attente »).

## État stable v1.8.0 — RELEASED (17 août)

- **USM 4 taps WebGL2 intégré** (patch 22) : re-mesure seed 42 du **build réel**
  (`gpu-v170-usm-webgl2player.txt`) — draw 10,24 → 7,17 µs (**−30,0 %**),
  identique au prototype. Patch généré dynamiquement
  (`patches/gen-patch-22.js`) : numéro de ligne calculé depuis le patch global
  (283, pas 281 codé en dur) + **hunk 3 lignes avec contexte** (un hunk
  zéro-contexte est refusé par git apply sur ligne géante même contenu
  identique). Piège : `git apply` **hors repo no-op silencieusement** — lancer
  depuis la racine du repo.
- **USM WebGPU : REJETÉ** — 4 taps mesuré **PLUS LENT** sur Dawn/D3D12 (s42
  +7,1 %, s99 +3,0 % ; harnais `gpu-runner-webgpu.js`, batch hors-écran 1080p,
  `onSubmittedWorkDone` car timestamp queries mortes sur Edge 152). Le gain
  WebGL2 était spécifique à ANGLE/D3D11. Build reverté, pas de patch 23 —
  le shader WebGPU garde le 9 taps.
- **Validé visuellement** (`bench/gpu/visual-diff.js` + `report-html.js`) :
  gate v1.6.0 (9 taps) → v1.8.0 (4 taps) sur texte fin — identité sharpness 0
  bit-identique (maxAbs 0), équivalence ±1-ULP fp32 sur ≤ 0,002 % des pixels
  (640×360 et 960×540). Le diff perf10 → v1.8.0 (maxAbs 44-74, ~0,4 %) vient
  du chemin d'upload (texImage2D → texStorage2D/RGB8), pas du patch 22.
  Sortie images par cas (screenshots 3 variantes, diff mask, montage, heatmap
  16×9 → `shots/`) + rapport HTML autonome (base64). Seeks ordonnés en t
  croissant + retry + échec dur (seek arrière → currentTime remis à 0).
- **Gate CI gpu-upload** : visual-diff (exit 0/1) + report-html (`if:
  always()`) + artefacts visual-diff-<sha> (rapport + shots/) — validé E2E le
  17 août (dispatch 32026644870 : protocole ×1,80, gate visuel PASS).
  **RESTE pour boucler la v1.8.0** : sanity check session réelle optionnel.

## Releases & pipeline de publication

- **ÉTAT COURANT (19 août ~18:30)** : **v1.12.0** (Latest,
  `evenbetter-xcloud-v1.12.0` — user.js ES2017 + meta + APK versionné +
  nom stable `evenbetter-xcloud.apk`, sha 928b6ea byte-identiques) ·
  **1.12.0-preview1** (`evenbetter-xcloud-v1.12.0-preview1` — preview
  user/meta + APK) · **1.8.0-preview4** (cran de secours). 4/4 liens
  d'auto-update 200 + byte-identiques (garde-fou 10/10 vert, relancé après
  le re-upload des APK doc-start). README FR/EN alignés sur v1.12.0 /
  1.12.0-preview1 (passe de cohérence 19 août ~19:00). Les paragraphes
  ci-dessous sont l'historique depuis le 17 août — la section « En attente »
  + `upstream-prs/README.md` portent l'état vivant.
- **État au 17 août ~23:30 (rétention appliquée, historique)** : 12
  anciennes releases purgées (v1.0.0 → v1.7.0 stables, 1.7.0-preview1,
  1.8.0-preview1/2/3).
  Restent : **v1.8.0 (stable, Latest)** — tag `better-xcloud-perf-v1.8.0`,
  assets `better-xcloud.user.js` + `better-xcloud.meta.js`, auto-update
  `releases/latest/download/*` ; **1.8.0-preview4 (preview courant)** — tag
  `better-xcloud-perf-1.8.0-preview4`, assets `better-xcloud-preview.*`,
  auto-update preview **pinné sur SON tag** (jamais le latest — un utilisateur
  d'une preview ANCIENNE réinstalle manuellement).
- **Rétention automatisée** : `bench/release-prune.sh` — garde Latest + **les
  2 derniers previews** (tri par VERSION numérique, jamais `publishedAt`
  trompeur pour une release recréée) + le tag pinné par le `@updateURL` du
  build local, purge le reste (release + tag, `--cleanup-tag`), vérifie les 4
  liens d'auto-update (GATE ROUGE si 404), `--dry-run` pour prévisualiser. À
  lancer après chaque publication (le workflow `release-prune` le fait
  automatiquement sur `release: published`). **Testé en réel (17 août ~23:10,
  release de contrôle preview10)** : le tri par VERSION choisit bien
  preview10 (et non preview4 — piège lexicographique « 1 » < « 4 ») +
  conserve le pinné preview4 ; le test a révélé que le bit exécutable du
  script n'était PAS versionné (100644 → Permission denied sur le runner
  Linux, workflow en échec) — corrigé (`git update-index --chmod=+x`,
  commit `d7878e0`), workflow rejoué en success. Release de contrôle
  supprimée, état revenu à v1.8.0 + preview4.
- **Pipeline d'une release** (répéter à chaque bump) :
  1. Bump stable : `bash bench/bump-version.sh <v>` (VERSION racine + bundles
     + metas + manifest APK versionCode + es2017) — source unique depuis
     v1.11.0.
  2. Bump preview : `build-preview.js` — **une seule ancre** :
     `PREVIEW_VERSION` (les ancres `versionAnchor`/`headerAnchor` sont
     DYNAMIQUES depuis v1.11.0 — extraites du bundle source, plus de hardcode
     1.10.0).
  3. Rebuild : `node bench/preview/port/build-preview.js` (invariants deux
     versions + node --check + probes + P1 self-test sur le bundle capturé).
  4. Commit + push, puis `gh release create` (stable : défaut Latest ;
     preview : `--prerelease`) avec les 2 assets .user.js + .meta.js.
  5. **Rétention AUTOMATIQUE** : le workflow `release-prune` (bench.yml à
     côté) se déclenche sur `release: published` et exécute
     `bench/release-prune.sh` — garde Latest + **le dernier preview**
     (tri par version), purge le reste (release + tag), vérifie les 4 liens
     (GATE ROUGE si 404). `workflow_dispatch` pour une re-purge manuelle /
     un contrôle.
- **Incident 18 août ~17:00 — release v1.9.0 disparue** : après la
  suppression de la release de contrôle 1.9.1, `gh release edit … --latest`
  a fini par **supprimer la release v1.9.0 ET son tag** (plus que preview1 +
  preview4 → tous les liens `releases/latest` en 404, auto-update mort).
  Détecté via le badge « Better xCloud 6.7.12 » encore affiché (ancien
  script). **Restauré** : recréation du tag/release `evenbetter-xcloud-v1.9.0`
  (Latest) avec assets corrects — ⚠ piège `gh release upload
  'fichier#newname'` **non supporté** (monte sous le basename) → upload sous
  `/tmp/better-xcloud.user.js` pour forcer le nom. Politique v1.8.0
  confirmée : l'asset `better-xcloud.user.js` = **bundle ES2017** (403 394 o).
  Vérifié : 5/5 liens 200 + byte-identiques (sha256), CDN propagé immédiat.
  **Bannière Android rebrandée** dans la foulée : « 🔥 EvenBetterXcloud app
  for Android » → `…/releases/latest` (fin du lien vers l'app officielle
  `better-xcloud.github.io/android`), propagée aux 3 bundles + 2 APK
  (commit `23e8601`). ⚠ Prochaine migration du badge chez l'utilisateur :
  l'ancien script (badge « Better xCloud 6.7.12 ») tourne encore dans son
  Greasemonkey — désinstaller l'ancien, réinstaller depuis
  `releases/latest/download/better-xcloud.user.js`, recharger.
- **Garde-fou quotidien (18 août)** : `bench/release-guard.sh` + workflow
  `release-guard.yml` (cron 05:17 UTC + dispatch) — détecte une disparition
  silencieuse de release : pas de Latest, tag orphelin, lien 404, bytes servis
  ≠ bundle du commit tagué, version/name incohérents, APK 404. Badge
  « release guard » dans les README. Validé : run CI 32156497961 success,
  chemin d'échec testé (exit 1). ⚠ Piège CI : `gh` sur le runner exige
  `GH_TOKEN: ${{ github.token }}` explicite (le fallback implicite sur
  GITHUB_TOKEN a échoué au 1er run — erreur avalée par 2>/dev/null,
  maintenant propagée dans le GATE ROUGE). ⚠ Piège CRLF : le blob git des
  bundles est en LF (autocrlf=true) mais les releases sont publiées depuis un
  working tree Windows CRLF — toute comparaison sha doit normaliser CRLF→LF
  des deux côtés (fait dans le garde-fou). Tag preview1 réaligné sur main
  (servait des assets plus récents que son commit 6c1b42a → forcé sur
  077297e).
- **SmartScreen supprime l'APK téléchargé (18 août)** : dans un Edge piloté
  par CDP, le clic sur la bannière télécharge bien l'APK (événements
  `Browser.downloadWillBegin` + `downloadProgress` 135788/135788 o reçus)
  puis le téléchargement est ANNULÉ et le fichier retiré (hub « fichier
  supprimé ») — vérification de sécurité d'Edge sur les APK. La preuve de
  téléchargement passe donc par les événements CDP + le sha de l'asset servi
  (vérifié par release-guard), jamais par le fichier sur disque.
- **Lien stable de l'APK (18 août)** : la bannière Android du script
  (« 🔥 EvenBetterXcloud app for Android ») pointe vers
  `releases/latest/download/evenbetter-xcloud.apk` (téléchargement DIRECT,
  fini la page des releases). ⚠ **À chaque publication, uploader l'APK sous
  le NOM STABLE `evenbetter-xcloud.apk`** (en plus du nom versionné
  `evenbetter-xcloud-<v>.apk`) — sinon ce lien casse au prochain bump. Le
  garde-fou release-guard vérifie ce lien ET que le nom stable sert les
  MÊMES bytes que le nom versionné (un oubli de re-upload du nom stable au
  bump = GATE ROUGE « APK stable ≠ versionné »). Tags v1.9.0 + preview1
  réalignés sur
  `4261a42` (commit bannière → APK direct) pour garder l'invariant
  tag=bytes-servis.
- **CAUSE RÉELLE des deux disparitions de la v1.9.0 (18 août) — auto-prune !**
  Pendant le test du cycle bannière (release de contrôle 1.9.1 publiée), le
  workflow `release-prune.yml` (déclenché sur `release: published`) a purgé
  la v1.9.0 : elle n'était plus Latest (la 1.9.1 l'était) et n'était ni un
  preview ni le tag pinné → release + tag supprimés. Le premier incident
  (attribué à tort à `gh release edit --latest`) a la même cause : la
  publication de la 1.9.1 de contrôle. ⚠ **Publier une release stable de
  contrôle DÉTRUIT la release stable courante** (rétention par design).
  Restauration (validée) : re-push du tag local (`git push origin
  evenbetter-xcloud-v1.9.0`, tag local conservé même si le distant est
  purgé) → `gh release create` → re-upload des 4 assets (user.js ES2017,
  meta, APK versionné, APK stable) → `gh api --method PATCH
  repos/…/releases/{id} -f make_latest=true` (GitHub ne ré-attribue PAS
  latest après une purge). Le CDN web met ~2-3 min à propager le redirect
  `latest/download` dans les DEUX sens (l'API, elle, est immédiate).
  Cycle validé quand même : le lien stable a bien suivi la 1.9.1
  (a63670f3) pendant la fenêtre, et est revenu à b9d20aef après restauration.

## Pièges mémorisés

- URL **play SANS GUID** (`…/v5/sessions/cloud/play`) ; state/configuration
  AVEC GUID. Le hook route par `endsWith("/sessions/cloud/play")`.
- Réécriture **réponse** page-level (userscript) = invisible dans Network ;
  seul `Fetch.fulfillRequest` CDP l'affiche. Réécriture **requête** = visible.
- **Reprise de session (17 août)** : après un teardown incomplet, le play natif
  se voit rendre le MÊME GUID que la session tizen précédente (CF49BC01)
  — contrôle A/B invalide. Teardown propre = navigation home (session
  terminée) → play → vérifier GUID **neuf** dans le resource timing.
- **P3 ne change pas la résolution en PC** : natif windows et tizen reçoivent
  tous deux 1080p60 sur Halo CE (contrôle propre 17 août).
- Double réécriture : hook actif → le CDP logue `[P3] original:tizen` (déjà
  réécrit avant le réseau).
- `probe-page.js` : `hookActif` = présence de `window.BX_FETCH` (ne pas exiger
  `window.fetch === BX_FETCH` — T5 enveloppe après main()).
- **Shell preview = Tailwind, pas de `<header>`** : le top bar est
  `nav.col-container` (h 73, rangée `[class*='flex-row']`), le `<html>` porte
  la classe `global sbar …`. Le container z-shell-top est `fixed z-100
  pointer-events-none` — tout élément injecté doit se ré-armer en
  `pointer-events:auto` (sinon les clics traversent vers `<main>`).
- **Le shell preview REPLACE le document au démarrage** (probable
  `document.open()`) : les nœuds du userscript (overlay/container du
  NavigationDialogManager, feuille `<style>` d'`addCss()`) finissent orphelins
  sous un ancien `<html>` détaché — le manager survit (show() tourne,
  `bx-no-scroll` posé) mais rien ne s'affiche et le CSS disparaît (dialog
  `position:static` hors-écran). T7 (build-preview.js) : interval 2 s,
  ré-append si `!isConnected` + re-`addCss()` si aucun `<style>` porteur de
  `.bx-navigation-dialog-overlay{`. Edge cache le contenu des extensions
  MV3 : après `cp` dans `.edge-inject/preview.js`, un reload ne suffit pas —
  **redémarrer Edge**.
- **L'extension `.edge-inject` doit être relancée** : `taskkill //F //IM
  msedge.exe //T` + `Start-Process` (PowerShell) avec profil
  `D:\Codex\EvenBetterXcloud\edge-profiles\edge-cdp` +
  `--load-extension=D:\Codex\EvenBetterXcloud\better-xcloud-fork\.edge-inject` (depuis bash,
  passer par `powershell -Command "Start-Process …"`, pas Start-Process
  direct). Profils de test sur D: uniquement (18 août).
- **Blip « You're offline » d'Edge** (vu 2× le 17 août) : le site se charge en
  « offline » alors que le réseau va bien (curl 200) → la page stream ne part
  pas, le play ne s'émet pas. Contournement : clic `retryButton` ou reload ;
  l'interception CDP reste attachée entre-temps (aucun impact).
- **Preuve P2 = config effective de la session live** (plus fort que Network) :
  `hunt-session.js` → fibre `.Connection` → `_session` →
  `_configuration.inputConfiguration.enableVibration` etc. — le natif n'envoie
  que `useUnreliableInput` dans inputConfiguration, donc toute clé
  supplémentaire vient de notre fusion CDP.
- `class` est lexicale dans un vm (évaluer en class expression).
- Le preview CSP bloque raw.githubusercontent.com (listes native-mkb /
  local-co-op) → « Failed to fetch » (non fatals, rejets non gérés).
- **Flake CI gpu-runner (17 août, dispatch 32024511950)** : gpu-runner écrivait
  le JSON complet puis rejetait sur `browser.close()` (un Edge utilisateur
  ouvert sur la machine tue le process Playwright) → exit 1 SILENCIEUX → le
  `|| exit 1` du workflow court-circuitait agg-seeds (zéro sortie au log).
  Fix `db8de27` : close en try/catch dans gpu-runner.js + visual-diff.js ;
  report-html.js sort exit 0 si le JSON est absent (step `if: always()` ne
  s'ajoute plus en rouge). Diagnostiquer un exit 1 silencieux : télécharger
  l'artefact `gpu-runs-<sha>` et rejouer localement.
- `git apply` **hors repo no-op silencieusement** ; hunk **zéro-contexte**
  refusé sur ligne géante (contexte 3 lignes requis). Node `/tmp` ≠ bash
  `/tmp` sous Git Bash (utiliser des chemins projet ou bash tools).
- Conventions merge : rebase + fast-forward + suppression de branche ; badge
  Closed/Merged trompeur (§5 mémo projet).
- Step « Commente la PR » (`always()` + readFileSync du résumé) : garde
  `fs.existsSync` (`8bd1341`) — job échoué AVANT check-ratios → skip propre
  « résumé absent … skippé », plus de crash ENOENT  (validé PR #16, run
  32002128606 ; journal dans e2e-cdp.md). Runner edge-cdp : port 9222,
  profil `D:\Codex\EvenBetterXcloud\edge-profiles\edge-cdp`, relance : `Start-Process msedge.exe
  -ArgumentList
  '--remote-debugging-port=9222','--user-data-dir=D:\Codex\EvenBetterXcloud\edge-profiles\edge-cdp',
  '--no-first-run',
  '--load-extension=D:\Codex\EvenBetterXcloud\better-xcloud-fork\.edge-inject'`.

## Profil runtime en session réelle — VERDICT (18 août ~19:45, v1.9.0)

`bench/live-profile.js` exécuté sur un stream réel (As Dusk Falls,
www.xbox.com/play, build v1.9.0 injecté via `.edge-inject-stable` sur le
profil guard-badge, lancé depuis la page play par clic CDP sur « JOUER
MAINTENANT ») : 15 s → ~3,5 ms de JS total ; 20 s → ~3,2 ms (getGamepads
1,7 ms · Yt 1,5 ms). **Le main thread JS du renderer est ~99,98 %
inactif/natif pendant un stream** — la dominante réelle (décodage vidéo,
WebGL2) est côté process natifs/GPU, invisible au CDP Profiler. Verdict :
**la queue d'optimisations JS du stable est au plancher**, plus de gain
mesurable côté script (nos hot loops ~0,2 µs/frame sont sous le seuil
échantillonnage). Seul item JS visible : le polling getGamepads (~0,1 ms/s),
déjà couvert (PR #999/#1000 + bench 137 ns). Journal dans bench/README.md
(« Profil runtime — VERDICT »). ⚠ Caveat : onglet CDP en arrière-plan →
throttling rendu (86 % dropped, downscale 1440p→720p), le profil JS reste
valide, pas de conclusion qualité.

## Feature v1.10.0 — 📡 Test de latence serveur (18 août ~21:30)

Nouvelle fonctionnalité utilisateur (le JS étant au plancher) : bouton
« Tester la latence des serveurs » dans le groupe SERVER des settings globaux
— ping chaque région gssv (`STATES.serverRegions`, 19 régions réelles) via
NATIVE_FETCH + `?probe=1` (mesure pure, l'XcloudInterceptor route les URLs
finissant par /sessions/cloud/play vers handlePlay), timeout 3 s, tri du
meilleur au pire, « ⭐ région recommandée ». Validé en réel (guard-badge,
connecté) : RTT cohérents géographiquement — ⭐ CSE 30 ms, WEU 41 ms, UKS
(défaut) 43 ms, Japan 804 ms. Preuve `bench/.latency-feature-proof.png`.

Injection : `bench/feature-latency.js` (gates, idempotent, self-test sur
copie corrompue — piège : corrompre le contenu PRÉ-injection sinon
l'idempotence sort en no-op). ⚠ **Piège shortName** : `STATES.serverRegions[x]`
a `shortName` = « 🇺🇸 EUS » (emoji drapeau + espace) → hôte invalide — utiliser
**`baseUri`** (`https://eus.core.gssv-play-prod.xboxlive.com`).
`networkTestHostname` (gssv-fastlane) ne résout pas depuis ce PC. Libellés
inline EN (pas de clés de traduction — à ajouter si besoin).

**Bump v1.10.0 appliqué** (bump-version.sh) : VERSION 1.10.0, bundles stable/
es2017/preview 1.10.0 + 1.10.0-preview1, metas, manifest APK versionCode 3.
Rebuilds : es2017 ✓, preview (build-preview.js — ⚠ ancres T1 à bumper :
PREVIEW_VERSION + versionAnchor + headerAnchor) ✓, APK stable
`mobile/out/evenbetter-xcloud-1.10.0.apk` (148 Ko) ✓. **En attente : publier
la release v1.10.0 + v1.10.0-preview1 (+ APK stable + nom stable
`evenbetter-xcloud.apk`) et vérifier les liens — N'oublier AUCUNE release de
contrôle stable (l'auto-prune purge la courante).**

## Rendu premier plan — 0 % de drop (18 août ~21:00, v1.9.0)

Run de contrôle live-profile avec fenêtre au premier plan (As Dusk Falls,
1440p30) : **599 frames reçues sur 20 s, 0 dropped (0,00 %), 29,9 fps
effectifs**, `visibilityState:visible` — le 86 % de drops du run initial était
bien le throttling d'onglet arrière-plan (confirme la correction du caveat).
live-profile au premier plan : 99,3 % natif/inactif (même verdict JS), les
callbacks SDK tournent réellement (scheduleTimer 2,7 ms · requestVideoFrame
Callback 2,6 ms · calculateChanges 1,9 ms / 15 s) — toujours négligeable.
⚠️ Opérationnel CDP retenu : (1) les clics `Input.dispatchMouseEvent` peuvent
être interceptés par la page (banner z-999) → utiliser `element.click()` en
JS ; (2) un onglet CDP reste hidden après `Page.bringToFront` si la fenêtre
OS est occluse → **cycle minimiser→restaurer** (`Browser.setWindowBounds`
minimized puis normal) force le premier plan et libère le rendu.

## Hors main thread — VERDICT mesuré (18 août ~20:15, v1.9.0)

Session stable réelle (As Dusk Falls, onglet premier plan) : config d'input
effective lue dans `window.BX_EXPOSED.inputChannel.configuration` →
`useIntervalWorkerThreadForInput:true` · `enableVibration:true` ·
`useUnreliableInput:true` · `enableClientRenderedCursor:true` — **le client
stable les a TOUS actifs nativement** (contrairement au preview où la fusion
P2 les apportait). Double échantillon getStats (deltas timestamps RTP, 10 s) :
bitrate **~24,8 Mbps** (1440p30 H.264 High), décodage **0,50 ms/frame**
(natif, non scriptable), RTT 22 ms, 0 perte, 0 drop. getGamepads ~85 µs/s
(0,0085 %) — gain potentiel sous le bruit. **Verdict : rien à optimiser côté
script hors main thread** — les leviers réseau/décodage (maxBitrate → patch
SDP b=AS:, codecProfile → setCodecPreferences, resolution, maxFps,
powerPreference, region) existent et fonctionnent déjà (mécanismes vérifiés
dans le bundle) ; ce sont des préférences utilisateur, pas des optimisations.
Seul axe infra restant : AV1 (non utilisé sur ce setup, H.264 High) via
`stream.video.codecProfile`. Détail : bench/README.md « Hors main thread ».

## SNAPSHOT 18 août ~20:00 — avant reboot (tout commité + poussé)

**État git** : `main` == `origin/main` @ **`66ef734`** (verify-badge --banner).
Arbre propre sauf : `.edge-inject-stable/` (extension d'injection LOCALE, NON
commitée — convention comme `.edge-inject`) et `better-xcloud-perf-1.8.0-
test.apk` (artefact périmé, à supprimer).

**Versions / releases** (repo `Endymi0n74/EvenBetter-Xcloud`) :
- `VERSION` = **1.9.0** ; bundle stable servi = ES2017 (`better-xcloud.user.js`, ~403 Ko).
- Releases : **evenbetter-xcloud-v1.9.0** (Latest ; 4 assets : user.js ES2017,
  meta, `evenbetter-xcloud-1.9.0.apk` versionné, **`evenbetter-xcloud.apk` =
  nom STABLE**), **evenbetter-xcloud-v1.9.0-preview1** (prerelease),
  `better-xcloud-perf-1.8.0-preview4` (cran de secours).
- Liens : auto-update via `latest/download/*` ; **bannière Android →
  `latest/download/evenbetter-xcloud.apk`** (le nom stable doit être re-uploadé
  à CHAQUE release — le garde-fou vérifie stable == versionné).
- Tags v1.9.0 + preview1 → commit `4261a42` (bundles servis).

**Validations en réel terminées (18 août)** : badge « EvenBetterXcloud 1.9.0 »
affiche + clic → releases (verify-badge.js) ; bannière Android (UA simulé) →
APK direct, clic → téléchargement réel 135788/135788 o (preuve = événements
CDP, SmartScreen retire le fichier) ; release-guard VERT (local + CI).

**Outils clés** : `bench/release-guard.sh` + `.github/workflows/release-guard.yml`
(cron 05:17 UTC + dispatch) ; `bench/verify-badge.js [--banner]` ;
`bench/release-prune.sh` ; `bench/bump-version.sh` + `VERSION` racine ;
`mobile/build.sh` (`VARIANT=preview`, `BUNDLE_SRC=…es2017.user.js`) ;
`bench/preview/port/build-preview.js` (builds preview depuis le stable).

**Chemins** : repo `D:\Codex\EvenBetterXcloud\better-xcloud-fork` ; JDK `C:\Program Files\Zulu\zulu-21` ;
SDK `/d/android-sdk` ; keystore `D:\Codex\EvenBetterXcloud\bx-apk\bxperf.keystore` ; profils Edge
`D:\Codex\EvenBetterXcloud\edge-profiles\` (edge-cdp = play.xbox.com preview) ; extension locale
`.edge-inject-stable/stable.js` = copie statique du bundle → **RESYNC après
chaque changement de bundle**. PC : aucune instance Edge de test ouverte, rien
en cours d'exécution.

**Pièges récents (détail plus bas)** : publier une release stable de contrôle →
l'auto-prune (release-prune.yml sur `release: published`) PURGE la stable
courante ; SmartScreen supprime les APK téléchargés ; redirect web `latest` =
cache CDN ~2-3 min (l'API est immédiate) ; blob git LF vs releases CRLF →
normaliser CRLF→LF dans les comparaisons sha ; gh en CI exige `GH_TOKEN`
explicite ; `gh release upload fichier#nom` non supporté (copier sous le bon
nom) ; GitHub ne ré-attribue pas Latest après purge (`PATCH make_latest=true`).

**Prochaines étapes candidates** : (a) valider la migration Greasemonkey chez
l'utilisateur (badge 1.9.0 en Firefox — le build est bon, l'ancien script peut
tourner encore) ; (b) ~~supprimer `better-xcloud-perf-1.8.0-test.apk`~~ **fait le 19
août — l'asset n'existait plus nulle part** (purge avec l'ancienne release
`better-xcloud-perf-v1.8.0` lors de la rétention du 18 août : aucun asset
« test » sur GitHub, aucun fichier local, garde-fou 10/10 vert après
vérification) ; (c)
reprendre la queue du stable : `bench/live-profile.js` pour identifier la
dominante runtime réelle ; (d) upstream : 15 PR ouvertes (redphx), politique
sans rappel (décision 19 août — on propose, on ne pinge pas) ; (e) APK
preview : overlay absent sur play.xbox.com en WebView (réservé, priorité
basse — résolu par le FAB 19 août).

## Verdict AV1 (18 août ~23:00) — backend xCloud encode H.264 uniquement

- **Support navigateur OK** (Edge 152, `bench/av1-probe.js`) : `video/AV1`
dans les codecs RTP + MediaCapabilities `supported`/`powerEfficient` (hw)
pour 1080p60/1440p60 file et webrtc. Mais `getSupportedCodecProfiles()` du
bundle n'expose que H.264 (low/normal/high) — AV1 jamais proposé.
- **A/B mesuré** (As Dusk Falls, 20 s, premier plan) : Run A défaut =
video/H264 1440p30 **24,2 Mbps** 0,51 ms/frame ; Run B offre AV1 forcée
(`bench/launch-game.js --av1` : reorder AV1 en tête du m=video + no-op
setCodecPreferences) = **toujours video/H264** 24,7 Mbps. Preuve
`bench/sdp-inspect.js` : l'offre contient AV1 mais la réponse serveur ne
liste QUE du H.264 (VP8/VP9 aussi retirés) → **l'encodeur xCloud est
H.264-only, AV1 = cul-de-sac** (stable ET preview). Aucune option à ajouter.
- Harnais ajoutés (bench/) : av1-probe.js, launch-game.js (+`--av1`),
stream-stats-capture.js (fix : codec lookup en 2 passes — l'ordre du report
getStats met les codec AVANT inbound-rtp), sdp-inspect.js, page-probe.js,
kill-edge-profile.ps1 (tue un profil Edge précis — `$_` mangé par bash →
fichier .ps1 obligatoire).

## Préférences utilisateur mesurées — maxBitrate fiable, résolution 720p seule efficace (18 août ~23:30)

- **`stream.video.maxBitrate` (SDP b=AS:) honoré par l'encodeur** : défaut
  24,2 Mbps (1440p30) → cap 10 Mbps = **6,6 Mbps**, cap 5 Mbps = **4,7 Mbps**,
  résolution inchangée (1440p), 0 drop. Réglage recommandé pour économiser
  la bande passante : cap 10-15 Mbps (préférence utilisateur, pas une opti).
- **`stream.video.resolution` = spoof osName** (handlePlay, même mécanisme
  P3 retiré du preview) : `720p`→android (**1280×720, 6,4 Mbps — fonctionne**),
  `1080p`→windows = natif → **no-op** (1440p), `1080p-hq`→tizen = **no-op sur
  PC** (1440p, cohérent avec l'A/B P3 preview). Seul 720p change quelque
  chose ; 1080p/1080p-hq sont trompeurs sur PC.
- Harnais ajouté : `bench/set-pref.js` (fusion préférence dans
  localStorage["BetterXcloud"] + reload + attente bundle) — la clé est un
  objet plat de settings. Valeur « unlimited » stockée = 15360000 (max).
  Piège : la home xbox.com peut atterrir sur le shell complet après un
  reload — renaviguer explicitement vers /play.

## Boucle fermée — queue d'optimisations stable terminée (18 août ~23:45)

- **README principal** : la section « Benchmarks — synthèse » est remplacée
  par « Queue d'optimisations terminée — réglages recommandés » (FR + EN) —
  verdict live-profile (main thread 99,98 % inactif), tableau des réglages
  recommandés mesurés (maxBitrate 10-15 Mbps, 720p, 1080p/1080p-hq no-op,
  région + test latence) et note codec H.264-only. Les chiffres perf restent
  dans bench/README.md (source unique).
- **Fermeture de la queue** : plus d'optimisation script à chercher côté
  stable — prochaines features = utilisateur (pattern feature-latency.js),
  upstream = 15 PR ouvertes, politique sans rappel (19 août).

## A/B profils H.264 mesuré (18 août ~23:50) — le setting fonctionne, le défaut est déjà le meilleur

- `stream.video.codecProfile` réordonne les profils H.264 dans l'offre SDP —
  prouvé en réel via le `profile-level-id` négocié : `default`/`high` →
  **4d001f (Constrained High)**, `normal` → **42e01f (Constrained Baseline)**,
  `low` → **42001f (Baseline)**. Le défaut du SDK est DÉJÀ le meilleur
  profil → « high » = no-op, `low`/`normal` ne font que dégrader (pas de
  B-frames). Recommandation : laisser à `default`.
- ⚠️ **Piège mesure** : les bitrates inter-runs sont confondus par le contenu
  (jeu qui avance — le run « high » a attrapé une scène statique à 10,4 Mbps).
  Seule la négociation du profil est une preuve fiable ; les deltas de bitrate
  entre sessions du même jeu ne sont PAS comparables.
- Le capture de stats lit maintenant le `profile-level-id` du codec
  (2e champ, sdpFmtpLine). Screenshots : bench/.h264-high.png / .h264-low.png.

## Verdict codec preview (19 août ~00:05) — même backend H.264-only que le stable

- Session preview réelle (play.xbox.com, Among Us) : codec négocié =
  **video/H264 `4d001f` Constrained High — identique au stable**. L'offre
  contient AV1 mais la réponse serveur non → le backend encode H.264 pour
  les deux clients, rien d'autre (pas de VP9/HEVC). Sujet codec CLOS.
- ⚠ Piège : l'extension `.edge-inject` (preview) était une copie pré-rebrand
  — RESYNC après chaque build preview (même convention que
  `.edge-inject-stable`). La page stream immersive du preview est en plein
  écran → le cycle min/restore du capture exige d'abord un retour à
  « normal » (fix dans stream-stats-capture.js).
- Harnais ajoutés : `bench/launch-preview-game.js` (produit → Jouer → stream
  sur play.xbox.com), `bench/preview-codec-probe.js` (codec + stats brutes +
  présence AV1 dans les SDP).

## Gate navigateur du preview (19 août ~00:30) — Firefox bloqué par check Chromium-only, workaround UA

- play.xbox.com affiche « Votre navigateur ne prend pas en charge la
  diffusion en continu » sur Firefox. Cause dans `entry.client` du site :
  `isSupportedChromiumBasedBrowser = (isChrome && >=106) || (isBlinkEngine &&
  >=106)` ou fallback `satisfies(chrome/edge >=106, safari >=17)` — **Firefox
  n'est pas dans la liste**. Check basé sur l'UA détectée → **spoofable**.
- Workaround (pas besoin de code) : le setting preview `userAgent.profile`
  = « Edge + Windows » existe déjà (spoof document-start) → gate passé. OU
  Firefox `about:config` → `general.useragent.override` = UA Edge.
- Le stream lui-même tourne sous Firefox (support WebRTC H.264 confirmé —
  post r/xcloud fév. 2025 « play Xcloud on Firefox », décode hw Linux).
- Sonde ajoutée : `bench/ua-spoof-probe.js` (UA Firefox via CDP
  Emulation → vérifie l'absence de dialog).

## T4 mobile — overlay settings invisible en WebView téléphone (19 août ~09:45, preview3) ✅ FAB

- **Symptôme** (réservé 18 août) : sur téléphone le preview est loggé mais
  l'overlay/settings n'apparaît pas sur play.xbox.com en WebView.
- **Diagnostic (BlueStacks, émulation CDP 390×844)** : viewport <768 px → le
  shell mobile n'a NI `nav.col-container` NI `<header>` (top bar desktop
  absente) → T4 sans ancre → aucun bouton. ≥768 px : top bar présent, bouton
  injecté + dialog (validé). Shell mobile = `nav.z-shell-bottom` (mini-nav
  basse, items dans des spans `display:contents`).
- **Fix (build-preview.js T4, 1.10.0-preview3)** : `innerWidth < 768` → FAB
  fixe `.bx-mobile-fab` au-dessus de la mini-nav (pilule 48 px radius 999,
  label EvenBetterXcloud), CSS scoped `[class*="bx-header-settings"]` (la
  classe réelle est `bx-header-settings-button`). Desktop inchangé.
  ⚠ échappement template : `\"` dans le template littéral → `\\\"` pour
  sortir `\"` valide dans le bundle (node --check a attrapé l'erreur).
- **Validé WebView réelle** (APK preview3) : FAB 174×48 radius 999 injecté à
  390 px, clic → `.bx-settings-dialog` ouvert ; desktop (1280) bouton top bar
  154×40 sans FAB ; gate toujours passé. Harnais :
  `bench/mobile-t4-diagnose.js` (fab/desktop/shell/bottomnav/html — override
  CDP par-session → appliqué PUIS probe dans le même script).
- **⚠ Piège timing prune (19 août ~09:40)** : publier une release preview
  SANS avoir poussé le bump d'abord → le prune CI (release: published) lit le
  tag pinné depuis le bundle COMMITÉ (encore l'ancien preview2) → il purge la
  nouvelle release preview3 et garde l'ancienne + preview4. **Ordre imposé :
  bump + build + commit + push PUIS publier.** Recréée ensuite sur le bon
  commit (tag 5a59c3b), prune correct : preview3 + v1.10.0 + preview4,
  preview2 purgée, garde-fou 10/10.

## T10 — auto-spoof UA non-Chromium dans le preview (19 août ~00:45, preview2)

- Le gate play.xbox.com est Chromium-only (`isSupportedChromiumBasedBrowser`
  dans entry.client — Firefox non listé, dialog « ne prend pas en charge la
  diffusion en continu »). Le stream WebRTC H.264 fonctionne pourtant sous
  Firefox → **T10** dans build-preview.js : si le navigateur réel n'est pas
  Chromium (regex `chrom(e|ium)|edg/|crios`, vérifiée : Firefox/Safari →
  spoof, Edge/Chrome → inchangé) ET que `userAgent.profile` est « default »,
  forcer `windows-edge` par défaut au moment de `UserAgent.init()` — le gate
  passe sans réglage manuel. Le setting garde la main (profil explicite non
  écrasé). Guard `BX_PREVIEW` → stable inchangé (vérifié 0 occurrence).
- Bump preview → **1.10.0-preview2** (PREVIEW_VERSION, tag v1.10.0-preview2,
  README Deux versions FR/EN). Ancre T10 :
  `if (!UserAgent.#config.custom) UserAgent.#config.custom = "";UserAgent.spoof();`
  (unique). Probes + node --check OK.
- **Validé en réel par l'utilisateur (19 août, Firefox)** : preview2 avec
  `userAgent.profile` = default → gate passé, **Halo lancé et jouable au pad**
  sous Firefox. Contre-test Chromium automatisé (`bench/t10-counters-test.js`,)
  : UA intacte, script actif, pas de dialog, home OK — T10 ne spoofe que hors
  Chromium. Validation T10 bouclée des deux côtés (commit `a34d5d9`).
- **Gate CI T10 branché (19 août ~09:00)** : `bench/preview/port/t10-auto-spoof.test.js`
  dans le step preview de bench.yml — extraction du statement T10 du build +
  pureté du stable + comportement vm sur mock UserAgent (13 checks) +
  `--self-test` du chemin d'échec. CI main vert (run 32226542845). Commit `2f36360`.
- **APK preview en WebView Android (19 août ~09:15, BlueStacks)** : l'APK
  preview2 embarque bien le T10 (1 marker, `windows-edge` ×3, version
  1.10.0-preview2, byte-identique à la release). Gate validé dans la WebView :
  UA Chromium Android (Chrome/129) → **pas de dialog** (T10 correctement
  inactif — la WebView est déjà Chromium, pas de spoof), script preview actif
  (18 patches), 9 jeux. Nouveau harnais : `bench/mobile-preview-gate.js`.
- **Fix UA suffix APK (19 août)** : `MainActivity.java` durcissait
  `EvenBetterXcloud/1.9.0` dans l'UA → lit maintenant le `versionName` du
  manifest (1.10.0). versionCode 3→4. APK stable + preview rebuildés et
  re-uploadés (assets versionnés + nom stable byte-identiques), garde-fou 10/10.

## Publication v1.10.0 (18 août ~22:30) — feature latence + releases

- **Feature** : « 📡 Tester la latence » (groupe SERVER) — ping des 19 régions
gssv (hôte depuis `baseUri` — pas `networkTestHostname`/`fastlane` qui ne
résout pas ; `shortName` contient l'emoji drapeau → libellé seul, pas hôte ;
`NATIVE_FETCH` bypass l'interception ; URL `?probe=1` évite le dispatcher
`sessions/cloud/play`). Validé en réel : CSE 30 ms ⭐ (France), WEU 41, UKS 43
(défaut), JP 804. Injecté par `bench/feature-latency.js` (gates + self-test),
present dans les 3 bundles + APK. Bump v1.10.0 : VERSION, versionCode 3, 3
ancres build-preview. Commit `6079b2c`.
- **Releases publiées (18 août ~22:28)** : **`evenbetter-xcloud-v1.10.0`**
(Latest, 4 assets : user.js ES2017 ~405 Ko, meta, `evenbetter-xcloud-1.10.0.apk`
versionné + nom STABLE `evenbetter-xcloud.apk`) et
**`evenbetter-xcloud-v1.10.0-preview1`** (prerelease, 3 assets : user.js +
meta + **APK preview**). Auto-prune (workflow release-prune) a purgé v1.9.0 +
v1.9.0-preview1 ; conservés : Latest + preview1 1.10.0 (pinné) +
1.8.0-preview4 (cran de secours). Garde-fou **10/10 VERT**.
- ⚠ **Convention : la release preview porte AUSSI son APK**
(`evenbetter-xcloud-<ver>-preview1.apk`, VARIANT=preview de build.sh, package
`com.bxperf.preview`) — le garde-fou vérifie `APK preview (tag)` en 200.
Oubli → GATE ROUGE (404). Premier upload = 404 cache CDN ~1 min, pas un bug.
- README FR/EN « Deux versions » : 1.10.0 / 1.10.0-preview1, lien preview →
tag dédié v1.10.0-preview1.

## En attente / prochaines étapes

1. ✅ **Fait (17 août soir) — overlay preview validé en réel** : bouton
   settings injecté dans le top bar de play.xbox.com + dialog settings ouvert
   (journal complet dans e2e-cdp.md, section « Validation overlay
   1.8.0-preview1 »). Trois fixes dans build-preview.js : sélecteurs T4
   (`nav.col-container` + cible `[class*='flex-row']` — pas de `<header>`
   dans le shell Tailwind), `pointer-events:auto` sur le wrapper (le
   container z-shell-top est `pointer-events:none`, clics traversés),
   **T7 résilience** (le shell REMPLACE le document au démarrage →
   overlay/container orphelins sous l'ancien `<html>` détaché ET feuille de
   style effacée ; interval 2 s : ré-append si `!isConnected` + re-`addCss()`
   si aucun `<style>` porteur). ~~À faire : republier la preview~~ —
   **SUPERSÉDÉ** : republiée plusieurs fois depuis (preview2/3/4, puis
   v1.9.0-preview1, 1.10.0-preview*, 1.11.0-preview1/2 — fix T7 inclus dans
   tous les builds depuis).
2. ✅ **Fait (17 août ~12:43) — Run 1 CDP P2 VALIDÉ (C4)** : Étape 0
   `--strict-probe` passée, `intercept-session.js --sw` (SW attaché CDP brut),
   chaîne `[P3]` → `[P2-staging]` ×2 (page+SW) → `[P2]` (5 groupes réécrits).
   **Preuve session live** (hunt-session, fibre `.Connection` → `_session`) :
   `_configuration.inputConfiguration.enableVibration:true` (le natif n'envoie
   que `useUnreliableInput`), `audioConfiguration.enableMicrophone:true`,
   config propagée aux 3 canaux d'input, `_bxKeepAliveWrapped` présent.
   Journal : e2e-cdp.md « Run 1 — P2 (exécution 3) ».
3. P1-B AFK : fenêtre 1 h exécutée (17 août, 09:10:59→10:10:59) — session
   survivante, AUCUN warning → **seuil d'idle preview > 60 min** (exécution 2
   journalisée dans e2e-cdp.md). **Recherche statique faite (17 août)** : PAS
   de constante de seuil côté client — le serveur envoie `secondsUntilKick`
   dans le message `WarningForBeingIdle` (StreamSessionRequest-iiux1fqv.js),
   l'événement `sessionIdleWarningEvent` dispatché n'a AUCUN écouteur (pas de
   countdown UI, pas de kick local — le kick est un message `KickForBeingIdle`
   séparé). WrapSession sur onServerDisconnectMessage = SEULE ligne de
   défense. Nouvelle fenêtre 1 h relancée 17 août 15:09 (monitor-afk-1h-v2.log,
   session CF49BC01) après que la 1re tentative (15:02) est morte à 4,5 min
   (reload du shell + dialog permission micro réapparu — cliqué Autoriser au
   clavier, mémorisé dans le profil D:\Codex\EvenBetterXcloud\edge-profiles\edge-cdp). **DÉCISION
  P1 (17 août) :
   validation clôturée.** Fenêtre longue (2 h) abandonnée — PC indisponible
   2 h de suite, et le timer d'idle serveur ne peut être ni accéléré ni
   simulé. Seuil > 60 min établi (exécution 2), wrapSession en place et
   branchée en réel (`wrapped:true`), risque résiduel (kick entre 1 h et un
   seuil inconnu) **accepté** — si un kick survient en usage réel, fenêtre
   longue à ce moment-là. Journal : e2e-cdp.md « Décision P1 ».
4. ✅ Fait — `run-e2e0.sh` au CI (step preview, `--skip-probe`) +
   `--strict-probe` (hookActif:true exigé) + chemin d'échec testé.
5. ✅ Fait — localisation de la session au runtime + locator auto (voir P1).
6. ✅ Fait — v1.8.0 (USM) + 1.8.0-preview1 publiées (17 août 12:11).
7. ✅ Fait — preview2 publiée (fixes overlay T4/T7) puis **preview3 (17 août)
   : retrait osName=tizen (T8, A/B mesuré) + intercept-session passif**.
   Releases : 1.8.0 (stable, latest) / 1.8.0-preview2 / 1.8.0-preview3.
8. ✅ **Fait (17 août ~19:30) — preview3 validée en réel** (profil edge-cdp,
   extension `.edge-inject` à jour) : overlay + bouton settings + dialog OK,
   play **natif** confirmé (`osName=windows`, non réécrit — T8), stream live
   1920×1080. Journal : e2e-cdp.md « Validation preview3 en réel ».
9. ✅ **Fait (17 août ~21:45) — T9 (build preview4)** : bouton Settings dans
   la game bar de la page stream immersive (le seul accès settings en
   session, le top bar n'existe pas sur /stream/). Validé en réel : dialog
   complet ouvert depuis la bar en cours de jeu. Journal : e2e-cdp.md « T9 ».
10. ✅ **Fait (17 août ~22:00) — preview4 publiée validée** (release
    better-xcloud-perf-1.8.0-preview4) : asset GitHub **byte-identique** au
    build local (494 246 o, cmp OK) — ce que recevra Tampermonkey est
    exactement le fichier testé en réel (overlay + top bar + game bar
    settings en session). Journal : e2e-cdp.md « Validation preview4
    publiée ».
11. ✅ **Fait (17 août ~23:30) — rétention des releases** : 12 anciennes
    purgées (v1.0.0→v1.7.0, 1.7.0-preview1, 1.8.0-preview1/2/3 — release +
    tag). Reste **v1.8.0 (Latest) + preview4** (preview3 recréée depuis git
    sur demande comme cran de secours, puis purgée le 17 août soir par
    `release-prune.sh` une fois le cran jugé inutile — builds toujours
    reconstruisibles depuis git). Script `bench/release-prune.sh` commité
    (politique latest + dernier preview, vérification des 4 liens
    d'auto-update). README + docs : README.en.md
    (traduction complète, sélecteur 🇫🇷/🇬🇧), notes de release bilingues
    FR/EN (5 releases), fix rendu GitHub (@name/@match backtiqués), badge CI
    bench.
12. ✅ **Fait (18 août ~00:50 puis 19 août ~14:20) — portage upstream complet,
    15 PR ouvertes** sur `redphx/better-xcloud:typescript` : #993 codecProfile
    lazy · #994 USM 4 taps · #995 dirty flag · #996 texStorage/RGB8 · #997
    viewport/NoColor · #998 hidden throttle · #999 controller skip idle ·
    #1000 structuredClone → réf. · #1001 fix share-delete · #1002 settings Set
    · #1003 checkForUpdate throttle · #1004 BxSelect observer délégué ·
    **#1005 fix #991** (garde `currentGamepad.buttons?.[16]`, commentaire
    posté sur l'issue #991) · **#1006 data usage presets** (feature
    « 📊 Données » v1.11.0, commit `77c1fcf`) · **#1007 server latency test**
    (feature « 📡 Latence serveur » v1.10.0, commit `071ff73`). Toutes
    OPEN/MERGEABLE, une par sujet, builds amont exit 0, zéro fuite inter-PR.
    Queue épuisée : plus rien à porter — #4 (uniform cache) subsumé par #995,
    patch 07 (opacity cache) **no-op amont**, patch 09 exclu (négatif à 500
    entrées). Corps des PR avec mentions near-miss (#10-12 : pref-keys.ts ↔
    #908, translation.ts ↔ #908/#938/#468). **Politique 19 août : PLUS
    AUCUN rappel** — on propose (les 15 PR), le mainteneur fait sa vie,
    `upstream-prs/reminder.md` supprimé ; seule interaction restante :
    répondre si interrogé. Programme détaillé dans `upstream-prs/README.md`
    (source de vérité).
- **Audit conflits inter-PR (19 août ~16:30)** : aucune des 15 PR ne touche
  `xcloud-interceptor.ts` (futur portage preview) ✓ ; en revanche
  webgl2-player.ts est partagé par #995/#996/#997 (import commun #995/#997
  → conflit au 2e merge) et controller-customization.ts par #999/#1001
  (#1001 dans la zone réécrite par #999) — ordre de merge recommandé
  consigné dans upstream-prs/README.md.
- **README « Deux versions » documenté (19 août ~17:00)** : section
  « Pourquoi le preview ne fait pas partie des PR upstream » (FR + EN) —
  client Microsoft fermé + P2/P1 déjà amont → le preview reste la valeur
  du fork. Table/liens à jour (1.11.0-preview2).
- **Décision (19 août ~15:00) — le preview n'est PAS proposable en PR
  upstream, vérifié dans le source amont** : le preview (play.xbox.com) est
  le NOUVEAU client Microsoft — bundle minifié, sans repo source public, et
  le repo redphx ne contient que le client stable. Surtout : **P2 et P1
  existent déjà côté stable amont** — `xcloud-interceptor.ts` L218-251
  (enableVibration/mkb/mic/touch dans clientStreamingConfigOverrides =
  notre P2, c'en est la source) et `remote-play-keep-alive.ts`
  (WarningForBeingIdle → sendKeepAlive = notre P1). Notre travail preview
  est une RE-dérivation pour le nouveau client, pas une évolution du
  script stable → rien de nouveau à proposer. Le preview reste la valeur
  ajoutée du fork (contrat « Deux versions »).
- **Commentaire d'information POSTÉ (19 août ~16:30) sur la PR #993**
  (`upstream-prs/comment-preview-port.md`,
  `#issuecomment-5340919050`) : annonce au mainteneur qu'on a un portage
  complet de play.xbox.com (FAB + game bar, résilience document,
  keep-alive idle, overrides /configuration, auto-spoof UA) dispo sur
  demande. Informatif — la seule interaction hors les PR (aucun rappel ne
  sera envoyé, politique 19 août).
13. ✅ **Fait (18 août ~00:10 puis ~08:30) — APK Android du build stable** :
    wrapper WebView `mobile/better-xcloud-perf-1.8.0.apk` (~144 Ko, package
    `com.bxperf.app`, signé keystore local, minSdk 24/target 34). Injecte le
    userscript stable (v1.8.0, `@grant none`, zéro GM_*) via
    `evaluateJavascript` en `onPageStarted` — équivalent document-start,
    écran maintenu, fullscreen géré. **CRASH DE LA V1 CORRIGÉ (18 août
    ~08:11, reproduit sur l'émulateur)** : le d8 de build-tools 34.0.0 (R8
    8.2.2-dev) plante en NullPointerException sur une classe ANONYME avec
    référence externe (this$0) ET superclasse du `--lib` (android.jar) — le
    dex sortait SANS `MainActivity$1/$2` (WebViewClient/WebChromeClient) et
    l'app crasheait au lancement sur TOUT appareil (`NoClassDefFoundError
    MainActivity$1`, MainActivity.java:67). Fix : classes internes STATIQUES
    nommées (`BxWebViewClient`/`BxWebChromeClient`/`AutoRetry`, référence
    d'activité au constructeur) + **gate dex dans build.sh** (dexdump +
    vérification des classes attendues, exit 1 sinon — plus jamais d'APK
    cassé). **Robustesse (18 août ~08:30)** : erreurs réseau/HTTP/SSL de la
    frame principale → **page d'erreur lisible** (plus d'écran blanc) avec
    bouton « Réessayer » ; **retry auto 3× backoff 5/15/30 s** ; liens
    externes → navigateur système. Pièges corrigés en test : (1) lambda
    interdite (`-source 8` + bootclasspath android.jar n'a pas
    LambdaMetafactory) → classe nommée `AutoRetry implements Runnable` ;
    (2) `onPageFinished` est appelé AUSSI pour les navigations ÉCHOUÉES
    (URL fautive) → annulait le retry — machine à états `errorPageShowing`
    (markRealPageStarted/onPageFinished garde). **Cycle panne→récupération
    validé sur l'émulateur** (navig CDP vers `www.xbox.com:444`) : page
    d'erreur affichée puis retry auto +5 s → retour `/fr-FR/play` avec
    overlay (`bx:true`), logs `EvenBetterXcloud` complets. **Overlay validé** :
    BX_EXPOSED=object, BX_FETCH=function, bouton settings visible (sonde
    CDP via `adb forward` + debug WebView activé). Preuves dans
    `mobile/validation-*.png/json/txt` (overlay, page d'erreur, récupéré).
    **Attaché comme asset de la release v1.8.0** (lien direct
    `releases/download/better-xcloud-perf-v1.8.0/better-xcloud-perf-1.8.0.apk`,
    re-uploadé et vérifié byte-identique). `mobile/build.sh` : prépare
    l'asset tout seul (copie du stable courant) et **réutilise le keystore
    d'origine** `D:\Codex\EvenBetterXcloud\bx-apk\bxperf.keystore` (empreinte SHA-256
    `63382a05…` inchangée → mise à jour par-dessus l'ancien OK).
    `mobile/assets/`, `out/`, `gen/`, `bxperf.keystore` gitignorés ; l'APK
    signé est le fichier suivi. Build **sans Gradle ni Android Studio** :
    SDK sur `D:/android-sdk`, pipeline aapt2 → javac → d8 → jar → zipalign
    → apksigner (`mobile/build.sh` rejouable). Limites : script embarqué
    (update = rebuild), gains GPU desktop non transposables, iOS impossible
    sans Mac/Xcode.    README FR/EN : ligne « App native » en tête du tableau
    mobile. ~~Testé sur émulateur ; appareil réel Android toujours à
    valider~~ — **RÉSOLU** : téléphone réel validé 18 août soir (item 16 :
    jeux lancés, menu complet, visual joypad).
14. ✅ **Fait (18 août ~10:05) — harnais mobile-probe + validation BlueStacks** :
    `bench/mobile-probe.sh` rejoue la validation APK en UNE commande (build →
    install → adb forward → sonde CDP → panne→récup → logcat). `--skip-build`,
    `--no-cycle`, `--manual` (récup par clic « Réessayer » au lieu du retry
    auto), `--serial` (fixé : le `for` ne doit PAS être utilisé pour parser
    `--serial <valeur>` — la valeur retombe dans `*)` → `while` + shift).
    `bench/mobile-probe.js` : sonde BX_EXPOSED/BX_FETCH/BX_CE + bouton
    settings **visible** (patience : la page peut démarrer en `readyState:
    loading` sur émulateur → attendre /play + BX_EXPOSED + bouton, pas
    d'assert au 1er essai) ; GATE ROUGE exit 1. `--cycle` = retry auto +5 s ;
    `--manual` = clic `<a href="…xbox.com/play">Réessayer</a>` (annule le
    retry auto en attente : logcat `resetLoadState` avant le backoff — pas de
    double navigation). `bench/mobile-probe.test.js` : 5 cas contre un FAUX
    endpoint CDP (mini serveur WebSocket maison, HTTP /json + handshake
    SHA-1 + frames masquées) — pièges : `spawnSync` bloque l'event loop du
    mock (utiliser `spawn` async) ; **relire la longueur étendue 16-bit des
    frames** (header 126 = « longueur sur 16 bits qui suit », pas 126 octets) ;
    `process.exit(0)` explicite en fin de probe (handle keep-alive).
    **Validé en réel sur BlueStacks (18 août ~09:55) — `adb connect
    127.0.0.1:5555`** (émulateur BlueStacks 5, profil Samsung SM-G998B
    spoofé, Android 9, x86_64) : les DEUX voies passent (`MOBILE PROBE OK`
    auto + manuelle), logcat EvenBetterXcloud complet. BlueStacks expose son adb sur le
    port 5555 (`adb connect`) — device `127.0.0.1:5555`. L'APK de la release
    = build local (dex + asset byte-identiques ; les hash APK diffèrent par
    les timestamps zip du rebuild uniquement, sans impact — vérifié par
    extraction dex/asset avant de re-uploader).
15. ✅ **Fait (18 août ~10:10) — re-baseline stable post-harnais** :
    `run-all.sh` complet sur le build courant (481 974 o, fixes document-start
    inclus) — toutes les bornes CI tiennent (table dans bench/README.md,
    « Re-baseline du 18 août ~10:10 ») : parse 0,104 ms · controller IDLE
    29,3 ns (×9,6) · poll_gamepad Home 137,5 ns (×8,8) · updateCanvas 9,5 ns
    (×22,0) · updateFrame 130,3 ns stable · éval page 17,3 ms méd (p95 28,4)
    · profil startup plat (one-shot codec différé intact) · cold-getcap eval
    23,6 ms (Δ −95,6 %). CI bench main : success (run 32114282345).
16. ✅ **Fait (18 août ~16:00) — build ES2017 + validation téléphone réel APK** :
    le bundle stable (build bun ESNext, 481 974 o, minify **syntaxe seule**)
    est re-transpilé en **ES2017** par `bench/es2017-build.mjs` (esbuild,
    `bun bench/es2017-build.mjs` → `better-xcloud.es2017.user.js`, 403 109 o
    −16 %). Header userscript préservé (esbuild le supprimerait : extrait
    avant transpile, ré-attaché après). Mesures (Edge 152) : bun ESNext éval
    page 23,1 ms → esbuild ES2020 10,8 ms → **ES2017 11,4 ms** — le gain
    vient de la **re-minification complète esbuild** (−17 % taille, −53 %
    startup, tous navigateurs), le downlevel pur coûte +3,4 Ko / +0,6 ms.
    Build à embarquer dans l'APK (couvre les vieux WebView Chrome < 80 :
    `?.`/`??`/class fields transpilés ; les ~9 `?.` résiduels sont dans des
    **template literals de patches**, évalués dans le contexte du site, non
    transpilables — sans impact, le site exige déjà ES2020). **Badge de
    diagnostic APK** (`mobile/assets/diag.js`, ES5, auto-masqué 10 s) :
    WebView Chrome <N> / BX_EXPOSED / BX_FETCH / settings btn / signed in
    / path — injecté en `onPageFinished` — répond « WebView trop vieux ? »
    vs « pas connecté ? ». `mobile/build.sh` : `BUNDLE_SRC` (env) pour
    embarquer un bundle alternatif. **VALIDATION TÉLÉPHONE RÉEL (18 août
    soir, utilisateur, APK de test ES2017) : les jeux se lancent, le menu
    settings COMPLET apparaît après connexion dans l'appli (WebView = ses
    propres cookies), et le visual joypad est actif pour les jeux manette
    (comportement natif du script sur device tactile).** Piège documenté :
    déconnecté le menu est réduit (`renderFullSettings = supportedRegion &&
    isSignedIn`, upstream) — se connecter dans l'appli débloque tout.
    Release v1.8.0 basculée sur l'ES2017 (user.js + APK re-uploadés,
    byte-identique vérifié ; ⚠ cache CDN GitHub : après `--clobber`, le lien
    peut servir l'ancien asset quelques minutes — piège du nommage). esbuild
    ajouté en devDependency.
17. ✅ **Fait (18 août ~16:25) — APK preview (deuxième version, contrat « Deux versions »)** :
    `mobile/build.sh` build deux APK installables côte à côte via `VARIANT`
    (env) : **stable** (défaut, `com.bxperf.app`, www.xbox.com/play +
    better-xcloud.user.js) et **preview** (`VARIANT=preview`, `com.bxperf.preview`,
    play.xbox.com + better-xcloud-preview.user.js, label distinct). START_URL
    injecté par une classe `BuildConfig` générée au build (pas de placeholder
    manifest) ; `AndroidManifest.template.xml` pour label/package ; **piège
    corrigé** : `R.java` généré par aapt2 suit le package du manifest
    (app/preview) → résolu dynamiquement, idem glob d8 (toutes les classes,
    pas un glob en dur) + gate dex (`R` dans le package du variant) + verify
    apksigner sur `$APK_NAME`. ⚠ L'output `out/` est écrasé à chaque build
    (`rm -rf` au step 2) : copier l'APK preview ailleurs avant de rebuild
    stable. **Validé BlueStacks (18 août)** : les deux APK installés côte à
    côte, le preview ouvre play.xbox.com et le script preview s'exécute
    (`BX_EXPOSED=object`, `BX_FETCH=function`, bouton overlay présent).
    APK preview : `mobile/out/better-xcloud-perf-1.8.0-preview.apk` (148 077 o)
    — publié sur la release preview4 (lien vérifié 200). ⚠ ~~RÉSERVÉ (18 août
    ~16:30) : overlay preview absent en WebView~~ — **RÉSOLU le 19 août** :
    cause = shell mobile sans ancre T4 (<768 px) → **FAB** (section « T4
    mobile »), puis bouton perdu quand le shell remplace le document →
    **re-arm T4** (v1.11.0-preview2, section dédiée).
18. ✅ **Fait (18 août ~17:00) — REBRAND EvenBetterXcloud + feature Sound + nouvelle icône (v1.9.0)** :
    le repo GitHub a été renommé `Endymi0n74/EvenBetter-Xcloud` (remote local
    mis à jour). **Marque** : tout ce qui porte notre version porte le nom —
    headers userscripts (@name EvenBetterXcloud, @namespace/@author Endymi0n74,
    @updateURL/@downloadURL → nouveau repo), badge du menu
    « **EvenBetterXcloud 1.9.0** » (au lieu de « Better xCloud 6.7.12 » :
    constante **BX_VERSION** injectée, SCRIPT_VERSION upstream CONSERVÉ pour le
    cache des patches), update-check rebranché sur NOTRE repo (fetch API +
    comparaisons BX_VERSION + parse de tag `evenbetter-xcloud-v1.9.0`),
    libellés t("better-xcloud") → littéral "EvenBetterXcloud" (non traduit),
    README/mobile/bench docs, label APK « EvenBetterXcloud », UA
    `EvenBetterXcloud/1.9.0`, tag logcat, diag.js. **Feature Sound** : groupe
    « Son » dans l'onglet GLOBAL (toggle booster `audio.volume.booster.enabled`
    + volume 0-600%, stepper désactivé tant que booster off), **visible même
    déconnecté** (ajout "sound" à la liste des groupes rendus sans connexion).
    **Nouvelle icône APK** (gen-icon.js v2) : nuage + flèche montante verte
    sur fond dégradé, supersamplée 4×, sans dépendance. **Outils rejouables** :
    `bench/rebrand-bundle.js` (gates, idempotent, --bump-only) +
    `bench/bump-version.sh` (VERSION racine + bundles + metas + manifest APK)
    — le badge suit la version à chaque changement (discipline : bump à chaque
    release). build-preview.js mis à jour (ancres rebrandées, PREVIEW_VERSION
    1.9.0-preview1, tag evenbetter-xcloud-v*, BX_VERSION preview substituée).
    **Validé** : BlueStacks APK v1.9.0 (ES2017) — badge « EvenBetterXcloud
    1.9.0 », groupe Son + toggle + stepper (preuve mobile/validation-ebx-son-
    1.9.0.png), perfs intactes (parse plat, controller ×8,7, updateCanvas ×19).
    ⚠ En attente release : publier v1.9.0 + v1.9.0-preview1 (le banner
    « Version 1.8.0 disponible » actuel est correct — latest = encore l'ancien
    tag — il disparaîtra après publication). **Package Android conservé**
    (com.bxperf.app) : identité d'installation, sinon désinstallation requise.
    Anciens tags de release conservés (historique + liens stables).
19. ✅ **Fait (18 août ~17:15) — rétention appliquée après le rebrand v1.9.0** :
    `bench/release-prune.sh` exécuté (dry-run puis réel). État final : **3
    releases conservées** — `evenbetter-xcloud-v1.9.0` (Latest), `evenbetter-
    xcloud-v1.9.0-preview1` (prerelease, tag pinné par le @updateURL du build)
    et `better-xcloud-perf-1.8.0-preview4` (cran de secours, sélectionné par le
    tri "dernier preview" via capture `preview(?<n>)`). L'ancienne stable
    `better-xcloud-perf-v1.8.0` a été purgée. **4/4 liens d'auto-update 200 +
    byte-identiques** (latest/user+meta, tag preview/user+meta). ⚠ Piège
    connu du tri preview : `preview(?<n>)` capture l'INDEX de preview
    (preview4 > preview1) pas la version de base — le tag pinné compense
    (source de vérité), mais le tri seul donnerait le mauvais preview si le
    pinné manquait. À améliorer si la nomenclature évolue (capture semver
    complet).
