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
 * localement avec node.
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

/**
 * Découpe un body existant : contenu hot loops + sections trouvées
 * (marker + contenu, dans l'ordre canonique).
 */
function parse(body) {
  const b = body || "";
  const res = { hot: "", sections: [] };
  const mainIdx = b.indexOf(MAIN);
  const marks = SECTIONS.map((s) => ({ s, i: b.indexOf(s.marker) })).filter((x) => x.i !== -1);
  const first = marks.length ? marks.reduce((a, x) => (x.i < a.i ? x : a)) : null;
  const hotEnd = first ? first.i : mainIdx !== -1 ? mainIdx : b.length;
  res.hot = b.slice(0, hotEnd).trim();
  let pos = hotEnd;
  for (const s of SECTIONS) {
    const i = b.indexOf(s.marker, pos);
    if (i === -1) continue;
    const nexts = SECTIONS.filter((s2) => s2.marker !== s.marker)
      .map((s2) => b.indexOf(s2.marker, i))
      .filter((x) => x !== -1);
    let end = mainIdx !== -1 ? mainIdx : b.length;
    if (nexts.length) end = Math.min(end, ...nexts);
    res.sections.push({ mode: s.mode, marker: s.marker, content: b.slice(i + s.marker.length, end).trim() });
    pos = end;
  }
  return res;
}

/**
 * Reconstruit le commentaire avec la section `mode` fraîchement fournie.
 * @param {string} body  body existant ('' si aucun commentaire)
 * @param {string} mode  'hotloops' | 'startup' | 'gpu'
 * @param {string} section  contenu markdown de la section à publier
 */
function mergeComment(body, mode, section) {
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
