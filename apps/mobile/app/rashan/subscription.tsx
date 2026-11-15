import { View, Text, ScrollView, Pressable, Modal, ActivityIndicator, Image, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState, useMemo } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Pause,
  Play,
  Pencil,
  SkipForward,
  Trash2,
  Info,
  Check,
  ShoppingBasket,
  Bike,
  Car,
  Truck,
  Phone,
  MessageCircle,
  Package,
  PackageCheck,
  Calendar,
  RefreshCw,
  Wallet,
  AlertTriangle,
} from 'lucide-react-native';
import {
  useProductsByIds,
  useRashanSubscriptions,
  usePauseSubscription,
  useResumeSubscription,
  useCancelSubscription,
  useSkipNextDelivery,
  useConfirmNextDelivery,
  resolveImageUrl,
  type RashanFrequency,
} from '@grocery-app/shared';
import { colors } from '../../src/constants/colors';
import { useLanguageStore } from '../../src/stores/languageStore';

const FREQUENCIES: { id: RashanFrequency; label_es: string; label_en: string }[] = [
  { id: 'biweekly', label_es: 'Cada 2 semanas', label_en: 'Every 2 weeks' },
  { id: 'monthly', label_es: 'Cada mes', label_en: 'Every month' },
  { id: 'every_6_weeks', label_es: 'Cada 6 semanas', label_en: 'Every 6 weeks' },
];

function daysUntil(iso: string): number {
  const target = new Date(iso);
  const today = new Date();
  target.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatLong(iso: string, lang: 'en' | 'es'): string {
  return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function HeroStat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <View style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 12, gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Icon size={10} color="rgba(255,255,255,0.7)" strokeWidth={2.25} />
        <Text style={{ fontSize: 9.5, fontWeight: '800', color: 'rgba(255,255,255,0.7)', letterSpacing: 1.1, textTransform: 'uppercase' }}>
          {label}
        </Text>
      </View>
      <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '800', color: '#fff', letterSpacing: -0.2 }}>
        {value}
      </Text>
      {sub && (
        <Text numberOfLines={1} style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.7)' }}>
          {sub}
        </Text>
      )}
    </View>
  );
}

function SectionHeading({ children }: { children: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, marginLeft: 4 }}>
      <View style={{ width: 3, height: 12, borderRadius: 2, backgroundColor: colors.brand.DEFAULT }} />
      <Text style={{ fontSize: 10, fontWeight: '800', color: colors.charcoal, letterSpacing: 1.5, textTransform: 'uppercase' }}>
        {children}
      </Text>
    </View>
  );
}

type IconKind = typeof Pause;
type ActionTone = 'mint' | 'sand' | 'dune' | 'mist' | 'danger';
const actionToneBg: Record<ActionTone, string> = {
  mint: colors.surface.mint,
  sand: colors.surface.sand,
  dune: colors.surface.dune,
  mist: colors.brand.mist,
  danger: colors.dangerBg,
};
const actionToneFg: Record<ActionTone, string> = {
  mint: colors.brand.deepest,
  sand: colors.charcoal,
  dune: colors.charcoal,
  mist: colors.brand.deepest,
  danger: colors.danger,
};

function TileActionRow({
  icon: Icon,
  tone,
  label,
  hint,
  onPress,
  danger,
  disabled,
  showChevron = true,
}: {
  icon: IconKind;
  tone: ActionTone;
  label: string;
  hint?: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  showChevron?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 12, paddingHorizontal: 16,
        backgroundColor: pressed ? colors.surface.linen : 'transparent',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <View style={{
        width: 40, height: 40, borderRadius: 12,
        backgroundColor: actionToneBg[tone],
        alignItems: 'center', justifyContent: 'center',
        marginRight: 14,
      }}>
        <Icon size={18} color={actionToneFg[tone]} strokeWidth={1.75} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14.5, fontWeight: '700', color: danger ? colors.danger : colors.ink, letterSpacing: -0.2 }}>
          {label}
        </Text>
        {hint && (
          <Text numberOfLines={1} style={{ fontSize: 11.5, color: colors.muted, marginTop: 1 }}>
            {hint}
          </Text>
        )}
      </View>
      {showChevron && !danger && (
        <ChevronRight size={16} color={colors.muted} strokeWidth={1.75} />
      )}
    </Pressable>
  );
}

