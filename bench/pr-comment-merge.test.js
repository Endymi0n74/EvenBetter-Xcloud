"use strict";

/**
 * Tests de bench/pr-comment-merge.js — fusion des sections du commentaire PR
 * unique (hot loops, startup, GPU).
 *
 * Lancement : node bench/pr-comment-merge.test.js   (exit 0 = tout passe)
 *
 * Cas couverts : basiques (création/update de chaque mode), permutations
 * d'ordre de mise à jour, idempotence, édition manuelle (réordonnancement,
 * doublons de markers, MAIN manquant, MAIN avant section, contenu après
 * MAIN), sections vides (purge), modes inconnus, CRLF, whitespace, parse
 * direct.
 */
const assert = require("assert");
const { mergeComment, parse, MAIN } = require("./pr-comment-merge.js");

const SM = "<!-- bench-startup -->";
const GM = "<!-- bench-gpu -->";

let n = 0;
let fails = 0;
function t(name, fn) {
  n++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fails++;
    console.error(`  ✗ ${name}\n    ${String(e.message).split("\n").join("\n    ")}`);
  }
}

const H = "HOT";
const S = "START";
const G = "GPU";

// Résultat canonique attendu d'un commentaire complet à 3 sections.
const FULL = `${H}\n\n${SM}\n${S}\n\n${GM}\n${G}\n${MAIN}`;

console.log("=== basiques ===");
t("création hotloops seul", () => {
  assert.strictEqual(mergeComment("", "hotloops", H), `${H}\n${MAIN}`);
});
t("création startup seul", () => {
  assert.strictEqual(mergeComment("", "startup", S), `${SM}\n${S}\n${MAIN}`);
});
t("création gpu seul", () => {
  assert.strictEqual(mergeComment("", "gpu", G), `${GM}\n${G}\n${MAIN}`);
});
t("startup sur hot existant", () => {
  assert.strictEqual(mergeComment(`${H}\n${MAIN}`, "startup", S), `${H}\n\n${SM}\n${S}\n${MAIN}`);
});
t("gpu sur hot+startup", () => {
  const body = mergeComment(mergeComment("", "hotloops", H), "startup", S);
  assert.strictEqual(mergeComment(body, "gpu", G), FULL);
});
t("hot remplacé en préservant les autres", () => {
  const body = mergeComment(mergeComment(mergeComment("", "hotloops", H), "startup", S), "gpu", G);
  const out = mergeComment(body, "hotloops", "HOT2");
  assert.strictEqual(out, `HOT2\n\n${SM}\n${S}\n\n${GM}\n${G}\n${MAIN}`);
  // l'ancien hot (« HOT » seul, suivi d'un saut de section) a disparu
  assert.ok(!out.includes(`${H}\n`), "ancien hot disparu");
});

console.log("=== permutations d'ordre de mise à jour ===");
const orders = [
  ["hotloops", "startup", "gpu"],
  ["hotloops", "gpu", "startup"],
  ["startup", "hotloops", "gpu"],
  ["startup", "gpu", "hotloops"],
  ["gpu", "hotloops", "startup"],
  ["gpu", "startup", "hotloops"],
];
for (const ord of orders) {
  t(`ordre ${ord.join(" → ")} = commentaire canonique`, () => {
    let body = "";
    for (const m of ord) body = mergeComment(body, m, { hotloops: H, startup: S, gpu: G }[m]);
    assert.strictEqual(body, FULL);
  });
}
t("idempotence : re-merger la même section ne change rien", () => {
  const body = mergeComment(FULL, "gpu", G);
  assert.strictEqual(body, FULL);
});

