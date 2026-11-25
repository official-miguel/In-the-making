// Draws the app icon into PNGs (no dependencies): dark tile, three teal spines, glowing shelf.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); }
function png(size, maskable) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, [r, g, b], a = 255) => { const i = (y * size + x) * 4; const ia = a / 255; px[i] = Math.round(px[i] * (1 - ia) + r * ia); px[i + 1] = Math.round(px[i + 1] * (1 - ia) + g * ia); px[i + 2] = Math.round(px[i + 2] * (1 - ia) + b * ia); px[i + 3] = 255; };
  const bg = [15, 23, 42], teal = [45, 212, 191];
  const s = size / 64, pad = maskable ? 0 : 0;
  const r = maskable ? 0 : 14 * s;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = Math.max(r - x, x - (size - 1 - r), 0), dy = Math.max(r - y, y - (size - 1 - r), 0);
    const inside = r === 0 || Math.hypot(dx, dy) <= r;
    if (inside) set(x, y, bg); else { const i = (y * size + x) * 4; px[i + 3] = 0; }
  }
  const k = maskable ? 0.72 : 1, off = (size - size * k) / 2;
  const rect = (x0, y0, x1, y1, col, a = 255) => { for (let y = Math.round(off + y0 * s * k); y < off + y1 * s * k; y++) for (let x = Math.round(off + x0 * s * k); x < off + x1 * s * k; x++) set(x, y, col, a); };
  const books = [[15, 13, 21, 48, [225, 29, 72]], [23, 9, 30, 48, [14, 165, 233]], [32, 15, 37, 48, [245, 158, 11]], [39, 11, 46, 48, [124, 58, 237]]];
  for (const [x0, y0, x1, y1, c] of books) { rect(x0, y0, x1, y1, c); rect(x0, y0 + 3, x1, y0 + 4, [255, 255, 255], 120); rect(x0, y1 - 5, x1, y1 - 4, [255, 255, 255], 120); }
  for (let g = 1; g <= 6; g++) rect(10, 50 + g, 54, 51 + g, teal, 60 - g * 9);
  rect(10, 48, 54, 51, teal);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', png(192, false));
writeFileSync('public/icons/icon-512.png', png(512, false));
writeFileSync('public/icons/maskable-512.png', png(512, true));
console.log('icons written');
