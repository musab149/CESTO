import {
  View, Text, Pressable, FlatList, ActivityIndicator, Image, ScrollView, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, CheckCircle2, Star, Users, Clock, Plus, Check, Share2,
  Store as StoreIcon, Package,
} from 'lucide-react-native';
import {
  useStore, useInfiniteStoreProducts, useStoreSubcategories,
  useStoreProductTypes, useStoreRashanPacks, useToggleFollowStore,
  resolveImageUrl, type Product, type StoreProductsParams,
} from '@grocery-app/shared';
import { colors } from '../../src/constants/colors';
import { useLanguageStore } from '../../src/stores/languageStore';
import { deliveryLabel } from '../../src/lib/deliveryCopy';
import { useAuthStore } from '../../src/stores/authStore';
import { useToast } from '../../src/components/Toast';
import ProductCard from '../../src/components/ProductCard';

/**
 * Store storefront — mirrors web's /stores/:slug at its mobile breakpoint.
 *
 * Same single-column order web uses: store card, category pills, subcategory
 * pills, product-type chips, brand tiles, tabs, then a two-column product grid
 * (`grid-cols-2` is web's own mobile value, so the grid matches rather than
 * diverging).
 *
 * The three taxonomy rows are deliberately different weights, as on web:
 * category and subcategory are filled pills, product type is a smaller outline
 * chip, so the levels read parent → child → grandchild instead of three equal
 * filters.
 *
 * Paged with useInfiniteStoreProducts. Not a design choice — the endpoint caps
 * a page at 60 and this store has 288 products, so a single call would hide
 * most of the catalogue exactly as the category screen did before c8ee9df.
 */

type Tab = 'all' | 'offers' | 'best-sellers' | 'new-arrivals' | 'featured' | 'rashan';
type SortKey = NonNullable<StoreProductsParams['sort']>;

const BRAND_TILE_CAP = 5; // web caps at 5 below sm, with a "More Brands" tile

