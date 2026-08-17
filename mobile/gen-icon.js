// Generate res/drawable-nodpi/ic_launcher.png (192x192) without dependencies.
// Dark rounded-square background + a thick green "X" (xCloud-ish).
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const S = 192;
const bg = [27, 31, 39, 255];     // #1b1f27
const fg = [122, 193, 67, 255];   // #7ac143
const RADIUS = 40;

function inRoundRect(x, y) {
    // rounded square inset by 8px
    const l = 8, t = 8, r = S - 8, b = S - 8;
    if (x < l || x >= r || y < t || y >= b) return false;
    const cx = x < l + RADIUS ? l + RADIUS : x >= r - RADIUS ? r - RADIUS - 1 : x;
    const cy = y < t + RADIUS ? t + RADIUS : y >= b - RADIUS ? b - RADIUS - 1 : y;
    const dx = x - cx, dy = y - cy;
    if (dx === 0 || dy === 0) return true;
    return dx * dx + dy * dy <= RADIUS * RADIUS;
}

function inX(x, y) {
    // two thick diagonals crossing at center
    const c = S / 2;
    const half = 20; // half-thickness of each bar
    const d1 = Math.abs((x - c) - (y - c)) / Math.SQRT2;      // distance to diagonal y=x
    const d2 = Math.abs((x - c) + (y - c)) / Math.SQRT2;      // distance to anti-diagonal
    return (d1 <= half) || (d2 <= half);
}

const raw = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const px = inRoundRect(x, y) ? (inX(x, y) ? fg : bg) : [0, 0, 0, 0];
        raw[i] = px[0]; raw[i + 1] = px[1]; raw[i + 2] = px[2]; raw[i + 3] = px[3];
    }
}

// PNG chunks
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
// filter: 0 per scanline
const stride = S * 4 + 1;
const filtered = Buffer.alloc(stride * S);
for (let y = 0; y < S; y++) {
    filtered[y * stride] = 0;
    raw.copy(filtered, y * stride + 1, y * S * 4, (y + 1) * S * 4);
}

const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(filtered)),
    chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, 'res', 'drawable-nodpi');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'ic_launcher.png'), png);
console.log('icône écrite:', path.join(out, 'ic_launcher.png'), png.length, 'octets');
