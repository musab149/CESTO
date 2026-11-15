import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ClipboardCheck,
  ChevronLeft,
  Calendar,
  Repeat,
  MapPin,
  CreditCard,
  ShieldCheck,
  ShoppingBasket,
  ArrowRight,
  Lock,
  Check,
} from 'lucide-react-native';
import {
  useProductsByIds,
  useRashanPack,
  useAddresses,
  useCreateSubscription,
  type RashanFrequency,
  type PaymentMethod,
} from '@grocery-app/shared';
import { colors } from '../../src/constants/colors';
import { useLanguageStore } from '../../src/stores/languageStore';
import { useRashanStore } from '../../src/stores/rashanStore';
import { useAuthStore } from '../../src/stores/authStore';

const FREQUENCIES: { id: RashanFrequency; label_es: string; label_en: string }[] = [
  { id: 'biweekly', label_es: 'Cada 2 semanas', label_en: 'Every 2 weeks' },
  { id: 'monthly', label_es: 'Cada mes', label_en: 'Every month' },
  { id: 'every_6_weeks', label_es: 'Cada 6 semanas', label_en: 'Every 6 weeks' },
];

function formatDate(date: Date, lang: 'en' | 'es'): string {
  return date.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function buildDateOptions(): Date[] {
  const arr: Date[] = [];
  const start = new Date();
  start.setHours(10, 0, 0, 0);
  start.setDate(start.getDate() + 2);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    arr.push(d);
  }
  return arr;
}

