# Perf & Features — EvenBetterXcloud

Ce document était ench/README.md (101KB). Pour l'onboarding rapide, voir README.md + CONTRIBUTING.md.

Les harnais bench restent dans ench/ :
- \ench/run-all.sh\ — parse + hot loops + page-eval
- \ench/README.md\ — protocole complet (gardé pour référence, sera archivé en \docs/bench-archive.md\ si >150KB)

Recommandations réglages utilisateur (mesures 18-20 août) :
- \stream.video.maxBitrate\ 10 Mbps → 1440p conservé, ~6.6 Mbps réels (seul réglage qui économise sans perdre la définition)
- \stream.video.resolution\ 720p → 1280x720 @ ~6.4 Mbps (très faible débit)
- 1080p / 1080p-hq : no-op sur PC (toujours 1440p natif)
- \server.region\ + 📡 test latence → choisir CSE/WEU/UKS selon RTT
