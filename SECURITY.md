# Politique de sécurité

## Versions supportées

| Version | Support |
|---|---|
| 1.13.x (stable + preview) | ✅ |
| < 1.13 | ❌ (mettre à jour via `@updateURL`) |

## Signaler une vulnérabilité

Ouvre une issue privée ou contacte `stephane.rivoire74@gmail.com`.
Ne publie pas d'exploit en clair avant correctif.

## Périmètre

- Userscript (`better-xcloud.*.js`) : injection `document-start`, hook `fetch`, `localStorage`
- APK Android (`mobile/`) : WebView + serveur LAN `📥 Session` (port 8765, code 6 chiffres, HTTP clair LAN uniquement)

Le serveur LAN `📥 Session` n'est actif que quand l'utilisateur clique « Importer », écoute uniquement sur le réseau local et n'expose que `POST /import/<code>` (écriture `localStorage` MSAL). Ne pas exposer le port sur Internet.
