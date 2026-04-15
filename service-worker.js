const CACHE_VERSION = '2026-04-15-1';
const CACHE_NAME = `recipe-journal-${CACHE_VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './src/recipe-lib.js',
  './src/recipe-render.js',
  './src/recipe-schema.js',
  './src/seed-images.js',
  './build/public/recipes.json',
];

const APP_SHELL_URLS = APP_SHELL.map((path) => new URL(path, self.location).toString());
const APP_SHELL_SET = new Set(APP_SHELL_URLS);
const INDEX_URL = new URL('./index.html', self.location).toString();

async function warmAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(APP_SHELL);
}

async function putInCache(request, response) {
  if (!response || (response.status !== 200 && response.type !== 'opaque')) {
    return response;
  }
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => putInCache(request, response))
    .catch(() => null);

  if (cached) {
    void network;
    return cached;
  }

  const fresh = await network;
  if (fresh) return fresh;

  if (request.mode === 'navigate') {
    return cache.match(INDEX_URL);
  }

  return Response.error();
}

self.addEventListener('install', (event) => {
  event.waitUntil(warmAppShell());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('recipe-journal-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isGoogleFont =
    url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com';
  const shouldHandleSameOrigin =
    request.mode === 'navigate' ||
    APP_SHELL_SET.has(url.toString()) ||
    url.pathname.startsWith(new URL('./src/', self.location).pathname) ||
    url.pathname.startsWith(new URL('./build/public/', self.location).pathname);

  if (!shouldHandleSameOrigin && !isGoogleFont && !isSameOrigin) {
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