export default function RashanSubscriptionScreen() {
  const router = useRouter();
  const { t, lang } = useLanguageStore();

  const { data: subs, isLoading } = useRashanSubscriptions();

  const sub = subs?.find((s) => s.status !== 'cancelled') ?? null;

  // Resolved BY ID, not by scanning a page of the catalogue. `useProducts`
  // was asked for 200 rows, but the API caps a page at 60 — so any pack item
  // outside those 60 silently priced as €0 and rendered as a blank row.
  const { data: itemProducts } = useProductsByIds(
    useMemo(() => (sub?.items ?? []).map((i) => i.product_id), [sub]),
  );
  const products = itemProducts ?? [];

  const skipMutation = useSkipNextDelivery();
  const confirmMutation = useConfirmNextDelivery();
  const pauseMutation = usePauseSubscription();
  const resumeMutation = useResumeSubscription();
  const cancelMutation = useCancelSubscription();

  const [confirmCancel, setConfirmCancel] = useState(false);

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={colors.brand.DEFAULT} />
        </View>
      </SafeAreaView>
    );
  }

  if (!sub) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 12,
          paddingHorizontal: 12, paddingVertical: 10,
          backgroundColor: '#fff',
          borderBottomWidth: 1, borderBottomColor: 'rgba(226,232,240,0.7)',
        }}>
          <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' }}>
            <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
          </Pressable>
          <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: colors.ink }} numberOfLines={1}>
            {t('rashan.sub.title')}
          </Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.brand.mist, justifyContent: 'center', alignItems: 'center', marginBottom: 22 }}>
            <ShoppingBasket size={36} color={colors.brand.DEFAULT} strokeWidth={1.5} />
          </View>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
            {t('rashan.sub.no_sub_title')}
          </Text>
          <Text style={{ fontSize: 14, color: colors.gray, textAlign: 'center', marginTop: 10, lineHeight: 20 }}>
            {t('rashan.sub.no_sub_desc')}
          </Text>
          <Pressable
            onPress={() => router.replace('/(tabs)/rashan')}
            style={{ marginTop: 24, height: 50, paddingHorizontal: 28, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>
              {t('rashan.sub.no_sub_cta')}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const tpl = sub.pack;
  const nextDeliveryIso = sub.next_delivery_date ?? new Date().toISOString();
  const days = daysUntil(nextDeliveryIso);
  const freq = FREQUENCIES.find((f) => f.id === sub.frequency)!;
  const total = Number(sub.total_per_cycle);
  const showConfirmBanner = sub.status === 'active' && sub.needs_confirmation;

  const upcomingDelivery = sub.deliveries?.find((d) =>
    ['scheduled', 'awaiting_confirmation', 'confirmed', 'preparing', 'on_the_way'].includes(d.status),
  );
  const nextRider = upcomingDelivery?.rider ?? null;
  const RiderIcon =
    nextRider?.vehicle_type === 'bicicleta' ? Bike :
    nextRider?.vehicle_type === 'coche' ? Car :
    Truck;
  const vehicleLabel =
    nextRider?.vehicle_type === 'bicicleta' ? (lang === 'en' ? 'Bicycle' : 'Bicicleta') :
    nextRider?.vehicle_type === 'coche' ? (lang === 'en' ? 'Car' : 'Coche') :
    (lang === 'en' ? 'Motorbike' : 'Moto');
  const dayLabel =
    days === 0 ? t('rashan.sub.today') : days === 1 ? t('rashan.sub.tomorrow') : t('rashan.sub.in_days', { n: days });

  // Live delivery status banner config — only surfaces the in-flight states.
  type StatusKind = 'confirmed' | 'preparing' | 'on_the_way';
  const statusInfo: { kind: StatusKind; title: string; desc: string; icon: any } | null =
    upcomingDelivery?.status === 'on_the_way'
      ? {
          kind: 'on_the_way',
          title: lang === 'en' ? 'Your rider is on the way!' : '¡Tu repartidor está en camino!',
          desc:
            lang === 'en'
              ? nextRider
                ? `${nextRider.name} is heading to your address now.`
                : 'Your pack is out for delivery right now.'
              : nextRider
                ? `${nextRider.name} se dirige a tu dirección ahora.`
                : 'Tu pack está saliendo para la entrega.',
          icon: Truck,
        }
      : upcomingDelivery?.status === 'preparing'
      ? {
          kind: 'preparing',
          title: lang === 'en' ? 'We’re preparing your pack' : 'Estamos preparando tu pack',
          desc:
            lang === 'en'
              ? 'Our team is packing your groceries. We’ll let you know when the rider sets off.'
              : 'Nuestro equipo está preparando tus productos. Te avisaremos cuando salga el repartidor.',
          icon: Package,
        }
      : upcomingDelivery?.status === 'confirmed'
      ? {
          kind: 'confirmed',
          title: lang === 'en' ? 'Delivery confirmed' : 'Entrega confirmada',
          desc:
            lang === 'en'
              ? `Your pack is locked in for ${formatLong(upcomingDelivery.scheduled_date, lang)}.`
              : `Tu pack está confirmado para el ${formatLong(upcomingDelivery.scheduled_date, lang)}.`,
          icon: PackageCheck,
        }
      : null;

  const gradient: [string, string] = tpl?.slug === 'premium'
    ? ['#3E2723', '#8D6E63']
    : tpl?.slug === 'essentials'
      ? ['#022B91', '#2A6AEF']
      : ['#D8B27C', '#E8CDA3'];

  const handleEdit = () => {
    router.push(`/rashan/pack/${sub.pack_slug ?? 'custom'}?edit=${sub.id}`);
  };
  const handleConfirm = () => confirmMutation.mutate(sub.id);
  const handleSkip = () => skipMutation.mutate(sub.id);
  const handlePause = () => pauseMutation.mutate(sub.id);
  const handleResume = () => resumeMutation.mutate(sub.id);
  const handleCancel = () => {
    cancelMutation.mutate({ id: sub.id }, {
      onSuccess: () => {
        setConfirmCancel(false);
        router.replace('/(tabs)/rashan');
      },
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: 12, paddingVertical: 10,
        backgroundColor: '#fff',
        borderBottomWidth: 1, borderBottomColor: 'rgba(226,232,240,0.7)',
      }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' }}>
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: colors.ink }} numberOfLines={1}>
          {t('rashan.sub.title')}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Hero */}
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            borderRadius: 22,
            paddingHorizontal: 20, paddingTop: 18, paddingBottom: 18,
            marginBottom: 16,
            overflow: 'hidden',
          }}
        >
          {/* Decorative blobs — match the profile/edit-profile hero language */}
          <View style={{ position: 'absolute', top: -50, right: -40, width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,255,255,0.10)' }} />
          <View style={{ position: 'absolute', bottom: -40, left: -30, width: 130, height: 130, borderRadius: 65, backgroundColor: 'rgba(255,255,255,0.07)' }} />

          {/* Top row — status pill + cycle countdown chip */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              backgroundColor: 'rgba(255,255,255,0.18)',
              paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)',
            }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: sub.status === 'active' ? '#86EFAC' : colors.amber.mid }} />
              <Text style={{ fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 1.5 }}>
                {sub.status === 'active' ? t('rashan.sub.status_active') : t('rashan.sub.status_paused')}
              </Text>
            </View>
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              backgroundColor: 'rgba(255,255,255,0.16)',
              paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
            }}>
              <Calendar size={10} color="#fff" strokeWidth={2.25} />
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff', letterSpacing: 0.4 }}>
                {dayLabel}
              </Text>
            </View>
          </View>

          {/* Pack identity */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View style={{
              width: 58, height: 58, borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.95)',
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)',
              overflow: 'hidden',
            }}>
              {/* Cover photo when the pack has one, same precedence as the
                  landing card and the builder header; emoji is the fallback
                  for packs that predate covers. */}
              {tpl?.cover_url ? (
                <Image
                  source={{ uri: resolveImageUrl(tpl.cover_url, 'tile') }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                />
              ) : (
                <Text style={{ fontSize: 28 }}>{tpl?.emoji ?? '🛒'}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.7)', letterSpacing: 1.3, textTransform: 'uppercase' }}>
                {lang === 'en' ? 'Your pack' : 'Tu pack'}
              </Text>
              <Text numberOfLines={1} style={{ fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: -0.5, marginTop: 2 }}>
                {tpl ? (lang === 'en' ? tpl.name_en : tpl.name_es) : ''}
              </Text>
            </View>
          </View>

          {/* Translucent stat panel */}
          <View style={{
            marginTop: 16,
            backgroundColor: 'rgba(255,255,255,0.12)',
            borderRadius: 16,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
            flexDirection: 'row',
          }}>
            <HeroStat
              icon={Calendar}
              label={t('rashan.sub.next_delivery')}
              value={formatLong(nextDeliveryIso, lang).split(',')[0]}
              sub={formatLong(nextDeliveryIso, lang).split(',').slice(1).join(',').trim() || dayLabel}
            />
            <View style={{ width: 1, marginVertical: 12, backgroundColor: 'rgba(255,255,255,0.16)' }} />
            <HeroStat
              icon={RefreshCw}
              label={t('rashan.builder.frequency')}
              value={lang === 'en' ? freq.label_en : freq.label_es}
            />
            <View style={{ width: 1, marginVertical: 12, backgroundColor: 'rgba(255,255,255,0.16)' }} />
            <HeroStat
              icon={Wallet}
              label={t('rashan.builder.total')}
              value={`€${total.toFixed(2)}`}
              sub={lang === 'en' ? 'per cycle' : 'por ciclo'}
            />
          </View>
        </LinearGradient>

        {/* Live delivery status banner */}
        {statusInfo && (
          <View
            style={{
              backgroundColor:
                statusInfo.kind === 'on_the_way'
                  ? colors.brand.deepest
                  : statusInfo.kind === 'preparing'
                    ? colors.brand.mist
                    : colors.surface.cream,
              borderRadius: 8,
              borderWidth: 1,
              borderColor:
                statusInfo.kind === 'on_the_way'
                  ? colors.brand.deepest
                  : statusInfo.kind === 'preparing'
                    ? colors.brand.soft
                    : colors.border,
              padding: 14,
              marginBottom: 16,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor:
                  statusInfo.kind === 'on_the_way' ? 'rgba(255,255,255,0.18)' : colors.brand.soft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <statusInfo.icon
                size={20}
                color={statusInfo.kind === 'on_the_way' ? '#fff' : colors.brand.deepest}
                strokeWidth={2}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: '700',
                  color: statusInfo.kind === 'on_the_way' ? 'rgba(255,255,255,0.7)' : colors.muted,
                  letterSpacing: 1.2,
                }}
              >
                {(lang === 'en' ? 'Delivery status' : 'Estado de entrega').toUpperCase()}
              </Text>
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: '700',
                  color: statusInfo.kind === 'on_the_way' ? '#fff' : colors.ink,
                  marginTop: 2,
                }}
                numberOfLines={1}
              >
                {statusInfo.title}
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: statusInfo.kind === 'on_the_way' ? 'rgba(255,255,255,0.85)' : colors.charcoal,
                  marginTop: 1,
                }}
              >
                {statusInfo.desc}
              </Text>
            </View>
          </View>
        )}

        {/* Rider card — shown when ops has assigned a rider to the upcoming delivery */}
        {nextRider && (() => {
          const initials = nextRider.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
          const waPhone = nextRider.phone.replace(/[^\d]/g, '');
          return (
            <View style={{ backgroundColor: colors.surface.cream, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)' }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 14 }}>
                {lang === 'en' ? 'Your Rider' : 'Tu Repartidor'}
              </Text>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brand.mist, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.brand.deepest }}>
                    {initials}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }} numberOfLines={1}>
                    {nextRider.name}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                    <RiderIcon size={13} color={colors.muted} strokeWidth={1.75} />
                    <Text style={{ fontSize: 12, color: colors.muted }}>{vehicleLabel}</Text>
                  </View>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  onPress={() => Linking.openURL(`tel:${nextRider.phone}`)}
                  style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: colors.brand.DEFAULT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  <Phone size={15} color="#fff" strokeWidth={2} />
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>
                    {lang === 'en' ? 'Call' : 'Llamar'}
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
            </View>
          );
        })()}

        {/* Confirm banner */}
        {showConfirmBanner && (
          <View style={{ backgroundColor: colors.amber.mist, borderRadius: 8, padding: 16, borderWidth: 1, borderColor: colors.amber.mid, marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <ShoppingBasket size={18} color={colors.amber.deep} strokeWidth={1.75} />
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, flex: 1 }}>
                {t('rashan.sub.confirm_title')}
              </Text>
            </View>
            <Text style={{ fontSize: 13, color: colors.charcoal, marginBottom: 12 }}>
              {t('rashan.sub.confirm_desc')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={handleConfirm}
                disabled={confirmMutation.isPending}
                style={{ flex: 1, height: 40, borderRadius: 10, backgroundColor: colors.brand.DEFAULT, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 6, opacity: confirmMutation.isPending ? 0.6 : 1 }}
              >
                <Check size={13} color="#fff" strokeWidth={2.5} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>
                  {t('rashan.sub.confirm_keep')}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleEdit}
                style={{ flex: 1, height: 40, borderRadius: 10, backgroundColor: colors.surface.cream, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 6 }}
              >
                <Pencil size={12} color={colors.ink} strokeWidth={2} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink }}>
                  {t('rashan.sub.confirm_edit')}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleSkip}
                disabled={skipMutation.isPending}
                style={{ flex: 1, height: 40, borderRadius: 10, backgroundColor: colors.surface.cream, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 6, opacity: skipMutation.isPending ? 0.6 : 1 }}
              >
                <SkipForward size={12} color={colors.ink} strokeWidth={2} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink }}>
                  {t('rashan.sub.confirm_skip')}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Items */}
        <SectionHeading>{t('rashan.sub.your_pack')}</SectionHeading>
        <View style={{
          backgroundColor: '#fff',
          borderRadius: 18,
          borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
          overflow: 'hidden',
          marginBottom: 24,
        }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12,
            borderBottomWidth: 1, borderBottomColor: 'rgba(226,232,240,0.7)',
          }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: colors.muted, letterSpacing: 1, textTransform: 'uppercase' }}>
              {sub.items.length} {lang === 'en'
                ? (sub.items.length === 1 ? 'item' : 'items')
                : (sub.items.length === 1 ? 'producto' : 'productos')}
            </Text>
            <Pressable
              onPress={handleEdit}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 5,
                backgroundColor: pressed ? colors.brand.soft : colors.brand.mist,
                paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999,
              })}
            >
              <Pencil size={11} color={colors.brand.deepest} strokeWidth={2.25} />
              <Text style={{ fontSize: 12, fontWeight: '800', color: colors.brand.deepest }}>
                {t('rashan.sub.action_edit')}
              </Text>
            </Pressable>
          </View>
          {sub.items.map((it, idx) => {
            const p = products.find((x) => x.id === it.product_id);
            const v = p?.variants?.find((x) => x.id === it.variant_id);
            if (!p || !v) return null;
            const image = p.images?.find((i) => i.is_primary) ?? p.images?.[0];
            return (
              <View key={it.product_id}>
                {idx > 0 && (
                  <View style={{ height: 1, marginLeft: 76, backgroundColor: 'rgba(226,232,240,0.7)' }} />
                )}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
                  <View style={{
                    width: 48, height: 48, borderRadius: 12,
                    backgroundColor: colors.surface.linen,
                    justifyContent: 'center', alignItems: 'center', overflow: 'hidden',
                    borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
                  }}>
                    {image ? (
                      <Image source={{ uri: resolveImageUrl(image.url, 'thumb') }} style={{ width: 48, height: 48 }} />
                    ) : (
                      <Text style={{ fontSize: 22 }}>📦</Text>
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
                      {lang === 'en' ? p.name_en : p.name_es}
                    </Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 }}>
                      <Text numberOfLines={1} style={{ fontSize: 11.5, color: colors.muted }}>
                        {lang === 'en' ? v.name_en : v.name_es}
                      </Text>
                      <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, backgroundColor: colors.brand.whisper }}>
                        <Text style={{ fontSize: 10.5, fontWeight: '800', color: colors.brand.deepest, letterSpacing: 0.2 }}>×{it.quantity}</Text>
                      </View>
                    </View>
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] }}>
                    {'€'}{(Number(v.price) * it.quantity).toFixed(2)}
                  </Text>
                </View>
              </View>
            );
          })}
          {/* Total row */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14,
            borderTopWidth: 1, borderTopColor: 'rgba(226,232,240,0.7)',
            backgroundColor: colors.surface.linen,
          }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.charcoal, letterSpacing: 0.4, textTransform: 'uppercase' }}>
              {lang === 'en' ? 'Pack total' : 'Total del pack'}
            </Text>
            <Text style={{ fontSize: 16, fontWeight: '800', color: colors.ink, letterSpacing: -0.3, fontVariant: ['tabular-nums'] }}>
              €{total.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Manage subscription */}
        <SectionHeading>{t('rashan.sub.actions')}</SectionHeading>
        <View style={{
          backgroundColor: '#fff',
          borderRadius: 18,
          borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
          overflow: 'hidden',
          marginBottom: 24,
        }}>
          <TileActionRow
            icon={Pencil}
            tone="mint"
            label={t('rashan.sub.action_edit')}
            hint={lang === 'en' ? 'Change items, sizes or quantities' : 'Cambia productos, tamaños o cantidades'}
            onPress={handleEdit}
          />
          <View style={{ height: 1, marginLeft: 70, backgroundColor: 'rgba(226,232,240,0.7)' }} />
          <TileActionRow
            icon={SkipForward}
            tone="sand"
            label={t('rashan.sub.action_skip')}
            hint={lang === 'en' ? 'Move next delivery one cycle ahead' : 'Salta la próxima entrega'}
            onPress={handleSkip}
            disabled={skipMutation.isPending}
          />
          <View style={{ height: 1, marginLeft: 70, backgroundColor: 'rgba(226,232,240,0.7)' }} />
          {sub.status === 'active' ? (
            <TileActionRow
              icon={Pause}
              tone="dune"
              label={t('rashan.sub.action_pause')}
              hint={lang === 'en' ? 'Pause deliveries — resume anytime' : 'Pausa las entregas — reanuda cuando quieras'}
              onPress={handlePause}
              disabled={pauseMutation.isPending}
            />
          ) : (
            <TileActionRow
              icon={Play}
              tone="mist"
              label={t('rashan.sub.action_resume')}
              hint={lang === 'en' ? 'Restart your scheduled deliveries' : 'Reanuda tus entregas programadas'}
              onPress={handleResume}
              disabled={resumeMutation.isPending}
            />
          )}
          <View style={{ height: 1, marginLeft: 70, backgroundColor: 'rgba(226,232,240,0.7)' }} />
          <TileActionRow
            icon={Trash2}
            tone="danger"
            label={t('rashan.sub.action_cancel')}
            hint={lang === 'en' ? 'Stop the subscription permanently' : 'Detén la suscripción de forma permanente'}
            onPress={() => setConfirmCancel(true)}
            danger
            showChevron={false}
          />
        </View>

        {/* Helpful tip */}
        <View style={{
          flexDirection: 'row',
          backgroundColor: colors.brand.whisper,
          borderRadius: 16, padding: 14,
          borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
          gap: 12,
        }}>
          <View style={{
            width: 36, height: 36, borderRadius: 12,
            backgroundColor: colors.brand.mist,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Info size={16} color={colors.brand.deepest} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>
              {t('rashan.sub.tip')}
            </Text>
            <Text style={{ fontSize: 12, color: colors.charcoal, marginTop: 3, lineHeight: 17 }}>
              {t('rashan.sub.tip_desc')}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Cancel modal — matches the centered-icon dialog used for delete-review */}
      <Modal visible={confirmCancel} transparent animationType="fade" onRequestClose={() => setConfirmCancel(false)}>
        <View style={{
          flex: 1, backgroundColor: 'rgba(15,23,42,0.55)',
          justifyContent: 'center', alignItems: 'center',
          paddingHorizontal: 28,
        }}>
          <Pressable onPress={() => setConfirmCancel(false)} style={{ position: 'absolute', inset: 0 }} />
          <View style={{
            width: '100%', maxWidth: 380,
            backgroundColor: '#fff', borderRadius: 18,
            paddingHorizontal: 22, paddingTop: 28, paddingBottom: 22,
            alignItems: 'center',
            borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
          }}>
            <View style={{
              width: 56, height: 56, borderRadius: 28,
              backgroundColor: colors.dangerBg,
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 16,
            }}>
              <AlertTriangle size={24} color={colors.danger} strokeWidth={2} />
            </View>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
              {t('rashan.sub.cancel_title')}
            </Text>
            <Text style={{ fontSize: 13, color: colors.gray, lineHeight: 19, textAlign: 'center', marginTop: 8 }}>
              {t('rashan.sub.cancel_desc')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 22, alignSelf: 'stretch' }}>
              <Pressable
                onPress={() => setConfirmCancel(false)}
                style={{
                  flex: 1, height: 50, borderRadius: 12,
                  borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
                  justifyContent: 'center', alignItems: 'center',
                  backgroundColor: '#fff',
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
                  {t('common.cancel')}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleCancel}
                disabled={cancelMutation.isPending}
                style={({ pressed }) => ({
                  flex: 1, height: 50, borderRadius: 12,
                  backgroundColor: pressed ? '#B91C1C' : colors.danger,
                  justifyContent: 'center', alignItems: 'center',
                  opacity: cancelMutation.isPending ? 0.6 : 1,
                })}
              >
                {cancelMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>
                    {t('rashan.sub.action_cancel')}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