export default function StoreDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { lang } = useLanguageStore();
  const toast = useToast();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const t = (en: string, es: string) => (lang === 'en' ? en : es);

  const { data: store, isLoading: loadingStore } = useStore(slug);
  const { data: rashanPacks = [], isLoading: loadingPacks } = useStoreRashanPacks(slug);
  const toggleFollow = useToggleFollowStore();

  const [tab, setTab] = useState<Tab>('all');
  const [sort, setSort] = useState<SortKey>('popular');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  const [productTypeId, setProductTypeId] = useState<string | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [showAllBrands, setShowAllBrands] = useState(false);

  const { data: subcategories = [] } = useStoreSubcategories(slug, categoryId ?? undefined);
  const { data: productTypes = [] } = useStoreProductTypes(slug, subcategoryId ?? undefined);

  // A store can stop selling packs while someone sits on the tab — web falls
  // back to 'all' for the same reason.
  useEffect(() => {
    if (tab === 'rashan' && !loadingPacks && rashanPacks.length === 0) setTab('all');
  }, [tab, loadingPacks, rashanPacks.length]);

  const {
    data: pages, isLoading: loadingProducts,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteStoreProducts(slug, {
    categoryId: categoryId ?? undefined,
    subcategoryId: subcategoryId ?? undefined,
    productTypeId: productTypeId ?? undefined,
    brandId: brandId ?? undefined,
    // `rashan` is not a product filter — the server has no such tab, so it
    // falls back to 'all' and the rashan branch renders packs instead.
    tab: tab === 'rashan' ? 'all' : tab,
    sort,
    limit: 30,
  });

  const products: Product[] = useMemo(
    // This endpoint returns `products`, not `items` like /api/products.
    () => (pages?.pages ?? []).flatMap((p) => p.products ?? []),
    [pages],
  );

  const onFollow = () => {
    if (!slug || !store) return;
    if (!isAuthenticated) {
      toast.info(
        t('Sign in required', 'Inicia sesión'),
        t('Log in to follow stores.', 'Inicia sesión para seguir tiendas.'),
      );
      router.push('/login');
      return;
    }
    toggleFollow.mutate({ slug, follow: !store.is_followed });
  };

  if (loadingStore) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.brand.DEFAULT} />
      </SafeAreaView>
    );
  }

  if (!store) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen, alignItems: 'center', justifyContent: 'center', gap: 8 }} edges={['top']}>
        <StoreIcon size={30} color={colors.muted} strokeWidth={1.5} />
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>
          {t('Store not found', 'Tienda no encontrada')}
        </Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 8 }}>
          <Text style={{ fontSize: 13.5, fontWeight: '700', color: colors.brand.DEFAULT }}>
            {t('Go back', 'Volver')}
          </Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const tagline = lang === 'en' ? store.tagline_en : store.tagline_es;
  const description = lang === 'en' ? store.description_en : store.description_es;
  const cover = store.cover_url ? resolveImageUrl(store.cover_url, 'hero') : null;
  const logo = store.logo_url ? resolveImageUrl(store.logo_url, 'logo') : null;
  const brands = showAllBrands ? store.brand_counts : store.brand_counts.slice(0, BRAND_TILE_CAP);
  const hasMoreBrands = !showAllBrands && store.brand_counts.length > BRAND_TILE_CAP;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: t('All', 'Todos') },
    { key: 'offers', label: t('Offers', 'Ofertas') },
    { key: 'best-sellers', label: t('Best sellers', 'Más vendidos') },
    { key: 'new-arrivals', label: t('New arrivals', 'Novedades') },
    { key: 'featured', label: t('Featured', 'Destacados') },
    ...(rashanPacks.length > 0 ? [{ key: 'rashan' as Tab, label: 'Rashan' }] : []),
  ];

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'popular', label: t('Popular', 'Popular') },
    { key: 'price_asc', label: t('Price ↑', 'Precio ↑') },
    { key: 'price_desc', label: t('Price ↓', 'Precio ↓') },
    { key: 'newest', label: t('Newest', 'Nuevos') },
    { key: 'name_asc', label: 'A–Z' },
  ];

  const header = (
    // +6 on top of the grid's 10px inset, so header content sits at the same
    // 16px page margin as the rest of the app while the cards keep their gutter.
    <View style={{ gap: 12, paddingBottom: 4, paddingHorizontal: 6 }}>
      {/* ── Store card ───────────────────────────────────
          Web's treatment: cover band with a scrim and the delivery pill, the
          logo overlapping it, then identity, description and the stats line.
          The card sits on surface-cream, not white. */}
      <View style={{ backgroundColor: colors.surface.cream, borderRadius: 16, borderWidth: 1, borderColor: colors.border }}>
        <View
          style={{
            height: 128, borderTopLeftRadius: 15, borderTopRightRadius: 15,
            overflow: 'hidden', backgroundColor: store.logo_bg || colors.brand.whisper,
          }}
        >
          {cover ? (
            <Image source={{ uri: cover }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            // No cover: web sets the store's own name as a faded watermark
            // rather than leaving a flat band.
            <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }]}>
              <Text
                numberOfLines={1}
                style={{ fontSize: 44, fontWeight: '900', color: 'rgba(15,23,42,0.06)', letterSpacing: -1, textTransform: 'uppercase' }}
              >
                {store.name}
              </Text>
            </View>
          )}

          <LinearGradient
            colors={cover
              ? ['transparent', 'rgba(0,0,0,0.10)', 'rgba(0,0,0,0.45)']
              : ['transparent', 'transparent', 'rgba(15,23,42,0.40)']}
            style={StyleSheet.absoluteFillObject}
          />

          <View
            style={{
              position: 'absolute', top: 12, right: 12,
              flexDirection: 'row', alignItems: 'center', gap: 6,
              backgroundColor: 'rgba(255,255,255,0.95)',
              borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
            }}
          >
            <Clock size={12} color={colors.amber.deep} strokeWidth={2.25} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.amber.deep }}>
              {deliveryLabel(store.fast_delivery, lang)}
            </Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 }}>
          {/* The 4px cream border is what reads as the logo sitting on the
              card rather than inside the cover. */}
          <View
            style={{
              width: 80, height: 80, borderRadius: 16, marginTop: -40,
              borderWidth: 4, borderColor: colors.surface.cream,
              backgroundColor: store.logo_bg || '#fff',
              alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}
          >
            {logo
              ? <Image source={{ uri: logo }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
              : <StoreIcon size={34} color={colors.muted} strokeWidth={1.5} />}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 19, fontWeight: '700', color: colors.ink, letterSpacing: -0.3 }}>
              {store.name}
            </Text>
            {store.is_verified && <CheckCircle2 size={17} color={colors.brand.DEFAULT} strokeWidth={2} />}
          </View>

          {tagline ? (
            <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 2 }}>{tagline}</Text>
          ) : null}

          {description ? (
            <Text numberOfLines={2} style={{ fontSize: 13, color: colors.gray, marginTop: 6, lineHeight: 18 }}>
              {description}
            </Text>
          ) : null}

          {/* Stats read as one line — web's shape, not a boxed grid. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, marginTop: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Users size={13} color={colors.muted} strokeWidth={2} />
              <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.ink }}>{store.followers_count}</Text>
              <Text style={{ fontSize: 12.5, color: colors.muted }}>{t('followers', 'seguidores')}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.ink }}>{store.products_count}</Text>
              <Text style={{ fontSize: 12.5, color: colors.muted }}>{t('products', 'productos')}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Star size={13} color={colors.warning} fill={colors.warning} strokeWidth={2} />
              <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.ink }}>
                {store.rating != null ? store.rating.toFixed(1) : '—'}
              </Text>
              {store.rating_count > 0 && (
                <Text style={{ fontSize: 12.5, color: colors.muted }}>({store.rating_count})</Text>
              )}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: store.is_open_now ? colors.amber.deep : colors.muted }} />
              <Text style={{ fontSize: 12.5, fontWeight: '600', color: store.is_open_now ? colors.amber.deep : colors.muted }}>
                {store.is_open_now ? t('Open now', 'Abierto') : t('Closed', 'Cerrado')}
              </Text>
            </View>
          </View>

          {/* Follow takes the row; Share is the icon square beside it. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }}>
            <Pressable
              onPress={onFollow}
              disabled={toggleFollow.isPending}
              style={{
                flex: 1, height: 44, borderRadius: 12,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: store.is_followed ? colors.brand.mist : colors.brand.DEFAULT,
                borderWidth: store.is_followed ? 1 : 0, borderColor: colors.brand.soft,
                opacity: toggleFollow.isPending ? 0.7 : 1,
              }}
            >
              {store.is_followed
                ? <Check size={15} color={colors.brand.DEFAULT} strokeWidth={2.5} />
                : <Plus size={15} color="#fff" strokeWidth={2.5} />}
              <Text style={{ fontSize: 14, fontWeight: '600', color: store.is_followed ? colors.brand.DEFAULT : '#fff' }}>
                {store.is_followed ? t('Following', 'Siguiendo') : t('Follow', 'Seguir')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => toast.info(t('Share', 'Compartir'), `cestoshop.com/stores/${store.slug}`)}
              accessibilityLabel={t('Share store', 'Compartir tienda')}
              style={{
                width: 44, height: 44, borderRadius: 12,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border,
              }}
            >
              <Share2 size={15} color={colors.ink} strokeWidth={2} />
            </Pressable>
          </View>
        </View>
      </View>

      {/* ── Category pills ─────────────────────────────── */}
      {store.category_counts.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
          <Pill
            label={t('All', 'Todas')}
            active={!categoryId}
            onPress={() => { setCategoryId(null); setSubcategoryId(null); setProductTypeId(null); }}
          />
          {store.category_counts.map((c) => (
            <Pill
              key={c.category_id}
              label={`${lang === 'en' ? (c as { name_en?: string }).name_en ?? c.name_es : c.name_es} (${c.count})`}
              active={categoryId === c.category_id}
              onPress={() => {
                setCategoryId(categoryId === c.category_id ? null : c.category_id);
                setSubcategoryId(null);
                setProductTypeId(null);
              }}
            />
          ))}
        </ScrollView>
      )}

      {/* ── Subcategory pills — second tier, same weight as above ── */}
      {categoryId && subcategories.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
          <Pill label={t('All', 'Todas')} active={!subcategoryId} onPress={() => { setSubcategoryId(null); setProductTypeId(null); }} />
          {subcategories.map((s) => (
            <Pill
              key={s.id}
              label={`${lang === 'en' ? s.name_en : s.name_es} (${s.count})`}
              active={subcategoryId === s.id}
              onPress={() => { setSubcategoryId(subcategoryId === s.id ? null : s.id); setProductTypeId(null); }}
            />
          ))}
        </ScrollView>
      )}

      {/* ── Product-type chips — third tier, deliberately lighter ── */}
      {subcategoryId && productTypes.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flexGrow: 0 }}>
          {productTypes.map((p) => {
            const active = productTypeId === p.id;
            return (
              <Pressable
                key={p.id}
                onPress={() => setProductTypeId(active ? null : p.id)}
                style={{
                  height: 30, paddingHorizontal: 11, borderRadius: 999,
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: active ? colors.brand.DEFAULT : colors.border,
                  backgroundColor: active ? colors.brand.mist : 'transparent',
                }}
              >
                <Text style={{ fontSize: 11.5, fontWeight: '600', color: active ? colors.brand.deepest : colors.gray }}>
                  {lang === 'en' ? p.name_en : p.name_es} ({p.count})
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* ── Shop by Brand ──────────────────────────────── */}
      {store.brand_counts.length > 0 && (
        <View>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink, marginBottom: 8 }}>
            {t('Shop by Brand', 'Comprar por marca')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {brands.map((b) => {
              const active = brandId === b.brand_id;
              return (
                <Pressable
                  key={b.brand_id}
                  onPress={() => setBrandId(active ? null : b.brand_id)}
                  style={{
                    paddingHorizontal: 12, height: 34, borderRadius: 10,
                    alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: active ? colors.brand.DEFAULT : colors.border,
                    backgroundColor: active ? colors.brand.mist : '#fff',
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: active ? colors.brand.deepest : colors.ink }}>
                    {b.name} ({b.count})
                  </Text>
                </Pressable>
              );
            })}
            {hasMoreBrands && (
              <Pressable
                onPress={() => setShowAllBrands(true)}
                style={{ paddingHorizontal: 12, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface.sand }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.gray }}>
                  {t('More Brands', 'Más marcas')}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {/* ── Tabs ───────────────────────────────────────── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flexGrow: 0 }}>
        {tabs.map((tk) => {
          const active = tab === tk.key;
          return (
            <Pressable
              key={tk.key}
              onPress={() => setTab(tk.key)}
              style={{
                height: 36, paddingHorizontal: 14, borderRadius: 999,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: active ? colors.ink : '#fff',
                borderWidth: 1, borderColor: active ? colors.ink : colors.border,
              }}
            >
              <Text style={{ fontSize: 12.5, fontWeight: '700', color: active ? '#fff' : colors.gray }}>
                {tk.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* ── Sort toolbar — hidden on the rashan tab, as on web ── */}
      {tab !== 'rashan' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flexGrow: 0 }}>
          {sortOptions.map((o) => {
            const active = sort === o.key;
            return (
              <Pressable
                key={o.key}
                onPress={() => setSort(o.key)}
                style={{
                  height: 32, paddingHorizontal: 12, borderRadius: 999,
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: active ? colors.brand.DEFAULT : colors.border,
                  backgroundColor: active ? colors.brand.mist : 'transparent',
                }}
              >
                <Text style={{ fontSize: 11.5, fontWeight: '600', color: active ? colors.brand.deepest : colors.gray }}>
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {tab === 'rashan' && (
        <Text style={{ fontSize: 12.5, color: colors.gray, lineHeight: 18 }}>
          {t(
            'Recurring grocery packs from this store. Pick one, set how often you want it, and it arrives on schedule.',
            'Packs de compra recurrente de esta tienda. Elige uno, dinos cada cuánto lo quieres y llega solo.',
          )}
        </Text>
      )}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <View
        style={{
          height: 56, flexDirection: 'row', alignItems: 'center', gap: 12,
          paddingHorizontal: 16, backgroundColor: colors.surface.white,
          borderBottomWidth: 1, borderBottomColor: colors.border,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, alignItems: 'center', justifyContent: 'center' }}
        >
          <ArrowLeft size={20} color={colors.ink} strokeWidth={2} />
        </Pressable>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 17, fontWeight: '700', color: colors.ink }}>
          {store.name}
        </Text>
      </View>

      {tab === 'rashan' ? (
        <FlatList
          data={rashanPacks}
          keyExtractor={(p) => p.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/rashan/pack/${item.id}`)}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 12,
                backgroundColor: '#fff', borderRadius: 14, padding: 12,
                borderWidth: 1, borderColor: colors.border, marginBottom: 10,
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <View style={{ width: 54, height: 54, borderRadius: 12, backgroundColor: colors.brand.mist, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {item.cover_url
                  ? <Image source={{ uri: resolveImageUrl(item.cover_url, 'tile') }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  : <Package size={22} color={colors.brand.DEFAULT} strokeWidth={1.75} />}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '700', color: colors.ink }}>
                  {lang === 'en' ? item.name_en : item.name_es}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: 12.5, color: colors.muted, marginTop: 2 }}>
                  {lang === 'en' ? item.description_en : item.description_es}
                </Text>
              </View>
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={products}
          numColumns={2}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 14, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={{ paddingVertical: 20 }}>
                <ActivityIndicator color={colors.brand.DEFAULT} />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            // width:'50%' wrapper — see the note in category/[id].tsx for why
            // a flex:1 wrapper spills the card here.
            <View style={{ width: '50%', padding: 6 }}>
              <ProductCard product={item} />
            </View>
          )}
          ListEmptyComponent={
            loadingProducts ? (
              <View style={{ paddingVertical: 50, alignItems: 'center' }}>
                <ActivityIndicator color={colors.brand.DEFAULT} />
              </View>
            ) : (
              <View style={{ paddingVertical: 50, alignItems: 'center', paddingHorizontal: 30 }}>
                <Package size={28} color={colors.muted} strokeWidth={1.5} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginTop: 10 }}>
                  {t('Nothing here', 'Nada por aquí')}
                </Text>
                <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 4 }}>
                  {t('Try another category or tab.', 'Prueba otra categoría o pestaña.')}
                </Text>
              </View>
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

/** Filled pill — the weight web gives its category and subcategory rows. */
function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        height: 34, paddingHorizontal: 13, borderRadius: 999,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: active ? colors.brand.DEFAULT : '#fff',
        borderWidth: 1, borderColor: active ? colors.brand.DEFAULT : colors.border,
      }}
    >
      <Text style={{ fontSize: 12.5, fontWeight: '700', color: active ? '#fff' : colors.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}