console.log("=== édition manuelle / body non canonique ===");
t("sections réordonnées (gpu avant startup) : aucune perte", () => {
  const reordered = `${H}\n\n${GM}\n${G}\n\n${SM}\n${S}\n${MAIN}`;
  const out = mergeComment(reordered, "hotloops", H);
  assert.strictEqual(out, FULL);
});
t("marker dupliqué (gpu x2) : la dernière occurrence gagne", () => {
  const dup = `${H}\n\n${SM}\n${S}\n\n${GM}\n${G}\n\n${GM}\n${G}-2\n${MAIN}`;
  const out = mergeComment(dup, "hotloops", H);
  assert.strictEqual(out, `${H}\n\n${SM}\n${S}\n\n${GM}\n${G}-2\n${MAIN}`);
});
t("MAIN manquant (adoption d'un commentaire legacy)", () => {
  const legacy = `${H}\n\n${SM}\n${S}`;
  const out = mergeComment(legacy, "gpu", G);
  assert.strictEqual(out, FULL);
});
t("commentaire sans aucun marker → adopté puis MAIN ajouté", () => {
  const out = mergeComment("texte libre", "startup", S);
  assert.strictEqual(out, `texte libre\n\n${SM}\n${S}\n${MAIN}`);
});
t("MAIN avant une section : la queue non canonique est ignorée", () => {
  const weird = `${H}\n${MAIN}\n\n${SM}\n${S}`;
  const out = mergeComment(weird, "gpu", G);
  assert.strictEqual(out, `${H}\n\n${GM}\n${G}\n${MAIN}`);
});
t("contenu après MAIN ignoré", () => {
  const trailing = `${H}\n\n${SM}\n${S}\n${MAIN}\n\njunk de fin`;
  const out = mergeComment(trailing, "gpu", G);
  assert.strictEqual(out, FULL);
  assert.ok(!out.includes("junk"));
});
t("marker présent mais contenu vide : purgé au merge suivant", () => {
  const emptySec = `${H}\n\n${SM}\n${MAIN}`;
  const out = mergeComment(emptySec, "gpu", G);
  assert.strictEqual(out, `${H}\n\n${GM}\n${G}\n${MAIN}`);
});
t("texte ressemblant à un marker (sans la syntaxe commentaire) : intact", () => {
  // « bench-gpu » et « bench-startup » en clair dans le contenu ne sont PAS
  // des markers — seuls les commentaires HTML exacts découpent.
  const near = `${H}\n\n${SM}\n${S} (label bench-gpu, marker bench-startup)\n${MAIN}`;
  const out = mergeComment(near, "gpu", G);
  assert.strictEqual(out, `${H}\n\n${SM}\n${S} (label bench-gpu, marker bench-startup)\n\n${GM}\n${G}\n${MAIN}`);
});
t("contenu contenant le marker EXACT : limitation documentée (dernière occurrence gagne)", () => {
  // Un résumé qui embarquerait un marker exact fausse le découpage : la
  // dernière occurrence gagne → contenu tronqué. On teste le comportement
  // réel pour le figer, la doc du module interdit cette pratique.
  const contaminated = `${H}\n\n${SM}\n${S}\n${SM}\n${MAIN}`;
  const out = mergeComment(contaminated, "gpu", G);
  assert.strictEqual(out, `${H}\n\n${GM}\n${G}\n${MAIN}`);
});

console.log("=== sections vides / purge ===");
t("publier une section vide supprime la section existante", () => {
  const body = mergeComment(FULL, "gpu", "");
  assert.strictEqual(body, `${H}\n\n${SM}\n${S}\n${MAIN}`);
  const body2 = mergeComment(body, "startup", "   ");
  assert.strictEqual(body2, `${H}\n${MAIN}`);
});
t("publier hotloops vide retire le hot (MAIN seul si rien d'autre)", () => {
  assert.strictEqual(mergeComment(FULL, "hotloops", ""), `${SM}\n${S}\n\n${GM}\n${G}\n${MAIN}`);
  assert.strictEqual(mergeComment("", "hotloops", ""), MAIN);
  assert.strictEqual(mergeComment("", "startup", ""), MAIN);
  assert.strictEqual(mergeComment("", "gpu", ""), MAIN);
});

console.log("=== modes inconnus / types ===");
t("mode inconnu → throw", () => {
  assert.throws(() => mergeComment(FULL, "bogus", "x"), /mode inconnu/);
  assert.throws(() => mergeComment(FULL, "hot", "x"), /mode inconnu/);
});

console.log("=== robustesse du body ===");
t("body CRLF (copie manuelle) : normalisé en LF au merge", () => {
  const crlf = `${H}\r\n\r\n${SM}\r\n${S}\r\n\r\n${MAIN}`;
  const out = mergeComment(crlf, "gpu", G);
  assert.strictEqual(out, FULL);
});
t("whitespace autour des sections : trimé", () => {
  const out = mergeComment(`${H}\n\n${SM}\n\n  ${S}  \n${MAIN}`, "gpu", "\n  " + G + "  \n");
  assert.strictEqual(out, FULL);
});
t("body null/undefined → traité comme vide", () => {
  assert.strictEqual(mergeComment(null, "gpu", G), `${GM}\n${G}\n${MAIN}`);
  assert.strictEqual(mergeComment(undefined, "startup", S), `${SM}\n${S}\n${MAIN}`);
});

console.log("=== parse direct ===");
t("parse('') → hot vide, aucune section", () => {
  const p = parse("");
  assert.strictEqual(p.hot, "");
  assert.deepStrictEqual(p.sections, []);
});
t("parse(commentaire complet) → hot + 2 sections ordre canonique", () => {
  const p = parse(FULL);
  assert.strictEqual(p.hot, H);
  assert.strictEqual(p.sections.length, 2);
  assert.strictEqual(p.sections[0].mode, "startup");
  assert.strictEqual(p.sections[0].content, S);
  assert.strictEqual(p.sections[1].mode, "gpu");
  assert.strictEqual(p.sections[1].content, G);
});
t("parse(body réordonné) → sections retrouvées, ordre canonique", () => {
  const p = parse(`${H}\n\n${GM}\n${G}\n\n${SM}\n${S}\n${MAIN}`);
  assert.strictEqual(p.hot, H);
  assert.strictEqual(p.sections.length, 2);
  assert.strictEqual(p.sections[0].mode, "startup");
  assert.strictEqual(p.sections[1].mode, "gpu");
});

console.log(`\n${n - fails}/${n} tests PASS${fails ? `, ${fails} ÉCHEC(S)` : ""}`);
process.exit(fails ? 1 : 0);
