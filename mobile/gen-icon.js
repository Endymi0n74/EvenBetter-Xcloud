// Generate res/drawable-nodpi/ic_launcher.png (192x192) without dependencies.
// Identité EvenBetterXcloud : nuage (cloud) + flèche montante verte sur fond
// dégradé sombre — « even better » = la flèche qui perce le nuage.
// Rendu supersamplé 4× (anti-aliasing), PNG RGBA écrit à la main (zlib).
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const S = 192;
const SS = 4; // supersampling
const RADIUS = 40;

// Couleurs de la marque
const BG_TOP = [16, 20, 27];     // #10141b
const BG_BOT = [29, 39, 53];     // #1d2735
const CLOUD = [223, 230, 238];   // #dfe6ee (nuage)
const ARROW = [122, 193, 67];    // #7ac143 (vert de marque)

// ---- formes (SDF / point-in-shape), coordonnées à l'échelle S ----
function inRoundRect(x, y) {
  const l = 8, t = 8, r = S - 8, b = S - 8;
  if (x < l || x >= r || y < t || y >= b) return false;
  const cx = x < l + RADIUS ? l + RADIUS : x >= r - RADIUS ? r - RADIUS - 1 : x;
  const cy = y < t + RADIUS ? t + RADIUS : y >= b - RADIUS ? b - RADIUS - 1 : y;
  const dx = x - cx, dy = y - cy;
  if (dx === 0 || dy === 0) return true;
  return dx * dx + dy * dy <= RADIUS * RADIUS;
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inCloud(x, y) {
  // nuage : 3 bosses + base arrondie, centré bas
  if (inCircle(x, y, 96, 118, 34)) return true;   // corps
  if (inCircle(x, y, 70, 96, 27)) return true;    // bosse gauche
  if (inCircle(x, y, 96, 82, 31)) return true;    // bosse centre
  if (inCircle(x, y, 125, 99, 24)) return true;   // bosse droite
  // base rectangulaire arrondie reliant les bosses
  if (x >= 62 && x <= 130 && y >= 108 && y <= 150) return true;
  return false;
}

function inArrow(x, y) {
  // flèche montante : tête chevron + hampe, perce le nuage par le haut
  const stem = x >= 88 && x <= 104 && y >= 42 && y <= 108;
  if (stem) return true;
  // tête : chevron (pointe en haut, base évasée)
  if (y < 42 && y >= 26) {
    const t = (42 - y) / 16; // 0 à la base, 1 à la pointe
    const half = 8 + t * 30; // largeur qui s'élargit vers le haut
    if (x >= 96 - half && x <= 96 + half) return true;
  }
  return false;
}

// ---- rendu supersamplé ----
const raw = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS;
        const py = y + (sy + 0.5) / SS;
        if (!inRoundRect(px, py)) continue;
        const t = py / S;
        const bg = [
          BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t,
          BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t,
          BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t,
        ];
        let col = bg, alpha = 1;
        if (inArrow(px, py)) col = ARROW;
        else if (inCloud(px, py)) col = CLOUD;
        r += col[0]; g += col[1]; b += col[2]; a += alpha;
      }
    }
    const n = SS * SS;
    const i = (y * S + x) * 4;
    raw[i] = Math.round(r / n);
    raw[i + 1] = Math.round(g / n);
    raw[i + 2] = Math.round(b / n);
    raw[i + 3] = Math.round((a / n) * 255);
  }
}

// ---- PNG ----
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0);
  return Buffer.concat([len, name, data, crc]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type RGBA
const stride = S * 4 + 1;
const filtered = Buffer.alloc(stride * S);
for (let y = 0; y < S; y++) {
  filtered[y * stride] = 0;
  raw.copy(filtered, y * stride + 1, y * S * 4, (y + 1) * S * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(filtered, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, 'res', 'drawable-nodpi');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'ic_launcher.png'), png);
console.log('icône EvenBetterXcloud écrite:', path.join(out, 'ic_launcher.png'), png.length, 'octets');
