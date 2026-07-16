// Caches only the static app shell (CSS/JS/icons/manifest) for fast loads and
// installability. Never caches "/", "/app", or anything under "/api/" — those
// carry session-gated, sensitive borrower data and must always be fetched fresh.

const CACHE_NAME = 'upgb-ots-shell-v1';
const SHELL_ASSETS = [
  '/css/app.css',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return; // never intercept data calls
  if (url.pathname === '/' || url.pathname === '/app') return; // always fetch fresh (session-gated)
  if (!SHELL_ASSETS.includes(url.pathname)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((res) => {
        if (res.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
