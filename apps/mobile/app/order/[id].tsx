import { View, Text, ScrollView, Pressable, Image, ActivityIndicator, Linking, Modal, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ArrowLeft, MapPin, Clock, CreditCard, CheckCircle2, Package, Truck, PackageCheck, XCircle, Phone, MessageCircle, MessageSquare, Bike, Car, Store as StoreIcon, GitBranch, ChevronRight, AlertTriangle, RefreshCw } from 'lucide-react-native';
import { useOrder, useCancelOrder, useReorder, resolveImageUrl, type Order, type OrderStatus } from '@grocery-app/shared';
import { colors } from '../../src/constants/colors';
import { orderStatusMeta, showsTracker, CANCELLABLE_STATUSES } from '../../src/constants/orderStatus';
import { useLanguageStore } from '../../src/stores/languageStore';
import PushPermissionSheet, { shouldShowPushPrompt } from '../../src/components/PushPermissionSheet';

const TRACK_STEPS = [
  { key: 'confirmed'  as OrderStatus, Icon: CheckCircle2, en: 'Confirmed',  es: 'Confirmado' },
  { key: 'preparing'  as OrderStatus, Icon: Package,      en: 'Preparing',  es: 'Preparando' },
  { key: 'on_the_way' as OrderStatus, Icon: Truck,        en: 'On the way', es: 'En camino' },
  { key: 'delivered'  as OrderStatus, Icon: PackageCheck, en: 'Delivered',  es: 'Entregado' },
];
const STEP_ORDER: OrderStatus[] = ['confirmed', 'preparing', 'on_the_way', 'delivered'];

type StoreSlim = { id: string; slug: string; name: string; logo_url?: string | null } | null | undefined;

/**
 * GET /api/orders/:id answers with a ParentOrder when the id resolves to one —
 * `sub_orders` and `derived_status` instead of `items` and `status`. `Order`
 * does not carry those natively, so widen rather than fight the union.
 */
type ParentShape = {
  id: string;
  order_number: string;
  subtotal?: string | number;
  delivery_fee_total?: string | number;
  total?: string | number;
  created_at?: string;
  payment_method?: string;
  address_snapshot?: Order['address_snapshot'] | null;
  derived_status?: OrderStatus;
  sub_orders?: Array<{
    id: string;
    order_number: string;
    status: OrderStatus;
    total: string | number;
    store?: StoreSlim;
    items?: Order['items'];
    _count?: { items: number };
  }>;
};

/** Sub-order context, present when the fetched Order belongs to a parent. */
type SubShape = {
  parent_order?: { id: string; order_number: string } | null;
  store?: StoreSlim;
  sibling_orders?: Array<{
    id: string;
    order_number: string;
    status: OrderStatus;
    store?: StoreSlim;
  }>;
};

const num = (v: unknown): number => (typeof v === 'number' ? v : parseFloat(String(v ?? 0)) || 0);

const TRACK_IDLE = 'rgba(15,23,42,0.10)';

const paymentLabels: Record<string, { en: string; es: string }> = {
  cod: { en: 'Cash on Delivery', es: 'Contra Reembolso' },
  card: { en: 'Card', es: 'Tarjeta' },
  bizum: { en: 'Bizum', es: 'Bizum' },
};

