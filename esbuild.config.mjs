/**
 * esbuild.config.mjs — flags de build partagés (source unique).
 *
 * Consommé par bench/es2017-build.mjs (transpilation ES2017 des bundles).
 * `node esbuild.config.mjs --check` valide les payloads src/features/* :
 *   - chaque module s'évalue (require CJS via createRequire) ;
 *   - chaque IMPL se parse avec le même parser esbuild que le build ;
 *   - aucun \r dans les payloads (déterminisme LF inter-plateformes :
 *     un CRLF résiduel changerait les bytes injectés selon l'OS).
 *
 * Usage : node esbuild.config.mjs --check
 */
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { transformSync } from "esbuild";

export const es2017BuildOptions = {
  target: "es2017",
  legalComments: "none",
};

export const SRC_FEATURES = [
  "sound",
  "datasaver",
  "latency",
  "region",
  "session-import",
  "diag-purge",
];

// Fixes amont (paires from → to) — même contrôle de pureté LF/parse.
// ORDRE D'APPLICATION : settings-freeze puis settings-bus (le second réécrit le
// contenu de 2 paires du premier ; bench/fix-settings-bus.js refuse l'inverse).
export const SRC_FIXES = ["settings-freeze", "settings-bus"];

if (process.argv.includes("--check")) {
  const require = createRequire(import.meta.url);
  let fails = 0;
  console.log("== check src/features (esbuild parser + pureté LF) ==");
  for (const name of SRC_FEATURES) {
    const mod = require(`./src/features/${name}.js`);
    const keys = Object.keys(mod);
    if (!keys.includes("IMPL") || typeof mod.IMPL !== "string" || mod.IMPL.length === 0) {
      fails++;
      console.error(`  ❌ ${name} : export IMPL manquant/vide`);
      continue;
    }
    if (mod.IMPL.includes("\r")) {
      fails++;
      console.error(`  ❌ ${name} : \\r dans IMPL (checkout CRLF ? .gitattributes eol=lf requis)`);
      continue;
    }
    try {
      transformSync(mod.IMPL, { loader: "js", ...es2017BuildOptions, minify: false });
      console.log(`  ✅ ${name} (${mod.IMPL.length} car., ${keys.length} exports: ${keys.join(", ")})`);
    } catch (e) {
      fails++;
      console.error(`  ❌ ${name} : parse esbuild échoué — ${e.message}`);
    }
  }
  // Tous les modules attendus existent sur disque (oubli d'ajout à SRC_FEATURES sinon).
  const onDisk = readdirSync(new URL("./src/features/", import.meta.url)).filter((f) => f.endsWith(".js"));
  for (const f of onDisk) {
    if (!SRC_FEATURES.includes(f.replace(/\.js$/, ""))) {
      fails++;
      console.error(`  ❌ ${f} : présent sur disque mais absent de SRC_FEATURES`);
    }
  }

  // src/fixes/* : payloads de REMPLACEMENT (paires from → to). Mêmes garanties
  // de pureté LF que src/features/*, mais PAS de parse esbuild isolé : une paire
  // est un FRAGMENT de contexte (elle ferme des structures ouvertes par le
  // bundle — `…}}]}` clôt l'item, le tableau d'items et le groupe), donc
  // l'extraire ne se parse pas seul. La validité structurelle est prouvée plus
  // loin dans la chaîne : le `new Function(...)` sur le bundle ENTIER après
  // application (bench/fix-settings-freeze.js) et les gates dédiées.
  console.log("== check src/fixes (esbuild parser + pureté LF) ==");
  for (const name of SRC_FIXES) {
    const mod = require(`./src/fixes/${name}.js`);
    const pairs = Array.isArray(mod.PAIRS) ? mod.PAIRS : [];
    if (pairs.length === 0) {
      fails++;
      console.error(`  ❌ ${name} : export PAIRS manquant/vide`);
      continue;
    }
    let ko = 0;
    for (const p of pairs) {
      const label = p && p.name ? p.name : "(paire sans nom)";
      if (!p || typeof p.from !== "string" || typeof p.to !== "string" || p.from.length === 0 || p.to.length === 0) {
        ko++;
        console.error(`  ❌ ${name} : ${label} — from/to manquant ou vide`);
        continue;
      }
      if (p.from.includes("\r") || p.to.includes("\r")) {
        ko++;
        console.error(`  ❌ ${name} : ${label} — \\r présent (.gitattributes eol=lf requis)`);
        continue;
      }
      // from ≠ to (une paire identité serait un no-op silencieux : gate morte).
      if (p.from === p.to) {
        ko++;
        console.error(`  ❌ ${name} : ${label} — from et to identiques (paire inutile)`);
      }
    }
    if (ko === 0) console.log(`  ✅ ${name} (${pairs.length} paires)`);
    else fails += ko;
  }
  const onDiskFixes = readdirSync(new URL("./src/fixes/", import.meta.url)).filter((f) => f.endsWith(".js"));
  for (const f of onDiskFixes) {
    if (!SRC_FIXES.includes(f.replace(/\.js$/, ""))) {
      fails++;
      console.error(`  ❌ src/fixes/${f} : présent sur disque mais absent de SRC_FIXES`);
    }
  }
  console.log(fails === 0 ? "✅ GATE VERT — src/features valides" : `❌ GATE ROUGE : ${fails} échec(s)`);
  process.exit(fails === 0 ? 0 : 1);
}
