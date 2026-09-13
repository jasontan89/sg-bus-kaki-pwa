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
} from './services/alarmManager';
import { dispatchNativeNotification } from './services/pushManager';
import { seedBusStops, getCachedStopsCount, getFavorites } from './services/offlineStorage';
import { SEED_BUS_STOPS } from './services/busStopsData';
import { getStoredBusAlarms } from './services/alarmStorage';

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

  const geoWatchId = useRef<number | null>(null);

  useEffect(() => {
    const updateCount = () => setBusAlarmsCount(getStoredBusAlarms().length);
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

  // GPS Tracking & Distance Watcher
  const updateLocation = (pos: GeolocationPosition) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    setUserLat(lat);
    setUserLon(lon);

    // If commute alarm is armed, recalculate remaining distance
    setAlightAlarm((prev) => {
      if (!prev.armed) return prev;

      const dist = calculateHaversineDistanceMeters(lat, lon, prev.targetLat, prev.targetLon);
      const isNowTriggered = dist !== null && dist <= prev.thresholdMeters;

      // When first entering proximity
      if (isNowTriggered && !prev.isTriggered) {
        startContinuousChime();
        dispatchNativeNotification(`⏰ Alight Now: ${prev.stopName}`, {
          body: `You are within ${prev.thresholdMeters}m of ${prev.stopName}! Prepare to alight now.`,
          icon: '/bus-mascot.svg',
          badge: '/bus-mascot.svg',
          tag: 'alight-now-alert',
          renotify: true,
          vibrate: [500, 250, 500, 250, 1000],
        });
        showToast(`⏰ You are within ${prev.thresholdMeters}m of ${prev.stopName}! Prepare to alight.`, 'error');
      }

      return {
        ...prev,
        currentDistanceMeters: dist,
        isTriggered: isNowTriggered,
      };
    });
  };

  const startGPS = () => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      updateLocation,
      (err) => {
        console.warn('Geolocation initial error:', err);
        // Do not force fake City Hall coordinates on error;
        // keeping userLat null lets remaining distance display 'Acquiring GPS...'
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );

    if (geoWatchId.current === null) {
      geoWatchId.current = navigator.geolocation.watchPosition(
        updateLocation,
        (err) => console.warn('Geo watch error:', err),
        { enableHighAccuracy: true, maximumAge: 5000 }
      );
    }
  };

  useEffect(() => {
    startGPS();
    return () => {
      if (geoWatchId.current !== null) {
        navigator.geolocation.clearWatch(geoWatchId.current);
      }
    };
  }, []);

  // Arm Alighting Wake-Up Alarm
  const handleArmAlightAlarm = async (stop: BusStop) => {
    // 1. Crucial for mobile audio: unlock Web Audio Context during direct user touch gesture
    unlockAudio();

    // 2. Request native notification permission if not yet determined (non-blocking)
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      try {
        Notification.requestPermission().catch(() => {});
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

    setAlightAlarm(newState);
    // Screen awake is OFF by default as per user design; wake lock only requested if user toggles ON in HUD
    startBackgroundAudioKeepAlive(stop.description);
    setActiveTab('hud');
    showToast(`Alight alarm armed for ${stop.description}!`, 'success');

    // If commuter is already at destination upon arming
    if (isTriggered) {
      startContinuousChime();
      dispatchNativeNotification(`⏰ Alight Now: ${stop.description}`, {
        body: `You are already within 500m of ${stop.description}!`,
        icon: '/bus-mascot.svg',
        tag: 'alight-now-alert',
        renotify: true,
        vibrate: [500, 250, 500, 250, 1000],
      });
    }
  };

  const handleStopAlarm = async () => {
    stopContinuousChime();
    stopBackgroundAudioKeepAlive();
    await releaseScreenWakeLock();
    setAlightAlarm((prev) => ({
      ...prev,
      armed: false,
      isTriggered: false,
    }));
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
            onRefreshLocation={startGPS}
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
            setAlightAlarm((prev) => ({ ...prev, keepScreenAwake: enabled }))
          }
          onUpdateThreshold={(meters) =>
            setAlightAlarm((prev) => {
              const triggered = (prev.currentDistanceMeters ?? 9999) <= meters;
              return { ...prev, thresholdMeters: meters, isTriggered: triggered };
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
