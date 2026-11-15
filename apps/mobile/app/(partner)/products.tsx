import { useMemo, useState } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput, Image, RefreshControl, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Search, X, Plus, SlidersHorizontal, AlertTriangle, Package } from 'lucide-react-native';
import {
  usePartnerProducts, resolveImageUrl,
  type PartnerProductsListParams, type Product,
} from '@grocery-app/shared';
import { colors } from '@/constants/colors';
import { useLanguageStore } from '@/stores/languageStore';
import { usePartnerT } from '@/partner/lib/i18n';
import Skeleton from '@/components/Skeleton';
import { PartnerTabBar } from '@/partner/components/ui';

/**
 * Partner products.
 *
 * Web puts eight filter dropdowns in a toolbar above a table. On a phone that
 * toolbar would occupy most of the screen before a single product appeared, so
 * this is search-first: the two filters a shopkeeper actually reaches for
 * (status and stock) are chips, and the taxonomy filters — category,
 * subcategory, type, brand, origin — are not here at all.
 *
 * Leaving them out is deliberate rather than pending. They exist on web to
 * narrow a table of hundreds of rows; on a phone, typing two letters of the
 * product name gets there faster than five dependent dropdowns, each of which
 * needs its own fetch and its own empty state.
 */

type StatusFilter = 'all' | 'active' | 'inactive';
type StockFilter = 'all' | 'in' | 'low' | 'out';

const PAGE_SIZE = 30;

