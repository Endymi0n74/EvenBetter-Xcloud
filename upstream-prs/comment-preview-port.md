Hi! A quick informational note alongside the PRs we've been sending for the
stable client (www.xbox.com/play).

We also maintain a **complete port of the new play.xbox.com client** (the
React Router 7 shell, a different codebase from the one this script patches)
as a separate script variant, matching only `https://play.xbox.com/*`. It
includes:

- settings entry point on that client: desktop top-bar button + **floating
  button fallback on mobile** (the new shell has no `<header>` below 768 px)
  and a Settings action in the stream game bar (the stream page is immersive);
- **document-replacement resilience** — the preview shell replaces the
  document when a stream starts, which orphans script nodes and kills
  MutationObservers; the port re-arms and re-injects on the current document;
- **idle keep-alive** — `WarningForBeingIdle` → `sendKeepAlive()`, the same
  interception as the stable `remote-play-keep-alive` patch, re-derived for
  the new client's `StreamSessionRequest` module (loaded as native ESM, so
  via session wrapping rather than fetch hooking);
- **`/configuration` overrides** (vibration / MKB / mic / touch) using the
  same `clientStreamingConfigOverrides` schema as this repo's
  `xcloud-interceptor.ts`;
- **UA auto-spoof** for the new client's Chromium-only browser gate
  (play.xbox.com blocks Firefox/other engines even though the WebRTC H.264
  stream works there).

This work targets Microsoft's minified bundle — there is no public source
repo for play.xbox.com — so it can't be submitted as a normal PR to this
repository. It's fully documented (anchors, patches, E2E validation protocol)
and we'd be happy to share it if you ever plan to support the new client
here, or want to review any of these mechanisms for the stable side.

No action needed — just making the option known.
