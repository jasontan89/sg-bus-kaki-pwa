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
      icon: data.icon && !data.icon.endsWith('.svg') ? data.icon : '/icon-192.png',
      badge: data.badge && !data.badge.endsWith('.svg') ? data.badge : '/icon-192.png',
      tag: data.tag || 'bus-kaki-notification',
      renotify: true,
      silent: false,
      data: data.data || {},
      vibrate: [500, 200, 500, 200, 1000],
      requireInteraction: true,
      actions: [
        { action: 'open', title: 'Open Bus Kaki' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    };

    event.waitUntil(
      Promise.all([
        self.registration.showNotification(title, options as any),
        self.clients
          .matchAll({ type: 'window', includeUncontrolled: true })
          .then((clientList) => {
            for (const client of clientList) {
              client.postMessage({
                type: 'PUSH_ALARM_TRIGGERED',
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
  } catch (err) {
    console.error('Error handling push event:', err);
  }
});

const SW_API_BASE = 'https://blcsjvifiytbznwesmyx.supabase.co/functions/v1/pwa_api';
let swActiveAlarms: any[] = [];
let swMonitorRunning = false;

async function runSwAlarmMonitorLoop() {
  if (swMonitorRunning) return;
  swMonitorRunning = true;

  try {
    // Poll every 15s while active alarms remain
    while (swActiveAlarms.length > 0) {
      for (const alarm of [...swActiveAlarms]) {
        try {
          const res = await fetch(
            `${SW_API_BASE}/bus-arrivals?stop=${encodeURIComponent(alarm.bus_stop_code)}`
          );
          if (res.ok) {
            const data = await res.json();
            const svc = (data.services || []).find(
              (s: any) =>
                String(s.serviceNo).toLowerCase() === String(alarm.service_no).toLowerCase()
            );
            const etaMins = svc?.nextBus?.etaMinutes;

            if (etaMins !== null && etaMins !== undefined && etaMins <= alarm.lead_mins) {
              // Remove from SW active list so it only fires once
              swActiveAlarms = swActiveAlarms.filter((a) => a.id !== alarm.id);

              const title = `🚌 Bus ${alarm.service_no} Arriving!`;
              const body = `Bus ${alarm.service_no} is arriving ${
                etaMins <= 0 ? 'now' : `in ${etaMins} mins`
              } at ${alarm.bus_stop_name || alarm.bus_stop_code}!`;
              const tag = `bus-alarm-${alarm.id || `${alarm.bus_stop_code}_${alarm.service_no}`}`;
              const alarmData = {
                alarmId: alarm.id,
                stopCode: alarm.bus_stop_code,
                serviceNo: alarm.service_no,
                url: `/?stop=${alarm.bus_stop_code}`,
              };

              await self.registration.showNotification(title, {
                body,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                tag,
                renotify: true,
                silent: false,
                requireInteraction: true,
                vibrate: [500, 250, 500, 250, 1000],
                data: alarmData,
              } as any);

              const clientList = await self.clients.matchAll({
                type: 'window',
                includeUncontrolled: true,
              });
              for (const client of clientList) {
                client.postMessage({
                  type: 'PUSH_ALARM_TRIGGERED',
                  title,
                  body,
                  tag,
                  data: alarmData,
                });
              }
            }
          }
        } catch {
          // Ignore transient fetch errors
        }
      }

      if (swActiveAlarms.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
  } finally {
    swMonitorRunning = false;
  }
}

// Handle direct notification dispatch and background alarm sync from client window
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
  } else if (event.data.type === 'SYNC_BUS_ALARMS') {
    swActiveAlarms = Array.isArray(event.data.alarms) ? event.data.alarms : [];
    if (swActiveAlarms.length > 0 && !swMonitorRunning) {
      event.waitUntil(runSwAlarmMonitorLoop());
    }
  }
});

// Handle notification tap / click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  let targetUrl = (event.notification.data && event.notification.data.url) || '/';

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
