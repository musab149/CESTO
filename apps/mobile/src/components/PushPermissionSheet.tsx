import { Modal, View, Text, Pressable, Animated, Easing, Platform } from 'react-native';
import { useEffect, useRef } from 'react';
import { Bell } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { accountService } from '@grocery-app/shared';
import { colors } from '../constants/colors';
import { useLanguageStore } from '../stores/languageStore';
import { useToast } from './Toast';

// Spec §1.12 P275: prompt is shown ONCE on the Order Confirmation screen
// (highest-intent moment). If user picks "Later", never re-show.
const STORAGE_KEY = 'cesto-push-prompt-shown';
const PREF_KEY = 'cesto-push-enabled';
const TOKEN_KEY = 'cesto-push-token';

export async function shouldShowPushPrompt(): Promise<boolean> {
  const shown = await AsyncStorage.getItem(STORAGE_KEY);
  return shown !== 'true';
}

/**
 * Ask the OS for notification permission, fetch the FCM/APNs token, and
 * register it with the backend. Idempotent — the /api/users/fcm-token
 * endpoint upserts on token uniqueness.
 *
 * Returns true if the user allowed and we successfully registered.
 */
export async function requestPermissionAndRegisterToken(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    status = req.status;
  }
  if (status !== 'granted') return false;

  // Native FCM (Android) / APNs (iOS) token — what firebase-admin sends to.
  let token: string;
  try {
    const res = await Notifications.getDevicePushTokenAsync();
    token = res.data;
  } catch (err) {
    console.warn('[push] getDevicePushTokenAsync failed', err);
    return false;
  }

  const platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';
  try {
    await accountService.saveFcmToken(token, platform);
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return true;
  } catch (err) {
    console.warn('[push] saveFcmToken failed', err);
    return false;
  }
}

/**
 * Read the OS permission without prompting. The settings screen needs to know
 * the real state — it used to hardcode 'granted', so its "you have blocked
 * notifications" branch could never render.
 */
export async function getPushPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status === 'granted') return 'granted';
    // canAskAgain distinguishes "not asked yet" from "asked and refused";
    // only the latter needs sending the user to system settings.
    if (perm.status === 'denied' && perm.canAskAgain) return 'undetermined';
    return perm.status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    return 'undetermined';
  }
}

/**
 * Drop this device's token server-side. The OS permission is deliberately left
 * alone — an app cannot revoke it, and prompting the user into system settings
 * to turn off *our* notifications would be hostile. Clearing the token is what
 * actually stops the sends.
 */
export async function unregisterPushToken(): Promise<void> {
  try {
    await accountService.deleteFcmToken();
  } catch (err) {
    console.warn('[push] deleteFcmToken failed', err);
  }
  await AsyncStorage.removeItem(TOKEN_KEY);
}

/**
 * If permission is already granted (e.g. after signing in on a new device),
 * silently refresh the token with the backend. Safe to call on every app
 * start — no-ops when permission isn't granted yet.
 */
export async function refreshPushTokenIfGranted(): Promise<void> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status !== 'granted') return;
    const res = await Notifications.getDevicePushTokenAsync();
    const platform: 'ios' | 'android' = Platform.OS === 'ios' ? 'ios' : 'android';
    const stored = await AsyncStorage.getItem(TOKEN_KEY);
    if (stored === res.data) return;
    await accountService.saveFcmToken(res.data, platform);
    await AsyncStorage.setItem(TOKEN_KEY, res.data);
  } catch {
    /* best-effort; the sheet still handles first-time flow */
  }
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

const COPY = {
  es: {
    title: 'Activa las notificaciones',
    body: 'Activa las notificaciones para saber cuándo llega tu pedido.',
    bullet1: 'Confirmación y franja de entrega',
    bullet2: 'Aviso cuando el repartidor sale con tu pedido',
    bullet3: 'Confirmación al recibirlo',
    allow: 'Activar',
    later: 'Más tarde',
    enabledToastTitle: 'Notificaciones activadas',
    enabledToastBody: 'Te avisaremos cuando tu pedido cambie de estado.',
  },
  en: {
    title: 'Turn on notifications',
    body: "Turn on notifications so you know when your order arrives.",
    bullet1: 'Order confirmation and delivery slot',
    bullet2: 'Alert when your rider is on the way',
    bullet3: 'Confirmation when delivered',
    allow: 'Allow',
    later: 'Later',
    enabledToastTitle: 'Notifications enabled',
    enabledToastBody: "We'll alert you when your order status changes.",
  },
} as const;

export default function PushPermissionSheet({ visible, onClose }: Props) {
  const { lang } = useLanguageStore();
  const t = COPY[lang];
  const toast = useToast();
  const translateY = useRef(new Animated.Value(400)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(translateY,      { toValue: 0,   duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdropOpacity, { toValue: 1,   duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      translateY.setValue(400);
      backdropOpacity.setValue(0);
    }
  }, [visible, translateY, backdropOpacity]);

  const finish = async (allowed: boolean) => {
    AsyncStorage.setItem(STORAGE_KEY, 'true');
    if (!allowed) {
      onClose();
      return;
    }
    const registered = await requestPermissionAndRegisterToken();
    if (registered) {
      AsyncStorage.setItem(PREF_KEY, 'true');
      toast.success(t.enabledToastTitle, t.enabledToastBody);
    } else {
      // User picked "Allow" in-app but the OS-level prompt was declined,
      // or token registration failed. Silent — the OS prompt already
      // spoke for itself, and STORAGE_KEY is set so we don't re-prompt.
    }
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={() => finish(false)}
    >
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: 'rgba(15, 23, 42, 0.55)',
          opacity: backdropOpacity,
          justifyContent: 'flex-end',
        }}
      >
        <Pressable style={{ flex: 1 }} onPress={() => finish(false)} />
        <Animated.View
          style={{
            backgroundColor: colors.surface.cream,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 24,
            paddingTop: 28,
            paddingBottom: 32,
            transform: [{ translateY }],
          }}
        >
          <View style={{
            width: 64, height: 64, borderRadius: 32,
            backgroundColor: colors.brand.mist,
            justifyContent: 'center', alignItems: 'center',
            alignSelf: 'center', marginBottom: 16,
          }}>
            <Bell size={28} color={colors.brand.DEFAULT} strokeWidth={1.75} />
          </View>

          <Text style={{
            fontSize: 20, fontWeight: '700',
            color: colors.ink, textAlign: 'center', marginBottom: 8,
          }}>
            {t.title}
          </Text>

          <Text style={{
            fontSize: 14, color: colors.gray,
            textAlign: 'center', lineHeight: 20, marginBottom: 18,
          }}>
            {t.body}
          </Text>

          <View style={{ gap: 8, marginBottom: 24 }}>
            {[t.bullet1, t.bullet2, t.bullet3].map((line) => (
              <View key={line} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brand.DEFAULT, marginTop: 7 }} />
                <Text style={{ flex: 1, fontSize: 13, color: colors.charcoal, lineHeight: 18 }}>
                  {line}
                </Text>
              </View>
            ))}
          </View>

          <Pressable
            onPress={() => finish(true)}
            style={{
              height: 52, borderRadius: 12, backgroundColor: colors.brand.DEFAULT,
              justifyContent: 'center', alignItems: 'center', marginBottom: 10,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>
              {t.allow}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => finish(false)}
            style={{ height: 44, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.gray }}>
              {t.later}
            </Text>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
