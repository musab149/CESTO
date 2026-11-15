import { View, Text, ScrollView, Pressable, Modal, TextInput, FlatList, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronDown,
  Sparkles,
  Plus,
  Minus,
  Search,
  X,
  Trash2,
  Check,
  Users,
  Repeat,
  ShoppingBasket,
  Info,
  ArrowRight,
} from 'lucide-react-native';
import {
  useCategories,
  useBrandsList,
  useOriginsList,
  useInfiniteProducts,
  useProductsByIds,
  useRashanPack,
  useFeaturedProducts,
  useRashanSubscriptions,
  useUpdateSubscription,
  resolveImageUrl,
  type Product,
  type RashanFrequency,
} from '@grocery-app/shared';
import { colors } from '../../../src/constants/colors';
import { useLanguageStore } from '../../../src/stores/languageStore';
import { useRashanStore } from '../../../src/stores/rashanStore';
import ProductCard from '../../../src/components/ProductCard';
import { ProductGridSkeleton } from '../../../src/components/Skeleton';
import { dedupeById, dedupeProductIdentity } from '../../../src/lib/dedupe';

const FREQUENCIES: { id: RashanFrequency; label_es: string; label_en: string }[] = [
  { id: 'biweekly', label_es: 'Cada 2 semanas', label_en: 'Every 2 weeks' },
  { id: 'monthly', label_es: 'Cada mes', label_en: 'Every month' },
  { id: 'every_6_weeks', label_es: 'Cada 6 semanas', label_en: 'Every 6 weeks' },
];

