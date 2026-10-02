// QR de los tickets / facturas electrónicas (ARCA, ex AFIP).
// El QR es una dirección como https://www.afip.gob.ar/fe/qr/?p=XXXX donde XXXX es un JSON en base64 con
// fecha, CUIT del comercio, importe, moneda y cotización. No trae la lista de productos.
// Para leer el QR de una imagen se usa jsQR (js/vendor/jsQR.js, licencia Apache 2.0), que se carga
// recién la primera vez que se escanea.

let loading = null;

/** Carga jsQR una sola vez y devuelve la función. */
export function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/jsQR.js';
      s.onload = () => (window.jsQR ? resolve(window.jsQR) : reject(new Error('jsQR')));
      s.onerror = () => {
        loading = null;
        reject(new Error('jsQR'));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/** Busca un QR en una imagen (video, canvas, img o ImageBitmap). Devuelve el texto o null. */
export function decodeImage(jsQR, source, w, h, canvas, { thorough = false } = {}) {
  const max = thorough ? 1600 : 720;
  const k = Math.min(1, max / Math.max(w, h));
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const res = jsQR(img.data, img.width, img.height, { inversionAttempts: thorough ? 'attemptBoth' : 'dontInvert' });
  return res && res.data ? res.data : null;
}

function base64Json(s) {
  let b = s.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '');
  while (b.length % 4) b += '=';
  const bin = atob(b);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Lee el texto de un QR fiscal. Devuelve { amount, date, cuit } o null si no es uno de ARCA.
 * amount en pesos enteros (si la factura es en otra moneda, se pasa con la cotización que trae).
 */
export function parseFiscalQR(text) {
  if (typeof text !== 'string' || text.length > 4000) return null;
  let data;
  try {
    const url = new URL(text.trim());
    if (!/(^|\.)(afip|arca)\.gob\.ar$/i.test(url.hostname)) return null;
    const p = url.searchParams.get('p');
    if (!p) return null;
    data = base64Json(p);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;

  const cuit = String(data.cuit ?? '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(cuit)) return null;

  let importe = Number(data.importe);
  if (!Number.isFinite(importe) || importe <= 0) return null;
  const moneda = String(data.moneda || 'PES').toUpperCase();
  const ctz = Number(data.ctz);
  if (moneda !== 'PES' && Number.isFinite(ctz) && ctz > 0) importe *= ctz;
  const amount = Math.round(importe);
  if (amount <= 0 || amount > 1e13) return null;

  // Fecha "AAAA-MM-DD" (a veces viene como "AAAAMMDD").
  const f = String(data.fecha || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(Date.parse(f)) ? f : null;

  return { amount, date, cuit };
}

/** 30123456789 → 30-12345678-9 */
export const fmtCuit = (c) => `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;
