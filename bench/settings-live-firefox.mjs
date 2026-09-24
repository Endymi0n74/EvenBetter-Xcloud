#!/usr/bin/env node
/**
 * bench/settings-live-firefox.mjs — le slider de volume dans les VRAIS settings,
 * sous Firefox réel (dialogue monté par le bundle, aucune doublure).
 *
 * Les bancs unitaires (feature-sound, settings-bus, fix-settings-*) prouvent que
 * le code est ÉCRIT comme voulu ; ils ne prouvent pas ce qu'un vrai navigateur
 * fait du vrai dialog. Cette sonde monte le dialog DU BUNDLE et rejoue le geste
 * utilisateur : ouvrir les settings par le bouton d'en-tête réel, cocher /
 * décocher « Enable volume control feature », et regarder l'état du contrôle de
 * volume (`audio.volume`) après chaque clic.
 *
 * Ce qu'on entend par « le slider se dégrise » : le contrôle devient UTILISABLE
 * — un `input[type=range]` vivant (`disabled === false`), pas seulement un nœud
 * rebaptisé. Le contrôle est un `BxNumberStepper` : `div#bx_setting_audio-volume`
 * avec deux boutons et, quand il est vivant, le range créé par
 * BxNumberStepper.create. D'où la mesure `usable = hasRange && !rangeDisabled`.
 *
 * Deux scénarios, parce que le contrôle est mis en cache par pref
 * (SettingsManager.SETTINGS[pref].$element) et n'est construit qu'une fois :
 *   A. booster ÉTEINT à l'ouverture (défaut utilisateur) → le cocher doit
 *      dégriser le volume EN DIRECT, le décocher doit le re-griser ;
 *   B. booster ALLUMÉ avant l'ouverture → contrôle vivant d'emblée, on vérifie
 *      l'aller-retour (extinction puis réactivation).
 * Le scénario B sert aussi de témoin : si A échoue et B passe, le mécanisme
 * « setting.changed » fonctionne, c'est la CONSTRUCTION du contrôle qui bloque.
 *
 * Pourquoi une page locale au lieu de xbox.com : la garde du bundle ne teste que
 * `location.pathname` (`/play`). Servir la page sur http://127.0.0.1/play laisse
 * donc le bundle s'exécuter VERBATIM (@run-at document-start via addInitScript) :
 * aucune garde neutralisée, aucun bundle patché. Le reste est le chemin réel :
 *   BxEventBus.Script.emit("ui.header.rendered")  → HeaderSection.checkHeader()
 *   BxEventBus.Script.emit("xcloud.server", …)    → bouton plus grisé
 *   .bx-header-settings-button.click()            → SettingsDialog.show()
 *   #bx_setting_audio-volume-booster-enabled.click() → setGlobalPref(…, "ui")
 *
 * Usage :
 *   node bench/settings-live-firefox.mjs [--bundle <ref git|chemin>] [--visible]
 *                                        [--dump] [--port N]
 *   --dump  imprime le HTML du contrôle de volume avant/après chaque clic
 *
 * Prérequis : Playwright + Firefox (comme bench/sound-engine-firefox.mjs). Ce
 * banc n'est pas câblé dans bench.yml : le CI ne télécharge pas de Firefox.
 */
import { firefox } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const ARGS = process.argv.slice(2);
const flag = (name) => ARGS.includes(name);
const opt = (name, dflt) => {
  const i = ARGS.indexOf(name);
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : dflt;
};

const HEADLESS = !flag("--visible");
const DUMP = flag("--dump");
const BUNDLE_ARG = opt("--bundle", null);
const PORT = Number(opt("--port", 4521));

const HERE = path.dirname(decodeURI(new URL(import.meta.url).pathname)).replace(/^\/(\w):/, "$1:");
const REPO = path.resolve(HERE, "..");

