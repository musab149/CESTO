import { View, Text, ScrollView, Pressable, Image } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { ArrowLeft, Minus, Plus, Trash2, ShoppingBag, ArrowRight, Truck, Shield } from 'lucide-react-native';
import { useStoreSettings, useProductsByIds } from '@grocery-app/shared';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';
import { useCartStore, type FreshVariant } from '../src/stores/cartStore';

// Used only until the settings call lands, and if it never does. These were
// the hardcoded constants this screen shipped with, so an offline cart looks
// exactly as it did before rather than showing €0 delivery.
const FALLBACK_FEE = 3.5;

export default function CartScreen() {
  // This bar is absolutely positioned at bottom: 0, and from SDK 54 the app
  // draws behind the system navigation, so bottom: 0 is UNDER it. The old
  // hardcoded `paddingBottom: 34` was an iPhone home-indicator guess: it
  // happened to fit there and left the button half-hidden behind Android's
  // three-button bar, which is 48dp.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { lang, t } = useLanguageStore();
  const items = useCartStore((s) => s.items);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const getSubtotal = useCartStore((s) => s.getSubtotal);
  const getItemCount = useCartStore((s) => s.getItemCount);
  const syncPrices = useCartStore((s) => s.syncPrices);
  const { data: storeSettings } = useStoreSettings();

  // Re-price the basket against the catalogue. The lines are persisted with a
  // price snapshot, so without this a cart left overnight shows stale figures
  // and then disagrees with the server quote at checkout. Capped at 100 ids —
  // the same cap web uses — and disabled on an empty cart by the hook itself.
  const productIds = useMemo(
    () => Array.from(new Set(items.map((i) => i.productId))).slice(0, 100),
    [items],
  );
  const { data: liveProducts } = useProductsByIds(productIds);

  useEffect(() => {
    if (!liveProducts?.length) return;
    const fresh: Record<string, FreshVariant> = {};
    for (const product of liveProducts) {
      for (const variant of product.variants ?? []) {
        if (!variant.is_active) continue;
        fresh[variant.id] = {
          price: Number(variant.price),
          compare_at_price: variant.compare_at_price != null ? Number(variant.compare_at_price) : null,
          maxStock: variant.stock_quantity,
        };
      }
    }
    syncPrices(fresh);
  }, [liveProducts, syncPrices]);

  const subtotal = getSubtotal();

  // Mirrors the web cart. With distance pricing on, this screen has no
  // address and therefore no distance, so it shows the cheapest band as a
  // "from" figure — checkout, which has the address, quotes the real one.
  const bands = storeSettings?.deliveryBands ?? [];
  const isDistance = storeSettings?.deliveryPricingMode === 'distance' && bands.length > 0;
  const cheapestBand = isDistance
    ? bands.reduce((lo, b) => (b.fee < lo.fee ? b : lo), bands[0])
    : null;

  // Free-delivery thresholds were removed on 2026-09-25: delivery is charged
  // on every order, so there is no progress left to track.
  const deliveryFee = cheapestBand ? cheapestBand.fee : storeSettings?.deliveryFee ?? FALLBACK_FEE;
  const total = subtotal + deliveryFee;
  const itemCount = getItemCount();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          {t('cart.title')}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {items.length === 0 ? (
        /* ─── Empty State ─── */
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 }}>
          <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
            <ShoppingBag size={44} color={colors.muted} strokeWidth={1.25} />
          </View>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink, textAlign: 'center', marginBottom: 8 }}>
            {t('cart.empty')}
          </Text>
          <Text style={{ fontSize: 14, color: colors.gray, textAlign: 'center', lineHeight: 20, marginBottom: 24 }}>
            {t('cart.empty_desc')}
          </Text>
          <Pressable
            onPress={() => router.replace('/(tabs)')}
            style={({ pressed }) => ({
              height: 52, borderRadius: 12, backgroundColor: pressed ? colors.brand.mid : colors.brand.DEFAULT,
              justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 32,
            })}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>
              {t('cart.start_shopping')}
            </Text>
            <ArrowRight size={18} color="#fff" strokeWidth={2} />
          </Pressable>
        </View>
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 180 + insets.bottom }}>
            {/* A free-shipping progress bar sat here, counting up to a
                threshold that no longer exists — free delivery was removed
                on 2026-09-25. */}

            {/* Item count */}
            <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.gray }}>
                {itemCount} {itemCount === 1 ? (lang === 'es' ? 'producto' : 'item') : (lang === 'es' ? 'productos' : 'items')}
              </Text>
            </View>

            {/* Cart items */}
            <View style={{ paddingHorizontal: 16 }}>
              {items.map((item, index) => {
                const name = lang === 'es' ? item.name_es : item.name_en;
                const variantName = lang === 'es' ? item.variantName_es : item.variantName_en;
                const lineTotal = item.price * item.quantity;
                // A sold-out line is still orderable: MV_DRAFT_ORDERS routes it
                // into its own draft sub-order that ships once restocked. So
                // the stepper is capped at a flat 10 rather than at 0, which
                // would strand the line at whatever quantity it already held.
                // Same rule web applies, for the same reason.
                const outOfStock = item.maxStock === 0;
                const stepperMax = outOfStock ? 10 : item.maxStock;

                return (
                  <View
                    key={item.variantId}
                    style={{
                      backgroundColor: colors.surface.cream,
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 10,
                      borderWidth: 1,
                      borderColor: 'rgba(226,232,240,0.7)',
                    }}
                  >
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      {/* Product image */}
                      <Pressable
                        onPress={() => router.push(`/product/${item.productId}`)}
                        style={{ width: 72, height: 72, borderRadius: 10, backgroundColor: colors.surface.linen, overflow: 'hidden' }}
                      >
                        <Image source={{ uri: item.image }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                      </Pressable>

                      {/* Product info */}
                      <View style={{ flex: 1 }}>
                        <Pressable onPress={() => router.push(`/product/${item.productId}`)}>
                          <Text numberOfLines={2} style={{ fontSize: 14, fontWeight: '600', color: colors.ink, lineHeight: 19 }}>
                            {name}
                          </Text>
                        </Pressable>
                        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                          {variantName}
                        </Text>
                        {/* Say why a sold-out line is still here, rather than
                            leaving a stepper the customer cannot explain. */}
                        {outOfStock && (
                          <Text style={{ fontSize: 11.5, color: colors.warning, fontWeight: '600', marginTop: 3, lineHeight: 16 }}>
                            {lang === 'es'
                              ? 'Sin stock \u2014 lo enviaremos en cuanto vuelva'
                              : "Out of stock \u2014 we'll send it as soon as it's back"}
                          </Text>
                        )}
                        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.charcoal, marginTop: 2 }}>
                          {'\u20AC'}{item.price.toFixed(2)}
                        </Text>
                      </View>

                      {/* Delete button */}
                      <Pressable
                        onPress={() => removeItem(item.variantId)}
                        style={({ pressed }) => ({
                          width: 34, height: 34, borderRadius: 8,
                          backgroundColor: pressed ? colors.dangerBg : 'transparent',
                          justifyContent: 'center', alignItems: 'center',
                        })}
                      >
                        <Trash2 size={16} color={colors.muted} strokeWidth={1.75} />
                      </Pressable>
                    </View>

                    {/* Quantity stepper + line total */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
                      {/* Quantity stepper */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface.linen, borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
                        <Pressable
                          onPress={() => updateQuantity(item.variantId, item.quantity - 1)}
                          style={({ pressed }) => ({
                            width: 36, height: 36, justifyContent: 'center', alignItems: 'center',
                            backgroundColor: pressed ? colors.brand.mist : 'transparent',
                          })}
                        >
                          <Minus size={15} color={colors.charcoal} strokeWidth={2.5} />
                        </Pressable>
                        <View style={{ width: 40, justifyContent: 'center', alignItems: 'center' }}>
                          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>
                            {item.quantity}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => {
                            if (item.quantity < stepperMax) {
                              updateQuantity(item.variantId, item.quantity + 1);
                            }
                          }}
                          style={({ pressed }) => ({
                            width: 36, height: 36, justifyContent: 'center', alignItems: 'center',
                            backgroundColor: pressed ? colors.brand.mist : 'transparent',
                            opacity: item.quantity >= stepperMax ? 0.3 : 1,
                          })}
                        >
                          <Plus size={15} color={colors.charcoal} strokeWidth={2.5} />
                        </Pressable>
                      </View>

                      {/* Line total */}
                      <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>
                        {'\u20AC'}{lineTotal.toFixed(2)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Order Summary */}
            <View style={{ marginHorizontal: 16, marginTop: 8 }}>
              <View style={{
                backgroundColor: colors.surface.cream, borderRadius: 12, padding: 16,
                borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
              }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 14 }}>
                  {t('cart.order_summary')}
                </Text>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Text style={{ fontSize: 14, color: colors.gray }}>{t('cart.subtotal')}</Text>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{'\u20AC'}{subtotal.toFixed(2)}</Text>
                </View>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ fontSize: 14, color: colors.gray }}>{t('cart.delivery')}</Text>
                  {deliveryFee === 0 ? (
                    <Text style={{ fontSize: 14, fontWeight: '700', color: colors.brand.DEFAULT }}>{t('cart.free')}</Text>
                  ) : (
                    <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>
                      {isDistance ? (lang === 'es' ? 'desde ' : 'from ') : ''}
                      {'\u20AC'}{deliveryFee.toFixed(2)}
                    </Text>
                  )}
                </View>

                {isDistance && (
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 10 }}>
                    {lang === 'es'
                      ? 'El envío se calcula según la distancia en el checkout.'
                      : 'Delivery is calculated by distance at checkout.'}
                  </Text>
                )}

                <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{t('cart.total')}</Text>
                  <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>{'\u20AC'}{total.toFixed(2)}</Text>
                </View>

                {/* Trust badges */}
                <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Shield size={12} color={colors.muted} strokeWidth={1.75} />
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      {lang === 'es' ? 'Pago al recibir' : 'Pay on delivery'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Truck size={12} color={colors.muted} strokeWidth={1.75} />
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      {lang === 'es' ? 'Entrega rápida' : 'Fast delivery'}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Fixed checkout button */}
          <View style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            backgroundColor: colors.surface.linen,
            paddingHorizontal: 16, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 16),
            borderTopWidth: 1, borderTopColor: colors.border,
          }}>
            <Pressable
              onPress={() => router.push('/checkout')}
              style={({ pressed }) => ({
                height: 54, borderRadius: 12,
                backgroundColor: pressed ? colors.brand.mid : colors.brand.DEFAULT,
                justifyContent: 'center', alignItems: 'center',
                flexDirection: 'row', gap: 8,
              })}
            >
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#fff' }}>
                {t('cart.checkout')} {'\u2014'} {'\u20AC'}{total.toFixed(2)}
              </Text>
              <ArrowRight size={18} color="#fff" strokeWidth={2} />
            </Pressable>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}
