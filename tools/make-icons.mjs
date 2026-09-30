// Genera icons/icon-192.png e icons/icon-512.png (moneda verde con $ sobre fondo oscuro).
// Mismo dibujo que icons/icon.svg, en coordenadas de 512.
// Uso: node tools/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x07, 0x0a, 0x0f];
const GREEN = [0x1f, 0xbf, 0x8f];
const RING = GREEN.map((g, i) => Math.round(g * 0.75 + BG[i] * 0.25)); // aro al 25 % de opacidad

const C = 256;
const STROKE = 15; // mitad del grosor del $

function distSegment(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

// Medio círculo: side = -1 (mitad izquierda) o 1 (mitad derecha).
function distHalfArc(px, py, cx, cy, r, side) {
  if ((px - cx) * side >= 0) return Math.abs(Math.hypot(px - cx, py - cy) - r);
  return Math.min(Math.hypot(px - cx, py - cy + r), Math.hypot(px - cx, py - cy - r));
}

// El $: palito vertical + "S" hecha de tres rectas y dos medios círculos.
const SEGMENTS = [
  [256, 150, 256, 362],
  [308, 192, 236, 192],
  [236, 268, 276, 268],
  [276, 344, 200, 344],
];

function inDollar(px, py) {
  if (SEGMENTS.some((s) => distSegment(px, py, s) <= STROKE)) return true;
  return distHalfArc(px, py, 236, 230, 38, -1) <= STROKE || distHalfArc(px, py, 276, 306, 38, 1) <= STROKE;
}

function colorAt(px, py) {
  const d = Math.hypot(px - C, py - C);
  if (d > 168) return BG;
  if (inDollar(px, py)) return BG;
  if (Math.abs(d - 136) <= 6) return RING;
  return GREEN;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const scale = 512 / size;
  const SS = 4; // supermuestreo para bordes suaves
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt((x + (sx + 0.5) / SS) * scale, (y + (sy + 0.5) / SS) * scale);
          for (let i = 0; i < 3; i++) sum[i] += c[i];
        }
      }
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(sum[i] / (SS * SS));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), png(size));
  console.log(`icons/icon-${size}.png`);
}
