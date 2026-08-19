# Server latency test (gssv ping)

## What

Adds a **"📡 Test server latency"** button at the bottom of the **Server**
settings group. On click it pings every region's gssv provisioning endpoint
(`STATES.serverRegions`), measures the RTT, lists all regions sorted
best → worst, and highlights the fastest one as **⭐ recommended region** —
a simple, data-driven way to pick `server.region` instead of guessing.

## Why

`server.region` defaults to UKS for many users, which can be far from their
network path (e.g. 43 ms to UKS vs 30 ms to CSE in our tests). Picking the
closest region lowers latency, jitter and packet loss on every stream. The
only way to know the best region today is trial and error: you set a region,
start a stream, and check the stats overlay.

## How

- Ping URL: `baseUri + /v5/sessions/cloud/play?probe=1` (`baseUri` is the
  real host, e.g. `https://eus.core.gssv-play-prod.xboxlive.com` — `shortName`
  contains a flag emoji and is not a valid host).
- **`NATIVE_FETCH`** (the original `window.fetch` captured in `bx-flags.ts`)
  + **`?probe=1`** : the script's own fetch interception rewrites
  `/sessions/cloud/play` requests (region selection) — this test must measure
  the real network path to the target region, untouched.
- `mode: 'no-cors', cache: 'no-store'` + 3 s timeout per region.
- All 19 regions are pinged sequentially (~1-2 s total); the best result is
  marked with a ⭐ line at the top of the list.

## Validation

Measured on a real session (better-xcloud fork, v1.10.0, feature ported
1:1 — see `bench/feature-latency.js`):

| Region | RTT |
|---|---|
| ⭐ CSE | 30 ms |
| WEU | 41 ms |
| UKS (default) | 43 ms |
| Japan | 804 ms |

RTTs are geographically coherent and stable across re-runs (same region
selected as best). The button lives in the Server group, works while signed
out (region list is loaded by the client regardless), and re-runs are one
click ("Re-run test").

No perf impact: the test only runs when the user clicks the button.
