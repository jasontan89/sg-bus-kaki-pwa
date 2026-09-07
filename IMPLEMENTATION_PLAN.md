# 🇸🇬 SG Bus Kaki PWA - Implementation Plan

> **Progressive Web Application (PWA) for Singapore Commuters & Android Users**  
> *Optimized for fast mobile use, offline resilience in MRT tunnels, dynamic bus arrival push alerts, and active alighting wake-up alarms.*

---

## 📌 Executive Summary & Decisions

Based on the architectural discovery and requirements interview, this application is designed as a standalone **Progressive Web App (PWA)** that provides a first-class native app experience on Android devices without requiring Google Play Store distribution.

### Key Architectural Decisions
1. **Frontend**: Vite + React 18 + TypeScript + Tailwind CSS with `vite-plugin-pwa` (Workbox) for automated Service Worker management and asset caching.
2. **Backend**: Dedicated Supabase Edge Function `pwa_api` (hosted in Deno on Supabase), isolated from the existing Telegram bot, responsible for LTA DataMall proxying, VAPID Web Push dispatch, and cron-based alert monitoring.
3. **Push Notifications**: Standard W3C Web Push with VAPID keys. Delivers native Android notifications even when the browser is closed or phone screen is locked.
4. **Alighting Alarm**: Active Ride HUD utilizing the W3C Screen Wake Lock API (`navigator.wakeLock`) combined with an ultra-low-power OLED black theme, Web Audio API synthesizer buzzer, and continuous haptic vibrations.
5. **Offline Support**: Full offline caching of app shell, the complete 5,000+ Singapore bus stop directory, and vector MRT system map via IndexedDB and Service Worker caching.

---

## 🗂️ Project Directory Structure

Target Root: `C:\Users\tanse\Documents\Antigravity\PWA Buss App`

```
PWA Buss App/
├── public/
│   ├── favicon.ico
│   ├── icon-192.png                  # PWA Home Screen Icon (Android)
│   ├── icon-512.png                  # PWA Splash Screen Icon
│   ├── icon-maskable.png             # Android Adaptive/Maskable Icon
│   ├── mrt_map.svg                   # High-Res Singapore MRT/LRT Network Vector Map
│   └── alarm.mp3                     # Alighting Wake-up Alarm Sound
├── src/
│   ├── assets/                       # Brand icons and illustrations
│   ├── components/
│   │   ├── Header.tsx                # App bar with live SGT clock, offline badge, and PWA install prompt
│   │   ├── Navigation.tsx            # Sticky bottom navigation bar (Nearby, Favs, Search, MRT, Alerts)
│   │   ├── BusArrivalCard.tsx        # Live bus countdown, crowd load pill (SEA/SDA/LSD), fleet types (DD/WAB)
│   │   ├── BusFilterModal.tsx        # Filter visible bus services per stop
│   │   ├── SetArrivalAlarmModal.tsx  # Dynamic countdown alert selector (e.g. 2m, 3m, 5m away)
│   │   ├── ActiveRideHUD.tsx         # Fullscreen OLED black ride mode with Screen Wake Lock & buzzer
│   │   ├── LeafletMap.tsx            # Leaflet radar map with commuter marker and bus stop pins
│   │   └── Toast.tsx                 # Non-blocking notification toasts
│   ├── views/
│   │   ├── NearbyView.tsx            # Split-screen map + nearby stops list
│   │   ├── FavoritesView.tsx         # Pinned favorite stops with 1-tap bulk refresh
│   │   ├── SearchView.tsx            # Fuzzy search for 5,000+ bus stops and route sequences
│   │   ├── MrtMapView.tsx            # Interactive pan/zoom MRT system map with platform crowds
│   │   └── AlertsView.tsx            # Web Push permissions, MRT line alert subscriptions & active alarms
│   ├── services/
│   │   ├── api.ts                    # REST client connecting to Supabase Edge Function pwa_api
│   │   ├── pushManager.ts            # VAPID subscription, PushManager & permission lifecycle
│   │   ├── alarmManager.ts          # Alighting alarm calculation, Wake Lock & Web Audio synthesizer
│   │   ├── offlineStorage.ts         # IndexedDB manager for offline bus stops & user preferences
│   │   └── busStopsData.ts           # Pre-compiled bus stop directory for zero-latency lookups
│   ├── types/
│   │   └── transit.ts                # TypeScript interfaces (BusArrival, BusStop, Route, PushAlert)
│   ├── sw.ts                         # Custom Service Worker (Push event handler & background sync)
│   ├── App.tsx                       # Root view router and active alarm state provider
│   ├── main.tsx                      # Application bootstrap & PWA registration
│   └── index.css                     # Tailwind CSS and mobile touch optimizations
├── supabase/
│   └── functions/
│       └── pwa_api/
│           ├── index.ts              # Deno Edge Function router & LTA DataMall proxy
│           ├── web_push.ts           # VAPID Web Push encryption & dispatch engine
│           └── database.sql          # PostgreSQL migration for subscriptions and alarms
├── package.json                      # Project dependencies & build scripts
├── vite.config.ts                    # Vite build configuration with vite-plugin-pwa
├── tsconfig.json                     # TypeScript configuration
├── tailwind.config.js                # Tailwind mobile palette (Navy #0b132b, Transit Blue #2563eb)
├── ARCHITECTURE.md                   # In-depth architectural blueprint
└── README.md                         # Developer setup and onboarding instructions
```

