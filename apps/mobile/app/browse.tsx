/**
 * Filtered product browser — mirrors web's /categories?brand=X | ?origin=X |
 * ?sponsored=1 view. Reached from the categories tab's Top Brands and the
 * Shop-by-Origin grid. Web treats these as filtered slices of the catalog;
 * mobile gets a dedicated screen so the tab stays a clean nav hub.
 */
import {
  View, Text, Pressable, FlatList, ActivityIndicator,
  RefreshControl, Image,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ChevronDown, SlidersHorizontal, PackageSearch } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  useInfiniteProducts, useShopByOrigin, useTopBrands, defaultTopBrands, resolveImageUrl,
} from '@grocery-app/shared';
import type { Product, OriginCard, TopBrand } from '@grocery-app/shared';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';
import ProductCard from '../src/components/ProductCard';

type SortKey = 'relevance' | 'price_asc' | 'price_desc' | 'name_asc';

function withAlpha(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (full.length !== 6) return hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export default function BrowseScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const params = useLocalSearchParams<{ brand?: string; origin?: string; sponsored?: string }>();

  const brand = typeof params.brand === 'string' ? params.brand : undefined;
  const origin = typeof params.origin === 'string' ? params.origin : undefined;
  const sponsored = params.sponsored === '1';

  const [sort, setSort] = useState<SortKey>('relevance');
  const [sortOpen, setSortOpen] = useState(false);

  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.refetchQueries({ type: 'active' });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  // Paged — a flat `limit: 60` stopped exactly at the API's page cap, so a
  // brand or origin with more than 60 products simply ended there with no way
  // to reach the rest. See the note in category/[id].tsx.
  const {
    data: productPages, isLoading,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteProducts({
    brand,
    origin,
    sponsored: sponsored ? '1' : undefined,
    limit: 30,
  });
  const all: Product[] = useMemo(
    () => (productPages?.pages ?? []).flatMap((page) => page.items ?? []),
    [productPages],
  );

  // Client-side sort — server only knows `name_asc`, so the rest is local.
  // Sorts the pages loaded so far, not the whole result set.
  const products = useMemo(() => {
    const nameOf = (p: Product) => (lang === 'en' ? p.name_en : p.name_es);
    const priceOf = (p: Product) => p.variants?.[0]?.price ?? 0;
    if (sort === 'price_asc') return [...all].sort((a, b) => priceOf(a) - priceOf(b));
    if (sort === 'price_desc') return [...all].sort((a, b) => priceOf(b) - priceOf(a));
    if (sort === 'name_asc') return [...all].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    return all;
  }, [all, sort, lang]);

  const { data: originConfig } = useShopByOrigin();
  const { data: brandsData } = useTopBrands();
  const originCards = originConfig?.cards ?? [];
  const originCard: OriginCard | undefined = origin
    ? originCards.find((c) => c.key.toLowerCase() === origin.toLowerCase())
    : undefined;
  const brandObj: TopBrand | undefined = brand
    ? (brandsData ?? defaultTopBrands).brands.find(
        (b) => b.is_active && b.name.toLowerCase() === brand.toLowerCase(),
      )
    : undefined;

  const originLabel = origin
    ? (originCard ? (lang === 'en' ? originCard.label_en : originCard.label_es) : origin)
    : null;

  const title = brand
    ? brand
    : originLabel
      ? originLabel
      : sponsored
        ? (lang === 'en' ? 'Sponsored picks' : 'Patrocinados')
        : (lang === 'en' ? 'All products' : 'Todos los productos');

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'relevance',  label: lang === 'en' ? 'Relevance' : 'Relevancia' },
    { key: 'price_asc',  label: lang === 'en' ? 'Price · low to high' : 'Precio · de menor a mayor' },
    { key: 'price_desc', label: lang === 'en' ? 'Price · high to low' : 'Precio · de mayor a menor' },
    { key: 'name_asc',   label: lang === 'en' ? 'Name · A to Z' : 'Nombre · A a Z' },
  ];
  const activeSortLabel = sortOptions.find((o) => o.key === sort)?.label ?? '';

  // ── Hero copy ──────────────────────────────────────────────
  // Each filter type gets its own short framing so the page feels purposeful
  // rather than generic.
  const heroEyebrow = brand
    ? (lang === 'en' ? 'Brand' : 'Marca')
    : origin
      ? (lang === 'en' ? `From ${originLabel}` : `De ${originLabel}`)
      : (lang === 'en' ? 'Sponsored' : 'Patrocinado');

  const heroSubtitle = brand
    ? (lang === 'en' ? `Every product we stock from ${brand}` : `Todos los productos de ${brand}`)
    : origin
      ? (lang === 'en' ? 'Pantry staples from this region' : 'Productos de esta región')
      : (lang === 'en' ? 'Featured deals chosen by Cesto' : 'Ofertas destacadas por Cesto');

  // Brand bg_color is usually near-white (it's designed to sit behind a logo
  // chip), so don't reuse it as the hero background — the page ends up bland.
  // Brand pages instead use our brand-whisper tint and put the actual brand
  // logo on the right anchor where it can pop.
  const heroBg = origin && originCard
    ? originCard.bg_color
    : brand
      ? colors.brand.whisper
      : sponsored
        ? colors.brand.mist
        : colors.surface.cream;
  const heroAccent = origin && originCard ? originCard.accent_color : colors.brand.DEFAULT;
  const originImage = originCard?.image_url ? resolveImageUrl(originCard.image_url, 'tile') : null;
  const brandLogo = brandObj?.image_url ? resolveImageUrl(brandObj.image_url, 'logo') : null;
  const brandTileBg = brandObj?.bg_color || '#FFFFFF';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      {/* ── App bar ──────────────────────────────────────────── */}
      <View style={{
        height: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
        backgroundColor: colors.surface.white, borderBottomWidth: 1, borderBottomColor: colors.border,
        gap: 10,
      }}>
        <Pressable
          onPress={() => router.back()}
          style={{
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: colors.surface.cream,
            justifyContent: 'center', alignItems: 'center',
          }}
        >
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text
          style={{
            flex: 1, fontSize: 17, fontWeight: '700', color: colors.ink,
            letterSpacing: -0.3,
          }}
          numberOfLines={1}
        >
          {title}
        </Text>
        {/* Sort pill — now anchored to the appbar where the count used to sit. */}
        <Pressable
          onPress={() => setSortOpen((v) => !v)}
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: 6,
            height: 36, paddingHorizontal: 12, borderRadius: 999,
            borderWidth: 1, borderColor: sortOpen ? colors.ink : colors.border,
            backgroundColor: pressed ? colors.surface.linen : '#fff',
          })}
        >
          <SlidersHorizontal size={13} color={colors.ink} strokeWidth={2} />
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink }} numberOfLines={1}>
            {activeSortLabel}
          </Text>
          <ChevronDown
            size={12} color={colors.muted} strokeWidth={2}
            style={{ transform: [{ rotate: sortOpen ? '180deg' : '0deg' }] }}
          />
        </Pressable>
      </View>

      {/* ── Sort dropdown — floats below the appbar, anchored right ─── */}
      {sortOpen && (
        <>
          <Pressable
            onPress={() => setSortOpen(false)}
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              zIndex: 5,
            }}
          />
          <View style={{
            position: 'absolute', top: 60 + 4, right: 16,
            minWidth: 220, borderRadius: 14,
            borderWidth: 1, borderColor: 'rgba(226,232,240,0.85)',
            backgroundColor: '#fff', overflow: 'hidden',
            zIndex: 10,
            shadowColor: '#0F172A', shadowOpacity: 0.1,
            shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
            elevation: 8,
          }}>
            {sortOptions.map((opt) => {
              const active = opt.key === sort;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => { setSort(opt.key); setSortOpen(false); }}
                  style={({ pressed }) => ({
                    paddingVertical: 12, paddingHorizontal: 14,
                    backgroundColor: pressed
                      ? colors.surface.linen
                      : active ? colors.brand.mist : '#fff',
                    flexDirection: 'row',
                    justifyContent: 'space-between', alignItems: 'center',
                  })}
                >
                  <Text style={{
                    fontSize: 13, fontWeight: active ? '700' : '500',
                    color: active ? colors.brand.deepest : colors.ink,
                  }}>
                    {opt.label}
                  </Text>
                  {active && (
                    <View style={{
                      width: 6, height: 6, borderRadius: 3,
                      backgroundColor: colors.brand.deepest,
                    }} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {/* ── Hero strip ───────────────────────────────────────────
          Tinted with the origin's bg_color so each filtered page gets its
          own visual identity. Carries the product count as a satisfying
          stat pill (where the bare number used to live in the appbar). */}
      <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
        <View style={{
          position: 'relative', overflow: 'hidden',
          borderRadius: 20,
          backgroundColor: heroBg,
          paddingHorizontal: 18, paddingVertical: 18,
          minHeight: 96,
          flexDirection: 'row', alignItems: 'center', gap: 12,
        }}>
          {/* Decorative wash anchored bottom-right — picks up the accent. */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', right: -40, bottom: -40,
              width: 160, height: 160, borderRadius: 80,
              backgroundColor: withAlpha(heroAccent, 0.18),
            }}
          />

          <View style={{ flex: 1, position: 'relative' }}>
            <Text style={{
              fontSize: 10, letterSpacing: 1.5,
              color: withAlpha(colors.ink, 0.55),
              fontWeight: '700', textTransform: 'uppercase',
            }}>
              {heroEyebrow}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
              <Text style={{
                fontSize: 24, fontWeight: '800', color: colors.ink,
                letterSpacing: -0.5,
              }}>
                {isLoading ? '—' : products.length}
              </Text>
              <Text style={{
                fontSize: 13, fontWeight: '600',
                color: withAlpha(colors.ink, 0.62),
              }}>
                {lang === 'en'
                  ? (products.length === 1 ? 'product' : 'products')
                  : (products.length === 1 ? 'producto' : 'productos')}
              </Text>
            </View>
            <Text style={{
              fontSize: 12.5, color: withAlpha(colors.ink, 0.6),
              marginTop: 4, fontWeight: '500',
            }} numberOfLines={2}>
              {heroSubtitle}
            </Text>
          </View>

          {/* Visual anchor on the right. Origins use their admin-uploaded
              cover photo or a chunky monogram; brand pages get a clean
              logo plaque sitting on the brand's own bg_color so the logo
              reads even when the hero behind it is brand-whisper. */}
          {origin && originImage ? (
            <View style={{
              width: 64, height: 64, borderRadius: 16, overflow: 'hidden',
              backgroundColor: '#fff',
              borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)',
            }}>
              <Image source={{ uri: originImage }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            </View>
          ) : origin ? (
            <View style={{
              width: 64, height: 64, borderRadius: 16,
              backgroundColor: 'rgba(255,255,255,0.55)',
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)',
            }}>
              <Text style={{
                fontSize: 30, fontWeight: '900', color: heroAccent,
                letterSpacing: -1, lineHeight: 32,
              }}>
                {(originLabel ?? origin).slice(0, 2).toUpperCase()}
              </Text>
            </View>
          ) : brand ? (
            <View style={{
              width: 76, height: 76, borderRadius: 18,
              backgroundColor: brandTileBg,
              alignItems: 'center', justifyContent: 'center',
              padding: 10, overflow: 'hidden',
              shadowColor: '#0F172A', shadowOpacity: 0.08,
              shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
              elevation: 3,
              borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)',
            }}>
              {brandLogo ? (
                <Image
                  source={{ uri: brandLogo }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                />
              ) : (
                <Text style={{
                  fontSize: 14, fontWeight: '800', color: colors.ink,
                  letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center',
                }} numberOfLines={2}>
                  {brand}
                </Text>
              )}
            </View>
          ) : null}
        </View>

      </View>

      {/* ── Product grid ─────────────────────────────────────── */}
      {isLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={colors.brand.DEFAULT} />
        </View>
      ) : (
        <FlatList
          data={products}
          numColumns={2}
          contentContainerStyle={{
            paddingHorizontal: 10, paddingTop: 16, paddingBottom: 32,
          }}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={{ paddingVertical: 20 }}>
                <ActivityIndicator color={colors.brand.DEFAULT} />
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.brand.DEFAULT}
              colors={[colors.brand.DEFAULT]}
            />
          }
          renderItem={({ item }) => (
            // Home's grid wrapper — see the note in category/[id].tsx for why a
            // `flex: 1` wrapper inside a columnWrapperStyle row spills the
            // card's text outside its border.
            <View style={{ width: '50%', padding: 6 }}>
              <ProductCard product={item} />
            </View>
          )}
          ListEmptyComponent={
            <View style={{
              paddingVertical: 48, paddingHorizontal: 24, alignItems: 'center',
            }}>
              <View style={{
                width: 64, height: 64, borderRadius: 32,
                backgroundColor: colors.brand.mist,
                alignItems: 'center', justifyContent: 'center', marginBottom: 14,
              }}>
                <PackageSearch size={28} color={colors.brand.DEFAULT} strokeWidth={1.75} />
              </View>
              <Text style={{
                fontSize: 17, fontWeight: '700', color: colors.ink,
                letterSpacing: -0.3, textAlign: 'center',
              }}>
                {lang === 'en' ? 'Nothing here yet' : 'Aún no hay productos'}
              </Text>
              <Text style={{
                fontSize: 13.5, color: colors.gray, marginTop: 6,
                textAlign: 'center', lineHeight: 18, maxWidth: 260,
              }}>
                {origin
                  ? (lang === 'en'
                      ? `We haven't added products from ${originLabel} yet. Check back soon.`
                      : `Aún no tenemos productos de ${originLabel}. Vuelve pronto.`)
                  : (lang === 'en'
                      ? 'Try a different filter or come back later.'
                      : 'Prueba con otro filtro o vuelve más tarde.')}
              </Text>
              <Pressable
                onPress={() => router.back()}
                style={({ pressed }) => ({
                  marginTop: 18, height: 42, paddingHorizontal: 18, borderRadius: 12,
                  backgroundColor: pressed ? colors.brand.mid : colors.brand.DEFAULT,
                  alignItems: 'center', justifyContent: 'center',
                })}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>
                  {lang === 'en' ? 'Browse other origins' : 'Ver otros orígenes'}
                </Text>
              </Pressable>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