// ---- bundle sous test (source de vérité : le fichier, pas une copie) -------
let bundle;
let bundleLabel;
if (BUNDLE_ARG && fs.existsSync(BUNDLE_ARG)) {
  bundle = fs.readFileSync(BUNDLE_ARG, "utf8");
  bundleLabel = path.basename(BUNDLE_ARG);
} else if (BUNDLE_ARG) {
  bundle = execSync(`git show ${BUNDLE_ARG}:better-xcloud.user.js`, { cwd: REPO, maxBuffer: 64e6 }).toString();
  bundleLabel = `${BUNDLE_ARG}:better-xcloud.user.js`;
} else {
  const file = path.join(REPO, "better-xcloud.user.js");
  bundle = fs.readFileSync(file, "utf8");
  bundleLabel = path.basename(file);
}
bundle = bundle.replace(/\r\n/g, "\n");
const version = (bundle.match(/@version\s+([\w.-]+)/) || [, "?"])[1];
console.log(`[bundle] ${bundleLabel} — v${version} (${bundle.length} o)`);
if (!bundle.includes("window.BX_SOUND_ENGINE = {")) {
  console.log("[bundle] moteur son absent → bundle AMONT (correctifs non appliqués)");
}

// ---- hôte : ce que le bundle attend de la page (pathname /play + en-tête) --
const HOST = `<!doctype html><html><head><meta charset="utf-8">
<meta name="gamepass-app-version" content="probe"><meta name="gamepass-app-date" content="2026-09-24">
<title>xCloud</title></head><body>
<div id="gamepass-root">
  <header class="Header-module__header">
    <div class="EdgewaterHeader-module__rightSectionSpacing"></div>
  </header>
</div>
<main></main>
</body></html>`;

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(HOST);
});
await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));

const browser = await firefox.launch({ headless: HEADLESS });
let fails = 0;
const step = (label, ok, extra) => {
  console.log((ok ? "  ✅ " : "  ❌ ") + label + (extra ? " :: " + extra : ""));
  if (!ok) fails++;
};

const SEL_BOOSTER = "#bx_setting_audio-volume-booster-enabled";

/**
 * Un scénario = un contexte neuf (le contrôle volume est mis en cache par pref,
 * donc un seul état de départ par page) avec `preset` écrit dans
 * localStorage["BetterXcloud"] AVANT que le bundle ne lise ses prefs.
 */
