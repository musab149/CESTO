import { useNavigate } from 'react-router-dom';
import { History, Wallet } from 'lucide-react';
import { useSalesEarnings, type RepEarningsTotals } from '@grocery-app/shared';
import { useSalesT } from './lib/i18n';
import { money } from './lib/format';
import BackLink from './components/BackLink';
import EmptyState from './components/EmptyState';
import HistoryList from './components/HistoryList';
import { Skeleton } from './components/Skeleton';
import { Card, CardHeader, ListSkeleton, PageHeader } from './components/ui';

/**
 * A rep's whole earnings history (2026-10-28, user: "in the history card we
 * need see all button that will take the rep to the screen where he can see
 * his entire history... it should show a clear statement to the rep that this
 * is paid and this is outstanding").
 *
 * First the statement — of everything earned, what has been paid to them and
 * what is still owed, as one bar split in two — then every line, newest
 * first, each tinted and tagged by where it stands (shared/repLedger).
 *
 *   desk  ┌──── every line ──────────────┐┌─ the statement ─┐
 *   phone the statement / every line
 */
export default function SalesEarningsHistoryPage() {
  const t = useSalesT();
  const navigate = useNavigate();
  const { data, isLoading } = useSalesEarnings();
  const history = data?.history ?? [];
  const count = (n: number) => t(`sales.earnings.historyCount_${n === 1 ? 'one' : 'other'}`, { count: n });

  return (
    <div>
      <BackLink label={t('sales.nav.earnings')} title={t('sales.earnings.historyTitle')} onClick={() => navigate('/sales/earnings')} />
      <PageHeader className="hidden lg:flex" title={t('sales.earnings.historyTitle')} subtitle={t('sales.earnings.historyPageHint')} />
      <p className="lg:hidden text-sm text-gray mb-4">{t('sales.earnings.historyPageHint')}</p>

      <div className="grid xl:grid-cols-12 gap-3 md:gap-3.5 2xl:gap-4 items-start">
        <PaidStatement className="xl:col-span-4 xl:col-start-9 xl:row-start-1" totals={data?.totals} loading={isLoading} />
        <Card className="overflow-hidden xl:col-span-8 xl:col-start-1 xl:row-start-1">
          <CardHeader title={t('sales.earnings.historyAllTitle')} icon={History} subtitle={isLoading ? undefined : count(history.length)} />
          {isLoading ? (
            <ListSkeleton rows={6} />
          ) : history.length === 0 ? (
            <EmptyState
              icon={<Wallet size={28} strokeWidth={1.75} className="text-muted" />}
              title={t('sales.earnings.emptyTitle')}
              description={t('sales.earnings.emptyBodyOrders')}
              action={{ label: t('sales.earnings.emptyCta'), onClick: () => navigate('/sales/orders') }}
            />
          ) : (
            <HistoryList entries={history} />
          )}
        </Card>
      </div>
    </div>
  );
}

/**
 * Of everything they have earned, what is paid and what is still owed: the
 * two figures, one bar split between them in the same green and amber as the
 * lines below, and the sentence that says it plainly.
 */
function PaidStatement({ totals, loading, className = '' }: { totals: RepEarningsTotals | undefined; loading: boolean; className?: string }) {
  const t = useSalesT();
  const earned = Number(totals?.earned ?? 0);
  const paid = Number(totals?.paid ?? 0);
  const owed = Number(totals?.owed ?? 0);
  const ahead = owed < 0;
  // How much of the bar is paid: all of it once nothing is owed.
  const share = owed <= 0 ? (paid > 0 || earned > 0 ? 100 : 0) : earned > 0 ? Math.max(0, Math.min(100, (paid / earned) * 100)) : 0;
  const sentence = ahead
    ? t('sales.earnings.statement.ahead', { amount: money(Math.abs(owed)) })
    : owed === 0
      ? t('sales.earnings.statement.allPaid', { paid: money(paid) })
      : t('sales.earnings.statement.sentence', { paid: money(paid), earned: money(earned), owed: money(owed) });
  const figure = (label: string, value: string, dot: string, tone: string) => (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-[12.5px] text-gray">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} aria-hidden="true" />
        {label}
      </dt>
      <dd className={`mt-1 text-[22px] font-bold font-display tabular-nums leading-none whitespace-nowrap ${tone}`}>{loading ? <Skeleton className="h-6 w-24" /> : value}</dd>
    </div>
  );

  return (
    <Card className={`overflow-hidden ${className}`}>
      <CardHeader title={t('sales.earnings.statement.title')} icon={Wallet} subtitle={t('sales.earnings.statement.subtitle')} />
      <div className="px-4 sm:px-5 pt-4 pb-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13px] text-gray">{t('sales.earnings.statement.earned')}</p>
          <div className="text-[15px] font-semibold font-display text-ink tabular-nums">{loading ? <Skeleton className="h-5 w-16" /> : money(earned)}</div>
        </div>
        {/* Paid, then what is still owed — the line's own colours. */}
        <div
          className="mt-2.5 h-2.5 rounded-full bg-st-amber-bg overflow-hidden"
          role="img"
          aria-label={loading ? undefined : sentence}
        >
          {!loading && <div className="h-full rounded-full bg-st-emerald-dot transition-[width] duration-700 motion-reduce:transition-none" style={{ width: `${share}%` }} />}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4">
          {figure(t('sales.earnings.statement.paid'), money(paid), 'bg-st-emerald-dot', 'text-st-emerald-fg')}
          {ahead
            ? figure(t('sales.earnings.paidAhead'), money(Math.abs(owed)), 'bg-brand', 'text-brand')
            : figure(t('sales.earnings.statement.owed'), money(owed), 'bg-st-amber-dot', owed > 0 ? 'text-st-amber-fg' : 'text-muted')}
        </dl>
        {!loading && (
          <>
            <p className="mt-4 rounded-xl bg-surface-cream px-3.5 py-2.5 text-[13.5px] text-charcoal leading-snug">{sentence}</p>
            <p className="mt-2 text-[12px] text-muted leading-snug">{t('sales.earnings.statement.oldestFirst')}</p>
          </>
        )}
      </div>
    </Card>
  );
}
