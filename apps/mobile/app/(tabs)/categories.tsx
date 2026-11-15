import {
  View,
  Text,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
  RefreshControl,
  FlatList,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search as SearchIcon, ArrowRight } from 'lucide-react-native';
import {
  useCategories,
  useSubcategories,
  useInfiniteProducts,
  resolveImageUrl,
  type Product,
} from '@grocery-app/shared';
import { colors } from '../../src/constants/colors';
import { useLanguageStore } from '../../src/stores/languageStore';
import AppHeader from '../../src/components/AppHeader';
import CategoryProductCard from '../../src/components/CategoryProductCard';

/* Soft tints used for hero banner + tile fallbacks. Indexed by category order
 * so neighbouring tiles never collide. */
const TILE_TONES = [
  '#E3ECFE', // brand whisper-ish blue
  '#FDE7E1', // peach
  '#E8F5EC', // mint
  '#FBE9C0', // sand
  '#F4D0DA', // pink
  '#E0EFE3', // sage
  '#EFEAE1', // dune
  '#DCE6FD', // brand mist
];

const RAIL_WIDTH = 92;

type CategoryRow = {
  id: string;
  name_en: string;
  name_es: string;
  icon_url: string | null;
  bg_color: string | null;
  accent_color: string | null;
  _count?: { products?: number; subcategories?: number };
};

/* ─── LEFT RAIL ─────────────────────────────────────────── */

function RailTile({
  category,
  active,
  tone,
  onPress,
  lang,
}: {
  category: CategoryRow;
  active: boolean;
  tone: string;
  onPress: () => void;
  lang: 'en' | 'es';
}) {
  const name = lang === 'en' ? category.name_en : category.name_es;
  const iconUrl = category.icon_url ? resolveImageUrl(category.icon_url, 'tile') : null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 10,
        paddingLeft: 8,
        paddingRight: 6,
        backgroundColor: active ? colors.brand.whisper : 'transparent',
        opacity: pressed ? 0.85 : 1,
        position: 'relative',
      })}
    >
      {/* Active left accent bar */}
      {active && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 6,
            bottom: 6,
            width: 3,
            borderTopRightRadius: 3,
            borderBottomRightRadius: 3,
            backgroundColor: colors.brand.DEFAULT,
          }}
        />
      )}

      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 14,
          backgroundColor: tone,
          alignSelf: 'center',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {iconUrl ? (
          <Image
            source={{ uri: iconUrl }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        ) : (
          <Text style={{ fontSize: 22 }}>🛒</Text>
        )}
      </View>

      <Text
        numberOfLines={2}
        style={{
          marginTop: 6,
          textAlign: 'center',
          fontSize: 10.5,
          lineHeight: 13,
          letterSpacing: -0.1,
          fontWeight: active ? '700' : '500',
          color: active ? colors.brand.deepest : colors.gray,
        }}
      >
        {name}
      </Text>
    </Pressable>
  );
}

/* ─── HERO BANNER ──────────────────────────────────────── */

