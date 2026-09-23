# Contribuer à EvenBetterXcloud

> Vibe-coding avec Codebuff (agent Kumo) sous direction humaine Endymi0n74. Les contributions humaines restent bienvenues.

## Démarrage rapide

```bash
git clone https://github.com/Endymi0n74/EvenBetter-Xcloud.git
cd EvenBetter-Xcloud
npm install
npm run bench:quick   # parse + hot loops sans navigateur
npm run verify        # gates readme-version + preview
```

## Structure

| Dossier | Rôle |
|---|---|
| `better-xcloud.*.js` | Artefacts buildés (ne pas éditer à la main) |
| `patches/` | Patches upstream redphx |
| `bench/` | Harnais bench CPU/GPU + gates CI |
| `bench/preview/port/` | Portage play.xbox.com (T1-T10, P1-P3) |
| `mobile/` | Wrapper WebView Android (build sans Gradle) |
| `upstream-prs/` | PRs ouvertes vers redphx |

## Workflow

1. **Branche** depuis `main` : `feat/xxx` ou `fix/xxx`
2. **Modifs** sur le source (pas sur les bundles directement si possible)
3. **Gates locaux** avant push :
   ```bash
   node bench/readme-version.test.js
   node bench/readme-version.test.js --self-test
   node bench/preview/port/build-preview.js
   bash bench/run-all.sh --skip-page-eval
   ```
4. **Bump version** (mainteneur) :
   ```bash
   bash bench/bump-version.sh 1.13.5 --preview=1.13.5-preview1 --build-apk
   ```

## Checklist release (mainteneur — incident sept 2026 : ne plus publier incomplet)

Après chaque bump, avant d'annoncer :
1. Release stable : `better-xcloud.user.js` (= contenu ES2017), `.meta.js`, `.es2017.user.js` + APK versionné + APK nom stable `evenbetter-xcloud.apk`
2. Prerelease preview : `better-xcloud-preview.user.js` + `.meta.js` + APK preview
3. Canal flottant ré-uploadé `--clobber` (2 assets preview)
4. `bash bench/release-guard.sh` → **vert** (4/4 byte-identiques + APK 200)
5. `bash bench/release-prune.sh` (le workflow auto-prune tourne aussi à chaque publication)
6. Contraintes build : cloner dans un chemin **sans espace** (`mobile/build.sh` ne supporte pas les espaces — glob `d8` non quoté) ; uploader depuis des fichiers **LF** (`.gitattributes` force `eol=lf`, ne pas uploader depuis un working tree CRLF)

## Conventions

- Source de vérité version : `VERSION` + `PREVIEW_VERSION` (et `package.json#version` miroir)
- README toujours à jour : le gate `bench/readme-version.test.js` casse le CI si un README garde une ancienne version
- `MEMORY.md` : journal de sessions interne, ne pas polluer les PRs avec son historique complet
- Commits : signature `Generated with Codebuff` acceptée, messages en FR ou EN

## Tests

- `bench/run-all.sh --skip-page-eval` : perf CPU (Node, sans navigateur)
- `bench/run-all.sh --cold-page-eval` : perf à froid (nécessite Playwright + Edge)
- `bench/stream-instrument.js` : observation stream réel (CDP)

## APK

```bash
bash mobile/build.sh                 # stable
VARIANT=preview bash mobile/build.sh # preview
```
Prérequis : JDK 21 + Android SDK `platforms;android-34` + `build-tools;34.0.0`.

## Licence

MIT — crédit à [redphx](https://github.com/redphx) pour Better xCloud.
