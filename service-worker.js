// service-worker.js – Offline-first PWA for PHS Stamper

// Bump the version when you change HTML/CSS/JS/JSON/icons
const CACHE_NAME = 'phs-stamper-v1025';

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
          keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        )
      )
    ])
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;

  // Only handle GET over http/https
  if (req.method !== 'GET' || !req.url.startsWith('http')) return;

  // For navigation (when the app starts up from the icon), always fall back to index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // For everything else (CSS/JS/JSON/images): cache-first, then network, then offline fallback
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(response => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(req, response.clone()));
          }
          return response;
        })
        .catch(() => cached || caches.match('./index.html'));
      return cached || network;
    })
  );
});
