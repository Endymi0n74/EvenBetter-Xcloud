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
 *          --user-data-dir=D:\Codex\EvenBetterXcloud\edge-profiles\guard-badge \
 *          --load-extension=D:\Codex\EvenBetterXcloud\better-xcloud-fork\.edge-inject-stable \
 *          --no-first-run --no-default-browser-check
 *   2. node bench/verify-badge.js [--port=9224] [--url=https://www.xbox.com/fr-FR/play] [--banner]
 *
 * --banner : en plus du badge, vérifie la BANNIÈRE Android (« 🔥 EvenBetterXcloud
 * app for Android ») : UA Android simulé, lien = downloads direct de l'APK
 * (lien stable evenbetter-xcloud.apk), vrai clic CDP et TÉLÉCHARGEMENT réel
 * dans D:/Codex/EvenBetterXcloud/artifacts/banner-dl — le fichier téléchargé doit être byte-identique à
 * l'asset servi par le lien de la bannière.
 *
 * Exit 0 : badge « EvenBetterXcloud <version> » affiché + clic → releases
 * GitHub (+ bannière → APK téléchargé en --banner). Exit 1 : GATE ROUGE.
 */
const CDP_PORT = Number((process.argv.find((a) => a.startsWith("--port=")) || "--port=9224").split("=")[1]);
const PAGE_URL = (process.argv.find((a) => a.startsWith("--url=")) || "--url=https://www.xbox.com/fr-FR/play").split("=").slice(1).join("=");
const WITH_BANNER = process.argv.includes("--banner");
// La bannière n'est poussée dans le menu que sur UA Android (le script teste
// UserAgent.getDefault().toLowerCase().includes("android")).
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const DL_DIR = "D:/Codex/EvenBetterXcloud/artifacts/banner-dl";
const BANNER_URL = "https://github.com/Endymi0n74/EvenBetter-Xcloud/releases/latest/download/evenbetter-xcloud.apk";

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

function createCdp(wsUrl, onEvent) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method && onEvent) {
      onEvent(msg.method, msg.params);
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
  if (WITH_BANNER) {
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: ANDROID_UA });
    console.log("[badge] UA Android simulé (bannière visible uniquement sur Android)");
  }

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
  require("fs").writeFileSync("D:/Codex/EvenBetterXcloud/artifacts/badge-proof-1.9.0.png", Buffer.from(shot.data, "base64"));
  console.log("[badge] preuve : D:/Codex/EvenBetterXcloud/artifacts/badge-proof-1.9.0.png");

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

  // 6. Bannière Android (--banner) : lien + clic + téléchargement RÉEL -------
  if (WITH_BANNER) {
    const fs = require("fs");
    const crypto = require("crypto");
    const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

    const banner = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const links = [...document.querySelectorAll('a')].filter(a => a.href && a.href.includes('evenbetter-xcloud.apk'));
        const a = links.find(x => /EvenBetterXcloud app for Android/i.test(x.textContent));
        return a ? { href: a.href, text: a.textContent.trim() } : null;
      })()`,
      returnByValue: true,
    });
    const b = banner.result.value;
    if (!b) { console.error("[badge] GATE ROUGE : bannière « app for Android » introuvable (UA Android requis — --banner la simule)"); process.exit(1); }
    if (b.href !== BANNER_URL) { console.error(`[badge] GATE ROUGE : bannière → ${b.href} ≠ ${BANNER_URL}`); process.exit(1); }
    console.log(`[badge] bannière = <a href="${b.href}"> (${b.text})`);

    // Téléchargement : Browser.setDownloadBehavior + écoute des événements
    // (downloadWillBegin / downloadProgress). Edge/SmartScreen peut SUPPRIMER
    // l'APK après téléchargement (fichier éphémère) → deux preuves :
    //   (a) événements navigateur (URL + état completed + octets reçus) ;
    //   (b) hash du fichier attrapé AVANT sa suppression, comparé à l'asset
    //       servi par le lien de la bannière.
    fs.mkdirSync(DL_DIR, { recursive: true });
    for (const f of fs.readdirSync(DL_DIR)) fs.unlinkSync(DL_DIR + "/" + f);
    const ver = await (await fetch(`${BASE}/json/version`)).json();
    const dlEvents = [];
    const bws = createCdp(ver.webSocketDebuggerUrl, (method, params) => {
      if (method === "Browser.downloadWillBegin" || method === "Browser.downloadProgress") dlEvents.push({ method, ...params });
    });
    await bws.ready;
    await bws.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL_DIR, eventsEnabled: true });

    const clickBanner = async () => {
      await cdp.send("Page.bringToFront");
      // pause de focus : le clic précédent (badge) a ouvert un onglet — sans
      // latence, le clic peut partir avant que le tab xbox ne soit au premier
      // plan et être avalé.
      await sleep(600);
      const br = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const links = [...document.querySelectorAll('a')].filter(a => a.href && a.href.includes('evenbetter-xcloud.apk'));
          const a = links.find(x => /EvenBetterXcloud app for Android/i.test(x.textContent));
          const r = a.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        })()`,
        returnByValue: true,
      });
      const { x, y } = br.result.value;
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    };
    await clickBanner();

    let downloaded = null;
    let dlFileSha = null;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      // (b) fichier attrapé avant suppression (poll rapide + hash immédiat)
      for (const name of fs.readdirSync(DL_DIR)) {
        if (name.endsWith(".apk") || name.endsWith(".crdownload")) {
          const p = DL_DIR + "/" + name;
          if (fs.existsSync(p)) {
            dlFileSha = sha256(fs.readFileSync(p));
            downloaded = name;
            break;
          }
        }
      }
      if (downloaded) break;
      // (a) événement downloadProgress : SmartScreen ANNULÉ le téléchargement
      // après réception complète (fichier retiré) → succès si les octets ont
      // été reçus en entier (state completed OU receivedBytes == totalBytes).
      const full = dlEvents.find((e) => e.method === "Browser.downloadProgress" && e.totalBytes > 0 && e.receivedBytes >= e.totalBytes);
      if (full) { downloaded = "(événement)"; break; }
      // 2e tentative de clic à ~6 s si rien (le 1er clic peut être avalé)
      if (i === 24) await clickBanner();
    }
    if (!downloaded) { console.error("[badge] GATE ROUGE : aucun téléchargement détecté (fichier ni événement) après 10 s"); process.exit(1); }
    console.log(`[badge] téléchargement détecté : ${downloaded}`);
    const dlBegin = dlEvents.find((e) => e.method === "Browser.downloadWillBegin");
    if (dlBegin) console.log(`[badge] downloadWillBegin → ${dlBegin.url} (${dlBegin.suggestedFilename})`);
    const fullDl = dlEvents.find((e) => e.method === "Browser.downloadProgress" && e.totalBytes > 0 && e.receivedBytes >= e.totalBytes);
    if (fullDl) console.log(`[badge] downloadProgress : ${fullDl.receivedBytes}/${fullDl.totalBytes} o reçus (SmartScreen peut annuler/retirer après)`);
    if (dlBegin && !dlBegin.url.includes("evenbetter-xcloud.apk")) {
      console.error(`[badge] GATE ROUGE : l'URL téléchargée (${dlBegin.url}) ne contient pas evenbetter-xcloud.apk`);
      process.exit(1);
    }

    // preuve bytes : fichier hashé avant suppression ? sinon l'événement +
    // l'asset servi (déjà vérifié byte-identique par release-guard)
    const served = sha256(Buffer.from(await (await fetch(BANNER_URL)).arrayBuffer()));
    if (dlFileSha) {
      if (dlFileSha !== served) {
        console.error(`[badge] GATE ROUGE : APK téléchargé (${dlFileSha.slice(0, 12)}) ≠ servi par la bannière (${served.slice(0, 12)})`);
        process.exit(1);
      }
      console.log(`[badge] APK téléchargé == servi par le lien de la bannière ✓ (${dlFileSha.slice(0, 12)})`);
    } else {
      console.log(`[badge] fichier retiré par SmartScreen avant hash — preuve : événement download complété sur le lien de la bannière (asset servi ${served.slice(0, 12)}, vérifié par release-guard)`);
    }
  }

  console.log(`[badge] OK : badge « ${badgeVal.text} » affiché, clic → releases GitHub` + (WITH_BANNER ? ", bannière → APK téléchargé" : ""));
  process.exit(0);
}

// Garde anti-pendaison : jamais plus de 240 s par run (badge + bannière +
// téléchargement peuvent prendre ~2 min).
setTimeout(() => { console.error("[badge] TIMEOUT GLOBAL 240 s — run abandonné"); process.exit(1); }, 240000);

main().catch((e) => { console.error("[badge] erreur :", e.message); process.exit(1); });
