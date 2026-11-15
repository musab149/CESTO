import { View, Text, Pressable, FlatList, ScrollView, ActivityIndicator, Modal, Animated, Easing, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowDown01, ArrowDown10, ArrowDownAZ, ArrowDownUp, ArrowLeft, SlidersHorizontal } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useCategories, useSubcategories, useInfiniteProducts, useTopBrands, useProductTypesForSubcategory,
  useOriginsList, resolveImageUrl,
  defaultTopBrands,
} from '@grocery-app/shared';
import type { Product } from '@grocery-app/shared';
import { colors } from '../../src/constants/colors';
import { ProductGridSkeleton } from '../../src/components/Skeleton';
import { useLanguageStore } from '../../src/stores/languageStore';
import CategoryProductCard from '../../src/components/CategoryProductCard';

type SortKey = 'relevance' | 'price_asc' | 'price_desc' | 'name_asc';

export default function CategoryProductsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { lang } = useLanguageStore();
  const [selectedSub, setSelectedSub] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [activeBrand, setActiveBrand] = useState<string | null>(null);
  const [activeOrigin, setActiveOrigin] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('relevance');
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftBrand, setDraftBrand] = useState<string | null>(null);
  const [draftOrigin, setDraftOrigin] = useState<string | null>(null);
  const [draftSort, setDraftSort] = useState<SortKey>('relevance');

  const { data: categories = [] } = useCategories();
  const { data: subs = [] } = useSubcategories(id);
  const { data: brandsData } = useTopBrands();
  // Origins come from the first-class table, which is what web filters on —
  // not the legacy home_sections JSON that browse.tsx still reads.
  const { data: originsData } = useOriginsList();
  // Third taxonomy tier. Only meaningful inside a subcategory, and the hook
  // disables itself without one — mobile previously stopped at subcategory, so
  // this level of the catalogue was unreachable from the app entirely.
  const { data: productTypes = [] } = useProductTypesForSubcategory(selectedSub ?? undefined);
  // Paged, not a single big call. This asked for `limit: 200`, but the API
  // clamps page size to 60 (parsePage(query, 24, 60)) and returns 60 without
  // complaining — so product 61 onward was unreachable from the app, which is
  // most of the catalogue: 23 of 39 categories hold more than 60 items and the
  // largest holds 713. Same fix the search tab already carries.
  const {
    data: productPages, isLoading,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteProducts({
    categoryId: id,
    subcategoryId: selectedSub ?? undefined,
    // The API only honours productType alongside subcat, which the UI enforces
    // by clearing the selection whenever the subcategory changes.
    productTypeId: selectedType ?? undefined,
    brand: activeBrand ?? undefined,
    origin: activeOrigin ?? undefined,
    limit: 30,
  });

  const category = categories.find((c) => c.id === id);
  const totalCount = productPages?.pages[0]?.total ?? 0;
  const allProducts: Product[] = useMemo(
    () => (productPages?.pages ?? []).flatMap((page) => page.items ?? []),
    [productPages],
  );

  // Client-side sort — server only knows `name_asc`, so anything price-based
  // is re-sorted locally. Note this sorts the pages loaded SO FAR, so a
  // price sort is not a true catalogue-wide ordering until the list is fully
  // scrolled. Web's categories page carries the same limitation.
  const filteredProducts = useMemo(() => {
    const nameOf = (p: Product) => (lang === 'en' ? p.name_en : p.name_es);
    const priceOf = (p: Product) => p.variants?.[0]?.price ?? 0;
    if (sort === 'price_asc') return [...allProducts].sort((a, b) => priceOf(a) - priceOf(b));
    if (sort === 'price_desc') return [...allProducts].sort((a, b) => priceOf(b) - priceOf(a));
    if (sort === 'name_asc') return [...allProducts].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    return allProducts;
  }, [allProducts, sort, lang]);

  const topBrands = useMemo(() => {
    const list = (brandsData ?? defaultTopBrands).brands
      .filter((b) => b.is_active)
      .sort((a, b) => a.display_order - b.display_order);
    return list.slice(0, 12);
  }, [brandsData]);

  const sortOptions: { key: SortKey; label: string; hint: string; Icon: typeof ArrowDownUp }[] = [
    {
      key: 'relevance',
      label: lang === 'en' ? 'Relevance' : 'Relevancia',
      hint:  lang === 'en' ? 'Best match' : 'Mejor coincidencia',
      Icon: ArrowDownUp,
    },
    {
      key: 'price_asc',
      label: lang === 'en' ? 'Price' : 'Precio',
      hint:  lang === 'en' ? 'Low to high' : 'Menor a mayor',
      Icon: ArrowDown01,
    },
    {
      key: 'price_desc',
      label: lang === 'en' ? 'Price' : 'Precio',
      hint:  lang === 'en' ? 'High to low' : 'Mayor a menor',
      Icon: ArrowDown10,
    },
    {
      key: 'name_asc',
      label: lang === 'en' ? 'Name' : 'Nombre',
      hint:  'A → Z',
      Icon: ArrowDownAZ,
    },
  ];

  const activeFilterCount =
    (activeBrand ? 1 : 0) + (activeOrigin ? 1 : 0) + (sort !== 'relevance' ? 1 : 0);

  const openFilters = () => {
    setDraftBrand(activeBrand);
    setDraftOrigin(activeOrigin);
    setDraftSort(sort);
    setFilterOpen(true);
  };
  const applyFilters = () => {
    setActiveBrand(draftBrand);
    setActiveOrigin(draftOrigin);
    setSort(draftSort);
    setFilterOpen(false);
  };
  const resetFilters = () => {
    setDraftBrand(null);
    setDraftOrigin(null);
    setDraftSort('relevance');
  };

  const sheetTranslateY = useRef(new Animated.Value(500)).current;
  const sheetBackdrop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (filterOpen) {
      Animated.parallel([
        Animated.timing(sheetTranslateY, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(sheetBackdrop,   { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else {
      sheetTranslateY.setValue(500);
      sheetBackdrop.setValue(0);
    }
  }, [filterOpen, sheetTranslateY, sheetBackdrop]);

  if (!isLoading && !category) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ fontSize: 16, color: colors.muted }}>Category not found</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, backgroundColor: colors.surface.white, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 12 }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, flex: 1 }}>
          {category ? (lang === 'es' ? category.name_es : category.name_en) : ''}
        </Text>
        <Pressable
          onPress={openFilters}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            height: 34, paddingHorizontal: 12, borderRadius: 999,
            borderWidth: 1,
            borderColor: activeFilterCount > 0 ? colors.brand.DEFAULT : colors.border,
            backgroundColor: activeFilterCount > 0 ? colors.brand.mist : '#fff',
          }}
        >
          <SlidersHorizontal
            size={14}
            color={activeFilterCount > 0 ? colors.brand.deepest : colors.ink}
            strokeWidth={2}
          />
          <Text style={{ fontSize: 12, fontWeight: '700', color: activeFilterCount > 0 ? colors.brand.deepest : colors.ink }}>
            {filteredProducts.length} {lang === 'es' ? 'productos' : 'products'}
          </Text>
          {activeFilterCount > 0 && (
            <View style={{
              minWidth: 16, height: 16, borderRadius: 8,
              backgroundColor: colors.brand.DEFAULT,
              alignItems: 'center', justifyContent: 'center',
              paddingHorizontal: 4,
            }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#fff' }}>{activeFilterCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* Category hero — web's MobileCategoryHero. Carries the category's own
          tint, its icon, and the result count, which the screen otherwise
          never showed. */}
      {category && (
        <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 12,
              borderRadius: 22, padding: 16, overflow: 'hidden',
              backgroundColor: category.bg_color || colors.brand.mist,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={2} style={{ fontSize: 19, fontWeight: '700', color: colors.ink, letterSpacing: -0.3, lineHeight: 24 }}>
                {lang === 'en' ? category.name_en : category.name_es}
              </Text>
              {totalCount > 0 && (
                <Text style={{ marginTop: 4, fontSize: 11.5, color: 'rgba(15,23,42,0.65)' }}>
                  {totalCount}{' '}
                  {lang === 'en'
                    ? (totalCount === 1 ? 'product found.' : 'products found.')
                    : (totalCount === 1 ? 'producto encontrado.' : 'productos encontrados.')}
                </Text>
              )}
            </View>
            <View style={{ width: 92, height: 76, borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' }}>
              {category.icon_url
                ? <Image source={{ uri: resolveImageUrl(category.icon_url, 'tile') }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                : <Text style={{ fontSize: 40 }}>🛒</Text>}
            </View>
          </View>
        </View>
      )}

      {subs.length > 0 && (
        <View style={{ backgroundColor: colors.surface.white, borderBottomWidth: 1, borderBottomColor: colors.border, marginTop: 14 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 8 }}>
            <Pressable
              onPress={() => { setSelectedSub(null); setSelectedType(null); }}
              style={{
                paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
                backgroundColor: !selectedSub ? colors.brand.DEFAULT : colors.surface.linen,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: '600', color: !selectedSub ? '#fff' : colors.gray }}>
                {lang === 'es' ? 'Todos' : 'All'}
              </Text>
            </Pressable>
            {subs.map((sub) => (
              <Pressable
                key={sub.id}
                onPress={() => {
                  setSelectedSub(sub.id === selectedSub ? null : sub.id);
                  setSelectedType(null);
                }}
                style={{
                  paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
                  backgroundColor: selectedSub === sub.id ? colors.brand.DEFAULT : colors.surface.linen,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: selectedSub === sub.id ? '#fff' : colors.gray }}>
                  {lang === 'es' ? sub.name_es : sub.name_en}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Third tier. Sits under its parent rail and is visually lighter, so
              the two rails read as a hierarchy rather than as two peers. */}
          {selectedSub && productTypes.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}
            >
              <Pressable
                onPress={() => setSelectedType(null)}
                style={{
                  paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
                  borderWidth: 1,
                  borderColor: !selectedType ? colors.brand.DEFAULT : colors.border,
                  backgroundColor: !selectedType ? colors.brand.whisper : 'transparent',
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: !selectedType ? colors.brand.DEFAULT : colors.muted }}>
                  {lang === 'es' ? 'Todos los tipos' : 'All types'}
                </Text>
              </Pressable>
              {productTypes.map((pt) => {
                const on = selectedType === pt.id;
                return (
                  <Pressable
                    key={pt.id}
                    onPress={() => setSelectedType(on ? null : pt.id)}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
                      borderWidth: 1,
                      borderColor: on ? colors.brand.DEFAULT : colors.border,
                      backgroundColor: on ? colors.brand.whisper : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '600', color: on ? colors.brand.DEFAULT : colors.muted }}>
                      {lang === 'es' ? pt.name_es : pt.name_en}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      )}

      {isLoading ? (
        <ProductGridSkeleton />
      ) : (
        <FlatList
          data={filteredProducts}
          numColumns={2}
          contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 16 }}
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
          renderItem={({ item }) => (
            // width:'50%' rather than flex:1 — a flex wrapper inside a
            // columnWrapperStyle row leaves the row height ambiguous and the
            // card's border ends after the image, spilling price and name
            // outside it.
            <View style={{ width: '50%', padding: 6 }}>
              <CategoryProductCard product={item} />
            </View>
          )}
          ListEmptyComponent={
            <View style={{ paddingVertical: 60, alignItems: 'center' }}>
              <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink, marginTop: 12 }}>
                {lang === 'es' ? 'Sin productos' : 'No products'}
              </Text>
              <Text style={{ fontSize: 14, color: colors.muted, marginTop: 4 }}>
                {lang === 'es' ? 'Prueba otra subcategoría' : 'Try another subcategory'}
              </Text>
            </View>
          }
        />
      )}

      <Modal
        visible={filterOpen}
        transparent
        animationType="none"
        onRequestClose={() => setFilterOpen(false)}
      >
        <Animated.View
          style={{
            flex: 1,
            backgroundColor: 'rgba(15, 23, 42, 0.55)',
            opacity: sheetBackdrop,
            justifyContent: 'flex-end',
          }}
        >
          <Pressable style={{ flex: 1 }} onPress={() => setFilterOpen(false)} />
          <Animated.View
            style={{
              backgroundColor: colors.surface.cream,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              maxHeight: '85%',
              transform: [{ translateY: sheetTranslateY }],
            }}
          >
            <View style={{ alignItems: 'center', paddingTop: 10 }}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
            </View>

            <View style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12,
              borderBottomWidth: 1, borderBottomColor: colors.border,
            }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>
                {lang === 'en' ? 'Filters' : 'Filtros'}
              </Text>
              <Pressable
                onPress={resetFilters}
                hitSlop={8}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.brand.deepest }}>
                  {lang === 'en' ? 'Reset' : 'Restablecer'}
                </Text>
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 18, paddingBottom: 24 }}>
              <Text style={{
                fontSize: 11, fontWeight: '700', color: colors.muted,
                letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 10,
              }}>
                {lang === 'en' ? 'Sort by' : 'Ordenar por'}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 20 }}>
                {sortOptions.map((opt) => {
                  const active = opt.key === draftSort;
                  const Icon = opt.Icon;
                  return (
                    <View key={opt.key} style={{ width: '50%', padding: 4 }}>
                      <Pressable
                        onPress={() => setDraftSort(opt.key)}
                        style={({ pressed }) => ({
                          borderRadius: 14,
                          borderWidth: 1.5,
                          borderColor: active ? colors.brand.DEFAULT : colors.border,
                          backgroundColor: active ? colors.brand.mist : pressed ? colors.surface.linen : '#fff',
                          paddingVertical: 14,
                          paddingHorizontal: 14,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                        })}
                      >
                        <View style={{
                          width: 36, height: 36, borderRadius: 10,
                          backgroundColor: active ? colors.brand.DEFAULT : colors.surface.linen,
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Icon
                            size={18}
                            color={active ? '#fff' : colors.ink}
                            strokeWidth={2}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{
                            fontSize: 13, fontWeight: '700',
                            color: active ? colors.brand.deepest : colors.ink,
                          }}>
                            {opt.label}
                          </Text>
                          <Text style={{
                            fontSize: 11, fontWeight: '500',
                            color: active ? colors.brand.deepest : colors.muted,
                            marginTop: 2,
                          }}>
                            {opt.hint}
                          </Text>
                        </View>
                      </Pressable>
                    </View>
                  );
                })}
              </View>

              {topBrands.length > 0 && (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <Text style={{
                      fontSize: 11, fontWeight: '700', color: colors.muted,
                      letterSpacing: 1.4, textTransform: 'uppercase',
                    }}>
                      {lang === 'en' ? 'Brand' : 'Marca'}
                    </Text>
                    {draftBrand && (
                      <Pressable onPress={() => setDraftBrand(null)} hitSlop={8}>
                        <Text style={{ fontSize: 12, fontWeight: '600', color: colors.brand.DEFAULT }}>
                          {lang === 'en' ? 'Clear' : 'Limpiar'}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {topBrands.map((b, idx) => {
                      const isActive = draftBrand?.toLowerCase() === b.name.toLowerCase();
                      const avatarPalette = [
                        { bg: '#DCE6FD', fg: '#022B91' },
                        { bg: '#E9F4DC', fg: '#5FA133' },
                        { bg: '#FFEDD5', fg: '#9A3412' },
                        { bg: '#FEE2E2', fg: '#991B1B' },
                        { bg: '#F0F4FE', fg: '#054EE8' },
                        { bg: '#DFEFE3', fg: '#15803D' },
                      ];
                      const tone = avatarPalette[idx % avatarPalette.length];
                      const initial = b.name.trim().charAt(0).toUpperCase();
                      return (
                        <Pressable
                          key={b.name}
                          onPress={() => setDraftBrand(isActive ? null : b.name)}
                          style={({ pressed }) => ({
                            flexDirection: 'row', alignItems: 'center', gap: 9,
                            paddingVertical: 7, paddingLeft: 7, paddingRight: 14,
                            borderRadius: 999,
                            borderWidth: 1.5,
                            borderColor: isActive ? colors.brand.DEFAULT : 'transparent',
                            backgroundColor: isActive
                              ? colors.brand.whisper
                              : pressed
                                ? colors.surface.linen
                                : colors.surface.sand,
                          })}
                        >
                          <View style={{
                            width: 28, height: 28, borderRadius: 14,
                            backgroundColor: isActive ? colors.brand.DEFAULT : tone.bg,
                            alignItems: 'center', justifyContent: 'center',
                          }}>
                            <Text style={{
                              fontSize: 12, fontWeight: '800',
                              color: isActive ? '#fff' : tone.fg,
                            }}>
                              {initial}
                            </Text>
                          </View>
                          <Text style={{
                            fontSize: 13, fontWeight: '700',
                            color: isActive ? colors.brand.deepest : colors.ink,
                          }}>
                            {b.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}

              {/* Origin — web's categories page filters on brand AND origin;
                  mobile offered brand only, so the same journey gave different
                  controls depending on which screen you arrived from. */}
              {(originsData ?? []).length > 0 && (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 }}>
                    <Text style={{
                      fontSize: 11, fontWeight: '700', color: colors.muted,
                      letterSpacing: 1.4, textTransform: 'uppercase',
                    }}>
                      {lang === 'en' ? 'Origin' : 'Origen'}
                    </Text>
                    {draftOrigin && (
                      <Pressable onPress={() => setDraftOrigin(null)} hitSlop={8}>
                        <Text style={{ fontSize: 12, fontWeight: '600', color: colors.brand.DEFAULT }}>
                          {lang === 'en' ? 'Clear' : 'Limpiar'}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {(originsData ?? []).map((o) => {
                      // Compared lower-case both sides: origin strings are
                      // treated case-insensitively everywhere in this codebase.
                      const isActive = draftOrigin?.toLowerCase() === o.key.toLowerCase();
                      return (
                        <Pressable
                          key={o.id}
                          onPress={() => setDraftOrigin(isActive ? null : o.key)}
                          style={{
                            flexDirection: 'row', alignItems: 'center', gap: 6,
                            paddingHorizontal: 12, height: 38, borderRadius: 999,
                            borderWidth: 1,
                            borderColor: isActive ? colors.brand.DEFAULT : colors.border,
                            backgroundColor: isActive ? colors.brand.mist : '#fff',
                          }}
                        >
                          <View style={{
                            width: 8, height: 8, borderRadius: 4,
                            backgroundColor: o.accent_color ?? colors.muted,
                          }} />
                          <Text style={{
                            fontSize: 13, fontWeight: '700',
                            color: isActive ? colors.brand.deepest : colors.ink,
                          }}>
                            {lang === 'en' ? o.label_en : o.label_es}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}
            </ScrollView>

            <View style={{
              flexDirection: 'row', gap: 12,
              paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28,
              borderTopWidth: 1, borderTopColor: colors.border,
              backgroundColor: colors.surface.cream,
            }}>
              <Pressable
                onPress={() => setFilterOpen(false)}
                style={{
                  flex: 1, height: 52, borderRadius: 12,
                  borderWidth: 1, borderColor: colors.border,
                  justifyContent: 'center', alignItems: 'center',
                  backgroundColor: '#fff',
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>
                  {lang === 'en' ? 'Cancel' : 'Cancelar'}
                </Text>
              </Pressable>
              <Pressable
                onPress={applyFilters}
                style={{
                  flex: 1.4, height: 52, borderRadius: 12,
                  backgroundColor: colors.brand.DEFAULT,
                  justifyContent: 'center', alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
                  {lang === 'en' ? 'Apply filters' : 'Aplicar filtros'}
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </Animated.View>
      </Modal>
    </SafeAreaView>
  );
}
