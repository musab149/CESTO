import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronRight, ArrowLeft, MapPin, Clock, CreditCard, Package, Check, Truck, ShoppingBag, X, Store as StoreIcon, GitBranch, XCircle, Pencil, Lock } from 'lucide-react';
import {
  useOrder, useCancelOrder, resolveImageUrl, lockingInvoiceOf, newProgressKey,
  type IssuedInvoiceRef, deliveryFeeIsPending, HOME_GROCERY_PROFILE_PATH,
  customerCanEditOrder, EMPTIED_DRAFT_REASON, editBasketKey, readBasket } from '@grocery-app/shared';
import OrderItemsEditor from '../components/OrderItemsEditor';
import LoadFailed from '../components/LoadFailed';
import OrderProgressPanel from '../components/OrderProgressPanel';
import RiderCard from '../components/RiderCard';
import HopBasket from '../components/home-grocery/HopBasket';
import { planDate, windowLine } from '../components/home-grocery/planCopy';
import ChangeSlotDialog from '../components/home-grocery/plan/ChangeSlotDialog';
import ReorderButton from '../components/ReorderButton';
import { isNotFound } from '@grocery-app/shared';
import type { OrderStatus } from '@grocery-app/shared';
import { Skeleton } from '@/components/Skeleton';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * Euros off one unit on a line: its own per-unit figure (a price agreed with
 * the customer, 2026-10-25), or a flat line discount from before then spread
 * over the quantity. 0 for none.
 */
const perUnitOff = (item: { quantity: number; unit_discount?: string | number | null; discount_amount?: string | number | null }) => {
  const unit = Number(item.unit_discount ?? 0);
  if (unit > 0) return unit;
  const flat = Number(item.discount_amount ?? 0);
  return flat > 0 && item.quantity > 0 ? flat / item.quantity : 0;
};

const STEPS: { key: OrderStatus; icon: React.ElementType }[] = [
  { key: 'pending', icon: ShoppingBag },
  { key: 'confirmed', icon: Check },
  { key: 'preparing', icon: Package },
  { key: 'on_the_way', icon: Truck },
  { key: 'delivered', icon: Check },
];

/**
 * Solid-fill status pill — high contrast white-on-color, single accent ring
 * for depth. Each status maps to one inline style block so the colour values
 * are explicit (Tailwind-safelist concerns with arbitrary values aside).
 */
interface StatusPillStyle {
  /** Hex of the pill's solid fill — drives bg, glow ring, and the pulse dot */
  color: string;
  /** Status icon */
  icon: React.ElementType;
  /** Whether to render the live pulsing dot (in-progress states only) */
  pulse: boolean;
}

const statusStyles: Record<OrderStatus, StatusPillStyle> = {
  pending:    { color: '#64748B', icon: Clock,   pulse: true  }, // slate — neutral, awaiting confirmation
  confirmed:  { color: '#2563EB', icon: Check,   pulse: false }, // blue  — acknowledged
  preparing:  { color: '#D97706', icon: Package, pulse: true  }, // amber — actively working
  on_the_way: { color: '#EA580C', icon: Truck,   pulse: true  }, // orange — in motion
  delivered:  { color: '#16A34A', icon: Check,   pulse: false }, // green — success
  cancelled:  { color: '#DC2626', icon: X,       pulse: false }, // red   — failed
  // MV Slice 4 — parent-only derived status when subs reach mixed terminal
  // states. Amber signals partial success (not fully failed, not fully done).
  partially_completed: { color: '#D97706', icon: Package, pulse: false },
  // Out-of-stock at checkout — blocked, not yet an active order. Neutral
  // grey distinguishes it from the "awaiting confirmation" slate of pending.
  draft: { color: '#94A3B8', icon: Package, pulse: false },
};

/**
 * Where the order has got to, as a row of steps joined by a line.
 *
 * Across rather than down: five steps read as one line of progress and the
 * card is only as tall as one of them. Where the screen is too narrow for
 * five, the row scrolls sideways — each step keeps room for its label — and
 * starts scrolled to the current one, so a phone opens on the step that
 * matters rather than on "Pedido realizado".
 */
