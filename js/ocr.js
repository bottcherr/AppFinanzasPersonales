// Leer el texto de una foto (lista o ticket) sin internet, con Tesseract.js (Apache 2.0).
// Todo vive en js/vendor/ocr (unos 6 MB): se baja recién la primera vez que se usa y el service worker
// lo guarda para usarlo sin conexión. Se usa la versión con SIMD (iPhone con iOS 16.4 o más nuevo).

const DIR = 'js/vendor/ocr/';
const abs = (p) => new URL(p, document.baseURI).href;
let loading = null;

function loadLib() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = DIR + 'tesseract.min.js';
      const fail = () => {
        loading = null;
        s.remove();
        reject(new Error('ocr'));
      };
      s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : fail());
      s.onerror = fail;
      document.head.appendChild(s);
    });
  }
  return loading;
}

/**
 * Dónde está el papel: el ticket es lo más claro de la foto. Se mira el brillo promedio de cada columna y
 * fila en una copia chiquita y se toma el tramo claro más largo. Devuelve { x, y, w, h } en 0..1, o null.
 */
function paperBox(bmp) {
  const W = 160;
  const H = Math.max(1, Math.round((bmp.height / bmp.width) * W));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const lum = (x, y) => {
    const i = (y * W + x) * 4;
    return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  };
  const run = (vals) => {
    const t = (Math.max(...vals) + Math.min(...vals)) / 2;
    let best = [0, 0];
    let start = -1;
    vals.forEach((v, i) => {
      if (v >= t && start < 0) start = i;
      if ((v < t || i === vals.length - 1) && start >= 0) {
        const end = v >= t ? i : i - 1;
        if (end - start > best[1] - best[0]) best = [start, end];
        start = -1;
      }
    });
    return best;
  };
  const cols = Array.from({ length: W }, (_, x) => {
    let s = 0;
    for (let y = 0; y < H; y++) s += lum(x, y);
    return s / H;
  });
  const [x0, x1] = run(cols);
  const rows = Array.from({ length: H }, (_, y) => {
    let s = 0;
    for (let x = x0; x <= x1; x++) s += lum(x, y);
    return s / (x1 - x0 + 1);
  });
  const [y0, y1] = run(rows);
  const w = (x1 - x0 + 1) / W;
  const h = (y1 - y0 + 1) / H;
  // Si "el papel" ocupa casi todo o muy poco, no se recorta (foto de cerca o fondo claro).
  if (w > 0.92 && h > 0.92) return null;
  if (w < 0.25 || h < 0.25) return null;
  const m = 0.02; // un poquito de margen
  return {
    x: Math.max(0, x0 / W - m), y: Math.max(0, y0 / H - m),
    w: Math.min(1, w + 2 * m), h: Math.min(1, h + 2 * m),
  };
}

/**
 * Recorta la foto al papel (el fondo, tipo granito o madera, mete letras falsas), la achica (las del
 * iPhone son enormes) y la pasa a grises: lee mejor y mucho más rápido.
 */
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const b = paperBox(bmp) || { x: 0, y: 0, w: 1, h: 1 };
  const sx = b.x * bmp.width;
  const sy = b.y * bmp.height;
  const sw = Math.min(bmp.width - sx, b.w * bmp.width);
  const sh = Math.min(bmp.height - sy, b.h * bmp.height);
  // Entre 1600 y 2200 px de alto: un ticket largo necesita resolución para las letras chicas.
  const k = Math.min(2200 / Math.max(sw, sh), Math.max(1, 1600 / Math.max(sw, sh)));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * k);
  c.height = Math.round(sh * k);
  const ctx = c.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

/**
 * Lee el texto de una foto. onProgress(0..1, 'mensaje') va contando cómo viene.
 * Devuelve el texto (con un renglón por línea del papel).
 */
export async function readText(file, onProgress = () => {}) {
  onProgress(0, 'Preparando…');
  const [Tesseract, canvas] = await Promise.all([loadLib(), prepare(file)]);
  const worker = await Tesseract.createWorker('spa', 1, {
    workerPath: abs(DIR + 'worker.min.js'),
    corePath: abs(DIR + 'tesseract-core-simd-lstm.wasm.js'),
    langPath: abs(DIR.replace(/\/$/, '')),
    workerBlobURL: false, // el worker se carga como archivo propio (la Content-Security-Policy no deja blob:)
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress(0.3 + 0.7 * (m.progress || 0), 'Leyendo la foto…');
      else onProgress(0.3 * (m.progress || 0), 'Preparando el lector…');
    },
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  } finally {
    worker.terminate(); // libera la memoria del teléfono
  }
}
