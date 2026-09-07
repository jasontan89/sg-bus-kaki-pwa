/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare let self: ServiceWorkerGlobalScope;

// Cleanup old caches and precache Vite build assets
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

// Cache OpenStreetMap map tiles for offline viewing
registerRoute(
  ({ url }) => url.origin.includes('tile.openstreetmap.org') || url.pathname.includes('/tiles/'),
  new CacheFirst({
    cacheName: 'osm-map-tiles',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 500,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
      }),
    ],
  })
);

// Cache SVG assets (like mrt_map.svg and bus mascot)
registerRoute(
  ({ request }) => request.destination === 'image',
  new StaleWhileRevalidate({
    cacheName: 'image-assets',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 7 * 24 * 60 * 60,
      }),
    ],
  })
);

// Handle Web Push event for native Android notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const title = data.title || '🚌 Bus Kaki Alert';
    const options: any = {
      body: data.body || 'Your bus is arriving soon!',
      icon: data.icon || '/icon-192.png',
      badge: data.badge || '/favicon.svg',
      tag: data.tag || 'bus-kaki-notification',
      data: data.data || {},
      vibrate: [200, 100, 200, 100, 400],
      requireInteraction: true,
      actions: [
        { action: 'open', title: 'Open Bus Kaki' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    };

    event.waitUntil(self.registration.showNotification(title, options as any));
  } catch (err) {
    console.error('Error handling push event:', err);
  }
});

// Handle notification tap / click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// Immediate activation on update
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
