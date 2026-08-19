// Generate res/drawable-nodpi/ic_launcher.png (512x512) from the brand logo
// banner mobile/assets/evenbetterxcloud-logo.png. Pure Node, zero deps.
//
// Crop constants derived 2026-08-19 for the 1024x559 banner:
//   - bright ring (anneau + X) detected at x 341-681, y 44-384, centre (511, 214)
//   - texte "EvenBetterXcloud" sous le cercle (y > 400) -> exclu
//   - crop carré 380x380 à (321, 20) : anneau complet + 20px de marge, sans texte
// If the banner is missing/unexpected, fall back to the legacy procedural icon
// so the APK build never breaks.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const ASSET = path.join(__dirname, 'assets', 'evenbetterxcloud-logo.png');
const SIZE = 512;      // icône native (scalée par le launcher)
const CORNER = 106;    // rayon des coins arrondis (~20.8 %, style hérité)
const CROP = { x: 321, y: 20, size: 380 };
const EXPECT = { w: 1024, h: 559 };

// ---------------- PNG decode (RGBA8, non interlacé) ----------------
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('pas un PNG');
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 1;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error('PNG non supporté (bitDepth=' + bitDepth + ', interlace=' + interlace + ')');
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!bpp) throw new Error('colorType non supporté ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const row = out.slice(y * stride, (y + 1) * stride);
    const src = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    src.copy(row);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pr) & 0xff;
          break;
        }
        default: throw new Error('filtre PNG inconnu ' + filter);
      }
      row[x] = v;
    }
  }
  return { w, h, bpp, data: out };
}

function pixel(img, x, y) {
  const i = (y * img.w + x) * img.bpp;
  const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
  const a = img.bpp === 4 ? img.data[i + 3] : 255;
  return [r, g, b, a];
}

// ---------------- resize bilinéaire (crop source -> canvas SIZE) ----------------
function buildCanvas(img, crop) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  const s = crop.size;
  for (let y = 0; y < SIZE; y++) {
    const sy = (y + 0.5) / SIZE * s + crop.y - 0.5;
    const y0 = Math.floor(sy), dy = sy - y0;
    for (let x = 0; x < SIZE; x++) {
      const sx = (x + 0.5) / SIZE * s + crop.x - 0.5;
      const x0 = Math.floor(sx), dx = sx - x0;
      const p00 = pixel(img, x0, y0), p10 = pixel(img, x0 + 1, y0);
      const p01 = pixel(img, x0, y0 + 1), p11 = pixel(img, x0 + 1, y0 + 1);
      for (let c = 0; c < 4; c++) {
        const top = p00[c] + (p10[c] - p00[c]) * dx;
        const bot = p01[c] + (p11[c] - p01[c]) * dx;
        rgba[(y * SIZE + x) * 4 + c] = Math.round(top + (bot - top) * dy);
      }
    }
  }
  // coins arrondis (alpha=0 hors du rounded-rect)
  const R = CORNER;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let cx = x, cy = y;
      if (x < R && y < R) { cx = R; cy = R; }
      else if (x >= SIZE - R && y < R) { cx = SIZE - R - 1; cy = R; }
      else if (x < R && y >= SIZE - R) { cx = R; cy = SIZE - R - 1; }
      else if (x >= SIZE - R && y >= SIZE - R) { cx = SIZE - R - 1; cy = SIZE - R - 1; }
      else continue;
      const dxx = x - cx, dyy = y - cy;
      if (dxx * dxx + dyy * dyy > R * R) rgba[(y * SIZE + x) * 4 + 3] = 0;
    }
  }
  return rgba;
}

// ---------------- PNG encode ----------------
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

