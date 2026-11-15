import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, PencilLine, Truck } from 'lucide-react';
import type { OrderListItem } from '@grocery-app/shared';
import { money, shortDate } from '@/sales/lib/format';
import { useBizT } from '../../lib/i18n';
import { useOrderSource } from '../../lib/orders';
import { prefersLessMotion, type Lang } from '../../lib/homeLook';

/*
 * The order bar at the top of the business home (2026-10-31, user: "if they
 * have order then a bar at the top to show order status and it should be
 * animated"). One line for the order on its way: a truck that rides, what is
 * happening in words, and the road — filled to where it is, a light running
 * along the filled part to say "live". Several orders take turns (paused
 * while a hand is on the bar or the list is open); the arrow opens them all,
 * each on its own road, with View and Edit. Reduced motion: still, no turns.
 *
 * And it IS live (2026-11-01, user: "this order bar should be properly
 * functional… if there are no orders then it should not show up"): the page
 * feeds it useOrdersInProgress, which polls, so a status the team moves on
 * slides the road forward and rises in as new words, a delivered order leaves
 * the bar, and the bar goes when the last one does. It follows the order on
 * show by id, so a refresh never swaps the order under the reader's eyes.
 */

const STOPS = ['pending', 'confirmed', 'preparing', 'on_the_way', 'delivered'] as const;
const EDITABLE: readonly string[] = ['pending', 'confirmed', 'preparing'];
const TURN_MS = 5000;

const pctOf = (status: string) => (Math.max(0, STOPS.indexOf(status as (typeof STOPS)[number])) / (STOPS.length - 1)) * 100;

/** A road: the fill to where the order is, with the light running along it. */
function Road({ status, thin = false }: { status: string; thin?: boolean }) {
  return (
    <span className={`relative block rounded-full bg-surface-sand overflow-hidden ${thin ? 'h-1' : 'h-1.5'}`}>
      <span className="biz-route-fill absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand/60 to-brand overflow-hidden" style={{ width: `${Math.max(pctOf(status), 6)}%` }}>
        <span aria-hidden="true" className="biz-bar-sheen absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent" />
      </span>
    </span>
  );
}

