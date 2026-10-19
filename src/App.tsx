import React, { useState, useEffect, useRef } from 'react';
import { TabType, Navigation } from './components/Navigation';
import { Header } from './components/Header';
import { Toast, ToastMessage } from './components/Toast';
import { ActiveRideHUD } from './components/ActiveRideHUD';
import { NearbyView } from './views/NearbyView';
import { FavoritesView } from './views/FavoritesView';
import { SearchView } from './views/SearchView';
import { MrtMapView } from './views/MrtMapView';
import { AlertsView } from './views/AlertsView';
import { AlightingAlarmState, BusStop } from './types/transit';
import {
  calculateHaversineDistanceMeters,
  startContinuousChime,
  stopContinuousChime,
  startBackgroundAudioKeepAlive,
  stopBackgroundAudioKeepAlive,
  unlockAudio,
  releaseScreenWakeLock,
  registerBackgroundTickCallback,
} from './services/alarmManager';
import {
  dispatchNativeNotification,
  subscribeToPush,
  serializeSubscription,
} from './services/pushManager';
import {
  fetchBusArrivals,
  deleteBusArrivalAlarm,
  fetchVapidPublicKey,
  registerPushSubscription,
} from './services/api';
import { seedBusStops, getCachedStopsCount, getFavorites } from './services/offlineStorage';
import { SEED_BUS_STOPS } from './services/busStopsData';
import {
  getStoredBusAlarms,
  removeStoredBusAlarm,
  syncAlarmsWithServiceWorker,
} from './services/alarmStorage';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('nearby');
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [favoritesCount, setFavoritesCount] = useState<number>(0);
  const [searchInitialService, setSearchInitialService] = useState<string>('');
  const [busAlarmsCount, setBusAlarmsCount] = useState<number>(() => getStoredBusAlarms().length);

  // GPS Location state
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLon, setUserLon] = useState<number | null>(null);

  // Toasts state
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Alighting Wake-Up Alarm State (Screen Awake OFF by default as per user design)
  const [alightAlarm, setAlightAlarm] = useState<AlightingAlarmState>({
    armed: false,
    stopCode: '',
    stopName: '',
    roadName: '',
    targetLat: 1.35,
    targetLon: 103.82,
    thresholdMeters: 500,
    currentDistanceMeters: null,
    isTriggered: false,
    keepScreenAwake: false,
  });

  // Synchronous refs for background execution (bypasses React 18 background state batching)
  const alightAlarmRef = useRef<AlightingAlarmState>(alightAlarm);
  const geoWatchId = useRef<number | null>(null);
  const bestAccuracyRef = useRef<number>(Infinity);
  const lastFixTimeRef = useRef<number>(0);
  const lastValidCoordsRef = useRef<{ lat: number; lon: number } | null>(null);
  const coarseStabilizeTimerRef = useRef<any>(null);
  const lastBusAlarmCheckRef = useRef<number>(0);

  useEffect(() => {
    alightAlarmRef.current = alightAlarm;
  }, [alightAlarm]);

  useEffect(() => {
    const updateCount = () => {
      const alarms = getStoredBusAlarms();
      setBusAlarmsCount(alarms.length);
      if (alarms.length === 0 && !alightAlarmRef.current.armed) {
        stopBackgroundAudioKeepAlive();
      }
    };
    window.addEventListener('sg_bus_alarms_updated', updateCount);
    return () => window.removeEventListener('sg_bus_alarms_updated', updateCount);
  }, []);

  // Toast Helper
  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now().toString() + Math.random().toString();
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Seed bus stops into IndexedDB once on start
  useEffect(() => {
    const initStorage = async () => {
      try {
        const count = await getCachedStopsCount();
        if (count < 1000) {
          await seedBusStops(SEED_BUS_STOPS);
          console.log(`Seeded ${SEED_BUS_STOPS.length} bus stops into IndexedDB`);
        }
        const favs = await getFavorites();
        setFavoritesCount(favs.length);
      } catch (err) {
        console.warn('Storage init warning:', err);
      }
    };
    initStorage();
  }, []);

  // Online / Offline Listeners
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      showToast('Back online! Live arrivals synced.', 'success');
    };
    const handleOffline = () => {
      setIsOnline(false);
      showToast('Offline Tunnel Mode activated. Using cached stops.', 'info');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Capture PWA install prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      showToast('Thanks for installing SG Bus Kaki! 🚌', 'success');
    }
    setDeferredPrompt(null);
  };

  // Synchronous proximity evaluator that executes immediately even when PWA is backgrounded
  const evaluateAlightProximity = (lat: number, lon: number) => {
    const current = alightAlarmRef.current;
    if (!current.armed) return;

    const dist = calculateHaversineDistanceMeters(lat, lon, current.targetLat, current.targetLon);
    if (dist === null) return;

    const isNowTriggered = dist <= current.thresholdMeters;

    if (isNowTriggered && !current.isTriggered) {
      // Update ref synchronously first so duplicate callbacks never double-fire
      const updatedState: AlightingAlarmState = {
        ...current,
        currentDistanceMeters: dist,
        isTriggered: true,
      };
      alightAlarmRef.current = updatedState;
      setAlightAlarm(updatedState);

      startContinuousChime(`⏰ Alight Now: ${current.stopName}`);
      dispatchNativeNotification(`⏰ Alight Now: ${current.stopName}`, {
        body: `You are within ${current.thresholdMeters}m of ${current.stopName} (${dist}m away)! Prepare to alight now.`,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'alight-now-alert',
        renotify: true,
        silent: false,
        forceCloudPush: true,
        vibrate: [500, 250, 500, 250, 1000],
      });
      showToast(`⏰ You are within ${current.thresholdMeters}m of ${current.stopName}! Prepare to alight.`, 'error');
    } else if (current.currentDistanceMeters !== dist || current.isTriggered !== isNowTriggered) {
      const updatedState: AlightingAlarmState = {
        ...current,
        currentDistanceMeters: dist,
        isTriggered: isNowTriggered,
      };
      alightAlarmRef.current = updatedState;
      setAlightAlarm(updatedState);
    }
  };

  // GPS Tracking & Anti-Jump Accuracy Filter
  const updateLocation = (pos: GeolocationPosition) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const accuracy = pos.coords.accuracy || 9999;
    const now = Date.now();

    if (!lat || !lon || isNaN(lat) || isNaN(lon)) return;

    // Always evaluate alighting proximity if accuracy is reasonable (<= 350m)
    if (accuracy <= 350) {
      evaluateAlightProximity(lat, lon);
    }

    const applyAcceptedLocation = (acceptedLat: number, acceptedLon: number, acceptedAcc: number) => {
      lastValidCoordsRef.current = { lat: acceptedLat, lon: acceptedLon };
      lastFixTimeRef.current = Date.now();
      bestAccuracyRef.current = Math.min(bestAccuracyRef.current, acceptedAcc);
      setUserLat(acceptedLat);
      setUserLon(acceptedLon);
    };

    // Case 1: Initial startup before any location is locked
    // Wait up to 2.2s if the first reading is a coarse cell-tower triangulation (>180m)
    // so the fine GPS satellite fix locks in cleanly without snapping to an inaccurate stop first.
    if (!lastValidCoordsRef.current) {
      if (accuracy > 180) {
        if (!coarseStabilizeTimerRef.current) {
          coarseStabilizeTimerRef.current = setTimeout(() => {
            coarseStabilizeTimerRef.current = null;
            if (!lastValidCoordsRef.current) {
              applyAcceptedLocation(lat, lon, accuracy);
            }
          }, 2200);
        }
        return;
      }
      if (coarseStabilizeTimerRef.current) {
        clearTimeout(coarseStabilizeTimerRef.current);
        coarseStabilizeTimerRef.current = null;
      }
      applyAcceptedLocation(lat, lon, accuracy);
      return;
    }

    // Case 2: Subsequent updates & returning from background
    // Reject sudden coarse cell-tower/Wi-Fi location jumps (>150m accuracy when we already have a finer fix)
    const timeSinceLastFix = now - lastFixTimeRef.current;
    if (
      accuracy > 150 &&
      accuracy > bestAccuracyRef.current * 2.5 &&
      timeSinceLastFix < 45000
    ) {
      return;
    }

    applyAcceptedLocation(lat, lon, accuracy);
  };

  const startGPS = (forceRestartWatch = false) => {
    if (!navigator.geolocation) return;

    // Relax accuracy floor slightly on manual refresh / resume so fresh real-time GPS fixes apply immediately
    if (bestAccuracyRef.current < 80) {
      bestAccuracyRef.current = 80;
    }

    navigator.geolocation.getCurrentPosition(
      updateLocation,
      (err) => {
        console.warn('Geolocation getCurrentPosition notice:', err);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );

    if (forceRestartWatch && geoWatchId.current !== null) {
      navigator.geolocation.clearWatch(geoWatchId.current);
      geoWatchId.current = null;
    }

    if (geoWatchId.current === null) {
      geoWatchId.current = navigator.geolocation.watchPosition(
        updateLocation,
        (err) => console.warn('Geo watch error:', err),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    }
  };

  // Client-side background & foreground monitor for active Bus Arrival Alarms
  const checkActiveBusAlarms = async () => {
    const now = Date.now();
    if (now - lastBusAlarmCheckRef.current < 12000) return;
    lastBusAlarmCheckRef.current = now;

    const alarms = getStoredBusAlarms();
    if (alarms.length === 0) return;

    for (const alarm of alarms) {
      try {
        const arrivalData = await fetchBusArrivals(alarm.bus_stop_code);
        const svc = (arrivalData.services || []).find(
          (s) => s.serviceNo.toLowerCase() === alarm.service_no.toLowerCase()
        );
        const etaMins = svc?.nextBus?.etaMinutes;

        if (etaMins !== null && etaMins !== undefined && etaMins <= alarm.lead_mins) {
          // Remove from local storage first so it only triggers once
          const alarmKey = alarm.id || `${alarm.bus_stop_code}_${alarm.service_no}`;
          removeStoredBusAlarm(alarmKey);
          if (alarm.id) {
            deleteBusArrivalAlarm(alarm.id, alarm.endpoint).catch(() => {});
          }

          const title = `🚌 Bus ${alarm.service_no} Arriving!`;
          const body = `Bus ${alarm.service_no} is arriving ${
            etaMins <= 0 ? 'now' : `in ${etaMins} mins`
          } at ${alarm.bus_stop_name || alarm.bus_stop_code}!`;

          startContinuousChime(title, 14000);
          dispatchNativeNotification(title, {
            body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: `bus-alarm-${alarmKey}`,
            renotify: true,
            silent: false,
            forceCloudPush: true,
            vibrate: [500, 250, 500, 250, 1000],
          });
          showToast(`⏰ ${body}`, 'error');
        }
      } catch (err) {
        console.warn('Error checking bus arrival alarm:', err);
      }
    }
  };

  // Start GPS, visibility recovery, Service Worker push listener, and background heartbeat
  useEffect(() => {
    startGPS(false);
    syncAlarmsWithServiceWorker();

    // Immediately recover real-time GPS and check alarms when user returns to PWA from background
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        startGPS(true);
        syncAlarmsWithServiceWorker();
        checkActiveBusAlarms();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('pageshow', handleVisibilityOrFocus);

    // Listen for PUSH_ALARM_TRIGGERED from Service Worker when a cloud push or SW monitor fires in background
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'PUSH_ALARM_TRIGGERED') {
        const pushData = event.data.data || {};
        if (pushData.alarmId) {
          removeStoredBusAlarm(pushData.alarmId);
        } else if (pushData.stopCode && pushData.serviceNo) {
          removeStoredBusAlarm(`${pushData.stopCode}_${pushData.serviceNo}`);
        }
        startContinuousChime(event.data.title || '🚌 Bus Kaki Alert', 14000);
        if (event.data.body) {
          showToast(`⏰ ${event.data.body}`, 'error');
        }
        checkActiveBusAlarms();
      }
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSWMessage);
    }

    // Unthrottled background worker & audio tick callback (runs every ~3.5s even when backgrounded)
    const unregisterBgTick = registerBackgroundTickCallback(() => {
      if (alightAlarmRef.current.armed && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          updateLocation,
          () => {},
          { enableHighAccuracy: true, maximumAge: 0, timeout: 3500 }
        );
      }
      if (getStoredBusAlarms().length > 0) {
        checkActiveBusAlarms();
      }
    });

    // Regular foreground interval for bus arrival alarms even if background audio wasn't started yet
    const fgAlarmInterval = setInterval(() => {
      if (getStoredBusAlarms().length > 0) {
        checkActiveBusAlarms();
      }
    }, 15000);

    return () => {
      if (geoWatchId.current !== null) {
        navigator.geolocation.clearWatch(geoWatchId.current);
      }
      if (coarseStabilizeTimerRef.current) {
        clearTimeout(coarseStabilizeTimerRef.current);
      }
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('pageshow', handleVisibilityOrFocus);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSWMessage);
      }
      unregisterBgTick();
      clearInterval(fgAlarmInterval);
    };
  }, []);

  // Arm Alighting Wake-Up Alarm
  const handleArmAlightAlarm = async (stop: BusStop) => {
    // 1. Crucial for mobile audio: unlock Web Audio Context & HTML5 Audio during direct user touch gesture
    unlockAudio();

    // 2. Request native notification permission and ensure Web Push subscription is registered for background FCM relay
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const permPromise =
          Notification.permission === 'default'
            ? Notification.requestPermission()
            : Promise.resolve(Notification.permission);
        permPromise
          .then(async (perm) => {
            if (perm === 'granted') {
              const vapidKey = await fetchVapidPublicKey();
              const sub = await subscribeToPush(vapidKey);
              if (sub) {
                await registerPushSubscription(serializeSubscription(sub));
              }
            }
          })
          .catch(() => {});
      } catch {
        // Safe fail
      }
    }

    // 3. Resolve exact coordinates (fallback to SEED_BUS_STOPS catalog if missing or dummy)
    let targetLat = Number(stop.latitude);
    let targetLon = Number(stop.longitude);
    if (!targetLat || !targetLon || (targetLat === 1.35 && targetLon === 103.82)) {
      const seed = SEED_BUS_STOPS.find((s) => s.bus_stop_code === stop.bus_stop_code);
      if (seed) {
        targetLat = Number(seed.latitude);
        targetLon = Number(seed.longitude);
      }
    }

    // 4. Compute initial distance if GPS is currently acquired
    const initialDist =
      userLat !== null && userLon !== null
        ? calculateHaversineDistanceMeters(userLat, userLon, targetLat, targetLon)
        : null;

    const isTriggered = initialDist !== null && initialDist <= 500;

    const newState: AlightingAlarmState = {
      armed: true,
      stopCode: stop.bus_stop_code,
      stopName: stop.description,
      roadName: stop.road_name,
      targetLat,
      targetLon,
      thresholdMeters: 500,
      currentDistanceMeters: initialDist,
      isTriggered,
      keepScreenAwake: false,
    };

    alightAlarmRef.current = newState;
    setAlightAlarm(newState);
    // Start 20s sub-audible MediaSession keep-alive + Web Worker heartbeat
    startBackgroundAudioKeepAlive(stop.description);
    startGPS(true);
    setActiveTab('hud');
    showToast(`Alight alarm armed for ${stop.description}!`, 'success');

    // If commuter is already at destination upon arming
    if (isTriggered) {
      startContinuousChime(`⏰ Alight Now: ${stop.description}`);
      dispatchNativeNotification(`⏰ Alight Now: ${stop.description}`, {
        body: `You are already within 500m of ${stop.description}!`,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'alight-now-alert',
        renotify: true,
        silent: false,
        vibrate: [500, 250, 500, 250, 1000],
      });
    }
  };

  const handleStopAlarm = async () => {
    stopContinuousChime();
    if (getStoredBusAlarms().length === 0) {
      stopBackgroundAudioKeepAlive();
    }
    await releaseScreenWakeLock();
    const resetState: AlightingAlarmState = {
      ...alightAlarmRef.current,
      armed: false,
      isTriggered: false,
    };
    alightAlarmRef.current = resetState;
    setAlightAlarm(resetState);
    setActiveTab((current) => (current === 'hud' ? 'nearby' : current));
    showToast('Ride ended. Welcome to your destination! 🚌', 'success');
  };

  const reloadFavoritesCount = async () => {
    const favs = await getFavorites();
    setFavoritesCount(favs.length);
  };

  return (
    <div className="min-h-screen bg-brand-navy flex flex-col justify-between">
      {/* App Header */}
      <Header
        isOnline={isOnline}
        deferredPrompt={deferredPrompt}
        onInstallClick={handleInstallPWA}
        onMascotClick={() => {
          showToast('Hello! I am your SG Bus Kaki! 🚌✨', 'info');
        }}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-md w-full mx-auto px-3.5 pt-3">
        {activeTab === 'nearby' && (
          <NearbyView
            userLat={userLat}
            userLon={userLon}
            onRefreshLocation={() => startGPS(true)}
            onArmAlightAlarm={handleArmAlightAlarm}
            onViewRoute={(svc) => {
              setSearchInitialService(svc);
              setActiveTab('search');
            }}
            onShowToast={showToast}
            onFavoritesChanged={reloadFavoritesCount}
          />
        )}

        {activeTab === 'favorites' && (
          <FavoritesView
            onArmAlightAlarm={handleArmAlightAlarm}
            onViewRoute={(svc) => {
              setSearchInitialService(svc);
              setActiveTab('search');
            }}
            onShowToast={showToast}
            onFavoritesChanged={reloadFavoritesCount}
          />
        )}

        {activeTab === 'search' && (
          <SearchView
            initialServiceNo={searchInitialService}
            onArmAlightAlarm={handleArmAlightAlarm}
            onShowToast={showToast}
            onFavoritesChanged={reloadFavoritesCount}
          />
        )}

        {activeTab === 'mrt' && <MrtMapView />}

        {activeTab === 'alerts' && (
          <AlertsView
            onShowToast={showToast}
            alightAlarm={alightAlarm}
            onStopAlightAlarm={handleStopAlarm}
            onOpenHUD={() => setActiveTab('hud')}
          />
        )}
      </main>

      {/* Fullscreen Active Ride HUD (Rendered when in 'hud' tab) */}
      {activeTab === 'hud' && alightAlarm.armed && (
        <ActiveRideHUD
          alarmState={alightAlarm}
          onStopAlarm={handleStopAlarm}
          onUpdateKeepAwake={(enabled) =>
            setAlightAlarm((prev) => {
              const next = { ...prev, keepScreenAwake: enabled };
              alightAlarmRef.current = next;
              return next;
            })
          }
          onUpdateThreshold={(meters) =>
            setAlightAlarm((prev) => {
              const triggered = (prev.currentDistanceMeters ?? 9999) <= meters;
              const next = { ...prev, thresholdMeters: meters, isTriggered: triggered };
              alightAlarmRef.current = next;
              return next;
            })
          }
          onCloseHUD={() => setActiveTab('nearby')}
        />
      )}

      {/* Bottom Thumb Navigation Bar */}
      <Navigation
        activeTab={activeTab}
        onTabChange={(tab) => {
          if (tab === 'search') setSearchInitialService('');
          setActiveTab(tab);
        }}
        alightAlarm={alightAlarm}
        favoritesCount={favoritesCount}
        alertsCount={(alightAlarm.armed ? 1 : 0) + busAlarmsCount}
      />

      {/* Toast Notification Container */}
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};
