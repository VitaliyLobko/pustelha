importScripts('./version.js');

const PREFIX = 'pustelha-';
const CACHE = `${PREFIX}${self.APP_VERSION}-${self.APP_BUILD}`;
const ASSETS = [
  './',
  './index.html',
  './version.js',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/ballistics.js',
  './js/ui.js',
  './js/wind-pick.js',
  './js/sim.js',
  './js/settings.js',
  './js/theme-boot.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// Файли — повз HTTP-кеш браузера: GitHub Pages віддає max-age=600, і без reload
// оновлення 10 хвилин після релізу ставило б старі файли.
const precache = () => caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))));

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

/** Сусідні застосунки на цьому ж домені можуть стерти чужий кеш — при відкритті з мережею докладаємо, чого бракує. */
async function repairCache() {
  const cache = await caches.open(CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const missing = ASSETS.map((url) => new URL(url, self.registration.scope).href).filter((url) => !have.has(url));
  if (missing.length) await cache.addAll(missing.map((url) => new Request(url, { cache: 'reload' })));
}

// Кеші інших застосунків на тому ж домені не чіпаємо — лише свої старі версії.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') event.waitUntil(repairCache().catch(() => {}));
  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true, cacheName: CACHE });
    if (cached) return cached;
    try {
      return await fetch(request);
    } catch (err) {
      if (request.mode === 'navigate') return caches.match('./index.html', { cacheName: CACHE });
      throw err;
    }
  })());
});
