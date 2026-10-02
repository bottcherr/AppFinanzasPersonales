// Genera icons/icon-192.png, icons/icon-512.png (moneda verde con $ sobre fondo oscuro) y las pantallas de
// carga del iPhone en icons/splash/.
// Mismo dibujo que icons/icon.svg, en coordenadas de 512.
// Uso: node tools/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
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

/**
 * PNG de w×h con el ícono de `iconPx` px centrado; afuera del ícono, fondo oscuro.
 * Sin parámetros extra es el ícono cuadrado de siempre.
 */
function png(w, h = w, iconPx = Math.min(w, h)) {
  const scale = 512 / iconPx;
  const ox = (w - iconPx) / 2;
  const oy = (h - iconPx) / 2;
  const SS = 4; // supermuestreo para bordes suaves
  const row = w * 3 + 1;
  const raw = Buffer.alloc(h * row);
  for (let y = 0; y < h; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * row + 1 + x * 3;
      // Afuera del ícono es todo fondo: no hace falta calcular nada.
      if (x < ox - 1 || x > ox + iconPx || y < oy - 1 || y > oy + iconPx) {
        raw[o] = BG[0];
        raw[o + 1] = BG[1];
        raw[o + 2] = BG[2];
        continue;
      }
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt((x - ox + (sx + 0.5) / SS) * scale, (y - oy + (sy + 0.5) / SS) * scale);
          for (let i = 0; i < 3; i++) sum[i] += c[i];
        }
      }
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(sum[i] / (SS * SS));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
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

/**
 * Pantallas de carga del iPhone (apple-touch-startup-image): fondo oscuro y la moneda chica al centro.
 * [ancho, alto, densidad] en puntos; index.html tiene un <link> por cada uno con su media query.
 */
export const SPLASH = [
  [440, 956, 3], // 16/17 Pro Max
  [402, 874, 3], // 16/17 Pro
  [420, 912, 3], // Air
  [430, 932, 3], // 14 Pro Max, 15/16 Plus, 15 Pro Max
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [428, 926, 3], // 12/13 Pro Max, 14 Plus
  [390, 844, 3], // 12, 13, 14, 12/13 Pro
  [375, 812, 3], // X, XS, 11 Pro, 12/13 mini
  [414, 896, 3], // XS Max, 11 Pro Max
  [414, 896, 2], // XR, 11
  [375, 667, 2], // SE 2/3, 8
];

mkdirSync(new URL('../icons/splash/', import.meta.url), { recursive: true });
for (const [w, h, d] of SPLASH) {
  // La moneda ocupa ~2/3 del ícono: con 150 pt de ícono, la moneda mide unos 98 pt (igual que #splash en index.html).
  const name = `icons/splash/splash-${w * d}x${h * d}.png`;
  writeFileSync(new URL(`../${name}`, import.meta.url), png(w * d, h * d, 150 * d));
  console.log(name);
}