function CategoryHero({
  category,
  tone,
  onPress,
  lang,
  count: countOverride,
}: {
  category: CategoryRow;
  tone: string;
  onPress: () => void;
  lang: 'en' | 'es';
  /** Live total from the products query. Falls back to the category's own
   *  rollup when not supplied, which is what the rail tiles show. */
  count?: number;
}) {
  const name = lang === 'en' ? category.name_en : category.name_es;
  const iconUrl = category.icon_url ? resolveImageUrl(category.icon_url, 'tile') : null;
  const bg = category.bg_color || tone;
  const count = countOverride ?? category._count?.products ?? 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: bg,
        borderRadius: 22,
        paddingVertical: 18,
        paddingHorizontal: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        overflow: 'hidden',
        marginBottom: 18,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={2}
          style={{
            fontSize: 20,
            fontWeight: '700',
            color: colors.ink,
            letterSpacing: -0.5,
          }}
        >
          {name}
        </Text>
        {count > 0 && (
          <Text
            style={{
              marginTop: 6,
              fontSize: 12,
              color: 'rgba(15,23,42,0.65)',
              fontWeight: '400',
              letterSpacing: -0.2,
            }}
          >
            {count} {lang === 'en' ? 'products found.' : 'productos encontrados.'}
          </Text>
        )}
        <View
          style={{
            marginTop: 12,
            alignSelf: 'flex-start',
            height: 36,
            borderRadius: 18,
            backgroundColor: colors.brand.DEFAULT,
            flexDirection: 'row',
            alignItems: 'center',
            paddingLeft: 14,
            paddingRight: 8,
            gap: 8,
          }}
        >
          <Text
            style={{
              fontSize: 12.5,
              fontWeight: '700',
              color: '#fff',
              letterSpacing: -0.2,
            }}
          >
            {lang === 'en' ? 'Browse All' : 'Ver todo'}
          </Text>
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: 'rgba(255,255,255,0.22)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ArrowRight size={12} color="#fff" strokeWidth={2.5} />
          </View>
        </View>
      </View>

      <View
        style={{
          width: 110,
          height: 90,
          borderRadius: 18,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {iconUrl ? (
          <Image
            source={{ uri: iconUrl }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        ) : (
          <Text style={{ fontSize: 64 }}>🛍️</Text>
        )}
      </View>
    </Pressable>
  );
}

/**
 * Right pane — subcategory chips over one paginated 2-column grid, which is
 * what web's categories page shows at mobile width.
 *
 * Replaces a stack of per-subcategory sections that each fetched `limit: 6`.
 * That shape had two problems: a category with eight subcategories fired eight
 * queries to render 48 products, and no subcategory ever showed more than six
 * without leaving the screen. Chips filter one list instead, and the list pages.
 */
function CategoryPane({
  category, tone, lang, onOpenCategory, refreshing, onRefresh,
}: {
  category: CategoryRow;
  tone: string;
  lang: 'en' | 'es';
  onOpenCategory: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { data: subs = [] } = useSubcategories(category.id);
  const [activeSub, setActiveSub] = useState<string | null>(null);

  // A subcategory from the previous category would filter everything away.
  useEffect(() => { setActiveSub(null); }, [category.id]);

  const ordered = [...subs].sort((a, b) => a.sort_order - b.sort_order);

  const {
    data: pages, isLoading,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteProducts({
    categoryId: category.id,
    subcategoryId: activeSub ?? undefined,
    limit: 20,
  });

  const products = useMemo(
    () => (pages?.pages ?? []).flatMap((pg) => pg.items ?? []),
    [pages],
  );
  const total = pages?.pages[0]?.total ?? 0;

  return (
    <FlatList<Product>
      data={products}
      numColumns={2}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ padding: 8, paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.brand.DEFAULT}
          colors={[colors.brand.DEFAULT]}
        />
      }
      onEndReachedThreshold={0.4}
      onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
      ListHeaderComponent={
        <View style={{ paddingHorizontal: 6 }}>
          <CategoryHero category={category} tone={tone} lang={lang} count={total} onPress={onOpenCategory} />

          {ordered.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
              style={{ marginBottom: 8, flexGrow: 0 }}
            >
              <SubChip label={lang === 'en' ? 'All' : 'Todos'} active={!activeSub} onPress={() => setActiveSub(null)} />
              {ordered.map((sub) => (
                <SubChip
                  key={sub.id}
                  label={lang === 'en' ? sub.name_en : sub.name_es}
                  active={activeSub === sub.id}
                  onPress={() => setActiveSub(activeSub === sub.id ? null : sub.id)}
                />
              ))}
            </ScrollView>
          )}
        </View>
      }
      ListFooterComponent={
        isFetchingNextPage ? (
          <View style={{ paddingVertical: 18 }}>
            <ActivityIndicator color={colors.brand.DEFAULT} size="small" />
          </View>
        ) : null
      }
      renderItem={({ item }) => (
        <View style={{ width: '50%', padding: 6 }}>
          <CategoryProductCard product={item} />
        </View>
      )}
      ListEmptyComponent={
        isLoading ? (
          <View style={{ paddingVertical: 30, alignItems: 'center' }}>
            <ActivityIndicator color={colors.brand.DEFAULT} size="small" />
          </View>
        ) : (
          <View style={{ paddingVertical: 40, alignItems: 'center', paddingHorizontal: 20 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>
              {lang === 'en' ? 'No products yet' : 'Sin productos'}
            </Text>
            <Text style={{ fontSize: 12.5, color: colors.gray, marginTop: 4, textAlign: 'center' }}>
              {activeSub
                ? (lang === 'en' ? 'Try another subcategory.' : 'Prueba otra subcategoría.')
                : (lang === 'en' ? 'Check back later.' : 'Vuelve más tarde.')}
            </Text>
          </View>
        )
      }
    />
  );
}

function SubChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        height: 32, paddingHorizontal: 14, borderRadius: 999,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: active ? colors.brand.DEFAULT : '#fff',
        borderWidth: 1, borderColor: active ? colors.brand.DEFAULT : colors.border,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: 11.5, fontWeight: '700', color: active ? '#fff' : colors.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}

/* ─── SCREEN ───────────────────────────────────────────── */

export default function CategoriesScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const { data: categories = [], isLoading } = useCategories();
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  /* Default to the first category once data lands. */
  useEffect(() => {
    if (!selectedId && categories.length > 0) {
      setSelectedId(categories[0].id);
    }
  }, [categories, selectedId]);

  const selected = useMemo<CategoryRow | null>(() => {
    if (!selectedId) return null;
    return (categories.find((c) => c.id === selectedId) as CategoryRow | undefined) ?? null;
  }, [categories, selectedId]);

  const selectedTone = useMemo(() => {
    if (!selected) return TILE_TONES[0];
    const idx = categories.findIndex((c) => c.id === selected.id);
    return TILE_TONES[Math.max(0, idx) % TILE_TONES.length];
  }, [categories, selected]);

  return (
    <SafeAreaView edges={[]} style={{ flex: 1, backgroundColor: colors.surface.linen }}>
      <AppHeader />

      {/* Page title row */}
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: 10,
          flexDirection: 'row',
          alignItems: 'baseline',
          gap: 8,
        }}
      >
        <Text
          style={{
            fontSize: 22,
            fontWeight: '600',
            color: colors.ink,
            letterSpacing: -0.6,
          }}
        >
          {lang === 'es' ? 'Todas las categorías' : 'All Categories'}
        </Text>
        <Text style={{ fontFamily: 'monospace', fontSize: 11, color: colors.muted }}>
          {categories.length.toString().padStart(2, '0')}
        </Text>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={colors.brand.DEFAULT} />
        </View>
      ) : categories.length === 0 ? (
        <View style={{ flex: 1, paddingVertical: 60, alignItems: 'center', paddingHorizontal: 40 }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: colors.surface.cream,
              borderWidth: 1,
              borderColor: colors.border,
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <SearchIcon size={26} color={colors.muted} strokeWidth={1.5} />
          </View>
          <Text
            style={{
              fontSize: 19,
              fontWeight: '500',
              color: colors.ink,
              textAlign: 'center',
              marginBottom: 6,
              letterSpacing: -0.4,
            }}
          >
            {lang === 'es' ? 'Sin categorías' : 'No categories'}
          </Text>
          <Text
            style={{ fontSize: 13, color: colors.gray, textAlign: 'center', lineHeight: 18 }}
          >
            {lang === 'es' ? 'Vuelve más tarde' : 'Check back later'}
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {/* ─── LEFT RAIL ─── */}
          <View
            style={{
              width: RAIL_WIDTH,
              borderRightWidth: 1,
              borderRightColor: colors.border,
              backgroundColor: colors.surface.cream,
            }}
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: 8, paddingBottom: 32 }}
            >
              {categories.map((cat, i) => (
                <RailTile
                  key={cat.id}
                  category={cat as CategoryRow}
                  active={selectedId === cat.id}
                  tone={TILE_TONES[i % TILE_TONES.length]}
                  onPress={() => setSelectedId(cat.id)}
                  lang={lang}
                />
              ))}
            </ScrollView>
          </View>

          {/* ─── RIGHT PANE ─── */}
          <View style={{ flex: 1 }}>
            {selected && (
              <CategoryPane
                key={selected.id}
                category={selected}
                tone={selectedTone}
                lang={lang}
                onOpenCategory={() => router.push(`/category/${selected.id}`)}
                refreshing={refreshing}
                onRefresh={onRefresh}
              />
            )}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
