import React from 'react';
import { AlightingAlarmState } from '../types/transit';
import {
  Bell,
  BellOff,
  Volume2,
  Navigation as NavIcon,
  Eye,
  EyeOff,
  X,
  Info,
  CheckCircle,
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
  onUpdateThreshold?: (meters: number) => void;
  onCloseHUD: () => void;
}

export const ActiveRideHUD: React.FC<ActiveRideHUDProps> = ({
  alarmState,
  onStopAlarm,
  onUpdateKeepAwake,
  onUpdateThreshold,
  onCloseHUD,
}) => {
  const {
    stopCode,
    stopName,
    roadName,
    thresholdMeters,
    currentDistanceMeters,
    isTriggered,
    keepScreenAwake,
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

  const remaining = currentDistanceMeters ?? 1500;
  // Progress calculation towards 500m threshold from initial ~3000m
  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round(((3000 - remaining) / (3000 - thresholdMeters)) * 100))
  );

  return (
    <div className="fixed inset-0 z-[9999] bg-black text-slate-100 flex flex-col justify-between p-5 select-none overflow-y-auto pt-safe pb-safe">
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

      {/* AMOLED Power Saver Notice & Screen Freedom */}
      <div className="my-3 p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 flex items-start space-x-2.5">
        <Info className="w-4 h-4 text-brand-sky shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong className="text-slate-200">Phone Screen Freedom:</strong> You can freely lock your phone screen or switch apps anytime. The alarm will sound its gentle chime when you arrive.
        </p>
      </div>

      {/* Main Destination & Distance Display */}
      <div className="text-center my-auto py-6">
        <span className="inline-block px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-mono text-brand-sky font-semibold mb-2">
          Destination Stop: {stopCode}
        </span>
        <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-1">
          {stopName}
        </h1>
        <p className="text-xs text-slate-400 font-medium mb-8">{roadName}</p>

        {/* Circular Distance Meter */}
        <div className="relative w-56 h-56 mx-auto flex flex-col items-center justify-center">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
            {/* Background ring */}
            <circle
              cx="50"
              cy="50"
              r="44"
              stroke="#1e293b"
              strokeWidth="6"
              fill="transparent"
            />
            {/* Animated progress ring */}
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
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {isTriggered ? (
              <div className="animate-bounce text-center">
                <Bell className="w-10 h-10 text-rose-500 mx-auto mb-1 animate-pulse" />
                <span className="text-xl font-black text-rose-400">ALIGHT NOW!</span>
                <p className="text-[11px] text-rose-300 font-medium">Within {thresholdMeters}m</p>
              </div>
            ) : (
              <>
                <span className="text-4xl sm:text-5xl font-mono font-black text-white tracking-tight">
                  {formatDistance(currentDistanceMeters)}
                </span>
                <span className="text-xs text-slate-400 mt-1 font-medium">
                  Remaining Distance
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
      <div className="space-y-2.5">
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

        {/* Controls Bar */}
        <div className="grid grid-cols-2 gap-2">
          {/* Keep Screen Awake Toggle */}
          <button
            onClick={toggleWakeLock}
            className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center space-x-2 transition-all ${
              keepScreenAwake
                ? 'bg-slate-900 border-brand-sky/60 text-brand-sky'
                : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}
          >
            {keepScreenAwake ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            <span>Screen Awake: {keepScreenAwake ? 'ON' : 'OFF'}</span>
          </button>

          {/* Gentle Chime Audio Test Button */}
          <button
            onClick={() => {
              unlockAudio();
              playGentleTransitChime();
            }}
            className="py-2.5 px-3 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-300 flex items-center justify-center space-x-2 active:scale-95 transition-all"
            title="Preview the calm chime sound"
          >
            <Volume2 className="w-4 h-4 text-emerald-400" />
            <span>Test Chime</span>
          </button>
        </div>

        {/* Primary Stop Alarm / Alighted Button */}
        <button
          onClick={onStopAlarm}
          className={`w-full py-4 rounded-2xl font-black text-sm tracking-wide shadow-2xl flex items-center justify-center space-x-2 active:scale-98 transition-all ${
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
