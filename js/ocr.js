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

/** Achica la foto (las del iPhone son enormes) y la pasa a grises: lee igual de bien y mucho más rápido. */
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
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
