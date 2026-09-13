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

  /**
   * Colors the arrival tile background and border by seat availability:
   * SEA = Green (Seats Available)
   * SDA = Amber (Standing Available)
   * LSD = Red (Limited Standing / Crowded)
   */
  const getTileStyle = (bus?: NextBusInfo) => {
    if (!bus || bus.etaMinutes === null || bus.etaMinutes === undefined) {
      return 'bg-slate-900/60 border-slate-800 text-slate-600 opacity-40';
    }

    switch (bus.load) {
      case 'SEA':
        return 'bg-emerald-600 border-emerald-500 text-white shadow-sm';
      case 'SDA':
        return 'bg-amber-600 border-amber-500 text-white shadow-sm';
      case 'LSD':
        return 'bg-rose-600 border-rose-500 text-white shadow-sm';
      default:
        return 'bg-slate-800 border-slate-700 text-slate-200';
    }
  };

  const buses = [
    { label: 'Next', bus: service.nextBus },
    { label: '2nd', bus: service.nextBus2 },
    { label: '3rd', bus: service.nextBus3 },
  ];

  return (
    <div className="bg-brand-dark/90 hover:bg-brand-dark border border-slate-800 hover:border-slate-700/80 rounded-xl px-3 py-2 shadow-md flex items-center justify-between gap-1.5 transition-all">
      {/* Left: Service Badge, Operator & Actions */}
      <div className="flex items-center space-x-2 shrink-0">
        <span className="bg-gradient-to-r from-brand-blue to-brand-sky text-white font-black text-sm px-2.5 py-1 rounded-lg shadow-sm min-w-[48px] text-center tracking-tight">
          {service.serviceNo}
        </span>

        {/* Action Buttons: View Route & Arrival Alert */}
        <div className="flex items-center space-x-1">
          {onViewRoute && (
            <button
              onClick={() => onViewRoute(service.serviceNo)}
              className="p-1.5 rounded-lg text-slate-400 hover:text-brand-sky hover:bg-slate-800 transition-colors"
              title="View bus route sequence"
            >
              <RouteIcon className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => onSetAlarm(service.serviceNo)}
            className="p-1.5 rounded-lg text-brand-sky bg-brand-sky/10 border border-brand-sky/30 hover:bg-brand-sky/20 active:scale-95 transition-all"
            title="Set arrival countdown alert"
          >
            <Bell className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Right: Single-Line 3 Arrival Tiles colored by seat availability */}
      <div className="flex items-center space-x-1.5">
        {buses.map(({ label, bus }, idx) => {
          const eta = getEtaText(bus);
          const tileStyle = getTileStyle(bus);
          const isArrivingNow = eta === 'Arr';

          return (
            <div
              key={idx}
              className={`min-w-[54px] sm:min-w-[58px] py-1 px-1.5 rounded-lg border text-center font-mono font-black text-xs flex items-center justify-center space-x-0.5 transition-all ${tileStyle}`}
              title={`${label} bus: ${eta === '-' ? 'No data' : `${eta} (${bus?.load === 'SEA' ? 'Seats Available' : bus?.load === 'SDA' ? 'Standing Available' : bus?.load === 'LSD' ? 'Limited Standing' : 'Normal'})`}`}
            >
              <span className={isArrivingNow ? 'animate-pulse font-black' : ''}>
                {eta}
              </span>
              {/* Micro bus feature icons */}
              {bus && (
                <span className="flex items-center space-x-0.5 opacity-90 pl-0.5">
                  {bus.type === 'DD' && (
                    <span title="Double Decker">
                      <Layers className="w-2.5 h-2.5 inline" />
                    </span>
                  )}
                  {bus.feature === 'WAB' && (
                    <span title="Wheelchair Accessible">
                      <Accessibility className="w-2.5 h-2.5 inline" />
                    </span>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

