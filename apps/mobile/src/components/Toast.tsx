import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { View, Text, Pressable, Animated, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react-native';
import { colors } from '../constants/colors';

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
    setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
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
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={[
        StyleSheet.absoluteFillObject,
        { top: insets.top + 8, paddingHorizontal: 12, alignItems: 'center' },
      ]}
    >
      <View style={{ width: '100%', maxWidth: 360, gap: 8 }} pointerEvents="box-none">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
        ))}
      </View>
    </View>
  );
}

const VARIANTS: Record<ToastVariant, { color: string; Icon: typeof CheckCircle2 }> = {
  success: { color: colors.brand.DEFAULT, Icon: CheckCircle2 },
  error:   { color: colors.danger,        Icon: AlertCircle },
  warning: { color: colors.warning,       Icon: AlertTriangle },
  info:    { color: colors.info,          Icon: Info },
};

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const translateY = useRef(new Animated.Value(-20)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }),
      Animated.timing(opacity,    { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY]);

  const { color, Icon } = VARIANTS[toast.variant];
  return (
    <Animated.View
      style={{
        transform: [{ translateY }],
        opacity,
        backgroundColor: '#fff',
        borderLeftWidth: 4,
        borderLeftColor: color,
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        ...Platform.select({
          ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 16 },
          android: { elevation: 6 },
        }),
      }}
    >
      <Icon size={20} color={color} strokeWidth={1.75} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink, lineHeight: 18 }}>
          {toast.title}
        </Text>
        {toast.body && (
          <Text style={{ fontSize: 12, color: colors.gray, lineHeight: 16, marginTop: 2 }}>
            {toast.body}
          </Text>
        )}
      </View>
      <Pressable onPress={onDismiss} hitSlop={8}>
        <X size={16} color={colors.muted} strokeWidth={1.75} />
      </Pressable>
    </Animated.View>
  );
}
