# Journal — features & portage

> **Archive — extrait de `bench/README.md` le 2026-09-23.** Journal daté,
> conservé pour l'historique : ne pas mettre à jour (les versions et liens
> cités sont ceux de l'époque). Features utilisateur, rebrand et routines, dans l'ordre du fichier d'origine.

## Feature « 📊 Données » — presets débit/résolution (v1.11.0, 19 août)

Nouvelle feature utilisateur via le pattern `feature-latency.js` :

- **`bench/feature-datasaver.js`** — injecte un groupe « 📊 Données » dans
  les settings (3 presets 🚀 Max / ⚖️ Équilibré / 🌱 Économe) avec gates
  (GATE ROUGE si une ancre dérive) + `--self-test` + idempotence. Basé sur
  les mesures du 18 août (le cap maxBitrate est le seul réglage qui
  économise sans perdre la définition).
- **`bench/feature-datasaver-probe.js`** — validation CDP en réel
  (Edge guard-badge + extension `.edge-inject-stable`) : groupe rendu même
  déconnecté, clic preset → prefs posées via `getGlobalPref`/`setGlobalPref`
  (`stream.video.*` sont des prefs **globales** — `getStreamPref` THROWE),
  restauration illimité.
- **Pièges** : `maxBitrate` a un `transformValue` (max slider 15360000 ↔
  stocké 0) — écrire 0 est clampé à 102400, écrire **15360000** = illimité ;
  l'extension d'injection lit `stable.js` au démarrage d'Edge (relancer
  Edge après un rebuild).

## Feature « 🔊 Son » — presets de volume (v1.13.0, 18 août)

Quatre presets en un clic dans le groupe « Audio » de l'onglet **stream**
(sous le slider natif `audio.volume`) : 🔇 Muet (0) / 🔉 Doux (50) /
🔊 Normal (100 + booster off) / 📢 Boost (200 + booster on). Mécanique :
`setStreamPref("audio.volume", v, "ui")` (pref STREAM) +
`setGlobalPref("audio.volume.booster.enabled", …)` (pref GLOBALE) — le 3e
argument `"ui"` émet `setting.changed` → le slider natif se sync et les
onChange s'appliquent (`SoundShortcut.setGainNodeVolume` en session).

- Injection : `node bench/feature-sound.js <bundle.js> [--dry-run]
  [--self-test]` — gates (GATE ROUGE si une ancre dérive) + idempotence +
  self-test sur copie corrompue. Gate CI : `bench/feature-sound.test.js`.
- Probe réelle : `node bench/feature-sound-probe.js [--port=9225]` — ouvre
  les settings, bascule l'onglet stream, vérifie le rendu des 4 presets puis
  joue le **cycle complet** avec vérification prefs + statut live à chaque
  étape.
- **Diagnostic 18 août (fausse alarme « clics morts »)** : un premier run de
  probe rapportait des clics sans effet. Cause réelle : les prefs
  **persistent** entre les runs (localStorage) — la probe cliquait « 🔉 Doux »
  alors qu'il était **déjà actif** (vol=50 posé par un run précédent) → no-op
  attendu, pas un bug. Pièges connexes : (1) `saveSettings` est débouncée
  ~100 ms → lire les prefs juste après le clic peut voir l'ancienne valeur ;
  (2) les labels contiennent emojis + parenthèses (« 🔊 Normal (défaut) ») →
  le matching par **regex construite** est fragile, `textContent.includes`
  est sûr. La probe blindée : bascule **forcée** vers un autre preset si la
  cible est déjà active (le clic testé est toujours une vraie transition),
  **poll** des prefs jusqu'au flush du debounce (pas de sleep fixe), matching
  par `includes`. Validé en réel le 18 août : cycle complet 4 presets OK dans
  les deux cas de départ (état Normal et état Boost déjà actif).

## Routine de purge des listeners de diagnostic — BX_PURGE_DIAG (19-20 août)

