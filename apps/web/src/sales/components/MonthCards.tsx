import { ArrowRight, BarChart3 } from 'lucide-react';
import { useSalesT } from '../lib/i18n';
import { money } from '../lib/format';

/*
 * The month's money, as three compact cards (2026-10-28, user: "On sales rep
 * dashboard and in earnings we need to show these two cards along with
 * sales... these three cards sales, expenses, and net profit are monthly
 * based", then "we can make these cards smaller and in the same row in front
 * of the welcome one and organize there in bento grids").
 *
 * Sales in the brand's blue; expenses in a warm orange tint, net profit in a
 * green one, as the user's mockup draws them. Small enough to sit as a bento
 * beside the greeting: sales across the top, the other two under it. All
 * three count the same orders: placed this month in Madrid, drafts and
 * cancelled ones not money (API /sales/me for the sales, /sales/earnings
 * `month` for the other two).
 */

/** This month's sales — the one card in the brand's own colour. */
export function MonthSalesCard({ revenue, orders, loading, onClick, className = '' }: {
  revenue: string | number; orders: number; loading: boolean; onClick: () => void; className?: string;
}) {
  const t = useSalesT();
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden text-left rounded-2xl p-4 lg:p-5 min-h-[124px] flex flex-col text-white bg-gradient-to-br from-[#2F6EF0] via-brand to-brand-deepest shadow-[0_14px_30px_-14px_rgba(5,78,232,0.6)] active:scale-[0.995] transition-transform ${className}`}
    >
      <span className="pointer-events-none absolute -right-12 -top-14 w-40 h-40 rounded-full bg-white/[0.08]" aria-hidden="true" />
      <span className="pointer-events-none absolute right-10 -bottom-20 w-36 h-36 rounded-full bg-white/[0.06]" aria-hidden="true" />
      <span className="relative flex items-center gap-2">
        <span className="w-8 h-8 rounded-lg bg-white/15 ring-1 ring-inset ring-white/20 flex items-center justify-center shrink-0">
          <BarChart3 size={16} strokeWidth={1.75} />
        </span>
        <span className="flex-1 min-w-0 text-[14px] font-semibold font-display truncate">{t('sales.today.sales')}</span>
        <span className="h-6 px-2.5 rounded-full bg-white/15 text-[11.5px] font-semibold font-display inline-flex items-center whitespace-nowrap">{t('sales.today.monthChip')}</span>
      </span>
      <span className="relative mt-auto pt-3 flex items-end justify-between gap-3">
        <span className="min-w-0">
          {loading ? (
            <span className="skeleton block h-8 w-32 opacity-50" />
          ) : (
            <span className="block text-[30px] md:text-[26px] 2xl:text-[30px] font-bold font-display tabular-nums leading-none whitespace-nowrap">
              {money(revenue)}
            </span>
          )}
          <span className="block mt-1.5 text-[12.5px] text-white/75 truncate">
            {t(orders === 1 ? 'sales.today.monthOrders_one' : 'sales.today.monthOrders_other', { count: orders })}
          </span>
        </span>
        <span className="w-8 h-8 rounded-full bg-white text-brand flex items-center justify-center shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true">
          <ArrowRight size={16} strokeWidth={2.25} />
        </span>
      </span>
    </button>
  );
}

const TONES = {
  orange: {
    card: 'bg-gradient-to-br from-st-orange-soft to-st-orange-soft-2 ring-st-orange-ring',
    tile: 'bg-st-orange-tile text-st-orange-fg',
    value: 'text-ink',
    arrow: 'bg-st-orange-tile text-st-orange-fg',
  },
  green: {
    card: 'bg-gradient-to-br from-st-emerald-soft to-st-emerald-soft-2 ring-st-emerald-ring',
    tile: 'bg-st-emerald-tile text-st-emerald-fg',
    value: 'text-st-emerald-fg',
    arrow: 'bg-st-emerald-tile text-st-emerald-fg',
  },
} as const;

/** One of the month's two tinted cards: its icon and what it is, the figure, "this month". */
export function MonthCard({ tone, icon: Icon, label, value, loading, onClick, className = '' }: {
  tone: keyof typeof TONES;
  icon: React.ElementType;
  label: string;
  value: string;
  loading: boolean;
  /** Where its arrow goes; none, and it has no arrow. */
  onClick?: () => void;
  className?: string;
}) {
  const t = useSalesT();
  const c = TONES[tone];
  const body = (
    <>
      <span className="flex items-start gap-2">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${c.tile}`}>
          <Icon size={16} strokeWidth={1.9} />
        </span>
        <span className="min-w-0 pt-[5px] text-[13px] font-semibold font-display text-charcoal leading-snug line-clamp-2">{label}</span>
      </span>
      <span className="mt-auto pt-3 flex items-end justify-between gap-2">
        <span className="min-w-0">
          {loading ? (
            <span className="skeleton block h-7 w-20" />
          ) : (
            <span className={`block text-[clamp(20px,5.6vw,24px)] md:text-[20px] xl:text-[22px] 2xl:text-[24px] font-bold font-display tabular-nums leading-none whitespace-nowrap overflow-hidden text-ellipsis ${c.value}`}>
              {value}
            </span>
          )}
          <span className="block mt-1.5 text-[12px] text-gray">{t('sales.today.monthChip')}</span>
        </span>
        {onClick && (
          <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-transform group-hover:translate-x-0.5 ${c.arrow}`} aria-hidden="true">
            <ArrowRight size={16} strokeWidth={2.25} />
          </span>
        )}
      </span>
    </>
  );
  const cls = `group relative min-w-0 text-left rounded-2xl ring-1 ring-inset p-3.5 lg:p-4 min-h-[124px] flex flex-col shadow-card ${c.card} ${className}`;
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} active:scale-[0.99] transition-transform`}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
