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
let swActiveAlarms: any[] = [];
let swActiveAlightAlarm: any | null = null;
let swMonitorRunning = false;

// Handle Web Push event for native Android / iOS notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
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
      icon: data.icon && !data.icon.endsWith('.svg') ? data.icon : '/icon-192.png',
      badge: data.badge && !data.badge.endsWith('.svg') ? data.badge : '/icon-192.png',
      tag: data.tag || (isAlightAlarm ? 'alight-now-alert' : 'bus-kaki-notification'),
      renotify: true,
      silent: false,
      data: payloadData,
      vibrate,
      requireInteraction: true,
      actions,
    };

    if (isAlightAlarm) {
      swActiveAlightAlarm = null;
    }

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
  } catch (err) {
    console.error('Error handling push event:', err);
  }
});

async function runSwAlarmMonitorLoop() {
  if (swMonitorRunning) return;
  swMonitorRunning = true;

  try {
    // Poll every 15s while active arrival or alighting alarms remain in warm SW memory
    while (swActiveAlarms.length > 0 || swActiveAlightAlarm !== null) {
      // 1. Check Bus Arrival Alarms
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

      // 2. Backup Check for Active Cloud Alight Alarm while SW stays warm
      if (swActiveAlightAlarm && !swActiveAlightAlarm.isTriggered) {
        try {
          const currentAlight = swActiveAlightAlarm;
          const params = new URLSearchParams();
          if (currentAlight.serverAlarmId) {
            params.set('id', String(currentAlight.serverAlarmId));
          }
          if (currentAlight.endpoint) {
            params.set('endpoint', String(currentAlight.endpoint));
          }
          if (params.toString()) {
            const res = await fetch(`${SW_API_BASE}/api/alight-alarm/status?${params.toString()}`);
            if (res.ok) {
              const json = await res.json();
              const srv = json.alarm;
              if (!srv) {
                swActiveAlightAlarm = null;
              } else if (
                srv.fired ||
                (srv.estimated_distance_meters !== null &&
                  srv.estimated_distance_meters <= srv.threshold_meters)
              ) {
                swActiveAlightAlarm = null;
                const stopLabel = srv.target_stop_name || currentAlight.stopName || srv.target_stop_code;
                const distVal = srv.estimated_distance_meters ?? srv.threshold_meters;
                const title = `⏰ ALIGHT NOW: ${stopLabel}`;
                const body = srv.service_no
                  ? `Bus ${srv.service_no} is ~${distVal}m from ${stopLabel}! Prepare to alight now.`
                  : `Approaching ${stopLabel} (~${distVal}m)! Prepare to alight now.`;
                const alightData = {
                  type: 'ALIGHT_ALARM',
                  alarmId: srv.id,
                  stopCode: srv.target_stop_code,
                  stopName: stopLabel,
                  distanceMeters: distVal,
                  url: `/?alight=hud&stop=${encodeURIComponent(srv.target_stop_code)}`,
                };

                await self.registration.showNotification(title, {
                  body,
                  icon: '/icon-192.png',
                  badge: '/icon-192.png',
                  tag: `alight-now-${srv.id}-sw`,
                  renotify: true,
                  silent: false,
                  requireInteraction: true,
                  vibrate: [800, 250, 800, 250, 1200, 250, 1200],
                  actions: [
                    { action: 'alighted', title: '✅ I Have Alighted' },
                    { action: 'open', title: 'Open Ride HUD' },
                  ],
                  data: alightData,
                } as any);

                const clientList = await self.clients.matchAll({
                  type: 'window',
                  includeUncontrolled: true,
                });
                for (const client of clientList) {
                  client.postMessage({
                    type: 'PUSH_ALIGHT_TRIGGERED',
                    title,
                    body,
                    tag: `alight-now-${srv.id}-sw`,
                    data: alightData,
                  });
                }
              }
            }
          }
        } catch {
          // Ignore transient fetch errors
        }
      }

      if (swActiveAlarms.length === 0 && swActiveAlightAlarm === null) break;
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
    if ((swActiveAlarms.length > 0 || swActiveAlightAlarm !== null) && !swMonitorRunning) {
      event.waitUntil(runSwAlarmMonitorLoop());
    }
  } else if (event.data.type === 'SYNC_ALIGHT_ALARM') {
    swActiveAlightAlarm = event.data.alarm && event.data.alarm.armed ? event.data.alarm : null;
    if ((swActiveAlarms.length > 0 || swActiveAlightAlarm !== null) && !swMonitorRunning) {
      event.waitUntil(runSwAlarmMonitorLoop());
    }
  }
});

// Handle notification tap / lock-screen actions
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};

  // 1-Tap Lock-Screen "I Have Alighted" Action: cancel server pulses & clear client alarm immediately
  if (event.action === 'alighted') {
    swActiveAlightAlarm = null;
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
