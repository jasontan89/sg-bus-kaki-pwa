import { BusArrivalAlarm } from '../types/transit';

const ALARMS_STORAGE_KEY = 'sg_active_bus_alarms';

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
    window.dispatchEvent(new Event('sg_bus_alarms_updated'));
  } catch (err) {
    console.error('Failed to save bus alarm:', err);
  }
}

export function removeStoredBusAlarm(idOrStopService: string | number): void {
  try {
    const alarms = getStoredBusAlarms();
    const filtered = alarms.filter((a) => {
      if (a.id && a.id === idOrStopService) return false;
      if (`${a.bus_stop_code}_${a.service_no}` === idOrStopService) return false;
      return true;
    });
    localStorage.setItem(ALARMS_STORAGE_KEY, JSON.stringify(filtered));
    window.dispatchEvent(new Event('sg_bus_alarms_updated'));
  } catch (err) {
    console.error('Failed to remove bus alarm:', err);
  }
}