---

## 🚀 Step-by-Step Implementation Roadmap

### Phase 1: Project Foundation & Tooling Setup
- [ ] Initialize project with Vite + React 18 + TypeScript template.
- [ ] Install production dependencies:
  - `leaflet`, `@types/leaflet`
  - `lucide-react` (high-performance lightweight transit iconography)
  - `idb` (clean Promise-based wrapper for browser IndexedDB)
  - `web-push` utilities
- [ ] Configure Tailwind CSS with mobile-first viewport rules and transit palette:
  - Brand Navy: `#0b132b`, `#1c2541`
  - Transit Blue: `#2563eb`, `#1d4ed8`
  - Accent Sky: `#38bdf8`
  - Crowd green: `#16a34a`, amber: `#d97706`, purple: `#7c3aed`
- [ ] Setup `vite-plugin-pwa` in `vite.config.ts`:
  - `registerType: 'autoUpdate'`
  - Web App Manifest: name, short_name, background_color, theme_color, standalone display, maskable icons.
  - Workbox runtime caching rules for static assets and CDN tiles.

### Phase 2: Data Models & API Integration Layer
- [ ] Define transit types in `src/types/transit.ts`:
  - `BusArrival`, `BusService`, `NextBusInfo` (Load: SEA/SDA/LSD, Feature: WAB, Type: SD/DD/BD).
  - `BusStop` (code, description, road, latitude, longitude, distance).
  - `BusRouteStop` (service, direction, stop sequence, distance, first/last bus hours).
  - `PushSubscriptionPayload` (endpoint, keys, preferences).
  - `BusAlarm` (stopCode, serviceNo, targetMins, armedAt, fired).
  - `MRTSubscription` (lineCode: NSL/EWL/CCL/DTL/NEL/TEL, filter: major/all).
- [ ] Implement `src/services/api.ts`:
  - `fetchNearbyStops(lat, lon, limit)`
  - `fetchBusArrivals(stopCode)`
  - `searchBusStops(query)`
  - `fetchBusRoute(serviceNo, direction)`
  - `fetchMRTAlerts()`

### Phase 3: Offline Storage & Bus Stop Catalog
- [ ] Implement `src/services/offlineStorage.ts` with `idb`:
  - Store `bus_stops` table: full 5,000+ Singapore bus stop codes, names, roads, coordinates.
  - Store `favorites` table: pinned user bus stops and custom service filters.
  - Store `alarms` table: pending arrival alarms and alighting alarms.
