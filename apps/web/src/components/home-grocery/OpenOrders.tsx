import { Link } from 'react-router-dom';
import { CalendarDays, Check, ChevronRight, Pencil, Truck } from 'lucide-react';
import { deliveryFeeIsPending, type PlanUpcoming } from '@grocery-app/shared';
import RiderCard from '@/components/RiderCard';
import { StatusChip } from './plan/PlanHistory';
import { euros, planDate, windowLine, type Lang, type PlanCopy } from './planCopy';

/** Where an order goes after it is placed — the order page's steps. */
const STEPS = ['pending', 'confirmed', 'preparing', 'on_the_way', 'delivered'] as const;
/** The customer edit rule (routes/orders.ts EDITABLE_STATUSES). */
const EDITABLE = ['pending', 'confirmed', 'preparing'];

/**
 * The delivery day as a calendar leaf: the weekday, the date big, the month.
 * It is the one thing a household plans around, so it is the first thing the
 * card says. Read as the calendar day it is stored as (UTC midnight).
 */
function DateLeaf({ iso, lang }: { iso: string; lang: Lang }) {
  const d = new Date(iso);
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'es-ES', { ...o, timeZone: 'UTC' }).format(d).replace('.', '');
  return (
    <div className="w-[64px] shrink-0 rounded-xl bg-brand-whisper border border-brand/15 overflow-hidden text-center" aria-hidden="true">
      <div className="bg-brand text-white text-[11px] font-bold font-ui py-0.5 first-letter:uppercase">{fmt({ weekday: 'short' })}</div>
      <div className="pt-1 text-[24px] leading-none font-extrabold font-display text-ink tabular-nums">{fmt({ day: 'numeric' })}</div>
      <div className="pb-1.5 pt-0.5 text-[11.5px] font-semibold font-ui text-brand first-letter:uppercase">{fmt({ month: 'short' })}</div>
    </div>
  );
}

/**
 * Where it has got to, as five stops on a line. Every label shows from sm;
 * on a phone only the current one, under its stop, so the row never wraps.
 */
