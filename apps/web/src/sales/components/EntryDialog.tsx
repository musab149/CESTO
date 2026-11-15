import { useNavigate } from 'react-router-dom';
import { ChevronRight, History } from 'lucide-react';
import { useSalesEarningEntry, type RepLedgerLineState } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useSalesT } from '../lib/i18n';
import { money } from '../lib/format';
import { EarningStatusPill } from '../lib/earnings';
import { useLedgerLabel } from '../lib/ledger';
import { LEDGER_TONE } from '../lib/ledgerTone';
import { dayLabel, momentDay } from '../lib/periods';
import EarningBreakdown from './EarningBreakdown';
import LedgerStateChip from './LedgerStateChip';
import { Dialog } from './Dialog';
import { Skeleton } from './Skeleton';

/**
 * A line of the history, opened (2026-10-28, user: "in history when we click
 * upon any row then we need to show the breakdown of the profits"): what it
 * moved, the balance after it and whether it is paid to them yet, then where
 * it came from — the order's whole breakdown (both profits, the expenses, the
 * %, the earning; never a buying price) or the period statement's — and the
 * admin's note. The earnings page and the whole history open the same one.
 */
export default function EntryDialog({ id, state, onClose }: { id: string; state?: RepLedgerLineState; onClose: () => void }) {
  const t = useSalesT();
  const lang = useLanguageStore((s) => s.lang);
  const navigate = useNavigate();
  const label = useLedgerLabel();
  const { data, isLoading, isError } = useSalesEarningEntry(id);
  const e = data?.entry;
  const order = data?.order;
  const statement = data?.statement;
  const n = Number(e?.amount ?? 0);
  const signed = `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
  // What a line that has no breakdown of its own is.
  const plain: Partial<Record<string, string>> = {
    payout: t('sales.earnings.entry.payout'),
    payout_void: t('sales.earnings.entry.payoutVoid'),
    adjustment: n < 0 ? t('sales.earnings.entry.deduction') : t('sales.earnings.entry.bonus'),
  };
  // What the order's figures mean for this line.
  const lead: Partial<Record<string, string>> = {
    order_adjustment: t('sales.earnings.entry.adjustmentLead'),
    order_reversal: t('sales.earnings.entry.reversalLead'),
    order_not_earned: t('sales.earnings.entry.notEarnedLead'),
  };
  // Whether what this line earned has reached them.
  const standing = state && ({
    settled: t('sales.earnings.entry.settled'),
    outstanding: state.partial && state.left ? t('sales.earnings.entry.partial', { amount: money(state.left) }) : t('sales.earnings.entry.outstanding'),
    taken_back: t('sales.earnings.entry.takenBack'),
  } as Partial<Record<string, string>>)[state.tone];

  return (
    <Dialog
      onClose={onClose}
      title={e ? label(e) : t('sales.earnings.historyTitle')}
      subtitle={e ? dayLabel(e.occurred_on, lang) : undefined}
      icon={History}
      footer={order?.id ? (
        <button
          type="button"
          onClick={() => navigate(`/sales/orders/${order.id}`)}
          className="w-full min-h-[48px] rounded-xl bg-brand hover:bg-brand-mid text-white text-[15px] font-semibold font-display inline-flex items-center justify-center gap-1.5 transition-colors"
        >
          {t('sales.earnings.entry.openOrder')}
          <ChevronRight size={17} strokeWidth={2} />
        </button>
      ) : undefined}
    >
      {isError ? (
        <p className="text-[13.5px] text-gray leading-snug">{t('sales.earnings.entry.failed')}</p>
      ) : isLoading || !e ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-3/4" />
        </div>
      ) : (
        <>
          {/* What this line moved, the balance it left, and where it stands. */}
          <div className="rounded-xl bg-surface-cream">
            <div className="flex items-end justify-between gap-4 px-4 py-3.5">
              <div>
                <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-gray">
                  {t('sales.earnings.entry.thisLine')}
                  <LedgerStateChip entry={e} state={state} />
                </p>
                <p className={`mt-1.5 text-[26px] font-bold font-display tabular-nums leading-none ${state ? LEDGER_TONE[state.tone].amount : 'text-ink'} ${e.voided ? 'line-through' : ''}`}>
                  {signed}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[12.5px] text-gray whitespace-nowrap">{t('sales.earnings.entry.balanceAfter')}</p>
                <p className="mt-1 text-[16px] font-semibold font-display tabular-nums text-ink">{money(e.balance)}</p>
              </div>
            </div>
            {standing && <p className="px-4 py-2.5 border-t border-border text-[13px] text-charcoal leading-snug">{standing}</p>}
          </div>

          {order && (
            <section className="mt-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14.5px] font-semibold font-display text-ink truncate">{order.client_name || order.order_number}</p>
                  <p className="text-[12.5px] text-muted mt-0.5">
                    <span className="font-mono">{order.order_number}</span>
                    {order.delivered_at && <>{'  ·  '}{t('sales.earnings.deliveredOn', { date: momentDay(order.delivered_at, lang) })}</>}
                  </p>
                </div>
                <EarningStatusPill status={order.earning.status} />
              </div>
              {lead[e.kind] && <p className="mt-2 text-[12.5px] text-gray leading-snug">{lead[e.kind]}</p>}
              <div className="mt-3">
                <EarningBreakdown
                  sales={order.earning.sales}
                  gross={order.earning.gross_profit}
                  expenses={order.earning.expenses}
                  net={order.earning.net_profit}
                  percentage={order.earning.percentage}
                  earning={order.earning.earning}
                  struck={order.earning.status === 'not_earned' || order.earning.status === 'reversed'}
                  basis={order.earning.profit_basis}
                />
              </div>
              {order.deleted && <p className="mt-3 text-[12.5px] text-muted">{t('sales.earnings.entry.orderDeleted')}</p>}
            </section>
          )}

          {statement && (
            <section className="mt-5">
              <p className="text-[14.5px] font-semibold font-display text-ink">
                {t('sales.earnings.entry.statement', { from: dayLabel(statement.period_from, lang), to: dayLabel(statement.period_to, lang) })}
              </p>
              <div className="mt-3">
                <EarningBreakdown
                  gross={statement.gross_profit}
                  grossHint={t('sales.earnings.entry.statementGrossHint')}
                  expenses={statement.expenses}
                  expensesHint={t('sales.earnings.entry.statementExpenses')}
                  net={statement.net_profit}
                  percentage={statement.percentage}
                  earning={statement.earning}
                />
              </div>
            </section>
          )}

          {!order && !statement && plain[e.kind] && <p className="mt-4 text-[13.5px] text-gray leading-snug">{plain[e.kind]}</p>}

          {e.note && (
            <p className="mt-4 rounded-xl border border-border px-3.5 py-2.5 text-[13px] text-charcoal leading-snug">
              <span className="block text-[11.5px] text-muted mb-0.5">{t('sales.earnings.note')}</span>
              {e.note}
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
