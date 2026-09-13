import React, { useState } from 'react';
import { Bell, X, Check, Smartphone, AlertCircle } from 'lucide-react';
import { subscribeToPush, serializeSubscription, getNotificationPermission } from '../services/pushManager';
import { createBusArrivalAlarm, registerPushSubscription, fetchVapidPublicKey } from '../services/api';
import { saveStoredBusAlarm } from '../services/alarmStorage';

interface SetArrivalAlarmModalProps {
  isOpen: boolean;
  busStopCode: string;
  busStopName: string;
  serviceNo: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (error: string) => void;
}

export const SetArrivalAlarmModal: React.FC<SetArrivalAlarmModalProps> = ({
  isOpen,
  busStopCode,
  busStopName,
  serviceNo,
  onClose,
  onSuccess,
  onError,
}) => {
  const [leadMins, setLeadMins] = useState<number>(3);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleArmAlarm = async () => {
    setLoading(true);
    try {
      // 1. Fetch public key
      const publicKey = await fetchVapidPublicKey();

      // 2. Subscribe user via PushManager
      const subscription = await subscribeToPush(publicKey);
      if (!subscription) {
        throw new Error('Please allow notification permission to receive arrival alerts');
      }

      // 3. Save subscription to backend
      const serialized = serializeSubscription(subscription);
      await registerPushSubscription(serialized);

      // 4. Arm alarm in backend
      const res = await createBusArrivalAlarm({
        endpoint: subscription.endpoint,
        busStopCode,
        busStopName,
        serviceNo,
        leadMins,
      });

      // Save locally to display in Active Alerts list
      saveStoredBusAlarm({
        id: res?.alarmId || `${busStopCode}_${serviceNo}_${Date.now()}`,
        endpoint: subscription.endpoint,
        bus_stop_code: busStopCode,
        bus_stop_name: busStopName,
        service_no: serviceNo,
        lead_mins: leadMins,
        created_at: new Date().toISOString(),
      });

      onSuccess(`Alert set! You will be notified when Bus ${serviceNo} is ${leadMins} mins away.`);
      onClose();
    } catch (err: any) {
      console.error('Error setting arrival alarm:', err);
      onError(err.message || 'Failed to set arrival alarm');
    } finally {
      setLoading(false);
    }
  };

  const currentPermission = getNotificationPermission();

  return (
    <div className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-brand-card border border-slate-700 w-full max-w-sm rounded-2xl p-5 shadow-2xl animate-in slide-in-from-bottom-6 duration-200">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-brand-blue/20 text-brand-sky flex items-center justify-center">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Set Arrival Alert</h3>
              <p className="text-xs text-slate-400">Bus {serviceNo} @ {busStopCode}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
          <p className="text-xs text-slate-300 font-medium mb-0.5">{busStopName}</p>
          <p className="text-[11px] text-slate-500">Stop Code: {busStopCode}</p>
        </div>

        {/* Lead Time Selection */}
        <p className="text-xs font-semibold text-slate-300 mb-2">When should we alert you?</p>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[2, 3, 5].map((mins) => (
            <button
              key={mins}
              onClick={() => setLeadMins(mins)}
              className={`py-2.5 px-2 rounded-xl text-center border font-bold text-xs transition-all ${
                leadMins === mins
                  ? 'bg-brand-blue border-brand-sky text-white shadow-md'
                  : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="block text-sm font-black">{mins} mins</span>
              <span className="text-[10px] font-normal text-slate-300">before arrival</span>
            </button>
          ))}
        </div>

        {/* Android Push Info Notice */}
        <div className="mb-4 p-2.5 rounded-xl bg-brand-blue/10 border border-brand-blue/30 flex items-start space-x-2">
          <Smartphone className="w-4 h-4 text-brand-sky shrink-0 mt-0.5" />
          <p className="text-[11px] text-slate-300 leading-tight">
            Delivers a native Android notification even if your screen is locked or browser is closed.
          </p>
        </div>

        {currentPermission === 'denied' && (
          <div className="mb-4 p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/60 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-rose-200 leading-tight">
              Notification permission was blocked in browser settings. Please enable notifications to receive alerts.
            </p>
          </div>
        )}

        {/* Confirm Action */}
        <div className="flex space-x-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleArmAlarm}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-brand-blue to-brand-sky text-white font-bold text-xs shadow-lg hover:brightness-110 active:scale-95 disabled:opacity-50 flex items-center justify-center space-x-1.5 transition-all"
          >
            {loading ? (
              <span className="text-xs">Arming...</span>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Arm Alert</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
