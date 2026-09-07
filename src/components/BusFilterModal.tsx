import React from 'react';
import { Filter, X, Check } from 'lucide-react';

interface BusFilterModalProps {
  isOpen: boolean;
  busStopCode: string;
  busStopName: string;
  availableServices: string[];
  hiddenServices: string[];
  onToggleService: (serviceNo: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onClose: () => void;
}

export const BusFilterModal: React.FC<BusFilterModalProps> = ({
  isOpen,
  busStopCode,
  busStopName,
  availableServices,
  hiddenServices,
  onToggleService,
  onSelectAll,
  onClearAll,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-brand-card border border-slate-700 w-full max-w-sm rounded-2xl p-5 shadow-2xl animate-in slide-in-from-bottom-6 duration-200">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-brand-blue/20 text-brand-sky flex items-center justify-center">
              <Filter className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Filter Bus Services</h3>
              <p className="text-xs text-slate-400">{busStopName} ({busStopCode})</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-slate-400 mb-3">
          Select which bus numbers you take at this stop. Hidden buses will be filtered out.
        </p>

        {/* Quick actions */}
        <div className="flex space-x-2 mb-3">
          <button
            onClick={onSelectAll}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-300"
          >
            Show All
          </button>
          <button
            onClick={onClearAll}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-300"
          >
            Hide All
          </button>
        </div>

        {/* Service grid */}
        <div className="grid grid-cols-4 gap-2 max-h-60 overflow-y-auto pr-1 mb-4">
          {availableServices.map((svc) => {
            const isHidden = hiddenServices.includes(svc);
            return (
              <button
                key={svc}
                onClick={() => onToggleService(svc)}
                className={`py-2 px-2 rounded-xl text-center border font-bold text-xs transition-all flex flex-col items-center justify-center space-y-1 ${
                  !isHidden
                    ? 'bg-brand-blue/20 border-brand-sky/60 text-brand-sky font-extrabold shadow-sm'
                    : 'bg-slate-900/60 border-slate-800 text-slate-500 opacity-60'
                }`}
              >
                <span>{svc}</span>
                {!isHidden && <Check className="w-3 h-3 text-brand-sky" />}
              </button>
            );
          })}
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-brand-blue to-brand-sky text-white font-bold text-xs shadow-md hover:brightness-110 active:scale-95 transition-all"
        >
          Done
        </button>
      </div>
    </div>
  );
};
