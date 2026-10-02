// Service worker: guarda los archivos de la app para que abra sin conexión.
// Al cambiar cualquier archivo de la app, subir la versión para que se actualice.
const CACHE = 'appfinanzas-v24';
// El lector de fotos (js/vendor/ocr, ~6 MB) va en una caché aparte que no se borra con cada versión:
// se baja una sola vez, la primera vez que se usa. Si alguna vez se cambian esos archivos, subir este número.
const OCR_CACHE = 'appfinanzas-ocr-v1';

const FILES = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/store.js',
  './js/data.js',
  './js/rules.js',
  './js/util.js',
  './js/icons.js',
  './js/qr.js',
  './js/ocr.js',
  './js/vendor/jsQR.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './fonts/outfit-700.woff2',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' = bajar cada archivo del servidor, no de lo que el navegador tenga guardado.
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== OCR_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Primero la red (para recibir cambios), y si no hay conexión, lo guardado.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const sameOrigin = url.origin === location.origin;
  // Lector de fotos: primero lo guardado (no cambia). El pedido va tal cual: si se le cambian las opciones,
  // el importScripts del worker de Tesseract falla.
  if (sameOrigin && url.pathname.includes('/js/vendor/ocr/')) {
    event.respondWith(
      caches.open(OCR_CACHE).then((cache) =>
        cache.match(event.request).then(
          (hit) =>
            hit ||
            fetch(event.request).then((response) => {
              if (response.ok) cache.put(event.request, response.clone());
              return response;
            }),
        ),
      ),
    );
    return;
  }
  event.respondWith(
    fetch(event.request, sameOrigin ? { cache: 'no-cache' } : undefined)
      .then((response) => {
        if (response.ok && sameOrigin) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html')),
      ),
  );
});
