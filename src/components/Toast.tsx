import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  text: string;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="fixed top-14 left-0 right-0 z-50 pointer-events-none flex flex-col items-center space-y-2 px-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex items-center justify-between space-x-2 px-4 py-2.5 rounded-xl shadow-2xl border backdrop-blur-md max-w-sm w-full animate-in fade-in slide-in-from-top-4 duration-200 ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500 text-emerald-100'
              : toast.type === 'error'
              ? 'bg-rose-950/90 border-rose-500 text-rose-100'
              : 'bg-slate-900/90 border-brand-sky text-slate-100'
          }`}
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : toast.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-brand-sky shrink-0" />
            )}
            <p className="text-xs font-medium truncate">{toast.text}</p>
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            className="text-slate-400 hover:text-white p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
