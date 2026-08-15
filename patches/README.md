# Patches perf11 — portage sélectif

Les patches produisent le build `better-xcloud-perf-v1.5.0` (`@version 1.5.0`,
série d'optimisations perf11 + perf13 + fix RGB8 + cache uniforms).

19 patches individuels, chacun **vérifié applicable seul** sur la baseline
`Better xCloud-6.7.12-perf10.js` (round-trip : `node --check` OK après application).

## Application d'un patch seul

```bash
# Le fichier cible doit s'appeler better-xcloud.user.js (renomme ta baseline)
git -c core.autocrlf=false apply patches/01-version-header.patch
```

`core.autocrlf=false` est indispensable sous Windows (le défaut `true` casse
l'application — conversion LF→CRLF du contexte).

## Liste des patches

| Patch | Optimisation | Zone |
|---|---|---|
| `01-version-header.patch` | Bump `6.7.12-perf10` → `1.5.0` + header (version, optis, `@updateURL` → `better-xcloud.meta.js`) | global |
| `02-allprefs-set.patch` | `ALL_PREFS` → `Set`, lookups O(1) | settings |
| `03-settings-validatevalue-filter.patch` | `validateValue` : `filter` + `Set` (fin du saut d'index splice) | settings |
| `04-settings-deletesettings-batch.patch` | `deleteSettings` batch + `getGameSettings` mono-`saveSettings` | settings |
| `05-checkforupdate-throttle.patch` | Garde 2h avant le fetch GitHub | settings |
| `06-bxselect-delegated-observer.patch` | Un seul `MutationObserver` délégué | ui |
| `07-streamstats-opacity-cache-fix.patch` | Fix régression cache opacity/textSize | streamstats |
| `08-streamstats-hidden-throttle.patch` | Throttle `document.hidden` 60s + `setTimeout` auto-réarmé | streamstats |
| `09-collect-single-pass.patch` | `collect()` en un seul parcours du report | streamstats |
| `10-translations-debugger-removed.patch` | `debugger` retiré de `downloadTranslations` | ui |
| `11-controller-custom-share-delete-fix.patch` | Fix `delete mapping.Share` (binding + spam screenshot) | controller |
| `12-controller-custom-skip-idle.patch` | Skip idle (zéro allocation au repos) | controller |
| `13-webgl2-stable-texture.patch` | `texStorage2D` + `texSubImage2D` (allocation GPU stable) | webgl2 |
| `14-webgl2-viewport-fix.patch` | Viewport `drawingBufferHeight` | webgl2 |
| `15-poll-structuredclone.patch` | `structuredClone` → référence directe au relâchement Home (zéro allocation) | controller |
| `16-webgl2-bindtexture.patch` | `bindTexture` par frame supprimé (état final `updateFrame`) | webgl2 |
| `17-webgl2-nocolorconvert.patch` | Flag expérimental `WebGL2NoColorConversion` — partie `DEFAULT_FLAGS` (la partie `setupShaders` est dans les patches « état final » 16/18) | webgl2 |
| `18-webgl2-texstorage-rgb8.patch` | Fix `texStorage2D` : `gl.RGB` (non-sized → INVALID_ENUM, renderer WebGL2 noir) → `gl.RGB8` (état final `updateFrame`) | webgl2 |
| `19-webgl2-uniform-cache.patch` | Cache des valeurs de uniforms dans `updateCanvas` (7 `gl.uniform*` sautés par frame au repos ; invalidation par comparaison de valeurs — état final `updateCanvas`) | webgl2 |

## Matrice de compatibilité (empilement par paires)

Ligne i, colonne j : ✓ = j s'applique proprement après i, ✗ = conflit.

```
    01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19
  01  .  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓
  02  ✓  .  ✓  ✓  ✗  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓
  03  ✓  ✓  .  ✗  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓
  04  ✓  ✓  ✗  .  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓
  05  ✓  ✗  ✓  ✓  .  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓
  06  ✓  ✓  ✓  ✓  ✓  .  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓
  07  ✓  ✓  ✓  ✓  ✓  ✓  .  ✗  ✗  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓
  08  ✓  ✓  ✓  ✓  ✓  ✓  ✗  .  ✗  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓
  09  ✓  ✓  ✓  ✓  ✓  ✓  ✗  ✗  .  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓
  10  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  .  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓
  11  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  .  ✗  ✓  ✓  ✗  ✓  ✓  ✓  ✓
  12  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✗  .  ✓  ✓  ✗  ✓  ✓  ✓  ✓
  13  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  .  ✗  ✓  ✗  ✓  ✗  ✗
  14  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✗  .  ✓  ✗  ✓  ✗  ✗
  15  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✗  ✗  ✓  ✓  .  ✓  ✓  ✓  ✓
  16  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✗  ✗  ✓  .  ✓  ✗  ✗
  17  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  .  ✓  ✓
  18  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✗  ✗  ✓  ✗  ✓  .  ✗
  19  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✓  ✗  ✗  ✓  ✗  ✓  ✗  .
```

### Zones incompatibles (mêmes lignes physiques du fichier minifié)

Les ✗ ci-dessus viennent du fichier buildé, minifié en lignes géantes : plusieurs
optimisations de la même zone modifient la même ligne physique, donc leurs hunks
se marchent dessus quand on les empile. Pour porter **plusieurs** optimisations
d'une même zone sur une branche :

- **settings (02→05)** : `02+03` OK, mais `04`/`05` ensuite entrent en conflit
  avec `03`/`02` (lignes partagées). Prendre soit `02+03`, soit `04+05`, soit
  appliquer le patch global.
- **streamstats (07→09)** : `07`, `08`, `09` sont mutuellement exclusifs entre eux.
- **controller (11+12+15)** : mutuellement exclusifs (ligne `controller_customization_default`).
- **webgl2 (13+14+16+17+18+19)** : mutuellement exclusifs (ligne `WebGL2Player`) — sauf 17 (hunk `DEFAULT_FLAGS` seul) qui s'empile avec les autres. 18 (fix RGB8) est l'état final `updateFrame` : préférer 18 à 16. 19 (cache uniforms) est l'état final `updateCanvas` : préférer 19 pour le chemin uniforms.
- **ui (06+10)** : s'empilent sans problème.

### Pour tout porter d'un coup

Utilise le patch global `better-xcloud-perf11.patch` (racine du dépôt),
vérifié en round-trip octet-pour-octet sur la baseline :

```bash
git -c core.autocrlf=false apply better-xcloud-perf11.patch
```

## Vérification après application

```bash
node --check better-xcloud.user.js
```
