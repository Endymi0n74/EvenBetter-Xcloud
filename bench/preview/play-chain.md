# Chaîne requestConnection → play (garde anti-dérive)

- Généré le : 2026-08-16T21:31:06.319Z
- Statut : **OK — ancres stables** ✅
- Ancre déclencheuse : mutation `requestConnection` (accs.system) → éligibilité → connect → `sendPlayCloud` → POST `/v5/sessions/cloud/play` (chronologie détaillée dans `port/session.md`)

| Bundle | Étape | Ancres | Offsets |
|---|---|---|---|
| entry.client | mutation requestConnection (accs.system) | ✅ `requestConnection:` (x1) | 51 |
| entry.client | fetch connectionEligibility (éligibilité avant connect) | ✅ `connectionEligibility` (x2) | 192 |
| entry.client | syncConnectionState → eligible | ✅ `async syncConnectionState` (x1) | 382 |
| entry.client | « Eligible, connecting to ACCS... » → connectionManager.connect | ✅ `Eligible, connecting to ACCS` (x1) | 605 |
| entry.client | performConnect : getToken() → createSession(token) | ✅ `let t=await e\.getToken\(\);if\(!t\)` (x1) | 741 |
| entry.client | Ude.createSession : getHttpConfiguration → t.createSession | ✅ `getHttpConfiguration\(\),r=\{getToken` (x1) | 989 |
| GameStreamBootstrapper | import STATIQUE de StreamSessionRequest | ✅ `import\{i as \w+,o as \w+\}from"\.\/StreamSessionRequest-` (x1) | 1 |
| StreamSessionRequest | createSession(e,t) → startProcessingRequest() | ✅ `async createSession\(e,t\)` (x1) | 26 |
| StreamSessionRequest | « Creating new cloud session. » (startProcessingRequest cloud) | ✅ `Creating new cloud session` (x1) | 159 |
| StreamSessionRequest | triggerPlayRequest → sendPlayCloud | ✅ `async sendPlayRequest\(e,t\)\{return this\.playService\.send` (x1) | 362 |
| StreamSessionRequest | sessionPath loggé après le play | ✅ `sessionPath: \$\{t\.sessionPath\}` (x1) | 327 |

Régénérer : `node bench/preview/play-chain.js --write`