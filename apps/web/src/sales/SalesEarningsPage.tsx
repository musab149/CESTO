import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3, CalendarRange, ChevronDown, ChevronRight, History, ListOrdered, PackageCheck, TrendingUp, Truck, Wallet,
} from 'lucide-react';
import { useSalesEarnings, useSalesMe, type RepEarningsTotals, type RepPendingOrder } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useSalesT } from './lib/i18n';
import { money } from './lib/format';
import { EarningStatusPill } from './lib/earnings';
import { momentDay } from './lib/periods';
import BackLink from './components/BackLink';
import EmptyState from './components/EmptyState';
import HistoryList from './components/HistoryList';
import { Skeleton } from './components/Skeleton';
import { Card, CardHeader, ListSkeleton, PageHeader } from './components/ui';

/** Orders still to earn shown before "show all". */
const PENDING_PREVIEW = 5;
/** History lines on this page; the rest on /sales/earnings/history. */
const HISTORY_PREVIEW = 5;

/**
 * A rep's earnings (2026-10-28, API lib/repEarnings).
 *
 * Redesigned the same day (user: "it is just bunch of cards and it is
 * cluttering the screen... the design should be guiding their eye"). Eight
 * tiles of equal weight became an order of reading:
 *
 *   1. What is owed to them — the one bold thing on the page, the blue card.
 *   2. Where the rest of their money is: the path every euro takes — in
 *      progress → waiting for approval → owed → paid — drawn as that path
 *      inside the same card, "owed" lit as the step they are on.
 *   3. This month: sales, expenses, net profit, one quiet card.
 *   4. The orders still to earn, and the history behind the balance.
 *
 *   desk  ┌──── owed + the path ─────────┐┌─ this month ─┐
 *         ┌──── history ─────────────────┐┌─ to earn ────┐
 *   phone owed + the path (a timeline) / this month / to earn / history
 *
 * Read-only — approving, paying and adjusting are an admin's.
 */
