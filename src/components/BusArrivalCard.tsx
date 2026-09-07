import React from 'react';
import { BusServiceArrival, NextBusInfo } from '../types/transit';
import { Bell, Accessibility, Layers, Route as RouteIcon } from 'lucide-react';

interface BusArrivalCardProps {
  service: BusServiceArrival;
  busStopCode: string;
  busStopName: string;
  onSetAlarm: (serviceNo: string) => void;
  onViewRoute?: (serviceNo: string) => void;
}

export const BusArrivalCard: React.FC<BusArrivalCardProps> = ({
  service,
  onSetAlarm,
  onViewRoute,
}) => {
  const getEtaText = (bus?: NextBusInfo) => {
    if (!bus || bus.etaMinutes === null || bus.etaMinutes === undefined) return '-';
    if (bus.etaMinutes <= 0) return 'Arr';
    return `${bus.etaMinutes}m`;
  };

  const getLoadBadge = (load?: string) => {
    switch (load) {
      case 'SEA':
        return {
          label: 'Seats Avail',
          color: 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300',
          dot: 'bg-emerald-400',
        };
      case 'SDA':
        return {
          label: 'Standing Avail',
          color: 'bg-amber-950/60 border-amber-500/50 text-amber-300',
          dot: 'bg-amber-400',
        };
      case 'LSD':
        return {
          label: 'Crowded',
          color: 'bg-rose-950/60 border-rose-500/50 text-rose-300',
          dot: 'bg-rose-400',
        };
      default:
        return {
          label: 'Normal',
          color: 'bg-slate-800/60 border-slate-700 text-slate-300',
          dot: 'bg-slate-400',
        };
    }
  };

  const buses = [
    { label: 'Next', bus: service.nextBus },
    { label: '2nd', bus: service.nextBus2 },
    { label: '3rd', bus: service.nextBus3 },
  ];

  return (
    <div className="bg-brand-dark/80 hover:bg-brand-dark border border-slate-800 hover:border-slate-700 rounded-xl p-3 shadow-md transition-all">
      <div className="flex items-center justify-between mb-2">
        {/* Service Number & Operator */}
        <div className="flex items-center space-x-2">
          <span className="bg-gradient-to-r from-brand-blue to-brand-sky text-white font-extrabold text-base px-2.5 py-0.5 rounded-lg shadow-sm">
            {service.serviceNo}
          </span>
          <span className="text-[10px] text-slate-400 uppercase font-semibold">
            {service.operator || 'LTA'}
          </span>
        </div>

        {/* Action Buttons: Route & Arrival Alarm */}
        <div className="flex items-center space-x-1">
          {onViewRoute && (
            <button
              onClick={() => onViewRoute(service.serviceNo)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-brand-sky hover:bg-slate-800/80 transition-colors"
              title="View bus route sequence"
            >
              <RouteIcon className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => onSetAlarm(service.serviceNo)}
            className="flex items-center space-x-1 px-2 py-1 rounded-lg text-xs font-semibold text-brand-sky bg-brand-sky/10 border border-brand-sky/30 hover:bg-brand-sky/20 active:scale-95 transition-all"
            title="Set arrival countdown alert"
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Alert</span>
          </button>
        </div>
      </div>

      {/* 3 Arrival Slots Grid */}
      <div className="grid grid-cols-3 gap-2">
        {buses.map(({ label, bus }, idx) => {
          const eta = getEtaText(bus);
          const loadBadge = getLoadBadge(bus?.load);
          const isArrivingNow = eta === 'Arr';

          if (!bus || bus.etaMinutes === null) {
            return (
              <div
                key={idx}
                className="bg-slate-900/40 border border-slate-800/50 rounded-lg p-2 text-center opacity-40"
              >
                <span className="text-[10px] text-slate-500 block mb-0.5">{label}</span>
                <span className="text-xs text-slate-600 font-mono font-semibold">-</span>
              </div>
            );
          }

          return (
            <div
              key={idx}
              className={`rounded-lg p-2 border text-center transition-all ${
                isArrivingNow
                  ? 'bg-emerald-950/30 border-emerald-500/40 shadow-inner'
                  : 'bg-slate-900/70 border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                <span>{label}</span>
                <div className="flex items-center space-x-1">
                  {bus.type === 'DD' && (
                    <span title="Double Decker" className="text-[9px] font-bold text-brand-sky">
                      <Layers className="w-3 h-3 inline" />
                    </span>
                  )}
                  {bus.feature === 'WAB' && (
                    <span title="Wheelchair Accessible" className="text-slate-400">
                      <Accessibility className="w-3 h-3 inline" />
                    </span>
                  )}
                </div>
              </div>

              {/* Big ETA Number */}
              <div className="my-1">
                <span
                  className={`font-mono text-lg font-black tracking-tight ${
                    isArrivingNow
                      ? 'text-emerald-400 animate-pulse'
                      : bus.etaMinutes !== null && bus.etaMinutes <= 3
                      ? 'text-amber-400'
                      : 'text-slate-100'
                  }`}
                >
                  {eta}
                </span>
              </div>

              {/* Crowd Load Pill */}
              <div
                className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded border text-[9px] font-semibold ${loadBadge.color}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${loadBadge.dot}`} />
                <span>{loadBadge.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