Pendant une session CDP on attache des listeners de diagnostic sur `window`
(convention : le marqueur `win-capture` dans la source). Un listener oublié à
fermeture cassée peut THROWER à chaque clic. La routine injectée au démarrage
(`bench/feature-diag-purge.js`, ancre BX_EXPOSED) hook `window.
addEventListener`/`removeEventListener`, enregistre les listeners marqués et
expose `window.BX_PURGE_DIAG()` (retire uniquement ceux-là, appelé au
démarrage + utilisable en fin de probe). Gate CI `bench/feature-diag-purge.
test.js` : présence stable+preview, ancres, **test fonctionnel vm** (2 marqués
purges, normal conservé) + self-test. Les probes CDP (`feature-sound-probe`,
`feature-datasaver-probe`, `feature-region-probe`) appellent `BX_PURGE_DIAG()`
en fin de run (best-effort, no-op si API absente) et documentent la
convention `win-capture` dans leurs entêtes. Pièges documentés : les
exceptions des listeners ne remontent PAS au dispatcher (compter via le
handler `error` de window) ; après purge du ScriptCache MV3 + relance
Edge, la page chargée avant l'extension n'a pas le bundle → un reload
suffit.

## Rebrand EvenBetterXcloud + feature Sound (v1.9.0, 18 août)

Le fork est **renommé EvenBetterXcloud** (repo `Endymi0n74/EvenBetter-Xcloud`)
et tout ce qui porte la marque a été mis à jour en une passe : headers
userscripts (@name/@namespace/@version/@updateURL/@downloadURL), badge du
menu (`EvenBetterXcloud 1.9.0` au lieu de `Better xCloud 6.7.12`), libellés
visibles, update-check (fetch vers NOTRE repo + comparaison sur BX_VERSION),
label/UA/logs de l'APK, icône APK (nuage + flèche verte).

**Outils rejouables** (la marque est un artefact de build, pas du manuel) :

- `bench/rebrand-bundle.js <bundle> [--version=X] [--no-sound] [--dry-run]`
  — applique le rebrand + la feature Sound à un bundle frais, avec **gates**
  (GATE ROUGE si un pattern a dérivé dans une future version du bundle).
  Idempotent (no-op si déjà rebrandé) ; `--bump-only` pour ne changer que la
  version (headers + BX_VERSION + commentaire OPTIMISATIONS).
- `bash bench/bump-version.sh <v> [--preview=...] [--build-apk] [--no-verify]`
  — bump CENTRALISÉ, **cycle complet en UNE commande** : VERSION (racine),
  stable, es2017 (régénéré), preview, metas, manifest APK
  (versionName/versionCode) + **passe README structurelle** (README.md /
  README.en.md / mobile/README.md : titre, table Deux versions, tags/liens,
  APK — les mentions historiques en prose ne sont pas touchées) + rebuild
  preview (build-preview.js re-pinne `@updateURL` sur le nouveau tag) + gate
  `readme-version.test.js` final (GATE ROUGE → exit 1 si un README ou un
  bundle garde l'ancienne version). `--no-verify` saute le rebuild + gate
  (rare). **À exécuter à chaque changement de version.**
- La version est lue par `mobile/build.sh` (`VERSION` racine) pour nommer les
  APK : `evenbetter-xcloud-<v>.apk` / `evenbetter-xcloud-<v>-preview1.apk`.
- `node bench/verify-badge.js [--port=9224] [--banner]` — valide EN RÉEL le
  badge du menu : charge xbox.com/play dans un Edge piloté par CDP (extension
  locale `.edge-inject-stable` = le bundle servi par releases/latest,
  équivalent Greasemonkey), ouvre les settings, lit le badge « EvenBetterXcloud
  <version> », vérifie que c'est un lien vers nos releases (`<a href="…/
  EvenBetter-Xcloud/releases" target="_blank">`) et qu'un vrai clic CDP
  ouvre bien cette page (preuve PNG dans /d/Codex). **`--banner`** : simule
  l'UA Android (la bannière n'apparaît que sur Android), vérifie que la
  bannière « 🔥 EvenBetterXcloud app for Android » pointe vers le
  téléchargement DIRECT de l'APK (`latest/download/evenbetter-xcloud.apk`),
  clique dessus et confirme le téléchargement RÉEL (événements CDP
  `downloadWillBegin` + `downloadProgress` 135788/135788 o). Validé 18 août :
  badge 1.9.0 + clic releases + bannière → APK téléchargé. ⚠ Pièges : les
  extensions `.edge-inject*` ne sont PAS commitées (outils locaux) ; Edge
  SmartScreen SUPPRIME l'APK téléchargé après réception (événement cancel +
  hub « fichier supprimé ») — la preuve passe par les événements CDP, pas par
  le fichier ; un clic juste après l'ouverture d'un onglet (badge) peut être
  avalé → pause 600 ms après `Page.bringToFront` (sinon retenter le clic).

