import React, { useState, useEffect } from 'react';
import { Bell, BellOff, CheckCircle2, AlertTriangle, ShieldCheck, Smartphone } from 'lucide-react';
import {
  getNotificationPermission,
  requestNotificationPermission,
  subscribeToPush,
  serializeSubscription,
  dispatchNativeNotification,
} from '../services/pushManager';
import { registerPushSubscription, fetchVapidPublicKey } from '../services/api';
import { playGentleTransitChime, unlockAudio } from '../services/alarmManager';

interface AlertsViewProps {
  onShowToast: (text: string, type?: 'success' | 'error' | 'info') => void;
}

const MRT_LINE_OPTIONS = [
  { code: 'NSL', name: 'North-South Line', color: 'bg-red-500' },
  { code: 'EWL', name: 'East-West Line', color: 'bg-emerald-600' },
  { code: 'CCL', name: 'Circle Line', color: 'bg-amber-500' },
  { code: 'DTL', name: 'Downtown Line', color: 'bg-blue-600' },
  { code: 'NEL', name: 'North-East Line', color: 'bg-purple-600' },
  { code: 'TEL', name: 'Thomson-East Coast Line', color: 'bg-amber-800' },
];

export const AlertsView: React.FC<AlertsViewProps> = ({ onShowToast }) => {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [selectedLines, setSelectedLines] = useState<string[]>(['NSL', 'EWL']);
  const [alertFilter, setAlertFilter] = useState<'major' | 'all'>('major');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPermission(getNotificationPermission());
    // Check local storage for saved lines
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
        onShowToast('Web Push enabled! You will receive transit alerts.', 'success');
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

    // Update backend subscription if already active
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
      body: 'Bus 65 is arriving in 2 minutes at Hotel Grand Pacific!',
      icon: '/bus-mascot.svg',
      badge: '/bus-mascot.svg',
      vibrate: [500, 250, 500, 250, 1000],
    });
    if (sent) {
      onShowToast('Sample native notification dispatched!', 'success');
    } else {
      onShowToast('Prolonged chime played! Enable push/notifications for native lock-screen banner.', 'info');
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
          Real-time arrival countdowns & MRT disruption push alerts
        </p>
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
            Uses W3C PushManager & VAPID cryptographic tokens. You will receive notifications even when phone is locked or screen is off.
          </p>
        </div>

        {/* Test Notification Button */}
        <button
          onClick={handleTestLocalNotification}
          className="w-full py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-200 flex items-center justify-center space-x-1.5 active:scale-95 transition-all"
        >
          <Bell className="w-3.5 h-3.5 text-brand-sky" />
          <span>Test Notification & Gentle Chime</span>
        </button>
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

        {/* Lines Selector Grid */}
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

        {/* Sensitivity Filter */}
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