export default function OrderDetailScreen() {
  const router = useRouter();
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const { lang } = useLanguageStore();
  const { data: order, isLoading } = useOrder(id);
  const [showPushPrompt, setShowPushPrompt] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const cancelOrder = useCancelOrder();
  const reorder = useReorder();

  // Show OS push permission sheet ONCE on first arrival after a fresh checkout
  // (spec §1.12 P275: highest-intent moment, never re-prompt if declined).
  useEffect(() => {
    if (fresh !== '1') return;
    shouldShowPushPrompt().then((show) => {
      if (show) setShowPushPrompt(true);
    });
  }, [fresh]);

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.brand.DEFAULT} />
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ fontSize: 16, color: colors.gray }}>
            {lang === 'es' ? 'Pedido no encontrado' : 'Order not found'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Route on shape before touching anything else: a parent carries sub_orders
  // and has no items or status of its own.
  const parentShape = order as unknown as ParentShape;
  if (parentShape.sub_orders) {
    return <ParentOrderView parent={parentShape} lang={lang} />;
  }

  const subContext = order as unknown as SubShape;
  const parentOrder = subContext.parent_order;
  const siblings = subContext.sibling_orders ?? [];

  const config = orderStatusMeta(order.status);
  const currentIndex = STEP_ORDER.indexOf(order.status);
  const HeroIcon = heroIconFor(order.status);
  const addr = order.address_snapshot;
  // Every order is ASAP. Booked windows were removed with the zone system,
  // and the slot was never snapshotted onto the order, so historical orders
  // have none either.
  const asapLabel = lang === 'es' ? 'Lo antes posible' : 'As soon as possible';
  const paymentLabel = paymentLabels[order.payment_method]?.[lang] ?? order.payment_method;

  const subtotal = Number(order.subtotal);
  const deliveryFee = Number(order.delivery_fee);
  const total = Number(order.total);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 6, paddingBottom: 14 }}>
        <Pressable
          onPress={() => router.back()}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' }}
        >
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center', marginRight: 40 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: colors.muted, textTransform: 'uppercase' }}>
            {lang === 'es' ? 'Pedido' : 'Order'}
          </Text>
          <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 14, fontWeight: '600', color: colors.ink, marginTop: 1 }}>
            {order.order_number}
          </Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* This order is one slice of a cross-store purchase. The chips let the
            customer reach the siblings, which each track separately. */}
        {parentOrder && (
          <View style={{ backgroundColor: colors.brand.whisper, borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: colors.brand.mist }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center' }}>
                <GitBranch size={15} color="#fff" strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Pressable onPress={() => router.replace(`/order/${parentOrder.id}`)}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>
                    {lang === 'es' ? 'Parte de un pedido multi-tienda' : 'Part of a multi-store order'}{' '}
                    <Text style={{ fontFamily: 'JetBrainsMono', color: colors.brand.DEFAULT }}>
                      {parentOrder.order_number}
                    </Text>
                  </Text>
                </Pressable>
                {siblings.length > 0 && (
                  <>
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 3 }}>
                      {lang === 'es'
                        ? `${siblings.length} ${siblings.length === 1 ? 'otra tienda' : 'otras tiendas'} en este pedido:`
                        : `${siblings.length} other ${siblings.length === 1 ? 'store' : 'stores'} in this order:`}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {siblings.map((sib) => {
                        const sibMeta = orderStatusMeta(sib.status);
                        return (
                          <Pressable
                            key={sib.id}
                            onPress={() => router.replace(`/order/${sib.id}`)}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.surface.cream, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: colors.border }}
                          >
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: sibMeta.text }} />
                            <Text style={{ fontSize: 11, fontWeight: '600', color: colors.ink }} numberOfLines={1}>
                              {sib.store?.name ?? sib.order_number}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                )}
              </View>
            </View>
          </View>
        )}

        {subContext.store && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <StoreIcon size={14} color={colors.muted} strokeWidth={1.75} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.gray }} numberOfLines={1}>
              {subContext.store.name}
            </Text>
          </View>
        )}

        {/* Status hero */}
        <View style={{ backgroundColor: config.bg, borderRadius: 8, padding: 18, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: config.accent, justifyContent: 'center', alignItems: 'center' }}>
              <HeroIcon size={24} color="#FFFFFF" strokeWidth={1.75} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: config.text }}>
                {lang === 'es' ? config.label_es : config.label_en}
              </Text>
              <Text style={{ fontSize: 13, color: config.text, opacity: 0.8, marginTop: 1 }}>
                {lang === 'es' ? config.desc_es : config.desc_en}
              </Text>
            </View>
          </View>

          {showsTracker(order.status) && order.status !== 'delivered' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
              <Clock size={13} color={config.text} strokeWidth={1.75} />
              <Text style={{ fontSize: 12, fontWeight: '600', color: config.text }}>
                {asapLabel}
              </Text>
            </View>
          )}

          {showsTracker(order.status) && (
            <View style={{ flexDirection: 'row', marginTop: 20 }}>
              {TRACK_STEPS.map((step, i) => {
                const done = i <= currentIndex;
                const isCurrent = i === currentIndex;
                const leftFill = i > 0 && i <= currentIndex ? config.accent : TRACK_IDLE;
                const rightFill = i < TRACK_STEPS.length - 1 && i < currentIndex ? config.accent : TRACK_IDLE;
                return (
                  <View key={step.key} style={{ flex: 1, alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
                      <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i === 0 ? 'transparent' : leftFill }} />
                      <View style={{
                        width: 30, height: 30, borderRadius: 15,
                        backgroundColor: done ? config.accent : 'rgba(255,255,255,0.7)',
                        borderWidth: isCurrent ? 2 : 0, borderColor: '#FFFFFF',
                        justifyContent: 'center', alignItems: 'center',
                      }}>
                        <step.Icon size={15} color={done ? '#FFFFFF' : colors.muted} strokeWidth={1.75} />
                      </View>
                      <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i === TRACK_STEPS.length - 1 ? 'transparent' : rightFill }} />
                    </View>
                    <Text style={{
                      fontSize: 10, marginTop: 6, textAlign: 'center',
                      fontWeight: isCurrent ? '700' : '500',
                      color: done ? config.text : colors.muted,
                    }}>
                      {lang === 'es' ? step.es : step.en}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View style={{
          backgroundColor: colors.surface.cream, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
        }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 14 }}>
            {lang === 'es' ? 'Información de Entrega' : 'Delivery Information'}
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
            <MapPin size={18} color={colors.brand.DEFAULT} strokeWidth={1.75} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 2 }}>
                {lang === 'es' ? 'Dirección' : 'Address'}
              </Text>
              <Text style={{ fontSize: 14, color: colors.ink, lineHeight: 20 }}>
                {addr.street_line_1}{addr.street_line_2 ? `, ${addr.street_line_2}` : ''}, {addr.postcode} {addr.city}
              </Text>
            </View>
          </View>

          {/* A "Delivery Slot" row stood here. There is no slot — booked
              windows went with the zone system and no order ever carried one,
              so it was a field label with a constant underneath. The pill on
              the tracker above still says "lo antes posible" while an order is
              in progress, which is the same fact where it is worth reading.
              Removed on web, admin and partner in staging's dfa4b8c. */}

          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
            <CreditCard size={18} color={colors.brand.DEFAULT} strokeWidth={1.75} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 2 }}>
                {lang === 'es' ? 'Método de Pago' : 'Payment Method'}
              </Text>
              <Text style={{ fontSize: 14, color: colors.ink }}>
                {paymentLabel}
              </Text>
            </View>
          </View>

          {/* Whatever the customer typed at checkout. Mobile only started
              collecting this recently and had nowhere to show it back, so a
              note written on a phone was invisible to the person who wrote it.
              Quoted and italic, matching web. */}
          {order.customer_notes ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 12 }}>
              <MessageSquare size={18} color={colors.brand.DEFAULT} strokeWidth={1.75} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 2 }}>
                  {lang === 'es' ? 'Notas del pedido' : 'Order notes'}
                </Text>
                <Text style={{ fontSize: 14, color: colors.charcoal, fontStyle: 'italic', lineHeight: 20 }}>
                  “{order.customer_notes}”
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        {order.rider && ['preparing', 'on_the_way', 'delivered'].includes(order.status) && (() => {
          const rider = order.rider!;
          const delivered = order.status === 'delivered';
          const VehicleIcon = rider.vehicle_type === 'bicicleta' ? Bike : rider.vehicle_type === 'coche' ? Car : Truck;
          const vehicleLabel =
            rider.vehicle_type === 'bicicleta' ? (lang === 'es' ? 'Bicicleta' : 'Bicycle')
            : rider.vehicle_type === 'coche' ? (lang === 'es' ? 'Coche' : 'Car')
            : (lang === 'es' ? 'Moto' : 'Motorbike');
          const initials = rider.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
          const waPhone = rider.phone.replace(/[^\d]/g, '');

          return (
            <View style={{ backgroundColor: colors.surface.cream, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)' }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 14 }}>
                {delivered ? (lang === 'es' ? 'Entregado por' : 'Delivered by') : (lang === 'es' ? 'Tu Repartidor' : 'Your Rider')}
              </Text>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: delivered ? 0 : 14 }}>
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brand.mist, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.brand.deepest }}>
                    {initials}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }} numberOfLines={1}>
                    {rider.name}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                    <VehicleIcon size={13} color={colors.muted} strokeWidth={1.75} />
                    <Text style={{ fontSize: 12, color: colors.muted }}>{vehicleLabel}</Text>
                  </View>
                </View>
                {delivered && (
                  <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 12, color: colors.muted }}>{rider.phone}</Text>
                )}
              </View>

              {!delivered && (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Pressable
                    onPress={() => Linking.openURL(`tel:${rider.phone}`)}
                    style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: colors.brand.DEFAULT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  >
                    <Phone size={15} color="#fff" strokeWidth={2} />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>
                      {lang === 'es' ? 'Llamar' : 'Call'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => Linking.openURL(`https://wa.me/${waPhone}`)}
                    style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: colors.brand.mist, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  >
                    <MessageCircle size={15} color={colors.brand.deepest} strokeWidth={2} />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.brand.deepest }}>
                      WhatsApp
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })()}

        <View style={{ backgroundColor: colors.surface.cream, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)' }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 14 }}>
            {lang === 'es' ? 'Artículos' : 'Items'} ({order.items?.length ?? 0})
          </Text>

          {(order.items ?? []).map((item, index) => {
            const snap = item.product_snapshot;
            const name = lang === 'es' ? snap.name_es : snap.name_en;
            const variant = lang === 'es' ? snap.variant_name_es : snap.variant_name_en;
            return (
              <View
                key={item.id}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  paddingVertical: 12,
                  borderTopWidth: index > 0 ? 1 : 0, borderTopColor: colors.border,
                }}
              >
                {snap.image_url ? (
                  <Image
                    source={{ uri: resolveImageUrl(snap.image_url, 'thumb') }}
                    style={{ width: 52, height: 52, borderRadius: 8, backgroundColor: colors.surface.linen }}
                  />
                ) : (
                  <View style={{ width: 52, height: 52, borderRadius: 8, backgroundColor: colors.surface.linen, justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ fontSize: 22 }}>📦</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                    {variant} × {item.quantity}
                  </Text>
                </View>
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
                  €{Number(item.line_total).toFixed(2)}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={{ backgroundColor: colors.surface.cream, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)' }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 14 }}>
            {lang === 'es' ? 'Resumen del Pedido' : 'Order Summary'}
          </Text>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 14, color: colors.gray }}>{lang === 'es' ? 'Subtotal' : 'Subtotal'}</Text>
            <Text style={{ fontSize: 14, color: colors.ink }}>€{subtotal.toFixed(2)}</Text>
          </View>

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={{ fontSize: 14, color: colors.gray }}>{lang === 'es' ? 'Envío' : 'Delivery Fee'}</Text>
            <Text style={{ fontSize: 14, color: colors.ink }}>
              {deliveryFee === 0 ? (lang === 'es' ? 'Gratis' : 'Free') : `€${deliveryFee.toFixed(2)}`}
            </Text>
          </View>

          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>Total</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.brand.DEFAULT }}>€{total.toFixed(2)}</Text>
          </View>
        </View>

        {/* Actions. Cancelling is allowed while the order is pending, confirmed
            or draft — that last one matters most: a draft is the order stuck
            waiting on stock, and walking away is exactly what the customer
            wants. A sub-order cancels on its own; its siblings are untouched. */}
        {(CANCELLABLE_STATUSES.includes(order.status) || order.status === 'delivered' || order.status === 'cancelled') && (
          <View style={{ marginTop: 16, gap: 10 }}>
            {CANCELLABLE_STATUSES.includes(order.status) && (
              <Pressable
                onPress={() => setCancelOpen(true)}
                style={({ pressed }) => ({
                  height: 52, borderRadius: 12,
                  borderWidth: 2, borderColor: 'rgba(220,38,38,0.4)',
                  backgroundColor: pressed ? colors.dangerBg : colors.surface.cream,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                })}
              >
                <XCircle size={17} color={colors.danger} strokeWidth={2} />
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.danger }}>
                  {lang === 'es' ? 'Cancelar pedido' : 'Cancel order'}
                </Text>
              </Pressable>
            )}

            {(order.status === 'delivered' || order.status === 'cancelled') && (
              <Pressable
                onPress={() => reorder.mutate(order.id, { onSuccess: () => router.push('/cart') })}
                disabled={reorder.isPending}
                style={{
                  height: 52, borderRadius: 12, backgroundColor: colors.brand.DEFAULT,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: reorder.isPending ? 0.6 : 1,
                }}
              >
                {reorder.isPending
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <RefreshCw size={16} color="#fff" strokeWidth={2} />}
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
                  {lang === 'es' ? 'Volver a pedir' : 'Reorder'}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>

      {/* Reason is optional — most cancels are "changed my mind", and forcing a
          justification just makes people abandon the screen instead. The
          mutation restocks (except on a draft, which never reserved anything)
          and notifies the store; the order re-renders as cancelled on success. */}
      <Modal visible={cancelOpen} transparent animationType="fade" onRequestClose={() => !cancelOrder.isPending && setCancelOpen(false)}>
        <Pressable
          onPress={() => { if (!cancelOrder.isPending) setCancelOpen(false); }}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={{ backgroundColor: colors.surface.cream, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 22, paddingBottom: 34 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.dangerBg, justifyContent: 'center', alignItems: 'center' }}>
                  <XCircle size={20} color={colors.danger} strokeWidth={1.75} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>
                    {lang === 'es' ? '¿Cancelar este pedido?' : 'Cancel this order?'}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.gray, marginTop: 4, lineHeight: 17 }}>
                    {lang === 'es'
                      ? 'Avisaremos a la tienda y se reembolsará cualquier importe cobrado. Puedes volver a pedir cuando quieras.'
                      : "The store will be notified and any charged amount refunded. You can reorder anytime."}
                  </Text>
                </View>
              </View>

              <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, color: colors.muted, textTransform: 'uppercase', marginBottom: 6 }}>
                {lang === 'es' ? 'Motivo (opcional)' : 'Reason (optional)'}
              </Text>
              <TextInput
                value={cancelReason}
                onChangeText={setCancelReason}
                multiline
                numberOfLines={3}
                placeholder={lang === 'es' ? 'Cuéntale a la tienda qué pasó (opcional)' : 'Tell the store what happened (optional)'}
                placeholderTextColor={colors.muted}
                style={{
                  minHeight: 80, textAlignVertical: 'top',
                  borderWidth: 1, borderColor: colors.border, borderRadius: 12,
                  padding: 12, fontSize: 14, color: colors.ink,
                  backgroundColor: colors.surface.linen,
                }}
              />

              {cancelOrder.isError && (
                <Text style={{ fontSize: 12, color: colors.danger, marginTop: 10 }}>
                  {cancelOrder.error instanceof Error ? cancelOrder.error.message : (lang === 'es' ? 'Algo salió mal.' : 'Something went wrong.')}
                </Text>
              )}

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                <Pressable
                  onPress={() => setCancelOpen(false)}
                  disabled={cancelOrder.isPending}
                  style={{ flex: 1, height: 52, borderRadius: 12, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center', opacity: cancelOrder.isPending ? 0.5 : 1 }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>
                    {lang === 'es' ? 'Mantener' : 'Keep it'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    cancelOrder.mutate(
                      { id: order.id, reason: cancelReason.trim() || undefined },
                      { onSuccess: () => { setCancelOpen(false); setCancelReason(''); } },
                    );
                  }}
                  disabled={cancelOrder.isPending}
                  style={{ flex: 1, height: 52, borderRadius: 12, backgroundColor: colors.danger, justifyContent: 'center', alignItems: 'center', opacity: cancelOrder.isPending ? 0.6 : 1 }}
                >
                  {cancelOrder.isPending
                    ? <ActivityIndicator color="#fff" size="small" />
                    : (
                      <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
                        {lang === 'es' ? 'Sí, cancelar' : 'Yes, cancel'}
                      </Text>
                    )}
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <PushPermissionSheet visible={showPushPrompt} onClose={() => setShowPushPrompt(false)} />
    </SafeAreaView>
  );
}

