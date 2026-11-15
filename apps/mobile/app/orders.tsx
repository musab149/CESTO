import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { RefreshCw, ChevronRight, ShoppingBag, ChevronLeft, CalendarDays, Package, Store as StoreIcon, GitBranch } from 'lucide-react-native';
import { useInfiniteOrders, useReorder, type OrderListItem } from '@grocery-app/shared';
import { colors } from '../src/constants/colors';
import { orderStatusMeta, isActiveOrderStatus } from '../src/constants/orderStatus';
import { useLanguageStore } from '../src/stores/languageStore';
import { useAuthStore } from '../src/stores/authStore';
import { OrderListSkeleton } from '../src/components/Skeleton';
import { useDialog } from '../src/components/AppDialog';
import { useToast } from '../src/components/Toast';

function formatDate(dateStr: string, lang: 'en' | 'es'): string {
  return new Date(dateStr).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function OrdersScreen() {
  const router = useRouter();
  const dialog = useDialog();
  const toast = useToast();
  const { lang } = useLanguageStore();
  const { isAuthenticated } = useAuthStore();
  const {
    data, isLoading, refetch, isRefetching,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteOrders({ limit: 20 });
  const reorder = useReorder();
  // Flatten the infinite pages. A regular customer passes one page quickly, and
  // the list used to stop dead at whatever the first page held.
  const orders: OrderListItem[] = (data?.pages ?? []).flatMap((p) => p.items ?? []);

  const Header = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Pressable
        onPress={() => router.back()}
        style={({ pressed }) => ({
          width: 40, height: 40, borderRadius: 20,
          justifyContent: 'center', alignItems: 'center',
          backgroundColor: pressed ? colors.surface.sand : 'transparent',
        })}
      >
        <ChevronLeft size={22} color={colors.ink} strokeWidth={1.75} />
      </Pressable>
      <Text style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.ink }}>
        {lang === 'es' ? 'Mis Pedidos' : 'My Orders'}
      </Text>
      <View style={{ width: 40 }} />
    </View>
  );

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <Header />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.brand.mist, justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
            <ShoppingBag size={36} color={colors.brand.DEFAULT} strokeWidth={1.75} />
          </View>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink, marginBottom: 8, textAlign: 'center' }}>
            {lang === 'es' ? 'Inicia sesión para ver tus pedidos' : 'Log in to see your orders'}
          </Text>
          <Text style={{ fontSize: 14, color: colors.gray, textAlign: 'center', marginBottom: 24, lineHeight: 20 }}>
            {lang === 'es' ? 'Lleva un registro de todos tus pedidos y vuelve a pedir fácilmente.' : 'Keep track of all your orders and easily reorder.'}
          </Text>
          <Pressable
            onPress={() => router.push('/(auth)/login')}
            style={{ height: 52, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 }}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>
              {lang === 'es' ? 'Iniciar Sesión' : 'Log In'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const handleReorder = async (id: string) => {
    try {
      await reorder.mutateAsync(id);
      // Straight to the cart — the toast says what happened without making
      // them dismiss a dialog first to get there.
      toast.success(
        lang === 'es' ? 'Productos añadidos' : 'Items added',
        lang === 'es' ? 'Los productos están en tu cesta.' : 'Items are in your cart.',
      );
      router.push('/cart');
    } catch (err) {
      dialog.alert(
        lang === 'es' ? 'No se pudo repetir el pedido' : 'Could not reorder',
        err instanceof Error ? err.message : undefined,
        lang === 'es' ? 'Entendido' : 'OK',
      );
    }
  };

  const renderOrder = ({ item }: { item: OrderListItem }) => {
    const config = orderStatusMeta(item.status);
    const active = isActiveOrderStatus(item.status);
    const total = Number(item.total);
    // A parent row's own `_count` covers no items — the items live on its subs.
    const subs = item.sub_orders ?? [];
    const isParent = subs.length > 0;
    const itemsCount = isParent
      ? subs.reduce((n, sub) => n + (sub._count?.items ?? sub.items?.length ?? 0), 0)
      : item._count?.items ?? item.items?.length ?? 0;
    // Selling the whole catalogue means a cart can span stores, and a split
    // purchase surfaces as several rows. Without the seller's name they are
    // indistinguishable to the customer.
    const storeNames = isParent
      ? subs.map((sub) => sub.store?.name).filter((n): n is string => !!n)
      : item.store?.name ? [item.store.name] : [];

    return (
      <Pressable
        onPress={() => router.push(`/order/${item.id}`)}
        style={({ pressed }) => ({
          backgroundColor: colors.surface.cream,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: 'rgba(226,232,240,0.7)',
          marginBottom: 12,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        })}
      >
        <View style={{ padding: 16 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: config.text }} />
              <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 13, fontWeight: '700', color: colors.ink }}>
                {item.order_number}
              </Text>
            </View>
            <View style={{ backgroundColor: config.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: config.text }}>
                {lang === 'es' ? config.label_es : config.label_en}
              </Text>
            </View>
          </View>

          {(isParent || storeNames.length > 0) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
              {isParent ? (
                <GitBranch size={13} color={colors.muted} strokeWidth={1.75} />
              ) : (
                <StoreIcon size={13} color={colors.muted} strokeWidth={1.75} />
              )}
              <Text style={{ flex: 1, fontSize: 12, color: colors.muted }} numberOfLines={1}>
                {isParent
                  ? `${subs.length} ${lang === 'es' ? (subs.length === 1 ? 'tienda' : 'tiendas') : (subs.length === 1 ? 'store' : 'stores')}`
                    + (storeNames.length > 0 ? ` · ${storeNames.join(', ')}` : '')
                  : storeNames[0]}
              </Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <CalendarDays size={14} color={colors.muted} strokeWidth={1.75} />
              <Text style={{ fontSize: 13, color: colors.gray }}>
                {formatDate(item.created_at, lang)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Package size={14} color={colors.muted} strokeWidth={1.75} />
              <Text style={{ fontSize: 13, color: colors.gray }}>
                {itemsCount} {lang === 'es' ? 'artículos' : 'items'}
              </Text>
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 14 }} />

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, color: colors.muted, textTransform: 'uppercase' }}>
                {lang === 'es' ? 'Total' : 'Total'}
              </Text>
              <Text style={{ fontSize: 19, fontWeight: '700', color: colors.ink, marginTop: 1 }}>
                €{total.toFixed(2)}
              </Text>
            </View>
            {active ? (
              <Pressable
                onPress={() => router.push(`/order/${item.id}`)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brand.DEFAULT, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>
                  {lang === 'es' ? 'Rastrear' : 'Track'}
                </Text>
                <ChevronRight size={14} color="#fff" strokeWidth={2} />
              </Pressable>
            ) : item.status === 'delivered' && !isParent ? (
              <Pressable
                onPress={() => handleReorder(item.id)}
                disabled={reorder.isPending}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.brand.mist, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, opacity: reorder.isPending ? 0.6 : 1 }}
              >
                <RefreshCw size={14} color={colors.brand.deepest} strokeWidth={1.75} />
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.brand.deepest }}>
                  {lang === 'es' ? 'Repetir' : 'Reorder'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <Header />
      {isLoading ? (
        <OrderListSkeleton />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          renderItem={renderOrder}
          contentContainerStyle={{ padding: 16, flexGrow: 1 }}
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
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.brand.DEFAULT}
              colors={[colors.brand.DEFAULT]}
            />
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 60 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}>
                <ShoppingBag size={28} color={colors.muted} strokeWidth={1.5} />
              </View>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>
                {lang === 'es' ? 'Sin pedidos aún' : 'No orders yet'}
              </Text>
              <Text style={{ fontSize: 13, color: colors.muted, marginTop: 4 }}>
                {lang === 'es' ? 'Tus pedidos aparecerán aquí.' : 'Your orders will appear here.'}
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
