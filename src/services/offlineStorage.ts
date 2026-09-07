import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { BusStop, FavoriteStop, BusArrivalAlarm } from '../types/transit';

interface SGBusKakiDB extends DBSchema {
  bus_stops: {
    key: string;
    value: BusStop;
    indexes: {
      'by-road': string;
      'by-desc': string;
    };
  };
  favorites: {
    key: string;
    value: FavoriteStop;
  };
  recent_searches: {
    key: string;
    value: { query: string; type: 'stop' | 'route'; timestamp: number };
  };
  alarms: {
    key: string;
    value: BusArrivalAlarm;
  };
}

const DB_NAME = 'sg_bus_kaki_offline_db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<SGBusKakiDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<SGBusKakiDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SGBusKakiDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Bus stops directory store
        if (!db.objectStoreNames.contains('bus_stops')) {
          const stopStore = db.createObjectStore('bus_stops', { keyPath: 'bus_stop_code' });
          stopStore.createIndex('by-road', 'road_name');
          stopStore.createIndex('by-desc', 'description');
        }

        // Commuter pinned favorites store
        if (!db.objectStoreNames.contains('favorites')) {
          db.createObjectStore('favorites', { keyPath: 'bus_stop_code' });
        }

        // Recent search queries store
        if (!db.objectStoreNames.contains('recent_searches')) {
          db.createObjectStore('recent_searches', { keyPath: 'query' });
        }

        // Active arrival alarms store
        if (!db.objectStoreNames.contains('alarms')) {
          db.createObjectStore('alarms', { keyPath: 'bus_stop_code' });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Bulk seed bus stops into IndexedDB
 */
export async function seedBusStops(stops: BusStop[]): Promise<number> {
  const db = await getDB();
  const tx = db.transaction('bus_stops', 'readwrite');
  const store = tx.objectStore('bus_stops');
  
  for (const stop of stops) {
    store.put(stop);
  }
  await tx.done;
  return stops.length;
}

/**
 * Get count of cached bus stops in IndexedDB
 */
export async function getCachedStopsCount(): Promise<number> {
  try {
    const db = await getDB();
    return await db.count('bus_stops');
  } catch {
    return 0;
  }
}

/**
 * Offline search across 5,000+ bus stops by code, description, or road name
 */
export async function searchOfflineBusStops(query: string, limit = 25): Promise<BusStop[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const db = await getDB();
  const allStops = await db.getAll('bus_stops');

  const matches: BusStop[] = [];
  for (const stop of allStops) {
    const code = (stop.bus_stop_code || '').toLowerCase();
    const desc = (stop.description || '').toLowerCase();
    const road = (stop.road_name || '').toLowerCase();

    if (code.startsWith(q) || desc.includes(q) || road.includes(q)) {
      matches.push(stop);
      if (matches.length >= limit) break;
    }
  }

  return matches;
}

/**
 * Find single bus stop by code
 */
export async function getOfflineBusStop(code: string): Promise<BusStop | undefined> {
  const db = await getDB();
  return await db.get('bus_stops', code);
}

/**
 * Get all pinned favorites
 */
export async function getFavorites(): Promise<FavoriteStop[]> {
  try {
    const db = await getDB();
    const favs = await db.getAll('favorites');
    return favs.sort((a, b) => b.added_at - a.added_at);
  } catch {
    return [];
  }
}

/**
 * Add or update favorite stop
 */
export async function saveFavorite(fav: FavoriteStop): Promise<void> {
  const db = await getDB();
  await db.put('favorites', fav);
}

/**
 * Remove favorite stop
 */
export async function removeFavorite(code: string): Promise<void> {
  const db = await getDB();
  await db.delete('favorites', code);
}

/**
 * Check if a stop is favorited
 */
export async function isFavorite(code: string): Promise<boolean> {
  const db = await getDB();
  const fav = await db.get('favorites', code);
  return !!fav;
}
