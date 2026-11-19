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
import {
  AlightArmContext,
  AlightingAlarmState,
  AlightTrackingMode,
  BusStop,
  ServerAlightAlarmRecord,
} from './types/transit';
import {
  calculateHaversineDistanceMeters,
  startContinuousChime,
  stopContinuousChime,
  startBackgroundAudioKeepAlive,
  stopBackgroundAudioKeepAlive,
  startEarbudsNapShield,
  stopEarbudsNapShield,
  unlockAudio,
  releaseScreenWakeLock,
  registerBackgroundTickCallback,
} from './services/alarmManager';
import {
  dispatchNativeNotification,
  subscribeToPush,
  serializeSubscription,
  getCurrentSubscription,
} from './services/pushManager';
import {
  fetchBusArrivals,
  fetchVapidPublicKey,
  createCloudAlightAlarm,
  sendAlightHeartbeat,
  fetchAlightAlarmStatus,
  deleteCloudAlightAlarm,
} from './services/api';
import { seedBusStops, getCachedStopsCount, getFavorites } from './services/offlineStorage';
import { SEED_BUS_STOPS } from './services/busStopsData';
import {
  getStoredBusAlarms,
  removeStoredBusAlarm,
  syncAlarmsWithServiceWorker,
} from './services/alarmStorage';
import {
  getStoredAlightAlarm,
  saveStoredAlightAlarm,
  clearStoredAlightAlarm,
  syncAlightWithServiceWorker,
} from './services/alightStorage';

const DEFAULT_ALIGHT_STATE: AlightingAlarmState = {
  armed: false,
  serverAlarmId: null,
  endpoint: undefined,
  stopCode: '',
  stopName: '',
  roadName: '',
  targetLat: 1.35,
  targetLon: 103.82,
  thresholdMeters: 500,
  currentDistanceMeters: null,
  initialDistanceMeters: null,
  isTriggered: false,
  keepScreenAwake: false,
  earbudsNapMode: false,
  trackingMode: 'auto_detect',
  trackedServiceNo: null,
  trackedDirection: null,
  stopsRemaining: null,
  candidateServices: [],
  cloudSynced: false,
};

