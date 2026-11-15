import { View, Text, ScrollView, Pressable, Image, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, MapPin, Clock, Check, Lock, AlertTriangle } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  useAddresses,
  useCheckout,
  useOrderQuote,
  type PaymentMethod,
} from '@grocery-app/shared';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';
import { useCartStore, CartItem } from '../src/stores/cartStore';
import { useAuthStore } from '../src/stores/authStore';
import { resolveCheckoutLanding } from '../src/lib/checkoutResponse';

// Every method is settled at the door — there is no payment gateway, so the
// copy must not imply the customer is paying now. Matches web's "Card on
// delivery" wording; "Visa, Mastercard, Amex" used to read as pay-now here.
const paymentMethods: { id: PaymentMethod; label_en: string; label_es: string; description_en: string; description_es: string }[] = [
  { id: 'cod', label_en: 'Cash on delivery', label_es: 'Efectivo al recibir', description_en: 'Pay the rider in cash when your order arrives', description_es: 'Paga en efectivo al repartidor cuando llegue tu pedido' },
  { id: 'card', label_en: 'Card on delivery', label_es: 'Tarjeta al recibir', description_en: 'The rider brings a card reader', description_es: 'El repartidor lleva un datáfono' },
  // Bizum was dropped on 2026-09-28 (7e49e30 removed it from web, admin, the
  // FAQ, the app-content defaults and both legal documents). It is no longer
  // offered anywhere; the server still ACCEPTS the value so that versionCode 4,
  // which still shows this option, keeps checking out until that build is gone.
  // `PaymentMethod` and the order label maps keep `bizum` so an order already
  // placed that way still renders its own name rather than a blank.
];

