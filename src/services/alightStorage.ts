import { AlightingAlarmState } from '../types/transit';

const ALIGHT_STORAGE_KEY = 'sg_active_alight_alarm_v2';
const MAX_RIDE_AGE_MS = 2.5 * 60 * 60 * 1000; // 2.5 hours max ride lifetime

interface StoredAlightWrapper {
  state: AlightingAlarmState;
  savedAt: number;
}

export function syncAlightWithServiceWorker(state: AlightingAlarmState | null): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const payload = {
    type: 'SYNC_ALIGHT_ALARM',
    alarm: state && state.armed ? state : null,
  };
  try {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(payload);
    } else {
      navigator.serviceWorker.ready
        .then((reg) => {
          reg.active?.postMessage(payload);
        })
        .catch(() => {});
    }
  } catch {
    // Safe fail
  }
}

export function getStoredAlightAlarm(): AlightingAlarmState | null {
  try {
    const raw = localStorage.getItem(ALIGHT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: StoredAlightWrapper = JSON.parse(raw);
    if (!parsed || !parsed.state || !parsed.state.armed) {
      localStorage.removeItem(ALIGHT_STORAGE_KEY);
      return null;
    }
    if (Date.now() - (parsed.savedAt || 0) > MAX_RIDE_AGE_MS) {
      localStorage.removeItem(ALIGHT_STORAGE_KEY);
      return null;
    }
    // Reset gesture-gated hardware toggles on cold page hydration
    return {
      ...parsed.state,
      keepScreenAwake: false,
      earbudsNapMode: false,
    };
  } catch {
    return null;
  }
}

export function saveStoredAlightAlarm(state: AlightingAlarmState): void {
  try {
    if (!state.armed) {
      clearStoredAlightAlarm();
      return;
    }
    const wrapper: StoredAlightWrapper = {
      state,
      savedAt: Date.now(),
    };
    localStorage.setItem(ALIGHT_STORAGE_KEY, JSON.stringify(wrapper));
    syncAlightWithServiceWorker(state);
  } catch (err) {
    console.warn('Failed to persist alight alarm state:', err);
  }
}

export function clearStoredAlightAlarm(): void {
  try {
    localStorage.removeItem(ALIGHT_STORAGE_KEY);
    syncAlightWithServiceWorker(null);
  } catch {
    // Safe fail
  }
}