- [ ] Seed initial bus stop catalog from LTA DataMall into compressed static JSON (`busStopsData.ts`).
- [ ] Provide offline fuzzy search matching stop code or road name without network connection.

### Phase 4: Core Navigation & Commuter Views
- [ ] **App Header & Bottom Navigation** (`Header.tsx`, `Navigation.tsx`):
  - Sticky header with real-time Singapore Time (SGT UTC+8) clock and network status indicator (Online/Offline).
  - Install PWA prompt banner for first-time Android visitors (`beforeinstallprompt` event).
  - Bottom navigation bar switching between:
    1. 🚏 **Nearby**
    2. ⭐ **Favorites**
    3. 🔍 **Search & Routes**
    4. 🚆 **MRT Network**
    5. 🔔 **Alerts Hub**
- [ ] **Nearby View** (`NearbyView.tsx` + `LeafletMap.tsx`):
  - Split-screen layout: interactive Leaflet map with dark slate OpenStreetMap tiles on top, collapsible list below.
  - Commuter location avatar pin with recenter GPS floating action button.
  - Bus stop pins on map showing description tags.
  - Expandable arrival drawer showing live arrivals with crowd load badges (🟢 SEA, 🟡 SDA, 🔴 LSD) and fleet badges (DD, WAB).
  - Action pills: ⭐ Save Favorite, ⚙️ Filter Buses, 🔔 Alight Alarm.
- [ ] **Favorites View** (`FavoritesView.tsx`):
  - Pinned stop cards with 1-tap "Refresh All" button.
  - Per-stop service filter modal (`BusFilterModal.tsx`) allowing users to hide services they don't take.
  - Custom stop renaming support.
- [ ] **Search & Route View** (`SearchView.tsx`):
  - Instant debounce search bar querying both stops and bus route numbers.
  - Route sequence explorer displaying sequential stops, distance between stops, and weekday/weekend operating schedules.
- [ ] **MRT Map View** (`MrtMapView.tsx`):
  - High-res vector SVG Singapore MRT/LRT network map.
  - Pinch-to-zoom and multi-touch pan controls with reset button.
  - Live 6-line operational health status indicators and platform crowd densities.

### Phase 5: Web Push Notification System
- [ ] Implement `src/services/pushManager.ts`:
  - Request browser `Notification.permission`.
  - Fetch public VAPID key from Supabase Edge Function `pwa_api`.
  - Call `navigator.serviceWorker.ready` and `registration.pushManager.subscribe()`.
  - Persist subscription in Supabase PostgreSQL table `pwa_push_subscriptions`.
- [ ] Implement custom Service Worker `src/sw.ts`:
  - `self.addEventListener('push', ...)`:
    - Parse JSON payload containing title, body, icon, badge, data (stopCode, serviceNo, url).
    - Trigger `self.registration.showNotification(title, options)`.
    - Android vibration pattern: `[300, 100, 300, 100, 500]`.
  - `self.addEventListener('notificationclick', ...)`:
    - Dismiss notification and navigate or focus PWA to target view (e.g. `/stop/01012`).
- [ ] Implement **Dynamic Bus Arrival Countdown Alarm**:
  - Modal in `SetArrivalAlarmModal.tsx`: User picks lead time (e.g., "Alert me when Bus 65 is 2m, 3m, or 5m away").
  - Client registers alert with backend `/api/bus-alarm`.
  - Backend worker checks LTA arrivals every 60s; when arrival ETA matches lead time, dispatches Web Push notification.
- [ ] Implement **MRT Disruption Push Alerts**:
  - Subscriptions manager in `AlertsView.tsx`: User toggles daily lines (NSL, EWL, CCL, DTL, NEL, TEL) and selects sensitivity (Major breakdowns only vs All advisories).
  - Backend broadcasts push notification when LTA `TrainServiceAlerts` detects incident.

