import React, { useState, useEffect } from 'react';
import {
  Bell,
  BellOff,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Smartphone,
  Send,
  Loader2,
  Trash2,
  ExternalLink,
  MapPin,
  Clock,
  Radio,
} from 'lucide-react';
import {
  getNotificationPermission,
  requestNotificationPermission,
  subscribeToPush,
  serializeSubscription,
  dispatchNativeNotification,
} from '../services/pushManager';
import {
  registerPushSubscription,
  fetchVapidPublicKey,
  sendTestPushNotification,
  deleteBusArrivalAlarm,
} from '../services/api';
import {
  playGentleTransitChime,
  unlockAudio,
  formatDistance,
  stopContinuousChime,
} from '../services/alarmManager';
import { getStoredBusAlarms, removeStoredBusAlarm } from '../services/alarmStorage';
import { AlightingAlarmState, BusArrivalAlarm } from '../types/transit';

interface AlertsViewProps {
  onShowToast: (text: string, type?: 'success' | 'error' | 'info') => void;
  alightAlarm?: AlightingAlarmState;
  onStopAlightAlarm?: () => void;
  onOpenHUD?: () => void;
}

const MRT_LINE_OPTIONS = [
  { code: 'NSL', name: 'North-South Line', color: 'bg-red-500' },
  { code: 'EWL', name: 'East-West Line', color: 'bg-emerald-600' },
  { code: 'CCL', name: 'Circle Line', color: 'bg-amber-500' },
  { code: 'DTL', name: 'Downtown Line', color: 'bg-blue-600' },
  { code: 'NEL', name: 'North-East Line', color: 'bg-purple-600' },
  { code: 'TEL', name: 'Thomson-East Coast Line', color: 'bg-amber-800' },
];

