import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, type LucideIcon } from 'lucide-react-native';
import { colors } from '../constants/colors';
import { useLanguageStore } from '../stores/languageStore';

type Accent = 'brand' | 'leaf';

interface Props {
  icon: LucideIcon;
  title: { en: string; es: string };
  subtitle: { en: string; es: string };
  /** Which of the two brand tones to paint the badge with. */
  accent?: Accent;
}

/**
 * Placeholder for a surface that is announced but not built yet — web has the
 * same component behind /bio. Kept as a shared component rather than a route so
 * a new "coming soon" screen is a five-line file, and so the copy always lives
 * with the route that promises it.
 */
export default function ComingSoon({ icon: Icon, title, subtitle, accent = 'brand' }: Props) {
  const router = useRouter();
  const { lang } = useLanguageStore();

  const tone = accent === 'leaf'
    ? { bg: colors.amber.mist, fg: colors.amber.deep }
    : { bg: colors.brand.mist, fg: colors.brand.deepest };

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
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: tone.bg, justifyContent: 'center', alignItems: 'center', marginBottom: 22 }}>
          <Icon size={38} color={tone.fg} strokeWidth={1.5} />
        </View>

        <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: colors.muted, textTransform: 'uppercase', marginBottom: 8 }}>
          {lang === 'es' ? 'Próximamente' : 'Coming soon'}
        </Text>

        <Text style={{ fontSize: 24, fontWeight: '800', color: colors.ink, textAlign: 'center', letterSpacing: -0.4, marginBottom: 10 }}>
          {lang === 'es' ? title.es : title.en}
        </Text>

        <Text style={{ fontSize: 14, color: colors.gray, textAlign: 'center', lineHeight: 21 }}>
          {lang === 'es' ? subtitle.es : subtitle.en}
        </Text>

        <Pressable
          onPress={() => router.replace('/')}
          style={{ marginTop: 28, height: 52, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 34 }}
        >
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
            {lang === 'es' ? 'Seguir comprando' : 'Keep shopping'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
