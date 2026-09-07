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
  requestScreenWakeLock,
  releaseScreenWakeLock,
} from './services/alarmManager';
import { seedBusStops, getCachedStopsCount, getFavorites } from './services/offlineStorage';
import { SEED_BUS_STOPS } from './services/busStopsData';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('nearby');
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [favoritesCount, setFavoritesCount] = useState<number>(0);
  const [searchInitialService, setSearchInitialService] = useState<string>('');

  // GPS Location state
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLon, setUserLon] = useState<number | null>(null);

  // Toasts state
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Alighting Wake-Up Alarm State
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
    keepScreenAwake: true,
  });

  const geoWatchId = useRef<number | null>(null);

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
      const isNowTriggered = dist <= prev.thresholdMeters;

      // When first entering proximity
      if (isNowTriggered && !prev.isTriggered) {
        startContinuousChime();
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
        // Fallback default: Downtown Singapore
        setUserLat(1.2968);
        setUserLon(103.8525);
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
    const currentLat = userLat || 1.2968;
    const currentLon = userLon || 103.8525;
    const initialDist = calculateHaversineDistanceMeters(
      currentLat,
      currentLon,
      stop.latitude,
      stop.longitude
    );

    const newState: AlightingAlarmState = {
      armed: true,
      stopCode: stop.bus_stop_code,
      stopName: stop.description,
      roadName: stop.road_name,
      targetLat: stop.latitude,
      targetLon: stop.longitude,
      thresholdMeters: 500,
      currentDistanceMeters: initialDist,
      isTriggered: initialDist <= 500,
      keepScreenAwake: true,
    };

    setAlightAlarm(newState);
    await requestScreenWakeLock();
    setActiveTab('hud');
    showToast(`Alight alarm armed for ${stop.description}!`, 'success');
  };

  const handleStopAlarm = async () => {
    stopContinuousChime();
    await releaseScreenWakeLock();
    setAlightAlarm((prev) => ({
      ...prev,
      armed: false,
      isTriggered: false,
    }));
    setActiveTab('nearby');
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

        {activeTab === 'alerts' && <AlertsView onShowToast={showToast} />}
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
      />

      {/* Toast Notification Container */}
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};