function OrderSteps({ current, label, inProgress }: {
  current: number;
  label: (key: OrderStatus) => string;
  inProgress: string;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const currentRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const box = scroller.current;
    const step = currentRef.current;
    if (!box || !step || box.scrollWidth <= box.clientWidth) return;
    // Scrolls the row only — scrollIntoView would move the page as well.
    box.scrollLeft = step.offsetLeft - (box.clientWidth - step.offsetWidth) / 2;
  }, [current]);

  return (
    <div ref={scroller} className="-mx-6 px-6 pb-2 overflow-x-auto overscroll-x-contain">
      <ol className="flex min-w-[560px]">
        {STEPS.map((step, i) => {
          const reached = i <= current;
          const isCurrent = i === current;
          return (
            <li
              key={step.key}
              ref={isCurrent ? currentRef : undefined}
              aria-current={isCurrent ? 'step' : undefined}
              className="relative flex-1 min-w-[112px] flex flex-col items-center text-center px-1"
            >
              {/* The line from the step before, centre to centre. */}
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute top-6 -left-1/2 right-1/2 h-0.5 -translate-y-1/2 transition-colors duration-500 ${
                    reached ? 'bg-brand' : 'bg-border'
                  }`}
                />
              )}
              <div
                className={`relative z-10 w-12 h-12 rounded-full flex items-center justify-center border-2 shrink-0 transition-all ${
                  reached ? 'bg-brand border-brand text-white' : 'bg-surface-white border-border text-muted'
                } ${isCurrent ? 'ring-4 ring-brand-mist shadow-md' : ''}`}
              >
                <step.icon size={18} strokeWidth={2} />
              </div>
              <p className={`mt-2.5 text-sm font-bold font-display leading-snug ${reached ? 'text-ink' : 'text-muted'}`}>
                {label(step.key)}
              </p>
              {/* Not under the last step: a delivered order is not in progress. */}
              {isCurrent && i < STEPS.length - 1 && (
                <p className="text-xs text-brand font-body font-semibold mt-0.5">{inProgress}</p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StatusPill({ status, label }: { status: OrderStatus; label: string }) {
  const s = statusStyles[status];
  const Icon = s.icon;
  return (
    <span
      role="status"
      aria-label={`Order status: ${label}`}
      className="inline-flex items-center gap-2 h-9 pl-2 pr-4 rounded-full font-display font-bold text-[13px] text-white shadow-[0_2px_8px_-1px_rgba(0,0,0,0.18)]"
      style={{
        backgroundColor: s.color,
        boxShadow: `0 0 0 4px ${s.color}1A, 0 2px 8px -1px ${s.color}40`, // soft halo + drop
      }}
    >
      {/* Icon disc with optional live indicator */}
      <span className="relative inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/20">
        <Icon size={13} strokeWidth={2.75} />
        {s.pulse && (
          <span className="absolute -top-0.5 -right-0.5 flex w-2 h-2">
            <span className="absolute inset-0 rounded-full bg-card animate-ping opacity-75" />
            <span className="relative w-full h-full rounded-full bg-card" />
          </span>
        )}
      </span>
      <span className="leading-none tracking-tight uppercase text-[11.5px]">{label}</span>
    </span>
  );
}

export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { lang, t } = useLanguageStore();
  const { data: order, isLoading, error: orderError, refetch: refetchOrder, isFetching: fetchingOrder } = useOrder(orderId);
  const cancelOrder = useCancelOrder();
  // Cancel modal state. Reason is optional on the customer side (unlike
  // partner where the reason drives their internal ops decision) — most
  // customer cancellations are "changed my mind" and don't need a reason.
  const [cancelOpen, setCancelOpen] = useState(false);
  /** Names the cancel so the progress panel can follow it on the server. */
  const [cancelKey, setCancelKey] = useState<string | null>(null);
  /** That panel is up, so the cancel box under it steps aside. */
  const [cancelPanelUp, setCancelPanelUp] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  // Editing the items in place, rather than on its own route: the customer is
  // already looking at the order, and a separate page would lose the context
  // that tells them whether changing it is still sensible.
  const [editing, setEditing] = useState(false);
  const [movingSlot, setMovingSlot] = useState(false);
  // ?edit=1 — "Editar" on the Home Grocery tab lands here with the editor
  // open when the order can still be changed (see editorOpen below). Closing
  // the editor drops it from the address, so a reload does not reopen it.
  const [params, setParams] = useSearchParams();
  const wantsEdit = params.get('edit') === '1';
  const closeEditor = () => {
    setEditing(false);
    if (wantsEdit) setParams({}, { replace: true });
  };

  if (isLoading) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
        <Skeleton className="h-5 w-64 mb-8" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  // A failed request is not a missing order: right after checkout, "order
  // not found" for an order that was placed is the worst thing to read.
  if (!order && !isNotFound(orderError)) {
    return (
      <LoadFailed
        lang={lang}
        title={lang === 'en' ? "We couldn't load this order" : 'No hemos podido cargar este pedido'}
        onRetry={() => { void refetchOrder(); }}
        retrying={fetchingOrder}
        secondary={
          <button type="button" onClick={() => navigate('/orders')} className="min-h-[52px] px-6 rounded-xl border-2 border-border bg-surface-white text-ink font-display font-semibold text-sm inline-flex items-center hover:border-brand transition-colors">
            {t('order.back_to_orders')}
          </button>
        }
      />
    );
  }

  if (!order) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-20 flex flex-col items-center">
        <span className="text-6xl mb-6">📦</span>
        <h2 className="text-2xl font-bold text-ink font-display mb-2">{t('order.not_found')}</h2>
        <p className="text-sm text-gray font-body mb-6">{t('order.not_found_desc')}</p>
        <button onClick={() => navigate('/orders')} className="h-11 px-6 bg-brand text-white rounded-xl font-semibold font-display hover:bg-brand-mid transition-colors">
          {t('order.back_to_orders')}
        </button>
      </div>
    );
  }

  // MV Slice 4: the response may be a ParentOrder (has `sub_orders`) or an
  // Order (either solo or a sub of a parent). Route to the right renderer.
  // ParentOrder from the API has `derived_status` on top and `sub_orders`
  // instead of `items`; we widen the type here since Order doesn't natively
  // carry those fields.
  const parentShape = order as unknown as {
    id: string;
    order_number: string;
    subtotal: string | number;
    delivery_fee_total: string | number;
    total: string | number;
    created_at: string;
    payment_method: 'cod' | 'card' | 'bizum';
    customer_notes: string | null;
    address_snapshot: {
      contact_name: string; contact_phone: string;
      street_line_1: string; street_line_2?: string | null;
      postcode: string; city: string; province: string;
    } | null;
    derived_status?: OrderStatus;
    sub_orders?: Array<{
      id: string; order_number: string; status: OrderStatus; total: string | number;
      /* A ParentOrder has no buyer_is_business of its own; its parts carry it,
         while the fee for the whole purchase sits on the parent. */
      buyer_is_business?: boolean | null;
      store?: { id: string; slug: string; name: string; logo_url?: string | null } | null;
      items?: Array<{ id: string; quantity: number; unit_price: string | number; line_total: string | number; discount_amount?: string | number | null; unit_discount?: string | number | null; product_snapshot: any }>;
      rider?: { id: string; name: string; phone: string; vehicle_type: string } | null;
    }>;
  };
  if (parentShape.sub_orders) {
    return <ParentOrderView parent={parentShape} />;
  }

  const date = new Date(order.created_at);
  const locale = lang === 'en' ? 'en-GB' : 'es-ES';
  const placedOn = date.toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' }) + ' • ' + date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const isCancelled = order.status === 'cancelled';
  const isDraft = order.status === 'draft';
  // A plan delivery the household chose to skip: said as such, not as a failure.
  const isSkipped = isCancelled && !!order.rashan_subscription_id && order.cancelled_reason === 'Skipped';
  // A Home Grocery order: placed by the household, staff or their rep for a
  // day and a part of the day (see lib/homeGroceryPlan on the API). The slot
  // can move until preparing starts — the API's changeOrderSlot.
  const isPlan = !!order.rashan_subscription_id;
  const plannedFor = planDate(order.scheduled_for, lang);
  const canMoveSlot = isPlan && !!order.scheduled_for && ['draft', 'pending', 'confirmed'].includes(order.status);
  // Mirrors EDITABLE_STATUSES on the server. A draft is excluded on purpose:
  // its stock was never reserved, so resolving it is what books the items,
  // and editing one would have that resolution decrement quantities this
  // screen had already changed underneath it.
  // An invoice has been issued against this order, so its contents are
  // fixed — the document states these totals and cannot be altered. The
  // server refuses the edit either way; this stops us offering it. Absent
  // field means "not locked", so a frontend ahead of the API degrades to
  // letting the server refuse rather than hiding editing from everyone.
  // Only a FACTURA freezes the order. A proforma is a quote; if the order
  // changes the quote is reissued, not the order refused.
  const lockedBy = lockingInvoiceOf(order as { invoices?: IssuedInvoiceRef[] | null });
  // A draft they made themselves too (2026-11-04) — what their checkout
  // parked when stock was short. It holds no stock, so changing it moves none;
  // confirming its stock later takes what it then holds. Not a draft our team
  // built for them. Same rule as the server (packages/shared orderEditing.ts).
  const canEdit = customerCanEditOrder(order) && !lockedBy;
  // A Home Grocery order is changed on its own screen — the one staff and
  // reps use (OrderEditPage); any other order in place, below.
  const editInPlace = canEdit && !isPlan;
  // Changes left unsaved in this browser — a reload, a closed tab — reopen
  // the editor with them (OrderItemsEditor keeps and restores them).
  const resumeEdit = editInPlace && !!readBasket(editBasketKey('shop', order.user_id, order.id));
  const editorOpen = editInPlace && (editing || wantsEdit || resumeEdit);
  const openEditor = () => (isPlan ? navigate(`/orders/${order.id}/edit`) : setEditing(true));
  if (wantsEdit && canEdit && isPlan) return <Navigate to={`/orders/${order.id}/edit`} replace />;
  // Cancelling now runs to the same boundary as editing. Letting someone
  // strip an order to one item while it is being packed, then refusing them
  // a cancel in the same breath, is not a line that can be explained.
  // Spelled out rather than inherited from canEdit. Cancelling an invoiced
  // order would leave a legal document describing something that no longer
  // exists, so it is blocked for the same reason editing is — and the server
  // refuses it too. Writing `canEdit || isDraft` would have produced the same
  // answer today by accident, and the wrong one the moment canEdit changes.
  const canCancel = (['pending', 'confirmed', 'preparing'].includes(order.status) || isDraft)
    && !lockedBy;
  const currentStepIdx = STEPS.findIndex((s) => s.key === order.status);
  const itemCount = order.items?.length ?? 0;
  const itemWord = itemCount === 1 ? t('order.item_count') : t('order.items_count');
  const num = (v: unknown) => typeof v === 'number' ? v : parseFloat(String(v ?? 0));

  // Slice 4 — sub-order awareness. If this Order is a sub of a ParentOrder,
  // show a banner up top with sibling chips so the customer can see the
  // other stores in the same purchase and jump between them.
  const subContext = order as unknown as {
    parent_order?: { id: string; order_number: string } | null;
    store?: { id: string; slug: string; name: string; logo_url?: string | null } | null;
    sibling_orders?: Array<{
      id: string; order_number: string; status: OrderStatus;
      store?: { id: string; slug: string; name: string; logo_url?: string | null } | null;
    }>;
  };
  const parentOrder = subContext.parent_order;
  const siblings = subContext.sibling_orders ?? [];

  return (
    <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm font-body text-muted mb-6">
        <button onClick={() => navigate('/')} className="hover:text-brand transition-colors">{t('common.home')}</button>
        <ChevronRight size={14} />
        <button onClick={() => navigate('/orders')} className="hover:text-brand transition-colors">{t('orders.title')}</button>
        <ChevronRight size={14} />
        <span className="text-ink font-semibold">{order.order_number}</span>
      </div>

      {/* Back button + header */}
      <button
        onClick={() => navigate('/orders')}
        className="flex items-center gap-2 text-sm font-semibold text-muted hover:text-brand transition-colors mb-4"
      >
        <ArrowLeft size={16} />
        {t('order.back_to_orders')}
      </button>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold text-ink font-display font-mono">{order.order_number}</h1>
          <p className="text-sm text-muted font-body mt-1 flex items-center gap-1.5 flex-wrap">
            {subContext.store && (
              <>
                <StoreIcon size={12} strokeWidth={1.75} className="text-muted shrink-0" />
                <span className="font-semibold">{subContext.store.name}</span>
                <span className="opacity-40">·</span>
              </>
            )}
            <span>{t('order.placed_on')} {placedOn}</span>
            <span className="opacity-40">·</span>
            <span>{itemCount} {itemWord}</span>
          </p>
        </div>
        <StatusPill
          status={isSkipped ? 'draft' : order.status}
          label={isPlan && isDraft ? t('orders.status.planned') : isSkipped ? t('orders.status.skipped') : t(`orders.status.${order.status}`)}
        />
      </div>

      {isPlan && (
        <div className="mb-6 bg-success-bg/60 border border-success/20 rounded-xl p-4 flex flex-wrap items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-card flex items-center justify-center shrink-0">
            <HopBasket size={20} className="text-success" />
          </div>
          <div className="flex-1 min-w-[180px]">
            <p className="text-sm font-bold text-ink font-display">
              {lang === 'en' ? 'Home Grocery order' : 'Pedido de tu compra del hogar'}
            </p>
            {plannedFor && (
              <p className="text-xs text-charcoal font-body mt-0.5 first-letter:uppercase">
                {plannedFor} · {windowLine(order.delivery_window, lang)}
              </p>
            )}
          </div>
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            {canMoveSlot && (
              <button
                onClick={() => setMovingSlot(true)}
                className="h-9 px-3.5 rounded-lg bg-brand text-white text-xs font-bold font-display hover:bg-brand-mid"
              >
                {lang === 'en' ? 'Change day and time' : 'Cambiar día y hora'}
              </button>
            )}
            <button
              onClick={() => navigate(HOME_GROCERY_PROFILE_PATH)}
              className="h-9 px-3.5 rounded-lg bg-card border border-border text-xs font-bold text-brand font-display hover:bg-brand-mist/40"
            >
              {lang === 'en' ? 'My Home Grocery' : 'Mi compra del hogar'}
            </button>
          </div>
        </div>
      )}
      {movingSlot && order.scheduled_for && (
        <ChangeSlotDialog
          orderId={order.id}
          initial={{ scheduled_for: order.scheduled_for.slice(0, 10), delivery_window: order.delivery_window ?? null }}
          preferredWeekday={null}
          lang={lang}
          onClose={() => setMovingSlot(false)}
        />
      )}

      {/* MV Slice 4 — sub-order banner. Shows when this Order is one slice
          of a cross-store purchase. Sibling chips let the customer jump
          between the other stores' sub-orders to see their statuses. */}
      {parentOrder && (
        <div className="mb-6 bg-brand-mist/60 border border-brand/20 rounded-xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center shrink-0">
            <GitBranch size={15} strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink font-display">
              {lang === 'en' ? 'Part of a multi-store order' : 'Parte de un pedido multi-tienda'}{' '}
              <button
                onClick={() => navigate(`/orders/${parentOrder.id}`)}
                className="font-mono text-brand hover:underline"
              >
                {parentOrder.order_number}
              </button>
            </p>
            {siblings.length > 0 && (
              <>
                <p className="text-xs text-muted font-body mt-1">
                  {lang === 'en'
                    ? `${siblings.length} other ${siblings.length === 1 ? 'store' : 'stores'} in this order:`
                    : `${siblings.length} ${siblings.length === 1 ? 'otra tienda' : 'otras tiendas'} en este pedido:`}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {siblings.map((s) => {
                    const style = statusStyles[s.status];
                    return (
                      <button
                        key={s.id}
                        onClick={() => navigate(`/orders/${s.id}`)}
                        className="inline-flex items-center gap-2 h-8 pl-2 pr-3 rounded-full bg-card border border-border hover:border-brand hover:bg-brand-mist/40 transition-colors text-xs"
                      >
                        <span className="w-5 h-5 rounded-full overflow-hidden bg-surface-cream border border-border/40 flex items-center justify-center shrink-0">
                          {s.store?.logo_url
                            ? <img src={s.store.logo_url} alt="" className="w-full h-full object-cover" />
                            : <StoreIcon size={10} strokeWidth={2} className="text-ink/50" />}
                        </span>
                        <span className="font-semibold text-ink">{s.store?.name ?? 'Cesto'}</span>
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ backgroundColor: style.color }}
                          title={t(`orders.status.${s.status}`)}
                        />
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* ─── Left: Timeline + Items ─── */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Timeline */}
          <div className="bg-surface-white border border-border/60 rounded-lg p-6">
            <h3 className="text-lg font-extrabold text-ink font-display mb-6">{t('order.timeline')}</h3>
            {isSkipped ? (
              <div className="flex items-center gap-4 p-4 bg-surface-cream rounded-xl">
                <div className="w-12 h-12 rounded-full bg-muted/15 flex items-center justify-center">
                  <X size={24} strokeWidth={2} className="text-muted" />
                </div>
                <div>
                  <p className="text-sm font-bold text-ink font-display">
                    {lang === 'en' ? 'Skipped — this delivery will not come' : 'Saltada — esta entrega no llegará'}
                  </p>
                  <p className="text-xs text-muted font-body mt-1">
                    {lang === 'en' ? 'You skipped it from your Home Grocery.' : 'La saltaste desde tu compra del hogar.'}
                  </p>
                </div>
              </div>
            ) : isCancelled ? (
              <div className="flex items-center gap-4 p-4 bg-danger-bg rounded-xl">
                <div className="w-12 h-12 rounded-full bg-danger/10 flex items-center justify-center">
                  <X size={24} strokeWidth={2} className="text-danger" />
                </div>
                <div>
                  <p className="text-sm font-bold text-danger font-display">{t('order.timeline.cancelled')}</p>
                  {order.cancelled_reason && (
                    <p className="text-xs text-muted font-body mt-1">
                      {order.cancelled_reason === EMPTIED_DRAFT_REASON && lang === 'en'
                        ? 'Every item was removed from the draft.'
                        : order.cancelled_reason}
                    </p>
                  )}
                </div>
              </div>
            ) : isDraft ? (
              // Draft isn't a step in STEPS — it's blocked on stock, not
              // progressing through fulfilment yet, so it gets its own
              // message instead of a step tracker showing nothing "current".
              <div className="flex items-center gap-4 p-4 bg-surface-cream rounded-xl">
                <div className="w-12 h-12 rounded-full bg-muted/15 flex items-center justify-center">
                  <Package size={22} strokeWidth={2} className="text-muted" />
                </div>
                {isPlan ? (
                  <div>
                    <p className="text-sm font-bold text-ink font-display">
                      {lang === 'en' ? 'Planned — we have not started preparing it yet' : 'Prevista — aún no hemos empezado a prepararla'}
                    </p>
                    <p className="text-xs text-muted font-body mt-1">
                      {/* Only promise what the page offers (2026-11-05). A
                          draft our team prepared is not the household's to
                          change (shared customerCanEditOrder) until we confirm
                          it; its day and time can move now. Wording only — the
                          rule is unchanged. */}
                      {canEdit
                        ? (lang === 'en'
                          ? 'We prepare it for its day. You can change its products until we start preparing it.'
                          : 'La preparamos para su día. Puedes cambiar los productos hasta que empecemos a prepararla.')
                        : (lang === 'en'
                          ? 'We prepare it for its day. You can change its day and time now, and its products once we confirm it.'
                          : 'La preparamos para su día. Ya puedes cambiar el día y la hora, y los productos cuando la confirmemos.')}
                    </p>
                    <button
                      onClick={() => navigate(HOME_GROCERY_PROFILE_PATH)}
                      className="mt-2 text-xs font-bold text-brand hover:text-brand-mid font-display"
                    >
                      {lang === 'en' ? 'My Home Grocery' : 'Mi compra del hogar'}
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-bold text-ink font-display">{t('order.timeline.draft')}</p>
                    <p className="text-xs text-muted font-body mt-1">{t('order.timeline.draft_hint')}</p>
                  </div>
                )}
              </div>
            ) : (
              <OrderSteps
                current={currentStepIdx}
                label={(key) => t(`order.timeline.${key}`)}
                inProgress={lang === 'en' ? 'In progress' : 'En curso'}
              />
            )}
          </div>

          {/* Items — editable in place while the shop still has the order. */}
          {editorOpen ? (
            <OrderItemsEditor
              orderId={order.id}
              userId={order.user_id}
              storeId={(order as unknown as { store_id: string | null }).store_id ?? null}
              status={order.status}
              items={(order.items ?? []) as never}
              deliveryFee={num(order.delivery_fee)}
              recargoOn={!!order.recargo_equivalencia && !order.parent_order_id}
              lang={lang}
              onClose={closeEditor}
              onSaved={closeEditor}
            />
          ) : (
          <div className="bg-surface-white border border-border/60 rounded-lg overflow-hidden">
            <div className="px-6 pt-6 pb-4 flex items-center justify-between gap-3">
              <h3 className="text-lg font-extrabold text-ink font-display">{t('order.items')}</h3>
              {/* Same window the API enforces (EDITABLE_STATUSES) — while the
                  order is still in the shop's hands. Once a rider has it the
                  contents are physically gone and no button can change that. */}
              {canEdit && (
                <button
                  type="button"
                  onClick={openEditor}
                  className="shrink-0 h-9 px-3 rounded-xl text-xs font-bold font-display inline-flex items-center gap-1.5 border border-brand/40 text-brand bg-surface-white hover:bg-brand-mist/50 transition-colors"
                >
                  <Pencil size={14} strokeWidth={2} />
                  {lang === 'en' ? 'Edit items' : 'Editar artículos'}
                </button>
              )}
            </div>
            <div className="divide-y divide-border/60">
              {order.items?.map((item) => {
                const name = lang === 'en' ? item.product_snapshot.name_en : item.product_snapshot.name_es;
                const varName = lang === 'en' ? item.product_snapshot.variant_name_en : item.product_snapshot.variant_name_es;
                return (
                  <div key={item.id} className="flex items-center gap-4 py-4 px-6">
                    <div className="photo-well w-16 h-16 rounded-xl bg-surface-linen overflow-hidden shrink-0 border border-border/40 flex items-center justify-center">
                      {item.product_snapshot.image_url ? (
                        <img
                          src={resolveImageUrl(item.product_snapshot.image_url, 'thumb')}
                          alt={name}
                          className="object-cover w-full h-full"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <Package size={20} strokeWidth={1.5} className="text-muted" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-ink font-display line-clamp-1">{name}</h4>
                      <p className="text-xs text-muted font-body">{varName}</p>
                      <p className="text-xs text-muted font-body mt-0.5">
                        {item.quantity} ×{' '}
                        {/* A price agreed with them: the product's price struck
                            through and theirs beside it, per unit. */}
                        {perUnitOff(item) > 0 ? (
                          <>
                            <span className="line-through">€{num(item.unit_price).toFixed(2)}</span>{' '}
                            <span className="font-semibold text-success">€{Math.max(0, num(item.unit_price) - perUnitOff(item)).toFixed(2)}</span>
                          </>
                        ) : (
                          <>€{num(item.unit_price).toFixed(2)}</>
                        )}
                      </p>
                    </div>
                    <span className="text-base font-bold text-ink font-display shrink-0">
                      €{num(item.line_total).toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          )}

          {/* Customer notes */}
          {order.customer_notes && (
            <div className="bg-surface-white border border-border/60 rounded-lg p-6">
              <h3 className="text-sm font-bold text-ink font-display mb-2">{t('order.customer_notes')}</h3>
              <p className="text-sm text-gray font-body italic">"{order.customer_notes}"</p>
            </div>
          )}
        </div>

        {/* ─── Right: Summary Sidebar ─── */}
        <div>
          <div className="sticky top-[120px] flex flex-col gap-4">
            {/* Summary card */}
            <div className="bg-surface-white border border-border/60 rounded-lg p-6">
              <h3 className="text-lg font-extrabold text-ink font-display mb-5">{t('order.summary')}</h3>
              <div className="flex flex-col gap-3 mb-5">
                <div className="flex justify-between text-sm font-display">
                  <span className="text-gray">{t('order.subtotal')}</span>
                  <span className="text-ink font-semibold">€{num(order.subtotal).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-display">
                  <span className="text-gray">{t('order.delivery_fee')}</span>
                  {deliveryFeeIsPending(order) ? (
                    /* A wholesale order the office has not priced yet. "Free"
                       here is a promise we then break when the fee lands. */
                    <span className="text-gray font-semibold">{t('order.feeComesLater')}</span>
                  ) : (
                    <span className="text-ink font-semibold">€{num(order.delivery_fee).toFixed(2)}</span>
                  )}
                </div>
                {/* Part of the total for a customer under the regime; a part of
                    a split purchase carries none (its purchase does, below). */}
                {num(order.recargo) > 0 && (
                  <div className="flex justify-between text-sm font-display">
                    <span className="text-gray">{t('order.recargo')}</span>
                    <span className="text-ink font-semibold">€{num(order.recargo).toFixed(2)}</span>
                  </div>
                )}
              </div>
              <div className="border-t border-border/60 pt-4">
                <div className="flex justify-between">
                  <span className="text-lg font-extrabold text-ink font-display">{t('order.total')}</span>
                  <span className="text-2xl font-extrabold text-ink font-display">€{num(order.total).toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Delivery address */}
            {order.address_snapshot && (
              <div className="bg-surface-white border border-border/60 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-3">
                  <MapPin size={16} className="text-brand" />
                  <h3 className="text-sm font-bold text-ink font-display">{t('order.delivery_address')}</h3>
                </div>
                <p className="text-sm font-semibold text-ink font-display">{order.address_snapshot.contact_name}</p>
                <p className="text-sm text-gray font-body mt-1">{order.address_snapshot.street_line_1}</p>
                {order.address_snapshot.street_line_2 && (
                  <p className="text-sm text-gray font-body">{order.address_snapshot.street_line_2}</p>
                )}
                <p className="text-sm text-gray font-body">
                  {order.address_snapshot.postcode} {order.address_snapshot.city}, {order.address_snapshot.province}
                </p>
                <p className="text-sm text-gray font-body">España</p>
                <p className="text-sm text-gray font-body mt-2">📞 {order.address_snapshot.contact_phone}</p>
              </div>
            )}

            {/* A "Delivery slot" card stood here, headed with the words for a
                booked window under a line of hardcoded English. There is no
                slot: booked windows went with the zone system and no order
                ever carried one. The status pill and the timeline on this page
                already say where the order is, which is the thing the customer
                opened it to find out. */}

            {/* Rider — visible once an order is being fulfilled */}
            {order.rider && ['preparing', 'on_the_way', 'delivered'].includes(order.status) && (
              <RiderCard rider={order.rider} delivered={order.status === 'delivered'} />
            )}

            {/* Payment */}
            <div className="bg-surface-white border border-border/60 rounded-lg p-6">
              <div className="flex items-center gap-2 mb-3">
                <CreditCard size={16} className="text-brand" />
                <h3 className="text-sm font-bold text-ink font-display">{t('order.payment_method')}</h3>
              </div>
              <p className="text-sm text-gray font-body">
                {order.payment_method === 'cod' ? t('order.cod') : t('order.card')}
              </p>
            </div>

            {/* Why both buttons are gone. The way out of an issued invoice is
                a credit note, which a customer cannot raise themselves — so
                the honest instruction is to get in touch, not to try again. */}
            {lockedBy && (
              <div className="rounded-xl border border-border bg-surface-linen px-3 py-2.5 flex items-start gap-2">
                <Lock size={14} strokeWidth={1.75} className="text-muted shrink-0 mt-0.5" />
                <p className="text-xs text-gray font-body leading-relaxed">
                  {lang === 'en'
                    ? <>This order is final — invoice <span className="font-mono text-ink">{lockedBy.invoice_number ?? '—'}</span> has been issued for it. Get in touch if something needs changing.</>
                    : <>Este pedido es definitivo: ya se ha emitido la factura <span className="font-mono text-ink">{lockedBy.invoice_number ?? '—'}</span>. Contacta con nosotros si necesitas cambiar algo.</>}
                </p>
              </div>
            )}

            {/* Cancel — while the shop still has the order (pending /
                confirmed / preparing, plus a draft that was never stocked).
                Widened from pending/confirmed on 2026-09-30 to match the
                editing window: the two have to agree. Once a rider has it,
                stopping the order is a phone call, not a button. */}
            {canCancel && (
              <button
                onClick={() => setCancelOpen(true)}
                className="w-full h-11 rounded-xl text-sm font-semibold border-2 border-danger/40 text-danger bg-card hover:bg-danger-bg/40 transition-colors inline-flex items-center justify-center gap-2"
              >
                <XCircle size={16} strokeWidth={2} />
                {lang === 'en' ? 'Cancel order' : 'Cancelar pedido'}
              </button>
            )}

            {/* Order again: once it is over — and any time for a Home Grocery
                order, whose products are the household's usual list. */}
            {(order.status === 'delivered' || order.status === 'cancelled' || (isPlan && order.status !== 'draft')) && order.id && (
              <ReorderButton
                orderId={order.id}
                label={t('order.reorder')}
                className="w-full h-12 bg-brand text-white rounded-xl text-sm font-bold font-display hover:bg-brand-mid active:scale-[0.98] transition-all shadow-md disabled:opacity-60 inline-flex items-center justify-center gap-2"
              />
            )}
          </div>
        </div>
      </div>

      {/* Cancel modal — reason is OPTIONAL for customers (most cancels are
          "changed my mind"). Backdrop click dismisses. Once confirmed, the
          existing useCancelOrder mutation restocks + fires notification;
          modal closes on success, order card re-renders as cancelled.
          Hidden while the progress panel is up, and back if the cancel fails. */}
      {cancelOpen && !(cancelOrder.isPending && cancelPanelUp) && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => { if (!cancelOrder.isPending) setCancelOpen(false); }}
        >
          <div
            className="bg-card rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 shadow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-danger-bg text-danger flex items-center justify-center shrink-0">
                <XCircle size={20} strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-bold font-display text-ink leading-tight">
                  {lang === 'en' ? 'Cancel this order?' : '¿Cancelar este pedido?'}
                </h3>
                <p className="text-xs font-body text-muted mt-1 leading-snug">
                  {lang === 'en'
                    ? "The store will be notified and any charged amount refunded. You can reorder anytime."
                    : "La tienda será notificada y cualquier importe cobrado se reembolsará. Puedes volver a pedir en cualquier momento."}
                </p>
              </div>
            </div>
            <label className="text-xs font-semibold text-ink uppercase tracking-wider mb-1 block">
              {lang === 'en' ? 'Reason (optional)' : 'Motivo (opcional)'}
            </label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder={lang === 'en' ? 'Tell the store what happened (optional)' : 'Dile a la tienda qué pasó (opcional)'}
              rows={3}
              className="w-full rounded-lg border border-border bg-surface-cream p-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-danger/30 resize-none"
            />
            {cancelOrder.isError && (
              <p role="alert" className="mt-2 text-xs text-danger font-body">
                {cancelOrder.error instanceof Error ? cancelOrder.error.message : 'Something went wrong.'}
              </p>
            )}
            <div className="flex items-center gap-2 mt-5">
              <button
                type="button"
                onClick={() => setCancelOpen(false)}
                disabled={cancelOrder.isPending}
                className="flex-1 h-11 rounded-xl text-sm font-semibold border border-border text-ink hover:bg-surface-cream disabled:opacity-50"
              >
                {lang === 'en' ? 'Keep order' : 'Mantener'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!order.id) return;
                  const key = newProgressKey();
                  setCancelKey(key);
                  setCancelPanelUp(false);
                  cancelOrder.mutate(
                    { id: order.id, reason: cancelReason.trim() || undefined, progressKey: key },
                    { onSuccess: () => { setCancelOpen(false); setCancelReason(''); } },
                  );
                }}
                disabled={cancelOrder.isPending}
                className="flex-1 h-11 rounded-xl text-sm font-semibold text-white bg-danger hover:bg-danger/90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                <XCircle size={16} strokeWidth={2} />
                {cancelOrder.isPending
                  ? (lang === 'en' ? 'Cancelling…' : 'Cancelando…')
                  : (lang === 'en' ? 'Cancel order' : 'Cancelar')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Cancelling a big order restocks every line: say so while it runs.
          Outside the cancel box, which hides once this shows. */}
      {cancelOrder.isPending && (
        <OrderProgressPanel
          key={cancelKey ?? 'cancel'}
          kind="cancel"
          phase="server"
          progressKey={cancelKey}
          lang={lang}
          detail={{ lines: order.items?.length }}
          onVisible={() => setCancelPanelUp(true)}
        />
      )}
    </div>
  );
}

// MV Slice 4 — Parent order view. Renders when the fetched entity is a
// ParentOrder (cross-store checkout). Shows per-store cards with each sub's
// current status + mini-timeline, plus a shared summary/address/payment
// sidebar (the same delivery address applies to every sub in this cart).
// Clicking a per-store card jumps to the sub-order detail (which renders
// the full timeline + items + rider for just that store).
// MV Slice 4 — one shipment card per store in a cross-store checkout.
//
// UX concept: this card treats each store's slice as a "shipment" the
// customer is tracking, not a mini-order editor. So the hero is the
// products + a plain-English status message ("Waiting for Cesto to
// confirm your order"), not a technical timeline the customer has to
// interpret. The timeline is present but slimmed down to a single filled
// progress bar with dot stops — enough to see position at a glance,
// without eating half the card.
//
// Layout stacks: header (identity + status) → product thumbnails strip
// → status message → progress bar → footer (rider + total + open). Each
// section is quiet on its own; together they read as one clean card.

type ShipmentSub = {
  id: string; order_number: string; status: OrderStatus; total: string | number;
  store?: {
    id: string; slug: string; name: string; logo_url?: string | null;
    /** MV Slice 4+ — 'paused' surfaces a "Store paused" chip on the card. */
    status?: 'draft' | 'live' | 'paused' | 'suspended';
  } | null;
  items?: Array<{ id: string; quantity: number; unit_price: string | number; line_total: string | number; discount_amount?: string | number | null; unit_discount?: string | number | null; product_snapshot: any }>;
  rider?: { id: string; name: string; phone: string; vehicle_type: string } | null;
};

interface StoreShipmentCardProps {
  sub: ShipmentSub;
  onOpen: () => void;
  lang: 'en' | 'es';
  t: (key: string) => string;
}

function StoreShipmentCard({ sub, onOpen, lang, t }: StoreShipmentCardProps) {
  const num = (v: unknown) => typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  const style = statusStyles[sub.status];
  const stepIdx = STEPS.findIndex((s) => s.key === sub.status);
  const items = sub.items ?? [];
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const isCancelled = sub.status === 'cancelled';
  const isDelivered = sub.status === 'delivered';
  const storeName = sub.store?.name ?? 'Cesto';
  const storeInitial = storeName.charAt(0).toUpperCase();

  // Plain-English status copy — tells the customer WHAT is happening,
  // not just the enum value. Every state pairs a headline (current fact)
  // with an optional sub-line (what to expect next).
  const statusMessage = (() => {
    if (lang === 'es') {
      switch (sub.status) {
        case 'pending':    return { headline: `${storeName} aún no confirma tu pedido`,      hint: 'Se avisa cuando lo acepten' };
        case 'confirmed':  return { headline: `${storeName} pronto empezará a prepararlo`,   hint: 'A la espera de empaquetado' };
        case 'preparing':  return { headline: `${storeName} está preparando tus productos`,  hint: 'El repartidor recogerá pronto' };
        case 'on_the_way': return { headline: 'Tu repartidor va en camino',                  hint: sub.rider ? `Con ${sub.rider.name}` : null };
        case 'delivered':  return { headline: '¡Entregado!',                                 hint: 'Disfruta tu compra' };
        case 'cancelled':  return { headline: 'Pedido cancelado',                            hint: null };
        case 'draft':      return { headline: `${storeName} no tiene stock de un artículo`,  hint: 'Te avisaremos en cuanto lo confirmen' };
        default:           return { headline: t(`order.timeline.${sub.status}`),             hint: null };
      }
    }
    switch (sub.status) {
      case 'pending':    return { headline: `${storeName} hasn't confirmed your order yet`, hint: 'You’ll be notified when they accept' };
      case 'confirmed':  return { headline: `${storeName} will start packing shortly`,      hint: 'Waiting to begin preparation' };
      case 'preparing':  return { headline: `${storeName} is preparing your items`,         hint: 'A rider will pick up soon' };
      case 'on_the_way': return { headline: 'Your rider is on the way',                     hint: sub.rider ? `Delivered by ${sub.rider.name}` : null };
      case 'delivered':  return { headline: 'Delivered!',                                    hint: 'Enjoy your order' };
      case 'cancelled':  return { headline: 'Order cancelled',                               hint: null };
      case 'draft':      return { headline: `${storeName} is short on stock for an item`,    hint: "We'll let you know once it's confirmed" };
      default:           return { headline: t(`order.timeline.${sub.status}`),               hint: null };
    }
  })();

  // Slim progress bar: fill percent scales with reached-step index.
  // Delivered subs go 100% green; anything else in brand.
  const progressPct = isCancelled ? 0 : Math.max(5, ((stepIdx + 1) / STEPS.length) * 100);
  const barFill = isDelivered ? '#16A34A' : 'var(--color-brand, #054EE8)';

  return (
    <article className="group bg-card rounded-2xl border border-border/50 shadow-[0_1px_2px_rgba(0,0,0,0.03),0_2px_12px_rgba(0,0,0,0.04)] hover:shadow-[0_2px_4px_rgba(0,0,0,0.05),0_8px_28px_rgba(0,0,0,0.06)] transition-all overflow-hidden">
      {/* ─── Header — identity + solid status pill ─── */}
      <header className="flex items-center gap-3.5 px-5 pt-5 pb-4">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-surface-cream to-surface-linen ring-1 ring-border/40 overflow-hidden flex items-center justify-center shrink-0">
          {sub.store?.logo_url
            ? <img src={sub.store.logo_url} alt="" className="w-full h-full object-cover" />
            : <span className="text-base font-extrabold font-display text-ink/50">{storeInitial}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[15px] font-bold text-ink font-display truncate leading-tight">{storeName}</p>
            {/* MV Slice 4+ — subtle chip when the fulfilling store paused
                after this order was placed. Existing orders keep working
                (partner still sees them in their dashboard) but status
                updates may be delayed while paused. */}
            {sub.store?.status === 'paused' && (
              <span
                className="inline-flex items-center gap-1 h-5 px-1.5 rounded-full bg-warning-bg text-warning text-[9.5px] font-bold uppercase tracking-wider"
                title={lang === 'en'
                  ? 'This store is temporarily paused. Updates may be delayed.'
                  : 'Esta tienda está pausada temporalmente. Las actualizaciones pueden demorarse.'}
              >
                {lang === 'en' ? 'Store paused' : 'Tienda pausada'}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted font-mono truncate mt-0.5">{sub.order_number}</p>
        </div>
        <span
          className="inline-flex items-center h-6 px-2.5 rounded-full text-[10px] font-bold text-white uppercase tracking-wider shrink-0"
          style={{ backgroundColor: style.color, boxShadow: `0 1px 4px ${style.color}40` }}
        >
          {t(`orders.status.${sub.status}`)}
        </span>
      </header>

      {/* ─── Status message + progress bar ─── */}
      {isCancelled ? (
        <div className="mx-5 mb-5 px-4 py-3 rounded-xl bg-danger-bg/60 border border-danger/15 flex items-start gap-2.5">
          <X size={16} strokeWidth={2.25} className="text-danger mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-danger font-display leading-tight">{statusMessage.headline}</p>
          </div>
        </div>
      ) : (
        <div className="px-5 pb-4">
          <div className="mb-3">
            <p className="text-sm font-bold text-ink font-display leading-snug">{statusMessage.headline}</p>
            {statusMessage.hint && (
              <p className="text-xs text-muted font-body mt-0.5">{statusMessage.hint}</p>
            )}
          </div>
          {/* Slim progress bar. Dots mark each step boundary; the filled
              portion extends to the current step; a subtle marker dot
              sits at the leading edge. Cheaper on the eye than 5 icons. */}
          <div className="relative h-1.5 rounded-full bg-border/40 overflow-visible">
            <div
              className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%`, backgroundColor: barFill }}
            />
            {STEPS.map((step, i) => {
              const pct = ((i + 1) / STEPS.length) * 100;
              const reached = i <= stepIdx;
              return (
                <span
                  key={step.key}
                  className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 rounded-full transition-colors ${
                    reached ? '' : 'bg-border'
                  }`}
                  style={{
                    left: `${pct}%`,
                    ...(reached ? { backgroundColor: barFill } : {}),
                  }}
                />
              );
            })}
          </div>
          {/* Tiny step labels underneath — only shown at sm+ so mobile
              stays clean. Current step's label is bolded + colored. */}
          <div className="hidden sm:grid grid-cols-5 gap-1 mt-2">
            {STEPS.map((step, i) => {
              const short = STEP_SHORT[step.key][lang];
              const isCurrent = i === stepIdx;
              return (
                <span
                  key={step.key}
                  className={`text-[9.5px] text-center leading-none uppercase tracking-wider ${
                    isCurrent
                      ? 'font-bold text-brand'
                      : i < stepIdx
                        ? 'font-semibold text-ink/50'
                        : 'text-muted/50'
                  }`}
                >
                  {short}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Product thumbnails — sits just above the footer so the
          "receipt-like" content lives next to the total + Track action ─── */}
      {items.length > 0 && (
        <div className="px-5 pb-4 flex items-center gap-2">
          <div className="flex -space-x-2">
            {items.slice(0, 4).map((item) => {
              const snap = item.product_snapshot ?? {};
              const name = (lang === 'en' ? snap.name_en : snap.name_es) ?? snap.name_es ?? '';
              return (
                <div
                  key={item.id}
                  title={name}
                  className="photo-well w-11 h-11 rounded-xl bg-surface-linen border-2 border-card ring-1 ring-border/40 overflow-hidden flex items-center justify-center shrink-0"
                >
                  {snap.image_url ? (
                    <img
                      src={resolveImageUrl(snap.image_url, 'thumb')}
                      alt={name}
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <Package size={16} strokeWidth={1.5} className="text-muted" />
                  )}
                </div>
              );
            })}
            {items.length > 4 && (
              <div className="w-11 h-11 rounded-xl bg-card border-2 border-card ring-1 ring-border/40 flex items-center justify-center text-[11px] font-bold text-ink/70 font-display shrink-0">
                +{items.length - 4}
              </div>
            )}
          </div>
          <span className="text-xs text-muted font-body ml-1">
            {itemCount} {itemCount === 1 ? t('order.item_count') : t('order.items_count')}
          </span>
        </div>
      )}

      {/* ─── Footer — rider (if any) + total + Track ─── */}
      <div className="px-5 py-3.5 border-t border-border/40 bg-surface-cream/30 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {sub.rider ? (
            <span
              className="inline-flex items-center gap-1.5 h-7 pl-1.5 pr-2.5 rounded-full bg-brand-mist/70 text-brand text-[11.5px] font-semibold font-display max-w-full"
              title={sub.rider.name}
            >
              <Truck size={12} strokeWidth={2.25} className="shrink-0" />
              <span className="truncate">{sub.rider.name}</span>
            </span>
          ) : (
            <span className="text-[11px] text-muted font-body italic">
              {lang === 'en' ? 'Rider not yet assigned' : 'Repartidor sin asignar'}
            </span>
          )}
        </div>
        <span className="text-[15px] font-extrabold text-ink font-display font-mono tabular-nums">
          €{num(sub.total).toFixed(2)}
        </span>
        <button
          onClick={onOpen}
          className="inline-flex items-center gap-1 h-8 pl-3 pr-2 rounded-lg bg-card border border-border/70 text-ink text-xs font-bold font-display hover:border-brand hover:text-brand hover:bg-brand-mist/40 transition-colors shrink-0"
        >
          {lang === 'en' ? 'Track' : 'Seguir'}
          <ChevronRight size={13} strokeWidth={2.5} />
        </button>
      </div>
    </article>
  );
}

// Short step labels for the tiny under-bar legend. Long forms would wrap
// or truncate in a 5-column grid; these are UPPERCASE tracking-wider so
// they read as micro-metadata, not real copy.
const STEP_SHORT: Record<OrderStatus, { en: string; es: string }> = {
  pending:             { en: 'Placed',    es: 'Realizado'  },
  confirmed:           { en: 'Confirmed', es: 'Confirmado' },
  preparing:           { en: 'Packing',   es: 'Preparando' },
  on_the_way:          { en: 'On way',    es: 'En camino'  },
  delivered:           { en: 'Delivered', es: 'Entregado'  },
  cancelled:           { en: 'Cancelled', es: 'Cancelado'  },
  partially_completed: { en: 'Mixed',     es: 'Mixto'      },
  // Never actually looked up — this map is only ever indexed by STEPS'
  // fixed 5 keys (never 'draft'), but Record<OrderStatus,...> still needs
  // to be exhaustive.
  draft:               { en: 'Draft',     es: 'Borrador'   },
};

interface ParentOrderViewProps {
  parent: {
    id: string;
    order_number: string;
    subtotal: string | number;
    delivery_fee_total: string | number;
    recargo?: string | number | null;
    total: string | number;
    created_at: string;
    payment_method: 'cod' | 'card' | 'bizum';
    customer_notes: string | null;
    address_snapshot: {
      contact_name: string; contact_phone: string;
      street_line_1: string; street_line_2?: string | null;
      postcode: string; city: string; province: string;
    } | null;
    derived_status?: OrderStatus;
    sub_orders?: Array<{
      id: string; order_number: string; status: OrderStatus; total: string | number;
      /* A ParentOrder has no buyer_is_business of its own; its parts carry it,
         while the fee for the whole purchase sits on the parent. */
      buyer_is_business?: boolean | null;
      store?: { id: string; slug: string; name: string; logo_url?: string | null } | null;
      items?: Array<{ id: string; quantity: number; unit_price: string | number; line_total: string | number; discount_amount?: string | number | null; unit_discount?: string | number | null; product_snapshot: any }>;
      rider?: { id: string; name: string; phone: string; vehicle_type: string } | null;
    }>;
  };
}

function ParentOrderView({ parent }: ParentOrderViewProps) {
  const navigate = useNavigate();
  const { lang, t } = useLanguageStore();
  const num = (v: unknown) => typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  const date = new Date(parent.created_at);
  const locale = lang === 'en' ? 'en-GB' : 'es-ES';
  const placedOn = date.toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' })
    + ' • ' + date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const subs = parent.sub_orders ?? [];
  const derived = parent.derived_status ?? 'pending';

  return (
    <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
      <div className="flex items-center gap-2 text-sm font-body text-muted mb-6">
        <button onClick={() => navigate('/')} className="hover:text-brand transition-colors">{t('common.home')}</button>
        <ChevronRight size={14} />
        <button onClick={() => navigate('/orders')} className="hover:text-brand transition-colors">{t('orders.title')}</button>
        <ChevronRight size={14} />
        <span className="text-ink font-semibold">{parent.order_number}</span>
      </div>

      <button
        onClick={() => navigate('/orders')}
        className="flex items-center gap-2 text-sm font-semibold text-muted hover:text-brand transition-colors mb-4"
      >
        <ArrowLeft size={16} />
        {t('order.back_to_orders')}
      </button>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-3xl font-extrabold text-ink font-display font-mono">{parent.order_number}</h1>
            <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-brand-mist text-brand text-xs font-bold uppercase tracking-wide">
              <GitBranch size={11} strokeWidth={2.25} />
              {lang === 'en'
                ? `${subs.length} ${subs.length === 1 ? 'store' : 'stores'}`
                : `${subs.length} ${subs.length === 1 ? 'tienda' : 'tiendas'}`}
            </span>
          </div>
          <p className="text-sm text-muted font-body mt-1">
            {t('order.placed_on')} {placedOn}
          </p>
        </div>
        <StatusPill status={derived} label={t(`orders.status.${derived}`)} />
      </div>

      <p className="text-sm text-muted font-body mb-8">
        {lang === 'en'
          ? 'Each store below fulfils its own slice. Status advances independently per store.'
          : 'Cada tienda cumple su parte. El estado avanza de forma independiente por tienda.'}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: per-store cards */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {subs.map((sub) => (
            <StoreShipmentCard
              key={sub.id}
              sub={sub}
              onOpen={() => navigate(`/orders/${sub.id}`)}
              lang={lang}
              t={t}
            />
          ))}

          {parent.customer_notes && (
            <div className="bg-surface-white border border-border/60 rounded-lg p-6">
              <h3 className="text-sm font-bold text-ink font-display mb-2">{t('order.customer_notes')}</h3>
              <p className="text-sm text-gray font-body italic">"{parent.customer_notes}"</p>
            </div>
          )}
        </div>

        {/* Right: shared summary + address + payment */}
        <div>
          <div className="sticky top-[120px] flex flex-col gap-4">
            <div className="bg-surface-white border border-border/60 rounded-lg p-6">
              <h3 className="text-lg font-extrabold text-ink font-display mb-5">{t('order.summary')}</h3>
              <div className="flex flex-col gap-3 mb-5">
                <div className="flex justify-between text-sm font-display">
                  <span className="text-gray">{t('order.subtotal')}</span>
                  <span className="text-ink font-semibold">€{num(parent.subtotal).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-display">
                  <span className="text-gray">{t('order.delivery_fee')}</span>
                  {/* A purchase is never a part, so its own zero is the
                      only question — see deliveryFeeIsPending. */}
                  {deliveryFeeIsPending({ delivery_fee: parent.delivery_fee_total }) ? (
                    <span className="text-gray font-semibold">{t('order.feeComesLater')}</span>
                  ) : (
                    <span className="text-ink font-semibold">€{num(parent.delivery_fee_total).toFixed(2)}</span>
                  )}
                </div>
                {num(parent.recargo) > 0 && (
                  <div className="flex justify-between text-sm font-display">
                    <span className="text-gray">{t('order.recargo')}</span>
                    <span className="text-ink font-semibold">€{num(parent.recargo).toFixed(2)}</span>
                  </div>
                )}
              </div>
              <div className="border-t border-border/60 pt-4">
                <div className="flex justify-between">
                  <span className="text-lg font-extrabold text-ink font-display">{t('order.total')}</span>
                  <span className="text-2xl font-extrabold text-ink font-display">€{num(parent.total).toFixed(2)}</span>
                </div>
              </div>
            </div>

            {parent.address_snapshot && (
              <div className="bg-surface-white border border-border/60 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-3">
                  <MapPin size={16} className="text-brand" />
                  <h3 className="text-sm font-bold text-ink font-display">{t('order.delivery_address')}</h3>
                </div>
                <p className="text-sm font-semibold text-ink font-display">{parent.address_snapshot.contact_name}</p>
                <p className="text-sm text-gray font-body mt-1">{parent.address_snapshot.street_line_1}</p>
                {parent.address_snapshot.street_line_2 && (
                  <p className="text-sm text-gray font-body">{parent.address_snapshot.street_line_2}</p>
                )}
                <p className="text-sm text-gray font-body">
                  {parent.address_snapshot.postcode} {parent.address_snapshot.city}, {parent.address_snapshot.province}
                </p>
                <p className="text-sm text-gray font-body">España</p>
                <p className="text-sm text-gray font-body mt-2">📞 {parent.address_snapshot.contact_phone}</p>
              </div>
            )}

            <div className="bg-surface-white border border-border/60 rounded-lg p-6">
              <div className="flex items-center gap-2 mb-3">
                <CreditCard size={16} className="text-brand" />
                <h3 className="text-sm font-bold text-ink font-display">{t('order.payment_method')}</h3>
              </div>
              <p className="text-sm text-gray font-body">
                {parent.payment_method === 'cod' ? t('order.cod') : t('order.card')}
              </p>
              <p className="text-xs text-muted font-body mt-1">
                {lang === 'en'
                  ? 'One payment covers all stores in this order.'
                  : 'Un solo pago cubre todas las tiendas de este pedido.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
