import React from 'react';
import { AlightingAlarmState, AlightTrackingMode } from '../types/transit';
import {
  Bell,
  BellOff,
  Volume2,
  Navigation as NavIcon,
  Eye,
  EyeOff,
  X,
  CheckCircle,
  Cloud,
  CloudOff,
  Headphones,
  Bus,
  Train,
  Sparkles,
} from 'lucide-react';
import {
  formatDistance,
  playGentleTransitChime,
  unlockAudio,
  requestScreenWakeLock,
  releaseScreenWakeLock,
} from '../services/alarmManager';

interface ActiveRideHUDProps {
  alarmState: AlightingAlarmState;
  onStopAlarm: () => void;
  onUpdateKeepAwake: (enabled: boolean) => void;
  onToggleNapMode?: (enabled: boolean) => void;
  onSelectRideMode?: (mode: AlightTrackingMode, serviceNo?: string | null) => void;
  onRetryCloudSync?: () => void;
  onUpdateThreshold?: (meters: number) => void;
  onCloseHUD: () => void;
}

export const ActiveRideHUD: React.FC<ActiveRideHUDProps> = ({
  alarmState,
  onStopAlarm,
  onUpdateKeepAwake,
  onToggleNapMode,
  onSelectRideMode,
  onRetryCloudSync,
  onUpdateThreshold,
  onCloseHUD,
}) => {
  const {
    stopCode,
    stopName,
    roadName,
    thresholdMeters,
    currentDistanceMeters,
    initialDistanceMeters,
    isTriggered,
    keepScreenAwake,
    earbudsNapMode = false,
    trackingMode = 'auto_detect',
    trackedServiceNo,
    stopsRemaining,
    candidateServices = [],
    cloudSynced = false,
  } = alarmState;

  const toggleWakeLock = async () => {
    const nextState = !keepScreenAwake;
    onUpdateKeepAwake(nextState);
    if (nextState) {
      await requestScreenWakeLock();
    } else {
      await releaseScreenWakeLock();
    }
  };

  const baselineMeters = Math.max(
    thresholdMeters + 500,
    initialDistanceMeters || 3000,
    currentDistanceMeters || 1500
  );
  const remaining = currentDistanceMeters ?? Math.round(baselineMeters * 0.7);
  const progressPercent = isTriggered
    ? 100
    : Math.min(
        100,
        Math.max(
          0,
          Math.round(((baselineMeters - remaining) / Math.max(1, baselineMeters - thresholdMeters)) * 100)
        )
      );

  const getTrackingBadgeText = () => {
    if (!cloudSynced) {
      return 'Enable Push for Screen-Off Alerts';
    }
    if (trackingMode === 'bus_locked' && trackedServiceNo) {
      const stopsText =
        stopsRemaining !== null && stopsRemaining !== undefined
          ? ` • ${stopsRemaining} ${stopsRemaining === 1 ? 'stop' : 'stops'} left`
          : '';
      return `Cloud Live-Bus GPS: Bus ${trackedServiceNo}${stopsText}`;
    }
    if (trackingMode === 'mrt') {
      return 'Cloud MRT Trajectory + Push Active (Works Screen Off)';
    }
    if (trackingMode === 'auto_detect') {
      return 'Cloud Auto-Bus Matcher + Push Active (Works Screen Off)';
    }
    return 'Cloud Trajectory + Push Active (Works Screen Off)';
  };

  // Build unique service pills (include locked service + discovered candidate services)
  const servicePills = Array.from(
    new Set([
      ...(trackedServiceNo ? [trackedServiceNo] : []),
      ...candidateServices,
    ])
  ).slice(0, 5);

  return (
    <div className="fixed inset-0 z-[9999] bg-black text-slate-100 flex flex-col justify-between p-4 sm:p-5 select-none overflow-y-auto pt-safe pb-safe">
      {/* HUD Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-brand-sky">
            <NavIcon className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
              Active Ride Mode
            </span>
            <h2 className="text-sm font-bold text-white">Alighting Wake-Up Alarm</h2>
          </div>
        </div>

        <button
          onClick={onCloseHUD}
          className="p-2 rounded-xl bg-slate-900/80 border border-slate-800 text-slate-400 hover:text-white"
          title="Minimize HUD"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Cloud Background Push Status & Ride Mode Selector */}
      <div className="my-2.5 p-3 rounded-xl bg-slate-950 border border-slate-800/90 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center space-x-2 min-w-0">
            {cloudSynced ? (
              <Cloud className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <CloudOff className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
            )}
            <span
              className={`text-[11px] font-bold truncate ${
                cloudSynced ? 'text-emerald-300' : 'text-amber-300'
              }`}
            >
              {getTrackingBadgeText()}
            </span>
          </div>

          {!cloudSynced && onRetryCloudSync && (
            <button
              onClick={onRetryCloudSync}
              className="px-2 py-0.5 rounded-lg bg-brand-sky/20 border border-brand-sky/50 text-brand-sky text-[10px] font-bold shrink-0 active:scale-95"
            >
              Enable Push
            </button>
          )}
        </div>

        {/* 1-Tap Ride Vehicle / Mode Selector Pills */}
        {onSelectRideMode && (
          <div className="space-y-1">
            <span className="text-[10px] text-slate-400 font-medium block">
              Riding on (locks exact live LTA bus GPS when screen is off):
            </span>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
              <button
                onClick={() => onSelectRideMode('auto_detect', null)}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border shrink-0 transition-all ${
                  trackingMode === 'auto_detect' ||
                  (trackingMode === 'trajectory_eta' && !trackedServiceNo)
                    ? 'bg-brand-sky text-brand-navy border-brand-sky'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <Sparkles className="w-3 h-3" />
                <span>Auto</span>
              </button>

              {servicePills.map((svc) => {
                const isSelected =
                  trackingMode === 'bus_locked' &&
                  String(trackedServiceNo).toLowerCase() === String(svc).toLowerCase();
                return (
                  <button
                    key={svc}
                    onClick={() => onSelectRideMode('bus_locked', svc)}
                    className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border shrink-0 transition-all ${
                      isSelected
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm'
                        : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <Bus className="w-3 h-3" />
                    <span>Bus {svc}</span>
                  </button>
                );
              })}

              <button
                onClick={() => onSelectRideMode('mrt', null)}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border shrink-0 transition-all ${
                  trackingMode === 'mrt'
                    ? 'bg-brand-blue text-white border-brand-sky'
                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <Train className="w-3 h-3" />
                <span>MRT / Car</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main Destination & Distance Display */}
      <div className="text-center my-auto py-3">
        <span className="inline-block px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-mono text-brand-sky font-semibold mb-1.5">
          Destination Stop: {stopCode}
        </span>
        <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-0.5">
          {stopName}
        </h1>
        <p className="text-xs text-slate-400 font-medium mb-5">{roadName}</p>

        {/* Circular Distance Meter */}
        <div className="relative w-52 h-52 sm:w-56 sm:h-56 mx-auto flex flex-col items-center justify-center">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
            <circle
              cx="50"
              cy="50"
              r="44"
              stroke="#1e293b"
              strokeWidth="6"
              fill="transparent"
            />
            <circle
              cx="50"
              cy="50"
              r="44"
              stroke={isTriggered ? '#ef4444' : '#38bdf8'}
              strokeWidth="6"
              strokeDasharray="276.46"
              strokeDashoffset={276.46 - (276.46 * progressPercent) / 100}
              strokeLinecap="round"
              fill="transparent"
              className="transition-all duration-700 ease-out"
            />
          </svg>

          {/* Center Digital Distance */}
          <div className="absolute inset-0 flex flex-col items-center justify-center px-3">
            {isTriggered ? (
              <div className="animate-bounce text-center">
                <Bell className="w-10 h-10 text-rose-500 mx-auto mb-1 animate-pulse" />
                <span className="text-xl font-black text-rose-400">ALIGHT NOW!</span>
                <p className="text-[11px] text-rose-300 font-medium">Within {thresholdMeters}m</p>
              </div>
            ) : (
              <>
                <span className="text-3xl sm:text-4xl font-mono font-black text-white tracking-tight">
                  {formatDistance(currentDistanceMeters)}
                </span>
                <span className="text-xs text-slate-400 mt-1 font-medium">
                  {stopsRemaining !== null && stopsRemaining !== undefined && trackedServiceNo
                    ? `${stopsRemaining} ${stopsRemaining === 1 ? 'stop' : 'stops'} remaining`
                    : 'Remaining Distance'}
                </span>
                <span className="text-[10px] text-slate-500 mt-0.5">
                  Alert threshold: {thresholdMeters}m
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Commuter Settings & Actions */}
      <div className="space-y-2">
        {/* Distance Threshold Selector */}
        {onUpdateThreshold && (
          <div className="flex items-center justify-between bg-slate-950/80 p-2 rounded-xl border border-slate-900">
            <span className="text-[11px] text-slate-400 font-medium pl-1">Alert me within:</span>
            <div className="flex space-x-1.5">
              {[300, 500, 800].map((dist) => (
                <button
                  key={dist}
                  onClick={() => onUpdateThreshold(dist)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    thresholdMeters === dist
                      ? 'bg-brand-sky text-brand-navy'
                      : 'bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  {dist}m
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Controls Bar: Earbuds Nap Shield, Screen Awake, Test Chime */}
        <div className="grid grid-cols-3 gap-1.5">
          {/* Earbuds Nap Mode Toggle */}
          {onToggleNapMode && (
            <button
              onClick={() => onToggleNapMode(!earbudsNapMode)}
              className={`py-2.5 px-2 rounded-xl border text-[11px] font-semibold flex items-center justify-center space-x-1.5 transition-all ${
                earbudsNapMode
                  ? 'bg-emerald-950/70 border-emerald-500/70 text-emerald-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
              title="Plays continuous 45s wake-up chime into your earbuds when screen is locked"
            >
              <Headphones className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Nap: {earbudsNapMode ? 'ON' : 'OFF'}</span>
            </button>
          )}

          {/* Keep Screen Awake Toggle */}
          <button
            onClick={toggleWakeLock}
            className={`py-2.5 px-2 rounded-xl border text-[11px] font-semibold flex items-center justify-center space-x-1.5 transition-all ${
              keepScreenAwake
                ? 'bg-slate-900 border-brand-sky/60 text-brand-sky'
                : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
          >
            {keepScreenAwake ? (
              <Eye className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <EyeOff className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate">Screen: {keepScreenAwake ? 'ON' : 'OFF'}</span>
          </button>

          {/* Gentle Chime Audio Test Button */}
          <button
            onClick={() => {
              unlockAudio();
              playGentleTransitChime();
            }}
            className="py-2.5 px-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-[11px] font-semibold text-slate-300 flex items-center justify-center space-x-1.5 active:scale-95 transition-all"
            title="Preview the calm chime sound"
          >
            <Volume2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">Test Sound</span>
          </button>
        </div>

        {/* Mode Explanation */}
        <p className="text-[10px] text-slate-400 text-center px-2 py-0.5 leading-tight">
          {earbudsNapMode
            ? '🎧 Nap Mode ON: Continuous 45s earbud chime + cloud push active.'
            : cloudSynced
            ? '🔔 Background Ready: Switch apps or lock your screen freely—3-pulse cloud push will alert you.'
            : '⚠️ Foreground GPS active. Tap "Enable Push" above so alerts still ring when screen is off.'}
        </p>

        {/* Primary Stop Alarm / Alighted Button */}
        <button
          onClick={onStopAlarm}
          className={`w-full py-3.5 rounded-2xl font-black text-sm tracking-wide shadow-2xl flex items-center justify-center space-x-2 active:scale-98 transition-all ${
            isTriggered
              ? 'bg-rose-600 hover:bg-rose-500 text-white animate-pulse'
              : 'bg-gradient-to-r from-brand-blue to-brand-sky text-white hover:brightness-110'
          }`}
        >
          {isTriggered ? (
            <>
              <BellOff className="w-5 h-5" />
              <span>I Have Alighted (Stop Alarm)</span>
            </>
          ) : (
            <>
              <CheckCircle className="w-5 h-5" />
              <span>End Ride Alarm</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
