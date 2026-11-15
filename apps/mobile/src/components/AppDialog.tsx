import { createContext, useCallback, useContext, useState, type ComponentType, type ReactNode } from 'react';
import { Modal, View, Text, Pressable } from 'react-native';
import { colors } from '../constants/colors';

/**
 * The app's own dialog, replacing Alert.alert.
 *
 * Alert.alert draws the operating system's dialog: Android's typography, its
 * corner radius, its button treatment. It is the one surface in the app that
 * looks like it belongs to something else, and it arrives at exactly the
 * moments that most need to feel considered — a refusal, a destructive
 * confirm.
 *
 * The shape is lifted from the delete-review confirm, which was already built
 * to the design and is now this component's first citizen: tinted icon disc,
 * centred title and body, full-width actions at 50pt.
 *
 * `tone` picks the icon tint and the confirm button colour. It does NOT imply
 * a destructive action — an informational dialog uses `brand`, a refusal
 * `warning`, a delete `danger`.
 */

export type DialogTone = 'brand' | 'warning' | 'danger';

const TONES: Record<DialogTone, { bg: string; fg: string; button: string; pressed: string }> = {
  brand:   { bg: colors.brand.mist, fg: colors.brand.DEFAULT, button: colors.brand.DEFAULT, pressed: colors.brand.mid },
  warning: { bg: colors.amber.mist, fg: colors.amber.deep,    button: colors.brand.DEFAULT, pressed: colors.brand.mid },
  danger:  { bg: colors.dangerBg,   fg: colors.danger,        button: colors.danger,        pressed: '#B91C1C' },
};

export interface AppDialogAction {
  label: string;
  onPress?: () => void;
  /** Renders as the outlined secondary button. Defaults to the filled one. */
  variant?: 'primary' | 'secondary';
}

export default function AppDialog({
  visible, title, message, icon: Icon, tone = 'brand', actions, onDismiss,
}: {
  visible: boolean;
  title: string;
  message?: string;
  icon?: ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  tone?: DialogTone;
  /** One or two. Two render side by side, secondary first. */
  actions: AppDialogAction[];
  /** Backdrop tap and Android back. Omit to force a choice from the actions. */
  onDismiss?: () => void;
}) {
  const t = TONES[tone];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss ?? (() => {})}
    >
      <View style={{
        flex: 1, backgroundColor: 'rgba(15,23,42,0.55)',
        justifyContent: 'center', alignItems: 'center',
        paddingHorizontal: 28,
      }}>
        {/* Only dismissable by tapping away when there is something to dismiss
            to — a dialog whose only action is "OK" still needs that action
            pressed, so the message is not lost to a stray tap. */}
        {!!onDismiss && (
          <Pressable onPress={onDismiss} style={{ position: 'absolute', inset: 0 }} />
        )}

        <View style={{
          width: '100%', maxWidth: 360,
          backgroundColor: colors.surface.cream, borderRadius: 18,
          paddingHorizontal: 22, paddingTop: 28, paddingBottom: 22,
          alignItems: 'center',
          borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
          shadowColor: '#0F172A', shadowOpacity: 0.18, shadowRadius: 24,
          shadowOffset: { width: 0, height: 8 }, elevation: 12,
        }}>
          {Icon && (
            <View style={{
              width: 56, height: 56, borderRadius: 28,
              backgroundColor: t.bg,
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 16,
            }}>
              <Icon size={24} color={t.fg} strokeWidth={1.75} />
            </View>
          )}

          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
            {title}
          </Text>
          {!!message && (
            <Text style={{ fontSize: 13, color: colors.gray, lineHeight: 19, textAlign: 'center', marginTop: 8 }}>
              {message}
            </Text>
          )}

          <View style={{
            flexDirection: actions.length > 1 ? 'row' : 'column',
            gap: 10, marginTop: 22, alignSelf: 'stretch',
          }}>
            {actions.map((a) => {
              const secondary = a.variant === 'secondary';
              return (
                <Pressable
                  key={a.label}
                  onPress={a.onPress}
                  style={({ pressed }) => ({
                    flex: actions.length > 1 ? 1 : undefined,
                    height: 50, borderRadius: 12,
                    justifyContent: 'center', alignItems: 'center',
                    backgroundColor: secondary
                      ? colors.surface.cream
                      : pressed ? t.pressed : t.button,
                    borderWidth: secondary ? 1 : 0,
                    borderColor: colors.border,
                    opacity: secondary && pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{
                    fontSize: 14, fontWeight: '700',
                    color: secondary ? colors.ink : '#FFFFFF',
                  }}>
                    {a.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}


/* ── imperative API ─────────────────────────────────────────────────────── */

/**
 * `Alert.alert` is imperative — you call it from an event handler, not from
 * render. Every call site in the app was written that way, so a purely
 * declarative component would have meant hoisting state into seven screens to
 * change how a dialog looks. This provider keeps the ergonomics and changes
 * only the pixels, mirroring ToastProvider next door.
 *
 * One dialog at a time: a second `show` replaces the first rather than
 * stacking, because two dialogs over each other is never the intent.
 */

export interface ShowDialogOptions {
  title: string;
  message?: string;
  icon?: ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  tone?: DialogTone;
  actions?: AppDialogAction[];
  /** Defaults to true. Pass false when the actions must be chosen from. */
  dismissable?: boolean;
}

interface DialogContextValue {
  show: (options: ShowDialogOptions) => void;
  /** Title + message + a single acknowledging button. */
  alert: (title: string, message?: string, okLabel?: string) => void;
  /** Two buttons, the confirming one in the danger tone. */
  confirm: (options: ShowDialogOptions & {
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
  }) => void;
  hide: () => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<ShowDialogOptions | null>(null);

  const hide = useCallback(() => setDialog(null), []);
  const show = useCallback((options: ShowDialogOptions) => setDialog(options), []);

  const alert: DialogContextValue['alert'] = useCallback((title, message, okLabel) => {
    setDialog({
      title,
      message,
      actions: [{ label: okLabel ?? 'OK', onPress: () => setDialog(null) }],
    });
  }, []);

  const confirm: DialogContextValue['confirm'] = useCallback((o) => {
    setDialog({
      tone: 'danger',
      ...o,
      actions: [
        { label: o.cancelLabel, variant: 'secondary', onPress: () => setDialog(null) },
        { label: o.confirmLabel, onPress: () => { setDialog(null); o.onConfirm(); } },
      ],
    });
  }, []);

  return (
    <DialogContext.Provider value={{ show, alert, confirm, hide }}>
      {children}
      {!!dialog && (
        <AppDialog
          visible
          title={dialog.title}
          message={dialog.message}
          icon={dialog.icon}
          tone={dialog.tone}
          actions={dialog.actions ?? [{ label: 'OK', onPress: hide }]}
          onDismiss={dialog.dismissable === false ? undefined : hide}
        />
      )}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>');
  return ctx;
}
