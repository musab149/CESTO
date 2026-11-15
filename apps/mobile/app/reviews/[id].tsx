import { View, Text, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowDownUp, Check } from 'lucide-react-native';
import { useProduct } from '@grocery-app/shared';
import { colors } from '../../src/constants/colors';
import { useLanguageStore } from '../../src/stores/languageStore';
import { useReviewsFor, type Review } from '../../src/lib/reviews';
import StarRow from '../../src/components/StarRow';
import ReviewRow from '../../src/components/ReviewRow';

type SortKey = 'recent' | 'highest' | 'lowest';

export default function AllReviewsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { lang } = useLanguageStore();

  const { data: product, isLoading } = useProduct(id);
  const { reviews: fetched, stats: apiStats } = useReviewsFor(product?.id);
  const [sort, setSort] = useState<SortKey>('recent');

  // Sorting stays client-side over the fetched page: the API returns newest
  // first, and re-fetching to reorder a list this size would be slower than
  // sorting it here.
  const reviews = useMemo<Review[]>(() => {
    const merged = fetched.slice();
    if (sort === 'highest') return merged.sort((a, b) => b.rating - a.rating || b.createdAt.localeCompare(a.createdAt));
    if (sort === 'lowest')  return merged.sort((a, b) => a.rating - b.rating || b.createdAt.localeCompare(a.createdAt));
    return merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [fetched, sort]);

  // Server-computed, not derived from the loaded page: the summary must cover
  // every visible review, not just the ones fetched so far.
  const stats = apiStats;

  // Sentiment chip — small, calm. Emoji + label + a tinted dot. The card
  // itself stays white so the summary reads as data, not a billboard.
  const tier = useMemo(() => {
    const r = stats.rating;
    if (stats.count === 0) return {
      emoji: '✨',
      label_en: 'No reviews yet', label_es: 'Aún sin reseñas',
      tint: colors.muted, bg: colors.surface.linen, barFill: colors.muted,
    };
    if (r >= 4.5) return {
      emoji: '🤩',
      label_en: 'Loved by shoppers', label_es: 'Encantados',
      tint: '#15803D', bg: '#DCFCE7', barFill: '#22C55E',
    };
    if (r >= 4.0) return {
      emoji: '😊',
      label_en: 'Customers approve', label_es: 'Les gusta',
      tint: colors.brand.deepest, bg: colors.brand.mist, barFill: colors.brand.DEFAULT,
    };
    if (r >= 3.0) return {
      emoji: '🙂',
      label_en: 'Mixed reactions', label_es: 'Opiniones mixtas',
      tint: '#92400E', bg: '#FEF3C7', barFill: '#F59E0B',
    };
    if (r >= 2.0) return {
      emoji: '😕',
      label_en: 'Falls short', label_es: 'Decepciona',
      tint: '#9A3412', bg: '#FFEDD5', barFill: '#EA580C',
    };
    return {
      emoji: '😞',
      label_en: 'Disappointing', label_es: 'Decepcionante',
      tint: '#991B1B', bg: colors.dangerBg, barFill: colors.danger,
    };
  }, [stats.rating, stats.count]);

  const productName = product ? (lang === 'es' ? product.name_es : product.name_en) : '';

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'recent',  label: lang === 'en' ? 'Most recent'   : 'Más recientes' },
    { key: 'highest', label: lang === 'en' ? 'Highest rated' : 'Mejor valoradas' },
    { key: 'lowest',  label: lang === 'en' ? 'Lowest rated'  : 'Peor valoradas' },
  ];

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.brand.DEFAULT} />
      </SafeAreaView>
    );
  }

  if (!product) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <Text style={{ fontSize: 16, color: colors.muted }}>
          {lang === 'en' ? 'Product not found' : 'Producto no encontrado'}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: 12, paddingVertical: 10,
        backgroundColor: '#fff',
        borderBottomWidth: 1, borderBottomColor: 'rgba(226,232,240,0.7)',
      }}>
        <Pressable
          onPress={() => router.back()}
          style={{ width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' }}
        >
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }} numberOfLines={1}>
            {lang === 'en' ? 'All reviews' : 'Todas las reseñas'}
          </Text>
          <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 1 }} numberOfLines={1}>
            {productName}
          </Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {/* Summary — clean white card. Color is reserved for the small
            sentiment chip + the distribution bar fills, not the whole card. */}
        <View style={{
          backgroundColor: '#fff',
          borderRadius: 14,
          borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
          padding: 16,
        }}>
          {/* Sentiment chip — small, tinted by tier */}
          <View style={{
            alignSelf: 'flex-start',
            flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingLeft: 8, paddingRight: 10, paddingVertical: 5,
            borderRadius: 999,
            backgroundColor: tier.bg,
          }}>
            <Text style={{ fontSize: 13, lineHeight: 16 }}>{tier.emoji}</Text>
            <Text style={{ fontSize: 11, fontWeight: '800', color: tier.tint, letterSpacing: 0.4, textTransform: 'uppercase' }}>
              {lang === 'en' ? tier.label_en : tier.label_es}
            </Text>
          </View>

          <View style={{ marginTop: 14, flexDirection: 'row', gap: 18, alignItems: 'flex-start' }}>
            {/* Left: score + stars + count */}
            <View style={{ minWidth: 92 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
                <Text style={{ fontSize: 44, fontWeight: '800', color: colors.ink, letterSpacing: -1.5, lineHeight: 48 }}>
                  {stats.count > 0 ? stats.rating.toFixed(1) : '—'}
                </Text>
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.muted }}>/5</Text>
              </View>
              <View style={{ marginTop: 4 }}>
                <StarRow rating={stats.count > 0 ? stats.rating : 0} size={15} />
              </View>
              <Text style={{ fontSize: 12, color: colors.gray, marginTop: 6 }}>
                {stats.count} {lang === 'en'
                  ? (stats.count === 1 ? 'review' : 'reviews')
                  : (stats.count === 1 ? 'reseña' : 'reseñas')}
              </Text>
            </View>

            {/* Right: distribution */}
            {stats.count > 0 ? (
              <View style={{ flex: 1, gap: 5, paddingTop: 4 }}>
                {[5, 4, 3, 2, 1].map((stars) => {
                  const value = stats.dist[stars - 1] ?? 0;
                  const pct = Math.round((value / stats.count) * 100);
                  return (
                    <View key={stars} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ width: 10, textAlign: 'right', fontSize: 11, fontWeight: '700', color: colors.gray, fontVariant: ['tabular-nums'] }}>
                        {stars}
                      </Text>
                      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surface.linen, overflow: 'hidden' }}>
                        <View style={{ width: `${pct}%`, height: '100%', borderRadius: 3, backgroundColor: tier.barFill }} />
                      </View>
                      <Text style={{ width: 26, textAlign: 'right', fontSize: 10.5, fontWeight: '700', color: colors.muted, fontVariant: ['tabular-nums'] }}>
                        {value}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={{ flex: 1, paddingTop: 8 }}>
                <Text style={{ fontSize: 12.5, color: colors.muted, lineHeight: 17 }}>
                  {lang === 'en'
                    ? 'No ratings to summarize yet. Be the first to share what you think.'
                    : 'Aún no hay valoraciones. Sé el primero en opinar.'}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Sort chips */}
        <View style={{
          marginTop: 14,
          flexDirection: 'row', alignItems: 'center', gap: 8,
        }}>
          <ArrowDownUp size={13} color={colors.muted} strokeWidth={2} />
          <Text style={{ fontSize: 10.5, fontWeight: '800', color: colors.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
            {lang === 'en' ? 'Sort by' : 'Ordenar por'}
          </Text>
        </View>
        <View style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {sortOptions.map((opt) => {
            const active = opt.key === sort;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setSort(opt.key)}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  paddingHorizontal: 14, paddingVertical: 9,
                  borderRadius: 999,
                  borderWidth: 1.5,
                  borderColor: active ? colors.brand.DEFAULT : 'rgba(226,232,240,0.7)',
                  backgroundColor: active
                    ? colors.brand.mist
                    : pressed
                      ? colors.surface.linen
                      : '#fff',
                })}
              >
                {active && <Check size={12} color={colors.brand.deepest} strokeWidth={2.5} />}
                <Text style={{
                  fontSize: 12.5,
                  fontWeight: '700',
                  color: active ? colors.brand.deepest : colors.ink,
                }}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Reviews — single container card, hairline dividers */}
        {reviews.length === 0 ? (
          <View style={{
            marginTop: 16,
            padding: 24,
            backgroundColor: '#fff',
            borderRadius: 14,
            borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
            alignItems: 'center',
          }}>
            <Text style={{ fontSize: 28, marginBottom: 8 }}>✍️</Text>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>
              {lang === 'en' ? 'No reviews yet' : 'Aún no hay reseñas'}
            </Text>
          </View>
        ) : (
          <View style={{
            marginTop: 16,
            backgroundColor: '#fff',
            borderRadius: 14,
            borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
            overflow: 'hidden',
          }}>
            {reviews.map((r, idx) => (
              <View key={r.id}>
                {idx > 0 && (
                  <View style={{ height: 1, marginHorizontal: 16, backgroundColor: 'rgba(226,232,240,0.7)' }} />
                )}
                <ReviewRow
                  review={r}
                  onEdit={() => router.push({ pathname: `/product/${product.id}` as never })}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