export function OrderBar({ orders, lang }: { orders: OrderListItem[]; lang: Lang }) {
  const t = useBizT();
  const navigate = useNavigate();
  const source = useOrderSource();
  // The order on show, by id — a live refresh can add, drop or reorder orders, and an index would
  // then point at a different one. Gone (delivered, cancelled), the first one takes its place.
  const [shownId, setShownId] = useState<string | null>(null);
  const [held, setHeld] = useState(false);
  const [open, setOpen] = useState(false);
  const many = orders.length > 1;
  // Down to one, the arrow goes — so must the list it opened, or nothing could close it.
  const isOpen = open && many;
  const at = Math.max(0, orders.findIndex((o) => o.id === shownId));
  const order = orders[at];
  const stage = order.status;
  // the turn's timer reads the freshest list without restarting on every refresh
  const ordersRef = useRef(orders);
  useEffect(() => { ordersRef.current = orders; }, [orders]);

  // Several orders take turns — not while it is being looked at or opened.
  useEffect(() => {
    if (!many || held || isOpen || prefersLessMotion()) return undefined;
    const id = window.setInterval(() => {
      setShownId((cur) => {
        const list = ordersRef.current;
        const i = Math.max(0, list.findIndex((o) => o.id === cur));
        return list[(i + 1) % list.length]?.id ?? null;
      });
    }, TURN_MS);
    return () => window.clearInterval(id);
  }, [many, held, isOpen]);

  return (
    <section
      aria-label={t('biz.bar.label')}
      // a mouse hovering holds the turn; a finger tapping doesn't (it never "leaves" again)
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHeld(true); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHeld(false); }}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className="relative overflow-hidden rounded-2xl border border-brand-mist bg-card shadow-card"
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => navigate(`/business/orders/${order.id}`)}
          className="group min-w-0 flex-1 flex items-center gap-3 pl-3.5 sm:pl-4 pr-2 py-3 text-left"
        >
          <span className="relative w-11 h-11 rounded-xl bg-brand text-white flex items-center justify-center shrink-0 shadow-[0_8px_18px_-8px_rgba(5,78,232,0.7)]">
            <Truck size={21} strokeWidth={2} className="biz-bar-truck" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[11.5px] leading-none">
              <span className="relative flex w-2 h-2" aria-hidden="true">
                <span className="biz-live-dot absolute inline-flex w-full h-full rounded-full bg-success opacity-60" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-success" />
              </span>
              <span className="font-semibold font-display text-success whitespace-nowrap">{t('biz.bar.live')}</span>
              {/* A phone keeps the words; the number is a tap away. */}
              <span className="hidden sm:inline text-muted">·</span>
              <span className="hidden sm:inline font-mono text-gray truncate">{order.order_number}</span>
              {many && <span className="ml-auto sm:ml-1 text-muted tabular-nums shrink-0">{at + 1}/{orders.length}</span>}
            </span>
            {/* The words change with the turn, and with a live move on; keyed, they rise in. */}
            <span key={`${order.id}:${stage}`} className="biz-bar-swap block mt-1 text-[15px] sm:text-[16px] font-bold font-display text-ink leading-tight truncate">
              {t(`biz.route.title.${stage}`)}
            </span>
            <span className="block mt-2">
              <Road status={stage} />
            </span>
            <span className="mt-1.5 hidden sm:flex justify-between text-[11px] font-display">
              {STOPS.map((s, i) => (
                <span key={s} className={s === stage ? 'font-bold text-brand' : i < STOPS.indexOf(stage as (typeof STOPS)[number]) ? 'text-charcoal' : 'text-muted'}>
                  {t(`biz.route.stage.${s}`)}
                </span>
              ))}
            </span>
          </span>
          <ChevronRight size={18} strokeWidth={2} className="text-muted shrink-0 transition-transform group-hover:translate-x-0.5" />
        </button>
        {many && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={isOpen}
            aria-label={t(isOpen ? 'biz.bar.hideAll' : 'biz.bar.showAll', { count: orders.length })}
            className="w-12 shrink-0 border-l border-border flex items-center justify-center text-gray hover:text-brand hover:bg-surface-cream transition-colors"
          >
            <ChevronDown size={20} strokeWidth={2} className={`transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* Every order on its way, each on its own road. */}
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        {/* Folded, its buttons are out of reach of the keyboard too. */}
        <div className="overflow-hidden" inert={!isOpen}>
          <ul className="border-t border-border divide-y divide-border">
            {orders.map((o) => (
              <li key={o.id} className="px-3.5 sm:px-4 py-3 flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-[12.5px] font-semibold text-ink truncate">{o.order_number}</span>
                    <span className="text-[11.5px] text-muted truncate">{shortDate(o.created_at, lang)} · {source(o)}</span>
                  </span>
                  <span className="flex items-center gap-2.5 mt-1.5">
                    <span className="text-[12.5px] font-semibold font-display text-brand whitespace-nowrap">{t(`biz.route.stage.${o.status}`)}</span>
                    <span className="flex-1"><Road status={o.status} thin /></span>
                    <span className="text-[13px] font-bold font-display text-ink tabular-nums whitespace-nowrap">{money(o.total)}</span>
                  </span>
                </span>
                {/* A purchase split across shops is changed part by part, from its own page. */}
                {EDITABLE.includes(o.status) && !o.sub_orders?.length && (
                  <button
                    type="button"
                    onClick={() => navigate(`/business/orders/${o.id}/edit`)}
                    aria-label={`${t('biz.route.edit')} ${o.order_number}`}
                    className="w-9 h-9 rounded-lg border border-border text-gray hover:text-brand hover:border-brand/40 flex items-center justify-center shrink-0"
                  >
                    <PencilLine size={16} strokeWidth={1.9} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => navigate(`/business/orders/${o.id}`)}
                  aria-label={`${t('biz.route.open')} ${o.order_number}`}
                  className="w-9 h-9 rounded-lg bg-brand-whisper text-brand hover:bg-brand-mist flex items-center justify-center shrink-0"
                >
                  <ChevronRight size={18} strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
