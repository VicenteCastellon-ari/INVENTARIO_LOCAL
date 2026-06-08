const CACHE_NAME = 'inventario-v1'; // Cambia este número (v2, v3) cuando hagas actualizaciones grandes

self.addEventListener('install', (e) => {
  self.skipWaiting(); // Fuerza al navegador a usar el nuevo Service Worker inmediatamente
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/', 
        '/static/manifest.json', 
        '/static/css/style.css', 
        '/static/js/main.js'
      ]);
    })
  );
});

// Estrategia: Red primero. Si no hay internet, usa el caché.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return; // Solo cacheamos peticiones GET, no los POST de ventas

  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // Si hay red y la respuesta es válida, actualizamos el caché en segundo plano
        const resClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, resClone);
        });
        return response;
      })
      .catch(() => {
        // Si falla la red (sin internet), buscamos en el caché
        return caches.match(e.request);
      })
  );
});
