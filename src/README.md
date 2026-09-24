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
| `fixes/settings-freeze.js` | Fix AMONT (v1.13.6) — gel des settings sous Firefox (attributeFilter de l'observateur BxSelectElement) + items `audio.volume` au `params` figé → `get params()` + onCreated booster ; v1.13.7 : `BxNumberStepper.create` sans early-return disabled (range TOUJOURS construit) + repli `|| $elm` sur le sélecteur stream |
| `fixes/settings-bus.js` | Fix AMONT (v1.13.7) — bus `setting.changed` : l'item « Son » abonné au bus Script (sa pref est GLOBALE), le handler du panneau stream aux deux bus |

Chaque module exporte `{ IMPL, ANCHOR_* }` : le payload injecté (texte exact
servi dans le bundle) + les ancres d'injection. La syntaxe des déclarations
est un contrat : les gates `bench/feature-*.test.js` les extraient par regex
(`const IMPL = \`...\`;`, `const ANCHOR_X = "...";`) — la renommer casse le CI.

## Pipeline

```
src/features/<f>.js --require--> bench/feature-<f>.js --injecte--> better-xcloud.user.js
        |                                                        \
        +--regex--> bench/feature-<f>.test.js (gate CI)           +--build-preview.js--> better-xcloud-preview.user.js

src/fixes/<f>.js    --require--> bench/fix-<f>.js     --applique--> better-xcloud.user.js
        |                                                        \
        +--require--> bench/fix-<f>.test.js (gate CI)             +--build-preview.js--> better-xcloud-preview.user.js
```

Les **features** ajoutent du code (une `IMPL` textuelle injectée à une ancre) ;
les **fixes** remplacent du code amont (une liste de paires `from → to`). Les deux
sont idempotents et gatés — ne jamais éditer un bundle à la main pour ces zones.

⚠ Piège vécu (v1.13.6) : un fix qui réécrit une zone citée comme ANCRE par une
feature change la forme injectée attendue. `fixes/settings-freeze.js` redonne à
l'item `audio.volume` global une fin identique à `ANCHOR_TAIL` de la feature son
→ l'étape « item presets » de `bench/feature-sound.js` se relançait et réinjectait
son item DANS la fin de l'item corrigé. Sa garde d'idempotence porte donc sur le
marqueur `BX_SOUND_PRESETS.render($parent)`, pas sur `ITEM_SOUND`.

⚠ ORDRE des fixes : `settings-freeze` puis `settings-bus`. Le second réécrit le
CONTENU de deux paires du premier ; `bench/fix-settings-bus.js` refuse de tourner
avant (GATE ROUGE « ORDRE ») et `bench/fix-settings-freeze.js` accepte en retour
ces formes-là comme « déjà appliqué » (`rebusItemText` — la forme post-fix est
DÉRIVÉE du payload du fix suivant, jamais recopiée).

🔎 Audit des bus : `node bench/settings-bus-audit.js` (gate
`bench/settings-bus.test.js`) relit les bundles et vérifie que chaque
souscription `.on("setting.changed", …)` peut recevoir les prefs qu'elle filtre —
le bus **Stream** ne porte que les prefs de `ALL_PREFS.stream`, le bus **Script**
tout le reste (routage de `Settings.setSetting(key, value, "ui")`). Il refuse
aussi de conclure si ce contrat d'émission dérive (sinon l'audit serait périmé
en silence). Une UI qui écoute une pref globale sur le bus Stream est donc
attrapée en CI au lieu de mourir sans bruit.

- `node esbuild.config.mjs --check` : valide les payloads (parse esbuild + pureté LF).
- `npm run build:es2017` : régénère les builds ES2017 depuis les bundles.
- Règle d'or : **les bundles committés ne changent qu'au bump** (`bench/bump-version.sh`).
  Un refactor ici doit produire des bundles byte-identiques (voir `bench/es2017-check.sh`
  pour le même principe côté ES2017).

## Fin de ligne

`.gitattributes` force `eol=lf` sur `*.js` : un CRLF dans un payload changerait
les bytes injectés selon l'OS de build. Ne jamais commiter de `\r` dans `src/`.
