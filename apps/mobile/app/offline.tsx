import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { WifiOff, RefreshCw, Home } from 'lucide-react-native';
import NetInfo from '@react-native-community/netinfo';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';

export default function OfflineScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();

  const t = lang === 'es'
    ? {
        badge: 'SIN CONEXIÓN',
        title: 'Sin conexión a internet',
        body: 'No pudimos conectar con nuestros servidores. Comprueba tu Wi-Fi o datos móviles e inténtalo de nuevo.',
        retry: 'Reintentar',
        home: 'Ir al inicio',
      }
    : {
        badge: 'OFFLINE',
        title: 'No internet connection',
        body: "We couldn't reach our servers. Check your Wi-Fi or mobile data and try again.",
        retry: 'Try again',
        home: 'Go home',
      };

  const handleRetry = async () => {
    const state = await NetInfo.fetch();
    if (state.isConnected) {
      if (router.canGoBack()) router.back();
      else router.replace('/');
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View
            style={{
              width: 80, height: 80, borderRadius: 24,
              backgroundColor: colors.amber.mist,
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 20,
            }}
          >
            <WifiOff size={32} color={colors.amber.deep} strokeWidth={1.75} />
          </View>

          <View
            style={{
              backgroundColor: colors.amber.deep,
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
          <Text style={{ fontSize: 14, lineHeight: 20, color: colors.gray, textAlign: 'center', maxWidth: 320, marginBottom: 28 }}>
            {t.body}
          </Text>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable
              onPress={handleRetry}
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