export default function CheckoutScreen() {
  // This bar is absolutely positioned at bottom: 0, and from SDK 54 the app
  // draws behind the system navigation, so bottom: 0 is UNDER it. The old
  // hardcoded `paddingBottom: 34` was an iPhone home-indicator guess: it
  // happened to fit there and left the button half-hidden behind Android's
  // three-button bar, which is 48dp.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { lang } = useLanguageStore();
  const items = useCartStore((s) => s.items);
  const getSubtotal = useCartStore((s) => s.getSubtotal);
  const syncToServer = useCartStore((s) => s.syncToServer);
  const clearCart = useCartStore((s) => s.clearCart);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const { data: addresses = [] } = useAddresses();
  const checkout = useCheckout();

  const [addressId, setAddressId] = useState<string>('');
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod>('cod');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Matches the server validator (orders.ts: customerNotes z.string().max(500))
  // and web's own limit, so the three cannot drift apart.
  const NOTES_LIMIT = 500;
  const notesError =
    notes.length > NOTES_LIMIT
      ? (lang === 'es' ? `Máximo ${NOTES_LIMIT} caracteres.` : `Maximum ${NOTES_LIMIT} characters.`)
      : null;

  // Default-select the user's default address. No serviceability check —
  // every saved address is deliverable now that coverage is not modelled.
  useEffect(() => {
    if (addressId || addresses.length === 0) return;
    const def = addresses.find((a) => a.is_default);
    setAddressId((def ?? addresses[0]).id);
  }, [addresses, addressId]);

  // Server quote — drives subtotal/delivery/total. The server prices what's
  // in the *server* cart, so the local cart is pushed up first; otherwise
  // the first quote on this screen 400s on an empty cart.
  const orderQuote = useOrderQuote();
  useEffect(() => {
    if (!addressId) return;
    let cancelled = false;
    (async () => {
      try { await syncToServer(); } catch { /* quote will surface any cart issue */ }
      if (!cancelled) orderQuote.mutate(addressId);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressId]);
  const quote = orderQuote.data;

  // Prefer the server quote; fall back to local math while it's in-flight so
  // the totals row never reads "—".
  const localSubtotal = getSubtotal();
  const subtotal = quote ? parseFloat(quote.subtotal) : localSubtotal;
  const deliveryFee = quote
    ? parseFloat(quote.deliveryFee)
    : (localSubtotal >= 30 ? 0 : 2.99);
  const total = quote ? parseFloat(quote.total) : subtotal + deliveryFee;
  const quoteIssues = quote?.issues ?? [];

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
            <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
          </Pressable>
          <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center', marginRight: 40 }}>
            Checkout
          </Text>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.brand.mist, justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
            <Lock size={32} color={colors.brand.DEFAULT} strokeWidth={1.75} />
          </View>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink, marginBottom: 8, textAlign: 'center' }}>
            {lang === 'es' ? 'Inicia sesión para continuar' : 'Log in to continue'}
          </Text>
          <Pressable
            onPress={() => router.push('/(auth)/login')}
            style={{ marginTop: 16, height: 52, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 }}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>
              {lang === 'es' ? 'Iniciar Sesión' : 'Log In'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const placeOrder = async () => {
    setError(null);
    if (!addressId) {
      setError(lang === 'es' ? 'Elige una dirección.' : 'Pick a delivery address.');
      return;
    }
    if (items.length === 0) {
      setError(lang === 'es' ? 'Tu cesta está vacía.' : 'Your cart is empty.');
      return;
    }
    if (quoteIssues.length > 0) {
      setError(
        lang === 'es'
          ? 'Algunos artículos no están disponibles. Revisa tu cesta.'
          : "Some items aren't available. Review your cart.",
      );
      return;
    }
    // The field lets you type past the limit so the counter can explain why;
    // this is what actually stops an over-length note reaching the server,
    // which would reject it with a 422 the customer cannot interpret.
    if (notesError) {
      setError(notesError);
      return;
    }
    try {
      await syncToServer();
      const resp = await checkout.mutateAsync({
        addressId,
        paymentMethod: selectedPayment,
        customerNotes: notes.trim() || undefined,
      });
      clearCart();
      // Single Order or `{ parent_order, orders }` — see resolveCheckoutLanding
      // for why the split shape happens without any partner store involved.
      const landId = resolveCheckoutLanding(resp);
      if (!landId) {
        // The order was placed; we just cannot tell where to land. Send them to
        // the history rather than /order/undefined.
        router.replace('/orders');
        return;
      }
      router.replace(`/order/${landId}?fresh=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center', marginRight: 40 }}>
          Checkout
        </Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 110 + insets.bottom }}>
        {/* Address picker */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 10 }}>
            {lang === 'es' ? 'Dirección de Entrega' : 'Delivery Address'}
          </Text>
          {addresses.length === 0 ? (
            <View style={{ backgroundColor: colors.surface.cream, borderRadius: 12, padding: 14, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, color: colors.charcoal, marginBottom: 10 }}>
                {lang === 'es' ? 'Sin direcciones guardadas.' : 'No saved addresses.'}
              </Text>
              <Pressable
                onPress={() => router.push('/addresses')}
                style={{ height: 38, paddingHorizontal: 16, borderRadius: 10, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center' }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>
                  {lang === 'es' ? 'Añadir dirección' : 'Add address'}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              {addresses.map((a) => {
                const selected = addressId === a.id;
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => setAddressId(a.id)}
                    style={{
                      borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
                      borderWidth: 2,
                      borderColor: selected ? colors.brand.DEFAULT : 'rgba(226,232,240,0.7)',
                      backgroundColor: selected ? colors.brand.mist : colors.surface.cream,
                      flexDirection: 'row', alignItems: 'center', gap: 10,
                    }}
                  >
                    <MapPin size={18} color={selected ? colors.brand.DEFAULT : colors.muted} strokeWidth={1.75} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>
                        {a.contact_name}
                      </Text>
                      <Text style={{ fontSize: 12, color: colors.charcoal }}>
                        {a.street_line_1}, {a.postcode} {a.city}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
              <Pressable onPress={() => router.push('/addresses')} style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.brand.DEFAULT }}>
                  {lang === 'es' ? '+ Gestionar direcciones' : '+ Manage addresses'}
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Delivery time. A slot picker until booked windows were removed
            with the zone system — slots hung off a delivery zone, and there
            are none. Every order is ASAP. */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 10 }}>
            {lang === 'es' ? 'Entrega' : 'Delivery'}
          </Text>
          <View style={{
            backgroundColor: colors.surface.cream, borderRadius: 12, padding: 14,
            borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
            flexDirection: 'row', alignItems: 'center', gap: 10,
          }}>
            <Clock size={18} color={colors.brand.DEFAULT} strokeWidth={1.75} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>
                {lang === 'es' ? 'Lo antes posible' : 'As soon as possible'}
              </Text>
              <Text style={{ fontSize: 12, color: colors.charcoal, marginTop: 2 }}>
                {lang === 'es'
                  ? 'Empezamos a prepararlo en cuanto lo confirmes y te avisamos en cada paso. Los tiempos dependen de tu zona.'
                  : 'We start preparing it as soon as you confirm and notify you at every step. Times depend on your area.'}
              </Text>
            </View>
          </View>
        </View>


        {/* Payment method */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 10 }}>
            {lang === 'es' ? 'Método de Pago' : 'Payment Method'}
          </Text>
          <View style={{
            backgroundColor: colors.surface.cream, borderRadius: 12, overflow: 'hidden',
            borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
          }}>
            {paymentMethods.map((method, index) => {
              const isSelected = selectedPayment === method.id;
              const isLast = index === paymentMethods.length - 1;
              return (
                <Pressable
                  key={method.id}
                  onPress={() => setSelectedPayment(method.id)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16,
                    borderBottomWidth: isLast ? 0 : 1, borderBottomColor: colors.border,
                    backgroundColor: isSelected ? colors.brand.mist : 'transparent',
                  }}
                >
                  <View style={{
                    width: 22, height: 22, borderRadius: 11,
                    borderWidth: 2, borderColor: isSelected ? colors.brand.DEFAULT : colors.border,
                    justifyContent: 'center', alignItems: 'center', marginRight: 12,
                  }}>
                    {isSelected && (
                      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.brand.DEFAULT }} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{
                      fontSize: 14,
                      fontWeight: isSelected ? '700' : '600',
                      color: isSelected ? colors.brand.DEFAULT : colors.ink,
                    }}>
                      {lang === 'es' ? method.label_es : method.label_en}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                      {lang === 'es' ? method.description_es : method.description_en}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Order notes. Mobile had no field at all, so a phone customer had no
            way to say "third floor, no lift" and ops lost a line they see on
            every web order. */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 10 }}>
            {lang === 'es' ? 'Notas del pedido' : 'Order notes'}
            <Text style={{ fontSize: 12, fontWeight: '400', color: colors.muted }}>
              {lang === 'es' ? '  (opcional)' : '  (optional)'}
            </Text>
          </Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder={lang === 'es'
              ? '¿Algo que debamos saber? Preferencias, alergias, acceso al edificio…'
              : 'Anything we should know? Preferences, allergies, building access…'}
            placeholderTextColor={colors.muted}
            multiline
            numberOfLines={3}
            // Above the limit rather than at it, so the counter can turn red
            // and explain instead of the field silently refusing keystrokes.
            maxLength={NOTES_LIMIT + 50}
            textAlignVertical="top"
            style={{
              minHeight: 88,
              backgroundColor: colors.surface.cream,
              borderWidth: 1,
              borderColor: notesError ? colors.danger : colors.border,
              borderRadius: 12,
              padding: 14,
              fontSize: 14,
              color: colors.ink,
            }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <Text style={{ fontSize: 12, color: colors.danger }}>{notesError ?? ''}</Text>
            <Text style={{ fontSize: 11, color: notesError ? colors.danger : colors.muted }}>
              {notes.length} / {NOTES_LIMIT}
            </Text>
          </View>
        </View>

        {/* Order summary */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 10 }}>
            {lang === 'es' ? 'Resumen del Pedido' : 'Order Summary'}
          </Text>
          <View style={{ backgroundColor: colors.surface.cream, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)' }}>
            {items.map((item: CartItem, index: number) => (
              <View
                key={item.variantId}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  paddingVertical: 10,
                  borderBottomWidth: index < items.length - 1 ? 1 : 0,
                  borderBottomColor: colors.border,
                }}
              >
                <Image
                  source={{ uri: item.image }}
                  style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: colors.surface.linen }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }} numberOfLines={1}>
                    {lang === 'es' ? item.name_es : item.name_en}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
                    {lang === 'es' ? item.variantName_es : item.variantName_en} × {item.quantity}
                  </Text>
                </View>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>
                  €{(item.price * item.quantity).toFixed(2)}
                </Text>
              </View>
            ))}

            {items.length === 0 && (
              <Text style={{ fontSize: 14, color: colors.muted, textAlign: 'center', paddingVertical: 20 }}>
                {lang === 'es' ? 'Tu cesta está vacía' : 'Your cart is empty'}
              </Text>
            )}

            {items.length > 0 && (
              <View style={{ marginTop: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={{ fontSize: 14, color: colors.gray }}>{lang === 'es' ? 'Subtotal' : 'Subtotal'}</Text>
                  <Text style={{ fontSize: 14, color: colors.ink }}>€{subtotal.toFixed(2)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: quote?.delivery?.mode === 'distance' ? 2 : 12 }}>
                  <Text style={{ fontSize: 14, color: colors.gray }}>{lang === 'es' ? 'Envío' : 'Delivery Fee'}</Text>
                  <Text style={{ fontSize: 14, color: deliveryFee === 0 ? colors.brand.DEFAULT : colors.ink }}>
                    {deliveryFee === 0 ? (lang === 'es' ? 'Gratis' : 'Free') : `€${deliveryFee.toFixed(2)}`}
                  </Text>
                </View>

                {/* Why the fee is what it is, when distance decided it. A
                    number that moves with the address needs a reason next to
                    it. Optional-chained: an API from before distance pricing
                    sends no `delivery` object, and flat mode has nothing to
                    explain — both render nothing. */}
                {quote?.delivery?.mode === 'distance' && (
                  <Text style={{ fontSize: 11, color: colors.muted, textAlign: 'right', marginBottom: 12 }}>
                    {quote.delivery.distanceKm} km · {quote.delivery.bandLabel}
                  </Text>
                )}

                <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>Total</Text>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.brand.DEFAULT }}>€{total.toFixed(2)}</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {quoteIssues.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 10, backgroundColor: colors.warningBg, borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <AlertTriangle size={16} color={colors.warning} strokeWidth={2} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.warning, marginBottom: 2 }}>
                {lang === 'es' ? 'Revisa tu cesta' : 'Review your cart'}
              </Text>
              <Text style={{ fontSize: 12, color: colors.charcoal }}>
                {lang === 'es'
                  ? `${quoteIssues.length} artículo(s) sin stock o no disponibles.`
                  : `${quoteIssues.length} item(s) are out of stock or unavailable.`}
              </Text>
            </View>
          </View>
        )}

        {error && (
          <View style={{ backgroundColor: colors.dangerBg, borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <Text style={{ fontSize: 13, color: colors.danger }}>{error}</Text>
          </View>
        )}
      </ScrollView>

      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: colors.surface.linen,
        paddingHorizontal: 16, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 16),
        borderTopWidth: 1, borderTopColor: colors.border,
      }}>
        <Pressable
          onPress={placeOrder}
          disabled={items.length === 0 || checkout.isPending || quoteIssues.length > 0}
          style={{
            height: 54, borderRadius: 12,
            backgroundColor: items.length === 0 || quoteIssues.length > 0 ? colors.muted : colors.brand.DEFAULT,
            justifyContent: 'center', alignItems: 'center',
            opacity: checkout.isPending ? 0.6 : 1,
          }}
        >
          {checkout.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#fff' }}>
              {lang === 'es' ? 'Realizar Pedido' : 'Place Order'}{items.length > 0 ? ` — €${total.toFixed(2)}` : ''}
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function SlotRow({ label, selected, onPress, isLast }: { label: string; selected: boolean; onPress: () => void; isLast: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16,
        borderBottomWidth: isLast ? 0 : 1, borderBottomColor: colors.border,
        backgroundColor: selected ? colors.brand.mist : 'transparent',
      }}
    >
      <Clock size={16} color={selected ? colors.brand.DEFAULT : colors.muted} strokeWidth={1.75} />
      <Text style={{
        flex: 1, fontSize: 14,
        fontWeight: selected ? '700' : '500',
        color: selected ? colors.brand.DEFAULT : colors.ink,
        marginLeft: 12,
      }}>
        {label}
      </Text>
      {selected && (
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center' }}>
          <Check size={14} color="#fff" strokeWidth={2.5} />
        </View>
      )}
    </Pressable>
  );
}
