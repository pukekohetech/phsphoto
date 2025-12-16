// service-worker.js – Offline-first PWA for Pukekohe HS Photo Stamper

// Derive the app base path from the SW location so it works on GitHub Pages (/phsphoto/)
const SW_URL = new URL(self.location);
const ROOT_PATH = SW_URL.pathname.replace(/service-worker\.js$/, '');

// Bump this whenever you change core assets
const CACHE_NAME = 'phs-stamper-v287';

// Helper to build paths under the app root
function atRoot(path) {
  // Ensure there is exactly one slash between root and path
  return ROOT_PATH.replace(/\/$/, '/') + path.replace(/^\//, '');
}

// Core assets to cache for offline use
const CORE_ASSETS = [
  atRoot('/'),
  atRoot('/index.html'),
  atRoot('/styles.css'),
  atRoot('/script.js'),
  atRoot('/selections.json'),
  atRoot('/manifest.webmanifest'),
  atRoot('/icon-152.png'),
  atRoot('/icon-192.png'),
  atRoot('/icon-512.png'),
  atRoot('/crest-152.png'),
  atRoot('/crest-192.png'),
  atRoot('/crest-512.png')
  ,atRoot('/phs-shield.png')
];

// -----------------------------------------------------
// Install – cache core assets
// -----------------------------------------------------
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// -----------------------------------------------------
// Activate – clean up old caches
// -----------------------------------------------------
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('phs-stamper-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// -----------------------------------------------------
// Fetch –
//   • For navigations: network first, fall back to cached index.html
//   • For same-origin assets: cache first, then network, updating cache
// -----------------------------------------------------
self.addEventListener('fetch', event => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Handle navigations (app shell)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        // Fall back to cached index.html if offline
        caches.match(atRoot('/index.html'))
      )
    );
    return;
  }

  // 2) Same-origin static assets – cache first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;

        // Not in cache – fetch and cache for next time
        return fetch(req)
          .then(response => {
            if (response && response.status === 200 && response.type === 'basic') {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
            }
            return response;
          })
          .catch(() =>
            // As a last resort, if this was something HTML-like, fall back to index
            caches.match(atRoot('/index.html'))
          );
      })
    );
    return;
  }

  // 3) For cross-origin (if any), just go to network
  //    (you can add a fallback here too if you want)
});