async function scenario(name, preset) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((seed) => {
    window.localStorage.setItem("BetterXcloud", JSON.stringify(seed));
  }, preset);
  await ctx.addInitScript({ content: bundle });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err).split("\n")[0].slice(0, 200)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("console: " + msg.text().slice(0, 200));
  });
  await page.goto(`http://127.0.0.1:${PORT}/play`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.BX_EXPOSED, null, { timeout: 20000 });

  // helpers in-page : un seul jeu de lectures, réutilisé par toutes les phases
  await page.evaluate(() => {
    window.__bxProbe = {
      sectionTitle($row) {
        let $node = $row;
        while ($node && $node.previousElementSibling) {
          $node = $node.previousElementSibling;
          if ($node.tagName === "H2") return $node.textContent.trim();
        }
        return null;
      },
      state() {
        const $control = document.querySelector("#bx_setting_audio-volume");
        const $range = $control ? $control.querySelector("input[type=range]") : null;
        const $buttons = $control ? Array.from($control.querySelectorAll("button")) : [];
        const $row = $control ? $control.closest("label.bx-settings-row") : null;
        const $host = $row ? $row.closest("div[data-tab-group]") : null;
        const $check = document.querySelector("#bx_setting_audio-volume-booster-enabled");
        const $checkRow = $check ? $check.closest("label.bx-settings-row") : null;
        const $dialog = document.querySelector(".bx-navigation-dialog");
        const $reload = document.querySelector(".bx-settings-reload-button");
        return {
          dialog: !!document.querySelector(".bx-settings-dialog"),
          dialogVisible: !!$dialog && !$dialog.classList.contains("bx-gone"),
          tabs: document.querySelectorAll(".bx-settings-tabs svg").length,
          rows: document.querySelectorAll(".bx-settings-row").length,
          activeTab: document.querySelector(".bx-settings-tab-content > div[data-tab-group]:not(.bx-gone)")?.dataset.tabGroup ?? null,
          // le contrôle de volume
          controlInDialog: !!$control && !!document.querySelector(".bx-settings-dialog")?.contains($control),
          controlSection: $row ? this.sectionTitle($row) : null,
          controlHostTab: $host ? $host.dataset.tabGroup : null,
          hasRange: !!$range,
          rangeDisabled: $range ? $range.disabled : null,
          rangeValue: $range ? $range.value : null,
          buttonsDisabled: $buttons.length ? $buttons.some((b) => b.disabled) : null,
          text: $control ? ($control.querySelector("span")?.textContent ?? null) : null,
          usable: !!$range && $range.disabled === false,
          // le booster
          boosterChecked: $check ? $check.checked : null,
          boosterInDialog: !!$check && !!document.querySelector(".bx-settings-dialog")?.contains($check),
          boosterSection: $checkRow ? this.sectionTitle($checkRow) : null,
          reloadButtonVisible: $reload ? !$reload.classList.contains("bx-gone") : null,
          storedBooster: JSON.parse(window.localStorage.getItem("BetterXcloud") || "{}")["audio.volume.booster.enabled"] ?? null,
        };
      },
      async clickBooster() {
        const $check = document.querySelector("#bx_setting_audio-volume-booster-enabled");
        $check.click();
        await new Promise((resolve) => setTimeout(resolve, 250));
        return window.__bxProbe.state();
      },
      dump() {
        const $control = document.querySelector("#bx_setting_audio-volume");
        const $row = $control ? $control.closest("label.bx-settings-row") : null;
        return ($row ? $row.outerHTML : "(contrôle absent)").slice(0, 1500);
      },
    };
  });

  const open = await page.evaluate(() => {
    const t0 = performance.now();
    window.BxEventBus.Script.emit("ui.header.rendered");
    window.BxEventBus.Script.emit("xcloud.server", { status: "ready" });
    const $btn = document.querySelector(".bx-header-settings-button");
    if ($btn) $btn.click();
    else SettingsDialog.getInstance().show();
    return { via: $btn ? "bouton d'en-tête réel" : "SettingsDialog.getInstance().show()", ms: Math.round(performance.now() - t0) };
  });
  await page.waitForTimeout(150);
  const initial = await page.evaluate(() => window.__bxProbe.state());
  console.log(`\n--- scénario ${name} (booster ${preset["audio.volume.booster.enabled"] ? "allumé" : "éteint"} à l'ouverture) ---`);
  console.log(
    `  [ouverture] ${open.via} → ${open.ms} ms · ${initial.tabs} onglets / ${initial.rows} rangées · onglet actif « ${initial.activeTab} »`,
  );
  console.log(
    `  [contrôle volume] rangée « ${initial.controlSection} » (onglet ${initial.controlHostTab}) · range=${initial.hasRange} disabled=${initial.rangeDisabled} boutons bloqués=${initial.buttonsDisabled} texte=${initial.text}`,
  );
  console.log(
    `  [booster] section « ${initial.boosterSection} » · coché=${initial.boosterChecked} · boutique reload visible=${initial.reloadButtonVisible}`,
  );
  if (DUMP) console.log("  [dump avant] " + (await page.evaluate(() => window.__bxProbe.dump())));

  const onClick = async (label) => {
    await page.locator(SEL_BOOSTER).click({ timeout: 5000 });
    await page.waitForTimeout(250);
    const s = await page.evaluate(() => window.__bxProbe.state());
    console.log(
      `  [clic ${label}] range=${s.hasRange} disabled=${s.rangeDisabled} boutons bloqués=${s.buttonsDisabled} texte=${s.text} · pref=${s.storedBooster} · utilisable=${s.usable}`,
    );
    if (DUMP) console.log("  [dump " + label + "] " + (await page.evaluate(() => window.__bxProbe.dump())));
    return s;
  };

  return { page, initial, onClick, errors, open };
}

