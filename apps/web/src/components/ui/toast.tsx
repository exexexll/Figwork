'use client';

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { X, CheckCircle, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/cn';

// ─── Types ───────────────────────────────────────────────────────────
export interface Toast {
  id: string;
  title: string;
  message?: string;
  type: 'info' | 'success' | 'warning' | 'error';
  duration?: number; // ms, default 5000
}

interface ToastContextValue {
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
}

// ─── Context ─────────────────────────────────────────────────────────
const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const duration = t.duration ?? 5000;

      setToasts((prev) => [...prev.slice(-4), { ...t, id }]); // max 5 visible

      const timer = setTimeout(() => {
        dismiss(id);
      }, duration);
      timers.current.set(id, timer);
    },
    [dismiss]
  );

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timers.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ─── Container ───────────────────────────────────────────────────────
function ToastContainer({
  toasts,
  dismiss,
}: {
  toasts: Toast[];
  dismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

// ─── Single Toast ────────────────────────────────────────────────────
const iconMap = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
};

const colorMap = {
  info: {
    bg: 'bg-blue-50 border-blue-200',
    icon: 'text-blue-500',
    title: 'text-blue-900',
    message: 'text-blue-700',
  },
  success: {
    bg: 'bg-green-50 border-green-200',
    icon: 'text-green-500',
    title: 'text-green-900',
    message: 'text-green-700',
  },
  warning: {
    bg: 'bg-amber-50 border-amber-200',
    icon: 'text-amber-500',
    title: 'text-amber-900',
    message: 'text-amber-700',
  },
  error: {
    bg: 'bg-red-50 border-red-200',
    icon: 'text-red-500',
    title: 'text-red-900',
    message: 'text-red-700',
  },
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  const Icon = iconMap[toast.type];
  const colors = colorMap[toast.type];
  const [exiting, setExiting] = useState(false);

  function handleDismiss() {
    setExiting(true);
    setTimeout(onDismiss, 200);
  }

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-sm transition-all duration-200',
        colors.bg,
        exiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0 animate-slide-in-right'
      )}
    >
      <Icon className={cn('w-5 h-5 mt-0.5 flex-shrink-0', colors.icon)} />
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-medium', colors.title)}>{toast.title}</p>
        {toast.message && (
          <p className={cn('text-xs mt-0.5 line-clamp-2', colors.message)}>
            {toast.message}
          </p>
        )}
      </div>
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 p-0.5 rounded-md hover:bg-black/5 transition-colors"
      >
        <X className="w-3.5 h-3.5 text-current opacity-40" />
      </button>
    </div>
  );
}