function ItemRow({
  productId,
  variantId,
  quantity,
  product,
}: {
  productId: string;
  variantId: string;
  quantity: number;
  product: Product | undefined;
}) {
  const { lang, t } = useLanguageStore();
  const setQty = useRashanStore((s) => s.setItemQuantity);
  const setVariant = useRashanStore((s) => s.setItemVariant);
  const removeItem = useRashanStore((s) => s.removeItem);

  if (!product) return null;
  const variant = product.variants?.find((v) => v.id === variantId);
  const image = product.images?.find((i) => i.is_primary) ?? product.images?.[0];
  const name = lang === 'en' ? product.name_en : product.name_es;
  const lineTotal = Number(variant?.price ?? 0) * quantity;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
      <View style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: colors.surface.linen, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
        {image ? (
          <Image source={{ uri: resolveImageUrl(image.url, 'thumb') }} style={{ width: 56, height: 56 }} />
        ) : (
          <Text style={{ fontSize: 26 }}>📦</Text>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>
          {name}
        </Text>
        {!!product.brand && (
          <Text style={{ fontSize: 11, color: colors.muted }}>{product.brand}</Text>
        )}
        {(product.variants?.length ?? 0) > 1 && (
          <View style={{ flexDirection: 'row', marginTop: 6, gap: 4, flexWrap: 'wrap' }}>
            {product.variants!.map((v) => (
              <Pressable
                key={v.id}
                onPress={() => setVariant(productId, v.id)}
                style={{
                  paddingHorizontal: 8,
                  height: 24,
                  borderRadius: 6,
                  justifyContent: 'center',
                  backgroundColor: v.id === variantId ? colors.ink : colors.surface.linen,
                }}
              >
                <Text style={{ fontSize: 10, fontWeight: '700', color: v.id === variantId ? '#fff' : colors.gray }}>
                  {lang === 'en' ? v.name_en : v.name_es}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surface.linen, borderRadius: 999, padding: 3 }}>
          <Pressable onPress={() => setQty(productId, quantity - 1)} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
            <Minus size={12} color={colors.ink} strokeWidth={2.25} />
          </Pressable>
          <Text style={{ minWidth: 18, textAlign: 'center', fontSize: 13, fontWeight: '700', color: colors.ink }}>{quantity}</Text>
          <Pressable onPress={() => setQty(productId, quantity + 1)} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center' }}>
            <Plus size={12} color="#fff" strokeWidth={2.25} />
          </Pressable>
        </View>
        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>
          {'€'}{lineTotal.toFixed(2)}
        </Text>
        <Pressable onPress={() => removeItem(productId)} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Trash2 size={11} color={colors.muted} strokeWidth={2} />
          <Text style={{ fontSize: 10, fontWeight: '600', color: colors.muted }}>
            {t('rashan.builder.remove')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Four things the customer has not added yet, offered right under the pack
 * they are building. Web has had this since the builder shipped; mobile never
 * did, so the only way to add anything was to open the full picker.
 */
function SuggestionsRow({ items }: { items: Product[] }) {
  const { lang, t } = useLanguageStore();
  const addItem = useRashanStore((s) => s.addItem);

  if (items.length === 0) return null;

  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <Sparkles size={15} color={colors.amber.deep} strokeWidth={2} />
        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>
          {lang === 'en' ? 'You might also want' : 'También te puede interesar'}
        </Text>
      </View>

      <FlatList
        data={items}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10 }}
        keyExtractor={(p) => p.id}
        renderItem={({ item: p }) => {
          const variant = p.variants?.find((v) => v.is_default) ?? p.variants?.[0];
          const image = p.images?.find((i) => i.is_primary) ?? p.images?.[0];
          const name = lang === 'en' ? p.name_en : p.name_es;
          return (
            <View style={{
              width: 132, borderRadius: 12, padding: 10,
              backgroundColor: colors.surface.cream,
              borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
            }}>
              <View style={{ width: '100%', aspectRatio: 1, borderRadius: 8, backgroundColor: colors.surface.linen, overflow: 'hidden', marginBottom: 8 }}>
                {image && (
                  <Image
                    source={{ uri: resolveImageUrl(image.url, 'thumb') }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                )}
              </View>
              <Text style={{ fontSize: 11.5, fontWeight: '700', color: colors.ink, lineHeight: 15, minHeight: 30 }} numberOfLines={2}>
                {name}
              </Text>
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink, marginTop: 3 }}>
                {'€'}{Number(variant?.price ?? 0).toFixed(2)}
              </Text>
              <Pressable
                onPress={() => {
                  if (!variant) return;
                  addItem({ product_id: p.id, variant_id: variant.id, quantity: 1 });
                }}
                disabled={!variant}
                style={({ pressed }) => ({
                  marginTop: 8, height: 32, borderRadius: 8,
                  backgroundColor: colors.brand.mist,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
                  opacity: !variant ? 0.5 : pressed ? 0.7 : 1,
                })}
              >
                <Plus size={13} color={colors.brand.deepest} strokeWidth={2.5} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.brand.deepest }}>
                  {t('rashan.builder.add_items')}
                </Text>
              </Pressable>
            </View>
          );
        }}
      />
    </View>
  );
}

/**
 * A filter chip that opens its options in a sheet.
 *
 * Web renders these as dropdowns with a search box, because a brand list runs
 * to hundreds. Same problem here, so the sheet gets the same search box and a
 * capped height rather than a picker wheel that cannot be filtered.
 */
function FilterChip({
  label, value, options, onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const { lang } = useLanguageStore();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const active = value !== '';
  const current = options.find((o) => o.value === value);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [q, options]);

  return (
    <>
      <Pressable
        onPress={() => { setQ(''); setOpen(true); }}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 5,
          paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
          borderWidth: 1,
          borderColor: active ? colors.brand.DEFAULT : colors.border,
          backgroundColor: active ? colors.brand.whisper : colors.surface.cream,
        }}
      >
        <Text style={{ fontSize: 12.5, fontWeight: '600', color: active ? colors.brand.DEFAULT : colors.gray }} numberOfLines={1}>
          {active ? current?.label ?? label : label}
        </Text>
        <ChevronDown size={13} color={active ? colors.brand.DEFAULT : colors.muted} strokeWidth={2} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{ backgroundColor: colors.surface.cream, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%', paddingBottom: 20 }}
          >
            <View style={{ padding: 18, paddingBottom: 10 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 12 }}>{label}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', height: 42, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface.linen, paddingHorizontal: 10 }}>
                <Search size={15} color={colors.muted} strokeWidth={2} />
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder={lang === 'en' ? 'Search…' : 'Buscar…'}
                  placeholderTextColor={colors.muted}
                  style={{ flex: 1, marginLeft: 7, fontSize: 14, color: colors.ink, paddingVertical: 0 }}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>
            <FlatList
              data={shown}
              keyExtractor={(o) => o.value || '__all__'}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 18 }}
              renderItem={({ item }) => {
                const on = item.value === value;
                return (
                  <Pressable
                    onPress={() => { onChange(item.value); setOpen(false); }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border }}
                  >
                    <Text style={{ flex: 1, fontSize: 14, fontWeight: on ? '700' : '400', color: on ? colors.brand.DEFAULT : colors.ink }}>
                      {item.label}
                    </Text>
                    {on && <Check size={16} color={colors.brand.DEFAULT} strokeWidth={2.5} />}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * Pack item picker.
 *
 * This used to receive one `useProducts({ limit: 60 })` page and filter it in
 * memory, which is the bug web fixed in ea64cfc: a 60-row page read as a
 * 60-product shop, and nothing past it could be added to a pack at all. It now
 * queries the server per keystroke (debounced) and pages as you scroll, with
 * the same category / brand / origin filters web offers.
 *
 * Web also has a Store filter. It is not here: mobile sells the whole
 * catalogue but has no storefront surface until multi-vendor, so a store
 * dimension would be the only place in the app that exposed one.
 */
function AddItemsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { lang, t } = useLanguageStore();
  const draftItems = useRashanStore((s) => s.draft?.items ?? []);
  const addItem = useRashanStore((s) => s.addItem);
  const removeItem = useRashanStore((s) => s.removeItem);
  const setItemQuantity = useRashanStore((s) => s.setItemQuantity);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brand, setBrand] = useState('');
  const [origin, setOrigin] = useState('');

  // Debounced so typing does not fire a request per character.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  const { data: categories } = useCategories();
  const { data: brands } = useBrandsList();
  const { data: origins } = useOriginsList();

  const {
    data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading,
  } = useInfiniteProducts({
    q: debouncedQuery || undefined,
    categoryId: categoryId || undefined,
    brand: brand || undefined,
    origin: origin || undefined,
    sort: 'name_asc',
    limit: 40,
  });

  // Two passes. dedupeById guards the pagination seam; dedupeProductIdentity
  // collapses the same item listed by different shops — 318 such groups in
  // this catalogue. Picking a line item for a recurring pack is not choosing a
  // seller, so five identical trays here are noise.
  const products = useMemo(
    () => dedupeProductIdentity(dedupeById((data?.pages ?? []).flatMap((page) => page.items))),
    [data],
  );
  // The server's count for the CURRENT filters, not how many rows have been
  // fetched so far. The old header reported the latter and called it the
  // catalogue size.
  const total = data?.pages?.[0]?.total ?? 0;

  const activeFilters = [categoryId, brand, origin].filter(Boolean).length;
  const clearFilters = () => { setCategoryId(''); setBrand(''); setOrigin(''); };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface.cream }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>
              {t('rashan.builder.add_items')}
            </Text>
            {!isLoading && (
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                {lang === 'en'
                  ? `${total} ${total === 1 ? 'product' : 'products'}`
                  : `${total} ${total === 1 ? 'producto' : 'productos'}`}
              </Text>
            )}
          </View>
          <Pressable onPress={onClose} hitSlop={10} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface.linen, alignItems: 'center', justifyContent: 'center' }}>
            <X size={18} color={colors.gray} strokeWidth={2} />
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.surface.cream, borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', height: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface.linen, paddingHorizontal: 12 }}>
            <Search size={17} color={colors.muted} strokeWidth={2} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('rashan.builder.search_placeholder')}
              placeholderTextColor={colors.muted}
              style={{ flex: 1, marginLeft: 8, fontSize: 14.5, color: colors.ink, paddingVertical: 0 }}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <X size={16} color={colors.muted} strokeWidth={2} />
              </Pressable>
            )}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingTop: 10 }}
            keyboardShouldPersistTaps="handled"
          >
            <FilterChip
              label={lang === 'en' ? 'Category' : 'Categoría'}
              value={categoryId}
              onChange={setCategoryId}
              options={[
                { value: '', label: lang === 'en' ? 'All categories' : 'Todas las categorías' },
                ...(categories ?? []).map((c) => ({ value: c.id, label: lang === 'en' ? c.name_en : c.name_es })),
              ]}
            />
            <FilterChip
              label={lang === 'en' ? 'Brand' : 'Marca'}
              value={brand}
              onChange={setBrand}
              options={[
                { value: '', label: lang === 'en' ? 'All brands' : 'Todas las marcas' },
                ...(brands ?? []).map((b) => ({ value: b.name, label: b.name })),
              ]}
            />
            <FilterChip
              label={lang === 'en' ? 'Origin' : 'Origen'}
              value={origin}
              onChange={setOrigin}
              options={[
                { value: '', label: lang === 'en' ? 'All origins' : 'Todos los orígenes' },
                ...(origins ?? []).map((o) => ({ value: o.key, label: lang === 'en' ? o.label_en : o.label_es })),
              ]}
            />
            {activeFilters > 0 && (
              <Pressable
                onPress={clearFilters}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface.linen }}
              >
                <X size={12} color={colors.gray} strokeWidth={2.5} />
                <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.gray }}>
                  {lang === 'en' ? 'Clear' : 'Limpiar'}
                </Text>
              </Pressable>
            )}
          </ScrollView>
        </View>

        {isLoading ? (
          <ProductGridSkeleton count={6} />
        ) : products.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
            <ShoppingBasket size={30} color={colors.muted} strokeWidth={1.5} />
            <Text style={{ fontSize: 14, color: colors.gray, textAlign: 'center', marginTop: 12, lineHeight: 20 }}>
              {lang === 'en'
                ? 'Nothing matches those filters.'
                : 'Nada coincide con esos filtros.'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={products}
            numColumns={2}
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12, paddingBottom: 30 }}
            onEndReachedThreshold={0.5}
            onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
            ListFooterComponent={
              isFetchingNextPage
                ? <View style={{ paddingVertical: 20 }}><ActivityIndicator color={colors.brand.DEFAULT} /></View>
                : null
            }
            renderItem={({ item: p }) => {
              const inPack = draftItems.find((i) => i.product_id === p.id);
              const variant = p.variants?.find((v) => v.is_default) ?? p.variants?.[0];
              return (
                // Exactly the home grid's wrapper. ProductCard's root is
                // `flex: 1`, which needs a parent of definite width — `width:
                // '50%'` gives it one. The earlier `flex: 1` wrapper inside a
                // row left the height ambiguous, so the card's border ended
                // after the image and the text spilled out below it.
                <View style={{ width: '50%', padding: 6 }}>
                  {/* The same card as every listing — only where its stepper
                      writes differs. `picker` swaps the cart for the pack
                      draft and stops the card navigating, which inside this
                      sheet would discard the draft being built. */}
                  <ProductCard
                    product={p}
                    picker={{
                      quantity: inPack?.quantity ?? 0,
                      onQuantityChange: (next) => {
                        if (!variant) return;
                        if (next <= 0) removeItem(p.id);
                        else if (!inPack) addItem({ product_id: p.id, variant_id: variant.id, quantity: next });
                        else setItemQuantity(p.id, next);
                      },
                    }}
                  />
                </View>
              );
            }}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

