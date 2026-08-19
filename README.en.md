# EvenBetterXcloud — v1.13.1

[![Release](https://img.shields.io/github/v/release/Endymi0n74/EvenBetter-Xcloud?style=for-the-badge&color=green)](https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest)
[![Install](https://img.shields.io/badge/Install-userscript-blue?style=for-the-badge)](https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest/download/better-xcloud.user.js)
[![CI](https://img.shields.io/github/actions/workflow/status/Endymi0n74/EvenBetter-Xcloud/bench.yml?style=for-the-badge)](https://github.com/Endymi0n74/EvenBetter-Xcloud/actions/workflows/bench.yml) [![Release Guard](https://img.shields.io/github/actions/workflow/status/Endymi0n74/EvenBetter-Xcloud/release-guard.yml?style=for-the-badge&label=release%20guard)](https://github.com/Endymi0n74/EvenBetter-Xcloud/actions/workflows/release-guard.yml)

**🇬🇧 English** · [🇫🇷 Français](README.md)

Performance-oriented fork of the [Better xCloud](https://github.com/redphx/better-xcloud)
userscript (redphx), performance-oriented **+ user features**. Latest release:
[evenbetter-xcloud-v1.13.1](https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/tag/evenbetter-xcloud-v1.13.1).

**New in v1.13.1 — robustness (`BX_PURGE_DIAG` routine)**: diagnostic
listeners attached to `window` during test sessions (marked `win-capture`)
are tracked at startup and purged in a single call — a forgotten listener can
no longer pollute the console or interfere with the page. Maintenance:
validation probes updated (cleanup convention documented).

**New in v1.13.0 — 🔊 Sound (one-click volume presets)**: in Settings → *Sound*
group, four presets (🔇 Mute / 🔉 Low / 🔊 Normal / 📢 Boost) set
`audio.volume` (+ booster if needed) and apply it **live on the current
session** through the native slider channel — no need for the volume
dropdown.

**New in v1.12.0 — ⚡ Apply best region**: after the latency test, a button
sets `server.region` directly to the lowest-ping region measured (⭐
recommendation) — no more copy-pasting the best region into the dropdown.

**New in v1.11.0 — 📊 Data (one-click bitrate/resolution presets)**: in
Settings → *Data* group, three presets based on our **real measurements** (the
`maxBitrate` cap is the only setting that saves bandwidth WITHOUT losing
definition): 🚀 Max (unlimited, default), ⚖️ Balanced (10 Mbps cap · 1440p
kept, ~6.6 Mbps actual) and 🌱 Eco (5 Mbps cap + 720p, ~4.7 Mbps). The group
is visible even while logged out so you can pick a preset before starting a
session.

**New in v1.10.0 — 📡 Server latency test**: in Settings → *Server* group, a
"Test server latency" button measures the RTT to each of the 19 xCloud regions
(via the region's gssv host, `NATIVE_FETCH` for a clean measurement) and marks
the best one "⭐ recommended region" — pick the right `server.region` with
real numbers instead of guessing.

This repository contains the **built** script (`better-xcloud.user.js`) — this
is the file to install as-is in a userscript manager. The optimizations are
listed in the script header and detailed below.

## Installation

**Direct install** (recommended) — open this link in a browser with
Tampermonkey / Violentmonkey installed:

```
https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest/download/better-xcloud.user.js
```

Or manually:

1. **Copy** the content of `better-xcloud.user.js` (or install the file
   directly) into Tampermonkey / Violentmonkey / Greasemonkey.
2. The script triggers automatically on `https://www.xbox.com/*/play*`
   (`@match` already configured, `@run-at document-start`).
3. Reload `xbox.com/play`.

> Do not install it alongside the official Better xCloud — both would write
> the same `localStorage` preferences and conflict.

> **⚠️ Upgrade from v1.8.0 (or earlier)**: the **v1.9.0 rebrand** changed the
> script's identity (`@name` `Better xCloud` → `EvenBetterXcloud`, `@namespace`
> redphx → `Endymi0n74/EvenBetter-Xcloud`, `@updateURL` → this repo). Userscript
> managers (Greasemonkey, Tampermonkey…) treat this as a **different script**:
> auto-update cannot migrate between identities. **Uninstall the old "Better
> xCloud" manually** (manager dashboard) then install v1.9.0 via the link above
> — once; later versions will auto-update via `@updateURL`. ⚠ Do not keep both
> installed (double injection: the old "Better xCloud" badge may cover the new
> one).
>
> Same for very old installs (before v1.1.0): their `@updateURL` still points
> to the redphx upstream and they might offer to "update" to the official
> Better xCloud (version `6.7.12` numerically higher than `1.1.0`) — uninstall
> and reinstall once from this repo.

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
| **Android** | **Native app `evenbetter-xcloud.apk`** (WebView wrapper, ~140 KB — stable link, always the latest build) | [Direct download](https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest/download/evenbetter-xcloud.apk) → sideload (see `mobile/README.md`) — embedded script, keep-screen-on, fullscreen handled |
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
| Version | `1.13.1` | `1.13.1-preview1` (prerelease) |
| `@name` | `EvenBetterXcloud` | `EvenBetterXcloud (Preview)` |
| `@match` | `www.xbox.com/*/play*` | `play.xbox.com/*` only |
| Auto-update | `releases/latest` (stable channel) | dedicated tag `evenbetter-xcloud-v1.13.1-preview1` (never the `latest`) |

Both builds **coexist without mixing**: distinct identity
(name/version/updateURL) and disjoint matches (the preview never runs on
`www.xbox.com`). The separation is verified on every PR/push by the CI
("Build preview — two-version contract" step) — any stable change that would
break the preview or the separation fails the job.

### Installation

**Stable** (`latest` channel):

```
https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest/download/better-xcloud.user.js
```

**Preview** (prerelease — to test on play.xbox.com, Insider account with
Preview Features enabled):

```
https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/download/evenbetter-xcloud-v1.13.1-preview1/better-xcloud-preview.user.js
```

The preview is **playable and validated live**: settings button in the top
bar + openable dialog (T4/T7 — resilience to the shell replacing the
document), P2 session rewriting proven (`enableVibration`/mkb/mic in the
live session configuration). P1 (anti-kick idle) is in place via
`wrapSession` — observed server idle threshold > 1 h. Since **preview3**, the
build no longer overrides `osName=tizen` (measured A/B: no-op on PC —
resolution AND bitrate identical to native) — the play goes out without
rewriting. Since **preview4**, the settings button is also in the **game bar**
during a session (the immersive stream page of play.xbox.com has neither
header nor nav — T9). Since **1.11.0-preview1**, the preview also ships the
stable's "📊 Data" group, and **1.11.0-preview2** fixes the mobile overlay in a
phone WebView (FAB < 768 px + re-arm after document replacement — the button
no longer "vanishes" during a session). Since **1.12.0-preview1**, the
*Server* group (📡 latency test + ⚡ best region) works on play.xbox.com
(`window.STATES` fix, patch 23) and the APK embeds the document-start
injection. The stable is never affected.

### Why the preview is not part of the upstream PRs

The fork submits its **stable** optimizations to the original project
(redphx/better-xcloud — 15 open PRs). The **preview stays in the fork**, for a
structural reason: play.xbox.com is **Microsoft's new client** — a minified
bundle with **no public source repo**, while the redphx repo only contains
the stable client (www.xbox.com/play). The preview patches (T1-T10, P2/P3, P1)
target that bundle: there is nowhere in the upstream repo to port them.

And the two mechanisms that could have been "transferable" **already exist
upstream on the stable side**: the `/configuration` rewriting
(`enableVibration` / mkb / mic, in `xcloud-interceptor.ts`) and the idle
keep-alive (`WarningForBeingIdle` → `sendKeepAlive`,
`remote-play-keep-alive.ts`). The preview work is a **re-derivation for the
new client**, not an evolution of the stable script — nothing new to propose.
What the fork adds on the preview instead:

- **Settings entry**: desktop top-bar button + **floating button on mobile**
  (the new shell has no header below 768 px) + Settings action in the
  **game bar** during a session (immersive stream page);
- **Document-replacement resilience**: the shell replaces the document when a
  stream starts — the port re-arms observers and re-injects on the current
  document (otherwise the button dies mid-session);
- **Idle keep-alive** (AFK anti-kick) via `wrapSession`;
- **`/configuration` overrides** (vibration / mkb / mic / touch) on the new
  client;
- **UA auto-spoof** to pass the Chromium-only gate of play.xbox.com (Firefox
  and other engines are blocked even though the WebRTC H.264 stream works).

The technical details live in `bench/preview/port/` (anchors, E2E protocol,
journal). An informational comment was drafted for the maintainer
(`upstream-prs/comment-preview-port.md`): the full port is available on
request if he ever plans to support the new client.

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

## Optimization queue done — recommended settings

The stable optimization queue is **closed**: the JS main thread was profiled
on a live session (`live-profile`) at **99.98 % idle** — hot loops
(updateCanvas ×19.4, controller IDLE ×9.5, cold startup −95 %) are at the
floor, and the remaining load (video decode, WebGL2 rendering, server
encoding) lives in native/GPU processes, out of a userscript's reach. Any
remaining measurable gain comes from **user preferences**:

| Setting (EvenBetterXcloud settings) | Measured effect | Recommendation |
|---|---|---|
| `stream.video.maxBitrate` = **10-15 Mbps** | 24.2 → 6.6 Mbps (10 cap), **1440p kept**, 0 drop | ✅ Save bandwidth without losing definition |
| `stream.video.resolution` = **720p** | 1280×720 @ 6.4 Mbps (vs 1440p @ 24.2) | ✅ Very low bandwidth / mobile data |
| `stream.video.resolution` = 1080p / 1080p-hq | **No effect on PC** (always native 1440p — documented no-op) | ⚠️ Leave untouched |
| `server.region` + "📡 Test latency" (v1.10.0) | Lowest-ping region (e.g. CSE 30 ms ⭐ vs UKS 43 ms from France) | ✅ Always useful |
| "📊 Data" group (v1.11.0) — one-click presets | 🚀 Max / ⚖️ Balanced (10 Mbps) / 🌱 Eco (5 Mbps + 720p), applied at next session start | ✅ The maxBitrate cap is the only setting that saves bandwidth without losing definition |
| "⚡ Apply best region" (v1.12.0) | Sets `server.region` to the lowest-ping region (⭐ recommendation of the test) | ✅ The companion of the latency test — one click after the test |
| "🔊 Sound" group (v1.13.0) — volume presets | 🔇 Mute / 🔉 Low / 🔊 Normal / 📢 Boost set `audio.volume`, applied **live** on the current session | ✅ One-click volume, no dropdown |

**Codec (final verdict, stable + preview)**: both clients negotiate
**H.264 Constrained High** (`4d001f`) — the only codec the server keeps.
AV1/VP9 are offered but ignored by the backend, and **H.265 (HEVC) does not
even exist in the browser's WebRTC stack**: no codec choice is possible
client-side (real measurements documented in `bench/README.md`).

Full perf10 → build numbers (parse, hot loops, updateCanvas, cold startup,
GPU), tables and measurement protocols: [`bench/README.md`](bench/README.md).

## Credits & vibe-coding

This project is **vibe-coded**: fork and improvements co-created with
**generative AI assistance (Codebuff — the "Buffy" agent)**, which writes
and validates most of the code under the human direction of **Endymi0n74**.
Concretely: the perf measurements, the patches, the preview port, the user
features (📊 Data, 📡 Latency, ⚡ Region, 🔊 Sound), the Android APK and the
CI pipeline were produced, tested and validated live by the Codebuff agent.

- **Original credit**: [redphx](https://github.com/redphx) for Better xCloud
  (MIT) — this fork starts from his `v6.7.12-perf10` baseline and
  optimizations.
- **AI assistant**: Codebuff — the "Generated with Codebuff" signature also
  appears in every commit and in the script header.

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
