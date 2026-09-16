# EvenBetterXcloud — v1.13.4

[![Release](https://img.shields.io/github/v/release/Endymi0n74/EvenBetter-Xcloud?style=for-the-badge&color=green)](https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest)
[![Install](https://img.shields.io/badge/Install-userscript-blue?style=for-the-badge)](https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest/download/better-xcloud.user.js)
[![CI](https://img.shields.io/github/actions/workflow/status/Endymi0n74/EvenBetter-Xcloud/bench.yml?style=for-the-badge)](https://github.com/Endymi0n74/EvenBetter-Xcloud/actions/workflows/bench.yml) [![Release Guard](https://img.shields.io/github/actions/workflow/status/Endymi0n74/EvenBetter-Xcloud/release-guard.yml?style=for-the-badge&label=release%20guard)](https://github.com/Endymi0n74/EvenBetter-Xcloud/actions/workflows/release-guard.yml)

**🇫🇷 Français** · [🇬🇧 English](README.en.md)

Fork performance du userscript [Better xCloud](https://github.com/redphx/better-xcloud)
(redphx), orienté **performance** + **fonctionnalités utilisateur**. Dernière
release : [evenbetter-xcloud-v1.13.4](https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/tag/evenbetter-xcloud-v1.13.4).

de diagnostic attachés à `window` pendant les sessions de test (marqueur
`win-capture`) sont tracés au démarrage et purgés en un appel — un listener
oublié ne peut plus polluer la console ni gêner la page. Maintien : probes de
validation mises à jour (convention de nettoyage documentée).

settings → groupe *Son*, quatre presets (🔇 Muet / 🔉 Doux / 🔊 Normal /
📢 Boost) posent `audio.volume` (+ le booster si besoin) et l'appliquent
**en direct sur la session en cours** via le canal du slider natif — sans
passer par le menu déroulant du volume.

latence, un bouton pose directement `server.region` sur la région au ping le
plus bas mesuré (recommandation ⭐) — fini le copier-coller de la meilleure
région dans le menu déroulant.

dans les settings → groupe *Données*, trois presets basés sur nos **mesures
réelles** (le cap `maxBitrate` est le seul réglage qui économise SANS perdre la
définition) : 🚀 Max (illimité, défaut), ⚖️ Équilibré (cap 10 Mbps · 1440p
conservé, ~6,6 Mbps réels) et 🌱 Économe (cap 5 Mbps · 720p, ~4,7 Mbps). Le
groupe est visible même déconnecté pour poser le preset avant de lancer une
session.

groupe *Server*, un bouton « Tester la latence des serveurs » mesure le RTT
vers chacune des 19 régions xCloud (via l'hôte gssv de la région, `NATIVE_FETCH`
pour une mesure pure) et marque la meilleure « ⭐ région recommandée » — pour
choisir le bon `server.region` avec des chiffres réels au lieu de deviner.

Ce dépôt contient le script **buildé** (`better-xcloud.user.js`) — c'est le
fichier à installer tel quel dans un gestionnaire d'userscripts. Les
optimisations sont listées dans l'en-tête du script et détaillées ci-dessous.

## Installation

**Installation directe** (recommandé) — ouvrir ce lien dans un navigateur avec
Tampermonkey / Violentmonkey installé :

```
https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest/download/better-xcloud.user.js
```

Ou manuellement :

1. **Copie** le contenu de `better-xcloud.user.js` (ou installe le fichier
   directement) dans Tampermonkey / Violentmonkey / Greasemonkey.
2. Le script se déclenche automatiquement sur `https://www.xbox.com/*/play*`
   (`@match` déjà configuré, `@run-at document-start`).
3. Recharge `xbox.com/play`.

> Ne pas installer en même temps que le Better xCloud officiel — les deux
> écriraient les mêmes préférences `localStorage` et entreraient en conflit.

> **⚠️ Upgrade depuis la v1.8.0 (ou antérieure)** : le **rebrand v1.9.0** a
> changé l'identité du script (`@name` `Better xCloud` → `EvenBetterXcloud`,
> `@namespace` redphx → `Endymi0n74/EvenBetter-Xcloud`, `@updateURL` → ce
> repo). Les gestionnaires d'userscripts (Greasemonkey, Tampermonkey…) traitent
> ce changement comme un **script différent** : l'auto-update ne migre pas
> entre deux identités. **Désinstallez l'ancien « Better xCloud » à la main**
> (dashboard du gestionnaire) puis installez la v1.9.0 via le lien ci-dessus —
> une seule fois ; les versions suivantes se mettront à jour toutes seules via
> `@updateURL`. ⚠ Ne gardez pas les deux installés (double injection :
> l'ancien badge « Better xCloud » peut recouvrir le nouveau).
>
> Même principe pour les très vieilles installations (avant la v1.1.0) : leur
> `@updateURL` pointe encore vers l'upstream redphx et elles pourraient
> proposer de « mettre à jour » vers le Better xCloud officiel (version
> `6.7.12` numériquement supérieure à `1.1.0`) — désinstallez et réinstallez
> une fois via ce repo.

## Mise à jour & auto-update

Chaque release contient **deux fichiers** :

| Fichier | Rôle |
|---|---|
| `better-xcloud.meta.js` | En-tête du script seul (~0,7 Ko) — l'URL pointée par `@updateURL` |
| `better-xcloud.user.js` | Script complet (470 Ko) — l'URL de `@downloadURL` |

Au moment du check d'update, Tampermonkey télécharge **`better-xcloud.meta.js`**
(léger), compare le `@version` servi avec celui installé, et ne télécharge le
script complet que si une nouvelle version existe. Évite de télécharger 470 Ko
à chaque vérification.

```
@updateURL    → …/releases/latest/download/better-xcloud.meta.js
@downloadURL  → …/releases/latest/download/better-xcloud.user.js
```

> L'`@updateURL` pointe vers le fork depuis la v1.1.0 — les installations
> antérieures gardent l'URL upstream (voir la note « Upgrade » ci-dessus).

## Installation mobile (Android & iOS)

Le même userscript fonctionne sur mobile — xCloud web est responsive et les
`@match` couvrent `xbox.com/play` sur tous les appareils.

| Plateforme | Navigateur | Installation |
|---|---|---|
| **Android** | **App native `evenbetter-xcloud.apk`** (wrapper WebView, ~140 Ko — lien stable, toujours le dernier build) | [Téléchargement direct](https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest/download/evenbetter-xcloud.apk) → sideload (voir `mobile/README.md`) — script embarqué, écran maintenu, fullscreen géré |
| **Android** | Kiwi Browser (ou Edge Android) + Tampermonkey | Ouvrir le lien d'installation directe ci-dessus (section Installation) → Tampermonkey propose l'installation |
| **iOS** | Safari + l'app **« Userscripts »** (gratuite, open source) | Dans Userscripts, « + » → coller l'URL `…/releases/latest/download/better-xcloud.user.js`, puis activer l'extension dans Safari |

**Attention** :

- Les gains de perf mesurés (GPU WebGL2, startup, hot loops) le sont sur le
  **client desktop** (Chrome/Edge). Sur mobile, l'overlay, les settings et
  l'auto-update fonctionnent, mais le rendu xCloud mobile diffère et les
  chiffres ne sont pas transposables — surtout sur Safari/WebKit.
- L'auto-update (`@updateURL`) fonctionne de la même façon sur mobile :
  Tampermonkey/userscripts vérifient `better-xcloud.meta.js` à chaque lancement.
- Le **preview** (play.xbox.com) n'a pas d'intérêt sur mobile — c'est un
  client desktop uniquement.

## Deux versions — stable et preview (play.xbox.com)

Le repo maintient **deux builds indépendants, jamais fusionnés** (contrat
détaillé dans `bench/preview/port/README.md`) :

| | **Stable** (production) | **Preview** (play.xbox.com) |
|---|---|---|
| Rôle | Le fork optimisé classique — xbox.com/play (SPA Webpack, renderer WebGL2) | La variante du nouveau client web (React Router 7 + rolldown, renderer Babylon.js) |
| Fichier | `better-xcloud.user.js` | `better-xcloud-preview.user.js` (+ `.meta.js`) |
| Version | `1.13.4` | `1.13.4-preview1` (prerelease) |
| `@name` | `EvenBetterXcloud` | `EvenBetterXcloud (Preview)` |
| `@match` | `www.xbox.com/*/play*` | `play.xbox.com/*` uniquement |
| Auto-update | `releases/latest` (canal stable) | canal flottant `evenbetter-xcloud-preview-channel` (ré-uploadé à chaque publication — jamais purgé, contrairement aux tags versionnés) |

Les deux builds **cohabitent sans se confondre** : identité distincte
(name/version/updateURL) et matches disjoints (le preview ne s'exécute jamais
sur `www.xbox.com`). La séparation est vérifiée à chaque PR/push par le CI
(step « Build preview — contrat deux versions ») — toute évolution du stable
qui casserait le preview ou la séparation fait échouer le job.

### Installation

**Stable** (canal `latest`) :

```
https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest/download/better-xcloud.user.js
```

**Preview** (prerelease — à tester sur play.xbox.com, compte Insider avec
Preview Features activé) :

```
https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/download/evenbetter-xcloud-v1.13.4-preview1/better-xcloud-preview.user.js
```

Le preview est **jouable et validé en réel** : bouton settings dans le top bar
+ dialog ouvert (T4/T7 — résilience au remplacement du document par le shell),
réécriture P2 de la session prouvée (`enableVibration`/mkb/mic dans la
configuration de la session live). P1 (anti-kick idle) est en place via
`wrapSession` — seuil d'idle serveur observé > 1 h. Depuis **preview3**, le
build n'override plus `osName=tizen` (A/B mesuré : no-op en PC — résolution ET
bitrate identiques au natif) — le play part sans réécriture. Depuis
**preview4**, le bouton settings est aussi dans la **game bar** en session (la
page stream immersive de play.xbox.com n'a ni header ni nav — T9). Depuis
**1.11.0-preview1**, le preview embarque aussi le groupe « 📊 Données » du
stable, et **1.11.0-preview2** corrige l'overlay mobile en WebView téléphone
(FAB < 768 px + re-arm après remplacement du document — le bouton ne
« disparaissait » plus en session). Depuis **1.12.0-preview1**, le groupe
*Server* (📡 test latence + ⚡ meilleure région) est utilisable sur
play.xbox.com (fix `window.STATES`, patch 23) et l'APK embarque l'injection
document-start. Le stable n'est jamais affecté.

### Pourquoi le preview ne fait pas partie des PR upstream

Le fork propose ses optimisations du **stable** au projet original
(redphx/better-xcloud — 15 PR ouvertes). Le **preview, lui, reste dans le
fork**, pour une raison structurelle : play.xbox.com est le **nouveau client
Microsoft** — un bundle minifié **sans repo source public**, alors que le repo
redphx ne contient que le client stable (www.xbox.com/play). Les patches du
preview (T1-T10, P2/P3, P1) ciblent ce bundle : il n'y a aucun endroit dans le
repo upstream où les porter.

## Crédits & vibe-coding

Ce projet est un **vibe-coding** : fork et améliorations co-créés avec une
assistance IA générative (**Codebuff** — agent « Buffy »), qui écrit et
valide la majeure partie du code sous la direction humaine de
**Endymi0n74**. Concrètement : les mesures de perf, les patches, le portage
preview, les features utilisateur (📊 Données, 📡 Latence, ⚡ Région, 🔊 Son),
l'APK Android et le pipeline CI ont été produits, testés et validés en
réel par l'agent Codebuff.

- **Crédit original** : [redphx](https://github.com/redphx) pour Better
  xCloud (MIT) — ce fork repart de sa baseline `v6.7.12-perf10` et de ses
  optimisations.
- **Assistant IA** : Codebuff — la signature « Generated with Codebuff »
  apparaît aussi dans chaque commit et dans l'en-tête du script.

## Licence

MIT (comme l'original). Crédit à [redphx](https://github.com/redphx) pour
Better xCloud.
