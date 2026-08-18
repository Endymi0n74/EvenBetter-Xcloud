#!/usr/bin/env node
/**
 * bench/verify-badge.js — vérifie EN RÉEL le badge EvenBetterXcloud <version>
 *
 * Charge xbox.com/play dans un Edge piloté par CDP avec le bundle stable servi
 * (injecté via l'extension .edge-inject-stable, équivalent Greasemonkey :
 * document-start + world MAIN), ouvre les settings, lit le badge, clique
 * dessus et vérifie que la navigation part vers nos releases GitHub.
 *
 * Usage :
 *   1. Lancer Edge (extension d'injection stable obligatoire) :
 *        "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" \
 *          --remote-debugging-port=9224 \
 *          --user-data-dir=D:\edge-profiles\guard-badge \
 *          --load-extension=D:\Codex\better-xcloud-fork\.edge-inject-stable \
 *          --no-first-run --no-default-browser-check
 *   2. node bench/verify-badge.js [--port=9224] [--url=https://www.xbox.com/fr-FR/play]
 *
 * Exit 0 : badge « EvenBetterXcloud <version> » affiché + clic → releases
 * GitHub (target CDP ouverte sur notre repo). Exit 1 : GATE ROUGE.
 */
const CDP_PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "--port=9224").split("=")[1]);
const PAGE_URL = (process.argv.find((a) => a.startsWith("--url=")) || "--url=https://www.xbox.com/fr-FR/play").split("=").slice(1).join("=");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Notre Edge écoute sur [::1] (IPv4 pris par un vieux forward adb du WebView
// Android) — [::1] EN PREMIER (celui du /json/new doit être notre navigateur,
// le WebView Android répond « Could not »), puis 127.0.0.1 en secours.
let BASE = null;
async function jsonList() {
  for (const host of ["[::1]", "127.0.0.1"]) {
    try {
      const r = await fetch(`http://${host}:${CDP_PORT}/json`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) { BASE = `http://${host}:${CDP_PORT}`; return r.json(); }
    } catch {}
  }
  throw new Error(`aucun CDP sur le port ${CDP_PORT} (127.0.0.1 et [::1])`);
}

function createCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws erreur")); });
  return {
    ready,
    send(method, params = {}) {
      return ready.then(() => new Promise((resolve, reject) => {
        const mid = ++id;
        pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }));
    },
    close() { try { ws.close(); } catch {} },
  };
}

