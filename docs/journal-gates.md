# Journal — gates CI

> **Archive — extrait de `bench/README.md` le 2026-09-23.** Journal daté,
> conservé pour l'historique : ne pas mettre à jour (les versions et liens
> cités sont ceux de l'époque). Naissance des gates CI, dans l'ordre d'origine.

## Gate « README toujours à jour » — readme-version.test.js (20 août)

Règle utilisateur : « le README doit toujours être à jour » — le gate CI
`bench/readme-version.test.js` (step hotloops-ratios de bench.yml) lit
`VERSION` + `PREVIEW_VERSION` (source de vérité du bump) et vérifie :

1. **Ancres courantes** (READMEs front : README.md, README.en.md,
   mobile/README.md) — titre `# EvenBetterXcloud — v<VERSION>`, ligne
   `Version` de la table « Deux versions », tag d'auto-update du preview,
   lien release courante, APK `evenbetter-xcloud-<VERSION>.apk` /
   `-<PREVIEW>.apk`.
2. **Aucune référence périmée** (TOUS les READMEs, journaux compris) — un
   lien `releases/download/evenbetter-xcloud-v<tag>` ou un APK versionné
   dont le tag/version n'est ni VERSION ni PREVIEW_VERSION → GATE ROUGE
   (la rétention purge les anciennes releases → 404 auto-update). Les
   mentions historiques en prose (ex. « Nouveauté v1.13.0 ») sont tolérées.
3. **Bundles** — `@version` de better-xcloud.user.js/.meta.js (stable) et
   better-xcloud-preview.user.js/.meta.js (preview) doivent égaler
   VERSION/PREVIEW_VERSION, et le pin `@updateURL` du preview doit pointer
   le tag courant → piège **« bump sans rebuild »** couvert (un bump de
   fichier sans rebuild laisse l'ancienne version ET l'ancien pin → 404
   auto-update).
4. **APK** — `mobile/build.sh` doit dériver les noms d'APK de `${VERSION}`
   (stable) et `${PREVIEW_VERSION}` (preview) ; si des APK de release sont
   présents dans `mobile/out/`, leurs noms doivent être courants (les
   artefacts intermédiaires base.apk/app-unsigned.apk/app-aligned.apk sont
   ignorés). Noms d'APK périmés vérifiés dans les docs FRONT uniquement :
   un nom historique cité dans un journal bench/ est légitime (ce n'est pas
   un lien vers une release purgée — contrairement aux URLs, vérifiées
   partout).

`--self-test` : copies corrompues (titre + tag + APK + `@version` + pin +
build.sh) → le gate doit sortir ROUGE. Le CI lance le gate + son self-test
à chaque push/PR — un bump qui oublie la passe README OU le rebuild casse
le job immédiatement.

**Simulation bump 1.13.2 (20 août, clone local, rien publié)** : cycle
complet rejoué — `bump-version.sh 1.13.2` (VERSION/PREVIEW_VERSION, 5
@version, BX_VERSION, manifest vc 11) → `build-preview.js` (re-pin preview
sur `evenbetter-xcloud-v1.13.2-preview1`) → passe README structurelle →
**gate VERT de bout en bout** (self-test : 37 défaillances détectées sur les
copies corrompues). Contre-preuve : sans la passe README, le gate sort ROUGE
(27 défaillances, exit 1) — le bump seul ne suffit pas, la passe README est
bien exigée par le CI. Au passage : le gate flaggait les noms d'APK
historiques des journaux bench/ après bump → check restreint aux docs FRONT.

**Fixes collatéraux (20 août)** : `mobile/build.sh` hardcodait
`evenbetter-xcloud-${VERSION}-preview1.apk` — le suffixe `-previewN` vient
maintenant de `PREVIEW_VERSION` (GATE ROUGE si le fichier est absent, message
clair grâce à `|| true` sous `set -euo pipefail`). Idem `versionName` du
manifest : le template est bumpé avec la version stable (bump-version.sh),
le build force la version du variant (`VERSION_NAME`) pour que l'APK preview
annonce `1.13.1-preview1` et non `1.13.1`. Validé en réel le 20 août :
`evenbetter-xcloud-1.13.1.apk` (versionName 1.13.1, com.bxperf.app) et
`evenbetter-xcloud-1.13.1-preview1.apk` (versionName 1.13.1-preview1,
com.bxperf.preview) — piège `out/` qui se purge entre deux builds : sécuriser
le 1er APK hors de `out/` avant le 2e build.

## Gate « Défauts TV de l'APK » — tv-defaults.test.js (20 août)

La navigation télécommande de l'overlay sur les box (Freebox Pop, TV) repose
sur les défauts TV posés par l'APK via `JS_TV_DEFAULTS` de
`mobile/src/com/bxperf/app/MainActivity.java` (`ui.controllerFriendly=true`
+ `ui.layout="tv"` — la WebView de la box est « unknown », donc sans ce
réglage la navigation D-pad est coupée, piège du 20 août). Le gate vérifie
statiquement, sans build APK :
- **Tous les réglages** de la constante : marqueur d'idempotence lu/écrit à
  2, maxBitrate 5 Mbps, 720p, reduceAnimations, controllerFriendly, layout
  tv, rocket hide — formes Java échappées comparées via un helper `JQ`
  (l'échappement `\"` d'un littéral JS consommerait le backslash).
- **Les deux points d'injection** : évaluation au chargement
  (`JS_TV_DEFAULTS + "}}catch..."`) et application TV uniquement
  (`isTv ? JS_TV_DEFAULTS : ""`).
- **Les APK embarqués** (si présents dans `mobile/out-stable` /
  `mobile/out-preview`, `evenbetter-xcloud-*.apk`) : les assets
  `assets/better-xcloud.user.js` (+ es2017) extraits via `unzip -p` doivent
  être **byte-identiques aux bundles courants du repo** (sha256, CRLF
  normalisé) et contenir `controllerFriendly`. Un rebuild oublié (APK périmé
  dans out/) → GATE ROUGE ; en CI sans build mobile → warning + skip (comme
  readme-version). Piège : build.sh copie l'asset sous le MÊME nom pour les
  deux variants → le contenu attendu diffère (preview vs stable).
- **--self-test** : copie sans controllerFriendly → GATE ROUGE attendu
  (MainActivity ET APK — pour l'APK, les bundles attendus sont corrompus
  sur copie, le zip réel est extrait).

Gate CI : `node bench/tv-defaults.test.js [--self-test]` (step preview de
bench.yml).

