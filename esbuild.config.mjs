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
  console.log(fails === 0 ? "✅ GATE VERT — src/features valides" : `❌ GATE ROUGE : ${fails} échec(s)`);
  process.exit(fails === 0 ? 0 : 1);
}