async function main() {
  // Onglet DÉDIÉ (jamais un onglet existant de l'utilisateur) : création via
  // /json/new — déterministe et non intrusif.
  await jsonList(); // résout BASE
  const created = await (await fetch(`${BASE}/json/new?${encodeURIComponent(PAGE_URL)}`, { method: "PUT" })).json();
  const page = created;
  const cdp = createCdp(page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  console.log(`[badge] onglet dédié créé → ${PAGE_URL}`);
  await cdp.send("Page.navigate", { url: PAGE_URL });

  // 1. attendre le bouton settings (classe bx-header-settings-button)
  let btn = null;
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    const r = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector('#bx-header-settings-button') || document.querySelector('.bx-header-settings-button');
        return el ? { found: true, visible: !!(el.offsetWidth || el.offsetHeight) } : { found: false };
      })()`,
      returnByValue: true,
    });
    btn = r.result.value;
    if (btn && btn.found) break;
  }
  if (!btn || !btn.found) { console.error("[badge] GATE ROUGE : bouton settings introuvable après 60 s (script non injecté ?)"); process.exit(1); }
  console.log(`[badge] bouton settings présent (visible=${btn.visible})`);

  // 2. ouvrir les settings
  await cdp.send("Runtime.evaluate", {
    expression: `document.querySelector('#bx-header-settings-button') || document.querySelector('.bx-header-settings-button')`,
  });
  await cdp.send("Runtime.evaluate", {
    expression: `(() => { const el = document.querySelector('#bx-header-settings-button') || document.querySelector('.bx-header-settings-button'); el.click(); })()`,
  });
  await sleep(1500);

  // 3. lire le badge (feuille textuelle « EvenBetterXcloud <version> »)
  const badge = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const nodes = [...document.querySelectorAll('*')].filter(e => e.children.length === 0);
      const m = nodes.find(e => /^EvenBetterXcloud\\s+[0-9.]+(-preview[0-9]+)?$/.test(e.textContent.trim()));
      return m ? { text: m.textContent.trim(), tag: m.tagName, cls: typeof m.className === 'string' ? m.className : '' } : null;
    })()`,
    returnByValue: true,
  });
  const badgeVal = badge.result.value;
  if (!badgeVal) { console.error("[badge] GATE ROUGE : badge « EvenBetterXcloud <version> » introuvable dans le dialogue"); process.exit(1); }
  console.log(`[badge] badge affiché : « ${badgeVal.text} » (${badgeVal.tag}.${badgeVal.cls})`);
  const m = badgeVal.text.match(/EvenBetterXcloud\s+([0-9.]+(-preview[0-9]+)?)/);
  if (!m) { console.error("[badge] GATE ROUGE : texte du badge inattendu"); process.exit(1); }
  console.log(`[badge] version du badge : ${m[1]}`);

  // 4. capture preuve avant clic
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  require("fs").writeFileSync("D:/Codex/badge-proof-1.9.0.png", Buffer.from(shot.data, "base64"));
  console.log("[badge] preuve : D:/Codex/badge-proof-1.9.0.png");

  // 5. cliquer le badge → doit ouvrir nos releases. Le badge est un lien
  //    natif (createButton avec url → <a class="bx-button" href target=_blank>
  //    dans le bundle), donc : (a) vérifier href/target du lien dans le DOM,
  //    (b) vrai clic CDP (Input.dispatchMouseEvent, geste de confiance) et
  //    vérification d'un target / d'une navigation vers nos releases.
  const link = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const nodes = [...document.querySelectorAll('*')].filter(e => e.children.length === 0);
      const m = nodes.find(e => /^EvenBetterXcloud\\s+[0-9.]+(-preview[0-9]+)?$/.test(e.textContent.trim()));
      const a = m.closest('a');
      return a ? { href: a.href, target: a.target, tag: a.tagName, cls: a.className } : null;
    })()`,
    returnByValue: true,
  });
  const linkVal = link.result.value;
  if (!linkVal || !String(linkVal.href).includes("EvenBetter-Xcloud/releases")) {
    console.error(`[badge] GATE ROUGE : le badge n'est pas un lien vers nos releases (${JSON.stringify(linkVal)})`);
    process.exit(1);
  }
  console.log(`[badge] badge = <a href="${linkVal.href}" target="${linkVal.target}"> — le clic ouvrira nos releases`);

  await cdp.send("Page.bringToFront");
  const rect = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const nodes = [...document.querySelectorAll('*')].filter(e => e.children.length === 0);
      const m = nodes.find(e => /^EvenBetterXcloud\\s+[0-9.]+(-preview[0-9]+)?$/.test(e.textContent.trim()));
      const a = m.closest('a');
      const r = a.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, hit: hit ? hit.tagName + '.' + (typeof hit.className === 'string' ? hit.className : '') : null };
    })()`,
    returnByValue: true,
  });
  const { x, y, hit } = rect.result.value;
  console.log(`[badge] clic CDP réel à (${x},${y}) → elementFromPoint=${hit}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });

  let ok = false;
  for (let i = 0; i < 12; i++) {
    await sleep(1000);
    const list = await jsonList();
    const hit2 = list.find((t) => t.url.includes("EvenBetter-Xcloud/releases"));
    if (hit2) { console.log(`[badge] clic → ${hit2.url}`); ok = true; break; }
    const loc = await cdp.send("Runtime.evaluate", { expression: "location.href", returnByValue: true });
    if (String(loc.result.value).includes("EvenBetter-Xcloud/releases")) {
      console.log(`[badge] clic → ${loc.result.value} (même onglet)`);
      ok = true;
      break;
    }
  }
  if (!ok) { console.error("[badge] GATE ROUGE : aucun target vers nos releases après le clic"); process.exit(1); }

  console.log(`[badge] OK : badge « ${badgeVal.text} » affiché, clic → releases GitHub`);
  process.exit(0);
}

// Garde anti-pendaison : jamais plus de 150 s par run.
setTimeout(() => { console.error("[badge] TIMEOUT GLOBAL 150 s — run abandonné"); process.exit(1); }, 150000);

main().catch((e) => { console.error("[badge] erreur :", e.message); process.exit(1); });