export default function PartnerProducts() {
  const t = usePartnerT();
  const router = useRouter();
  const { lang } = useLanguageStore();

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [stock, setStock] = useState<StockFilter>('all');
  const [sheet, setSheet] = useState(false);
  const [page, setPage] = useState(1);

  // Search goes to the server here, unlike orders: a store can hold thousands
  // of products and the page in hand is only thirty of them, so filtering
  // locally would search the wrong set.
  const params: PartnerProductsListParams = useMemo(() => ({
    q: query.trim() || undefined,
    isActive: status === 'all' ? undefined : status === 'active' ? 'true' : 'false',
    stock: stock === 'all' ? undefined : stock,
    limit: PAGE_SIZE,
    page,
  }), [query, status, stock, page]);

  const products = usePartnerProducts(params);

  const items = products.data?.items ?? [];
  const total = products.data?.total ?? 0;
  const totalPages = products.data?.totalPages ?? 1;
  const filtered = status !== 'all' || stock !== 'all' || query.trim().length > 0;
  const activeFilterCount = (status !== 'all' ? 1 : 0) + (stock !== 'all' ? 1 : 0);

  const reset = () => { setQuery(''); setStatus('all'); setStock('all'); setPage(1); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.linen }}>
      <PartnerTabBar
        title={t('productsM.title')}
        right={(
          <Pressable
            onPress={() => router.push('/partner-product/new')}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              height: 36, paddingHorizontal: 12, borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.14)',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.20)',
            }}
          >
            <Plus size={15} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF' }}>
              {t('products.addProduct')}
            </Text>
          </Pressable>
        )}
      />
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{
            flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
            backgroundColor: colors.surface.cream, borderRadius: 12,
            borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 44,
          }}>
            <Search size={17} color={colors.muted} strokeWidth={2} />
            <TextInput
              value={query}
              onChangeText={(v) => { setQuery(v); setPage(1); }}
              placeholder={t('productsM.searchPlaceholder')}
              placeholderTextColor={colors.muted}
              style={{ flex: 1, fontSize: 14, color: colors.ink, padding: 0 }}
              returnKeyType="search"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <Pressable onPress={() => { setQuery(''); setPage(1); }} hitSlop={10}>
                <X size={16} color={colors.muted} strokeWidth={2.25} />
              </Pressable>
            )}
          </View>

          <Pressable
            onPress={() => setSheet(true)}
            style={{
              width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              backgroundColor: activeFilterCount > 0 ? colors.brand.DEFAULT : colors.surface.cream,
              borderWidth: 1, borderColor: activeFilterCount > 0 ? colors.brand.DEFAULT : colors.border,
            }}
          >
            <SlidersHorizontal size={18} color={activeFilterCount > 0 ? '#FFFFFF' : colors.gray} strokeWidth={2} />
            {activeFilterCount > 0 && (
              <View style={{
                position: 'absolute', top: -4, right: -4, minWidth: 17, height: 17, borderRadius: 999,
                backgroundColor: colors.amber.DEFAULT, alignItems: 'center', justifyContent: 'center',
                paddingHorizontal: 4,
              }}>
                <Text style={{ fontSize: 10, fontWeight: '800', color: colors.ink }}>{activeFilterCount}</Text>
              </View>
            )}
          </Pressable>
        </View>

        {total > 0 && (
          <Text style={{ fontSize: 12, color: colors.muted }}>
            {t('productsM.showing')} {items.length} {t('productsM.of')} {total}
          </Text>
        )}
      </View>

      {products.isError ? (
        <Centered>
          <AlertTriangle size={22} color={colors.danger} strokeWidth={2} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{t('productsM.loadFailed')}</Text>
          <Action label={t('productsM.retry')} onPress={() => void products.refetch()} />
        </Centered>
      ) : products.isLoading ? (
        <View style={{ padding: 16, gap: 10 }}>
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={74} borderRadius={12} />)}
        </View>
      ) : items.length === 0 ? (
        <Centered>
          <Package size={26} color={colors.muted} strokeWidth={1.75} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>
            {filtered ? t('productsM.emptyFiltered') : t('productsM.empty')}
          </Text>
          <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', maxWidth: 260 }}>
            {filtered ? t('productsM.emptyFilteredHint') : t('productsM.emptyHint')}
          </Text>
          <Action
            label={filtered ? t('productsM.clear') : t('products.addProduct')}
            onPress={filtered ? reset : () => router.push('/partner-product/new')}
          />
        </Centered>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 10, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={products.isRefetching} onRefresh={() => void products.refetch()} tintColor={colors.brand.DEFAULT} />
          }
          renderItem={({ item }) => (
            <ProductRow
              product={item}
              lang={lang}
              t={t}
              onPress={() => router.push(`/partner-product/${item.id}`)}
            />
          )}
          ListFooterComponent={
            page < totalPages ? (
              <Pressable
                onPress={() => setPage((p) => p + 1)}
                style={{
                  marginTop: 6, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: colors.surface.cream, borderWidth: 1, borderColor: colors.border,
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.brand.DEFAULT }}>
                  {t('productsM.loadMore')}
                </Text>
              </Pressable>
            ) : null
          }
        />
      )}

      <FilterSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        t={t}
        status={status}
        stock={stock}
        onStatus={(v) => { setStatus(v); setPage(1); }}
        onStock={(v) => { setStock(v); setPage(1); }}
        onClear={reset}
      />
    </View>
  );
}

/* ── pieces ─────────────────────────────────────────────── */

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 }}>{children}</View>;
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ minHeight: 44, paddingHorizontal: 20, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>{label}</Text>
    </Pressable>
  );
}

/**
 * One row: thumbnail, name, price range, stock. Price and stock come from the
 * variants, because a product has no price of its own — and a partner scanning
 * this list is nearly always looking for "what is running out", which is why
 * stock gets colour and the price does not.
 */
