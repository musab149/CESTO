import { Modal, View, Text, Pressable, Linking, ScrollView } from 'react-native';
import { ShieldOff } from 'lucide-react-native';
import { colors } from '../constants/colors';
import { useAuthStore } from '../stores/authStore';
import { useLanguageStore } from '../stores/languageStore';

const SUPPORT_EMAIL = 'support.cesto@gmail.com';

/**
 * Shown when the API refuses because this account has been blocked.
 *
 * Blocking someone used to be silent here: the access token stayed valid for
 * up to fifteen minutes, so the app carried on working and then began failing
 * with nothing to explain it. The API now rejects every authenticated call as
 * soon as the block lands, and this is what the customer sees.
 *
 * `onRequestClose` is deliberately a no-op beyond dismissing: Android's back
 * button should not make this vanish as though nothing happened. The session
 * is already over; acknowledging it is the way out.
 */
export default function BlockedAccountSheet() {
  const notice = useAuthStore((s) => s.blockedNotice);
  const setBlockedNotice = useAuthStore((s) => s.setBlockedNotice);
  const { lang } = useLanguageStore();
  const es = lang === 'es';

  if (notice === null) return null;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => {}} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', padding: 20 }}>
        <View style={{ backgroundColor: colors.surface.cream, borderRadius: 20, padding: 22, maxHeight: '85%' }}>
          <View style={{
            width: 48, height: 48, borderRadius: 14, backgroundColor: colors.dangerBg,
            alignItems: 'center', justifyContent: 'center', marginBottom: 16,
          }}>
            <ShieldOff size={24} color={colors.danger} strokeWidth={1.75} />
          </View>

          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink, marginBottom: 8 }}>
            {es ? 'Tu cuenta ha sido bloqueada' : 'Your account has been blocked'}
          </Text>

          <ScrollView style={{ flexGrow: 0 }}>
            <Text style={{ fontSize: 14, color: colors.gray, lineHeight: 21 }}>
              {es
                ? 'Hemos cerrado tu sesión. No podrás iniciar sesión ni hacer pedidos hasta que se resuelva.'
                : "We've signed you out. You won't be able to sign in or place orders until this is resolved."}
            </Text>

            {/* Blocked with no reason recorded is possible for accounts
                blocked before reasons existed, so this has to read sensibly
                without one. */}
            {notice.trim() !== '' && (
              <View style={{
                marginTop: 16, padding: 14, borderRadius: 12,
                backgroundColor: colors.dangerBg, borderWidth: 1, borderColor: 'rgba(220,38,38,0.2)',
              }}>
                <Text style={{
                  fontSize: 11, fontWeight: '700', color: colors.danger,
                  letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4,
                }}>
                  {es ? 'Motivo' : 'Reason'}
                </Text>
                <Text style={{ fontSize: 14, color: colors.ink, lineHeight: 20 }}>{notice}</Text>
              </View>
            )}

            <Text style={{ fontSize: 14, color: colors.gray, lineHeight: 21, marginTop: 16 }}>
              {es ? 'Si crees que es un error, escríbenos a ' : 'If you think this is a mistake, write to us at '}
              <Text
                onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
                style={{ color: colors.brand.DEFAULT, fontWeight: '600' }}
              >
                {SUPPORT_EMAIL}
              </Text>
              .
            </Text>
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
            <Pressable
              onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
              style={{
                flex: 1, height: 52, borderRadius: 12, borderWidth: 2, borderColor: colors.border,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
                {es ? 'Contactar' : 'Contact us'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setBlockedNotice(null)}
              style={{
                flex: 1, height: 52, borderRadius: 12, backgroundColor: colors.brand.DEFAULT,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>
                {es ? 'Entendido' : 'I understand'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
