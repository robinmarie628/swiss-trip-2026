/* ============================================================================
   Swiss Trip Workbench — service worker
   App shell is precached so the itinerary, hotels and tickets work offline.
   Map tiles are cached opportunistically after first view.
   ========================================================================== */

const VERSION = 'v1.7.2';
const SHELL = 'swiss-shell-' + VERSION;
const TILES = 'swiss-tiles-' + VERSION;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/app.css',
  './assets/js/data.js',
  './assets/js/store.js',
  './assets/js/services.js',
  './assets/js/weather.js',
  './assets/js/app.js',
  './assets/vendor/leaflet/leaflet.js',
  './assets/vendor/leaflet/leaflet.css',
  './assets/vendor/leaflet/images/marker-icon.png',
  './assets/vendor/leaflet/images/marker-icon-2x.png',
  './assets/vendor/leaflet/images/marker-shadow.png',
  './assets/vendor/leaflet/images/layers.png',
  './assets/vendor/leaflet/images/layers-2x.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-32.png',
];

const TILE_HOSTS = [
  'tile.openstreetmap.org',
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org',
  'tile.opentopomap.org',
  'a.tile.opentopomap.org',
  'b.tile.opentopomap.org',
  'c.tile.opentopomap.org',
];

/* ---------- install ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // add individually so one bad URL cannot abort the whole install
    await Promise.all(SHELL_FILES.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

/* ---------- activate ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k !== SHELL && k !== TILES) return caches.delete(k);
      return null;
    }));
    await self.clients.claim();
  })());
});

/* ---------- helpers ---------- */
function isTile(url) {
  return TILE_HOSTS.indexOf(url.hostname) >= 0;
}

/**
 * Network-first with a cache fallback.
 *
 * The site is tiny (~60 KB of app code), so going to the network first is cheap
 * and it means a freshly pushed change shows up on the very next load — no
 * manual cache-version bump required. If the network is missing or slow we fall
 * straight back to the cached copy, so offline still works exactly as before.
 */
async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  let timer = null;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  if (ctl) timer = setTimeout(() => ctl.abort(), timeoutMs || 4000);

  try {
    const res = await fetch(request, ctl ? { signal: ctl.signal } : undefined);
    if (timer) clearTimeout(timer);
    if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    if (timer) clearTimeout(timer);
    if (cached) return cached;
    throw e;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  return hit || (await network) || new Response('', { status: 504 });
}

/* ---------- fetch ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // map tiles: cache then revalidate in background (tiles are large and rarely change)
  if (isTile(url)) {
    event.respondWith(staleWhileRevalidate(req, TILES));
    return;
  }

  // app shell: fresh when online, cached when not
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        return await networkFirst(req, SHELL, 4000);
      } catch (e) {
        if (req.mode === 'navigate') {
          const cache = await caches.open(SHELL);
          const shell = (await cache.match('./index.html')) || (await cache.match('./'));
          if (shell) return shell;
        }
        return new Response('离线中，且该资源未缓存。', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })());
  }
});

/* ---------- message: force update ---------- */
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
