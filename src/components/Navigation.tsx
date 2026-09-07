import React from 'react';
import { Compass, Star, Search, Train, Bell, Navigation as NavIcon } from 'lucide-react';
import { AlightingAlarmState } from '../types/transit';
import { formatDistance } from '../services/alarmManager';

export type TabType = 'nearby' | 'favorites' | 'search' | 'mrt' | 'alerts' | 'hud';

interface NavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  alightAlarm: AlightingAlarmState;
  favoritesCount: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onTabChange,
  alightAlarm,
  favoritesCount,
}) => {
  const navItems: { id: TabType; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'nearby', label: 'Nearby', icon: <Compass className="w-5 h-5" /> },
    { id: 'favorites', label: 'Favorites', icon: <Star className="w-5 h-5" />, badge: favoritesCount },
    { id: 'search', label: 'Search', icon: <Search className="w-5 h-5" /> },
    { id: 'mrt', label: 'MRT Map', icon: <Train className="w-5 h-5" /> },
    { id: 'alerts', label: 'Alerts', icon: <Bell className="w-5 h-5" /> },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 pb-[env(safe-area-inset-bottom,0px)] pointer-events-none">
      <div className="max-w-md mx-auto px-4 pb-2">
        {/* Active Ride HUD Floating Banner (When Commute Alarm is Armed) */}
        {alightAlarm.armed && (
          <div className="pointer-events-auto mb-2 animate-bounce-subtle">
            <button
              onClick={() => onTabChange('hud')}
              className={`w-full py-2 px-3.5 rounded-xl border flex items-center justify-between shadow-xl backdrop-blur-md transition-all ${
                alightAlarm.isTriggered
                  ? 'bg-red-950/90 border-red-500 text-red-100 animate-pulse'
                  : 'bg-slate-900/90 border-brand-sky/60 text-slate-100 hover:border-brand-sky'
              }`}
            >
              <div className="flex items-center space-x-2.5">
                <span className="relative flex h-3 w-3">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    alightAlarm.isTriggered ? 'bg-red-400' : 'bg-brand-sky'
                  }`} />
                  <span className={`relative inline-flex rounded-full h-3 w-3 ${
                    alightAlarm.isTriggered ? 'bg-red-500' : 'bg-brand-sky'
                  }`} />
                </span>
                <div className="text-left">
                  <p className="text-xs font-bold leading-tight flex items-center gap-1">
                    <NavIcon className="w-3.5 h-3.5 text-brand-sky" />
                    {alightAlarm.isTriggered ? 'ALIGHT NOW!' : 'Active Ride HUD'}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate max-w-[170px]">
                    To {alightAlarm.stopName} ({alightAlarm.stopCode})
                  </p>
                </div>
              </div>

              <div className="text-right">
                <span className="text-xs font-mono font-bold text-brand-sky">
                  {formatDistance(alightAlarm.currentDistanceMeters)}
                </span>
                <p className="text-[9px] text-slate-400">Tap to view</p>
              </div>
            </button>
          </div>
        )}

        {/* Bottom Navigation Bar */}
        <nav className="pointer-events-auto bg-brand-dark/95 backdrop-blur-lg border border-slate-800 rounded-2xl shadow-2xl px-2 py-1.5 flex items-center justify-around">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`relative flex flex-col items-center justify-center flex-1 py-1.5 px-1 rounded-xl transition-all ${
                  isActive
                    ? 'text-brand-sky bg-brand-blue/15 font-bold'
                    : 'text-slate-400 hover:text-slate-200 font-medium'
                }`}
              >
                <div className="relative">
                  {item.icon}
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="absolute -top-1 -right-2 bg-brand-sky text-brand-navy font-extrabold text-[9px] w-4 h-4 rounded-full flex items-center justify-center">
                      {item.badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] tracking-tight mt-0.5">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
};
