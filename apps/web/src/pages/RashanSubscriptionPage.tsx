import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
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
  Sparkles,
} from 'lucide-react';
import {
  useProducts,
  useRashanSubscriptions,
  usePauseSubscription,
  useResumeSubscription,
  useCancelSubscription,
  useSkipNextDelivery,
  useConfirmNextDelivery,
  resolveImageUrl,
  type RashanFrequency,
} from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';

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

export default function RashanSubscriptionPage() {
  const navigate = useNavigate();
  const { t, lang } = useLanguageStore();

  const { data: subs, isLoading } = useRashanSubscriptions();
  const { data: productsPage } = useProducts({ limit: 200 });
  const products = productsPage?.items ?? [];

  const sub = subs?.find((s) => s.status !== 'cancelled') ?? null;

  const skipMutation = useSkipNextDelivery();
  const confirmMutation = useConfirmNextDelivery();
  const pauseMutation = usePauseSubscription();
  const resumeMutation = useResumeSubscription();
  const cancelMutation = useCancelSubscription();

  const [confirmCancel, setConfirmCancel] = useState(false);

  if (isLoading) {
    return (
      <div className="bg-surface-linen min-h-screen">
        <div className="max-w-3xl mx-auto px-6 py-20 text-center">
          <p className="text-gray font-body">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  /* ───── Empty state ───── */
  if (!sub) {
    return (
      <div className="bg-surface-linen min-h-screen pb-20">
        <div className="max-w-2xl mx-auto px-4 lg:px-6 pt-12 text-center">
          <div className="bg-card rounded-2xl border border-border/60 p-10 md:p-12 shadow-card">
            <div className="w-20 h-20 rounded-full bg-brand-mist mx-auto flex items-center justify-center mb-6">
              <ShoppingBasket size={36} strokeWidth={1.5} className="text-brand" />
            </div>
            <h1 className="font-display text-[26px] md:text-[30px] text-ink tracking-tight" style={{ fontWeight: 600 }}>
              {t('rashan.sub.no_sub_title')}
            </h1>
            <p className="text-[14px] text-gray font-body mt-2 max-w-md mx-auto leading-relaxed">
              {t('rashan.sub.no_sub_desc')}
            </p>
            <button
              onClick={() => navigate('/rashan')}
              className="mt-6 h-12 px-7 bg-brand text-white rounded-full text-[13px] font-bold font-ui hover:bg-brand-deepest transition-colors inline-flex items-center gap-2"
            >
              {t('rashan.sub.no_sub_cta')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tpl = sub.pack;
  const nextDeliveryIso = sub.next_delivery_date ?? new Date().toISOString();
  const days = daysUntil(nextDeliveryIso);
  const freq = FREQUENCIES.find((f) => f.id === sub.frequency)!;
  const total = Number(sub.total_per_cycle);

  const showConfirmBanner = sub.status === 'active' && sub.needs_confirmation;
  const dayLabel =
    days === 0 ? t('rashan.sub.today') : days === 1 ? t('rashan.sub.tomorrow') : t('rashan.sub.in_days').replace('{n}', String(days));

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

  type StatusKind = 'confirmed' | 'preparing' | 'on_the_way';
  const statusInfo: { kind: StatusKind; title: string; desc: string; icon: typeof Truck; pulse: boolean } | null =
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
          pulse: true,
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
          pulse: false,
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
          pulse: false,
        }
      : null;

  const handleEdit = () => {
    navigate(`/rashan/pack/${sub.pack_slug ?? 'custom'}?edit=${sub.id}`);
  };

  const handleConfirm = () => confirmMutation.mutate(sub.id);
  const handleSkip = () => skipMutation.mutate(sub.id);
  const handlePause = () => pauseMutation.mutate(sub.id);
  const handleResume = () => resumeMutation.mutate(sub.id);
  const handleCancel = () => {
    cancelMutation.mutate({ id: sub.id }, {
      onSuccess: () => { setConfirmCancel(false); navigate('/rashan'); },
    });
  };

  return (
    <div className="bg-surface-linen min-h-screen pb-24">
      <div className="max-w-[1100px] mx-auto px-4 lg:px-6 pt-6">
        <div className="mb-6">
          <span className="inline-flex items-center gap-2 bg-brand-mist text-brand text-[10.5px] font-bold tracking-[0.16em] uppercase px-3 py-1.5 rounded-full font-ui">
            <ShoppingBasket size={11} strokeWidth={2.5} />
            {t('rashan.hero.eyebrow')}
          </span>
          <h1 className="font-display text-[28px] md:text-[36px] text-ink tracking-tight leading-[1.05] mt-3" style={{ fontWeight: 600 }}>
            {t('rashan.sub.title')}
          </h1>
        </div>

        {/* Hero card — softer, on-brand */}
        <div className="relative overflow-hidden rounded-2xl border border-border bg-surface-cream p-7 md:p-9 mb-5">
          <div className="absolute -top-16 -right-12 w-[320px] h-[320px] rounded-full bg-brand-mist/70 blur-3xl pointer-events-none" />
          {/* Framed panel rather than a background image — see the same
              treatment on the builder hero. */}
          {tpl?.cover_url ? (
            <div className="hidden sm:block absolute right-5 top-1/2 -translate-y-1/2 w-[190px] h-[130px] rounded-xl overflow-hidden border border-border shadow-card pointer-events-none">
              <img src={resolveImageUrl(tpl.cover_url, 'tile')} alt="" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[140px] opacity-90 leading-none select-none pointer-events-none">
              {tpl?.emoji ?? '🛒'}
            </div>
          )}

          <div className="relative max-w-2xl">
            <div className="flex items-center gap-2 mb-3">
              <span className={`inline-flex items-center gap-1.5 text-[10.5px] font-bold font-ui tracking-[0.16em] uppercase px-3 py-1.5 rounded-full ${
                sub.status === 'active'
                  ? 'bg-brand-mist text-brand'
                  : 'bg-amber-mist text-amber-deep'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${sub.status === 'active' ? 'bg-brand' : 'bg-amber-deep'}`} />
                {sub.status === 'active' ? t('rashan.sub.status_active') : t('rashan.sub.status_paused')}
              </span>
            </div>
            <h2 className="font-display text-[26px] md:text-[34px] text-ink tracking-tight leading-[1.05]" style={{ fontWeight: 600 }}>
              {tpl ? (lang === 'en' ? tpl.name_en : tpl.name_es) : ''}
            </h2>
            <div className="mt-5 flex flex-wrap gap-x-7 gap-y-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] font-ui font-bold text-muted">{t('rashan.sub.next_delivery')}</p>
                <p className="mt-1 font-bold text-ink font-ui text-[14px]">
                  {formatLong(nextDeliveryIso, lang)}
                  <span className="text-gray text-[13px] font-body"> · {dayLabel}</span>
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] font-ui font-bold text-muted">{t('rashan.builder.frequency')}</p>
                <p className="mt-1 font-bold text-ink font-ui text-[14px]">{lang === 'en' ? freq.label_en : freq.label_es}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] font-ui font-bold text-muted">{t('rashan.builder.total')}</p>
                <p className="mt-1 font-bold text-ink font-ui text-[14px] tabular-nums">€{total.toFixed(2)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Live delivery status */}
        {statusInfo && (
          <div
            className={`rounded-lg p-5 mb-5 flex items-center gap-4 border ${
              statusInfo.kind === 'on_the_way'
                ? 'bg-ink text-card border-ink shadow-card'
                : statusInfo.kind === 'preparing'
                ? 'bg-brand-mist text-ink border-brand-mist'
                : 'bg-card text-ink border-border/60'
            }`}
          >
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${
                statusInfo.kind === 'on_the_way' ? 'bg-white/15' : 'bg-white/70'
              } ${statusInfo.pulse ? 'animate-pulse' : ''}`}
            >
              <statusInfo.icon
                size={22}
                strokeWidth={1.75}
                className={statusInfo.kind === 'on_the_way' ? 'text-white' : 'text-brand'}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p
                className={`text-[10px] uppercase tracking-[0.16em] font-ui font-bold ${
                  statusInfo.kind === 'on_the_way' ? 'text-white/70' : 'text-muted'
                }`}
              >
                {lang === 'en' ? 'Delivery status' : 'Estado de entrega'}
              </p>
              <p className="font-display text-[16px] mt-0.5 truncate tracking-tight" style={{ fontWeight: 600 }}>
                {statusInfo.title}
              </p>
              <p
                className={`text-[12.5px] font-body mt-0.5 ${
                  statusInfo.kind === 'on_the_way' ? 'text-white/85' : 'text-gray'
                }`}
              >
                {statusInfo.desc}
              </p>
            </div>
          </div>
        )}

        {/* Rider card */}
        {nextRider && (() => {
          const initials = nextRider.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
          const waPhone = nextRider.phone.replace(/[^\d]/g, '');
          return (
            <div className="bg-card border border-border/60 rounded-lg p-5 mb-5">
              <div className="flex items-center gap-2 mb-3">
                <Truck size={15} className="text-brand" />
                <h3 className="text-[11px] font-bold text-ink font-ui uppercase tracking-[0.16em]">
                  {t('order.your_rider')}
                </h3>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-brand-mist text-brand flex items-center justify-center font-bold font-ui text-[14px] shrink-0">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold text-ink font-ui leading-tight truncate">{nextRider.name}</p>
                  <p className="text-[12px] text-muted font-ui mt-0.5 flex items-center gap-1.5">
                    <RiderIcon size={12} strokeWidth={1.75} />
                    {vehicleLabel}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={`tel:${nextRider.phone}`}
                    className="h-10 px-4 rounded-full bg-brand text-white text-[12px] font-bold font-ui inline-flex items-center justify-center gap-1.5 hover:bg-brand-deepest transition-colors"
                  >
                    <Phone size={13} strokeWidth={2} />
                    {t('order.call_rider')}
                  </a>
                  <a
                    href={`https://wa.me/${waPhone}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-10 px-4 rounded-full border border-border bg-card text-ink text-[12px] font-bold font-ui inline-flex items-center justify-center gap-1.5 hover:border-brand hover:text-brand transition-colors"
                  >
                    <MessageCircle size={13} strokeWidth={2} className="text-success" />
                    WhatsApp
                  </a>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Confirmation banner */}
        {showConfirmBanner && (
          <div className="bg-amber-mist border border-amber-mid rounded-lg p-5 mb-5 flex flex-col md:flex-row md:items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-deep/20 flex items-center justify-center shrink-0">
              <Sparkles size={20} strokeWidth={1.75} className="text-amber-deep" />
            </div>
            <div className="flex-1">
              <p className="font-display text-[16px] text-ink tracking-tight" style={{ fontWeight: 600 }}>
                {t('rashan.sub.confirm_title')}
              </p>
              <p className="text-[13px] text-gray font-body mt-1">{t('rashan.sub.confirm_desc')}</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 shrink-0">
              <button
                onClick={handleConfirm}
                disabled={confirmMutation.isPending}
                className="h-10 px-4 bg-brand text-white rounded-full text-[12.5px] font-bold font-ui hover:bg-brand-deepest transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Check size={13} strokeWidth={2.5} />
                {t('rashan.sub.confirm_keep')}
              </button>
              <button
                onClick={handleEdit}
                className="h-10 px-4 bg-card border border-border text-ink rounded-full text-[12.5px] font-bold font-ui hover:border-brand hover:text-brand transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <Pencil size={12} strokeWidth={2} />
                {t('rashan.sub.confirm_edit')}
              </button>
              <button
                onClick={handleSkip}
                disabled={skipMutation.isPending}
                className="h-10 px-4 bg-card border border-border text-ink rounded-full text-[12.5px] font-bold font-ui hover:border-ink transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <SkipForward size={12} strokeWidth={2} />
                {t('rashan.sub.confirm_skip')}
              </button>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-[1fr,340px] gap-5 items-start">
          {/* LEFT — items list */}
          <div className="bg-card rounded-lg border border-border/60 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-[18px] text-ink tracking-tight" style={{ fontWeight: 600 }}>
                {t('rashan.sub.your_pack')}
              </h3>
              <button
                onClick={handleEdit}
                className="h-9 px-4 bg-brand-mist text-brand rounded-full text-[12px] font-bold font-ui hover:bg-brand hover:text-white transition-colors inline-flex items-center gap-1.5"
              >
                <Pencil size={12} strokeWidth={2} />
                {t('rashan.sub.action_edit')}
              </button>
            </div>
            <div className="divide-y divide-border/50">
              {sub.items.map((it) => {
                const p = products.find((x) => x.id === it.product_id);
                const v = p?.variants?.find((x) => x.id === it.variant_id);
                if (!p || !v) return null;
                const image = p.images?.find((i) => i.is_primary) ?? p.images?.[0];
                const name = lang === 'en' ? p.name_en : p.name_es;
                return (
                  <div key={it.product_id} className="flex items-center gap-4 py-3.5">
                    <div className="photo-well w-14 h-14 rounded-lg bg-surface-linen overflow-hidden shrink-0 border border-border/40">
                      {image && <img src={resolveImageUrl(image.url, 'thumb')} alt={name} className="w-full h-full object-cover" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13.5px] font-bold text-ink font-ui truncate">{name}</p>
                      <p className="text-[11.5px] text-muted font-ui">{lang === 'en' ? v.name_en : v.name_es}</p>
                    </div>
                    <span className="w-7 h-7 rounded-md bg-brand-mist text-brand font-bold font-ui flex items-center justify-center text-[11px] tabular-nums shrink-0">
                      ×{it.quantity}
                    </span>
                    <span className="w-16 text-right text-[13.5px] font-bold text-ink font-ui tabular-nums">
                      €{(Number(v.price) * it.quantity).toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT — actions */}
          <aside className="space-y-3">
            <div className="bg-card rounded-lg border border-border/60 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border/60">
                <p className="text-[10.5px] font-bold font-ui text-ink uppercase tracking-[0.16em]">
                  {t('rashan.sub.actions')}
                </p>
              </div>
              <div className="divide-y divide-border/50">
                <ActionRow icon={Pencil} label={t('rashan.sub.action_edit')} onClick={handleEdit} />
                <ActionRow icon={SkipForward} label={t('rashan.sub.action_skip')} onClick={handleSkip} />
                {sub.status === 'active' ? (
                  <ActionRow icon={Pause} label={t('rashan.sub.action_pause')} onClick={handlePause} />
                ) : (
                  <ActionRow icon={Play} label={t('rashan.sub.action_resume')} onClick={handleResume} />
                )}
                <ActionRow
                  icon={Trash2}
                  label={t('rashan.sub.action_cancel')}
                  onClick={() => setConfirmCancel(true)}
                  danger
                />
              </div>
            </div>

            <div className="bg-brand-mist/40 border border-brand-mist rounded-lg p-4 flex gap-3">
              <Info size={15} strokeWidth={2} className="text-brand shrink-0 mt-0.5" />
              <div>
                <p className="text-[12px] font-bold text-ink font-ui">{t('rashan.sub.tip')}</p>
                <p className="text-[12px] text-gray font-body mt-0.5 leading-relaxed">{t('rashan.sub.tip_desc')}</p>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Cancel confirmation */}
      {confirmCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-veil/40 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-modal max-w-md w-full p-7">
            <h3 className="font-display text-[20px] text-ink tracking-tight" style={{ fontWeight: 600 }}>
              {lang === 'en' ? 'Cancel subscription?' : '¿Cancelar suscripción?'}
            </h3>
            <p className="text-[13px] text-gray font-body mt-2 leading-relaxed">
              {lang === 'en'
                ? 'You can resubscribe anytime. Your saved pack will be remembered for 30 days.'
                : 'Puedes volver a suscribirte cuando quieras. Guardamos tu pack durante 30 días.'}
            </p>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setConfirmCancel(false)}
                className="flex-1 h-11 bg-card border border-border text-ink rounded-full text-[13px] font-bold font-ui hover:border-ink transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelMutation.isPending}
                className="flex-1 h-11 bg-danger text-white rounded-full text-[13px] font-bold font-ui hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {cancelMutation.isPending ? '…' : t('rashan.sub.action_cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionRow({
  icon: Icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-5 py-3.5 text-left flex items-center gap-3 transition-colors ${
        danger ? 'hover:bg-danger-bg text-danger' : 'hover:bg-surface-linen text-ink'
      }`}
    >
      <Icon size={16} strokeWidth={1.75} />
      <span className="text-[13.5px] font-bold font-ui flex-1">{label}</span>
    </button>
  );
}
