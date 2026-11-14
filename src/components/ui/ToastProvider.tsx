import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X, ArrowUpRight } from 'lucide-react';

type ToastVariant = 'success' | 'error' | 'info';

export interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastContextValue {
  notify: (message: string, variant?: ToastVariant, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue>({ notify: () => {} });

export const useToast = () => useContext(ToastContext);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const notify = useCallback((message: string, variant: ToastVariant = 'info', options?: ToastOptions) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [
      ...prev,
      { id, message, variant, actionLabel: options?.actionLabel, onAction: options?.onAction },
    ]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5500);
  }, []);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="fixed bottom-4 end-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center justify-between gap-2.5 rounded-xl border px-4 py-3 text-xs sm:text-sm shadow-lg bg-white dark:bg-slate-900 crm-animate-enter ${
              t.variant === 'success'
                ? 'border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100'
                : t.variant === 'error'
                  ? 'border-red-200 dark:border-red-800 text-red-900 dark:text-red-100'
                  : 'border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              {t.variant === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
              {t.variant === 'error' && <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />}
              {t.variant === 'info' && <Info className="h-4 w-4 shrink-0 text-blue-600" />}
              <span className="truncate font-medium">{t.message}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {t.actionLabel && t.onAction && (
                <button
                  type="button"
                  onClick={() => {
                    t.onAction?.();
                    dismiss(t.id);
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap"
                >
                  <span>{t.actionLabel}</span>
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              )}
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