export const AlertsView: React.FC<AlertsViewProps> = ({
  onShowToast,
  alightAlarm,
  onStopAlightAlarm,
  onOpenHUD,
}) => {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [selectedLines, setSelectedLines] = useState<string[]>(['NSL', 'EWL']);
  const [alertFilter, setAlertFilter] = useState<'major' | 'all'>('major');
  const [loading, setLoading] = useState(false);
  const [testingCloudPush, setTestingCloudPush] = useState(false);
  const [activeBusAlarms, setActiveBusAlarms] = useState<BusArrivalAlarm[]>([]);

  const loadActiveAlarms = () => {
    setActiveBusAlarms(getStoredBusAlarms());
  };

  useEffect(() => {
    loadActiveAlarms();
    window.addEventListener('sg_bus_alarms_updated', loadActiveAlarms);
    return () => window.removeEventListener('sg_bus_alarms_updated', loadActiveAlarms);
  }, []);

  const handleCancelBusAlarm = async (alarm: BusArrivalAlarm) => {
    stopContinuousChime();
    try {
      if (alarm.id) {
        await deleteBusArrivalAlarm(alarm.id, alarm.endpoint);
      }
      removeStoredBusAlarm(alarm.id || `${alarm.bus_stop_code}_${alarm.service_no}`);
      loadActiveAlarms();
      onShowToast(`Alert for Bus ${alarm.service_no} cancelled`, 'info');
    } catch {
      removeStoredBusAlarm(alarm.id || `${alarm.bus_stop_code}_${alarm.service_no}`);
      loadActiveAlarms();
      onShowToast(`Alert removed`, 'info');
    }
  };

  useEffect(() => {
    setPermission(getNotificationPermission());
    try {
      const saved = localStorage.getItem('sg_mrt_lines');
      if (saved) setSelectedLines(JSON.parse(saved));
      const savedFilter = localStorage.getItem('sg_alert_filter');
      if (savedFilter) setAlertFilter(savedFilter as any);
    } catch {
      // safe fail
    }
  }, []);

  const handleEnablePush = async () => {
    unlockAudio();
    setLoading(true);
    try {
      const perm = await requestNotificationPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        onShowToast('Notification permission not granted', 'error');
        return;
      }

      const vapidKey = await fetchVapidPublicKey();
      const sub = await subscribeToPush(vapidKey);
      if (sub) {
        const serialized = serializeSubscription(sub);
        await registerPushSubscription({
          ...serialized,
          mrt_lines: selectedLines,
          alert_filter: alertFilter,
        });
        onShowToast('Web Push enabled! Stale subscriptions rotated.', 'success');
      }
    } catch (err: any) {
      console.error('Push error:', err);
      onShowToast(err.message || 'Failed to enable push', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleLine = async (lineCode: string) => {
    const updated = selectedLines.includes(lineCode)
      ? selectedLines.filter((l) => l !== lineCode)
      : [...selectedLines, lineCode];
    setSelectedLines(updated);
    localStorage.setItem('sg_mrt_lines', JSON.stringify(updated));

    try {
      const vapidKey = await fetchVapidPublicKey();
      const sub = await subscribeToPush(vapidKey);
      if (sub) {
        const serialized = serializeSubscription(sub);
        await registerPushSubscription({
          ...serialized,
          mrt_lines: updated,
          alert_filter: alertFilter,
        });
      }
    } catch {
      // safe fail
    }
    onShowToast(`Updated MRT alerts preferences`, 'info');
  };

  const handleFilterChange = (filter: 'major' | 'all') => {
    setAlertFilter(filter);
    localStorage.setItem('sg_alert_filter', filter);
    onShowToast(`Filter set to: ${filter === 'major' ? 'Major disruptions only' : 'All advisories'}`, 'info');
  };

  const handleTestLocalNotification = async () => {
    unlockAudio();
    playGentleTransitChime();
    const sent = await dispatchNativeNotification('🚌 Bus Kaki Alert', {
      body: 'Bus 65 is arriving in 2 minutes!',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [500, 250, 500, 250, 1000],
    });
    if (sent) {
      onShowToast('Sample local notification & chime dispatched!', 'success');
    } else {
      onShowToast('Prolonged chime played! Enable notifications for native lock-screen banner.', 'info');
    }
  };

  const handleTestServerPush = async () => {
    unlockAudio();
    setTestingCloudPush(true);
    try {
      const perm = await requestNotificationPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        onShowToast('Please enable notifications to receive alerts.', 'error');
        return;
      }

      const vapidKey = await fetchVapidPublicKey();
      const sub = await subscribeToPush(vapidKey);
      if (!sub) {
        onShowToast('Failed to create push subscription on device.', 'error');
        return;
      }

      const serialized = serializeSubscription(sub);

      // IMPORTANT: Send request to Supabase IMMEDIATELY with server-side delaySeconds: 6!
      // Previously, setTimeout(4000) ran inside the browser tab, which Android froze the moment
      // the user switched apps or locked the screen — preventing the push from ever being sent.
      const res = await sendTestPushNotification(serialized.endpoint, {
        keys: serialized.keys,
        delaySeconds: 6,
      });

      if (res.ok) {
        onShowToast(
          '✅ Cloud timer armed! Switch to another app or lock screen NOW — push arriving in 6s...',
          'success'
        );
      } else {
        onShowToast(`Cloud push note: ${res.error || 'Check server status'}`, 'error');
      }
    } catch (err: any) {
      console.error('Test server push failed:', err);
      onShowToast(err.message || 'Failed to dispatch cloud test push', 'error');
    } finally {
      setTestingCloudPush(false);
    }
  };

  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div className="px-1">
        <h2 className="text-base font-black text-white flex items-center gap-1.5">
          <Bell className="w-4 h-4 text-brand-sky" />
          Alerts & Web Push Hub
        </h2>
        <p className="text-xs text-slate-400">
          Real-time arrival countdowns, cloud background alight tracking & MRT alerts
        </p>
      </div>

      {/* Active Alerts Section (List View) */}
      <div className="bg-brand-dark/95 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Radio className="w-4 h-4 text-brand-sky animate-pulse" />
            Active Alerts & Alarms
          </h3>
          <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-300">
            {(alightAlarm?.armed ? 1 : 0) + activeBusAlarms.length} active
          </span>
        </div>

        {/* 1. Alighting Alarm Card (If armed) */}
        {alightAlarm?.armed && (
          <div className="p-3.5 rounded-xl bg-gradient-to-r from-brand-blue/15 to-slate-900 border border-brand-sky/40 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center space-x-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-xs font-bold uppercase tracking-wider text-brand-sky">
                  Alighting Wake-Up Alarm
                </span>
              </div>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                  alightAlarm.isTriggered
                    ? 'bg-rose-950 text-rose-300 border border-rose-600 animate-pulse'
                    : alightAlarm.cloudSynced
                    ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-600/50'
                    : 'bg-slate-900 text-slate-300 border border-slate-700'
                }`}
              >
                {alightAlarm.isTriggered
                  ? '⏰ ALIGHT NOW!'
                  : alightAlarm.cloudSynced
                  ? alightAlarm.trackedServiceNo
                    ? `☁️ Cloud Bus ${alightAlarm.trackedServiceNo}`
                    : '☁️ Cloud Push Active'
                  : alightAlarm.trackedServiceNo
                  ? `🚌 Bus ${alightAlarm.trackedServiceNo} • GPS`
                  : 'Tracking GPS'}
              </span>
            </div>

            <div>
              <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-brand-sky" />
                {alightAlarm.stopName}
                <span className="text-xs font-mono text-slate-400">({alightAlarm.stopCode})</span>
              </h4>
              <p className="text-xs text-slate-400 mt-0.5">{alightAlarm.roadName}</p>
            </div>

            <div className="flex items-center justify-between pt-1 text-xs border-t border-slate-800/80">
              <div className="flex items-center space-x-1.5 text-slate-300">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  Remaining:{' '}
                  <strong className="text-white font-mono">
                    {formatDistance(alightAlarm.currentDistanceMeters)}
                  </strong>
                  {alightAlarm.stopsRemaining !== null &&
                    alightAlarm.stopsRemaining !== undefined &&
                    alightAlarm.trackedServiceNo && (
                      <span className="text-brand-sky font-semibold ml-1.5">
                        ({alightAlarm.stopsRemaining} stops)
                      </span>
                    )}
                </span>
                <span className="text-[10px] text-slate-500">
                  (Alert &le;{alightAlarm.thresholdMeters}m)
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              {onOpenHUD && (
                <button
                  onClick={onOpenHUD}
                  className="py-2 px-3 rounded-lg bg-brand-sky/20 border border-brand-sky/40 text-brand-sky hover:bg-brand-sky/30 text-xs font-bold flex items-center justify-center space-x-1.5 active:scale-95 transition-all"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Ride HUD</span>
                </button>
              )}
              {onStopAlightAlarm && (
                <button
                  onClick={onStopAlightAlarm}
                  className="py-2 px-3 rounded-lg bg-rose-950/40 border border-rose-700/50 text-rose-300 hover:bg-rose-900/50 text-xs font-bold flex items-center justify-center space-x-1.5 active:scale-95 transition-all"
                >
                  <BellOff className="w-3.5 h-3.5" />
                  <span>Cancel Alarm</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* 2. Scheduled Bus Arrival Alarms */}
        {activeBusAlarms.map((alarm) => (
          <div
            key={alarm.id || `${alarm.bus_stop_code}_${alarm.service_no}`}
            className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between"
          >
            <div className="flex items-center space-x-3">
              <span className="px-2.5 py-1 rounded-lg bg-brand-blue/30 border border-brand-sky/40 text-brand-sky font-mono font-bold text-xs">
                Bus {alarm.service_no}
              </span>
              <div>
                <p className="text-xs font-bold text-white">
                  {alarm.bus_stop_name || 'Bus Stop'}
                  <span className="text-[11px] font-mono text-slate-400 ml-1">
                    ({alarm.bus_stop_code})
                  </span>
                </p>
                <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                  <Clock className="w-3 h-3 text-brand-sky" />
                  Alert {alarm.lead_mins} mins before arrival
                </p>
              </div>
            </div>

            <button
              onClick={() => handleCancelBusAlarm(alarm)}
              className="p-2 rounded-lg bg-slate-800 hover:bg-rose-950 border border-slate-700 hover:border-rose-600 text-slate-400 hover:text-rose-300 transition-all active:scale-95"
              title="Cancel arrival alert"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        {/* 3. Empty State when No Active Alerts */}
        {!alightAlarm?.armed && activeBusAlarms.length === 0 && (
          <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80 text-center space-y-1">
            <Bell className="w-6 h-6 text-slate-500 mx-auto mb-1" />
            <p className="text-xs font-medium text-slate-300">No Active Alerts</p>
            <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
              Set an arrival notification on any bus tile, or arm an alighting wake-up alarm from any bus stop.
            </p>
          </div>
        )}
      </div>

      {/* Web Push Status Card */}
      <div className="bg-brand-dark/95 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                permission === 'granted'
                  ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-400'
                  : 'bg-slate-900 border border-slate-800 text-slate-400'
              }`}
            >
              {permission === 'granted' ? <ShieldCheck className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Android Web Push</h3>
              <p className="text-xs text-slate-400">
                Status: {permission === 'granted' ? 'Active & Permitted' : 'Disabled'}
              </p>
            </div>
          </div>

          {permission !== 'granted' ? (
            <button
              onClick={handleEnablePush}
              disabled={loading}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-brand-blue to-brand-sky text-white text-xs font-bold shadow-md hover:brightness-110 active:scale-95 transition-all"
            >
              {loading ? 'Enabling...' : 'Enable'}
            </button>
          ) : (
            <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" /> Ready
            </span>
          )}
        </div>

        <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-[11px] text-slate-300 flex items-start space-x-2">
          <Smartphone className="w-4 h-4 text-brand-sky shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            Uses W3C PushManager & VAPID cryptographic tokens. Both Arrival Alerts and Alight Alerts wake your phone even when switching apps or with screen off.
          </p>
        </div>

        {/* Dual Test Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          <button
            onClick={handleTestServerPush}
            disabled={testingCloudPush}
            className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-brand-blue/30 to-brand-sky/30 border border-brand-sky/50 hover:bg-brand-blue/40 text-xs font-bold text-brand-sky flex items-center justify-center space-x-1.5 active:scale-95 transition-all shadow-sm"
            title="Arms a 6-second server-side cloud timer via Google FCM so you can switch apps immediately"
          >
            {testingCloudPush ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-sky" />
            ) : (
              <Send className="w-3.5 h-3.5 text-brand-sky" />
            )}
            <span>Test Cloud Push (6s Delay)</span>
          </button>

          <button
            onClick={handleTestLocalNotification}
            className="w-full py-2.5 px-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-300 flex items-center justify-center space-x-1.5 active:scale-95 transition-all"
          >
            <Bell className="w-3.5 h-3.5 text-slate-400" />
            <span>Test Chime & Sound</span>
          </button>
        </div>

        {/* Android / Xiaomi HyperOS / Samsung Background Delivery Checklist */}
        <details className="rounded-xl bg-amber-950/25 border border-amber-700/40 text-[11px] text-slate-300">
          <summary className="px-3 py-2 cursor-pointer font-bold text-amber-300 select-none">
            ⚠️ Alerts only pop up when reopening app? (Xiaomi / Android 1-Time Fix)
          </summary>
          <div className="px-3 pb-3 pt-1 space-y-1.5 text-slate-300 leading-relaxed border-t border-amber-800/30">
            <p className="text-slate-400">
              Xiaomi HyperOS / MIUI &amp; some Android skins freeze installed PWAs &amp; Chrome in the background by default, holding FCM pushes until you reopen the app:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-[11px]">
              <li>
                <strong className="text-white">Long-press Bus Kaki icon → App info:</strong> set{' '}
                <span className="text-amber-200 font-semibold">Battery saver → No restrictions</span>, turn{' '}
                <span className="text-amber-200 font-semibold">Autostart ON</span>, and enable{' '}
                <span className="text-amber-200 font-semibold">Floating + Lock screen notifications + Sound</span>.
              </li>
              <li>
                <strong className="text-white">Repeat for Google Chrome</strong> (<em>Settings → Apps → Manage apps → Chrome</em>): set{' '}
                <span className="text-amber-200 font-semibold">Battery saver → No restrictions</span> &amp;{' '}
                <span className="text-amber-200 font-semibold">Background autostart ON</span> (Chrome delivers all WebAPK pushes).
              </li>
              <li>
                <strong className="text-white">Test:</strong> Tap <em>Test Cloud Push (6s Delay)</em> above, immediately switch to another app, and wait 6 seconds.
              </li>
            </ol>
          </div>
        </details>
      </div>

      {/* MRT Lines Disruption Push Alerts */}
      <div className="bg-brand-dark/95 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          MRT Disruption Subscriptions
        </h3>
        <p className="text-xs text-slate-400">
          Get pushed immediately if your daily train lines experience track faults or breakdowns.
        </p>

        <div className="grid grid-cols-2 gap-2">
          {MRT_LINE_OPTIONS.map((line) => {
            const isChecked = selectedLines.includes(line.code);
            return (
              <button
                key={line.code}
                onClick={() => handleToggleLine(line.code)}
                className={`p-2.5 rounded-xl border text-left flex items-center justify-between transition-all ${
                  isChecked
                    ? 'bg-brand-blue/15 border-brand-sky text-white shadow-sm'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${line.color}`} />
                  <div>
                    <span className="font-bold text-xs block">{line.code}</span>
                    <span className="text-[9px] text-slate-400">{line.name}</span>
                  </div>
                </div>
                {isChecked && <CheckCircle2 className="w-3.5 h-3.5 text-brand-sky" />}
              </button>
            );
          })}
        </div>

        <div className="pt-2 border-t border-slate-800/80">
          <p className="text-xs font-semibold text-slate-300 mb-2">Alert Sensitivity:</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleFilterChange('major')}
              className={`py-2 px-2.5 rounded-xl text-center border text-xs font-bold transition-all ${
                alertFilter === 'major'
                  ? 'bg-slate-800 border-brand-sky text-brand-sky'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400'
              }`}
            >
              Major Breakdown Only
            </button>
            <button
              onClick={() => handleFilterChange('all')}
              className={`py-2 px-2.5 rounded-xl text-center border text-xs font-bold transition-all ${
                alertFilter === 'all'
                  ? 'bg-slate-800 border-brand-sky text-brand-sky'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400'
              }`}
            >
              All Advisories
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
