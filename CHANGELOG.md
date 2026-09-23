# Changelog — EvenBetterXcloud

Toutes les modifications notables de ce fork sont documentées ici. Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/).

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