function heroIconFor(status: string) {
  switch (status) {
    case 'cancelled':           return XCircle;
    case 'delivered':           return PackageCheck;
    case 'on_the_way':          return Truck;
    case 'preparing':           return Package;
    case 'confirmed':           return CheckCircle2;
    case 'draft':               return AlertTriangle;
    case 'partially_completed': return PackageCheck;
    default:                    return Clock;
  }
}

/**
 * A cross-store checkout produces one ParentOrder over N sub-orders. The parent
 * is what the customer paid once for; each sub is fulfilled and tracked by its
 * own store, so this screen summarises the purchase and hands off to the subs
 * rather than faking a single tracker across all of them.
 *
 * Reachable with no partner store involved: MV_DRAFT_ORDERS splits a line that
 * is short on stock into its own sub, so a single-store cart can land here too.
 */
function ParentOrderView({ parent, lang }: { parent: ParentShape; lang: 'en' | 'es' }) {
  const router = useRouter();
  const subs = parent.sub_orders ?? [];
  const config = orderStatusMeta(parent.derived_status);
  const HeroIcon = heroIconFor(parent.derived_status ?? '');
  const addr = parent.address_snapshot;

  const subtotal = num(parent.subtotal);
  const deliveryFee = num(parent.delivery_fee_total);
  const total = num(parent.total);
  const itemCount = subs.reduce(
    (n, sub) => n + (sub._count?.items ?? sub.items?.length ?? 0),
    0,
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 6, paddingBottom: 14 }}>
        <Pressable
          onPress={() => router.back()}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center' }}
        >
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center', marginRight: 40 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: colors.muted, textTransform: 'uppercase' }}>
            {lang === 'es' ? 'Pedido' : 'Order'}
          </Text>
          <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 14, fontWeight: '600', color: colors.ink, marginTop: 1 }}>
            {parent.order_number}
          </Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={{ backgroundColor: config.bg, borderRadius: 8, padding: 18, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: config.accent, justifyContent: 'center', alignItems: 'center' }}>
              <HeroIcon size={24} color="#FFFFFF" strokeWidth={1.75} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: config.text }}>
                {lang === 'es' ? config.label_es : config.label_en}
              </Text>
              <Text style={{ fontSize: 13, color: config.text, opacity: 0.8, marginTop: 1 }}>
                {lang === 'es' ? config.desc_es : config.desc_en}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
            <GitBranch size={13} color={config.text} strokeWidth={1.75} />
            <Text style={{ fontSize: 12, fontWeight: '600', color: config.text }}>
              {lang === 'es'
                ? `${subs.length} ${subs.length === 1 ? 'entrega' : 'entregas'} · ${itemCount} ${itemCount === 1 ? 'artículo' : 'artículos'}`
                : `${subs.length} ${subs.length === 1 ? 'delivery' : 'deliveries'} · ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
            </Text>
          </View>
        </View>

        {/* Each sub tracks on its own — tapping one opens its full detail. */}
        <View style={{ backgroundColor: colors.surface.cream, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)' }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 4 }}>
            {lang === 'es' ? 'Entregas' : 'Deliveries'}
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>
            {lang === 'es'
              ? 'Cada tienda prepara y entrega su parte por separado.'
              : 'Each store prepares and delivers its part separately.'}
          </Text>

          {subs.map((sub, index) => {
            const subMeta = orderStatusMeta(sub.status);
            const subItems = sub._count?.items ?? sub.items?.length ?? 0;
            return (
              <Pressable
                key={sub.id}
                onPress={() => router.push(`/order/${sub.id}`)}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  paddingVertical: 14,
                  borderTopWidth: index > 0 ? 1 : 0, borderTopColor: colors.border,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: subMeta.bg, justifyContent: 'center', alignItems: 'center' }}>
                  <StoreIcon size={17} color={subMeta.text} strokeWidth={1.75} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }} numberOfLines={1}>
                    {sub.store?.name ?? 'Cesto'}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                    <View style={{ backgroundColor: subMeta.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: subMeta.text }}>
                        {lang === 'es' ? subMeta.label_es : subMeta.label_en}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      {subItems} {lang === 'es' ? (subItems === 1 ? 'artículo' : 'artículos') : (subItems === 1 ? 'item' : 'items')}
                    </Text>
                  </View>
                </View>
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
                  {'€'}{num(sub.total).toFixed(2)}
                </Text>
                <ChevronRight size={16} color={colors.muted} strokeWidth={1.75} />
              </Pressable>
            );
          })}
        </View>

        {addr && (
          <View style={{ backgroundColor: colors.surface.cream, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)' }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 14 }}>
              {lang === 'es' ? 'Información de Entrega' : 'Delivery Information'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
              <MapPin size={18} color={colors.brand.DEFAULT} strokeWidth={1.75} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 2 }}>
                  {lang === 'es' ? 'Dirección' : 'Address'}
                </Text>
                <Text style={{ fontSize: 14, color: colors.ink, lineHeight: 20 }}>
                  {addr.street_line_1}{addr.street_line_2 ? `, ${addr.street_line_2}` : ''}, {addr.postcode} {addr.city}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* One payment covered the whole purchase, and the delivery fee sits on
            the parent with every sub carrying zero — so this is the only place
            the totals add up to what was actually charged. */}
        <View style={{ backgroundColor: colors.surface.cream, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)' }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 14 }}>
            {lang === 'es' ? 'Resumen del Pedido' : 'Order Summary'}
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 14, color: colors.gray }}>Subtotal</Text>
            <Text style={{ fontSize: 14, color: colors.ink }}>{'€'}{subtotal.toFixed(2)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={{ fontSize: 14, color: colors.gray }}>{lang === 'es' ? 'Envío' : 'Delivery Fee'}</Text>
            <Text style={{ fontSize: 14, color: colors.ink }}>
              {deliveryFee === 0 ? (lang === 'es' ? 'Gratis' : 'Free') : `${'€'}${deliveryFee.toFixed(2)}`}
            </Text>
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>Total</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.brand.DEFAULT }}>{'€'}{total.toFixed(2)}</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