export default function RashanCheckoutScreen() {
  // The activate bar is absolutely positioned at bottom: 0, and from SDK 54 the
  // app draws behind the system navigation, so bottom: 0 is UNDER it. Without
  // the inset the button sits beneath Android's 48dp three-button bar and
  // cannot be tapped at all.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, lang } = useLanguageStore();
  const draft = useRashanStore((s) => s.draft);
  const clearDraft = useRashanStore((s) => s.clearDraft);
  const leadPrefill = useRashanStore((s) => s.leadPrefill);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const { data: tpl } = useRashanPack(draft?.packSlug);
  // Resolved BY ID, not by scanning a page of the catalogue. `useProducts`
  // was asked for 200 rows, but the API caps a page at 60 — so any pack item
  // outside those 60 silently priced as €0 and rendered as a blank row.
  const { data: itemProducts } = useProductsByIds(
    useMemo(() => (draft?.items ?? []).map((i) => i.product_id), [draft]),
  );
  const products = itemProducts ?? [];
  const { data: addresses } = useAddresses();
  const createSub = useCreateSubscription();

  const dates = useMemo(() => buildDateOptions(), []);
  const [selectedDateIdx, setSelectedDateIdx] = useState(2);
  const [addressId, setAddressId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cod');
  const [success, setSuccess] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default-select the user's default address. No serviceability check —
  // every saved address is deliverable.
  if (!addressId && addresses?.length) {
    const def = addresses.find((a) => a.is_default) ?? addresses[0];
    if (def) setAddressId(def.id);
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' }}>
            <ChevronLeft size={22} color={colors.ink} strokeWidth={1.75} />
          </Pressable>
          <Text style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.ink }}>
            {t('rashan.checkout.title')}
          </Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.brand.mist, justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
            <Lock size={32} color={colors.brand.DEFAULT} strokeWidth={1.75} />
          </View>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink, marginBottom: 8, textAlign: 'center' }}>
            {lang === 'es' ? 'Inicia sesión para activar' : 'Log in to activate'}
          </Text>
          <Text style={{ fontSize: 14, color: colors.gray, textAlign: 'center', marginBottom: 24, lineHeight: 20 }}>
            {lang === 'es'
              ? 'Necesitas una cuenta para activar tu suscripción Rashan mensual.'
              : 'You need an account to activate your monthly Rashan subscription.'}
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

  if (!draft) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={{ color: colors.gray, marginBottom: 16 }}>
            {lang === 'en' ? 'No pack in progress.' : 'Sin pack en curso.'}
          </Text>
          <Pressable
            onPress={() => router.replace('/(tabs)/rashan')}
            style={{ height: 44, paddingHorizontal: 20, borderRadius: 999, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>
              {lang === 'en' ? 'Browse packs' : 'Ver packs'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const freq = FREQUENCIES.find((f) => f.id === draft.frequency)!;
  const subtotal = draft.items.reduce((sum, it) => {
    const p = products.find((x) => x.id === it.product_id);
    const v = p?.variants?.find((x) => x.id === it.variant_id);
    return sum + Number(v?.price ?? 0) * it.quantity;
  }, 0);
  const savingsPct = tpl?.estimated_savings_pct ?? 0;
  const savings = (subtotal * savingsPct) / 100;
  const total = subtotal - savings;

  const selectedAddress = addresses?.find((a) => a.id === addressId);

  const handleActivate = async () => {
    setError(null);
    if (!addressId) {
      setError(lang === 'en' ? 'Pick a delivery address.' : 'Elige una dirección.');
      return;
    }
    const d = dates[selectedDateIdx];
    try {
      await createSub.mutateAsync({
        packSlug: draft.packSlug,
        items: draft.items,
        household: draft.household,
        frequency: draft.frequency,
        addressId,
        // Carried straight through from the interest sheet so ops do not have
        // to re-read the lead to find out when this household is home.
        slotPreference: leadPrefill?.preferredSlot ?? undefined,
        paymentMethod,
        firstDeliveryDate: d.toISOString(),
      });
      clearDraft();
      setSuccess(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not activate subscription');
    }
  };

  if (success) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}>
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.brand.mist, justifyContent: 'center', alignItems: 'center', marginBottom: 22 }}>
              <ShoppingBasket size={42} color={colors.brand.DEFAULT} strokeWidth={1.75} />
            </View>
            <Text style={{ fontSize: 26, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
              {t('rashan.checkout.success_title')}
            </Text>
            <Text style={{ fontSize: 14, color: colors.gray, marginTop: 10, textAlign: 'center', lineHeight: 20, paddingHorizontal: 12 }}>
              {t('rashan.checkout.success_desc')}
            </Text>
            <View style={{ backgroundColor: colors.surface.cream, borderRadius: 8, padding: 16, marginTop: 24, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', width: '100%' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Calendar size={18} color={colors.brand.DEFAULT} strokeWidth={1.75} />
                <View>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: colors.muted, letterSpacing: 1.2 }}>
                    {t('rashan.checkout.first_delivery').toUpperCase()}
                  </Text>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginTop: 2 }}>
                    {formatDate(success, lang)}
                  </Text>
                </View>
              </View>
            </View>
            <Pressable
              onPress={() => router.replace('/rashan/subscription')}
              style={{ marginTop: 28, height: 52, paddingHorizontal: 28, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8 }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
                {t('rashan.checkout.success_cta')}
              </Text>
              <ArrowRight size={16} color="#fff" strokeWidth={2.5} />
            </Pressable>

            {/* Web offers a way out of the funnel here too. Without it the
                only route on from a completed order is the back gesture,
                which returns to a checkout whose draft has been cleared. */}
            <Pressable
              onPress={() => router.replace('/(tabs)')}
              style={{ marginTop: 12, height: 48, paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center' }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: colors.gray }}>
                {lang === 'en' ? 'Keep shopping' : 'Seguir comprando'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const submitDisabled = createSub.isPending || !addressId;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' }}>
          <ChevronLeft size={22} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.ink }}>
          {t('rashan.checkout.title')}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 140 + insets.bottom }}>
        {/* Receipt for the interest sheet: shows the household what we
            already know, so the prefilled size and cadence do not look
            arbitrary. Web also echoes the address here; mobile's shorter form
            never asks for one, so there is nothing to echo. */}
        {leadPrefill && (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.brand.whisper, borderWidth: 1, borderColor: colors.brand.mist, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }}>
            <ClipboardCheck size={16} color={colors.brand.DEFAULT} strokeWidth={1.75} style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, fontSize: 13, color: colors.ink, lineHeight: 19 }}>
              {lang === 'en'
                ? `Filled in from your request — a family of ${leadPrefill.household}.`
                : `Rellenado desde tu solicitud — una familia de ${leadPrefill.household}.`}
            </Text>
          </View>
        )}

        {/* Pack summary */}
        {tpl && (
          <View style={{ backgroundColor: colors.surface.cream, borderRadius: 8, padding: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ fontSize: 34 }}>{tpl.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>
                  {lang === 'en' ? tpl.name_en : tpl.name_es}
                </Text>
                <Text style={{ fontSize: 12, color: colors.gray }}>
                  {draft.items.length} {t('rashan.builder.items')} ·{' '}
                  {lang === 'en' ? freq.label_en : freq.label_es}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* First delivery */}
        <View style={{ backgroundColor: colors.surface.cream, borderRadius: 8, padding: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.brand.mist, justifyContent: 'center', alignItems: 'center' }}>
              <Calendar size={16} color={colors.brand.deepest} strokeWidth={1.75} />
            </View>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
              {t('rashan.checkout.first_delivery')}
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
            {dates.map((d, i) => {
              const active = selectedDateIdx === i;
              return (
                <Pressable
                  key={i}
                  onPress={() => setSelectedDateIdx(i)}
                  style={{
                    width: 74, paddingVertical: 12, borderRadius: 12,
                    borderWidth: 1,
                    borderColor: active ? colors.brand.DEFAULT : colors.border,
                    backgroundColor: active ? colors.brand.mist : colors.surface.cream,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 10, fontWeight: '700', color: active ? colors.brand.deepest : colors.muted, letterSpacing: 0.5 }}>
                    {d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { weekday: 'short' }).toUpperCase()}
                  </Text>
                  <Text style={{ fontSize: 20, fontWeight: '700', color: active ? colors.brand.deepest : colors.ink, marginTop: 4 }}>
                    {d.getDate()}
                  </Text>
                  <Text style={{ fontSize: 10, fontWeight: '600', color: active ? colors.brand.deepest : colors.muted, marginTop: 2 }}>
                    {d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { month: 'short' })}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* Frequency */}
        <View style={{ backgroundColor: colors.surface.cream, borderRadius: 8, padding: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colors.surface.mint, justifyContent: 'center', alignItems: 'center' }}>
            <Repeat size={18} color={colors.brand.deepest} strokeWidth={1.75} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted, letterSpacing: 1.2 }}>
              {t('rashan.checkout.frequency').toUpperCase()}
            </Text>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 2 }}>
              {lang === 'en' ? freq.label_en : freq.label_es}
            </Text>
          </View>
        </View>

        {/* Address */}
        <View style={{ backgroundColor: colors.surface.cream, borderRadius: 8, padding: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.brand.mist, justifyContent: 'center', alignItems: 'center' }}>
              <MapPin size={16} color={colors.brand.deepest} strokeWidth={1.75} />
            </View>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
              {t('rashan.checkout.address')}
            </Text>
          </View>
          {!addresses || addresses.length === 0 ? (
            <View style={{ backgroundColor: colors.surface.linen, borderRadius: 12, padding: 14, alignItems: 'center' }}>
              <Text style={{ fontSize: 13, color: colors.charcoal, marginBottom: 10 }}>
                {t('rashan.checkout.no_address')}
              </Text>
              <Pressable
                onPress={() => router.push('/addresses')}
                style={{ height: 38, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center' }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>
                  {t('rashan.checkout.add_address')}
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
                      borderRadius: 12,
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      borderWidth: 2,
                      borderColor: selected ? colors.brand.DEFAULT : colors.border,
                      backgroundColor: selected ? colors.brand.mist : colors.surface.cream,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>
                      {a.contact_name}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.charcoal, marginTop: 2 }}>
                      {a.street_line_1}, {a.postcode} {a.city}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {/* Payment */}
        <View style={{ backgroundColor: colors.surface.cream, borderRadius: 8, padding: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.brand.mist, justifyContent: 'center', alignItems: 'center' }}>
              <CreditCard size={16} color={colors.brand.deepest} strokeWidth={1.75} />
            </View>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
              {t('rashan.checkout.payment')}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['cod', 'card'] as PaymentMethod[]).map((m) => {
              const active = paymentMethod === m;
              const label = m === 'cod' ? t('rashan.checkout.payment_cod') : t('rashan.checkout.payment_card');
              return (
                <Pressable
                  key={m}
                  onPress={() => setPaymentMethod(m)}
                  style={{
                    flex: 1,
                    paddingVertical: 14,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    borderWidth: 2,
                    borderColor: active ? colors.brand.DEFAULT : colors.border,
                    backgroundColor: active ? colors.brand.mist : colors.surface.cream,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Totals */}
        <View style={{ backgroundColor: colors.surface.cream, borderRadius: 8, padding: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', marginBottom: 12 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink, marginBottom: 8 }}>
            {t('rashan.checkout.summary')}
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
            <Text style={{ fontSize: 13, color: colors.gray }}>{t('rashan.builder.subtotal')}</Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>{'€'}{subtotal.toFixed(2)}</Text>
          </View>
          {savings > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
              <Text style={{ fontSize: 13, color: colors.brand.DEFAULT, fontWeight: '600' }}>
                {t('rashan.builder.savings')} ({savingsPct}%)
              </Text>
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.brand.DEFAULT }}>
                −{'€'}{savings.toFixed(2)}
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
            <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>
              {'€'}{total.toFixed(2)}
            </Text>
          </View>
        </View>

        {error && (
          <View style={{ backgroundColor: colors.danger + '15', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.danger + '40', marginBottom: 12 }}>
            <Text style={{ fontSize: 12, color: colors.danger }}>{error}</Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', backgroundColor: colors.brand.whisper, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: colors.brand.mist, gap: 10 }}>
          <ShieldCheck size={16} color={colors.brand.DEFAULT} strokeWidth={2} />
          <Text style={{ flex: 1, fontSize: 12, color: colors.charcoal, lineHeight: 17 }}>
            {t('rashan.checkout.guarantee')}
          </Text>
        </View>
      </ScrollView>

      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 16), backgroundColor: colors.surface.cream, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Pressable
          onPress={handleActivate}
          disabled={submitDisabled}
          style={{
            height: 52,
            borderRadius: 12,
            backgroundColor: submitDisabled ? colors.muted : colors.brand.DEFAULT,
            justifyContent: 'center',
            alignItems: 'center',
            flexDirection: 'row',
            gap: 8,
            opacity: submitDisabled ? 0.6 : 1,
          }}
        >
          {createSub.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Check size={16} color="#fff" strokeWidth={2.5} />
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
                {t('rashan.checkout.confirm')}
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
