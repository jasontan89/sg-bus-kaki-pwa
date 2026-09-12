import { BusArrivalData, BusRouteStop, BusStop, MRTAlert } from '../types/transit';
import { searchOfflineBusStops } from './offlineStorage';
import { calculateHaversineDistanceMeters } from './alarmManager';
import { SEED_BUS_STOPS } from './busStopsData';

const BASE_API_URL =
  import.meta.env.VITE_PWA_API_URL ||
  'https://blcsjvifiytbznwesmyx.supabase.co/functions/v1/pwa_api';
const ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJsY3NqdmlmaXl0Ynpud2VzbXl4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MTkzNDcsImV4cCI6MjA5ODM5NTM0N30.PhO08MviDmKyRn941IngM9-WaG_j7lwiCL5IqzG5qt0';

const defaultHeaders: Record<string, string> = {
  'Content-Type': 'application/json',
};

if (ANON_KEY) {
  defaultHeaders['apikey'] = ANON_KEY;
  defaultHeaders['Authorization'] = `Bearer ${ANON_KEY}`;
}

/**
 * Fetch live bus arrivals for a bus stop
 */
export async function fetchBusArrivals(stopCode: string): Promise<BusArrivalData> {
  try {
    const res = await fetch(`${BASE_API_URL}/api/bus-arrivals?stop=${encodeURIComponent(stopCode)}`, {
      headers: defaultHeaders,
    });
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    return {
      busStopCode: stopCode,
      services: data.services || [],
      lastUpdated: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(`Failed to fetch arrivals from API for ${stopCode}, checking fallback:`, err);
    return {
      busStopCode: stopCode,
      services: [],
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * Fetch nearby bus stops given GPS coordinates
 */
export async function fetchNearbyStops(
  lat: number,
  lon: number,
  limit = 20
): Promise<BusStop[]> {
  try {
    const res = await fetch(
      `${BASE_API_URL}/api/bus-nearby?lat=${lat}&lon=${lon}&limit=${limit}`,
      { headers: defaultHeaders }
    );
    if (res.ok) {
      const data = await res.json();
      if (data.stops && data.stops.length > 0) {
        return data.stops;
      }
    }
  } catch (err) {
    console.warn('API nearby error, calculating offline from pre-seeded bus stops:', err);
  }

  // Resilient Offline Fallback: Compute distances from pre-seeded stops catalog
  const stopsWithDist = SEED_BUS_STOPS.map((s) => ({
    ...s,
    distance: calculateHaversineDistanceMeters(lat, lon, s.latitude, s.longitude) ?? undefined,
  }));

  stopsWithDist.sort((a, b) => (a.distance || 0) - (b.distance || 0));
  return stopsWithDist.slice(0, limit);
}

/**
 * Search bus stops by code, road name, or description
 */
export async function searchBusStops(query: string): Promise<BusStop[]> {
  const cleanQ = query.trim();
  if (!cleanQ) return [];

  // Try API first
  try {
    const res = await fetch(
      `${BASE_API_URL}/api/bus-search?q=${encodeURIComponent(cleanQ)}`,
      { headers: defaultHeaders }
    );
    if (res.ok) {
      const data = await res.json();
      if (data.stops && data.stops.length > 0) {
        return data.stops;
      }
    }
  } catch {
    // Offline tunnel mode: Fallback to IndexedDB
  }

  return await searchOfflineBusStops(cleanQ);
}

/**
 * Fetch bus route stops for a specific bus number
 */
export async function fetchBusRoute(
  serviceNo: string,
  direction = 1
): Promise<BusRouteStop[]> {
  try {
    const res = await fetch(
      `${BASE_API_URL}/api/bus-route?service=${encodeURIComponent(serviceNo)}&direction=${direction}`,
      { headers: defaultHeaders }
    );
    if (res.ok) {
      const data = await res.json();
      return data.stops || [];
    }
  } catch (err) {
    console.warn(`Failed to fetch route for service ${serviceNo}:`, err);
  }
  return [];
}

/**
 * Fetch live train service alerts
 */
export async function fetchTrainAlerts(): Promise<MRTAlert> {
  try {
    const res = await fetch(`${BASE_API_URL}/api/train-alerts`, {
      headers: defaultHeaders,
    });
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch (err) {
    console.warn('Error fetching train alerts:', err);
  }
  return { status: 1, message: 'All MRT and LRT lines operating normally.' };
}

/**
 * Retrieve VAPID Public Key for Web Push subscription
 */
export async function fetchVapidPublicKey(): Promise<string> {
  try {
    const res = await fetch(`${BASE_API_URL}/api/vapid-public-key`, {
      headers: defaultHeaders,
    });
    if (res.ok) {
      const data = await res.json();
      if (data.publicKey) return data.publicKey;
    }
  } catch (err) {
    console.warn('Could not fetch VAPID key from API:', err);
  }
  return (
    import.meta.env.VITE_VAPID_PUBLIC_KEY ||
    'BHSw8VkpCSgUdC1_XRhHMvLMdm7w-VhRH_tahYM2ZXOBAhQ2A80SPwEvakojni6fs7gT3R_ke7ZKspb6w79rBw8'
  );
}

/**
 * Register or update Web Push subscription in Supabase
 */
export async function registerPushSubscription(payload: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  mrt_lines?: string[];
  alert_filter?: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_API_URL}/api/subscribe`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (err) {
    console.error('Error saving push subscription:', err);
    return false;
  }
}

/**
 * Schedule bus arrival alarm in Supabase
 */
export async function createBusArrivalAlarm(payload: {
  endpoint: string;
  busStopCode: string;
  busStopName: string;
  serviceNo: string;
  leadMins?: number;
}): Promise<{ ok: boolean; alarmId?: number }> {
  const res = await fetch(`${BASE_API_URL}/api/bus-alarm`, {
    method: 'POST',
    headers: defaultHeaders,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to schedule arrival alarm');
  return await res.json();
}

/**
 * Delete or cancel active bus arrival alarm
 */
export async function deleteBusArrivalAlarm(
  alarmId: number | string,
  endpoint?: string
): Promise<boolean> {
  try {
    const url = endpoint
      ? `${BASE_API_URL}/api/bus-alarm/${alarmId}?endpoint=${encodeURIComponent(endpoint)}`
      : `${BASE_API_URL}/api/bus-alarm/${alarmId}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: defaultHeaders,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Dispatches a real test push notification from backend server down to phone
 */
export async function sendTestPushNotification(endpoint?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE_API_URL}/api/test-push`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ endpoint }),
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || 'Network error reaching push server' };
  }
}
