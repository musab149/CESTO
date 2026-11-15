import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { AlertOctagon, RefreshCw, Home } from 'lucide-react-native';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';

export default function ServerErrorScreen() {
  const router = useRouter();
  const { ref } = useLocalSearchParams<{ ref?: string }>();
  const { lang } = useLanguageStore();

  const t = lang === 'es'
    ? {
        badge: 'ERROR 500',
        title: 'Algo se rompió de nuestro lado',
        body: 'Hubo un problema cargando los datos. Nuestro equipo ya lo está revisando. Mientras tanto, intenta de nuevo o vuelve al inicio.',
        refLabel: 'Referencia',
        retry: 'Reintentar',
        home: 'Ir al inicio',
      }
    : {
        badge: 'ERROR 500',
        title: 'Something broke on our end',
        body: 'There was a problem loading data. Our team is already looking into it. In the meantime, try again or head back home.',
        refLabel: 'Reference',
        retry: 'Try again',
        home: 'Go home',
      };

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View
            style={{
              width: 80, height: 80, borderRadius: 24,
              backgroundColor: colors.dangerBg,
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 20,
            }}
          >
            <AlertOctagon size={32} color={colors.danger} strokeWidth={1.75} />
          </View>

          <View
            style={{
              backgroundColor: colors.danger,
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
          <Text style={{ fontSize: 14, lineHeight: 20, color: colors.gray, textAlign: 'center', maxWidth: 320, marginBottom: 16 }}>
            {t.body}
          </Text>

          {ref && (
            <View
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                backgroundColor: colors.surface.cream,
                borderWidth: 1, borderColor: colors.border,
                paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
                marginBottom: 28,
              }}
            >
              <Text style={{ fontSize: 10, fontWeight: '700', color: colors.gray, letterSpacing: 1.2 }}>
                {t.refLabel.toUpperCase()}
              </Text>
              <Text style={{ fontSize: 12, color: colors.ink, fontFamily: 'monospace' }}>{ref}</Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 12, marginTop: ref ? 0 : 12 }}>
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                height: 52, paddingHorizontal: 20, borderRadius: 12,
                backgroundColor: colors.brand.DEFAULT,
              }}
            >
              <RefreshCw size={16} color="#fff" strokeWidth={1.75} />
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{t.retry}</Text>
            </Pressable>
            <Pressable
              onPress={() => router.replace('/')}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                height: 52, paddingHorizontal: 20, borderRadius: 12,
                borderWidth: 2, borderColor: colors.border,
              }}
            >
              <Home size={16} color={colors.ink} strokeWidth={1.75} />
              <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '700' }}>{t.home}</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </>
  );
}