function ProductRow({
  product, lang, t, onPress,
}: {
  product: Product; lang: 'en' | 'es'; t: (k: string) => string; onPress: () => void;
}) {
  const name = (lang === 'es' ? product.name_es : product.name_en) || product.name_es;
  const image = product.images?.[0]?.url;
  const variants = product.variants ?? [];

  const prices = variants.map((v) => Number(v.price)).filter((n) => Number.isFinite(n));
  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;

  const totalStock = variants.reduce((s, v) => s + (v.stock_quantity ?? 0), 0);
  const anyLow = variants.some((v) => (v.stock_quantity ?? 0) > 0 && (v.stock_quantity ?? 0) <= (v.low_stock_threshold ?? 0));
  const out = totalStock === 0;

  const stockColor = out ? colors.danger : anyLow ? colors.amber.deep : colors.gray;

  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        backgroundColor: colors.surface.cream, borderRadius: 12, padding: 10,
        borderWidth: 1, borderColor: colors.border,
        opacity: product.is_active ? 1 : 0.6,
      }}
    >
      <View style={{ width: 54, height: 54, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.surface.sand }}>
        {image ? (
          <Image source={{ uri: resolveImageUrl(image, 'thumb') }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Package size={18} color={colors.muted} strokeWidth={1.75} />
          </View>
        )}
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink, lineHeight: 18 }} numberOfLines={2}>
          {name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {min !== null && (
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>
              {'€'}{min.toFixed(2)}{max !== null && max !== min ? `–${max.toFixed(2)}` : ''}
            </Text>
          )}
          <Text style={{ fontSize: 11.5, color: colors.muted }}>
            {variants.length} {variants.length === 1 ? t('productsM.variant') : t('productsM.variants')}
          </Text>
        </View>
      </View>

      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: stockColor }}>
          {out ? t('productsM.noStock') : totalStock}
        </Text>
        {!product.is_active && (
          <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: colors.surface.sand }}>
            <Text style={{ fontSize: 9.5, fontWeight: '700', color: colors.muted }}>{t('productsM.inactive')}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function FilterSheet({
  visible, onClose, t, status, stock, onStatus, onStock, onClear,
}: {
  visible: boolean; onClose: () => void; t: (k: string) => string;
  status: StatusFilter; stock: StockFilter;
  onStatus: (v: StatusFilter) => void; onStock: (v: StockFilter) => void; onClear: () => void;
}) {
  const statusOpts: Array<[StatusFilter, string]> = [
    ['all', t('productsM.all')],
    ['active', t('productsM.filter.active')],
    ['inactive', t('productsM.filter.inactive')],
  ];
  const stockOpts: Array<[StockFilter, string]> = [
    ['all', t('productsM.all')],
    ['in', t('productsM.filter.inStock')],
    ['low', t('productsM.filter.lowStock')],
    ['out', t('productsM.filter.outOfStock')],
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' }} onPress={onClose} />
      <View style={{
        backgroundColor: colors.surface.cream,
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: 20, paddingBottom: 32, gap: 18,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{t('productsM.filters')}</Text>
          <Pressable onPress={onClose} hitSlop={10}><X size={19} color={colors.muted} strokeWidth={2} /></Pressable>
        </View>

        <ChipGroup label={t('products.table.status')} options={statusOpts} value={status} onChange={onStatus} />
        <ChipGroup label={t('products.table.stock')} options={stockOpts} value={stock} onChange={onStock} />

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            onPress={() => { onClear(); onClose(); }}
            style={{ flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border }}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.gray }}>{t('productsM.clear')}</Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            style={{ flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand.DEFAULT }}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>{t('productsM.apply')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ChipGroup<T extends string>({
  label, options, value, onChange,
}: {
  label: string; options: Array<[T, string]>; value: T; onChange: (v: T) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 11.5, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.muted }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map(([v, text]) => {
          const on = v === value;
          return (
            <Pressable
              key={v}
              onPress={() => onChange(v)}
              style={{
                paddingHorizontal: 14, height: 38, borderRadius: 999,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: on ? colors.brand.mist : colors.surface.linen,
                borderWidth: 1, borderColor: on ? colors.brand.DEFAULT : colors.border,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: on ? '700' : '500', color: on ? colors.brand.deepest : colors.gray }}>
                {text}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
