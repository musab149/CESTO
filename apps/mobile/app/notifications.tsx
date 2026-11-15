import { View, Text, ScrollView, Pressable, Switch, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, Bell, BellOff, Settings, ShieldCheck } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';
import { useToast } from '../src/components/Toast';
import {
  getPushPermissionStatus,
  requestPermissionAndRegisterToken,
  unregisterPushToken,
} from '../src/components/PushPermissionSheet';

const STORAGE_KEY = 'cesto-push-enabled';

// The comment that used to sit here said expo-notifications wasn't installed
// yet. It has been since July: the permission prompt, the FCM token and the
// backend registration all live in PushPermissionSheet. This screen simply
// never called any of it — the toggle wrote one AsyncStorage flag and
// `osPermission` was the literal 'granted', so switching it off left the
// device registered and still receiving pushes.
type OSPermission = 'granted' | 'denied' | 'undetermined';

const COPY = {
  es: {
    heading: 'Notificaciones',
    intro: 'Te avisaremos cuando tu pedido se confirme, esté en preparación, en camino y entregado. Solo lo importante.',
    sectionTitle: 'Notificaciones push',
    sectionDesc: 'Avisos en tiempo real sobre el estado de tus pedidos.',
    toggleEnabled: 'Activadas',
    toggleDisabled: 'Desactivadas',
    permissionGranted: 'Permiso del sistema concedido',
    softPromptTitle: 'Activa las notificaciones del pedido en los ajustes de tu teléfono',
    softPromptDesc: 'Bloqueaste las notificaciones de Cesto. Ábrelas en los ajustes del sistema para volver a recibir avisos de tus pedidos.',
    openSettings: 'Abrir ajustes',
    typesTitle: 'Lo que recibirás',
    types: [
      { title: 'Pedido confirmado', desc: 'Te confirmamos la franja de entrega.' },
      { title: 'En preparación', desc: 'Estamos preparando tu pedido.' },
      { title: 'En camino', desc: 'Tu repartidor ha salido con tu pedido.' },
      { title: 'Entregado', desc: 'Tu pedido ha llegado.' },
      { title: 'Ofertas', desc: 'Avisos puntuales de descuentos.' },
    ],
    enabledToastTitle: 'Notificaciones activadas',
    enabledToastBody: 'Te avisaremos sobre el estado de tus pedidos.',
    disabledToastTitle: 'Notificaciones desactivadas',
    disabledToastBody: 'Puedes volver a activarlas cuando quieras.',
    privacyNote: 'No vendemos tus datos. Solo enviamos avisos relacionados con tu actividad en Cesto.',
  },
  en: {
    heading: 'Notifications',
    intro: "We'll let you know when your order is confirmed, being prepared, on its way and delivered. Only what matters.",
    sectionTitle: 'Push notifications',
    sectionDesc: 'Real-time alerts about your order status.',
    toggleEnabled: 'Enabled',
    toggleDisabled: 'Disabled',
    permissionGranted: 'System permission granted',
    softPromptTitle: 'Enable order notifications in your phone settings',
    softPromptDesc: "You blocked Cesto notifications. Open your system settings to receive order alerts again.",
    openSettings: 'Open settings',
    typesTitle: "What you'll receive",
    types: [
      { title: 'Order confirmed', desc: "We've confirmed your delivery slot." },
      { title: 'Being prepared', desc: 'Your order is being packed.' },
      { title: 'On the way', desc: 'Your rider has left with your order.' },
      { title: 'Delivered', desc: 'Your order has arrived.' },
      { title: 'Offers', desc: 'Occasional alerts about discounts.' },
    ],
    enabledToastTitle: 'Notifications enabled',
    enabledToastBody: "We'll keep you posted on your order status.",
    disabledToastTitle: 'Notifications disabled',
    disabledToastBody: 'You can turn them back on whenever you like.',
    privacyNote: "We don't sell your data. We only send alerts related to your Cesto activity.",
  },
} as const;