export const App: React.FC = () => {
  const [alightAlarm, setAlightAlarm] = useState<AlightingAlarmState>(() => {
    return getStoredAlightAlarm() || DEFAULT_ALIGHT_STATE;
  });

  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const stored = getStoredAlightAlarm();
    if (stored?.armed && typeof window !== 'undefined' && window.location.search.includes('alight=hud')) {
      return 'hud';
    }
    return 'nearby';
  });

  // Clean up ?alight=hud deep-link query parameter after initial mount so reloads don't re-force HUD
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('alight=hud')) {
      const url = new URL(window.location.href);
      url.searchParams.delete('alight');
      const cleanUrl = url.pathname + (url.search ? url.search : '') + url.hash;
      window.history.replaceState({}, '', cleanUrl);
    }
  }, []);

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

  // Synchronous refs for background execution & immediate visibilitychange handoff
  const alightAlarmRef = useRef<AlightingAlarmState>(alightAlarm);
  const geoWatchId = useRef<number | null>(null);
  const bestAccuracyRef = useRef<number>(Infinity);
  const lastFixTimeRef = useRef<number>(0);
  const lastValidCoordsRef = useRef<{ lat: number; lon: number } | null>(null);
  const lastSpeedMpsRef = useRef<number | null>(null);
  const coarseStabilizeTimerRef = useRef<any>(null);
  const lastBusAlarmCheckRef = useRef<number>(0);
  const lastAlightHeartbeatRef = useRef<number>(0);
  const syncingCloudArmRef = useRef<boolean>(false);

  useEffect(() => {
    alightAlarmRef.current = alightAlarm;
    if (alightAlarm.armed) {
      saveStoredAlightAlarm(alightAlarm);
    } else {
      clearStoredAlightAlarm();
    }
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

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now().toString() + Math.random().toString();
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3800);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Merge server record updates into local AlightingAlarmState
  const mergeServerAlightRecord = (
    srv: ServerAlightAlarmRecord,
    preferForegroundDist = false
  ) => {
    const current = alightAlarmRef.current;
    const wasTriggered = current.isTriggered;
    const nowTriggered = Boolean(srv.fired) || wasTriggered;

    const mergedDist =
      preferForegroundDist && current.currentDistanceMeters !== null
        ? current.currentDistanceMeters
        : srv.estimated_distance_meters ?? current.currentDistanceMeters;

    const nextState: AlightingAlarmState = {
      ...current,
      armed: true,
      serverAlarmId: srv.id,
      endpoint: srv.endpoint || current.endpoint,
      stopCode: srv.target_stop_code || current.stopCode,
      stopName: srv.target_stop_name || current.stopName,
      roadName: srv.road_name || current.roadName,
      targetLat: srv.target_lat || current.targetLat,
      targetLon: srv.target_lon || current.targetLon,
      thresholdMeters: srv.threshold_meters || current.thresholdMeters,
      currentDistanceMeters: mergedDist,
      initialDistanceMeters: current.initialDistanceMeters ?? mergedDist,
      isTriggered: nowTriggered,
      trackingMode: srv.tracking_mode || current.trackingMode,
      trackedServiceNo: srv.service_no,
      trackedDirection: srv.direction,
      stopsRemaining: srv.stops_remaining,
      candidateServices:
        srv.candidate_services && srv.candidate_services.length > 0
          ? srv.candidate_services
          : current.candidateServices || [],
      cloudSynced: true,
    };

    alightAlarmRef.current = nextState;
    setAlightAlarm(nextState);

    if (nowTriggered && !wasTriggered) {
      startContinuousChime(`⏰ Alight Now: ${nextState.stopName}`);
      showToast(
        `⏰ ALIGHT NOW: Approaching ${nextState.stopName}! Prepare to alight.`,
        'error'
      );
    }
  };

  // Register or retry registering an active Alight Alarm with Supabase Cloud Push tracker
  const registerAlightAlarmInCloud = async (
    baseState: AlightingAlarmState,
    ctx?: AlightArmContext,
    showSuccessToast = false
  ): Promise<boolean> => {
    if (syncingCloudArmRef.current) return false;
    syncingCloudArmRef.current = true;

    try {
      const vapidKey = await fetchVapidPublicKey();
      const sub = await subscribeToPush(vapidKey);
      if (!sub) {
        if (showSuccessToast) {
          showToast('Push notifications not supported or blocked on this browser.', 'error');
        }
        return false;
      }

      const serialized = serializeSubscription(sub);
      const coords = lastValidCoordsRef.current;

      // Single fast keepalive request (server atomically upserts push subscription keys + alarm row)
      const res = await createCloudAlightAlarm({
        endpoint: serialized.endpoint,
        keys: serialized.keys,
        targetStopCode: baseState.stopCode,
        targetStopName: baseState.stopName,
        roadName: baseState.roadName,
        targetLat: baseState.targetLat,
        targetLon: baseState.targetLon,
        thresholdMeters: baseState.thresholdMeters,
        trackingMode: ctx?.serviceNo ? 'bus_locked' : baseState.trackingMode || 'auto_detect',
        serviceNo: ctx?.serviceNo ?? baseState.trackedServiceNo ?? null,
        direction: ctx?.direction ?? baseState.trackedDirection ?? null,
        userLat: coords?.lat ?? userLat,
        userLon: coords?.lon ?? userLon,
        userSpeedMps: lastSpeedMpsRef.current,
      });

      if (res.ok && res.alarm && alightAlarmRef.current.armed) {
        mergeServerAlightRecord(res.alarm, true);
        if (showSuccessToast) {
          if (res.alarm.service_no) {
            showToast(
              `☁️ Cloud locked onto Bus ${res.alarm.service_no}! Safe to switch apps or lock screen.`,
              'success'
            );
          } else {
            showToast(
              '☁️ Cloud background push active! Safe to switch apps or lock screen.',
              'success'
            );
          }
        }
        return true;
      }
    } catch (err: any) {
      console.warn('Cloud alight registration notice:', err);
      if (showSuccessToast) {
        showToast(
          `Cloud push sync failed: ${err?.message || 'Allow notifications to get screen-off alerts.'}`,
          'error'
        );
      }
    } finally {
      syncingCloudArmRef.current = false;
    }
    return false;
  };

  // Reconcile active ride state with Supabase when returning from background or cold reload
  const reconcileCloudAlightStatus = async () => {
    try {
      const current = alightAlarmRef.current;
      const sub = await getCurrentSubscription();
      const endpoint = current.endpoint || sub?.endpoint;
      if (!endpoint && !current.serverAlarmId) return;

      const statusRes = await fetchAlightAlarmStatus(endpoint, current.serverAlarmId);
      if (!statusRes.ok) {
        // Offline / tunnel: keep local state untouched
        return;
      }

      if (statusRes.alarm) {
        mergeServerAlightRecord(statusRes.alarm, false);
        if (
          typeof window !== 'undefined' &&
          window.location.search.includes('alight=hud')
        ) {
          setActiveTab('hud');
        }
      } else if (current.armed && current.cloudSynced && current.serverAlarmId) {
        // Server confirmed alarm row was deleted (e.g. commuter tapped "I Have Alighted" on lock screen)
        stopContinuousChime();
        stopEarbudsNapShield();
        if (getStoredBusAlarms().length === 0) {
          stopBackgroundAudioKeepAlive();
        }
        await releaseScreenWakeLock();
        alightAlarmRef.current = DEFAULT_ALIGHT_STATE;
        setAlightAlarm(DEFAULT_ALIGHT_STATE);
        clearStoredAlightAlarm();
        setActiveTab((tab) => (tab === 'hud' ? 'nearby' : tab));
      }
    } catch {
      // Safe fail
    }
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

  // Online / Offline Listeners (automatically sync pending cloud alight alarm upon exiting tunnel)
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      showToast('Back online! Live arrivals & cloud alerts synced.', 'success');
      if (alightAlarmRef.current.armed && !alightAlarmRef.current.cloudSynced) {
        registerAlightAlarmInCloud(alightAlarmRef.current);
      } else if (alightAlarmRef.current.armed) {
        reconcileCloudAlightStatus();
      }
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

  // Synchronous proximity evaluator when foreground GPS updates
  const evaluateAlightProximity = (lat: number, lon: number) => {
    const current = alightAlarmRef.current;
    if (!current.armed) return;

    const dist = calculateHaversineDistanceMeters(lat, lon, current.targetLat, current.targetLon);
    if (dist === null) return;

    const isNowTriggered = dist <= current.thresholdMeters;

    if (isNowTriggered && !current.isTriggered) {
      const updatedState: AlightingAlarmState = {
        ...current,
        currentDistanceMeters: dist,
        initialDistanceMeters: current.initialDistanceMeters ?? dist,
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
        vibrate: [800, 250, 800, 250, 1200],
      });
      showToast(
        `⏰ You are within ${current.thresholdMeters}m of ${current.stopName}! Prepare to alight.`,
        'error'
      );

      // Notify cloud backend so it marks fired=true and doesn't fire a delayed duplicate later
      if (current.cloudSynced && (current.serverAlarmId || current.endpoint)) {
        sendAlightHeartbeat({
          alarmId: current.serverAlarmId,
          endpoint: current.endpoint,
          userLat: lat,
          userLon: lon,
          userSpeedMps: lastSpeedMpsRef.current,
        });
      }
    } else {
      if (current.currentDistanceMeters !== dist) {
        const updatedState: AlightingAlarmState = {
          ...current,
          currentDistanceMeters: dist,
          initialDistanceMeters: current.initialDistanceMeters ?? dist,
        };
        alightAlarmRef.current = updatedState;
        setAlightAlarm(updatedState);
      }

      // Periodic foreground telemetry sync to Supabase (every 18s while visible)
      const now = Date.now();
      if (
        current.cloudSynced &&
        !current.isTriggered &&
        now - lastAlightHeartbeatRef.current >= 18000
      ) {
        lastAlightHeartbeatRef.current = now;
        sendAlightHeartbeat({
          alarmId: current.serverAlarmId,
          endpoint: current.endpoint,
          userLat: lat,
          userLon: lon,
          userSpeedMps: lastSpeedMpsRef.current,
        }).then((res) => {
          if (res.ok && res.alarm && alightAlarmRef.current.armed) {
            mergeServerAlightRecord(res.alarm, true);
          }
        });
      }
    }
  };

  // GPS Tracking & Anti-Jump Accuracy Filter
  const updateLocation = (pos: GeolocationPosition) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    const accuracy = pos.coords.accuracy || 9999;
    const speed = pos.coords.speed;
    const now = Date.now();

    if (!lat || !lon || isNaN(lat) || isNaN(lon)) return;

    if (speed !== null && !isNaN(speed) && speed >= 0 && speed <= 40) {
      lastSpeedMpsRef.current = speed;
    }

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

  // Client-side foreground monitor for active Bus Arrival Alarms
  // (Only runs while app is visible so background delivery relies cleanly on Supabase Cloud Push)
  const checkActiveBusAlarms = async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

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
          const alarmKey = alarm.id || `${alarm.bus_stop_code}_${alarm.service_no}`;
          removeStoredBusAlarm(alarmKey);

          const title = `🚌 Bus ${alarm.service_no} Arriving!`;
          const body = `Bus ${alarm.service_no} is arriving ${
            etaMins <= 0 ? 'now' : `in ${etaMins} mins`
          } at ${alarm.bus_stop_name || alarm.bus_stop_code}!`;

          startContinuousChime(title, 14000);
          dispatchNativeNotification(title, {
            body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: `bus-alarm-${alarmKey}-${Date.now()}`,
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

  // Start GPS, visibility handover (keepalive sync on hide, instant reconcile on show), and SW listeners
  useEffect(() => {
    startGPS(false);
    syncAlarmsWithServiceWorker();
    if (alightAlarmRef.current.armed) {
      syncAlightWithServiceWorker(alightAlarmRef.current);
      reconcileCloudAlightStatus();
    } else {
      // Also check server in case an active ride exists from before memory eviction
      reconcileCloudAlightStatus();
    }

    // Immediate handover to Cloud Ride Tracker right as user switches apps or turns off screen
    const dispatchKeepaliveHandoff = () => {
      const cur = alightAlarmRef.current;
      if (!cur.armed || cur.isTriggered || !cur.cloudSynced) return;
      const coords = lastValidCoordsRef.current;
      lastAlightHeartbeatRef.current = Date.now();
      sendAlightHeartbeat(
        {
          alarmId: cur.serverAlarmId,
          endpoint: cur.endpoint,
          userLat: coords?.lat ?? null,
          userLon: coords?.lon ?? null,
          userSpeedMps: lastSpeedMpsRef.current,
          thresholdMeters: cur.thresholdMeters,
        },
        true // keepalive: true guarantees delivery during page hide / screen lock
      );
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        dispatchKeepaliveHandoff();
      } else if (document.visibilityState === 'visible') {
        startGPS(true);
        syncAlarmsWithServiceWorker();
        checkActiveBusAlarms();
        reconcileCloudAlightStatus();
      }
    };

    const handleFocusOrShow = () => {
      if (document.visibilityState === 'visible') {
        startGPS(true);
        checkActiveBusAlarms();
        reconcileCloudAlightStatus();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', dispatchKeepaliveHandoff);
    window.addEventListener('focus', handleFocusOrShow);
    window.addEventListener('pageshow', handleFocusOrShow);

    // Listen for Service Worker background push triggers & lock-screen action dismissals
    const handleSWMessage = (event: MessageEvent) => {
      if (!event.data) return;

      if (event.data.type === 'PUSH_ALIGHT_TRIGGERED') {
        const pushData = event.data.data || {};
        const cur = alightAlarmRef.current;
        if (cur.armed) {
          const updated: AlightingAlarmState = {
            ...cur,
            currentDistanceMeters:
              typeof pushData.distanceMeters === 'number'
                ? pushData.distanceMeters
                : cur.currentDistanceMeters,
            stopsRemaining: 0,
            isTriggered: true,
          };
          alightAlarmRef.current = updated;
          setAlightAlarm(updated);
        }
        startContinuousChime(event.data.title || '⏰ ALIGHT NOW!', 45000);
        if (event.data.body) {
          showToast(`⏰ ${event.data.body}`, 'error');
        }
      } else if (event.data.type === 'ALIGHT_ALARM_DISMISSED') {
        // User tapped "✅ I Have Alighted" directly on the lock-screen notification!
        stopContinuousChime();
        stopEarbudsNapShield();
        if (getStoredBusAlarms().length === 0) {
          stopBackgroundAudioKeepAlive();
        }
        releaseScreenWakeLock();
        alightAlarmRef.current = DEFAULT_ALIGHT_STATE;
        setAlightAlarm(DEFAULT_ALIGHT_STATE);
        clearStoredAlightAlarm();
        setActiveTab((tab) => (tab === 'hud' ? 'nearby' : tab));
      } else if (event.data.type === 'PUSH_ALARM_TRIGGERED') {
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

    const unregisterBgTick = registerBackgroundTickCallback(() => {
      if (
        alightAlarmRef.current.armed &&
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible' &&
        navigator.geolocation
      ) {
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

    const fgAlarmInterval = setInterval(() => {
      if (getStoredBusAlarms().length > 0) {
        checkActiveBusAlarms();
      }
      // Also poll server status periodically in foreground when locked onto a bus (updates stopsRemaining)
      if (
        alightAlarmRef.current.armed &&
        alightAlarmRef.current.cloudSynced &&
        !alightAlarmRef.current.isTriggered &&
        document.visibilityState === 'visible' &&
        Date.now() - lastAlightHeartbeatRef.current >= 20000
      ) {
        reconcileCloudAlightStatus();
      }
    }, 15000);

    return () => {
      if (geoWatchId.current !== null) {
        navigator.geolocation.clearWatch(geoWatchId.current);
      }
      if (coarseStabilizeTimerRef.current) {
        clearTimeout(coarseStabilizeTimerRef.current);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', dispatchKeepaliveHandoff);
      window.removeEventListener('focus', handleFocusOrShow);
      window.removeEventListener('pageshow', handleFocusOrShow);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSWMessage);
      }
      unregisterBgTick();
      clearInterval(fgAlarmInterval);
    };
  }, []);

  // Arm Alighting Wake-Up Alarm (with Cloud Live-Bus GPS & Background Web Push)
  const handleArmAlightAlarm = async (stop: BusStop, context?: AlightArmContext) => {
    unlockAudio();

    let targetLat = Number(stop.latitude);
    let targetLon = Number(stop.longitude);
    if (!targetLat || !targetLon || (targetLat === 1.35 && targetLon === 103.82)) {
      const seed = SEED_BUS_STOPS.find((s) => s.bus_stop_code === stop.bus_stop_code);
      if (seed) {
        targetLat = Number(seed.latitude);
        targetLon = Number(seed.longitude);
      }
    }

    const activeLat = lastValidCoordsRef.current?.lat ?? userLat;
    const activeLon = lastValidCoordsRef.current?.lon ?? userLon;

    const initialDist =
      activeLat !== null && activeLon !== null
        ? calculateHaversineDistanceMeters(activeLat, activeLon, targetLat, targetLon)
        : null;

    const isTriggered = initialDist !== null && initialDist <= 500;

    const newState: AlightingAlarmState = {
      armed: true,
      serverAlarmId: null,
      endpoint: undefined,
      stopCode: stop.bus_stop_code,
      stopName: stop.description,
      roadName: stop.road_name,
      targetLat,
      targetLon,
      thresholdMeters: 500,
      currentDistanceMeters: initialDist,
      initialDistanceMeters: initialDist,
      isTriggered,
      keepScreenAwake: false,
      earbudsNapMode: false,
      trackingMode: context?.serviceNo ? 'bus_locked' : 'auto_detect',
      trackedServiceNo: context?.serviceNo || null,
      trackedDirection: context?.direction || null,
      stopsRemaining: null,
      candidateServices: context?.serviceNo ? [context.serviceNo] : [],
      cloudSynced: false,
    };

    alightAlarmRef.current = newState;
    setAlightAlarm(newState);
    startBackgroundAudioKeepAlive(stop.description);
    startGPS(true);
    setActiveTab('hud');

    if (isTriggered) {
      startContinuousChime(`⏰ Alight Now: ${stop.description}`);
      dispatchNativeNotification(`⏰ Alight Now: ${stop.description}`, {
        body: `You are already within 500m of ${stop.description}!`,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'alight-now-alert',
        renotify: true,
        silent: false,
        vibrate: [800, 250, 800, 250, 1200],
      });
      showToast(`⏰ You are already within 500m of ${stop.description}!`, 'error');
      return;
    }

    showToast(`Alight alarm armed for ${stop.description}! Syncing cloud tracker...`, 'info');
    await registerAlightAlarmInCloud(newState, context, true);
  };

  // Switch Ride Vehicle / Mode from ActiveRideHUD 1-tap pills
  const handleSelectRideMode = async (
    mode: AlightTrackingMode,
    serviceNo?: string | null
  ) => {
    const cur = alightAlarmRef.current;
    if (!cur.armed) return;

    const optimistic: AlightingAlarmState = {
      ...cur,
      trackingMode: mode,
      trackedServiceNo: mode === 'bus_locked' ? serviceNo || null : null,
      stopsRemaining: mode === 'bus_locked' ? cur.stopsRemaining : null,
    };
    alightAlarmRef.current = optimistic;
    setAlightAlarm(optimistic);

    if (!cur.cloudSynced) {
      await registerAlightAlarmInCloud(
        optimistic,
        serviceNo ? { serviceNo } : undefined,
        true
      );
      return;
    }

    const coords = lastValidCoordsRef.current;
    const res = await sendAlightHeartbeat({
      alarmId: cur.serverAlarmId,
      endpoint: cur.endpoint,
      userLat: coords?.lat ?? userLat,
      userLon: coords?.lon ?? userLon,
      userSpeedMps: lastSpeedMpsRef.current,
      overrideMode: mode,
      overrideServiceNo: serviceNo ?? null,
    });

    if (res.ok && res.alarm) {
      mergeServerAlightRecord(res.alarm, true);
      if (res.alarm.service_no) {
        showToast(
          `☁️ Locked onto live Bus ${res.alarm.service_no} GPS${
            res.alarm.stops_remaining !== null ? ` (${res.alarm.stops_remaining} stops left)` : ''
          }!`,
          'success'
        );
      } else if (mode === 'mrt') {
        showToast('🚆 Switched to Cloud MRT / Car Trajectory mode.', 'info');
      } else {
        showToast('✨ Switched to Cloud Auto-Detect Bus mode.', 'info');
      }
    }
  };

  // Toggle optional Earbuds Nap Mode HTML5 <audio> silent bridge
  const handleToggleNapMode = async (enabled: boolean) => {
    unlockAudio();
    if (enabled) {
      const ok = await startEarbudsNapShield(alightAlarmRef.current.stopName);
      if (ok) {
        setAlightAlarm((prev) => {
          const next = { ...prev, earbudsNapMode: true };
          alightAlarmRef.current = next;
          return next;
        });
        showToast('🎧 Earbuds Nap Mode ON: Continuous 45s headphone chime armed!', 'success');
      } else {
        showToast('Tap again to allow audio playback for Earbuds Nap Mode.', 'error');
      }
    } else {
      stopEarbudsNapShield();
      setAlightAlarm((prev) => {
        const next = { ...prev, earbudsNapMode: false };
        alightAlarmRef.current = next;
        return next;
      });
      showToast('Earbuds Nap Mode OFF. Standard 3-pulse cloud push remains active.', 'info');
    }
  };

  // Update proximity threshold locally & in Supabase Cloud Tracker
  const handleUpdateThreshold = (meters: number) => {
    const cur = alightAlarmRef.current;
    const triggered = (cur.currentDistanceMeters ?? 99999) <= meters;
    const next: AlightingAlarmState = {
      ...cur,
      thresholdMeters: meters,
      isTriggered: cur.isTriggered || triggered,
    };
    alightAlarmRef.current = next;
    setAlightAlarm(next);

    if (triggered && !cur.isTriggered) {
      startContinuousChime(`⏰ Alight Now: ${cur.stopName}`);
    }

    if (cur.cloudSynced && (cur.serverAlarmId || cur.endpoint)) {
      const coords = lastValidCoordsRef.current;
      sendAlightHeartbeat({
        alarmId: cur.serverAlarmId,
        endpoint: cur.endpoint,
        userLat: coords?.lat ?? userLat,
        userLon: coords?.lon ?? userLon,
        thresholdMeters: meters,
      });
    }
  };

  const handleStopAlarm = async () => {
    const prev = alightAlarmRef.current;
    stopContinuousChime();
    stopEarbudsNapShield();
    if (getStoredBusAlarms().length === 0) {
      stopBackgroundAudioKeepAlive();
    }
    await releaseScreenWakeLock();

    const resetState: AlightingAlarmState = {
      ...DEFAULT_ALIGHT_STATE,
    };
    alightAlarmRef.current = resetState;
    setAlightAlarm(resetState);
    clearStoredAlightAlarm();
    setActiveTab((current) => (current === 'hud' ? 'nearby' : current));
    showToast('Ride ended. Welcome to your destination! 🚌', 'success');

    // Delete server alarm so background monitoring & reinforcement pushes stop immediately
    if (prev.serverAlarmId || prev.endpoint) {
      deleteCloudAlightAlarm(prev.serverAlarmId, prev.endpoint);
    } else {
      getCurrentSubscription()
        .then((sub) => {
          if (sub?.endpoint) deleteCloudAlightAlarm(null, sub.endpoint);
        })
        .catch(() => {});
    }
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
          onToggleNapMode={handleToggleNapMode}
          onSelectRideMode={handleSelectRideMode}
          onRetryCloudSync={() => {
            registerAlightAlarmInCloud(alightAlarmRef.current, undefined, true);
          }}
          onUpdateThreshold={handleUpdateThreshold}
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
