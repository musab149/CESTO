import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronRight, Clock, Loader2, Package, Pencil, ShoppingBasket, Truck, XCircle, SkipForward } from 'lucide-react';
import { usePlanDeliveries, type PlanHistoryFilter } from '@grocery-app/shared';
import { PLAN_COPY, euros, planDate, rowStatusKey, windowLine, type Lang } from '../planCopy';
import ReorderButton from '@/components/ReorderButton';

const FILTERS: PlanHistoryFilter[] = ['all', 'delivered', 'upcoming', 'cancelled'];

export function StatusChip({ statusKey, label }: { statusKey: string; label: string }) {
  const tone =
    statusKey === 'delivered' ? 'bg-success-bg text-success'
    : statusKey === 'cancelled' ? 'bg-danger-bg text-danger'
    : statusKey === 'skipped' ? 'bg-surface-linen text-gray'
    : statusKey === 'on_the_way' ? 'bg-amber-mist text-amber-deep'
    : 'bg-brand-mist text-brand';
  const Icon =
    statusKey === 'delivered' ? CheckCircle2
    : statusKey === 'cancelled' ? XCircle
    : statusKey === 'skipped' ? SkipForward
    : statusKey === 'on_the_way' ? Truck
    : statusKey === 'draft' ? Clock
    : Package;
  return (
    <span className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] font-bold font-ui whitespace-nowrap ${tone}`}>
      <Icon size={13} strokeWidth={2} />
      {label}
    </span>
  );
}

/** Date · order · items · total · status · what can be done, on wide screens. */
const ROW = 'md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_64px_96px_128px_minmax(0,210px)] md:items-center md:gap-4';

/** What a household may still change — the customer edit rule (routes/orders.ts). */
const EDITABLE = ['pending', 'confirmed', 'preparing'];

/**
 * Every Home Grocery order, newest first, filtered and a page at a time —
 * the ones the household placed and the ones placed for them. A row opens
 * the order page (items, rider, receipt); beside it, "Editar" while the
 * order can still change, and "Repetir" to put its products back on the
 * grocery list.
 */
export default function PlanHistory({ lang, heading = true, preview }: {
  lang: Lang;
  /** Off where the page's own title already says what this is (Mis pedidos). */
  heading?: boolean;
  /**
   * The latest few only, with "Ver todos" to the full list (Mis pedidos)
   * instead of loading more here — the Home Grocery page (2026-10-23).
   */
  preview?: { limit: number; viewAllTo: string };
}) {
  const c = PLAN_COPY[lang];
  const [filter, setFilter] = useState<PlanHistoryFilter>('all');
  const q = usePlanDeliveries(filter, preview ? { limit: preview.limit } : {});
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section className="rounded-lg bg-card border border-border/60 overflow-hidden">
      {/* The filters get their own row: beside the lead they were cut off in the two-thirds column. */}
      <div className="flex flex-col gap-3 px-4 md:px-6 py-4 border-b border-border/60">
        {heading && (
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-[18px] font-bold text-ink font-display">{c.historyTitle}</h2>
              <p className="text-[13.5px] text-gray font-body">{c.historyLead}</p>
            </div>
            {preview && (
              <Link to={preview.viewAllTo}
                className="shrink-0 min-h-[40px] px-3.5 rounded-xl border border-border bg-card text-ink text-[13.5px] font-bold font-display inline-flex items-center gap-1 hover:border-brand/50 hover:text-brand transition-colors">
                {c.viewAll} <ChevronRight size={16} strokeWidth={2} />
              </Link>
            )}
          </div>
        )}
        <div className="inline-flex self-start rounded-xl bg-surface-linen p-1 overflow-x-auto max-w-full hide-scrollbar"
          role="group" aria-label={c.historyTitle}>
          {FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
              className={`h-9 px-3.5 rounded-lg text-[13.5px] font-semibold font-ui whitespace-nowrap transition-colors ${
                filter === f ? 'bg-card text-ink shadow-card' : 'text-gray hover:text-ink'
              }`}>
              {c.filters[f]}
            </button>
          ))}
        </div>
      </div>

      <div className={`hidden ${ROW} px-6 py-3 border-b border-border/60 text-[12.5px] font-semibold text-gray font-ui`}>
        <span>{c.colDate}</span>
        <span>{c.colOrder}</span>
        <span className="text-right">{c.colItems}</span>
        <span className="text-right">{c.colTotal}</span>
        <span>{c.colStatus}</span>
        <span className="text-right">{c.colActions}</span>
      </div>

      {q.isLoading ? (
        <div className="p-6 space-y-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-10" />)}
        </div>
      ) : q.isError ? (
        <div className="p-8 text-center">
          <p className="text-[14px] text-gray font-body">{c.loadError}</p>
          <button type="button" onClick={() => q.refetch()}
            className="mt-3 min-h-[44px] px-5 rounded-xl bg-brand text-white text-[14px] font-bold font-display hover:bg-brand-mid">
            {c.retry}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="py-14 px-6 text-center">
          <span className="mx-auto w-14 h-14 rounded-2xl bg-brand-mist/60 text-brand flex items-center justify-center">
            <Package size={26} strokeWidth={1.5} />
          </span>
          <p className="mt-3 text-[14.5px] text-gray font-body">{filter === 'all' ? c.noOrdersYet : c.noHistory}</p>
          {filter === 'all' && (
            <Link to="/"
              className="mt-4 inline-flex min-h-[48px] px-5 rounded-xl bg-brand text-white text-[14px] font-bold font-display items-center gap-2 hover:bg-brand-mid">
              <ShoppingBasket size={17} strokeWidth={2} /> {c.newOrder}
            </Link>
          )}
          {filter !== 'all' && (
            <button type="button" onClick={() => setFilter('all')}
              className="mt-4 min-h-[44px] px-5 rounded-xl border border-border bg-card text-[14px] font-bold text-ink font-display hover:border-brand/40">
              {c.filters.all}
            </button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-border/50">
          {rows.map((r) => {
            const key = rowStatusKey(r);
            return (
              // The row opens the order through a link stretched over it;
              // the two actions sit above that link, so each does its own
              // thing — and no button is nested inside a link.
              <li key={r.id}
                className={`relative flex flex-wrap items-center gap-x-3 gap-y-2 px-4 md:px-6 py-3.5 hover:bg-brand-whisper/60 transition-colors ${ROW}`}>
                  <div className="flex-1 min-w-0">
                    <Link to={`/orders/${r.id}`}
                      className="block text-[14.5px] font-bold text-ink font-display first-letter:uppercase after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand/40">
                      {planDate(r.scheduled_for, lang)}
                    </Link>
                    {r.delivery_window && (
                      <p className="text-[12.5px] text-gray font-ui">{windowLine(r.delivery_window, lang)}</p>
                    )}
                    <p className="md:hidden mt-0.5 text-[12.5px] text-gray font-ui">
                      <span className="font-mono">{r.order_number}</span> · {c.itemsCount(r.item_count)}
                    </p>
                    <div className="md:hidden mt-1.5"><StatusChip statusKey={key} label={c.rowStatus[key] ?? key} /></div>
                  </div>
                  <span className="hidden md:block font-mono text-[13px] text-charcoal truncate">{r.order_number}</span>
                  <span className="hidden md:block text-right text-[13.5px] text-ink font-ui tabular-nums">{r.item_count}</span>
                  <span className="shrink-0 text-right text-[14.5px] font-bold text-ink font-display tabular-nums">{euros(r.total, lang)}</span>
                  <span className="hidden md:block"><StatusChip statusKey={key} label={c.rowStatus[key] ?? key} /></span>
                  <div className="relative z-10 basis-full md:basis-auto flex items-center gap-1.5 md:justify-end">
                    {EDITABLE.includes(r.status) && (
                      <Link to={`/orders/${r.id}/edit`}
                        className="h-9 px-3 rounded-lg text-[13px] font-bold text-brand font-display inline-flex items-center gap-1.5 hover:bg-brand-whisper transition-colors">
                        <Pencil size={14} strokeWidth={1.75} /> {c.editShort}
                      </Link>
                    )}
                    {r.status !== 'draft' && (
                      <ReorderButton
                        orderId={r.id}
                        label={c.reorderShort}
                        className="h-9 px-3 rounded-lg border border-border bg-card text-[13px] font-bold text-ink font-display inline-flex items-center gap-1.5 hover:border-brand/40 transition-colors disabled:opacity-60"
                      />
                    )}
                  </div>
              </li>
            );
          })}
        </ul>
      )}

      {preview && q.hasNextPage && (
        <div className="px-6 py-3.5 border-t border-border/60 flex justify-center">
          <Link to={preview.viewAllTo}
            className="min-h-[44px] px-4 rounded-xl text-[14px] font-bold text-brand font-display inline-flex items-center gap-1 hover:bg-brand-whisper transition-colors">
            {c.viewAllOrders} <ChevronRight size={16} strokeWidth={2} />
          </Link>
        </div>
      )}
      {!preview && q.hasNextPage && (
        <div className="px-6 py-4 border-t border-border/60 flex justify-center">
          <button type="button" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}
            className="min-h-[44px] px-5 rounded-xl border border-border bg-card text-[14px] font-bold text-ink font-display inline-flex items-center gap-2 hover:border-brand/40 disabled:opacity-60">
            {q.isFetchingNextPage && <Loader2 size={16} className="animate-spin" />} {c.loadMore}
          </button>
        </div>
      )}
    </section>
  );
}
