# src/ — code first-party du fork (modules)

Le bundle `better-xcloud.user.js` reste un monolithe (il dérive du build
amont redphx, sans sources publiques découpables — le découper en modules
ES casserait les ancres et les bytes attendus par l'auto-update). Ce dossier
modularise **notre** code : chaque feature vit dans un module versionné,
consommé par son script d'injection et vérifié par son gate.

## Contenu

| Module | Rôle |
|---|---|
| `features/sound.js` | Feature 🔊 Son — presets volume live |
| `features/datasaver.js` | Feature 📊 Données — presets débit/résolution |
| `features/latency.js` | Feature 📡 Latence — test RTT 19 régions |
| `features/region.js` | Feature ⚡ Région — applique la meilleure région |
| `features/session-import.js` | Feature 📥 Session — transfert WiFi MSAL |
| `features/diag-purge.js` | Routine BX_PURGE_DIAG — purge listeners win-capture |

Chaque module exporte `{ IMPL, ANCHOR_* }` : le payload injecté (texte exact
servi dans le bundle) + les ancres d'injection. La syntaxe des déclarations
est un contrat : les gates `bench/feature-*.test.js` les extraient par regex
(`const IMPL = \`...\`;`, `const ANCHOR_X = "...";`) — la renommer casse le CI.

## Pipeline

```
src/features/<f>.js --require--> bench/feature-<f>.js --injecte--> better-xcloud.user.js
        |                                                        \
        +--regex--> bench/feature-<f>.test.js (gate CI)           +--build-preview.js--> better-xcloud-preview.user.js
```

- `node esbuild.config.mjs --check` : valide les payloads (parse esbuild + pureté LF).
- `npm run build:es2017` : régénère les builds ES2017 depuis les bundles.
- Règle d'or : **les bundles committés ne changent qu'au bump** (`bench/bump-version.sh`).
  Un refactor ici doit produire des bundles byte-identiques (voir `bench/es2017-check.sh`
  pour le même principe côté ES2017).

## Fin de ligne

`.gitattributes` force `eol=lf` sur `*.js` : un CRLF dans un payload changerait
les bytes injectés selon l'OS de build. Ne jamais commiter de `\r` dans `src/`.
