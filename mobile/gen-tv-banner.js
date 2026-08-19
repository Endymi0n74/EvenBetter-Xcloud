#!/usr/bin/env node
/**
 * gen-tv-banner.js — bannière Android TV (320×180, xhdpi) pour le launcher
 * leanback de la Freebox Pop / Android TV. Rendu : fond bleu nuit dégradé +
 * emblème (anneau + X) du logo, recadré et redimensionné — même pipeline
 * PNG que gen-icon.js (module partagé). Repli procédural si le logo manque.
 *
 * Note : pas de texte dans la bannière (pas de moteur de polices en Node pur)
 * — Android TV affiche le label de l'app à côté de la bannière.
 *
 * Usage : node mobile/gen-tv-banner.js   → res/drawable-nodpi/tv_banner.png
 */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { decodePNG, pixel, encodePNG, EXPECT, ASSET } = require("./gen-icon.js");

const W = 320;
const H = 180;
// encodePNG partagé : on lui passe la taille (320×180) — il est paramétré.

// Emblème seul : la zone lumineuse détectée dans le banner (anneau + X),
// sans le texte « EvenBetterXcloud » (y > 400). Crop légèrement plus lâche
// que l'icône (marge intégrée au fond) : 420×420 centré sur (511, 214).
const EMBLEM = { x: 301, y: 4, size: 420 };

function buildBanner() {
  const img = decodePNG(fs.readFileSync(ASSET));
  if (img.w !== EXPECT.w || img.h !== EXPECT.h) {
    throw new Error("banner inattendu " + img.w + "x" + img.h + " (attendu " + EXPECT.w + "x" + EXPECT.h + ")");
  }
  const rgba = Buffer.alloc(W * H * 4);
  // Fond : dégradé vertical bleu nuit (#021637 → #0a2a52), cohérent avec le logo.
  const top = [2, 22, 55], bot = [10, 42, 82];
  // Emblème : redimensionné à 168×168, centré horizontalement, légèrement
  // décollé du bas (zone de texte du launcher).
  const EW = 168, EH = 168;
  const ox = (W - EW) >> 1, oy = (H - EH - 6) >> 1;
  for (let y = 0; y < H; y++) {
    const t = y / H;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = Math.round(top[0] + (bot[0] - top[0]) * t);
      rgba[i + 1] = Math.round(top[1] + (bot[1] - top[1]) * t);
      rgba[i + 2] = Math.round(top[2] + (bot[2] - top[2]) * t);
      rgba[i + 3] = 255;
    }
  }
  // Superposer l'emblème (bilinéaire) dans le rectangle EW×EH.
  for (let y = 0; y < EH; y++) {
    const sy = (y + 0.5) / EH * EMBLEM.size + EMBLEM.y - 0.5;
    const y0 = Math.max(0, Math.floor(sy)), dy = sy - y0;
    for (let x = 0; x < EW; x++) {
      const sx = (x + 0.5) / EW * EMBLEM.size + EMBLEM.x - 0.5;
      const x0 = Math.max(0, Math.floor(sx)), dx = sx - x0;
      const p00 = pixel(img, x0, y0), p10 = pixel(img, x0 + 1, y0);
      const p01 = pixel(img, x0, y0 + 1), p11 = pixel(img, x0 + 1, y0 + 1);
      const oi = ((oy + y) * W + (ox + x)) * 4;
      for (let c = 0; c < 4; c++) {
        const top2 = p00[c] + (p10[c] - p00[c]) * dx;
        const bot2 = p01[c] + (p11[c] - p01[c]) * dx;
        rgba[oi + c] = Math.round(top2 + (bot2 - top2) * dy);
      }
    }
  }
  return rgba;
}

function bannerProc() {
  // Repli procédural : fond dégradé + anneau simple (pas de texte).
  const rgba = Buffer.alloc(W * H * 4);
  const top = [2, 22, 55], bot = [10, 42, 82];
  const cx = W >> 1, cy = H >> 1, R = 62;
  for (let y = 0; y < H; y++) {
    const t = y / H;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = Math.round(top[0] + (bot[0] - top[0]) * t);
      rgba[i + 1] = Math.round(top[1] + (bot[1] - top[1]) * t);
      rgba[i + 2] = Math.round(top[2] + (bot[2] - top[2]) * t);
      rgba[i + 3] = 255;
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (d >= R - 6 && d <= R) { rgba[i] = 122; rgba[i + 1] = 193; rgba[i + 2] = 67; }
    }
  }
  return rgba;
}

let png, source;
try {
  const rgba = buildBanner();
  png = encodePNG(rgba, [W, H]);
  source = "logo (" + ASSET + ")";
} catch (e) {
  console.warn("  gen-tv-banner: " + e.message + " → repli procédural");
  png = encodePNG(bannerProc(), [W, H]);
  source = "procédurale (repli)";
}

const out = path.join(__dirname, "res", "drawable-nodpi");
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, "tv_banner.png");
fs.writeFileSync(file, png);
console.log("bannière TV EvenBetterXcloud écrite:", file, png.length, "octets (" + source + ")");
