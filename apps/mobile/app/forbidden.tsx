/**
 * 403. Web routes the same state at /403; mobile had nothing, so a forbidden
 * response fell through to the generic server-error screen, which tells the
 * customer to try again — exactly the wrong advice when the answer is "this
 * isn't yours to open".
 */
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ShieldOff, ArrowLeft } from 'lucide-react-native';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';
import { useAuthStore } from '../src/stores/authStore';

export default function ForbiddenScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
        <Pressable
          onPress={() => router.back()}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}
        >
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
      </View>

      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, paddingBottom: 60 }}>
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.dangerBg, justifyContent: 'center', alignItems: 'center', marginBottom: 22 }}>
          <ShieldOff size={38} color={colors.danger} strokeWidth={1.5} />
        </View>

        <Text style={{ fontSize: 22, fontWeight: '800', color: colors.ink, textAlign: 'center', letterSpacing: -0.3, marginBottom: 10 }}>
          {lang === 'es' ? 'No tienes acceso' : "You don't have access"}
        </Text>

        <Text style={{ fontSize: 14, color: colors.gray, textAlign: 'center', lineHeight: 21 }}>
          {isAuthenticated
            ? (lang === 'es'
              ? 'Esta página no está disponible con tu cuenta. Si crees que es un error, escríbenos.'
              : "This page isn't available on your account. If you think that's wrong, get in touch.")
            : (lang === 'es'
              ? 'Inicia sesión para continuar. Puede que esta página necesite tu cuenta.'
              : 'Log in to continue — this page may need your account.')}
        </Text>

        <Pressable
          onPress={() => (isAuthenticated ? router.push('/contact') : router.push('/(auth)/login'))}
          style={{ marginTop: 26, height: 52, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 34 }}
        >
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
            {isAuthenticated
              ? (lang === 'es' ? 'Contactar con soporte' : 'Contact support')
              : (lang === 'es' ? 'Iniciar sesión' : 'Log in')}
          </Text>
        </Pressable>

        <Pressable onPress={() => router.replace('/')} style={{ marginTop: 12, paddingVertical: 10 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.gray }}>
            {lang === 'es' ? 'Volver al inicio' : 'Back to home'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
