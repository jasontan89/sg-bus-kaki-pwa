import { BusArrivalAlarm } from '../types/transit';

const ALARMS_STORAGE_KEY = 'sg_active_bus_alarms';

export function syncAlarmsWithServiceWorker(alarms?: BusArrivalAlarm[]): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const active = alarms ?? getStoredBusAlarms();
  try {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SYNC_BUS_ALARMS',
        alarms: active,
      });
    } else {
      navigator.serviceWorker.ready
        .then((reg) => {
          reg.active?.postMessage({
            type: 'SYNC_BUS_ALARMS',
            alarms: active,
          });
        })
        .catch(() => {});
    }
  } catch {
    // Safe fail
  }
}

export function getStoredBusAlarms(): BusArrivalAlarm[] {
  try {
    const raw = localStorage.getItem(ALARMS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to read bus alarms:', err);
    return [];
  }
}

export function saveStoredBusAlarm(alarm: BusArrivalAlarm): void {
  try {
    const alarms = getStoredBusAlarms();
    const filtered = alarms.filter(
      (a) => !(a.bus_stop_code === alarm.bus_stop_code && a.service_no === alarm.service_no)
    );
    filtered.unshift(alarm);
    localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(filtered));
    syncAlarmsWithServiceWorker(filtered);
    window.dispatchEvent(new Event('sg_bus_alarms_updated'));
  } catch (err) {
    console.error('Failed to save bus alarm:', err);
  }
}

export function removeStoredBusAlarm(idOrStopService: string | number): void {
  try {
    const alarms = getStoredBusAlarms();
    const targetStr = String(idOrStopService);
    const filtered = alarms.filter((a) => {
      if (a.id !== undefined && String(a.id) === targetStr) return false;
      if (`${a.bus_stop_code}_${a.service_no}` === targetStr) return false;
      return true;
    });
    localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(filtered));
    syncAlarmsWithServiceWorker(filtered);
    window.dispatchEvent(new Event('sg_bus_alarms_updated'));
  } catch (err) {
    console.error('Failed to remove bus alarm:', err);
  }
}