export default function NotificationsScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const t = COPY[lang];
  const toast = useToast();

  const [enabled, setEnabled] = useState(false);
  const [osPermission, setOsPermission] = useState<OSPermission>('undetermined');
  const [busy, setBusy] = useState(false);

  // Source of truth is the OS plus whether we hold a token, not the local
  // flag on its own: permission revoked in system settings has to show as off
  // here even though our flag still says on.
  const refresh = useCallback(async () => {
    const status = await getPushPermissionStatus();
    setOsPermission(status);
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    setEnabled(status === 'granted' && raw !== 'false');
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Re-read on focus so returning from system settings reflects the change.
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const toggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        const ok = await requestPermissionAndRegisterToken();
        const status = await getPushPermissionStatus();
        setOsPermission(status);
        if (!ok) {
          // Refused at the OS prompt, or the token/registration call failed.
          // Leave the switch off and let the denied banner explain the rest.
          setEnabled(false);
          await AsyncStorage.setItem(STORAGE_KEY, 'false');
          if (status === 'denied') toast.info(t.softPromptTitle, t.softPromptDesc);
          return;
        }
        setEnabled(true);
        await AsyncStorage.setItem(STORAGE_KEY, 'true');
        toast.success(t.enabledToastTitle, t.enabledToastBody);
      } else {
        // Drop the token rather than touching OS permission — an app cannot
        // revoke its own, and this is what actually stops the sends.
        await unregisterPushToken();
        setEnabled(false);
        await AsyncStorage.setItem(STORAGE_KEY, 'false');
        toast.info(t.disabledToastTitle, t.disabledToastBody);
      }
    } finally {
      setBusy(false);
    }
  };

  const openOsSettings = () => {
    if (Platform.OS === 'ios') Linking.openURL('app-settings:');
    else Linking.openSettings();
  };

  const showSoftPrompt = osPermission === 'denied';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          {t.heading}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={{ fontSize: 13, color: colors.gray, lineHeight: 18, marginBottom: 20 }}>
          {t.intro}
        </Text>

        {/* Primary toggle */}
        <View style={{
          backgroundColor: colors.surface.cream,
          borderRadius: 8,
          padding: 16,
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 14,
          borderWidth: 1,
          borderColor: 'rgba(226,232,240,0.7)',
        }}>
          <View style={{
            width: 48, height: 48, borderRadius: 12,
            backgroundColor: enabled ? colors.brand.mist : colors.surface.linen,
            justifyContent: 'center', alignItems: 'center',
          }}>
            {enabled
              ? <Bell size={22} color={colors.brand.DEFAULT} strokeWidth={1.75} />
              : <BellOff size={22} color={colors.muted} strokeWidth={1.75} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>
              {t.sectionTitle}
            </Text>
            <Text style={{ fontSize: 12, color: colors.gray, marginTop: 4, lineHeight: 16 }}>
              {t.sectionDesc}
            </Text>
            <Text style={{ fontSize: 10, fontWeight: '700', color: colors.muted, letterSpacing: 1, marginTop: 8 }}>
              {enabled ? t.toggleEnabled.toUpperCase() : t.toggleDisabled.toUpperCase()}
            </Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={toggle}
            disabled={busy}
            trackColor={{ false: colors.border, true: colors.brand.soft }}
            thumbColor={enabled ? colors.brand.DEFAULT : colors.muted}
          />
        </View>

        {osPermission === 'granted' && enabled && (
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            marginTop: 10, paddingHorizontal: 4,
          }}>
            <ShieldCheck size={14} color={colors.brand.DEFAULT} strokeWidth={1.75} />
            <Text style={{ fontSize: 12, fontWeight: '600', color: colors.brand.DEFAULT }}>
              {t.permissionGranted}
            </Text>
          </View>
        )}

        {/* Soft prompt — permission denied */}
        {showSoftPrompt && (
          <View style={{
            marginTop: 16, padding: 14, borderRadius: 14,
            backgroundColor: colors.amber.mist,
            borderWidth: 1, borderColor: colors.amber.mid,
            flexDirection: 'row', gap: 12,
          }}>
            <Settings size={20} color={colors.amber.deep} strokeWidth={1.75} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: colors.amber.deep }}>
                {t.softPromptTitle}
              </Text>
              <Text style={{ fontSize: 12, color: colors.charcoal, marginTop: 4, lineHeight: 16 }}>
                {t.softPromptDesc}
              </Text>
              <Pressable
                onPress={openOsSettings}
                style={{
                  marginTop: 10, alignSelf: 'flex-start',
                  paddingHorizontal: 14, height: 36, borderRadius: 10,
                  backgroundColor: colors.amber.deep,
                  justifyContent: 'center', alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>
                  {t.openSettings}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Types */}
        <View style={{
          marginTop: 20,
          backgroundColor: colors.surface.cream,
          borderRadius: 8, padding: 16,
          borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
        }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink, marginBottom: 12 }}>
            {t.typesTitle}
          </Text>
          {t.types.map((row, index) => (
            <View
              key={row.title}
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 10,
                paddingVertical: 8,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colors.border,
              }}
            >
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brand.DEFAULT, marginTop: 8 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }}>
                  {row.title}
                </Text>
                <Text style={{ fontSize: 12, color: colors.gray, marginTop: 2 }}>
                  {row.desc}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={{
          fontSize: 11, color: colors.muted,
          textAlign: 'center', marginTop: 20, lineHeight: 16, paddingHorizontal: 16,
        }}>
          {t.privacyNote}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
