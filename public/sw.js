// Service Worker — offline support for Beam Veda
const CACHE_NAME = 'beam-veda-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.json', '/icon.svg', '/image-utils.js', '/i18n/index.js', '/i18n/en.js', '/i18n/hi.js', '/i18n/hi-mixed.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) { const clone = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)); }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('/index.html');
      });
    })
  );
});
