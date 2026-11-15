import { ArrowRight, BarChart3 } from 'lucide-react';
import { money } from '@/sales/lib/format';
import { useBizT } from '../lib/i18n';

/*
 * The dashboard's money (2026-10-29): the rep panel's month cards
 * (sales/components/MonthCards) for a buyer — what they have bought this
 * month in the brand's blue, and two tinted cards beside it. On the orders
 * page since 2026-10-31. A card with nowhere to go is not a button and has
 * no arrow.
 */

/** This month's purchases — the one card in the brand's own colour. */
export function MonthSpendCard({ spent, orders, loading, onClick, className = '' }: {
  spent: string | number; orders: number; loading: boolean; onClick?: () => void; className?: string;
}) {
  const t = useBizT();
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`group relative overflow-hidden text-left rounded-2xl p-4 lg:p-5 min-h-[124px] flex flex-col text-white bg-gradient-to-br from-[#2F6EF0] via-brand to-brand-deepest shadow-[0_14px_30px_-14px_rgba(5,78,232,0.6)] ${onClick ? 'active:scale-[0.995] transition-transform' : ''} ${className}`}
    >
      <span className="pointer-events-none absolute -right-12 -top-14 w-40 h-40 rounded-full bg-white/[0.08]" aria-hidden="true" />
      <span className="pointer-events-none absolute right-10 -bottom-20 w-36 h-36 rounded-full bg-white/[0.06]" aria-hidden="true" />
      <span className="relative flex items-center gap-2">
        <span className="w-8 h-8 rounded-lg bg-white/15 ring-1 ring-inset ring-white/20 flex items-center justify-center shrink-0">
          <BarChart3 size={16} strokeWidth={1.75} />
        </span>
        <span className="flex-1 min-w-0 text-[14px] font-semibold font-display truncate">{t('biz.stats.bought')}</span>
        <span className="h-6 px-2.5 rounded-full bg-white/15 text-[11.5px] font-semibold font-display inline-flex items-center whitespace-nowrap">{t('biz.stats.monthChip')}</span>
      </span>
      <span className="relative mt-auto pt-3 flex items-end justify-between gap-3">
        <span className="min-w-0">
          {loading ? (
            <span className="skeleton block h-8 w-32 opacity-50" />
          ) : (
            <span className="block text-[30px] md:text-[26px] 2xl:text-[30px] font-bold font-display tabular-nums leading-none whitespace-nowrap">
              {money(spent)}
            </span>
          )}
          <span className="block mt-1.5 text-[12.5px] text-white/75 truncate">
            {t(orders === 1 ? 'biz.stats.monthOrders_one' : 'biz.stats.monthOrders_other', { count: orders })}
          </span>
        </span>
        {onClick && (
          <span className="w-8 h-8 rounded-full bg-white text-brand flex items-center justify-center shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true">
            <ArrowRight size={16} strokeWidth={2.25} />
          </span>
        )}
      </span>
    </Tag>
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

/** One of the two tinted cards: its icon and what it is, the figure, a line under it. */
export function TintCard({ tone, icon: Icon, label, value, sub, loading, onClick, className = '' }: {
  tone: keyof typeof TONES;
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  loading: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const c = TONES[tone];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`group relative min-w-0 text-left rounded-2xl ring-1 ring-inset p-3.5 lg:p-4 min-h-[124px] flex flex-col shadow-card ${onClick ? 'active:scale-[0.99] transition-transform' : ''} ${c.card} ${className}`}
    >
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
          <span className="block mt-1.5 text-[12px] text-gray truncate">{sub}</span>
        </span>
        {onClick && (
          <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-transform group-hover:translate-x-0.5 ${c.arrow}`} aria-hidden="true">
            <ArrowRight size={16} strokeWidth={2.25} />
          </span>
        )}
      </span>
    </Tag>
  );
}
