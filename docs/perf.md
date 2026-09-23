# Perf & Features — EvenBetterXcloud

Pour l'onboarding rapide, voir `README.md` + `CONTRIBUTING.md`.

Les harnais bench restent dans `bench/` :
- `bench/run-all.sh` — parse + hot loops + page-eval
- `bench/README.md` — protocole, harnais et index (référence technique)

## Journaux archivés (extraits de bench/README.md, sept 2026)

- [journal-features.md](journal-features.md) — features, rebrand, routines
- [journal-perf.md](journal-perf.md) — mesures, verdicts codec/bitrate, baselines
- [journal-gates.md](journal-gates.md) — naissance des gates CI

## Recommandations réglages utilisateur (mesures 18-20 août)

- `stream.video.maxBitrate` 10 Mbps → 1440p conservé, ~6,6 Mbps réels (seul réglage qui économise sans perdre la définition)
- `stream.video.resolution` 720p → 1280x720 @ ~6,4 Mbps (très faible débit)
- 1080p / 1080p-hq : no-op sur PC (toujours 1440p natif)
- `server.region` + 📡 test latence → choisir CSE/WEU/UKS selon RTT