try {
  const ff = await (async () => {
    const p = await browser.newPage();
    const ua = await p.evaluate(() => navigator.userAgent.match(/Firefox\/[\d.]+/)?.[0] || "?");
    await p.close();
    return ua;
  })();
  console.log(`\n=== Firefox ${ff} — ${bundleLabel} v${version} ===`);

  // ---- scénario A : le cas par défaut (booster éteint à l'ouverture) -------
  const A = await scenario("A", { "audio.volume.booster.enabled": false });
  step(
    "A1 · les settings réels s'ouvrent depuis le bouton d'en-tête",
    A.open.via.includes("bouton") && A.initial.dialog && A.initial.dialogVisible && A.initial.activeTab === "global",
    `${A.initial.tabs} onglets · ${A.initial.rows} rangées`,
  );
  step(
    "A2 · booster éteint : le contrôle de volume est présent mais inutilisable",
    A.initial.controlInDialog && A.initial.usable === false && A.initial.boosterChecked === false,
    `range=${A.initial.hasRange} disabled=${A.initial.rangeDisabled} texte=${A.initial.text}`,
  );
  const onA = await A.onClick("booster ON");
  step("A3 · le clic sur la vraie case écrit la pref (chemin UI)", onA.boosterChecked === true && onA.storedBooster === true, `pref=${onA.storedBooster}`);
  step(
    "A4 · cocher le booster DÉGRISE le volume en direct",
    onA.usable === true,
    `utilisable=${onA.usable} · range=${onA.hasRange} disabled=${onA.rangeDisabled} boutons bloqués=${onA.buttonsDisabled}`,
  );
  const offA = await A.onClick("booster OFF");
  step(
    "A5 · décocher le RE-GRISE et remet 100",
    offA.usable === false && offA.text === "100%",
    `utilisable=${offA.usable} · range=${offA.hasRange} disabled=${offA.rangeDisabled} texte=${offA.text}`,
  );
  if (onA.usable !== true) {
    console.log(
      `  ↳ le contrôle ${onA.hasRange ? "a un range" : "n'a AUCUN input[type=range]"} : BxNumberStepper.create sort en` +
        " early-return quand `options.disabled` est vrai (booster éteint) — le handler des settings ne peut alors" +
        " que réécrire une propriété JS sur le div (aucun effet), le contrôle reste mort jusqu'au rechargement.",
    );
  }

  // ---- scénario B : témoin — booster allumé avant l'ouverture --------------
  const B = await scenario("B", { "audio.volume.booster.enabled": true, "audio.volume": 100 });
  step(
    "B1 · booster allumé à l'ouverture : le contrôle est vivant d'emblée",
    B.initial.usable === true,
    `range=${B.initial.hasRange} disabled=${B.initial.rangeDisabled} boutons bloqués=${B.initial.buttonsDisabled}`,
  );
  const offB = await B.onClick("booster OFF");
  step("B2 · décocher grise le contrôle vivant", offB.usable === false && offB.text === "100%", `utilisable=${offB.usable} disabled=${offB.rangeDisabled} texte=${offB.text}`);
  const onB = await B.onClick("booster ON");
  step("B3 · recocher le dégrise en direct", onB.usable === true, `utilisable=${onB.usable} disabled=${onB.rangeDisabled}`);

  // ---- hygiène -------------------------------------------------------------
  const errors = [...A.errors, ...B.errors];
  step("C1 · aucune exception de page sur les deux scénarios", errors.length === 0, errors.length ? errors.join(" | ") : "0 erreur");
  if (errors.length) {
    console.log(
      "  ↳ l'exception vient de l'item `audio.volume` de l'onglet stream : contrairement à celui du groupe « Son »," +
        " son handler n'a pas de repli (`|| $elm`) et jette sur `$range.disabled` dès que le range manque" +
        " (sélecteur amont non fermé `\"input[type=range\"`, toléré par Firefox et Edge : c'est bien $range qui est null)." +
        " Une exception dans un listener coupe la boucle emit : les handlers abonnés après lui ne reçoivent plus l'événement.",
    );
  }

  console.log(fails === 0 ? "\n🎉 SETTINGS LIVE (Firefox réel) : TOUS LES CHECKS PASSENT" : `\n💥 ${fails} échec(s)`);
  process.exit(fails === 0 ? 0 : 1);
} catch (e) {
  console.error("ERREUR:", e.message);
  process.exit(1);
} finally {
  await browser.close();
  server.close();
}
