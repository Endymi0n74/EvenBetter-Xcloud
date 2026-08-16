"use strict";

/**
 * Fusion des sections du commentaire PR unique des benchs (hot loops,
 * startup, GPU) — source unique utilisée par les steps github-script des
 * jobs hotloops-ratios / startup-cold / gpu-upload du workflow bench.yml.
 *
 * Layout canonique du commentaire :
 *   [contenu hot loops]
 *   <!-- bench-startup -->
 *   [contenu startup]
 *   <!-- bench-gpu -->
 *   [contenu GPU]
 *   <!-- bench-ratios -->      <- marker de fin (identifie le commentaire)
 *
 * Chaque job met à jour SA section (contenu neuf après SON marker) en
 * préservant les autres. La fonction est pure (pas d'API GitHub) : testable
 * localement avec node (bench/pr-comment-merge.test.js).
 *
 * Robustesse — cas limites couverts (cf. tests) :
 *   - l'ordre PHYSIQUE des markers n'importe pas : les sections sont
 *     collectées par position, pas dans l'ordre canonique — une section
 *     réordonnée à la main n'est pas perdue ;
 *   - un marker dupliqué (édition manuelle, double post) : la DERNIÈRE
 *     occurrence gagne (self-healing, retour au layout canonique) ;
 *   - tout ce qui suit `<!-- bench-ratios -->` est ignoré (MAIN est la fin
 *     canonique) ; un commentaire sans marker est adopté : son contenu
 *     devient la section hot loops ;
 *   - une section publiée VIDE supprime la section existante (purge des
 *     données périmées — ex. protocole GPU relancé sans label) ;
 *   - un `mode` inconnu lève une erreur (défaut de programmation : échoue le
 *     step CI au lieu de perdre silencieusement le contenu) ;
 *   - limitation inhérente au parsing par markers : si le CONTENU d'une
 *     section contient lui-même un marker de section exact (ex.
 *     `<!-- bench-gpu -->` dans le résumé GPU), le découpage est faussé —
 *     ne jamais inclure de marker dans un résumé.
 *
 * Usage :
 *   const { mergeComment } = require('./bench/pr-comment-merge.js');
 *   const newBody = mergeComment(existingBody, 'startup', sectionMarkdown);
 */
const MAIN = "<!-- bench-ratios -->";

// Ordre canonique des sections (hot loops = contenu de tête, sans marker).
const SECTIONS = [
  { mode: "startup", marker: "<!-- bench-startup -->" },
  { mode: "gpu", marker: "<!-- bench-gpu -->" },
];

const MODES = ["hotloops", ...SECTIONS.map((s) => s.mode)];

/**
 * Découpe un body existant : contenu hot loops + sections trouvées
 * (marker + contenu). Indépendant de l'ordre physique des markers.
 * @param {string} body
 * @returns {{hot: string, sections: Array<{mode: string, marker: string, content: string}>}}
 */
function parse(body) {
  const b = body || "";
  const res = { hot: "", sections: [] };

  // Tous les markers (MAIN + sections), triés par position.
  const events = [];
  const mainIdx = b.indexOf(MAIN);
  if (mainIdx !== -1) events.push({ pos: mainIdx, kind: "main", marker: MAIN, mode: null });
  for (const s of SECTIONS) {
    // TOUTES les occurrences (un marker dupliqué par édition manuelle ou
    // double post doit être collecté — la dernière gagne au découpage).
    let i = -1;
    while ((i = b.indexOf(s.marker, i + 1)) !== -1) {
      events.push({ pos: i, kind: "section", marker: s.marker, mode: s.mode });
    }
  }
  events.sort((a, z) => a.pos - z.pos);

  // Contenu hot loops : tout ce qui précède le 1er marker.
  res.hot = b.slice(0, events.length ? events[0].pos : b.length).trim();

  // Segments entre markers consécutifs : chaque section = contenu entre SON
  // marker et le marker suivant (n'importe lequel). Doublon : la dernière
  // occurrence gagne. Tout ce qui suit MAIN est non canonique → ignoré.
  const byMode = new Map();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.kind === "main") break;
    const end = i + 1 < events.length ? events[i + 1].pos : b.length;
    byMode.set(ev.mode, b.slice(ev.pos + ev.marker.length, end).trim());
  }
  for (const s of SECTIONS) {
    if (byMode.has(s.mode)) {
      res.sections.push({ mode: s.mode, marker: s.marker, content: byMode.get(s.mode) });
    }
  }
  return res;
}

/**
 * Reconstruit le commentaire avec la section `mode` fraîchement fournie.
 * @param {string} body  body existant ('' si aucun commentaire)
 * @param {string} mode  'hotloops' | 'startup' | 'gpu'
 * @param {string} section  contenu markdown de la section à publier
 * @throws si `mode` est inconnu
 */
function mergeComment(body, mode, section) {
  if (!MODES.includes(mode)) {
    throw new Error(`mergeComment : mode inconnu « ${mode} » (attendu : ${MODES.join(", ")})`);
  }
  const p = parse(body);
  const fresh = section.trim();
  const parts = [];
  parts.push(mode === "hotloops" ? fresh : p.hot);
  for (const s of SECTIONS) {
    const existing = p.sections.find((x) => x.mode === s.mode);
    if (s.mode === mode) {
      if (fresh) parts.push(s.marker + "\n" + fresh);
    } else if (existing && existing.content) {
      parts.push(existing.marker + "\n" + existing.content);
    }
  }
  const joined = parts.filter((x) => x !== "").join("\n\n");
  return (joined ? joined + "\n" : "") + MAIN;
}

module.exports = { mergeComment, parse, MAIN, SECTIONS };