function encodePNG(rgba) {
  const S = SIZE;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);
  ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const stride = S * 4 + 1;
  const filtered = Buffer.alloc(stride * S);
  for (let y = 0; y < S; y++) {
    filtered[y * stride] = 0;
    rgba.copy(filtered, y * stride + 1, y * S * 4, (y + 1) * S * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(filtered, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------- legacy procedural fallback (nuage + flèche) ----------------
function drawLegacy() {
  const S = 192, SS = 4, RADIUS = 40;
  const BG_TOP = [16, 20, 27], BG_BOT = [29, 39, 53];
  const CLOUD = [223, 230, 238], ARROW = [122, 193, 67];
  const inRoundRect = (x, y) => {
    const l = 8, t = 8, r = S - 8, b = S - 8;
    if (x < l || x >= r || y < t || y >= b) return false;
    const cx = x < l + RADIUS ? l + RADIUS : x >= r - RADIUS ? r - RADIUS - 1 : x;
    const cy = y < t + RADIUS ? t + RADIUS : y >= b - RADIUS ? b - RADIUS - 1 : y;
    const dx = x - cx, dy = y - cy;
    if (dx === 0 || dy === 0) return true;
    return dx * dx + dy * dy <= RADIUS * RADIUS;
  };
  const inCircle = (x, y, cx, cy, r) => { const dx = x - cx, dy = y - cy; return dx * dx + dy * dy <= r * r; };
  const inCloud = (x, y) => {
    if (inCircle(x, y, 96, 118, 34)) return true;
    if (inCircle(x, y, 70, 96, 27)) return true;
    if (inCircle(x, y, 96, 82, 31)) return true;
    if (inCircle(x, y, 125, 99, 24)) return true;
    return x >= 62 && x <= 130 && y >= 108 && y <= 150;
  };
  const inArrow = (x, y) => {
    if (x >= 88 && x <= 104 && y >= 42 && y <= 108) return true;
    if (y < 42 && y >= 26) {
      const t = (42 - y) / 16;
      const half = 8 + t * 30;
      return x >= 96 - half && x <= 96 + half;
    }
    return false;
  };
  const raw = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
          if (!inRoundRect(px, py)) continue;
          const t = py / S;
          const bg = [BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t, BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t, BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t];
          let col = bg, alpha = 1;
          if (inArrow(px, py)) col = ARROW;
          else if (inCloud(px, py)) col = CLOUD;
          r += col[0]; g += col[1]; b += col[2]; a += alpha;
        }
      }
      const n = SS * SS, i = (y * S + x) * 4;
      raw[i] = Math.round(r / n); raw[i + 1] = Math.round(g / n); raw[i + 2] = Math.round(b / n);
      raw[i + 3] = Math.round((a / n) * 255);
    }
  }
  return raw;
}

// ---------------- main ----------------
function main() {
  let png, source;
  try {
    const img = decodePNG(fs.readFileSync(ASSET));
    if (img.w !== EXPECT.w || img.h !== EXPECT.h) throw new Error('banner inattendu ' + img.w + 'x' + img.h + ' (attendu ' + EXPECT.w + 'x' + EXPECT.h + ') — recadrer CROP dans gen-icon.js');
    // validation du crop : l'anneau doit être lumineux dans la zone centrale
    let bright = 0;
    for (let y = 0; y < 380; y += 4) {
      for (let x = 0; x < 380; x += 4) {
        const [r, g, b] = pixel(img, CROP.x + x, CROP.y + y);
        if (Math.max(r, g, b) > 200) bright++;
      }
    }
    if (bright < 100) throw new Error('aucun anneau lumineux détecté dans le crop — recadrer CROP');
    const rgba = buildCanvas(img, CROP);
    png = encodePNG(rgba);
    source = 'logo (' + ASSET + ')';
    // stats de contrôle
    const px = (x, y) => {
      const i = (y * SIZE + x) * 4;
      return [rgba[i], rgba[i + 1], rgba[i + 2]];
    };
    const corner = px(20, 20), center = px(SIZE >> 1, SIZE >> 1);
    console.log('  fond (coin): rgb(' + corner.join(',') + ') · centre: rgb(' + center.join(',') + ')');
  } catch (e) {
    console.warn('  gen-icon: ' + e.message + ' → repli icône procédurale');
    png = (() => {
      const S = 512;
      const legacy = drawLegacy();
      // upscale 192 -> 512 (nearest, acceptable pour le repli)
      const rgba = Buffer.alloc(S * S * 4);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        legacy.copy(rgba, (y * S + x) * 4, ((y / S * 192) | 0) * 192 * 4 + ((x / S * 192) | 0) * 4, ((y / S * 192) | 0) * 192 * 4 + ((x / S * 192) | 0) * 4 + 4);
      }
      return encodePNG(rgba);
    })();
    source = 'procédurale (repli)';
  }
  const out = path.join(__dirname, 'res', 'drawable-nodpi');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'ic_launcher.png');
  fs.writeFileSync(file, png);
  console.log('icône EvenBetterXcloud écrite:', file, png.length, 'octets (' + source + ')');
}

main();
