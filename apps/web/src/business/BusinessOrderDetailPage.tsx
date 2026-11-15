import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Ban, Bike, CheckCircle2, ChevronRight, Clock, CreditCard, Banknote, FileLock2, MapPin, Package,
  PackageCheck, Pencil, Phone, Receipt, SearchX, Store, StickyNote, Truck,
} from 'lucide-react';
import {
  deliveryFeeIsPending, lockingInvoiceOf, useCancelOrder, useOrder, customerCanEditOrder, EMPTIED_DRAFT_REASON,
  type IssuedInvoiceRef, type Order, type OrderItem,
} from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { money } from '@/sales/lib/format';
import BackLink from '@/sales/components/BackLink';
import { Card, CardHeader } from '@/sales/components/ui';
import EmptyState from '@/sales/components/EmptyState';
import { Skeleton } from '@/sales/components/Skeleton';
import SalesStatusBadge from '@/sales/components/SalesStatusBadge';
import ConfirmModal from '@/sales/components/ConfirmModal';
import { useToast } from '@/sales/components/Toast';
import { useBizT } from './lib/i18n';
import ReorderButton from './components/ReorderButton';
import Photo from './components/Photo';

/**
 * One order, and everything about it (2026-10-29, user: "showing my complete
 * orders history… and every thing related to the orders"): where it stands,
 * what is in it at what price, what it comes to, where it goes and who brings
 * it, and what can still be done — repeat it, and while it is not yet on its
 * way and no invoice has been issued, edit it (BusinessOrderEditPage, the
 * rep's edit screen) or cancel it (the shop's rules, pages/OrderDetailPage;
 * the server enforces the same).
 *
 * A purchase split across shops is a parent with one order per shop: the
 * parent lists them; each part says which purchase it belongs to.
 */

type Status = Order['status'];
const STEPS: Status[] = ['pending', 'confirmed', 'preparing', 'on_the_way', 'delivered'];
const EDITABLE: Status[] = ['pending', 'confirmed', 'preparing'];
const num = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v ?? 0)) || 0);

function placedOn(iso: string, lang: 'es' | 'en') {
  const d = new Date(iso);
  const locale = lang === 'en' ? 'en-GB' : 'es-ES';
  return `${d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' })} · ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}`;
}

type ParentShape = Order & {
  derived_status?: Status;
  delivery_fee_total?: string | number;
  sub_orders?: Array<{
    id: string; order_number: string; status: Status; total: string | number;
    store?: { id: string; name: string } | null;
    items?: Array<{ id: string; quantity: number; product_snapshot: OrderItem['product_snapshot'] }>;
  }>;
};

export default function BusinessOrderDetailPage() {
  const t = useBizT();
  const lang = useLanguageStore((s) => s.lang) as 'es' | 'en';
  const navigate = useNavigate();
  const { orderId } = useParams();
  const [params] = useSearchParams();
  const { data, isLoading, error } = useOrder(orderId);
  const back = () => navigate('/business/orders');

  if (isLoading) {
    return (
      <div>
        <BackLink label={t('biz.orders.title')} onClick={back} />
        <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-3 md:gap-4">
          <Card className="p-5 space-y-3"><Skeleton className="h-7 w-1/2" /><Skeleton className="h-4 w-1/3" /><Skeleton className="h-24 w-full" /></Card>
          <Card className="p-5 space-y-3"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-5 w-1/2" /></Card>
        </div>
      </div>
    );
  }
  if (!data || error) {
    return (
      <div>
        <BackLink label={t('biz.orders.title')} onClick={back} />
        <Card>
          <EmptyState
            icon={<SearchX size={28} strokeWidth={1.75} className="text-muted" />}
            title={t('biz.order.goneTitle')}
            description={t('biz.order.goneBody')}
            action={{ label: t('biz.orders.seeAll'), onClick: back }}
          />
        </Card>
      </div>
    );
  }
  const order = data as ParentShape;
  const justPlaced = params.get('placed') === '1';
  if (order.sub_orders) return <ParentView order={order} lang={lang} justPlaced={justPlaced} />;
  return <OrderView order={order} lang={lang} justPlaced={justPlaced} />;
}

