import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, usePathname, Stack } from 'expo-router';
import { Compass, Home, ArrowLeft } from 'lucide-react-native';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';

export default function NotFoundScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const { lang } = useLanguageStore();

  const t = lang === 'es'
    ? {
        badge: 'ERROR 404',
        title: 'Esta pantalla no existe',
        body: 'No encontramos lo que buscabas. Es posible que el enlace esté roto o que la pantalla ya no exista.',
        path: 'Ruta',
        back: 'Volver',
        home: 'Ir al inicio',
      }
    : {
        badge: 'ERROR 404',
        title: "This screen doesn't exist",
        body: "We couldn't find what you were looking for. The link may be broken, or the screen may no longer exist.",
        path: 'Path',
        back: 'Back',
        home: 'Go home',
      };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 }}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}
          >
            <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
          </Pressable>
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View
            style={{
              width: 80, height: 80, borderRadius: 24,
              backgroundColor: colors.brand.mist,
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 20,
            }}
          >
            <Compass size={32} color={colors.brand.deepest} strokeWidth={1.75} />
          </View>

          <View
            style={{
              backgroundColor: colors.brand.DEFAULT,
              paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999,
              marginBottom: 14,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 10.5, fontWeight: '800', letterSpacing: 1.5 }}>
              {t.badge}
            </Text>
          </View>

          <Text style={{ fontSize: 24, fontWeight: '800', color: colors.ink, textAlign: 'center', marginBottom: 10 }}>
            {t.title}
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 20, color: colors.gray, textAlign: 'center', maxWidth: 320, marginBottom: 20 }}>
            {t.body}
          </Text>

          {pathname && pathname !== '/+not-found' && (
            <View
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                backgroundColor: colors.surface.cream,
                borderWidth: 1, borderColor: colors.border,
                paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
                marginBottom: 28, maxWidth: '100%',
              }}
            >
              <Text style={{ fontSize: 10, fontWeight: '700', color: colors.gray, letterSpacing: 1.2 }}>
                {t.path.toUpperCase()}
              </Text>
              <Text style={{ fontSize: 12, color: colors.ink, fontFamily: 'monospace' }} numberOfLines={1}>
                {pathname}
              </Text>
            </View>
          )}

          <Pressable
            onPress={() => router.replace('/')}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 8,
              height: 52, paddingHorizontal: 24, borderRadius: 12,
              backgroundColor: colors.brand.DEFAULT,
            }}
          >
            <Home size={16} color="#fff" strokeWidth={1.75} />
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{t.home}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </>
  );
}
