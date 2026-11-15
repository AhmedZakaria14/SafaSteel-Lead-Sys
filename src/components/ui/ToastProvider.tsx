import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
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
  const timerRef = useRef<number | null>(null);

  const notify = useCallback((message: string, variant: ToastVariant = 'info', options?: ToastOptions) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    // Keep only 1 compact toast visible at a time so batch updates never stack up and cover mobile screens
    setToasts([{ id, message, variant, actionLabel: options?.actionLabel, onAction: options?.onAction }]);
    timerRef.current = window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timerRef.current = null;
    }, 3800);
  }, []);

  const dismiss = (id: string) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="fixed bottom-[calc(4.1rem+env(safe-area-inset-bottom))] md:bottom-4 inset-x-3 sm:inset-x-auto sm:end-4 z-50 flex flex-col gap-1.5 sm:max-w-sm sm:w-full pointer-events-none">
        {toasts.slice(-1).map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs shadow-lg backdrop-blur-md bg-white/95 dark:bg-slate-900/95 crm-animate-enter ${
              t.variant === 'success'
                ? 'border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100'
                : t.variant === 'error'
                  ? 'border-red-200 dark:border-red-800 text-red-900 dark:text-red-100'
                  : 'border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {t.variant === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
              {t.variant === 'error' && <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />}
              {t.variant === 'info' && <Info className="h-4 w-4 shrink-0 text-blue-600" />}
              <span className="line-clamp-2 font-medium leading-snug">{t.message}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {t.actionLabel && t.onAction && (
                <button
                  type="button"
                  onClick={() => {
                    t.onAction?.();
                    dismiss(t.id);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap min-h-[28px]"
                >
                  <span>{t.actionLabel}</span>
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              )}
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Dismiss"
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

