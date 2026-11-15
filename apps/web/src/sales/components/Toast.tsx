import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  variant: ToastVariant;
  title: string;
  body?: string;
}

interface ToastContextValue {
  show: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, body?: string) => void;
  error: (title: string, body?: string) => void;
  warning: (title: string, body?: string) => void;
  info: (title: string, body?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 3500;

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = nextId++;
    setToasts((prev) => [{ id, ...toast }, ...prev].slice(0, 4));
    window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
  }, [dismiss]);

  const value: ToastContextValue = {
    show,
    success: (title, body) => show({ variant: 'success', title, body }),
    error: (title, body) => show({ variant: 'error', title, body }),
    warning: (title, body) => show({ variant: 'warning', title, body }),
    info: (title, body) => show({ variant: 'info', title, body }),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      role="region"
      aria-label="Notifications"
      className="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none max-w-[340px]"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

const VARIANTS: Record<ToastVariant, { border: string; icon: ReactNode }> = {
  success: { border: 'border-l-4 border-brand',   icon: <CheckCircle2  size={20} strokeWidth={1.75} className="text-brand shrink-0" /> },
  error:   { border: 'border-l-4 border-danger',  icon: <AlertCircle   size={20} strokeWidth={1.75} className="text-danger shrink-0" /> },
  warning: { border: 'border-l-4 border-warning', icon: <AlertTriangle size={20} strokeWidth={1.75} className="text-warning shrink-0" /> },
  info:    { border: 'border-l-4 border-info',    icon: <Info          size={20} strokeWidth={1.75} className="text-info shrink-0" /> },
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [enter, setEnter] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setEnter(true));
    return () => window.cancelAnimationFrame(id);
  }, []);
  const { border, icon } = VARIANTS[toast.variant];
  return (
    <div
      role="status"
      className={`pointer-events-auto bg-card ${border} rounded-xl px-4 py-3 shadow-float flex items-start gap-3 transition-all duration-200 ${
        enter ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-3'
      }`}
    >
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-ink font-display leading-tight">{toast.title}</p>
        {toast.body && <p className="text-xs text-gray font-body mt-0.5 leading-snug">{toast.body}</p>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-muted hover:text-ink transition-colors shrink-0"
        aria-label="Dismiss"
      >
        <X size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}