**Feature Sound** (groupe « Son » dans l'onglet GLOBAL, visible même
**déconnecté**) : toggle « Activer la fonction de contrôle du volume »
(`audio.volume.booster.enabled`) + volume 0-600% (`audio.volume`, stepper
−/+/désactivé tant que le booster est off) — même mécanique que le groupe
Audio de l'onglet stream (gain node), mais accessible sans session.
Injectée par rebrand-bundle.js (2 ancres vérifiées). Validé en réel sur
l'APK (BlueStacks, déconnecté) : badge `EvenBetterXcloud 1.9.0` + groupe
`Son` + toggle + stepper volume (preuve `mobile/validation-ebx-son-1.9.0.png`).

**Perfs après rebrand (seed 42, 1 passe)** : parse plat (0,155 ms),
controller IDLE 37,6 ns (×8,7), updateCanvas 13 ns (×19), updateFrame
162 ns stable — aucune régression.

## Feature v1.10.0 — 📡 Test de latence serveur (18 août ~21:30)

Bouton « 📡 Tester la latence des serveurs » dans le groupe **SERVER** des
settings globaux : ping chaque région gssv (`STATES.serverRegions`, la liste
réelle chargée par le client) via `NATIVE_FETCH` (le fetch ORIGINAL capturé
par le script — ni le hook BX_FETCH ni l'XcloudInterceptor), mesure le RTT
(timeout 3 s), affiche le tri du meilleur au pire et marque « ⭐ région
recommandée ». Objectif : choisir le meilleur `server.region` avec des
mesures réelles.

- Injection : `node bench/feature-latency.js <bundle.js> [--dry-run]
  [--self-test]` — déterministe, gates (GATE ROUGE si une ancre a dérivé),
  idempotent, self-test sur copie corrompue. À rejouer après chaque rebuild
  upstream (comme rebrand-bundle.js).
- ⚠ Pièges découverts en validation : (1) `shortName` contient l'emoji
drapeau (« 🇺🇸 EUS ») → l'hôte dérivé est invalide — utiliser **`baseUri`**
(`https://eus.core.gssv-play-prod.xboxlive.com`), le champ propre de la
région ; (2) l'XcloudInterceptor route les URLs finissant par
`/sessions/cloud/play` vers handlePlay → suffixe `?probe=1` + NATIVE_FETCH
pour une mesure pure ; (3) `networkTestHostname` (gssv-fastlane) ne résout
pas depuis ce PC — inutilisable. Libellés inline en anglais (pas de clé de
traduction) — traduction à ajouter si besoin.
- **Validé en réel (profil guard-badge, connecté, 19 régions)** : tous les
RTT réels, cohérents géographiquement — ⭐ CSE (Suède) 30 ms, WEU
(Pays-Bas) 41 ms, UKS (défaut) 43 ms, MXC 104 ms, Japan 804 ms. Preuve :
`bench/.latency-feature-proof.png`. Aucun timeout, < 1 s par région.

## Audit des bus `setting.changed` — v1.13.7 (24 septembre)

Routage reconstruit depuis le bundle : `Settings.setSetting(key, value, "ui")`
émet sur le bus **Stream** si `isStreamPref(key)`, sinon sur le bus **Script** —
autrement dit le bus Stream ne porte que `ALL_PREFS.stream`, le bus Script tout le
reste. Un listener abonné au mauvais bus est **injoignable** : pas d'erreur, pas
de log, juste un callback jamais appelé.

L'audit `bench/settings-bus-audit.js` (gate `bench/settings-bus.test.js`) relit
les deux bundles, extrait les clés filtrées par chaque `.on("setting.changed", …)`
(callback inline ou `var onChange = …` résolu), regroupe par callback (un même
handler abonné aux deux bus ne compte qu'une fois) et refuse de conclure si le
contrat d'émission dérive. Verdict sur la 1.13.6 : **2 listeners amont
injoignables** (les deux items `audio.volume` attendaient la pref **globale**
`audio.volume.booster.enabled` sur le bus Stream) + le pont Script→Stream du
moteur son — béquille qui les masquait jusqu'ici. Les 4 autres listeners amont
sont corrects (`stats.colors` stream, `StreamSettings` gardé par `isStreamPref`).

Correction (`src/fixes/settings-bus.js`, injecteur `bench/fix-settings-bus.js`) :
l'item « Son » s'abonne au bus Script ; le handler du panneau stream, qui filtre
une pref stream **et** la pref globale, est extrait dans `bxOnSettingChanged` et
abonné aux deux bus. Le pont du moteur est supprimé (le booster reste écouté sur
les deux bus). Le second fix dépend du premier (`settings-freeze` crée la ligne
visée) : l'injecteur refuse l'ordre inverse, et l'injecteur du gel considère les
formes post-bus comme « déjà appliqué » (forme **dérivée** par `rebusItemText`,
jamais recopiée). Preuve Firefox réelle : `node bench/sound-engine-firefox.mjs`
— le harnais rejoue le routage réel de `setSetting` au lieu d'un pont → 8/8.

## Banc settings live sous Firefox + fix du stepper « audio.volume » (24 septembre)

`bench/settings-live-firefox.mjs` rejoue le parcours réel (Playwright + Firefox
153 : clic sur le vrai bouton d'en-tête → dialog → contrôles et clics réels)
sur les deux scénarios booster (éteint / allumé à l'ouverture) — 9 checks :
présence et état du contrôle (range / boutons / texte), écriture de pref au clic,
dégrisage et regrisage live, exceptions de page. **7/9 au premier run**, deux
défauts réels partageant une cause racine :

- **early-return de `BxNumberStepper.create`** : `options.disabled` retournait
  AVANT la construction du `input[type=range]` — avec le `params.disabled` de la
  1.13.6 (booster éteint = défaut), le range n'existait pas : le handler stream
  crashait (`querySelector("input[type=range")` sur `null` → `TypeError`) et le
  dégrisage live écrivait une propriété muette sur le div. Correctif (2 paires
  dans `src/fixes/settings-freeze.js`) : le range est **toujours** construit,
  désactivé après coup — à la construction seul le range est grisé (pas les
  boutons), strictement équivalent au monde B après toggle puisque les handlers
  amont ne touchent que `$range`.
- **sélecteur amont non fermé** `input[type=range` → fermé + repli `|| $elm`
  (même forme que l'item « Son »).

Preuve : **9/9** (A2 range désactivé présent · A4 dégrisé en direct · C1 zéro
exception · A≡B). Migration des bundles dérivée de `rebusItemText` → rebuild
preview (overlay), es2017 et APK ×2 → `npm test` 22/22.
