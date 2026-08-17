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

## Benchmarks

Measurements **perf10 (baseline)** vs **v1.3.0** and later, same machine
(Windows, Edge headless, Node V8), dedicated throwaway harnesses. The goal
is not absolute precision but the relative comparison between two builds.

### Loading (parse + page eval)

| Measurement | perf10 | v1.6.0 | v1.8.0 | Δ v1.8.0 vs perf10 |
|---|---|---|---|---|
| Parse/compile (Node `new Function`, ×300/pass, median of 3 passes) | ~0.11–0.12 ms | ~0.10–0.11 ms | ~0.12 ms | not measurable: sub-ms noise ±10–20 % |
| Full page eval (Edge headless, `document-start`, 20 runs, median — warm RTC stack) | 26.5 ms (min 23.7) | ~25 ms (min 22) | **24.2 ms** (min 21.1) | **−8.7 %** |
| Full page eval **cold** (fresh browser per run, first load — cold RTC stack, median of 8 runs) | 656.8 ms (min 597.5) | ≈ perf10 (same eager call) | **32.9 ms** (min 27.9) | **−95 %** |

**Startup sessions — state** (cold page eval, fresh browser per run — the
RTC one-shot is per-process, the ~30 ms build is stable; **state derived
from perf10**: `low` = perf10 ≤ 620 ms — nominal RTC init; `high` = perf10
> 620 ms — loaded machine (it is perf10, not the build, that carries the
environment drift). CI bounds: build ≤ 50 ms (failure = the one-shot cost is
back at load), perf10 within [300, 1200] ms.)

