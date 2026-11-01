// Service worker: la interfaz funciona offline (carcasa en caché); los datos siempre van a la red.
const CACHE = 'railes-v2';
const SHELL = ['/', '/index.html', '/app.js', '/common.js', '/style.css', '/informes.html', '/informes.js', '/informes.css',
  '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css', '/vendor/chartjs/chart.umd.min.js'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Red primero (para recibir siempre la última versión) y caché como respaldo sin conexión
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
