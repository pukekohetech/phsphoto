// service-worker.js – Offline-first PWA for PHS Stamper

// Bump this version whenever you change core assets (HTML/CSS/JS/JSON/icons).
const CACHE_NAME = 'phs-stamper-v104';

const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './selections.json',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './phs_crest.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(k => k !== CACHE_NAME)
            .map(k => caches.delete(k))
        )
      )
    ])
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;

  // Only handle GET requests over HTTP/HTTPS
  if (request.method !== 'GET' || !request.url.startsWith('http')) return;

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(request, response.clone());
            });
          }
          return response;
        })
        .catch(() => cached || caches.match('./index.html'));

      return cached || network;
    })
  );
});
