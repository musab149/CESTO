import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Heart, Globe, Truck, ShieldCheck, Star, ExternalLink } from 'lucide-react-native';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';
import { useAppContent } from '@grocery-app/shared';

const APP_VERSION = '1.0.0';
const BUILD_NUMBER = '2026.04.01';

interface Feature {
  icon: typeof Heart;
  title_en: string;
  title_es: string;
  description_en: string;
  description_es: string;
}

const features: Feature[] = [
  {
    icon: Globe,
    title_en: 'Authentic Products',
    title_es: 'Productos Auténticos',
    description_en: 'Curated selection of South Asian groceries sourced directly from trusted suppliers.',
    description_es: 'Selección curada de productos asiáticos obtenidos directamente de proveedores de confianza.',
  },
  {
    icon: Truck,
    title_en: 'Fast Delivery',
    title_es: 'Entrega Rápida',
    description_en: 'Same-day delivery across Madrid. Choose your preferred 2-hour delivery window.',
    description_es: 'Entrega en el mismo día en todo Madrid. Elige tu ventana de entrega de 2 horas.',
  },
  {
    icon: ShieldCheck,
    title_en: 'Quality Guaranteed',
    title_es: 'Calidad Garantizada',
    description_en: 'Every product is checked for freshness and quality before it reaches your door.',
    description_es: 'Cada producto se revisa en cuanto a frescura y calidad antes de llegar a tu puerta.',
  },
  {
    icon: Heart,
    title_en: 'Community First',
    title_es: 'Comunidad Primero',
    description_en: 'Built by and for the South Asian community in Spain. Your feedback shapes our products.',
    description_es: 'Creado por y para la comunidad del sur de Asia en España. Tu opinión moldea nuestros productos.',
  },
];

export default function AboutScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const { data: content } = useAppContent();

  // Admin -> App content wins; the bundled copy below is the offline fallback.
  // Icons are not editable, so an edited list reuses them in order — the fifth
  // value drawn would repeat the first icon rather than crash on undefined.
  const mission = content
    ? (lang === 'es' ? content.about.mission_es : content.about.mission_en)
    : null;
  const items: Feature[] = content?.about.values?.length
    ? content.about.values.map((v, i) => ({
      icon: features[i % features.length].icon,
      title_en: v.title_en,
      title_es: v.title_es,
      description_en: v.body_en,
      description_es: v.body_es,
    }))
    : features;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          {lang === 'es' ? 'Sobre Cesto' : 'About Cesto'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* App Logo & Version */}
        <View style={{ alignItems: 'center', paddingVertical: 32 }}>
          <View style={{
            width: 88, height: 88, borderRadius: 22,
            backgroundColor: colors.brand.DEFAULT,
            justifyContent: 'center', alignItems: 'center',
            shadowColor: colors.brand.DEFAULT, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
            marginBottom: 16,
          }}>
            <Text style={{ fontSize: 36, fontWeight: '800', color: '#fff' }}>C</Text>
          </View>
          <Text style={{ fontSize: 26, fontWeight: '800', color: colors.ink, marginBottom: 4 }}>
            Cesto
          </Text>
          <Text style={{ fontSize: 14, color: colors.gray, marginBottom: 2 }}>
            {lang === 'es' ? 'Tu tienda de comestibles' : 'Your grocery store'}
          </Text>
          <Text style={{ fontFamily: 'JetBrains Mono', fontSize: 12, color: colors.muted }}>
            v{APP_VERSION} ({BUILD_NUMBER})
          </Text>
        </View>

        {/* Mission statement */}
        <View style={{ marginHorizontal: 16, marginBottom: 24 }}>
          <View style={{
            backgroundColor: colors.brand.whisper, borderRadius: 8, padding: 20,
            borderWidth: 1, borderColor: colors.brand.mist,
          }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.brand.DEFAULT, marginBottom: 8, textAlign: 'center' }}>
              {lang === 'es' ? 'Nuestra Misión' : 'Our Mission'}
            </Text>
            <Text style={{ fontSize: 14, color: colors.ink, lineHeight: 22, textAlign: 'center' }}>
              {mission ?? (lang === 'es'
                ? 'Llevar los sabores auténticos del sur de Asia a tu puerta en España. Conectamos a nuestra comunidad con los productos que aman, entregados con cuidado y rapidez.'
                : 'Bringing authentic South Asian flavors to your doorstep in Spain. We connect our community with the products they love, delivered with care and speed.')}
            </Text>
          </View>
        </View>

        {/* Features */}
        <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 12 }}>
            {lang === 'es' ? 'Por qué Cesto' : 'Why Cesto'}
          </Text>

          {items.map((feature) => {
            const Icon = feature.icon;
            return (
              <View
                key={feature.title_en}
                style={{
                  flexDirection: 'row', gap: 14,
                  backgroundColor: colors.surface.cream, borderRadius: 12, padding: 16, marginBottom: 10,
                  borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
                }}
              >
                <View style={{
                  width: 44, height: 44, borderRadius: 12,
                  backgroundColor: colors.brand.mist,
                  justifyContent: 'center', alignItems: 'center',
                }}>
                  <Icon size={22} color={colors.brand.DEFAULT} strokeWidth={1.75} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 4 }}>
                    {lang === 'es' ? feature.title_es : feature.title_en}
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.gray, lineHeight: 18 }}>
                    {lang === 'es' ? feature.description_es : feature.description_en}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* Rate & Social */}
        <View style={{ paddingHorizontal: 16, marginBottom: 24 }}>
          <View style={{
            backgroundColor: colors.surface.cream, borderRadius: 12, overflow: 'hidden',
            borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
          }}>
            <Pressable
              onPress={() => {}}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16,
                borderBottomWidth: 1, borderBottomColor: colors.border,
                backgroundColor: pressed ? colors.surface.linen : 'transparent',
              })}
            >
              <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colors.amber.mist, justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                <Star size={20} color={colors.amber.DEFAULT} strokeWidth={1.75} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>
                  {lang === 'es' ? 'Valora la App' : 'Rate the App'}
                </Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                  {lang === 'es' ? 'Ayúdanos con tu valoración' : 'Help us with your rating'}
                </Text>
              </View>
              <ExternalLink size={18} color={colors.muted} strokeWidth={1.75} />
            </Pressable>

            <Pressable
              onPress={() => Linking.openURL('https://www.cestoshop.com')}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16,
                backgroundColor: pressed ? colors.surface.linen : 'transparent',
              })}
            >
              <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colors.brand.mist, justifyContent: 'center', alignItems: 'center', marginRight: 14 }}>
                <Globe size={20} color={colors.brand.DEFAULT} strokeWidth={1.75} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>
                  {lang === 'es' ? 'Visitar Web' : 'Visit Website'}
                </Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                  cestoshop.com
                </Text>
              </View>
              <ExternalLink size={18} color={colors.muted} strokeWidth={1.75} />
            </Pressable>
          </View>
        </View>

        {/* Footer */}
        <View style={{ alignItems: 'center', paddingVertical: 16 }}>
          <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>
            {lang === 'es' ? 'Hecho con' : 'Made with'} {'\u2764\uFE0F'} {lang === 'es' ? 'en Madrid' : 'in Madrid'}
          </Text>
          <Text style={{ fontSize: 11, color: colors.muted }}>
            © 2026 Cesto. {lang === 'es' ? 'Todos los derechos reservados.' : 'All rights reserved.'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
