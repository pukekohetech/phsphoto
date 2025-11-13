/* Simple service worker to cache app shell */
const CACHE_VERSION = 'phs-stamper-v1.0.0';
const APP_SHELL = [
  './',
  './index.html?v=1.0.0',
  './manifest.webmanifest?v=1.0.0',
  './icon-192.png?v=1.0.0',
  './icon-512.png?v=1.0.0',
  './phs_crest.png?v=1.0.0',
  './service-worker.js?v=1.0.0'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_VERSION) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && req.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => caches.match('./'));
    })
  );
});
