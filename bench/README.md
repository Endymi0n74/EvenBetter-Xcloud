# bench/ — harnais de benchmark CPU

Mesures **perf10 (baseline `055d3a0`)** vs **build courant** (`better-xcloud.user.js`
à la racine du repo). Tout se lance d'un coup :

```bash
./bench/run-all.sh                 # les 3 harnais
./bench/run-all.sh --skip-page-eval # sans Playwright/Edge
```

Prérequis : Node. Pour l'éval page : Playwright + Edge (canal `msedge`) — installer
avec `npm i -D playwright` ou pointer `NODE_PATH` vers un install existant.

| Fichier | Mesure | Environnement |
|---|---|---|
| `parse.js` | Parse/compile (`new Function`, sans exécution, ×300) | Node V8 |
| `hotloops.js` | Hot loops injectés ~60 Hz (controller, poll_gamepad, updateFrame) | Node V8 |
| `page-eval.js` | Éval complète de page, injection au document-start, 20 runs | Edge headless + Playwright |

Détails des pièges de chaque harnais dans la section « Repro » du README principal.
Le harnais **GPU** (renderer WebGL2, compteurs GL, GPU timestamps) vit hors repo dans
`D:\Codex\gpubench\` — voir la section Repro du README.
