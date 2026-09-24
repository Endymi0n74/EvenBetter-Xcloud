# Changelog — EvenBetterXcloud

Toutes les modifications notables de ce fork sont documentées ici. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/).

## [1.13.7] - 2026-09-24

Audit **systématique** des bus d'événements, au-delà du cas déjà connu : le bundle route `setting.changed` selon la CLASSE de la pref (`Settings.setSetting(key, value, "ui")` émet sur le bus **Stream** si `isStreamPref(key)`, sinon sur le bus **Script**). Un listener abonné au mauvais bus ne reçoit donc **jamais** rien — sans erreur, sans log, sans trace.

### Corrigé
- **Item `audio.volume` du groupe global « Son »** : sa seule pref filtrée, `audio.volume.booster.enabled`, est GLOBALE → il écoutait le bus Stream et ne recevait jamais la bascule (le `get params()` de la 1.13.6 corrigeait l'état initial, pas le dégrisage live). Il écoute désormais le bus **Script**.
- **Item `audio.volume` du panneau stream** : il filtre `audio.volume` (STREAM) ET le booster (GLOBALE) → son handler est maintenant abonné aux **deux** bus (callback extrait dans une variable locale, jamais dupliqué).
- **Fin du pont ad hoc du moteur son** : `BX_SOUND_ENGINE` ré-émettait Script → Stream pour masquer ces deux défauts — la livraison de code amont ne doit pas dépendre d'une feature. Le moteur continue d'écouter le booster sur les deux bus (défense en profondeur).
- **Contrôle de volume inutilisable quand la construction le désactive** (détecté par le nouveau banc Firefox) : `BxNumberStepper.create` faisait un early-return quand `options.disabled` était vrai **avant** de construire le `input[type=range]` — avec le `params.disabled` de la 1.13.6 (booster éteint = défaut), le range n'existait donc pas : le handler de l'item stream crashait (`querySelector("input[type=range"` — sélecteur amont non fermé — sur `null` → `TypeError`) et le dégrisage live écrivait une propriété muette sur le div. Correctif (2 paires dans `src/fixes/settings-freeze.js`) : le range est **toujours** construit, désactivé après coup ; sélecteur fermé + repli `|| $elm` (même forme que l'item « Son »). À la construction seul le range est grisé (pas les boutons) — strictement l'état du monde B après toggle, les handlers amont ne touchant que `$range`.

### Ajouté
- `bench/settings-bus-audit.js` + gate `bench/settings-bus.test.js` : audit **statique** de tous les `.on("setting.changed", …)` des deux bundles (extraction de `ALL_PREFS.global|stream`, résolution du callback inline ou `var onChange = …`, clés filtrées `===`/`!==`/`includes`, joker `isStreamPref(settingKey)`), verdict par callback — un handler abonné aux deux bus ne compte qu'une fois. L'audit refuse de conclure si le contrat d'émission dérive (audit périmé = rouge, jamais silencieux) et le gate prouve sa **non-vacuité** (fix bus reversé → les 2 défauts reviennent).
- `src/fixes/settings-bus.js` + `bench/fix-settings-bus.js` + `bench/fix-settings-bus.test.js` : second payload de remplacement, avec **garde d'ordre** (à appliquer après `settings-freeze`, GATE ROUGE sinon) ; l'injecteur du gel accepte en retour ces formes comme « déjà appliqué » (forme post-fix **dérivée** du payload suivant, jamais recopiée). Le rejeu depuis une base amont reproduit le bundle committé **octet pour octet**.
- `bench/sound-engine-firefox.mjs` rejoue désormais le **routage réel** (`setSetting` : booster → bus Script) au lieu d'un pont — 8/8 verts sous Firefox 153 (RMS ×1,98 à 200 %).

- `bench/settings-live-firefox.mjs` : banc **Firefox réel** (Playwright) du dialog settings ouvert par le vrai bouton d'en-tête — 9 checks répartis sur les deux scénarios booster (éteint / allumé à l'ouverture) : état range/boutons/texte, écriture de pref au clic réel, dégrisage/regrisage live, aller-retour, exceptions de page. 7/9 au premier run (2 défauts réels) → **9/9** après le correctif du stepper.

### Infra
- Gates `fix-settings-freeze`, `fix-settings-bus` et `settings-bus` câblées dans `bench.yml` : les fixes amont ne passaient par aucun pipeline, un rebuild pouvait en oublier un.

## [1.13.6] - 2026-09-24

Version qui **corrige enfin deux bugs jamais publiés** (la 1.13.5 servie n'en portait aucun : ses correctifs étaient restés sur une branche locale non poussée, tandis que la 1.13.5 publiée était une passe de maintenance).

### Corrigé
- **Gel de la page sous Firefox à l'ouverture des settings** : l'observateur global de `BxSelectElement` observait `documentElement` avec `{subtree, childList, attributes}` SANS `attributeFilter` → chaque mutation d'attribut de toute la page (rafale React du dialog) traversait `onMutation` + un `closest()` par record. Chromium encaissait, Firefox gelait.
- **« Le son marche mais je ne peux pas régler le volume »** — trois défauts cumulés sur le chemin du booster :
  1. **Bus** : `audio.volume.booster.enabled` est une pref GLOBALE, donc `setting.changed` part sur le bus **Script**, alors que les deux items `audio.volume` (groupe global « Son » et groupe « audio » du tab stream) ne l'écoutaient que sur le bus **Stream** → le slider restait grisé à vie et le dégrisage « live » de la 1.13.5 était du code mort.
  2. **Gating au chargement** : `patchAudioContext`/`setupGainNode` n'étaient évalués qu'au démarrage → activer le booster en cours de partie ne montait aucun gain node, donc le slider (une fois dégrisé) n'avait aucun effet audible.
  3. **Firefox** : `.resume()` n'était appelé **nulle part** ; un AudioContext créé sans geste utilisateur reste `suspended` et Firefox ne le relance jamais seul (Chrome si) → média mis en sourdine par le booster + graphe muet = silence, invisible sous Edge.
- Correctif : moteur `window.BX_SOUND_ENGINE` (`src/features/sound.js`) — pont Script→Stream, branchement du gain à la volée, adoption du graphe existant (pas de son doublé), `resume()` au changement de pref et au premier geste, un seul AudioContext par moteur, extinction propre.

### Ajouté
- `src/fixes/settings-freeze.js` + `bench/fix-settings-freeze.js` + `bench/fix-settings-freeze.test.js` : payload de **remplacement** (paires `from → to`) pour les correctifs amont, injecté et gaté comme une feature (idempotent, self-test, rejeu sur copie amont) — fin des éditions de bundle à la main.
- `bench/sound-engine-firefox.mjs` : preuve sous Firefox réel (Playwright) du moteur extrait **du bundle**, mesurée au RMS (100 % → 0,706 · 200 % → 1,412 soit ×1,99 · 0 % → 0,000), pont de bus, relance de contexte `suspended → running`, extinction → média ré-audible.
- Gate `feature-sound` étendue (section 2bis : 9 contrôles du moteur) ; `npm run check:src` couvre désormais `src/fixes/*` (pureté LF + paires valides).

## [1.13.5] - 2026-09-23

Version de maintenance : **aucun changement en-client** (mêmes features, mêmes perfs — seul le badge de version change).

### Infra & process
- Hygiène repo (PR #19) : package.json/scripts, Biome, CI concurrency+lint, sync upstream hebdo, CONTRIBUTING/CHANGELOG/SECURITY, topics, `network_security_config` APK
- Réparation release v1.13.4 (était incomplète : ESNext servi au lieu d'ES2017, APK 404, preview1 manquante, canal stale)
- Build : preview ES2017 régénéré après rebuild (était fossilisé), gate de reproductibilité ES2017 + check `src/`, `startup-cold` en dispatch manuel
- Code : payloads features modularisés en `src/features/*` (bundles byte-identiques), `esbuild.config.mjs` partagé
- Docs : `bench/README.md` allégé vers `docs/journal-*.md`, checklist release

## [1.13.4] - 2026-08-20 (+ réparation release 2026-09-23)

### Corrigé
- `poll_gamepad` crash guard (fix upstream)
- **Réparation release (23 sept)** : le `better-xcloud.user.js` servi contenait l'ESNext au lieu du build ES2017 (contrat release-guard), les APK étaient absents, la prerelease `v1.13.4-preview1` manquait et le canal preview servait encore la 1.13.3-preview1 → `release-guard.sh` à nouveau vert 4/4 + APK 200. Leçon encodée : `.gitattributes` force `eol=lf` sur les bundles, checklist release dans `CONTRIBUTING.md`.

### Docs
- Correction nom agent Buffy → Kumo, typo version MEMORY.md

## [1.13.3] - 2026-08-20

### Ajouté
- Gate stable `/play` sans locale (support Freebox/TV)
- Défauts TV APK `ui.controllerFriendly=true` + `ui.layout=tv`
- Fix navigation D-pad preview (listener capture)

### Infra
- Gate CI `tv-defaults.test.js`

## [1.13.2] - 2026-08-20

### Ajouté
- Feature « 📥 Session » import pair-à-pair WiFi (APK stable + preview)
- Port fallback 8765→8766

## [1.13.1] - 2026-08-20

### Ajouté
- Feature « 📥 Session » initiale
- Fix preview T11 (overlay en jeu) + T12 (volume live)

## [1.13.0] - 2026-08-18

### Ajouté
- Groupe « 🔊 Son » — 4 presets volume (Muet/Doux/Normal/Boost) live sur session

## [1.12.0] - 2026-08-19

### Ajouté
- Groupe *Server* : « ⚡ Appliquer la meilleure région » (un clic après test latence)

## [1.11.0] - 2026-08-19

### Ajouté
- Groupe « 📊 Données » — presets débit/résolution (Max / Équilibré / Économe) basés sur mesures réelles

## [1.10.0] - 2026-08-18

### Ajouté
- Feature « 📡 Test latence serveurs » (19 régions gssv, NATIVE_FETCH, tri RTT)

## [1.9.0] - 2026-08-18

### Changé
- Rebrand `Better xCloud` → `EvenBetterXcloud` (`@name`, `@namespace`, `@updateURL`, badge, APK label/icône)

## Antérieur — perf11

Voir en-tête de `better-xcloud.user.js` (optimisations 1–21) et `bench/README.md` pour les mesures.

---

*Historique détaillé des sessions : `MEMORY.md`.*