function PlacedBanner() {
  const t = useBizT();
  return (
    <div role="status" className="mb-3 rounded-2xl border border-success/25 bg-success-bg px-4 py-3 flex items-start gap-3">
      <CheckCircle2 size={22} strokeWidth={1.9} className="text-success shrink-0 mt-px" />
      <div>
        <p className="text-[15px] font-bold font-display text-ink">{t('biz.order.placedTitle')}</p>
        <p className="text-[13px] text-gray mt-0.5">{t('biz.order.placedBody')}</p>
      </div>
    </div>
  );
}

/** Where it stands, as the steps an order goes through — or why it stopped. */
function Timeline({ status, cancelledReason }: { status: Status; cancelledReason?: string | null }) {
  const t = useBizT();
  if (status === 'cancelled') {
    return (
      <div className="rounded-xl bg-danger-bg border border-danger/20 px-4 py-3 flex items-start gap-2.5">
        <Ban size={18} strokeWidth={1.9} className="text-danger shrink-0 mt-px" />
        <div>
          <p className="text-[14px] font-semibold font-display text-ink">{t('biz.order.cancelledTitle')}</p>
          {cancelledReason && <p className="text-[12.5px] text-gray mt-0.5">{cancelledReason}</p>}
        </div>
      </div>
    );
  }
  if (status === 'draft') {
    return (
      <div className="rounded-xl bg-warning-bg border border-warning/20 px-4 py-3 flex items-start gap-2.5">
        <Clock size={18} strokeWidth={1.9} className="text-warning shrink-0 mt-px" />
        <p className="text-[13.5px] text-ink">{t('biz.order.draftBody')}</p>
      </div>
    );
  }
  const at = Math.max(0, STEPS.indexOf(status));
  const icons = [Receipt, CheckCircle2, Package, Truck, PackageCheck];
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label={t('biz.order.progress')}>
      {STEPS.map((s, i) => {
        const done = i <= at;
        const Icon = icons[i];
        return (
          <li key={s} className="flex flex-col items-center text-center min-w-0" aria-current={i === at ? 'step' : undefined}>
            <span className="relative w-full flex items-center justify-center">
              {i > 0 && <span className={`absolute right-1/2 left-[-50%] top-1/2 h-[3px] -translate-y-1/2 rounded-full ${i <= at ? 'bg-brand' : 'bg-border'}`} aria-hidden="true" />}
              <span className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center ring-4 ring-card ${done ? 'bg-brand text-white' : 'bg-surface-sand text-muted'}`}>
                <Icon size={17} strokeWidth={1.9} />
              </span>
            </span>
            <span className={`mt-1.5 text-[11px] sm:text-[12px] font-display leading-tight ${i === at ? 'font-bold text-brand' : done ? 'font-semibold text-ink' : 'font-medium text-muted'}`}>
              {t(`biz.order.step.${s}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function OrderView({ order, lang, justPlaced }: { order: ParentShape; lang: 'es' | 'en'; justPlaced: boolean }) {
  const t = useBizT();
  const navigate = useNavigate();
  const toast = useToast();
  const cancel = useCancelOrder();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  const items = order.items ?? [];
  const lockedBy = lockingInvoiceOf(order as { invoices?: IssuedInvoiceRef[] | null });
  // A draft they made themselves too (2026-11-04): what their checkout parked
  // when stock was short. Same rule as the server (packages/shared orderEditing.ts).
  const canEdit = customerCanEditOrder(order) && !lockedBy;
  const canCancel = (EDITABLE.includes(order.status) || order.status === 'draft') && !lockedBy;
  const feePending = deliveryFeeIsPending(order);
  const sub = order as unknown as {
    parent_order?: { id: string; order_number: string } | null;
    sibling_orders?: Array<{ id: string; order_number: string; status: Status; store?: { name: string } | null }>;
  };

  const nameOf = (s: OrderItem['product_snapshot']) => (lang === 'en' && s?.name_en) || s?.name_es || '—';
  const sizeOf = (s: OrderItem['product_snapshot']) => (lang === 'en' && s?.variant_name_en) || s?.variant_name_es || '';
  const discounted = items.reduce((s, i) => s + num(i.discount_amount), 0);
  const toEdit = () => navigate(`/business/orders/${order.id}/edit`);

  const doCancel = async () => {
    try {
      await cancel.mutateAsync({ id: order.id, reason: reason.trim() || undefined });
      toast.success(t('biz.order.cancelDone'));
      setCancelOpen(false);
    } catch (e) {
      toast.error(t('biz.order.cancelFailed'), e instanceof Error ? e.message : undefined);
    }
  };

  const a = order.address_snapshot;
  return (
    <div className="pb-4">
      <BackLink label={t('biz.orders.title')} title={order.order_number} onClick={() => navigate('/business/orders')} />
      {justPlaced && <PlacedBanner />}

      {sub.parent_order && (
        <div className="mb-3 rounded-2xl border border-brand-mist bg-brand-whisper px-4 py-3">
          <p className="text-[13px] text-brand font-semibold font-display">
            {t('biz.order.partOf')}{' '}
            <button type="button" onClick={() => navigate(`/business/orders/${sub.parent_order!.id}`)} className="font-mono underline underline-offset-2">{sub.parent_order.order_number}</button>
          </p>
          {(sub.sibling_orders?.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sub.sibling_orders!.map((s) => (
                <button key={s.id} type="button" onClick={() => navigate(`/business/orders/${s.id}`)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-card border border-border text-[12.5px] font-semibold font-display text-ink hover:border-brand/40">
                  <Store size={13} strokeWidth={1.75} />{s.store?.name ?? t('biz.house')}<SalesStatusBadge status={s.status} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-3 md:gap-4 items-start">
        <div className="flex flex-col gap-3 md:gap-4 min-w-0">
          {/* ── The order, and where it stands ── */}
          <Card className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="font-mono text-[18px] sm:text-[20px] font-bold text-ink">{order.order_number}</p>
                <p className="text-[13px] text-gray mt-0.5">{t('biz.order.placed', { when: placedOn(order.created_at, lang) })}</p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold font-display text-charcoal">
                  <Store size={14} strokeWidth={1.75} className="text-brand" />{order.store?.name ?? t('biz.house')}
                </p>
              </div>
              <SalesStatusBadge status={order.status} />
            </div>
            <div className="mt-5"><Timeline
              status={order.status}
              cancelledReason={order.cancelled_reason === EMPTIED_DRAFT_REASON ? t('biz.order.emptiedDraft') : order.cancelled_reason}
            /></div>
          </Card>

          {/* ── What is in it ── */}
          <Card className="overflow-hidden">
            <CardHeader
              title={t(items.length === 1 ? 'biz.order.lines_one' : 'biz.order.lines_other', { count: items.length })}
              icon={Package}
              action={canEdit ? (
                <button type="button" onClick={toEdit} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-semibold font-display text-brand hover:bg-brand-whisper transition-colors">
                  <Pencil size={14} strokeWidth={1.9} />{t('biz.order.edit')}
                </button>
              ) : undefined}
            />
            <ul className="divide-y divide-border">
              {items.map((i) => (
                <li key={i.id} className="px-4 sm:px-5 py-3 flex items-center gap-3">
                  <span className="sales-photo w-12 h-12 rounded-xl bg-surface-cream ring-1 ring-inset ring-border overflow-hidden shrink-0 flex items-center justify-center">
                    <Photo url={i.product_snapshot?.image_url} preset="thumb" icon={18} className="w-full h-full object-contain p-0.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold font-display text-ink leading-snug line-clamp-2">{nameOf(i.product_snapshot)}</span>
                    <span className="block text-[12px] text-muted mt-0.5">
                      {sizeOf(i.product_snapshot)}{sizeOf(i.product_snapshot) ? ' · ' : ''}{i.quantity} × {money(num(i.unit_price))}
                      {num(i.unit_discount) > 0 && <span className="text-success"> · {t('biz.order.lineDiscount', { amount: money(num(i.unit_discount)) })}</span>}
                    </span>
                  </span>
                  <span className="text-[14.5px] font-bold font-display text-ink tabular-nums shrink-0">{money(num(i.line_total))}</span>
                </li>
              ))}
            </ul>
          </Card>

          {order.customer_notes && (
            <Card className="p-4 sm:p-5">
              <p className="flex items-center gap-2 text-[14px] font-bold font-display text-ink"><StickyNote size={16} strokeWidth={1.75} className="text-brand" />{t('biz.order.notes')}</p>
              <p className="mt-1.5 text-[13.5px] text-charcoal whitespace-pre-line">{order.customer_notes}</p>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-3 md:gap-4">
          {/* ── What it comes to ── */}
          <Card className="p-4 sm:p-5">
            <dl className="text-[14px]">
              <div className="flex items-baseline justify-between gap-3 py-1">
                <dt className="text-gray">{t('biz.cart.subtotal')}</dt>
                <dd className="font-semibold font-display text-ink tabular-nums">{money(num(order.subtotal))}</dd>
              </div>
              {discounted > 0 && (
                <div className="flex items-baseline justify-between gap-3 py-1">
                  <dt className="text-success">{t('biz.order.agreedPrices')}</dt>
                  <dd className="text-success font-semibold tabular-nums">−{money(discounted)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3 py-1">
                <dt className="text-gray">{t('biz.cart.delivery')}</dt>
                <dd className="text-right">{feePending ? <span className="text-gray">{t('biz.cart.deliveryLater')}</span> : <span className="font-semibold font-display text-ink tabular-nums">{money(num(order.delivery_fee))}</span>}</dd>
              </div>
              {num(order.recargo ?? 0) > 0 && (
                <div className="flex items-baseline justify-between gap-3 py-1">
                  <dt className="text-gray">{t('biz.checkout.recargo')}</dt>
                  <dd className="font-semibold font-display text-ink tabular-nums">{money(num(order.recargo ?? 0))}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between gap-3 pt-3 mt-2 border-t border-dashed border-border">
                <dt className="text-[15px] font-semibold font-display text-ink">{feePending ? t('biz.checkout.totalSoFar') : t('biz.cart.total')}</dt>
                <dd className="text-[22px] font-bold font-display text-brand tabular-nums">{money(num(order.total))}</dd>
              </div>
            </dl>
            <p className="mt-3 flex items-center gap-2 text-[13px] text-charcoal">
              {order.payment_method === 'card' ? <CreditCard size={16} strokeWidth={1.75} className="text-muted" /> : <Banknote size={16} strokeWidth={1.75} className="text-muted" />}
              {t(`biz.checkout.pay.${order.payment_method === 'card' ? 'card' : 'cod'}`)}
            </p>
            {lockedBy && (
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-surface-cream border border-border px-3 py-2.5 text-[12.5px] text-gray">
                <FileLock2 size={15} strokeWidth={1.75} className="text-brand shrink-0 mt-px" />
                <span>{t('biz.order.invoiced', { number: lockedBy.invoice_number ?? '—' })}</span>
              </p>
            )}
          </Card>

          {/* ── Where it goes, and who brings it ── */}
          <Card className="p-4 sm:p-5">
            <p className="flex items-center gap-2 text-[14px] font-bold font-display text-ink"><MapPin size={16} strokeWidth={1.75} className="text-brand" />{t('biz.order.deliverTo')}</p>
            {a ? (
              <div className="mt-2 text-[13.5px] text-charcoal leading-relaxed">
                <p className="font-semibold text-ink">{a.contact_name}</p>
                <p>{a.street_line_1}{a.street_line_2 ? `, ${a.street_line_2}` : ''}</p>
                <p>{[a.postcode, a.city, a.province].filter(Boolean).join(' · ')}</p>
                {a.contact_phone && <p className="mt-1 inline-flex items-center gap-1.5 text-gray"><Phone size={13} strokeWidth={1.75} />{a.contact_phone}</p>}
              </div>
            ) : <p className="mt-2 text-[13px] text-muted">—</p>}
            {order.rider && order.status === 'on_the_way' && (
              <div className="mt-3 pt-3 border-t border-border flex items-center gap-3">
                <span className="w-9 h-9 rounded-xl bg-brand-whisper text-brand flex items-center justify-center"><Bike size={17} strokeWidth={1.75} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold font-display text-ink">{order.rider.name}</p>
                  <p className="text-[12px] text-gray">{t('biz.order.rider')}</p>
                </div>
                {order.rider.phone && <a href={`tel:${order.rider.phone}`} className="h-9 px-3 rounded-lg border border-border bg-card text-[13px] font-semibold font-display text-brand inline-flex items-center gap-1.5"><Phone size={14} />{t('biz.order.call')}</a>}
              </div>
            )}
          </Card>

          {/* ── What can still be done ── */}
          <Card className="p-4 sm:p-5 flex flex-col gap-2">
            {canEdit && (
              <button type="button" onClick={toEdit} className="w-full h-11 rounded-xl bg-brand hover:bg-brand-mid text-white text-[14px] font-semibold font-display inline-flex items-center justify-center gap-2 transition-colors">
                <Pencil size={16} strokeWidth={1.9} />{t('biz.order.editOrder')}
              </button>
            )}
            <ReorderButton
              orderId={order.id}
              className={canEdit
                ? 'w-full h-11 rounded-xl border border-border bg-card text-brand text-[14px] font-semibold font-display inline-flex items-center justify-center gap-2 hover:border-brand/40 transition-colors disabled:opacity-60'
                : 'w-full h-11 rounded-xl bg-brand hover:bg-brand-mid text-white text-[14px] font-semibold font-display inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60'}
            />
            {canCancel && (
              <button type="button" onClick={() => setCancelOpen(true)} className="w-full h-11 rounded-xl border border-danger/30 bg-card text-danger text-[14px] font-semibold font-display hover:bg-danger-bg transition-colors">
                {t('biz.order.cancel')}
              </button>
            )}
            {!canCancel && !lockedBy && order.status === 'on_the_way' && (
              <p className="text-[12.5px] text-muted text-center">{t('biz.order.tooLate')}</p>
            )}
          </Card>
        </div>
      </div>

      <ConfirmModal
        open={cancelOpen}
        danger
        title={t('biz.order.cancelTitle', { number: order.order_number })}
        message={t('biz.order.cancelBody')}
        confirmLabel={cancel.isPending ? t('biz.order.cancelling') : t('biz.order.cancelConfirm')}
        cancelLabel={t('biz.order.keep')}
        confirmDisabled={cancel.isPending}
        onConfirm={() => void doCancel()}
        onCancel={() => setCancelOpen(false)}
      >
        <label className="block mt-3">
          <span className="text-[12.5px] font-semibold font-display text-gray">{t('biz.order.cancelReason')}</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className="mt-1 w-full h-10 rounded-xl border border-border bg-card px-3 text-[14px] text-ink focus:outline-none focus:border-brand" />
        </label>
      </ConfirmModal>
    </div>
  );
}

/** A purchase split across shops: one order per shop, each opened on its own. */
function ParentView({ order, lang, justPlaced }: { order: ParentShape; lang: 'es' | 'en'; justPlaced: boolean }) {
  const t = useBizT();
  const navigate = useNavigate();
  const status = order.derived_status ?? order.status;
  const fee = num(order.delivery_fee_total ?? order.delivery_fee);
  return (
    <div className="pb-4">
      <BackLink label={t('biz.orders.title')} title={order.order_number} onClick={() => navigate('/business/orders')} />
      {justPlaced && <PlacedBanner />}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-3 md:gap-4 items-start">
        <div className="flex flex-col gap-3 md:gap-4 min-w-0">
          <Card className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="font-mono text-[18px] sm:text-[20px] font-bold text-ink">{order.order_number}</p>
                <p className="text-[13px] text-gray mt-0.5">{t('biz.order.placed', { when: placedOn(order.created_at, lang) })}</p>
                <p className="mt-1 text-[13px] font-semibold font-display text-charcoal">{t('biz.order.splitNote', { count: order.sub_orders!.length })}</p>
              </div>
              <SalesStatusBadge status={status} />
            </div>
          </Card>
          {order.sub_orders!.map((s) => (
            <Card key={s.id} className="overflow-hidden">
              <button type="button" onClick={() => navigate(`/business/orders/${s.id}`)} className="w-full px-4 sm:px-5 py-3.5 flex items-center gap-3 text-left hover:bg-surface-cream transition-colors">
                <span className="w-10 h-10 rounded-xl bg-brand-whisper text-brand flex items-center justify-center shrink-0"><Store size={18} strokeWidth={1.75} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold font-display text-ink truncate">{s.store?.name ?? t('biz.house')}</span>
                  <span className="block text-[12.5px] text-muted font-mono">{s.order_number}</span>
                </span>
                <span className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-[15px] font-bold font-display text-ink tabular-nums">{money(num(s.total))}</span>
                  <SalesStatusBadge status={s.status} />
                </span>
                <ChevronRight size={17} strokeWidth={1.75} className="text-muted shrink-0" />
              </button>
              {(s.items?.length ?? 0) > 0 && (
                <p className="px-4 sm:px-5 pb-3 -mt-1 text-[12.5px] text-gray truncate">
                  {s.items!.map((i) => `${i.quantity} × ${(lang === 'en' && i.product_snapshot?.name_en) || i.product_snapshot?.name_es}`).join('  ·  ')}
                </p>
              )}
            </Card>
          ))}
        </div>
        <div className="flex flex-col gap-3 md:gap-4">
          <Card className="p-4 sm:p-5">
            <dl className="text-[14px]">
              <div className="flex items-baseline justify-between gap-3 py-1"><dt className="text-gray">{t('biz.cart.subtotal')}</dt><dd className="font-semibold font-display text-ink tabular-nums">{money(num(order.subtotal))}</dd></div>
              <div className="flex items-baseline justify-between gap-3 py-1"><dt className="text-gray">{t('biz.cart.delivery')}</dt><dd className="text-right">{fee === 0 ? <span className="text-gray">{t('biz.cart.deliveryLater')}</span> : <span className="font-semibold font-display text-ink tabular-nums">{money(fee)}</span>}</dd></div>
              {num(order.recargo ?? 0) > 0 && (
                <div className="flex items-baseline justify-between gap-3 py-1"><dt className="text-gray">{t('biz.checkout.recargo')}</dt><dd className="font-semibold font-display text-ink tabular-nums">{money(num(order.recargo ?? 0))}</dd></div>
              )}
              <div className="flex items-baseline justify-between gap-3 pt-3 mt-2 border-t border-dashed border-border"><dt className="text-[15px] font-semibold font-display text-ink">{fee === 0 ? t('biz.checkout.totalSoFar') : t('biz.cart.total')}</dt><dd className="text-[22px] font-bold font-display text-brand tabular-nums">{money(num(order.total))}</dd></div>
            </dl>
          </Card>
          <Card className="p-4 sm:p-5">
            <ReorderButton orderId={order.id} className="w-full h-11 rounded-xl bg-brand hover:bg-brand-mid text-white text-[14px] font-semibold font-display inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60" />
          </Card>
        </div>
      </div>
    </div>
  );
}