export default function SalesEarningsPage() {
  const t = useSalesT();
  const navigate = useNavigate();
  const { data, isLoading } = useSalesEarnings();
  // This month's sales, as the dashboard counts them.
  const { data: me, isLoading: meLoading } = useSalesMe();
  const history = data?.history ?? [];

  return (
    <div>
      <BackLink label={t('sales.nav.today')} title={t('sales.earnings.title')} onClick={() => navigate('/sales')} />
      {/* A phone's bar already carries the title. */}
      <PageHeader className="hidden lg:flex" title={t('sales.earnings.title')} subtitle={t('sales.earnings.subtitleOrders')} />
      <p className="lg:hidden text-sm text-gray mb-4">{t('sales.earnings.subtitleOrders')}</p>

      <div className="grid xl:grid-cols-12 gap-3 md:gap-3.5 2xl:gap-4 items-start">
        <OwedHero className="xl:col-span-8 xl:self-stretch" totals={data?.totals} loading={isLoading} />
        <MonthSummary
          className="xl:col-span-4 xl:self-stretch"
          sales={me?.stats.this_month?.revenue ?? 0}
          orders={me?.stats.this_month?.orders ?? 0}
          expenses={data?.month?.expenses ?? 0}
          netProfit={data?.month?.net_profit ?? 0}
          loading={isLoading || meLoading}
        />
        <PendingOrders className="xl:col-span-4 xl:col-start-9 xl:row-start-2" orders={data?.pending ?? []} loading={isLoading} />

        {/* ── The history behind the balance ── */}
        <Card className="overflow-hidden xl:col-span-8 xl:col-start-1 xl:row-start-2">
          <CardHeader title={t('sales.earnings.historyTitle')} icon={History} subtitle={t('sales.earnings.historyHint')} />
          {isLoading ? (
            <ListSkeleton rows={4} />
          ) : history.length === 0 ? (
            <EmptyState
              icon={<Wallet size={28} strokeWidth={1.75} className="text-muted" />}
              title={t('sales.earnings.emptyTitle')}
              description={t('sales.earnings.emptyBodyOrders')}
              action={{ label: t('sales.earnings.emptyCta'), onClick: () => navigate('/sales/orders') }}
            />
          ) : (
            <>
              {/* The latest few (user, 2026-10-28: "this card should have a
                  certain height and only show the recent ones at top"), then
                  the way to all of them. */}
              <HistoryList entries={history} limit={HISTORY_PREVIEW} />
              <button
                type="button"
                onClick={() => navigate('/sales/earnings/history')}
                className="w-full h-11 border-t border-border flex items-center justify-center gap-1.5 text-[13.5px] font-semibold font-display text-brand hover:bg-brand-whisper transition-colors"
              >
                {t('sales.earnings.historyAll')}
                <span className="text-muted font-normal tabular-nums">{history.length}</span>
                <ChevronRight size={16} strokeWidth={2} />
              </button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * What is owed to them, large, and under it the path their money takes.
 *
 * Refined 2026-10-28 (user: "refine this one properly especially the one
 * within"). The path was four boxes with chevrons squeezed between them and
 * the current one lifted out as a white chip; it is now a track — one hairline
 * with a node for each step and the step's words under its node. The step
 * they are on is the lit node (white, ringed) with full-white words; the
 * others step back. The line itself says which way the money moves. Above it,
 * the figure, then "this month" and "in all" side by side as quiet pairs,
 * everything on one left edge.
 */
function OwedHero({ totals, loading, className = '' }: { totals: RepEarningsTotals | undefined; loading: boolean; className?: string }) {
  const t = useSalesT();
  const owed = Number(totals?.owed ?? 0);
  const count = (key: string, n: number) => t(`${key}_${n === 1 ? 'one' : 'other'}`, { count: n });
  const stages = [
    { key: 'expected', label: t('sales.earnings.stage.expected'), amount: Number(totals?.expected ?? 0), sub: count('sales.earnings.onTheWayCount', totals?.expected_count ?? 0) },
    { key: 'awaiting', label: t('sales.earnings.stage.awaiting'), amount: Number(totals?.awaiting_approval ?? 0), sub: count('sales.earnings.deliveredCount', totals?.awaiting_count ?? 0) },
    { key: 'owed', label: t('sales.earnings.stage.owed'), amount: owed, sub: t('sales.earnings.stage.owedNote'), current: true },
    { key: 'paid', label: t('sales.earnings.stage.paid'), amount: Number(totals?.paid ?? 0), sub: t('sales.earnings.stage.paidNote') },
  ];
  const signed = (n: number) => (n < 0 ? `−${money(Math.abs(n))}` : money(n));
  const figure = (n: number | string) => (loading ? '—' : money(n));

  return (
    <section
      aria-label={owed < 0 ? t('sales.earnings.paidAhead') : t('sales.earnings.due')}
      className={`relative overflow-hidden rounded-2xl text-white bg-gradient-to-br from-[#2F6EF0] via-brand to-brand-deepest shadow-[0_14px_30px_-14px_rgba(5,78,232,0.6)] ${className}`}
    >
      <span className="pointer-events-none absolute -right-20 -top-28 w-80 h-80 rounded-full bg-white/[0.06]" aria-hidden="true" />

      <div className="relative p-5 sm:p-7 h-full flex flex-col">
        {/* ── The figure, and on its right what has been earned (user,
            2026-10-28: "take the two items to the right side"); under the
            figure on a phone too narrow for both. ── */}
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[14px] font-semibold font-display text-white/80">
              <Wallet size={17} strokeWidth={1.75} />
              {owed < 0 ? t('sales.earnings.paidAhead') : t('sales.earnings.due')}
            </p>
            {loading ? (
              <Skeleton className="mt-3 h-12 w-48 opacity-40" />
            ) : (
              <p className="mt-2 text-[46px] sm:text-[56px] font-bold font-display tabular-nums leading-none tracking-[-0.03em]">{money(Math.abs(owed))}</p>
            )}
          </div>
          <dl className="flex items-stretch gap-5 sm:pb-1">
            <div className="sm:text-right">
              <dt className="text-[12px] text-white/60">{t('sales.today.earnedThisMonth')}</dt>
              <dd className="mt-0.5 text-[16px] font-semibold font-display tabular-nums">{figure(totals?.this_month ?? 0)}</dd>
            </div>
            <span className="w-px bg-white/20" aria-hidden="true" />
            <div className="sm:text-right">
              <dt className="text-[12px] text-white/60">{t('sales.earnings.earned')}</dt>
              <dd className="mt-0.5 text-[16px] font-semibold font-display tabular-nums">{figure(totals?.earned ?? 0)}</dd>
            </div>
          </dl>
        </div>

        {/* ── The path: a track across from sm, down a phone. Pushed to the
            card's foot when there is room, never closer than its own gap;
            the space alone sets it apart, no rule. ── */}
        <div className="mt-auto">
        <ol
          aria-label={t('sales.earnings.flowLabel')}
          className="mt-7 sm:mt-9 sm:grid sm:grid-cols-4"
        >
          {stages.map((s, i) => {
            const last = i === stages.length - 1;
            return (
              <li
                key={s.key}
                aria-current={s.current ? 'step' : undefined}
                className="relative flex items-start gap-3.5 py-2 sm:py-0 sm:block sm:pr-4"
              >
                {/* The line to the next node: down a phone, across from sm. */}
                {!last && (
                  <>
                    <span className="sm:hidden absolute left-[6px] top-[22px] -bottom-[16px] w-px bg-white/25" aria-hidden="true" />
                    <span className="hidden sm:block absolute left-[22px] right-2 top-[6px] h-px bg-gradient-to-r from-white/30 to-white/15" aria-hidden="true" />
                  </>
                )}
                <span className="relative w-[13px] h-[13px] mt-[9px] sm:mt-0 flex items-center justify-center shrink-0" aria-hidden="true">
                  {s.current
                    ? <span className="w-[13px] h-[13px] rounded-full bg-white ring-[5px] ring-white/20" />
                    : <span className="w-[9px] h-[9px] rounded-full bg-white/45" />}
                </span>
                <span className="min-w-0 flex-1 sm:block sm:mt-3.5">
                  <span className={`block text-[13px] font-semibold font-display ${s.current ? 'text-white' : 'text-white/70'}`}>{s.label}</span>
                  <span className={`hidden sm:block mt-1.5 text-[20px] font-bold font-display tabular-nums leading-none ${s.current ? 'text-white' : 'text-white/85'}`}>
                    {loading ? '—' : signed(s.amount)}
                  </span>
                  <span className={`block mt-1 sm:mt-1.5 text-[12px] leading-snug ${s.current ? 'text-white/75' : 'text-white/50'}`}>{s.sub}</span>
                </span>
                <span className={`sm:hidden mt-[5px] text-[16px] font-bold font-display tabular-nums ${s.current ? 'text-white' : 'text-white/85'}`}>
                  {loading ? '—' : signed(s.amount)}
                </span>
              </li>
            );
          })}
        </ol>
        </div>
      </div>
    </section>
  );
}

/** "Octubre de 2026" — this month in Madrid, as a heading says it. */
function thisMonthLabel(lang: string): string {
  const s = new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * This month's sales, expenses and net profit.
 *
 * Refined 2026-10-28 (user: "refine the other card in the same row"), then
 * made three rows alike — sales with its orders under it, expenses, net
 * profit — each an icon tile, the words and the figure (user: "the sales
 * should also be like other two rows"). The heading names the month.
 */
function MonthSummary({ sales, orders, expenses, netProfit, loading, className = '' }: {
  sales: string | number; orders: number; expenses: string | number; netProfit: string | number; loading: boolean; className?: string;
}) {
  const t = useSalesT();
  const lang = useLanguageStore((s) => s.lang);
  // Three rows alike (user, 2026-10-28: "the sales should also be like other
  // two rows"): what was sold, what came off, what was left.
  const rows = [
    {
      key: 'sales', icon: BarChart3, tile: 'bg-brand-whisper text-brand', label: t('sales.today.sales'), value: money(sales), tone: 'text-ink',
      sub: t(orders === 1 ? 'sales.today.monthOrders_one' : 'sales.today.monthOrders_other', { count: orders }),
    },
    { key: 'expenses', icon: Truck, tile: 'bg-st-orange-bg text-st-orange-fg', label: t('sales.today.expenses'), value: money(expenses), tone: 'text-ink' },
    { key: 'net', icon: TrendingUp, tile: 'bg-st-emerald-bg text-st-emerald-fg', label: t('sales.today.netProfit'), value: money(netProfit), tone: Number(netProfit) < 0 ? 'text-danger' : 'text-st-emerald-fg' },
  ];
  return (
    <Card className={`overflow-hidden flex flex-col ${className}`}>
      <CardHeader title={t('sales.earnings.monthTitle')} icon={CalendarRange} subtitle={thisMonthLabel(lang)} />
      {/* Beside the owed card the rows share its height. */}
      <dl className="flex-1 flex flex-col divide-y divide-border">
        {rows.map((r) => {
          const Icon = r.icon;
          return (
            <div key={r.key} className="flex-1 flex items-center gap-3 px-4 sm:px-5 py-3.5">
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${r.tile}`}>
                <Icon size={16} strokeWidth={1.75} />
              </span>
              <dt className="min-w-0 flex-1 text-[13.5px] text-charcoal leading-snug">
                {r.label}
                {r.sub && <span className="block text-[12px] text-muted">{r.sub}</span>}
              </dt>
              <dd className={`text-[16px] font-bold font-display tabular-nums whitespace-nowrap ${r.tone}`}>
                {loading ? <Skeleton className="h-5 w-16" /> : r.value}
              </dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

/** The orders still on their way to an earning — the first few, then all on request. */
function PendingOrders({ orders, loading, className = '' }: { orders: RepPendingOrder[]; loading: boolean; className?: string }) {
  const t = useSalesT();
  const lang = useLanguageStore((s) => s.lang);
  const navigate = useNavigate();
  const [all, setAll] = useState(false);
  const shown = all ? orders : orders.slice(0, PENDING_PREVIEW);
  return (
    <Card className={`overflow-hidden ${className}`}>
      <CardHeader title={t('sales.earnings.pendingTitle')} icon={ListOrdered} subtitle={t('sales.earnings.pendingHint')} />
      {loading ? (
        <ListSkeleton rows={3} />
      ) : orders.length === 0 ? (
        <p className="px-5 py-4 text-[13.5px] text-gray">{t('sales.earnings.pendingNone')}</p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {shown.map((o) => {
              const waiting = o.status === 'awaiting_approval';
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/sales/orders/${o.id}`)}
                    className="w-full text-left px-4 sm:px-5 py-3 flex items-center gap-3 hover:bg-surface-cream active:bg-surface-cream transition-colors"
                  >
                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${waiting ? 'bg-st-amber-bg text-st-amber-fg' : 'bg-brand-whisper text-brand'}`}>
                      {waiting ? <PackageCheck size={17} strokeWidth={1.75} /> : <Truck size={17} strokeWidth={1.75} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold font-display text-ink truncate">{o.client_name || o.order_number}</span>
                      <span className="block text-[12px] text-muted truncate mt-0.5">
                        {o.delivered_at ? t('sales.earnings.deliveredOn', { date: momentDay(o.delivered_at, lang) }) : <span className="font-mono">{o.order_number}</span>}
                      </span>
                    </span>
                    <span className="shrink-0 flex flex-col items-end gap-1">
                      <span className="text-[15px] font-bold font-display text-ink tabular-nums">{money(o.earning)}</span>
                      <EarningStatusPill status={o.status} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {orders.length > PENDING_PREVIEW && (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              aria-expanded={all}
              className="w-full h-11 border-t border-border flex items-center justify-center gap-1 text-[13.5px] font-semibold font-display text-brand hover:bg-brand-whisper transition-colors"
            >
              {all ? t('sales.earnings.showFewer') : t('sales.earnings.showAll', { count: orders.length })}
              <ChevronDown size={16} strokeWidth={2} className={`transition-transform ${all ? 'rotate-180' : ''}`} />
            </button>
          )}
        </>
      )}
    </Card>
  );
}
