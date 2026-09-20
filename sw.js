// sw.js — offline support for Glide.
// Strategy:
//  - App shell (our own files): cache-first, so Glide opens instantly & offline.
//  - MediaPipe CDN assets (model, wasm, JS): stale-while-revalidate, so the first
//    online load populates the cache and every load after works offline.
// The camera stream is never touched here — it never leaves the page.

const SHELL = 'glide-shell-v5';
const RUNTIME = 'glide-runtime-v5';

const SHELL_FILES = [
  './',
  './index.html',
  './app.html',
  './app.css',
  './landing.css',
  './src/app.js',
  './src/filter.js',
  './src/cursor.js',
  './src/gestures.js',
  './src/predict.js',
  './src/lexicon.js',
  './src/demopath.js',
  './src/tracker.js',
  './src/store.js',
  './src/calibrate.js',
  './src/scanning.js',
  './src/landing.js',
  './src/scroll.js',
  './src/hero3d.js',
  './dist/app.bundle.js',
  './dist/landing.bundle.js',
  './manifest.webmanifest',
  './assets/icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![SHELL, RUNTIME].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // MediaPipe CDN + Google model storage + fonts -> stale-while-revalidate
  const isRuntimeAsset =
    /cdn\.jsdelivr\.net/.test(url.host) ||
    /cdnjs\.cloudflare\.com/.test(url.host) ||
    /storage\.googleapis\.com/.test(url.host) ||
    /fonts\.(googleapis|gstatic)\.com/.test(url.host);

  if (isRuntimeAsset) {
    e.respondWith(
      caches.open(RUNTIME).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => { if (res.ok) cache.put(request, res.clone()); return res; })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Same-origin app shell -> cache-first, fall back to network.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./app.html')))
    );
  }
});
