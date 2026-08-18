# better-xcloud-perf — v1.8.0

[![Release](https://img.shields.io/github/v/release/Endymi0n74/better-xcloud-perf?style=for-the-badge&color=green)](https://github.com/Endymi0n74/better-xcloud-perf/releases/latest)
[![Install](https://img.shields.io/badge/Install-userscript-blue?style=for-the-badge)](https://github.com/Endymi0n74/better-xcloud-perf/releases/latest/download/better-xcloud.user.js)
[![CI](https://img.shields.io/github/actions/workflow/status/Endymi0n74/better-xcloud-perf/bench.yml?style=for-the-badge)](https://github.com/Endymi0n74/better-xcloud-perf/actions/workflows/bench.yml)

**🇬🇧 English** · [🇫🇷 Français](README.md)

Performance-oriented fork of the [Better xCloud](https://github.com/redphx/better-xcloud)
userscript (redphx). Latest release:
[better-xcloud-perf-v1.8.0](https://github.com/Endymi0n74/better-xcloud-perf/releases/tag/better-xcloud-perf-v1.8.0).

This repository contains the **built** script (`better-xcloud.user.js`) — this
is the file to install as-is in a userscript manager. The optimizations are
listed in the script header and detailed below.

## Installation

**Direct install** (recommended) — open this link in a browser with
Tampermonkey / Violentmonkey installed:

```
https://github.com/Endymi0n74/better-xcloud-perf/releases/latest/download/better-xcloud.user.js
```

Or manually:

1. **Copy** the content of `better-xcloud.user.js` (or install the file
   directly) into Tampermonkey / Violentmonkey / Greasemonkey.
2. The script triggers automatically on `https://www.xbox.com/*/play*`
   (`@match` already configured, `@run-at document-start`).
3. Reload `xbox.com/play`.

> Do not install it alongside the official Better xCloud — both would write
> the same `localStorage` preferences and conflict.

> **⚠️ Upgrade from v1.0.0 (or earlier)**: if the script was installed before
> v1.1.0, its `@updateURL` still points to the redphx upstream — Tampermonkey
> will not see the fork's updates (and might even offer to "update" to the
> official Better xCloud, whose `6.7.12` version is numerically higher than
> `1.1.0`). **Reinstall manually once** via the link above to switch
> auto-update to this fork; later versions will update themselves.

## Update & auto-update

Each release contains **two files**:

| File | Role |
|---|---|
| `better-xcloud.meta.js` | Script header only (~0.7 KB) — the URL pointed to by `@updateURL` |
| `better-xcloud.user.js` | Full script (470 KB) — the URL of `@downloadURL` |

At update check time, Tampermonkey downloads **`better-xcloud.meta.js`**
(light), compares the served `@version` with the installed one, and only
downloads the full script when a new version exists. Avoids downloading
470 KB on every check.

```
@updateURL    → …/releases/latest/download/better-xcloud.meta.js
@downloadURL  → …/releases/latest/download/better-xcloud.user.js
```

> `@updateURL` points to this fork since v1.1.0 — earlier installs keep the
> upstream URL (see the "Upgrade" note above).

## Mobile install (Android & iOS)

The same userscript works on mobile — the xCloud web client is responsive
and the `@match` rules cover `xbox.com/play` on any device.

| Platform | Browser | Install |
|---|---|---|
| **Android** | **Native app `better-xcloud-perf-1.8.0.apk`** (WebView wrapper, ~140 KB) | [Direct download](https://github.com/Endymi0n74/better-xcloud-perf/releases/download/better-xcloud-perf-v1.8.0/better-xcloud-perf-1.8.0.apk) → sideload (see `mobile/README.md`) — embedded script, keep-screen-on, fullscreen handled |
| **Android** | Kiwi Browser (or Edge Android) + Tampermonkey | Open the direct install link above (Installation section) → Tampermonkey offers to install |
| **iOS** | Safari + the **"Userscripts"** app (free, open source) | In Userscripts, tap "+" → paste the `…/releases/latest/download/better-xcloud.user.js` URL, then enable the extension in Safari |

**Keep in mind:**

- The measured perf wins (WebGL2 GPU, startup, hot loops) are from the
  **desktop client** (Chrome/Edge). On mobile the overlay, settings and
  auto-update work, but the mobile xCloud renderer differs and the numbers
  don't transfer — especially on Safari/WebKit.
- Auto-update (`@updateURL`) works the same on mobile: Tampermonkey/Userscripts
  check `better-xcloud.meta.js` on every launch.
- The **preview** build (play.xbox.com) is desktop-only — no use on mobile.

## Two versions — stable and preview (play.xbox.com)

The repo maintains **two independent builds, never merged** (detailed
contract in `bench/preview/port/README.md`):

| | **Stable** (production) | **Preview** (play.xbox.com) |
|---|---|---|
| Role | The classic optimized fork — xbox.com/play (Webpack SPA, WebGL2 renderer) | The variant for the new web client (React Router 7 + rolldown, Babylon.js renderer) |
| File | `better-xcloud.user.js` | `better-xcloud-preview.user.js` (+ `.meta.js`) |
| Version | `1.8.0` | `1.8.0-preview4` (prerelease) |
| `@name` | `Better xCloud` | `Better xCloud (Preview)` |
| `@match` | `www.xbox.com/*/play*` | `play.xbox.com/*` only |
| Auto-update | `releases/latest` (stable channel) | dedicated tag `better-xcloud-perf-1.8.0-preview4` (never the `latest`) |

Both builds **coexist without mixing**: distinct identity
(name/version/updateURL) and disjoint matches (the preview never runs on
`www.xbox.com`). The separation is verified on every PR/push by the CI
("Build preview — two-version contract" step) — any stable change that would
break the preview or the separation fails the job.

### Installation

**Stable** (`latest` channel):

```
https://github.com/Endymi0n74/better-xcloud-perf/releases/latest/download/better-xcloud.user.js
```

**Preview** (prerelease — to test on play.xbox.com, Insider account with
Preview Features enabled):

```
https://github.com/Endymi0n74/better-xcloud-perf/releases/download/better-xcloud-perf-1.8.0-preview4/better-xcloud-preview.user.js
```

The preview is **playable and validated live (Aug 17)**: settings button in
the top bar + openable dialog (T4/T7 — resilience to the shell replacing the
document), P2 session rewriting proven (`enableVibration`/mkb/mic in the
live session configuration). P1 (anti-kick idle) is in place via
`wrapSession` — observed server idle threshold > 1 h. Since **preview3**, the
build no longer overrides `osName=tizen` (measured A/B: no-op on PC —
resolution AND bitrate identical to native) — the play goes out without
rewriting. Since **preview4**, the settings button is also in the **game bar**
during a session (the immersive stream page of play.xbox.com has neither
header nor nav — T9). The stable is never affected.

## perf11 + perf13 optimizations

| # | Optimization | Effect |
|---|---|---|
| 1 | `StreamStats`: removed `_cachedOpacity`/`_cachedTextSize` cache | Fixes the regression where `stats.opacity.all` and `stats.textSize` stopped applying until reload |
| 2 | `StreamStats`: `document.hidden` throttle | 1 s cadence visible, 60 s in background (`INTERVAL_BACKGROUND`) |
| 3 | `StreamStats`: self-rearming `setTimeout` + `isUpdating` guard | No more overlapping `setInterval`s; the tick restarts only after the previous one finished |
| 4 | `StreamStatsCollector.collect()`: single pass over the `RTCStatsReport` | Halves the tick iteration cost (hundreds of entries per report) |
| 5 | `ALL_PREFS` → `Set` | `isGlobalPref`/`isStreamPref` in O(1) |
| 6 | `validateValue`: `filter` + `Set` | Fixes the index-skip bug of `splice` on consecutive invalid values; O(n) |
| 7 | `getGameSettings`: batched deletion | A single `saveSettings()` instead of one per purged key |
| 8 | `checkForUpdate`: 2 h guard before fetching | No more GitHub API request nor localStorage write on every page load |
| 9 | `BxSelectElement`: single delegated observer | One `MutationObserver` (documentElement) replaces one observer per `<select>` |
| 10 | `Translations`: removed `debugger` | No more execution pause in devtools if the translations fetch fails |
| 11 | Controller customization: fix `delete mapping.Share` | The Share binding is no longer mangled after the first press; no more screenshot event spam |
| 12 | Controller customization: skip idle | Zero allocation and zero mapping iteration when no button pressed and sticks centered |
| 13 | `WebGL2Player`: `texStorage2D` + `texSubImage2D` | Stable GPU allocation (the texture is no longer reallocated on every `texImage2D`); recreation on resolution change |
| 14 | `WebGL2Player`: viewport fix | `drawingBufferHeight` instead of `drawingBufferWidth` |
| 15 | `poll_gamepad_default`: `structuredClone` → direct reference | The `structuredClone` of the Home state at release was unnecessary (object never mutated between read and `=null`) — zero allocation, measured path 1236 ns → 280 ns (−77 %) |
| 16 | `WebGL2Player`: per-frame `bindTexture` removed | The texture stays bound between frames (single texture, dedicated context) — 60 fewer GL calls/s |
| 17 | `WebGL2Player`: experimental `WebGL2NoColorConversion` flag | `gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)` before video uploads — skips the browser's sRGB conversion (potential gain on the most expensive path); disabled by default, opt-in via `BX_FLAGS` with visual validation |
| 18 | `WebGL2Player`: `texStorage2D` fix | `gl.RGB` (non-sized format → `INVALID_ENUM`, **black screen** on the WebGL2 renderer) → `gl.RGB8` — fixes the bug introduced by opti 13 (also present in the upstream TS) |
| 19 | `WebGL2Player.updateCanvas`: uniform value cache | 7 `gl.uniform*` skipped per frame when nothing changes (invalidation by value comparison) — steady path ~296 → ~22 ns/frame (**×13.7**) |
| 20 | `WebGL2Player.updateCanvas`: dirty-flag skip | The uniform recomputation only reruns when `updateOptions`/`refreshPlayer` invalidated the flag (unchanged options/canvas = 1 read + branch) — steady path ~22 → ~12.7 ns/frame (**×19.4** vs perf10) |
| 21 | `stream.video.codecProfile`: **lazy + memoized** evaluation | `RTCRtpReceiver.getCapabilities("video")` (667 ms cold = 96 % of the startup eval in a fresh Edge) is no longer called at load — options/unsupported/suggest are computed on first real read (opening settings / validating a value) then cached (constant per browser). Cold page eval 656.8 → 32.9 ms (**−95 %**), warm 26.5 → 24.2 ms (**−8.7 %**) |

The perf1–perf10 history (patcher O(1) Set, localStorage debounce,
`getBattery()` cache, precomputed uniform locations, etc.) is kept in the
script header.

## Benchmarks — summary

Measurements **perf10 (baseline)** vs **current build**, same machine,
replayable harnesses (full protocols, detailed tables and session history in
[`bench/README.md`](bench/README.md)) :

| Metric | perf10 | build | Gain |
|---|---|---|---|
| Parse/compile (Node) | ~0.117 ms | ~0.112 ms | negligible |
| Hot loop controller IDLE | 327 ns | 34 ns | **×9.5** |
| updateCanvas (60 Hz path) | 243 ns | 16 ns | **×15.6** |
| Page eval — warm (Edge, 20 runs) | 26.5 ms | 24.2 ms | **−8.7 %** |
| Page eval — **cold** (fresh browser, cold RTC stack) | 657 ms | 33 ms | **−95 %** |
| GPU video upload (WebGL2, µs/upload) | ~42–78 µs | ~8–12 µs | **×5.5** |
| GPU draw (USM 4-tap shader, v1.8.0) | 10.2 µs | 7.2 µs | **−30 %** |

Full "Loading", "Hot loops" and "GPU" tables, sessions (startup / hot loops /
GPU, with high/low state), frozen protocol and repro:
[`bench/README.md`](bench/README.md).

## Repository history

```
a299c38 build: prepare v1.7.0 with lazy + memoized codecProfile (getCapabilities out of startup)
089375e bench: extend updateCanvas scenario to the dirty-flag steady state and add a GL-count check
b4821d8 build: prepare v1.6.0 with dirty-flag skip in WebGL2 updateCanvas
17dfaad bench: add --resume mode to run-gpu-ci.sh to skip completed seeds
e89cf2f bench: add one-command GPU protocol runner and confirm v1.5.0 GPU parity
dd2a604 docs: v1.5.0 benchmark tables, patch 19 matrix and GPU version note
24011f3 bench: add updateCanvas hot-loop scenario and CI threshold
20773ae build: prepare v1.5.0 with WebGL2 uniform value cache in updateCanvas
f43a372 ci: enrich the bench workflow with markdown summaries, artifacts and a GPU job
3963c44 docs: regenerate benchmark tables and document bench tooling and CI
90fb7ac bench: port GPU harness into bench/gpu so the Repro section is self-contained
e1d6dbc bench: add --update-readme mode and CI hot-loop ratio checks
579442f docs: freeze the GPU benchmark protocol and add one-shot freeze.sh re-measure
0db349e bench: stabilize parse harness and freeze the reproducible measurement protocol
178d886 bench: stabilize CPU hot-loop harness with warmup, seeded crossover and median
c413f17 docs: stabilize GPU benchmark harness and update measured figures
fc13e66 docs: re-measure GPU benchmarks on official v1.4.0 build
faafb72 docs: document v1.4.0 RGB8 fix, 18-patch matrix and benchmark harnesses
f6d0911 build: prepare v1.4.0 with texStorage2D RGB8 fix
82b35ec docs: add real-GPU benchmarks and reproduction section
82d0778 docs: add benchmarks chapter comparing perf10 vs v1.3.0
ca0f7dd docs: document WebGL2NoColorConversion flag and extend patch matrix to 17
561595d feat: add experimental WebGL2NoColorConversion flag (video upload)
62abcd9 build: prepare v1.3.0 with hot-loop optimizations
366fb41 docs: document meta.js auto-update flow and refresh history for v1.2.0
95e41a9 build: bump userscript to 1.2.0
912e3d4 docs: update patch 01 description to reflect meta.js updateURL header
a411727 build: point @updateURL to a lighter meta.js for update checks
c7ac6fd docs: add upgrade note for v1.0.0 installs and refresh version references
d34b4a5 build: prepare v1.1.0 with fork update/download URLs
c7c95a2 docs: add release and install badges to README header
7ac17bc docs: clarify patch location in patches/README
72e655c build: bump userscript version to 1.0.0
21d6652 docs: rename release references to better-xcloud-perf-v1.0.0
7fe1bce docs: add direct install link to release asset
560be6c chore: extend .gitignore with IDE and dependency exclusions
80e086d docs: expand Portage section to make repo self-contained
1525d4e chore: add .gitignore for temp files and test directories
338f509 chore: add global perf10→perf11 patch
3d8b78e docs: add per-optimization patches with compatibility matrix
c099b29 docs: add README with perf11 optimizations and install guide
289f38b perf: apply v6.7.12-perf11 optimizations
055d3a0 chore: import v6.7.12-perf10 userscript as baseline
```

## Porting

This repo is self-contained: it holds the baseline, the build and all the
patches needed to rebuild or port the optimizations.

### Rebuilding the build (byte-for-byte verified round-trip)

```bash
# Baseline perf10 (commit 055d3a0) + global patch → build v1.6.0 identical
# to the repo's better-xcloud.user.js.
git show 055d3a0:better-xcloud.user.js > better-xcloud.user.js
# Important on Windows: core.autocrlf=false, otherwise the patch context doesn't match
git -c core.autocrlf=false apply better-xcloud-perf11.patch
node --check better-xcloud.user.js
```

### Porting everything at once

- `better-xcloud-perf11.patch`: global perf10 → perf11 patch, verified in
  byte-for-byte round-trip on the baseline. Apply with
  `git -c core.autocrlf=false apply better-xcloud-perf11.patch`.

### Selective porting

- `patches/`: 22 individual patches (one per optimization), each applicable
  alone on the perf10 baseline. Read `patches/README.md` for the detailed
  list, the pairwise compatibility matrix and the non-stackable zones (the
  minified build has giant lines: several optimizations of the same zone
  modify the same physical line and their patches don't stack).

### Porting to the upstream source (typescript branch)

The built patches do **not** apply on the `typescript` branch (the TS
source differs from the build). Upstream porting is done file-by-file:
`src/modules/player/webgl2/webgl2-player.ts`,
`src/modules/patcher/patches/src/controller-customization.ts`,
`src/modules/touch-controller.ts`, etc.

## License

MIT (like the original). Credit to [redphx](https://github.com/redphx) for
Better xCloud.
