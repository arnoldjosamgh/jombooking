// Jomish Service Worker

const CACHE_NAME = 'jomish-cache-v21';
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
  if (!event.data) return;
  const data = event.data.json();
  const type = data.type || 'default';

  // Style per notification type
  let badge  = '/img/logo.png';
  let vibrate = [100, 50, 100];
  let actions = [];
  let tag = 'jomish-default';

  if (type === 'download-receipt') {
    vibrate = [200, 100, 200, 100, 200];
    actions = [{ action: 'download', title: 'Download Receipt' }];
    tag = 'jomish-receipt';
  } else if (type === 'cancelled') {
    vibrate = [300, 100, 300];
    tag = 'jomish-cancelled';
  } else if (type === 'order-ready') {
    vibrate = [100, 50, 100, 50, 100];
    tag = 'jomish-ready';
  }

  const options = {
    body:    data.body || 'You have a new update.',
    icon:    data.icon || '/img/logo.png',
    badge,
    vibrate,
    tag,
    renotify: true,
    actions,
    data: {
      url:  data.url || '/',
      type: type
    }
  };
  event.waitUntil(self.registration.showNotification(data.title || 'Jomish', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let { url } = event.notification.data;
  
  // Resolve clean paths to actual .html files for direct navigation
  // e.g. /seller -> /seller.html, /c/my-biz -> /c.html?slug=my-biz
  function resolveUrl(rawUrl) {
    const base = self.location.origin;
    const parsed = new URL(rawUrl, base);
    const segments = parsed.pathname.split('/').filter(Boolean);
    
    if (segments.length === 0) return rawUrl;
    
    const type = segments[0];
    const slug = segments[1];
    const search = parsed.search;
    
    if (type === 'seller') return `${base}/seller.html`;
    if (type === 'tech')   return `${base}/tech.html`;
    if (type === 'setup')  return `${base}/setup.html`;
    if (type === 'login')  return `${base}/login.html`;
    if (type === 'order' && slug) return `${base}/order.html?slug=${slug}${search ? '&' + search.slice(1) : ''}`;
    if (type === 'book'  && slug) return `${base}/book.html?slug=${slug}${search ? '&' + search.slice(1) : ''}`;
    if (type === 'c'     && slug) return `${base}/c.html?slug=${slug}${search ? '&' + search.slice(1) : ''}`;
    
    return rawUrl;
  }
  
  const resolvedUrl = resolveUrl(url);
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      const targetUrl = new URL(resolvedUrl, self.location.origin);
      
      // Focus existing tab if its path matches
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        if (clientUrl.pathname === targetUrl.pathname && 'focus' in client) {
          // Post message to existing tab to trigger actions (e.g. receipt download)
          client.postMessage({ type: event.notification.data.type, url });
          return client.focus();
        }
      }
      // Open new window with the resolved URL
      return clients.openWindow(resolvedUrl);
    })
  );
});