function Progress({ current, labels }: { current: number; labels: Record<string, string> }) {
  return (
    <ol className="grid grid-cols-5" aria-label={labels[STEPS[current]]}>
      {STEPS.map((step, i) => {
        const reached = i <= current;
        const isCurrent = i === current;
        return (
          <li key={step} aria-current={isCurrent ? 'step' : undefined} className="relative flex flex-col items-center text-center">
            {i > 0 && (
              <span aria-hidden="true"
                className={`absolute top-[11px] -left-1/2 right-1/2 h-[3px] -translate-y-1/2 rounded-full ${reached ? 'bg-brand' : 'bg-border'}`} />
            )}
            <span className={`relative z-10 w-[22px] h-[22px] rounded-full flex items-center justify-center border-2 transition-colors ${
              isCurrent ? 'bg-card border-brand ring-4 ring-brand-mist'
                : reached ? 'bg-brand border-brand text-white'
                : 'bg-card border-border'
            }`}>
              {isCurrent
                ? <span className="w-2 h-2 rounded-full bg-brand" />
                : reached ? <Check size={12} strokeWidth={3} /> : null}
            </span>
            <span className={`mt-1.5 text-[11.5px] leading-tight font-ui px-0.5 ${
              isCurrent ? 'font-bold text-ink' : `hidden sm:block ${reached ? 'text-charcoal' : 'text-muted'}`
            }`}>
              {labels[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** One order under way, as a row of the card: when, where it has got to, what it comes to, what can change. */
function OpenOrderRow({ order, c, lang, onChangeSlot }: {
  order: PlanUpcoming; c: PlanCopy; lang: Lang; onChangeSlot: () => void;
}) {
  const current = STEPS.indexOf(order.status as (typeof STEPS)[number]);
  const showRider = order.rider && ['preparing', 'on_the_way'].includes(order.status);
  // A fee our team has not set yet — never shown as if delivery were free.
  const feePending = deliveryFeeIsPending(order);
  const canMove = order.editable && !!order.scheduled_for;
  const canEdit = EDITABLE.includes(order.status);

  const ghost = 'min-h-[42px] px-3.5 rounded-xl border border-border bg-card text-ink text-[13.5px] font-bold font-display inline-flex items-center justify-center gap-1.5 hover:border-brand/50 hover:text-brand transition-colors';

  return (
    <li className="p-4 sm:p-5">
      <div className="flex gap-4">
        {order.scheduled_for && <DateLeaf iso={order.scheduled_for} lang={lang} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[17px] font-bold font-display text-ink leading-snug first-letter:uppercase">
                {order.scheduled_for ? planDate(order.scheduled_for, lang) : c.noUpcoming}
              </h3>
              <p className="text-[13.5px] text-gray font-ui">{windowLine(order.delivery_window, lang)}</p>
            </div>
            <span className="hidden sm:block shrink-0">
              <StatusChip statusKey={order.status} label={c.upcomingStatus[order.status] ?? order.status} />
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-muted font-ui truncate">
            <span className="font-mono">{order.order_number}</span> · {c.itemsCount(order.item_count)}
          </p>
        </div>
      </div>

      {current >= 0 && (
        <div className="mt-4">
          <Progress current={current} labels={c.steps} />
        </div>
      )}
      <p className="mt-3 text-[13px] text-charcoal font-body leading-relaxed">{c.upcomingNote[order.status]}</p>
      {showRider && order.rider && <div className="mt-3"><RiderCard rider={order.rider} delivered={false} /></div>}

      {/* What it comes to, and what can still change. */}
      <div className="mt-4 rounded-xl bg-surface-cream/70 px-3.5 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[18px] font-extrabold font-display text-ink tabular-nums leading-tight">
            {euros(order.total, lang)}
            <span className="ml-1.5 text-[12px] font-semibold font-ui text-gray">{c.estTotal}</span>
          </p>
          <p className={`text-[12.5px] font-ui ${feePending ? 'text-warning font-semibold' : 'text-gray'}`}>
            {feePending ? c.feeLaterLine : c.feeIncludedLine(euros(order.delivery_fee, lang))}
          </p>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:justify-end gap-2 shrink-0">
          {canMove && (
            <button type="button" onClick={onChangeSlot} className={ghost}>
              <CalendarDays size={15} strokeWidth={1.75} /> {c.changeDay}
            </button>
          )}
          {canEdit && (
            <Link to={`/orders/${order.id}/edit`} className={ghost}>
              <Pencil size={15} strokeWidth={1.75} /> {c.editShort}
            </Link>
          )}
          <Link to={`/orders/${order.id}`}
            className="col-span-2 sm:col-auto min-h-[42px] px-4 rounded-xl bg-brand text-white text-[13.5px] font-bold font-display inline-flex items-center justify-center gap-1 hover:bg-brand-mid transition-colors">
            {c.viewOrder} <ChevronRight size={16} strokeWidth={2} />
          </Link>
        </div>
      </div>
    </li>
  );
}

/**
 * "Pedidos en curso" — ONE card, the orders under way inside it, one row
 * each (user request 2026-10-23), earliest first; `empty` fills it when there
 * are none. Each row: the delivery day as a calendar leaf, the order and its
 * status, a five-stop progress line, what the stage means, and a strip with
 * the estimated total, the delivery fee (or that it is to come) and Cambiar
 * día / Editar / Ver el pedido.
 */
export default function OpenOrders({ orders, c, lang, onChangeSlot, empty }: {
  orders: PlanUpcoming[];
  c: PlanCopy;
  lang: Lang;
  onChangeSlot: (order: PlanUpcoming) => void;
  empty: React.ReactNode;
}) {
  return (
    <section aria-labelledby="open-orders-title" className="rounded-lg bg-card border border-border/60 shadow-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 sm:px-5 py-3.5 border-b border-border/60">
        <span className="w-8 h-8 rounded-lg bg-brand-whisper text-brand flex items-center justify-center shrink-0">
          <Truck size={17} strokeWidth={1.75} />
        </span>
        <h2 id="open-orders-title" className="text-[17px] font-bold text-ink font-display">{c.openTitle}</h2>
        {orders.length > 0 && (
          <span className="min-w-[24px] h-6 px-2 rounded-full bg-brand text-white text-[12px] font-bold font-ui inline-flex items-center justify-center tabular-nums">
            {orders.length}
          </span>
        )}
      </div>
      {orders.length > 0 ? (
        <ul className="divide-y divide-border/60">
          {orders.map((o) => (
            <OpenOrderRow key={o.id} order={o} c={c} lang={lang} onChangeSlot={() => onChangeSlot(o)} />
          ))}
        </ul>
      ) : empty}
    </section>
  );
}
