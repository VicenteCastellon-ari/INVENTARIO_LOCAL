const CACHE_NAME = 'inventario-v2';
const urlsToCache = [
  '/', 
  '/static/manifest.json', 
  '/static/css/style.css', 
  '/static/js/main.js'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || e.request.url.includes('/obtener_productos') || e.request.url.includes('api.vercel.app')) {
    return;
  }
  
  e.respondWith(
    caches.match(e.request).then(cachedResponse => {
      const fetchPromise = fetch(e.request).then(networkResponse => {
        caches.open(CACHE_NAME).then(cache => {
          cache.put(e.request, networkResponse.clone());
        });
        return networkResponse;
      });
      return cachedResponse || fetchPromise;
    })
  );
});
