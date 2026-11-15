import { useMemo, useState } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Search, X, ChevronRight, AlertTriangle, ClipboardList } from 'lucide-react-native';
import { usePartnerOrders, type PartnerOrdersListParams, type Order } from '@grocery-app/shared';
import { colors } from '@/constants/colors';
import { orderStatusMeta } from '@/constants/orderStatus';
import { useLanguageStore } from '@/stores/languageStore';
import { usePartnerT } from '@/partner/lib/i18n';
import Skeleton from '@/components/Skeleton';
import { PartnerTabBar } from '@/partner/components/ui';

/**
 * Partner orders.
 *
 * The screen a shop lives in, so it opens on everything rather than on a
 * filter, and the filter row is one horizontal scroll of chips instead of
 * web's dropdown toolbar — a status change is one tap, not three.
 *
 * Search is client-side over the fetched page. The endpoint takes `q`, but
 * firing a request per keystroke against a partner's whole order history is a
 * poor trade on mobile data when the list in hand is already what they are
 * looking at. If a partner ever needs to find an order older than the current
 * page, that is the point to move it server-side.
 */

type StatusFilter = NonNullable<PartnerOrdersListParams['status']> | 'all';

const FILTERS: StatusFilter[] = [
  'all', 'pending', 'confirmed', 'preparing', 'on_the_way', 'delivered', 'cancelled',
];

export default function PartnerOrders() {
  const t = usePartnerT();
  const router = useRouter();
  const { lang } = useLanguageStore();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');

  const params: PartnerOrdersListParams = status === 'all' ? {} : { status };
  const orders = usePartnerOrders(params);

  const filtered = useMemo(() => {
    const list = orders.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((o) =>
      o.order_number?.toLowerCase().includes(q) ||
      o.user?.name?.toLowerCase().includes(q),
    );
  }, [orders.data, query]);

  const searching = query.trim().length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.linen }}>
      <PartnerTabBar title={t('orders.title')} />
      {/* Search + filters stay pinned; only the list scrolls. On a screen whose
          whole job is filtering, the controls should not scroll away. */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 12, backgroundColor: colors.surface.linen }}>

        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          backgroundColor: colors.surface.cream, borderRadius: 12,
          borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, height: 44,
        }}>
          <Search size={17} color={colors.muted} strokeWidth={2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('orders.searchPlaceholder')}
            placeholderTextColor={colors.muted}
            style={{ flex: 1, fontSize: 14, color: colors.ink, padding: 0 }}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searching && (
            <Pressable onPress={() => setQuery('')} hitSlop={10}>
              <X size={16} color={colors.muted} strokeWidth={2.25} />
            </Pressable>
          )}
        </View>

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTERS}
          keyExtractor={(f) => f}
          contentContainerStyle={{ gap: 8, paddingRight: 8 }}
          renderItem={({ item }) => {
            const on = item === status;
            return (
              <Pressable
                onPress={() => setStatus(item)}
                style={{
                  paddingHorizontal: 14, height: 34, borderRadius: 999,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: on ? colors.brand.DEFAULT : colors.surface.cream,
                  borderWidth: 1, borderColor: on ? colors.brand.DEFAULT : colors.border,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: on ? '#FFFFFF' : colors.gray }}>
                  {t(`orders.filter.${item}`)}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      {orders.isError ? (
        <Centered>
          <AlertTriangle size={22} color={colors.danger} strokeWidth={2} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{t('orders.loadFailed')}</Text>
          <Pressable
            onPress={() => void orders.refetch()}
            style={{ minHeight: 44, paddingHorizontal: 20, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>{t('orders.retry')}</Text>
          </Pressable>
        </Centered>
      ) : orders.isLoading ? (
        <View style={{ padding: 16, gap: 10 }}>
          {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={76} borderRadius={12} />)}
        </View>
      ) : filtered.length === 0 ? (
        <Centered>
          <ClipboardList size={26} color={colors.muted} strokeWidth={1.75} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>
            {searching || status !== 'all' ? t('orders.emptyFiltered') : t('orders.empty')}
          </Text>
          <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', maxWidth: 260 }}>
            {searching || status !== 'all' ? t('orders.emptyFilteredHint') : t('orders.emptyHint')}
          </Text>
          {(searching || status !== 'all') && (
            <Pressable
              onPress={() => { setQuery(''); setStatus('all'); }}
              style={{ minHeight: 44, paddingHorizontal: 20, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>{t('orders.clearSearch')}</Text>
            </Pressable>
          )}
        </Centered>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: 16, paddingTop: 6, gap: 10, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              refreshing={orders.isRefetching}
              onRefresh={() => void orders.refetch()}
              tintColor={colors.brand.DEFAULT}
            />
          }
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              lang={lang}
              t={t}
              onPress={() => router.push(`/partner-order/${item.id}`)}
            />
          )}
        />
      )}
    </View>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 }}>
      {children}
    </View>
  );
}

/**
 * A card, not a table row. The four things a partner needs before opening an
 * order are who it's for, how much, what state it's in, and whether a rider is
 * on it — which is more than fits on one line at a readable size.
 */
function OrderCard({
  order, lang, t, onPress,
}: {
  order: Order & { _count?: { items: number } };
  lang: 'en' | 'es';
  t: (k: string) => string;
  onPress: () => void;
}) {
  const meta = orderStatusMeta(order.status);
  const rider = (order as { rider?: { name: string } | null }).rider;
  const itemCount = order._count?.items ?? order.items?.length ?? 0;

  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: colors.surface.cream, borderRadius: 12, padding: 14,
        borderWidth: 1, borderColor: colors.border, gap: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }} numberOfLines={1}>
            {order.user?.name ?? order.order_number}
          </Text>
          {/* Order number in mono — it is a reference someone reads aloud on
              the phone, and tabular digits stop 8 and 3 blurring together. */}
          <Text style={{ fontSize: 11.5, color: colors.muted, fontFamily: 'JetBrainsMono' }}>
            {order.order_number}
          </Text>
        </View>
        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: meta.bg }}>
          <Text style={{ fontSize: 10.5, fontWeight: '700', color: meta.text }}>
            {lang === 'es' ? meta.label_es : meta.label_en}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, letterSpacing: -0.4 }}>
          {'€'}{Number(order.total ?? 0).toFixed(2)}
        </Text>
        <Text style={{ fontSize: 12.5, color: colors.muted, flex: 1 }} numberOfLines={1}>
          {itemCount} {t('orders.items')}
          {rider ? ` · ${rider.name}` : ` · ${t('orders.noRider')}`}
        </Text>
        <ChevronRight size={16} color={colors.muted} strokeWidth={2} />
      </View>
    </Pressable>
  );
}