export default function RashanBuilderScreen() {
  // The continue bar is absolutely positioned at bottom: 0, and from SDK 54 the
  // app draws behind the system navigation, so bottom: 0 is UNDER it. Without
  // the inset the button sits beneath Android's 48dp three-button bar and
  // cannot be tapped at all.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const packSlug = id;
  const editingId = typeof edit === 'string' ? edit : undefined;
  const { t, lang } = useLanguageStore();

  const draft = useRashanStore((s) => s.draft);
  const initDraft = useRashanStore((s) => s.initDraft);
  const setHousehold = useRashanStore((s) => s.setHousehold);
  const setFrequency = useRashanStore((s) => s.setFrequency);

  const { data: tpl } = useRashanPack(packSlug);
  const { data: subs } = useRashanSubscriptions();
  // Featured products the draft does not already contain. Same source and cap
  // as web, so the two builders suggest from the same pool.
  const { data: featuredSuggestions } = useFeaturedProducts(12);
  // Pack items are resolved BY ID instead of being looked up in the page
  // above. The API caps a page at 60, so an item outside it used to render as
  // a blank row and price as €0 in the subtotal.
  const { data: itemProducts } = useProductsByIds(
    useMemo(() => (draft?.items ?? []).map((i) => i.product_id), [draft]),
  );
  const productById = useMemo(
    () => new Map((itemProducts ?? []).map((p) => [p.id, p])),
    [itemProducts],
  );

  const suggestions = useMemo(() => {
    if (!draft) return [] as Product[];
    const inDraft = new Set(draft.items.map((i) => i.product_id));
    return (featuredSuggestions ?? []).filter((p) => !inDraft.has(p.id)).slice(0, 4);
  }, [draft, featuredSuggestions]);
  const updateSub = useUpdateSubscription();

  const editingSub = editingId ? subs?.find((s) => s.id === editingId) : null;
  const isEditMode = !!editingSub;

  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (isEditMode && editingSub && (!draft || draft.packSlug !== editingSub.pack_slug)) {
      initDraft(editingSub.pack_slug ?? 'custom', {
        items: editingSub.items,
        household: editingSub.household,
        frequency: editingSub.frequency,
      });
      return;
    }
    if (!isEditMode && tpl && (!draft || draft.packSlug !== tpl.slug)) {
      initDraft(tpl.slug, {
        items: tpl.items,
        household: tpl.household_default,
        frequency: 'monthly',
      });
    }
  }, [isEditMode, editingSub, tpl, draft, initDraft]);

  if (!tpl || !draft) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={colors.brand.DEFAULT} />
        </View>
      </SafeAreaView>
    );
  }

  const subtotal = draft.items.reduce((sum, it) => {
    const p = productById.get(it.product_id);
    const v = p?.variants?.find((x) => x.id === it.variant_id);
    return sum + Number(v?.price ?? 0) * it.quantity;
  }, 0);
  const savingsAmount = (subtotal * tpl.estimated_savings_pct) / 100;
  const total = Math.max(0, subtotal - savingsAmount);
  const isEmpty = draft.items.length === 0;

  const gradient: [string, string] = tpl.slug === 'premium'
    ? ['#3E2723', '#8D6E63']
    : tpl.slug === 'essentials'
      ? ['#022B91', '#2A6AEF']
      : ['#D8B27C', '#E8CDA3'];

  const handleContinue = async () => {
    if (isEmpty) return;
    if (isEditMode && editingSub) {
      try {
        await updateSub.mutateAsync({
          id: editingSub.id,
          payload: {
            items: draft.items,
            household: draft.household,
            frequency: draft.frequency,
          },
        });
        router.replace('/rashan/subscription');
      } catch {
        // surfaced via mutation state; could add a toast in future
      }
      return;
    }
    router.push('/rashan/checkout');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {/* Web names the destination — subscription when editing, packs
            otherwise. Keep the platform back gesture when there IS history,
            but fall back to the same explicit target: arriving here from a
            cesto:// deep link leaves nothing to go back to. */}
        <Pressable
          onPress={() => {
            if (router.canGoBack()) { router.back(); return; }
            router.replace(isEditMode ? '/rashan/subscription' : '/(tabs)/rashan');
          }}
          style={{ width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' }}
        >
          <ChevronLeft size={22} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.ink }}>
          {lang === 'en' ? tpl.name_en : tpl.name_es}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 140 + insets.bottom }}>
        {isEditMode && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.amber.mist, borderRadius: 14, borderWidth: 1, borderColor: colors.amber.mid, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }}>
            <ShoppingBasket size={16} color={colors.amber.deep} strokeWidth={2} />
            <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', color: colors.ink, lineHeight: 17 }}>
              {lang === 'en'
                ? 'Editing your active subscription — changes apply from the next delivery.'
                : 'Editando tu suscripción activa — los cambios se aplicarán en la próxima entrega.'}
            </Text>
          </View>
        )}

        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 8, padding: 20, marginBottom: 16 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {/* The uploaded cover when the pack has one, same precedence as
                every other render site; emoji is the fallback for packs that
                predate covers. Web frames it as a panel beside the title. */}
            {tpl.cover_url ? (
              <Image
                source={{ uri: resolveImageUrl(tpl.cover_url, 'tile') }}
                style={{ width: 62, height: 62, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.2)' }}
                resizeMode="cover"
              />
            ) : (
              <Text style={{ fontSize: 46 }}>{tpl.emoji}</Text>
            )}
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.8)', letterSpacing: 1.5 }}>
                {(lang === 'en' ? tpl.badge_en : tpl.badge_es) ?? ''}
              </Text>
              <Text style={{ fontSize: 22, fontWeight: '700', color: '#fff', marginTop: 2 }}>
                {lang === 'en' ? tpl.name_en : tpl.name_es}
              </Text>
            </View>
          </View>
          {!!(tpl.description_en || tpl.description_es) && (
            <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 10, lineHeight: 17 }}>
              {(lang === 'en' ? tpl.description_en : tpl.description_es) ?? ''}
            </Text>
          )}
        </LinearGradient>

        {/* Items */}
        <View style={{ backgroundColor: colors.surface.cream, borderRadius: 8, padding: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <View>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>
                {t('rashan.builder.your_pack')}
              </Text>
              <Text style={{ fontSize: 11, color: colors.muted }}>
                {draft.items.length} {t('rashan.builder.items')}
              </Text>
            </View>
            <Pressable
              onPress={() => setDrawerOpen(true)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.brand.mist, paddingHorizontal: 12, height: 34, borderRadius: 999 }}
            >
              <Plus size={12} color={colors.brand.deepest} strokeWidth={2.5} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.brand.deepest }}>
                {isEmpty ? t('rashan.builder.add_items') : t('rashan.builder.add_more')}
              </Text>
            </Pressable>
          </View>
          {isEmpty ? (
            <View style={{ alignItems: 'center', paddingVertical: 30 }}>
              <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brand.mist, justifyContent: 'center', alignItems: 'center', marginBottom: 14 }}>
                <ShoppingBasket size={28} color={colors.brand.DEFAULT} strokeWidth={1.5} />
              </View>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>
                {t('rashan.builder.empty_title')}
              </Text>
              <Text style={{ fontSize: 12, color: colors.gray, marginTop: 4, textAlign: 'center', paddingHorizontal: 20 }}>
                {t('rashan.builder.empty_desc')}
              </Text>
            </View>
          ) : (
            draft.items.map((it) => (
              <ItemRow
                key={it.product_id}
                productId={it.product_id}
                variantId={it.variant_id}
                quantity={it.quantity}
                product={productById.get(it.product_id)}
              />
            ))
          )}
        </View>

        {/* Smart suggestions — sits under the item list, as on web. */}
        <SuggestionsRow items={suggestions} />

        {/* Household */}
        <View style={{ backgroundColor: colors.surface.cream, borderRadius: 8, padding: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Users size={13} color={colors.charcoal} strokeWidth={2} />
            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.charcoal, letterSpacing: 1.2 }}>
              {t('rashan.builder.household').toUpperCase()}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface.linen, borderRadius: 12, padding: 4 }}>
            <Pressable onPress={() => setHousehold(draft.household - 1)} style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
              <Minus size={14} color={colors.ink} strokeWidth={2.25} />
            </Pressable>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>
              {draft.household} {draft.household === 1 ? (lang === 'en' ? 'person' : 'persona') : (lang === 'en' ? 'people' : 'personas')}
            </Text>
            <Pressable onPress={() => setHousehold(draft.household + 1)} style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
              <Plus size={14} color={colors.ink} strokeWidth={2.25} />
            </Pressable>
          </View>
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 8 }}>
            {t('rashan.builder.household_help', { count: draft.household })}
          </Text>
        </View>

        {/* Frequency */}
        <View style={{ backgroundColor: colors.surface.cream, borderRadius: 8, padding: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <Repeat size={13} color={colors.charcoal} strokeWidth={2} />
            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.charcoal, letterSpacing: 1.2 }}>
              {t('rashan.builder.frequency').toUpperCase()}
            </Text>
          </View>
          <View style={{ gap: 6 }}>
            {FREQUENCIES.map((f) => {
              const active = draft.frequency === f.id;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => setFrequency(f.id)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 14,
                    height: 44,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: active ? colors.brand.DEFAULT : colors.border,
                    backgroundColor: active ? colors.brand.mist : colors.surface.cream,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '700', color: active ? colors.brand.deepest : colors.charcoal }}>
                    {lang === 'en' ? f.label_en : f.label_es}
                  </Text>
                  {active && <Check size={14} color={colors.brand.deepest} strokeWidth={3} />}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Summary */}
        <View style={{ backgroundColor: colors.surface.cream, borderRadius: 8, padding: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
            <Text style={{ fontSize: 13, color: colors.gray }}>{t('rashan.builder.subtotal')}</Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>{'€'}{subtotal.toFixed(2)}</Text>
          </View>
          {savingsAmount > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
              <Text style={{ fontSize: 13, color: colors.brand.DEFAULT, fontWeight: '600' }}>
                {t('rashan.builder.savings')} ({tpl.estimated_savings_pct}%)
              </Text>
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.brand.DEFAULT }}>
                −{'€'}{savingsAmount.toFixed(2)}
              </Text>
            </View>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
            <Text style={{ fontSize: 13, color: colors.gray }}>{t('rashan.builder.delivery')}</Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.brand.DEFAULT }}>{t('rashan.builder.free')}</Text>
          </View>
          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 8 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={{ fontSize: 13, color: colors.gray }}>{t('rashan.builder.total')}</Text>
            <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>{'€'}{total.toFixed(2)}</Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', backgroundColor: colors.brand.whisper, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: colors.brand.mist, gap: 10 }}>
          <Info size={15} color={colors.brand.DEFAULT} strokeWidth={2} />
          <Text style={{ flex: 1, fontSize: 12, color: colors.charcoal, lineHeight: 17 }}>
            {t('rashan.checkout.no_charge')}
          </Text>
        </View>
      </ScrollView>

      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 16), backgroundColor: colors.surface.cream, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Pressable
          onPress={handleContinue}
          disabled={isEmpty || updateSub.isPending}
          style={{
            height: 52,
            borderRadius: 12,
            backgroundColor: isEmpty ? colors.muted : colors.brand.DEFAULT,
            justifyContent: 'center',
            alignItems: 'center',
            flexDirection: 'row',
            gap: 8,
            opacity: isEmpty || updateSub.isPending ? 0.6 : 1,
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
            {updateSub.isPending
              ? '…'
              : isEditMode
                ? lang === 'en' ? 'Save changes' : 'Guardar cambios'
                : t('rashan.builder.continue')}
          </Text>
          {!updateSub.isPending && (
            isEditMode
              ? <Check size={16} color="#fff" strokeWidth={2.5} />
              : <ArrowRight size={16} color="#fff" strokeWidth={2.5} />
          )}
        </Pressable>
        {isEmpty && (
          <Text style={{ fontSize: 11, color: colors.amber.deep, marginTop: 8, textAlign: 'center' }}>
            {t('rashan.builder.min_warning')}
          </Text>
        )}
      </View>

      <AddItemsModal visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </SafeAreaView>
  );
}
