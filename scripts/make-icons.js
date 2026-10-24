'use strict';

/**
 * Eklenti ikonlarını sıfırdan üretir (harici bağımlılık yok).
 * Çalıştırma: node scripts/make-icons.js
 *
 * Tasarım: kırmızı yuvarlatılmış kare + iki beyaz "aşağı kaydır" şeridi.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BG = [255, 0, 51];
const FG = [255, 255, 255];
const SS = 4; // süper örnekleme

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function insideRoundedSquare(x, y, size, radius) {
  const dx = Math.abs(x - size / 2);
  const dy = Math.abs(y - size / 2);
  const half = size / 2;
  if (dx > half || dy > half) return false;
  if (dx <= half - radius || dy <= half - radius) return true;
  return Math.hypot(dx - (half - radius), dy - (half - radius)) <= radius;
}

function render(size) {
  const W = size * SS;
  const radius = W * 0.23;
  const stroke = W * 0.075;
  const half = stroke / 2;

  // İki aşağı bakan şerit (chevron)
  const segments = [
    [0.29, 0.44, 0.5, 0.6],
    [0.5, 0.6, 0.71, 0.44],
    [0.29, 0.27, 0.5, 0.43],
    [0.5, 0.43, 0.71, 0.27]
  ].map((s) => s.map((v) => v * W));

  const hi = new Float32Array(W * W * 4);

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const index = (y * W + x) * 4;

      if (!insideRoundedSquare(px, py, W, radius)) continue;

      let glyph = 0;
      for (const [ax, ay, bx, by] of segments) {
        if (distanceToSegment(px, py, ax, ay, bx, by) <= half) {
          glyph = 1;
          break;
        }
      }

      const color = glyph ? FG : BG;
      hi[index] = color[0] / 255;
      hi[index + 1] = color[1] / 255;
      hi[index + 2] = color[2] / 255;
      hi[index + 3] = 1;
    }
  }

  // Kutu filtresiyle küçült
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
          const alpha = hi[i + 3];
          r += hi[i] * alpha;
          g += hi[i + 1] * alpha;
          b += hi[i + 2] * alpha;
          a += alpha;
        }
      }
      const o = (y * size + x) * 4;
      const samples = SS * SS;
      out[o] = a ? Math.round((r / a) * 255) : 0;
      out[o + 1] = a ? Math.round((g / a) * 255) : 0;
      out[o + 2] = a ? Math.round((b / a) * 255) : 0;
      out[o + 3] = Math.round((a / samples) * 255);
    }
  }

  return out;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, encodePng(size, render(size)));
  console.log(`yazıldı: ${path.relative(process.cwd(), file)}`);
}
