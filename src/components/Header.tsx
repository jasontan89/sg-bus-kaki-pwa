import React, { useState, useEffect } from 'react';
import { Download, Wifi, WifiOff } from 'lucide-react';

interface HeaderProps {
  isOnline: boolean;
  deferredPrompt: any;
  onInstallClick: () => void;
  onMascotClick?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  isOnline,
  deferredPrompt,
  onInstallClick,
  onMascotClick,
}) => {
  const [sgtTime, setSgtTime] = useState('');

  // SGT Clock (UTC+8) updater
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        timeZone: 'Asia/Singapore',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      };
      setSgtTime(new Intl.DateTimeFormat('en-SG', options).format(now));
    };

    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="sticky top-0 z-40 bg-brand-navy/95 backdrop-blur-md border-b border-slate-800 px-4 py-2.5 shadow-lg pt-safe">
      <div className="max-w-md mx-auto flex items-center justify-between">
        {/* Cartoon Mascot & Brand Title */}
        <div 
          className="flex items-center space-x-2.5 cursor-pointer active:scale-95 transition-transform"
          onClick={onMascotClick}
          title="SG Bus Kaki"
        >
          {/* Cute cartoon bus avatar */}
          <div className="relative w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-blue to-brand-sky p-0.5 shadow-md flex items-center justify-center overflow-hidden">
            <img 
              src="/bus-mascot.svg" 
              alt="Bus Kaki Mascot" 
              className="w-9 h-9 object-contain transform hover:rotate-6 transition-transform"
            />
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <h1 className="text-base font-extrabold tracking-tight text-white">Bus Kaki</h1>
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-brand-blue/20 text-brand-sky border border-brand-sky/30">
                PWA
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">SG Commute Buddy</p>
          </div>
        </div>

        {/* Status Indicators & Actions */}
        <div className="flex items-center space-x-2">
          {/* SGT Digital Clock */}
          <div className="px-2 py-1 rounded-md bg-slate-900/80 border border-slate-800 text-[11px] font-mono text-slate-300 font-semibold shadow-inner">
            {sgtTime} <span className="text-brand-sky text-[9px]">SGT</span>
          </div>

          {/* Network Status Badge */}
          <div
            className={`flex items-center space-x-1 px-2 py-1 rounded-md text-[11px] font-medium border ${
              isOnline
                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400'
                : 'bg-amber-950/40 border-amber-800/60 text-amber-300 animate-pulse'
            }`}
            title={isOnline ? 'Connected to live transit network' : 'Offline MRT Tunnel Mode active (Cached)'}
          >
            {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            <span className="hidden sm:inline">{isOnline ? 'Online' : 'Tunnel'}</span>
          </div>

          {/* Install PWA Prompt Button */}
          {deferredPrompt && (
            <button
              onClick={onInstallClick}
              className="flex items-center space-x-1 bg-gradient-to-r from-brand-blue to-brand-sky text-white px-2.5 py-1 rounded-lg text-xs font-bold shadow-md hover:brightness-110 active:scale-95 transition-all"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Install</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