| Session | perf10 eval (ms) | build eval (ms) | Δ perf10/build | State | Status |
|---|---|---|---|---|---|
| Night Aug 15 (8 runs) | 656.8 | 32.9 | −95.0 % | high | ✅ |
| Morning Aug 16 (8 runs) | 572.4 (541–581) | 31.3 (26–34.5) | −94.5 % | low | ✅ |
| Noon Aug 16 (5 runs) | 587.8 (577–623) | 31.9 (31–43) | −94.6 % | low | ✅ |
| Afternoon Aug 16 (20 runs) | 566.1 (531–712) | 29.8 (23–37.6) | −94.7 % | low | ✅ |
| CI Aug 16 (dispatch) | 567.7 (529–689) | 31.9 (27.5–38.8) | −94.4 % | low | ✅ |
| CI Aug 16 (PR #6) | 594.4 (551.2–717.4) | 29.9 (24.3–40.6) | −95.0 % | low | ✅ |
| CI Aug 16 (PR #7) | 650.5 (604.0–838.7) | 36.6 (27.9–54.5) | −94.4 % | high | ✅ |
| CI Aug 16 (validation dispatch) | 609.9 (553.1–824.5) | 29.3 (22.8–41.3) | −95.2 % | low | ✅ |
| CI Aug 16 (dispatch, after merge) | 576.0 (528.9–639.0) | 27.1 (22.8–34.8) | −95.3 % | low | ✅ |

The perf11 series (re-measured on the official v1.6.0 build) targeted the
**runtime** (hot loops, GPU, caches), not loading — confirmed on v1.6.0:
identical startup cost.

**Loading was attacked in v1.7.0** (lazy `codecProfile` eval), **kept
unchanged in v1.8.0**: `stream.video.codecProfile` used to be evaluated at
load (static definition options), and
`RTCRtpReceiver.getCapabilities("video")` costs **667 ms cold** (96 % of the
document-start eval) in a fresh Edge — the RTC stack init is synchronous and
blocking. The evaluation is now **lazy** (first real read: settings render
or value validation) and **memoized** (the result is constant per browser;
`validateValue`/`getValueText` re-read the cache). The
`patchRtcCodecs`/`patchRtcPeerConnection` guards read the raw stored value
(already validated by the `settings` getter) — the "no stored value" case no
longer triggers the call at load, semantics unchanged (invalid value →
`default`). Measured gain: **−95 % cold** (656.8 → 32.9 ms), **−8.7 % warm**
(26.5 → 24.2 ms).

### Hot loops (~60 Hz)

Frozen protocol — seeds 42 / 2024 / 999 × 3 passes × 200 000 iterations;
each cell = median of medians, range = inter-seed min–max. Absolutes vary
~±10–30 % run to run, ratios are stable.

| Hot loop | perf10 | v1.6.0 | Gain |
|---|---|---|---|
| Controller customization — **IDLE** (no input, centered sticks) | ~333 ns/poll (303–335) | **~29.8 ns/poll (30–38)** | **−91.1 % (×11.2)** |
| Controller customization — ACTIVE (button + stick) | ~387 ns/poll (385–408) | ~397 ns/poll (382–456) | equivalent |
| `poll_gamepad_default` — common path (Home never pressed) | ~12.8 ns/poll (11–17) | ~11.8 ns/poll (11–13) | identical |
| `poll_gamepad_default` — Home button release | ~1224 ns/poll (1189–1234) | **~152 ns/poll (150–159)** | **−87.6 % (×8.1)** |
| `WebGL2Player.updateFrame` — steady path (JS cost only) | ~173 ns/frame (169–174) | ~142 ns/frame (141–152) | equivalent (see note) |
| `WebGL2Player.updateCanvas` — unchanged values (60 Hz path, JS cost only) | ~246 ns/frame (239–253) | **~12.7 ns/frame (13–13)** | **−94.8 % (×19.4)** |

_v1.6.0 table measured in **low CPU state** (IDLE ratio perf10/build ×11.2) —
see the "Hot loops sessions" table below for inter-session comparability.
Since v1.6.0, `freeze.sh` captures the machine state before/after each seed
(`bench/state-cpu-s<seed>.*.json`, `--no-state` to disable)._

**Hot loops sessions — high/low state** (state derived from the **IDLE
ratio** perf10/build: `low` = ratio ≥ ~10 — quiet machine (perf10 IDLE
≤ ~340 ns); `high` = ratio ≤ ~9.5 — loaded machine (perf10 IDLE ≥ ~360 ns).
As on the GPU side, a fixed environment cost (CPU load, clocks, contention)
inflates both versions and flattens the build's advantage — the IDLE ratio
is the most sensitive, the Home release less so (see column). **Session
attribute, not build attribute**: the same code measures ×9.5 in a high
state and ×11.2 in a low state. Data still thin (3 sessions) — the machine
state capture will feed the classification.

| Session | perf10 IDLE (ns/poll) | build IDLE (ns/poll) | IDLE ratio | State | Home release (perf10 → build) |
|---|---|---|---|---|---|
| v1.4.0 re-measure (3 seeds) | 368 (352–398) | 39 (36–41) | **×9.5** | high | 1427 → 163 (−89 %) |
| v1.6.0 (3 seeds, release) | ~333 (303–335) | ~29.8 (30–38) | **×11.2** | low | ~1224 → ~152 (−87.6 %) |
| CI 2026-08-16 (hotloops, GPU dispatch) | 487.50 (458.00–487.80) | 49.70 (48.00–50.20) | **×9.81** | transitional | 1374.20 → 205.60 (−85 %) |
| CI 2026-08-16 (hotloops, PR #9) | 506.80 (502.80–530.70) | 46.70 (44.10–46.70) | **×10.85** | low | 1439.50 → 207.30 (−86 %) |

Notes:

- The **idle skip** (patch 12) divides the idle poll cost by ~×6.5 to ×9 —
  the common in-game case (pauses between inputs): no more
  `pressedButtons`/`releasedButtons` allocations, no more mapping iteration
  on every poll.
- The Home button release went through an unnecessary `structuredClone`
  (the `{shortcutPressed, timestamp}` object is never mutated between the
  read and the following `=null`) — replaced by a direct reference
  (patch 15).
- `updateFrame` has a negligible JS cost in both versions: the real gain is
  driver-side — `texImage2D` → `texSubImage2D` (no more texture
  reallocation every frame) and the removal of the per-frame `bindTexture`
  (60 fewer GL calls/s). These effects are not measurable in a JS
  micro-benchmark.
- The **uniform cache** (`updateCanvas`, patch 19) removed the 7
  `gl.uniform*` per frame when nothing changes (options, canvas size), by
  value comparison (~22 ns/frame); since **v1.6.0** (patch 20) a **dirty
  flag** set by `updateOptions`/`refreshPlayer` replaces the comparison:
  the steady path (60 Hz, nothing changes) costs one read + one branch —
  ~12.7 ns/frame (**×19.4** vs perf10, ~×1.7 vs v1.5.0).
- In absolute terms the savings are on the order of a microsecond per
  operation: the point is eliminating the **allocations at 60 Hz** (GC
  pressure) and the repeated driver work, not raw CPU time.

### GPU — WebGL2 renderer (real measurements)

Harness: Edge with a **real GPU (NVIDIA RTX 3070 via ANGLE/D3D11)**, even in
headless, 640×360 (VP9) test video generated in-browser, `WebGL2Player`
class extracted from each build and run in a real WebGL2 context, instrumented
GL methods (counters) and rasterization measured via
`EXT_disjoint_timer_query_webgl2` (`TIME_ELAPSED` around `drawArrays`),
120 frames × 3 passes (order mixed per seed), stabilized protocol (see Repro).

> Table measured on **v1.4.0** — **confirmed on v1.5.0** (6-seed protocol,
> extracted class `gpu-v150-webgl2player.txt`, `--label-new=v1.5.0`, one
> command: `./bench/gpu/run-gpu-ci.sh --cls-new=bench/gpu/gpu-v150-webgl2player.txt
> --label-new=v1.5.0`): upload ×2.10, wallTotal ×1.49, draw 10.2 vs 9.2 µs
> (ratio 1.11 — documented inter-session drift), GL path `texSubImage2D`
> intact. Between v1.4.0 and v1.5.0 only `updateCanvas` (uniform value
> cache, CPU-side) changed; **v1.6.0** only changes `updateCanvas`
> (dirty flag, CPU-side) — `updateFrame` and the shader are byte-for-byte
> identical to v1.5.0 (checked on the extracted class
> `gpu-v160-webgl2player.txt`) → **the GPU table stays valid**. The CPU cost
> of the steady 60 Hz path is covered by the "Hot loops" table.
> **Re-confirmed on v1.6.0** (6-seed protocol, local, same day as the
> release): **PASS** — upload perf10 52.25 (48–61) vs v1.6.0 10.75
> (8.5–11.3) µs (**×4.86**), wallTotal 0.052 vs 0.017 ms (**×3.00**),
> draw **10.2 µs identical everywhere**, GL path `texSubImage2D` functional
> (0 `texImage2D`, 0 `bindTexture`). Absolutes are much lower than the v1.5.0
> session (~61 µs for the same code) — **inter-session machine-state drift**
> (backpressure/sync of the video/GPU pipeline, cf. "GPU sessions" table
> below and project memo §7): a same-session control with the v1.5.0 class
> measures the same low absolutes → v1.5.0 and v1.6.0 are identical on the
> GPU path (byte-identical updateFrame), only the intra-session ratios
> (perf10 vs build) matter.
> **v1.6.0 evening re-measure (6 seeds, machine state captured)**: upload
> perf10 42.2–77.7 (med. 54.7) vs v1.6.0 7.7–11.8 (med. 10.0) µs (**×5.47**);
> wallTotal **×2.82**; draw 10.2 vs 9.2 µs — **low state** (ratio ≥ 4),
> cold and lightly loaded machine (GPU 50–53 °C, SM 1725 MHz / P0 constant,
> CPU load 22–69 %) — consistent with the evening session. Emission/sync
> split (new): v1.6.0 emit 7.7–11.8 (stable) / sync 19.5–75.0 / total
> 29–84 µs depending on seed (seed 42 control: ~31 µs, in the low band);
> perf10 emit 42.2–77.7 / sync 69.7–112.0 / total 112–165 µs — the **sync
> readback is the volatile component** (not the emission): the "stable
> total" prediction is not confirmed (cf. sessions table).
> **Machine-state correlation: negative** (6 seeds) — the captured state was
> nearly constant (SM 1725 MHz pinned, temp 50–53 °C, power 48–57 W) and
> correlates with nothing (|r| ≤ 0.68, not significant at n=6). The sync
> variance is **temporal: first-pass effect** — the first upload measurement
> of each seed has a high sync (65–239 µs) then drops to 13–24 µs from the
> 2nd pass (5/6 seeds); preheating (50 uploads) does not stabilize the
> readback (harness improvement to do: preheat the readback).
> **v1.8.0 — USM 4-tap shader** (patch 22, Aug 17 release): the WebGL2
> fragment shader goes from 9 fetches to an exact 3×3 gaussian in 4 bilinear
> samples (±0.5 texel) — GPU draw **10.24 → 7.17 µs (−30 %)** (seed 42
> re-measure of the real build, identical to the prototype across the 3
> passes); upload and wall **unchanged** (the patch only touches the
> shader). Visual equivalence validated (`bench/gpu/visual-diff.js`):
> sharpness bit-identical (maxAbs 0), ≤ 0.002 % of pixels at ±1 ULP fp32 —
> CI gate at the gpu-upload job.

| Measurement | perf10 | v1.6.0 | Δ |
|---|---|---|---|
| GL calls per frame | `texImage2D` + `drawArrays` (0 allocation) | `texSubImage2D` + `drawArrays` (0 allocation) | same number of calls |
| Video upload — tight loop (µs/upload) | ~42–78 µs | ~8–12 µs | **×5.5** |
| Rasterization `drawArrays` (µs/draw, GPU median) | 10.2 µs | 9.2 µs | ×1.1 |
| `updateFrame` — total wall (ms/frame, full loop / FRAMES) | ~0.043–0.074 ms | ~0.011–0.020 ms | **×2.8** |

_v1.6.0 table — evening re-measure (Aug 15), **low state** (upload ratio
×5.47) — see the "GPU sessions" table below for inter-session
comparability._

**GPU sessions — high/low state** (state derived from the **upload ratio**
perf10/build: `low` = ratio ≥ ~4 — pure emission, the `texSubImage2D`
advantage shows at full strength; `high` = ratio ≤ ~2.5 — a fixed
sync/backpressure cost (~50–70 µs/upload, cf. project memo §7) masks the
advantage; `transitional`/`mixed` between the two or when the session
contains both states). **The state is a session attribute, not a build
attribute**: the same code measures ×1.8–2.1 in a high state and ×4.3–6.6
in a low state — comparing two sessions means comparing ratios and draw,
never absolutes.

| Session | Version | perf10 upload (µs) | build upload — emission (µs) | Upload ratio | State | build sync (µs) | build total (µs) | Draw (µs) | Bound | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| Origin (unstabilized) | v1.3.0 | 200–235 | 64–66 | ×3.3 | transitional | — | — | — | — | — |
| Session 1 (6 stabilized seeds) | v1.4.0 | 80.5–93 | 43.8–50.3 | **×1.8** | high | — | — | 10.2 | — | — |
| Session 2 (frozen protocol) | v1.4.0 | 98.5–150.7 | 54.7–74.5 | **×2.1** | high | — | — | 10.2 | — | — |
| Morning Aug 15 (6 seeds) | v1.5.0 | 61.8–137 | 10.3–76.8 | **×1.7** (s300: ×6.0) | mixed | — | — | 10.2 | — | — |
| Evening Aug 15 (6 seeds) | v1.6.0 | 48.2–61.3 | 8.5–11.3 | **×4.86** | low | — | — | 10.2 | emission ≤ 25.00 µs · wall ≤ 0.10 ms · draw ≤ 25.00 µs | ✅ |
| Evening Aug 15 — re-measure (6 seeds + machine state) | v1.6.0 | 42.2–77.7 | 7.7–11.8 | **×5.47** | low | 24.5 (19.5–75) | **33.3** (29–83.8) | 10.2 vs 9.2 | emission ≤ 25.00 µs · wall ≤ 0.10 ms · draw ≤ 25.00 µs | ✅ |
| Night Aug 15 — captured phase (6 seeds) | v1.6.0 | 57.25 (51.25–60.50) | 11.00 (9.00–11.75) | **×5.20** | low | 16.75 (15.00–26.25) | **26.25** (25.25–34.25) | 11.26 vs 10.24 | emission ≤ 25.00 µs · wall ≤ 0.10 ms · draw ≤ 25.00 µs | ✅ |
| CI Aug 15 (6 seeds, self-hosted Windows/GPU runner) | v1.6.0 | 47.50 (45.50–52.50) | 10.00 (8.25–11.75) | **×4.75** | low | 17.25 (14.75–25.25) | **26.75** (24.25–35.50) | 10.24 vs 10.24 | emission ≤ 25.00 µs · wall ≤ 0.10 ms · draw ≤ 25.00 µs | ✅ |
| Aug 17 — v1.8.0 USM build (seed 42, real-build re-measure) | v1.8.0 | — | — | — | — | — | — | 10.24 vs **7.17** | draw ≤ 25.00 µs · emission ≤ 25.00 µs · wall ≤ 0.10 ms | ✅ |

_**Bound**/**Status** columns: absolute build bounds (emission ≤ 25 µs,
wall ≤ 0.10 ms, draw ≤ 25 µs — calibrated on the CI runner). Sessions before
the emission/sync split or in high/mixed state (non-comparable absolutes,
"only ratios count") are marked "—". Generated by `check-gpu.js`
(`--update-readme`)._

_Emission/sync split (readback `readPixels`, cf. bench/gpu/README.md) only
measured since the evening re-measure (gpu-runner.js v2) — earlier sessions
only have emission (historical uploadNs = "build upload — emission"
column). **"Stable total" (backpressure) prediction: not confirmed** — the
**sync readback is the volatile component** (v1.6.0: 19.5–75.0 µs depending
on seed, total 29–83.8 µs; perf10: sync 69.7–112.0, total 111.7–165.5 µs)
while the emission stays stable (7.7–11.8 µs). The bimodality (high/low
state) therefore shows in the sync readback AND in the emission depending on
the session, not as a stable total — to be refined with a high-state
session._

_Inter-session re-runnability (evening → re-measure, same seeds 100–600,
same build): median ratios reproducible to ~±15 % (upload ×4.86 → ×5.47,
wall ×3.00 → ×2.82, draw v1.6.0 10.2 → 9.2); per-seed absolutes ±10–30 %
(med. |Δ| 11–23 %); per-seed ratios ±20–37 % (individual seeds are not
stable, only the aggregate counts); the anomalous perf10 draw (15.4 µs) is
not reproducible (one-off artifact)._

Reading the results:

- The **draw** (rasterization) cost the same in both versions (10.2 vs
  9.2 µs, ratio 1.1) — same shader; **since v1.8.0**, the USM 4-tap shader
  (exact 3×3 gaussian in 4 bilinear samples instead of 9 fetches) brings it
  to **7.17 µs (−30 %)** on the build side (perf10 unchanged, 10.24 µs),
  visual equivalence validated (CI gate).
- The real lever is the **video upload**: `texImage2D` **reallocates the
  texture's GPU storage every frame** (~×2.1 the cost of a `texSubImage2D`
  in an immutable storage). This is the measurable benefit of patches
  13/16 on the GPU side — invisible in JS micro-benchmarks (hence the gap
  with the "Hot loops" table above).
- The `updateFrame` wall follows (~×2.8 on the re-measure with the
  stabilized `wallTotal` metric on v1.6.0): the synchronized part of the
  upload path dominates the frame.
- **Frozen protocol** (cf. Repro — seeds 100/200/300/400/500/600 × 3
  passes, exact commands): full re-measure — upload perf10 98.5 / 113.5 /
  119.0 / 136.5 / 139.0 / 150.7 µs vs v1.4.0 54.7 / 58.2 / 62.8 / 65.2 /
  69.3 / 74.5 µs (median of medians: 136.5 vs 65.2 µs, **×2.1**);
  wallTotal 0.097–0.136 vs 0.059–0.085 ms (**×1.5**); draw 0.01024 ms
  (**10.2 µs**) identical everywhere (one perf10 seed at 9.2 µs — driver
  state). **Second independent session** of the same protocol (same seeds,
  same commands): shifted absolutes (session 1: 80.5–93 / 43.8–50.3 µs) but
  **draw, GL counters and ratios identical** — re-runnability holds for the
  draw, the counters and the ratios, not for absolutes (documented
  inter-session machine-state drift, cf. "GPU sessions" table).
  **v1.6.0 re-measure** of the same protocol (same seeds 100–600, same day
  as the release): upload 48–61 vs 8–11 µs (**×4.86**, **low** state),
  wallTotal 0.052 vs 0.017 ms (**×3.00**), draw 10.2 µs identical
  everywhere — cf. the "GPU sessions" table above. **Re-measure (evening,
  same seeds)**: upload 42.2–77.7 vs 7.7–11.8 µs (**×5.47**, **low**
  state), wallTotal **×2.82**, draw 10.2 vs 9.2 µs — same state as the
  evening session (cold machine, cf. note above).

> **⚠️ Bug (fixed in v1.4.0) — builds v1.2.0 and v1.3.0 (and the TS
> upstream)**: `gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGB, …)` used a
> **non-sized format** (`gl.RGB`) → `INVALID_ENUM` on every resolution
> change → the allocation failed, video uploads failed
> (`CopySubTextureCHROMIUM`) and the WebGL2 renderer produced a **black
> screen** (verified by `readPixels`: 100 % black pixels with `gl.RGB`,
> real video with `gl.RGB8`). **Fixed in v1.4.0** (`gl.RGB` → `gl.RGB8`,
> patch 18). The GPU measurements in the table were **re-measured on the
> official v1.4.0 build without any harness correction** (the fix is in the
> build; the v1.3.0 WebGL2Player class is byte-for-byte identical to v1.4.0
> except for this fix — verified by `diff` of the extracted classes).
> (The WebGL2 renderer is not the default — `video.player.type` — so the old
> bug only affected sessions that enabled it.)

## Repro — how the measurements are made

The figures in the Benchmarks chapter come from the harnesses in the
**`bench/`** folder of this repo (self-contained, cf. `bench/README.md`):

```bash
./bench/run-all.sh                   # parse + hot loops + page eval (Edge)
./bench/run-all.sh --skip-page-eval  # without Playwright
```

Each harness takes two builds as arguments (`<perf10.js> <build.js>`);
`run-all.sh` extracts the baseline from git (`git show 055d3a0:better-xcloud.user.js`)
and uses the root `better-xcloud.user.js`. Details below (parameters +
pitfalls) to adapt them.

**CI**: the `.github/workflows/bench.yml` workflow runs
`run-all.sh --skip-page-eval` on every push on `ubuntu-latest`, then
`bench/check-ratios.js` fails if a hot-loop ratio regresses beyond its
threshold (floor ×4 for IDLE/release, ×12 for updateCanvas with the v1.6.0
dirty flag, 0.5–2.0 band for equivalent scenarios) — the updateCanvas
scenario also **structurally** checks the `gl.uniform*` counters (the build
must only emit its 7 calls at warmup) — see `bench/README.md`.

### Frozen protocol ("Hot loops" and "Loading" tables)

The tables in the Benchmarks chapter are produced by these **exact
commands** (v1.6.0 build from the root — the hot-loop code is unchanged
since v1.3.0; the WebGL2 renderer got the RGB8 fix in v1.4.0, the uniform
cache in v1.5.0 and the dirty flag in v1.6.0):

```bash
# 0. Prepare the builds
TMP=$(mktemp -d)
git show 055d3a0:better-xcloud.user.js > "$TMP/perf10.js"
cp better-xcloud.user.js "$TMP/build.js"

# 1. Hot loops: 3 seeds × 3 passes × 200 000 iterations — each run prints
#    median/min/max over passes; tables use the median of medians and the
#    min–max range across the 3 seeds
for S in 42 2024 999; do
  node --expose-gc bench/hotloops.js "$TMP/perf10.js" "$TMP/build.js" \
    --passes=3 --seed=$S --iters=200000
done

# 2. Parse/compile ("Loading" row): same seeds, ×300 iterations/pass
for S in 42 2024 999; do
  node --expose-gc bench/parse.js "$TMP/perf10.js" "$TMP/build.js" \
    --passes=3 --seed=$S --iters=300
done

# 3. Page eval ("Loading" row): 20 runs, median/p95
node bench/page-eval.js "$TMP/perf10.js" "$TMP/build.js"
```

`--expose-gc` is mandatory (preheating + `global.gc()` before each timing);
`--passes=3` (median/min/max over passes) and `--seed=` (version × scenario
crossover, mulberry32) make each run reproducible and prevent one version
from always being measured first.

**Replay the tables in one command**: `./bench/freeze.sh` runs this block
identically and `bench/freeze-format.js` formats the output into markdown
tables ready to paste (median of medians + inter-seed range, version label
read from `@version`) — see `bench/README.md`. With `--update-readme`, the
"Hot loops" and "Loading" sections are **regenerated in place** in the
README (anchors `Notes :` / `La série perf11` preserved; `--with-page-eval`
to keep the "Éval" row).

### Common environment

- Windows, **Edge** (`msedge` channel via Playwright) for browser
  measurements, **Node V8** for CPU micro-benchmarks.
- The two compared builds: baseline **perf10** (`git show
  055d3a0:better-xcloud.user.js`) and **v1.6.0** (root `better-xcloud.user.js`).
- Test page served by a **local HTTP server 127.0.0.1**: a real origin is
  mandatory (no `localStorage` on `about:blank`).

### Parse / compile (`bench/parse.js`)

- `new Function(code)` **without execution** (real execution is measured in
  Edge), ×300 iterations per pass.
- **Stabilization** (same protocol as hotloops/GPU): explicit 2-phase
  preheating (10 + 20 compiles) then `global.gc()` before timing
  (`node --expose-gc`, done by `run-all.sh`); **crossed runs**: the
  measurement order (version × pass) is mixed by reproducible seed
  (`--seed=N`, mulberry32); **median / min / max over 3 passes**
  (`--passes=N`).
- Per-iteration timing with `process.hrtime.bigint()` (ns resolution): a
  ~110–150 µs compile is too close to the `performance.now()` resolution
  for a reliable per-iteration measurement. The p95 captures GC outliers
  (absorbed by the median).
- Sub-ms → noisy: the perf10/build gap is **within the inter-seed noise
  (≈ ±10–20 % run to run)** — the protocol makes it visible instead of
  freezing a figure from a lucky session; only the relative comparison
  counts.

### Full page eval (`bench/page-eval.js`, Edge, document-start)

- URL: `http://127.0.0.1:<port>/en-us/play` — the script requires
  `pathname.match(/^\/[a-zA-Z]{2}-[a-zA-Z]{2}\/play/)` ("Not xCloud page"
  guard).
- `window.BX_FLAGS = { SafariWorkaround: false }` (disables the reload
  guard that throws if `readyState !== "loading"`).
- Injection at **document-start** via `page.addInitScript`, evaluation as
  soon as `document.documentElement` exists — **1 ms poll** (it is null
  ~18–25 ms into the navigation; `setTimeout(0)` fires too early).
- Measured time = duration of the full script `eval` (bootstrap `main()`
  included), 20 runs, median/p95 (perf10 has environmental p95 outliers,
  the median is stable).

### Hot loops ~60 Hz (`bench/hotloops.js`, Node)

- Extraction of the injected fragments from the build: regex
  `var <name> = "((?:[^"\\]|\\.)*)";` then string decoding (JSON).
- Substitution of the placeholders the Patcher does at runtime:
  `$xCloudGamepadVar$` → gamepad variable, `$gamepadVar$` → `currentGamepad`.
- `var self=this` at the top of `poll_gamepad_default`: call `fn.call(ctx, ctx)`
  (otherwise `this` = global and the "release" path never triggers).
- Shadow `window` and `setTimeout` in the wrapper (otherwise Node pulls the
  real timer/global).
- **Reuse the same ctx between polls**: a fresh ctx per iteration (20+
  objects) dominates the measurement.
- Realistic mapping/ranges for `controller_customization`; the "Home
  release" path requires `bxHomeStates[index]` pre-filled +
  `inputSink.onGamepadInput` + `BX_STREAM_SETTINGS.controllerPollingRate`.
- **Stabilization** (run-to-run variance reduction, same recipe as GPU):
  explicit 2-phase preheating (5 000 + 10 000 iterations) then
  `global.gc()` before timing (`node --expose-gc`, done by `run-all.sh` —
  otherwise the warmup garbage is collected during the measurement);
  **crossed runs**: measurement order (version × scenario) mixed by
  reproducible seed (`--seed=N`, mulberry32 PRNG); **median / min / max
  over 3 passes** (`--passes=N`).
- 200 000 iterations per scenario. The Home release keeps its **fresh ctx**
  (the fragment sets `bxHomeStates[index]` to `null` on first release — a
  reused ctx would fall back to the fast path) but `buttons` is **hoisted
  out of the closure** (creating it per iteration would add 20
  allocations/poll and inflate the measurement).

### GPU — WebGL2 renderer (real Edge, `bench/gpu/`)

The full harness lives in **`bench/gpu/` of this repo** (self-contained,
cf. `bench/gpu/README.md`): `gen-video.js` (test video), `extract-class.js`
(class extraction), `gpu-runner.js`, extracted classes, `agg-seeds.js`,
`gpu-update-readme.js`. `test.webm` and the `run-s*.json` files are
**gitignored** (generated artifacts) — the extracted classes are versioned.
Prerequisites: Node + Playwright (`msedge` channel) + real GPU. Key points:

- **Test video**: Playwright's ffmpeg has no `lavfi` → generate the video
  in-browser (`canvas.captureStream(30)` + MediaRecorder VP9), serve
  locally.
- **Extracted class**: the `class WebGL2Player` cut out of the build (class
  bounds) and evaluated in the page with a minimal `BaseCanvasPlayer`
  stub; `getContext` is intercepted to instrument the WebGL2 context.
- **GL counters**: wrapper around the context methods — **the wrapper must
  `return orig(...)`** (otherwise `createTexture()` returns `undefined` →
  "no texture bound" on subsequent calls).
- **GPU timing**: Edge/ANGLE doesn't expose `createQueryEXT` on
  `EXT_disjoint_timer_query_webgl2` → use the native `gl.createQuery()` API
  + `gl.beginQuery(ext.TIME_ELAPSED_EXT, q)` + `gl.endQuery(...)`, results
  read via `getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE / QUERY_RESULT)`
  (parallel resolution).
- `WEBGL_debug_renderer_info` to identify the renderer (headless keeps the
  real GPU: "ANGLE (NVIDIA, … D3D11)").
- `readPixels` on a texture ≥ video dimensions (otherwise
  "Offset overflows texture dimensions").
- `gpu-runner.js` is parameterizable: `--cls-p10=`/`--cls-new=` (extracted
  classes), `--label-new=`, `--frames=`, `--passes=`, `--seed=N`, `--no-fix`.
  The `gl.RGB → gl.RGB8` fix only applies if the extracted code still
  contains `gl.RGB` (builds ≤ v1.3.0); the v1.4.0 build already contains
  the fix → measured with `--no-fix`, strictly the published build.
- **Stabilization** (inter-session variance reduction): explicit GPU
  preheating — 3 bursts × 200 frames separated by `flush()` + 50 ms, then
  30 frames, then preheat the upload loop (50 untimed uploads); **crossed
  mixed runs** by reproducible seed (`--seed=N`, mulberry32 PRNG) so no
  version is systematically measured first; **median over 3 passes**
  (absorbs "first-pass" outliers); `wallTotal` metric (whole-loop time /
  FRAMES) — stable against the ~100 µs `performance.now()` resolution per
  frame (the per-frame median wall saturates at 0.000).

**Frozen protocol (GPU)** — replay the "GPU" table as-is (from the repo
root):

```bash
# One command (same chain as the gpu-upload CI job: gen-video →
# 6 seeds × gpu-runner → agg-seeds → check-gpu):
./bench/gpu/run-gpu-ci.sh                      # full protocol (~30–40 min)

# Manual equivalent (Prerequisites: generated test.webm, Playwright via
# NODE_PATH, e.g. NODE_PATH=/d/Codex/koharu/node_modules):
for S in 100 200 300 400 500 600; do
  node bench/gpu/gpu-runner.js \
    --cls-p10=bench/gpu/gpu-perf10-webgl2player.txt \
    --cls-new=bench/gpu/gpu-v140-webgl2player.txt \
    --label-new=v1.4.0 \
    --no-fix --frames=120 --passes=3 --seed=$S \
    > bench/gpu/run-s$S.json
done
node bench/gpu/agg-seeds.js 100 200 300 400 500 600
node bench/gpu/check-gpu.js 100 200 300 400 500 600
```

`run-gpu-ci.sh`: auto-detected channel (`msedge` Windows / `chromium`
Linux), `--seeds=`, `--keep-video`/`--force-video`, `--label-new=`
(propagated to `agg-seeds.js` — e.g. `--cls-new=... --label-new=v1.5.0` to
measure another build), `--no-fix` by default. See `bench/gpu/README.md`
for all options.

Aggregation rules: each run prints the per-version `agg` (median over the 3
passes of upload, wallTotal and draw); `agg-seeds.js` aggregates the 6
seeds (min / max / median of medians per metric) and the ratios.
`--no-fix` measures **strictly the published build** (the v1.4.0 class
already contains `gl.RGB8` — the fix only applies to builds ≤ v1.3.0). The
GL counters (per frame: `texImage2D`/`texSubImage2D` + `drawArrays`, 0
`bindTexture`) confirm the functional path on every replay.

**Regenerate the GPU table in place**: `bench/gpu/gpu-update-readme.js`
aggregates the `bench/gpu/run-s<seed>.json` files and replaces the "GPU"
table of the README directly — the GPU equivalent of `--update-readme`:

```bash
node bench/gpu/gpu-update-readme.js 100 200 300 400 500 600   # patches README.md (root)
node bench/gpu/gpu-update-readme.js 100 200 300 400 500 600 --print-only
```

(anchored on the unique `| Appels GL par frame |` line — the `| Mesure |
perf10 | v… | Δ |` line exists twice in the README, Loading table included.
Only the table is regenerated: the "Frozen protocol" bullet of the "Reading
the results" section stays curated because it documents protocol and
sessions.)

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