### Phase 6: Active Ride HUD & Alighting Wake-Up Alarm
- [ ] Implement `src/services/alarmManager.ts`:
  - Haversine distance calculator between current GPS coordinates and destination bus stop.
  - W3C Screen Wake Lock API integration:
    ```typescript
    let wakeLock: WakeLockSentinel | null = null;
    async function requestWakeLock() {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    }
    ```
  - Web Audio API Sound Synthesizer:
    - Generates a loud multi-tone repeating buzzer sequence without depending on external audio file downloads.
  - Tactile Haptics:
    - Continuous repeating vibration pattern `navigator.vibrate([800, 300, 800, 300, 1200])`.
- [ ] Implement `src/components/ActiveRideHUD.tsx`:
  - Dedicated fullscreen commute HUD that automatically activates when an alighting alarm is armed.
  - Pitch-black OLED theme (`#000000`) with high-contrast amber/cyan readouts to conserve battery while phone screen is kept on.
  - Displays: Destination stop name, code, remaining distance (e.g., `1.8 km`), proximity alert threshold (`500 m`), and animated journey progress bar.
  - Loud alarm screen with pulsing visual buzzer when within 500m.
  - One-tap "Stop Alarm" and "Dismiss" controls.

### Phase 7: Backend Supabase Edge Function (`pwa_api`)
- [ ] Create `supabase/functions/pwa_api/index.ts`:
  - CORS middleware supporting PWA origin.
  - Routes:
    - `GET /api/vapid-public-key`
    - `POST /api/subscribe`
    - `POST /api/bus-alarm`
    - `DELETE /api/bus-alarm/:id`
    - `GET /api/bus-nearby`
    - `GET /api/bus-arrivals`
    - `GET /api/bus-search`
    - `GET /api/bus-route`
    - `POST /api/cron-check` (evaluates bus arrival alarms and MRT disruption alerts).
- [ ] Create `supabase/functions/pwa_api/web_push.ts`:
  - Native Web Push dispatch using VAPID authorization headers and standard encrypted payload delivery.
- [ ] Create database migration `supabase/functions/pwa_api/database.sql`:
  - `pwa_push_subscriptions`
  - `pwa_bus_alarms`
  - `pwa_mrt_subscriptions`

### Phase 8: Testing & Verification
- [ ] Run `npm run build` to verify clean TypeScript compilation and zero bundle warnings.
- [ ] Run Lighthouse PWA audit: verify 100% PWA score (service worker registered, manifest valid, responsive viewport, offline capability).
- [ ] Test on Android device:
  - Install app to home screen from Chrome ("Add to Home Screen").
  - Test Web Push notification receipt with screen locked.
  - Test Active Ride HUD alighting buzzer with simulated GPS movement.
  - Test offline transit search in Airplane Mode.

---

## 🎯 Verification Checklist

| Feature | Expected Behavior | Verification Method |
| :--- | :--- | :--- |
| **PWA Installability** | Android prompts "Install SG Bus Kaki", opens full-screen without URL bar | Chrome on Android / DevTools PWA panel |
| **Offline Search** | 5,000+ bus stops searchable with Airplane Mode enabled | Toggle Offline in Network tab |
| **Bus Arrivals** | Displays live ETA, crowd load colors (SEA/SDA/LSD), and double-decker icons | Compare with LTA DataMall feed |
| **Bus Arrival Push Alert** | Native push arrives when bus is 3m away while phone is locked | Test via `/api/cron-check` trigger |
| **Alighting Alarm HUD** | Screen stays on (Wake Lock), distance decrements, buzzer sounds at 500m | Emulate Geolocation in Chrome DevTools |
| **MRT Disruption Push** | Subscribed lines receive breakdown alert with bridging bus info | Trigger mock train alert via API |
