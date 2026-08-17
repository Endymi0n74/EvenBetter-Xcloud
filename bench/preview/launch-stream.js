"use strict";
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.connectOverCDP("http://127.0.0.1:9222");
  try {
    const ctx = b.contexts()[0];
    let page = ctx.pages().find((p) => p.url().includes("play.xbox.com"));
    if (!page) {
      page = ctx.pages()[0] || (await ctx.newPage());
      console.log("→ ouverture play.xbox.com…");
      await page.goto("https://play.xbox.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 3000));
    }
    const url = "https://play.xbox.com/stream/9N683TDT5M7R/halo-campaign-evolved";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log("navigué →", page.url());
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const s = await page.evaluate(() => {
        const v = document.querySelector("video");
        return { ready: v ? v.readyState : -1, paused: v ? v.paused : null, href: location.href.slice(0, 60) };
      }).catch(() => null);
      console.log(`[${i * 5}s] readyState=${s && s.ready} paused=${s && s.paused} ${s && s.href}`);
      if (s && s.ready >= 2 && !s.paused) { console.log("stream UP"); break; }
    }
  } finally {
    await b.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
