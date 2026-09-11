// Jomish Service Worker

const CACHE_NAME = 'jomish-cache-v9';
const STATIC_ASSETS = [
  '/css/style.css',
  '/js/app.js',
  '/js/login.js',
  '/js/tech.js',
  '/js/setup.js',
  '/js/seller.js',
  '/js/order.js',
  '/js/book.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Network-first for everything — always try fresh from server, fall back to cache if offline
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') {
    return; // Don't cache API requests or non-GET
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Cache the fresh response
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });
      })
      .catch(() => {
        // Network failed — serve from cache (offline fallback)
        return caches.match(event.request);
      })
  );
});

// Push Notifications
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body || 'You have a new update.',
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23f4a81d"/><text x="50%" y="65%" font-size="60" text-anchor="middle" fill="%23050c1a" font-family="sans-serif">J</text></svg>',
      vibrate: [100, 50, 100],
      data: { url: data.url || '/seller' }
    };
    event.waitUntil(self.registration.showNotification(data.title || 'Jomish', options));
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});
