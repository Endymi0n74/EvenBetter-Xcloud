## Feature : « 📊 Data usage » — presets débit/résolution en un clic

### Quoi

Nouvelle section **📊 Data usage** dans les settings globaux (visible même
sans être connecté, pour poser le mode **avant** de lancer une session) avec
3 presets qui posent les prefs globales existantes
`stream.video.maxBitrate` et `stream.video.resolution` :

- 🚀 **Max (default)** — débit illimité, résolution auto
- ⚖️ **Balanced (recommended)** — cap 10 Mbps, conserve la 1440p
- 🌱 **Eco** — cap 5 Mbps + 720p

Un clic = `setGlobalPref(key, value, 'ui')` (le même chemin que les selects
natifs : validation + persistance + événement UI). La valeur courante est
affichée et mise à jour après chaque clic.

### Pourquoi c'est sûr

- **Aucune nouvelle pref** : réutilise `stream.video.maxBitrate` /
  `stream.video.resolution` et leurs définitions existantes (le
  `transformValue` de maxBitrate est respecté : écrire le max du slider =
  stocké 0 = illimité, exactement ce que fait le slider natif).
- Les presets ne font que ce que font déjà les selects natifs — zéro
  changement de logique de stream.
- La section est ajoutée au filtre de rendu hors-connexion (à côté de
  general/footer/advanced) pour être posée avant une session.

### Mesure (fork, 18 août, As Dusk Falls 1440p30)

- `stream.video.maxBitrate` (SDP `b=AS:`) est **honoré par l'encodeur** :
  défaut 24,2 Mbps → cap 10 Mbps = **6,6 Mbps réels**, cap 5 Mbps =
  **4,7 Mbps**, résolution inchangée, 0 frame drop.
- `stream.video.resolution` agit via le mécanisme osName (handlePlay) :
  `720p` → 1280×720 réel (**6,4 Mbps — fonctionne**), `1080p`/`1080p-hq` →
  **no-op sur PC** (toujours 1440p). D'où le preset Eco = cap 5 Mbps + 720p.
- Validé en réel sur le fork : groupe rendu, 3 presets cliquables, prefs
  posées et persistées, survie au reload, restauration illimité (20 checks).

### Fichiers

- `src/modules/ui/dialog/settings-dialog.ts` — section `data` (presets +
  statut) + type de groupe + filtre rendu déconnecté
- `src/utils/translation.ts` — 10 clés EN

Build amont : `bun build.ts --version 6.7.12 --variant full` → exit 0,
feature présente dans `dist/better-xcloud.user.js`.
