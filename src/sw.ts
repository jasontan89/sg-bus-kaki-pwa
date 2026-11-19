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

// Cache SVG & image assets (like mrt_map.svg and bus mascot)
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

const SW_API_BASE = 'https://blcsjvifiytbznwesmyx.supabase.co/functions/v1/pwa_api';
const FALLBACK_VAPID_PUBLIC_KEY =
  'BHSw8VkpCSgUdC1_XRhHMvLMdm7w-VhRH_tahYM2ZXOBAhQ2A80SPwEvakojni6fs7gT3R_ke7ZKspb6w79rBw8';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Pure event-driven Web Push handler (no long-running loops so Android Chrome never kills the SW)
self.addEventListener('push', (event) => {
  let data: any = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      try {
        data = { body: event.data.text() };
      } catch {
        data = {};
      }
    }
  }

  const payloadData = data.data || {};
  const payloadType = payloadData.type || data.type || 'BUS_ALARM';
  const isAlightAlarm = payloadType === 'ALIGHT_ALARM';
  const isAlightPreAlert = payloadType === 'ALIGHT_PRE_ALERT';

  const title =
    data.title || (isAlightAlarm ? '⏰ ALIGHT NOW!' : '🚌 Bus Kaki Alert');

  const actions =
    isAlightAlarm || isAlightPreAlert
      ? [
          { action: 'alighted', title: '✅ I Have Alighted' },
          { action: 'open', title: 'Open Ride HUD' },
        ]
      : [
          { action: 'open', title: 'Open Bus Kaki' },
          { action: 'dismiss', title: 'Dismiss' },
        ];

  const vibrate = isAlightAlarm
    ? [800, 250, 800, 250, 1200, 250, 1200]
    : isAlightPreAlert
    ? [350, 150, 350]
    : [500, 200, 500, 200, 1000];

  const options: any = {
    body: data.body || 'Your bus alert has triggered!',
    icon: data.icon && !String(data.icon).endsWith('.svg') ? data.icon : '/icon-192.png',
    badge: data.badge && !String(data.badge).endsWith('.svg') ? data.badge : '/icon-192.png',
    tag: data.tag || `${isAlightAlarm ? 'alight-now' : 'bus-kaki'}-${Date.now()}`,
    renotify: true,
    silent: false,
    timestamp: Date.now(),
    data: payloadData,
    vibrate,
    requireInteraction: true,
    actions,
  };

  const clientMessageType = isAlightAlarm
    ? 'PUSH_ALIGHT_TRIGGERED'
    : isAlightPreAlert
    ? 'PUSH_ALIGHT_PRE_ALERT'
    : 'PUSH_ALARM_TRIGGERED';

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options as any),
      self.clients
        .matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          for (const client of clientList) {
            client.postMessage({
              type: clientMessageType,
              title,
              body: options.body,
              tag: options.tag,
              data: options.data,
            });
          }
        })
        .catch(() => {}),
    ])
  );
});

// Auto-rotate and re-register FCM push subscription if Chrome refreshes the token in the background
self.addEventListener('pushsubscriptionchange', (event: any) => {
  event.waitUntil(
    (async () => {
      try {
        let vapidKey = FALLBACK_VAPID_PUBLIC_KEY;
        try {
          const res = await fetch(`${SW_API_BASE}/api/vapid-public-key`);
          if (res.ok) {
            const j = await res.json();
            if (j?.publicKey) vapidKey = j.publicKey;
          }
        } catch {
          // Use fallback VAPID key
        }

        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey) as any,
        });

        const json = newSub.toJSON();
        if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
          await fetch(`${SW_API_BASE}/api/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              endpoint: json.endpoint,
              keys: {
                p256dh: json.keys.p256dh,
                auth: json.keys.auth,
              },
            }),
          });
        }
      } catch (err) {
        console.warn('SW pushsubscriptionchange recovery failed:', err);
      }
    })()
  );
});

// Handle direct notification dispatch requests from client window (fast, single-shot, never loops)
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    if (title) {
      event.waitUntil(
        self.registration.showNotification(title, {
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          renotify: true,
          silent: false,
          requireInteraction: true,
          vibrate: [500, 250, 500, 250, 1000],
          ...options,
        } as any)
      );
    }
  }
});

// Handle notification tap / lock-screen actions
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};

  // 1-Tap Lock-Screen "I Have Alighted" Action: cancel server pulses & clear client alarm immediately
  if (event.action === 'alighted') {
    event.waitUntil(
      (async () => {
        try {
          const allNotes = await self.registration.getNotifications();
          for (const n of allNotes) {
            if (n.tag && n.tag.startsWith('alight-')) {
              n.close();
            }
          }
        } catch {}

        try {
          const sub = await self.registration.pushManager.getSubscription();
          await fetch(`${SW_API_BASE}/api/alight-alarm/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              alarmId: notifData.alarmId || null,
              endpoint: sub?.endpoint || null,
            }),
          });
        } catch {}

        try {
          const clientList = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true,
          });
          for (const client of clientList) {
            client.postMessage({
              type: 'ALIGHT_ALARM_DISMISSED',
              alarmId: notifData.alarmId || null,
            });
          }
        } catch {}
      })()
    );
    return;
  }

  if (event.action === 'dismiss') {
    return;
  }

  let targetUrl = notifData.url || '/';

  // Prevent Open Redirect / Phishing: Ensure targetUrl is strictly a safe relative path
  if (
    typeof targetUrl !== 'string' ||
    !targetUrl.startsWith('/') ||
    targetUrl.startsWith('//') ||
    targetUrl.includes('://')
  ) {
    targetUrl = '/';
  }

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
