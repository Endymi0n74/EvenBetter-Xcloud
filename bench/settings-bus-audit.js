#!/usr/bin/env node
/*
 * settings-bus-audit.js — audit STATIQUE du contrat `setting.changed`.
 *
 * Le bundle route l'événement `setting.changed` selon la CLASSE de la pref :
 *
 *   Settings.setSetting(key, value, origin) {
 *     …
 *     if (origin === "ui")
 *       if (isStreamPref(key)) BxEventBus.Stream.emit("setting.changed", …)
 *       else                    BxEventBus.Script.emit("setting.changed", …)
 *   }
 *
 * Autrement dit : le bus **Stream** ne porte QUE les prefs de ALL_PREFS.stream ;
 * le bus **Script** porte tout le reste (prefs globales et clés hors référentiel).
 * Un listener qui s'abonne à Stream en filtrant une pref GLOBALE (ou l'inverse)
 * ne reçoit donc JAMAIS rien : le callback n'est pas mort, il est injoignable.
 *
 * L'audit reconstruit cette table sans exécuter le bundle :
 *   1. extrait ALL_PREFS.global / ALL_PREFS.stream ;
 *   2. vérifie que le contrat d'émission ci-dessus n'a pas dérivé (sinon
 *      l'analyse elle-même serait périmée → GATE ROUGE) ;
 *   3. énumère chaque `.on("setting.changed", <callback>)`, résout le callback
 *      (inline, ou `var onChange = function (…)` nommé) et en extrait les clés
 *      référencées (`settingKey === "x"`, `… !== "x"`, `[…].includes(settingKey)`,
 *      et le joker `isStreamPref(settingKey)`) ;
 *   4. regroupe les souscriptions qui visent LE MÊME callback : un même handler
 *      abonné aux deux bus est légitime (l'un des deux livre la clé) ; un
 *      callback dont AUCUN bus ne peut livrer une clé qu'il filtre est le bug.
 *
 * Usage :
 *   node bench/settings-bus-audit.js                # les 2 bundles du repo
 *   node bench/settings-bus-audit.js <bundle.js> [--json]
 *   node bench/settings-bus-audit.js <bundle.js> --quiet
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEFAULT_BUNDLES = ["better-xcloud.user.js", "better-xcloud-preview.user.js"];

// ---- Contrat d'émission (forme normalisée : espaces retirés) ----------------
// Si l'amont change ce routage, TOUT cet audit devient faux : on préfère un
// GATE ROUGE explicite à une conclusion silencieusement périmée.
const CONTRACT = [
  'if(isStreamPref(key))BxEventBus.Stream.emit("setting.changed",{storageKey:this.storageKey,settingKey:key});elseBxEventBus.Script.emit("setting.changed",{storageKey:this.storageKey,settingKey:key});',
];
const squeeze = (s) => s.replace(/\s+/g, "");

// ---- Petits utilitaires de lecture de texte JS (sans parser) ----------------
// NB : les littéraux gabarits `${…}` ne sont pas traités finement — les zones
// d'abonnement du bundle n'en contiennent pas (vérifié par le gate).
function skipString(text, i) {
  const q = text[i];
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === "\\") {
      j++;
      continue;
    }
    if (text[j] === q) return j;
  }
  return text.length - 1;
}

function findMatching(text, start, open = "(", close = ")") {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i);
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Corps (`{…}`) d'une valeur de fonction commençant à `start`, ou null.
function functionBody(text, start) {
  let i = start;
  if (text.startsWith("function", i)) {
    const brace = text.indexOf("{", i);
    if (brace < 0) return null;
    const end = findMatching(text, brace, "{", "}");
    return end < 0 ? null : text.slice(brace, end + 1);
  }
  // Forme fléchée : (args) => {…} ou args => {…} ou (args) => expr
  const paren = text.indexOf("(", i);
  if (paren === i) {
    const close = findMatching(text, paren);
    if (close < 0) return null;
    i = text.indexOf("=>", close);
  } else {
    i = text.indexOf("=>", i);
  }
  if (i < 0) return null;
  const after = text.indexOf("{", i);
  if (after < 0) return text.slice(i + 2, text.indexOf(";", i) + 1);
  const end = findMatching(text, after, "{", "}");
  return end < 0 ? null : text.slice(after, end + 1);
}

// Résout l'argument de `.on(event, ARG)` : callback inline (slice brut) ou nom
// de variable → définition `var/let/const NAME = …` la plus proche AVANT l'usage.
function resolveCallback(arg, text, pos) {
  const src = arg.trim();
  const named = /^([A-Za-z_$][\w$]*)$/.exec(src);
  if (!named) return { kind: "inline", src };
  const name = named[1];
  const re = new RegExp("\\b(?:var|let|const)\\s+" + name + "\\s*=\\s*", "g");
  let last = null;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index >= pos) break;
    last = m;
  }
  if (!last) return { kind: "unresolved", name };
  const body = functionBody(text, last.index + last[0].length);
  if (!body) return { kind: "unresolved", name };
  return { kind: "named", name, src: name + " = " + body };
}

// ---- Extraction des clés référencées par un callback -----------------------
function keysOf(src) {
  const keys = new Map(); // clé → forme rencontrée
  const keyExpr = "(?:settingKey|[A-Za-z_$][\\w$]*\\.settingKey)";
  let m;
  const cmp = new RegExp(keyExpr + '\\s*(?:===|!==|==|!=)\\s*"([^"]+)"', "g");
  while ((m = cmp.exec(src)) !== null) keys.set(m[1], "comparaison");
  const inc = new RegExp("\\[([^\\]]*)\\]\\.includes\\(\\s*" + keyExpr + "\\s*\\)", "g");
  while ((m = inc.exec(src)) !== null) {
    for (const lit of m[1].matchAll(/"([^"]+)"/g)) keys.set(lit[1], "includes");
  }
  const wildcardStream = new RegExp("(?<!!)\\bisStreamPref\\(\\s*" + keyExpr + "\\s*\\)").test(src);
  const wildcardNonStream = new RegExp("!\\s*isStreamPref\\(\\s*" + keyExpr + "\\s*\\)").test(src);
  return { keys: [...keys.keys()], wildcardStream, wildcardNonStream };
}

function prefsOf(text) {
  const m = /ALL_PREFS = \{global: new Set\(\[(.*?)\]\),stream: new Set\(\[(.*?)\]\)\}/s.exec(text);
  if (!m) return null;
  const lits = (s) => new Set([...s.matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  return { global: lits(m[1]), stream: lits(m[2]) };
}

// Le bus Script ne livre que les clés NON-stream (branche `else` du contrat).
function busDelivers(bus, key, prefs) {
  if (bus === "stream") return prefs.stream.has(key);
  if (bus === "script") return !prefs.stream.has(key);
  return false;
}

function classOf(key, prefs) {
  if (prefs.stream.has(key)) return "stream";
  if (prefs.global.has(key)) return "globale";
  return "hors référentiel";
}

function analyze(text) {
  const prefs = prefsOf(text);
  const report = { prefs, contract: CONTRACT.every((c) => squeeze(text).includes(c)), listeners: [], groups: [], errors: [], warnings: [] };
  if (!prefs) {
    report.errors.push("ALL_PREFS introuvable (bundle tronqué ? préambule modifié ?)");
    return report;
  }
  if (!report.contract) {
    report.errors.push("contrat d'émission `setting.changed` modifié dans le bundle — revalider bench/settings-bus-audit.js avant de conclure");
  }

  const re = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.on\(\s*"setting\.changed"\s*,\s*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const receiver = m[1];
    const bus = /Script$/.test(receiver) ? "script" : /Stream$/.test(receiver) ? "stream" : "inconnu";
    const open = text.indexOf("(", m.index);
    const close = findMatching(text, open);
    if (close < 0) {
      report.errors.push("souscription illisible à l'offset " + m.index + " (parenthèse non fermée)");
      continue;
    }
    const arg = text.slice(m.index + m[0].length, close);
    const cb = resolveCallback(arg, text, m.index);
    const info = cb.kind === "unresolved" ? { keys: [], wildcardStream: false, wildcardNonStream: false } : keysOf(cb.src);
    report.listeners.push(Object.assign({ offset: m.index, receiver, bus, callback: cb.name || "(inline)", cbSrc: cb.src, unresolved: cb.kind === "unresolved" }, info));
  }

  // Regroupement par callback : même code abonné aux 2 bus = un seul besoin.
  const groups = new Map();
  for (const l of report.listeners) {
    const id = l.cbSrc;
    if (!groups.has(id)) groups.set(id, { callback: l.callback, buses: new Set(), keys: new Set(), wildcards: new Set(), unresolved: l.unresolved, offsets: [] });
    const g = groups.get(id);
    g.buses.add(l.bus);
    g.offsets.push(l.offset);
    for (const k of l.keys) g.keys.add(k);
    if (l.wildcardStream) g.wildcards.add("stream");
    if (l.wildcardNonStream) g.wildcards.add("non-stream");
  }

  for (const g of groups.values()) {
    g.keys = [...g.keys].sort();
    g.buses = [...g.buses].sort();
    g.label = g.callback === "(inline)" ? "(inline @" + g.offsets[0] + ")" : g.callback;
    g.problems = [];
    const missing = g.keys.filter((k) => !g.buses.some((b) => busDelivers(b, k, prefs)));
    const unknown = g.keys.filter((k) => !prefs.stream.has(k) && !prefs.global.has(k));
    // Joker : `if (isStreamPref(data.settingKey)) …` = filtre stream → bus Stream.
    if (g.wildcards.has("stream") && !g.buses.includes("stream") && !g.buses.includes("inconnu")) {
      g.problems.push("filtre `isStreamPref(settingKey)` (classe stream) mais n'est abonné qu'à : " + g.buses.join(" + "));
    }
    if (missing.length) {
      g.problems.push("filtre " + missing.map((k) => "`" + k + "` (" + classOf(k, prefs) + ")").join(", ") + " — aucun bus souscrit ne livre cette clé");
    }
    if (g.unresolved) g.problems.push("callback non résolu (passé par nom/this) — à auditer à la main");
    if (g.buses.includes("inconnu")) g.problems.push("bus non reconnu");
    const warn = [];
    if (!g.keys.length && !g.wildcards.size) warn.push("aucune clé identifiée (rafraîchissement global ? forme d'écriture inconnue ?) — à revoir");
    if (unknown.length) warn.push("référence " + unknown.map((k) => "`" + k + "`").join(", ") + " : clé absente de ALL_PREFS (livrée par le bus Script) — vérifier la faute de frappe");
    g.warnings = warn;
    for (const p of g.problems) report.errors.push("callback `" + g.label + "` : " + p);
    for (const w of warn) report.warnings.push("callback `" + g.label + "` : " + w);
  }
  report.groups = [...groups.values()].sort((a, b) => a.offsets[0] - b.offsets[0]);
  return report;
}

// ---- CLI -------------------------------------------------------------------
function filters(g) {
  const parts = [];
  if (g.keys.length) parts.push(g.keys.join(", "));
  if (g.wildcards.has("stream")) parts.push("isStreamPref(settingKey) — toutes les prefs stream");
  if (g.wildcards.has("non-stream")) parts.push("!isStreamPref(settingKey) — toutes les prefs non-stream");
  return parts.length ? parts.join(" + ") : "aucun filtre";
}

function fmt(bundle, report, quiet) {
  const lines = ["== settings-bus-audit " + bundle + " =="];
  if (!report.prefs) return lines.concat("  ✗ " + report.errors.join("\n  ✗ "));
  lines.push("  préambule : ALL_PREFS.global=" + report.prefs.global.size + " · stream=" + report.prefs.stream.size + " · contrat d'émission : " + (report.contract ? "conforme" : "DÉRIVÉ"));
  for (const g of report.groups) {
    lines.push("  " + (g.problems.length ? "✗" : "✓") + " " + g.label + " — bus : " + g.buses.join(" + ") + " — filtres : " + filters(g));
  }
  if (quiet) return lines;
  for (const w of report.warnings) lines.push("  ⚠ " + w);
  for (const e of report.errors) lines.push("  ✗ " + e);
  const unresolved = report.listeners.filter((l) => l.unresolved).length;
  lines.push("  → " + report.groups.length + " callback(s) sur " + report.listeners.length + " souscription(s)" + (unresolved ? " · " + unresolved + " non résolue(s)" : "") + " · " + report.errors.length + " défaut(s), " + report.warnings.length + " avertissement(s)");
  return lines;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const JSON_OUT = args.includes("--json");
  const QUIET = args.includes("--quiet");
  const files = args.filter((a) => !a.startsWith("--"));
  const targets = files.length ? files : DEFAULT_BUNDLES.map((f) => path.join(ROOT, f));

  let fails = 0;
  const json = {};
  for (const file of targets) {
    const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const report = analyze(text);
    json[path.basename(file)] = report;
    if (!JSON_OUT) for (const l of fmt(path.basename(file), report, QUIET)) console.log(l);
    if (report.errors.length) fails++;
  }
  if (JSON_OUT) console.log(JSON.stringify(json, (k, v) => (v instanceof Set ? [...v] : v), 2));
  else console.log(fails === 0 ? "\n✅ GATE VERT — tous les listeners `setting.changed` sont joignables" : "\n❌ GATE ROUGE : " + fails + " bundle(s) avec des listeners injoignables");
  process.exit(fails === 0 ? 0 : 1);
}

module.exports = { analyze, keysOf, resolveCallback, busDelivers, classOf, prefsOf, CONTRACT, DEFAULT_BUNDLES };
