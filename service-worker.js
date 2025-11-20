// service-worker.js – Offline-first PWA for PHS Stamper (GitHub Pages)

// App is hosted at: https://pukekohetech.github.io/phsphoto/
const ROOT = '/phsphoto/';

// Bump version when core assets change
const CACHE_NAME = 'phs-stamper-v220';

const CORE_ASSETS = [
  ROOT,
  ROOT + 'index.html',
  ROOT + 'styles.css',
  ROOT + 'script.js',
  ROOT + 'selections.json',
  ROOT + 'manifest.webmanifest',
  ROOT + 'icon-192.png',
  ROOT + 'icon-512.png',
  ROOT + 'phs_crest.png'
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

  // When the app is launched / navigated to (e.g. from home-screen icon),
  // always fall back to the cached index.html if offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match(ROOT + 'index.html'))
    );
    return;
  }

  // For other requests: cache-first, then network, then offline fallback
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(response => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(req, response.clone()));
          }
          return response;
        })
        .catch(() => cached || caches.match(ROOT + 'index.html'));

      return cached || network;
    })
  );
});
