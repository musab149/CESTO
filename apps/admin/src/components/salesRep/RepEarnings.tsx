import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowDownLeft, CheckCircle2, Clock, Loader2, Minus, Plus, Undo2, Wallet, X } from 'lucide-react';
import {
  useAdminRepEarningEntry, useAdminRepEarnings, useAddRepAdjustment, useApproveRepOrderEarning, useRecordRepPayout, useUpdateSalesRep,
  useVoidRepPayout, type AdminRepPendingOrder, type RepLedgerEntry, type RepProfitBasis,
} from '@grocery-app/shared';
import { useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import { formatCurrency } from '@/lib/format';
import { useLedgerLabel, useMomentDay, useDay } from './repEarningFormat';
import EarningStatusChip from './EarningStatusChip';

/*
 * A sales rep's earnings on their profile (2026-10-28, user: "the earnings of
 * the reps will be calculated from the orders... Within earnings we need to
 * have the history maintained about owed amount and paid amount").
 *
 * Each order's earning is worked out from the order and approved ON the order
 * once it is delivered (components/salesRep/RepOrderEarning). Here: what is
 * owed, what is waiting for approval, the payments and adjustments that move
 * the balance, and the history behind it. Writing is a super admin's.
 */

const euros = (v: string | number) => formatCurrency(Number(v));
/** Typed money or percentage: a comma or a point for decimals. */
const num = (s: string) => Number(s.trim().replace(',', '.'));
const isNum = (s: string) => s.trim() !== '' && Number.isFinite(num(s));

function madridToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/**
 * The profile's earnings at a glance, for the side column: what is owed to
 * them first — the figure an admin opens this for — then paid and earned, what
 * is waiting, and the ways to pay and adjust. Their usual % at the foot.
 */
export function RepEarningsSummary({ userId, name, canEdit }: { userId: string; name: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, isLoading } = useAdminRepEarnings(userId);
  const update = useUpdateSalesRep();
  // What is typed, or — until something is — what is saved.
  const [pctDraft, setPct] = useState<string | null>(null);
  const pct = pctDraft ?? (data?.commission_pct ? String(Number(data.commission_pct)) : '');
  const [dialog, setDialog] = useState<'payout' | 'adjustment' | null>(null);

  const pctValid = pct.trim() === '' || (isNum(pct) && num(pct) >= 0 && num(pct) <= 100);
  const pctChanged = (pct.trim() === '' ? null : num(pct)) !== (data?.commission_pct == null ? null : Number(data.commission_pct));
  const savePct = () => update.mutate({ userId, commission_pct: pct.trim() === '' ? null : num(pct) }, {
    onSuccess: () => { setPct(null); toast.success(t('salesReps.earnings.usualPctSaved', 'Usual percentage saved')); },
    onError: (e) => toast.error(t('salesReps.earnings.failed', 'Could not save'), e instanceof Error ? e.message : String(e)),
  });
  const totals = data?.totals;
  const owed = Number(totals?.owed ?? 0);
  const toApprove = (data?.to_approve.length ?? 0) + (data?.changed.length ?? 0);
  const small = 'text-[11px] font-semibold uppercase tracking-wide text-muted font-display';

  return (
    <section className="bg-card rounded-xl border border-border/60 shadow-card overflow-hidden">
      <div className="px-4 pt-4 pb-4">
        <h2 className="flex items-center gap-2 text-sm font-bold font-display text-ink">
          <Wallet size={16} strokeWidth={1.75} className="text-brand" />
          {t('salesReps.earnings.title', 'Earnings')}
        </h2>
        {isLoading ? (
          <div className="mt-4 space-y-2" aria-busy="true">
            <div className="h-3 w-24 rounded bg-surface-cream animate-pulse" />
            <div className="h-8 w-36 rounded bg-surface-cream animate-pulse" />
          </div>
        ) : (
          <>
            <p className={`mt-4 ${small}`}>
              {owed < 0 ? t('salesReps.earnings.paidAhead', 'Paid ahead') : t('salesReps.earnings.owedToThem', 'Owed to them')}
            </p>
            <p className={`text-3xl font-bold font-display tabular-nums ${owed > 0 ? 'text-warning' : 'text-ink'}`}>{euros(Math.abs(owed))}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <p className={small}>{t('salesReps.earnings.paid', 'Paid')}</p>
                <p className="text-base font-bold font-display tabular-nums text-success">{euros(totals?.paid ?? 0)}</p>
              </div>
              <div>
                <p className={small}>{t('salesReps.earnings.earned', 'Earned in all')}</p>
                <p className="text-base font-bold font-display tabular-nums text-ink">{euros(totals?.earned ?? 0)}</p>
              </div>
            </div>
          </>
        )}
      </div>

      {!isLoading && (
        <dl className="px-4 py-3 border-t border-border/60 space-y-2 text-[13px]">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-gray">
              {t('salesReps.earnings.toApproveCount', { count: toApprove, defaultValue: '{{count}} to approve' })}
            </dt>
            <dd className={`font-semibold tabular-nums ${toApprove > 0 ? 'text-warning' : 'text-muted'}`}>{euros(totals?.awaiting_approval ?? 0)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-gray">
              {t('salesReps.earnings.expectedCount', { count: totals?.expected_count ?? 0, defaultValue: '{{count}} on their way' })}
            </dt>
            <dd className="font-semibold tabular-nums text-muted">{euros(totals?.expected ?? 0)}</dd>
          </div>
        </dl>
      )}

      {canEdit && !isLoading && (
        <div className="px-4 py-3 border-t border-border/60 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDialog('payout')}
            className="h-10 rounded-lg text-[13px] font-semibold font-display bg-brand text-white hover:bg-brand-mid inline-flex items-center justify-center gap-1.5"
          >
            <ArrowDownLeft size={15} strokeWidth={2} />
            {t('salesReps.earnings.recordPayment', 'Record payment')}
          </button>
          <button
            type="button"
            onClick={() => setDialog('adjustment')}
            className="h-10 rounded-lg text-[13px] font-semibold font-display border-2 border-border text-ink hover:border-brand inline-flex items-center justify-center gap-1.5"
          >
            <Plus size={15} strokeWidth={2} />
            {t('salesReps.earnings.adjust', 'Bonus or deduction')}
          </button>
        </div>
      )}

      <div className="px-4 py-3 border-t border-border/60 bg-surface-cream/50">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-semibold font-display text-ink">{t('salesReps.earnings.usualPct', 'Usual percentage')}</span>
          {canEdit ? (
            <span className="flex items-center gap-2">
              <span className="relative">
                <input
                  value={pct}
                  onChange={(e) => setPct(e.target.value)}
                  inputMode="decimal"
                  placeholder="—"
                  aria-label={t('salesReps.earnings.usualPct', 'Usual percentage')}
                  aria-invalid={!pctValid}
                  className={`w-20 h-9 pl-3 pr-7 rounded-lg border bg-card text-sm text-right tabular-nums text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 ${pctValid ? 'border-border' : 'border-danger'}`}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
              </span>
              {pctChanged && (
                <button
                  type="button"
                  onClick={savePct}
                  disabled={!pctValid || update.isPending}
                  className="h-9 px-3 rounded-lg text-xs font-semibold font-display bg-brand text-white hover:bg-brand-mid disabled:opacity-50"
                >
                  {t('salesReps.earnings.save', 'Save')}
                </button>
              )}
            </span>
          ) : (
            <span className="text-sm font-bold font-display text-ink tabular-nums">{data?.commission_pct ? `${Number(data.commission_pct)} %` : '—'}</span>
          )}
        </div>
        <p className="text-[11.5px] text-muted mt-1">
          {t('salesReps.earnings.usualPctHintOrders', 'Their orders follow it until each is approved, which keeps that order\'s %.')}
        </p>
      </div>

      {dialog === 'payout' && <PayoutDialog userId={userId} name={name} owed={owed} onClose={() => setDialog(null)} />}
      {dialog === 'adjustment' && <AdjustmentDialog userId={userId} name={name} onClose={() => setDialog(null)} />}
    </section>
  );
}

/** The profile's main earnings card: the orders to approve, then the history. */
export function RepEarningsActivity({ userId, canEdit }: { userId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const { data, isLoading } = useAdminRepEarnings(userId);
  const toApprove = [...(data?.changed ?? []), ...(data?.to_approve ?? [])];
  const history = data?.history ?? [];

  return (
    <section className="bg-card rounded-xl border border-border/60 shadow-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/60">
        <h2 className="text-sm font-bold font-display text-ink">{t('salesReps.earnings.activityTitle', 'Earnings by order')}</h2>
        <p className="text-[12px] text-muted mt-0.5">
          {t('salesReps.earnings.activityHint', 'Each order earns their % of products − buying prices − its expenses, never below 0. It is owed once delivered and approved.')}
        </p>
      </div>

      {isLoading ? (
        <div className="p-4 space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-10 rounded-lg bg-surface-cream animate-pulse" />)}
        </div>
      ) : (
        <>
          <div className="px-4 pt-3 pb-1 flex items-center gap-2">
            <Clock size={14} strokeWidth={1.75} className="text-warning" />
            <h3 className="text-[13px] font-semibold font-display text-ink">{t('salesReps.earnings.toApprove', 'To approve')}</h3>
            {toApprove.length > 0 && <span className="text-[12px] text-muted">{toApprove.length}</span>}
          </div>
          {toApprove.length === 0 ? (
            <p className="px-4 pb-4 text-[13px] text-muted">{t('salesReps.earnings.nothingToApprove', 'Nothing waiting. Delivered orders appear here to approve.')}</p>
          ) : (
            <ul className="divide-y divide-border/70 border-b border-border/60">
              {toApprove.map((o) => <ApproveRow key={o.id} o={o} canEdit={canEdit} changed={(data?.changed ?? []).some((c) => c.id === o.id)} />)}
            </ul>
          )}

          <div className="px-4 pt-4 pb-1">
            <h3 className="text-[13px] font-semibold font-display text-ink">{t('salesReps.earnings.history', 'History')}</h3>
          </div>
          {history.length === 0 ? (
            <div className="px-4 pb-5 flex flex-wrap items-center gap-4">
              <span className="w-11 h-11 rounded-xl bg-surface-cream text-muted flex items-center justify-center shrink-0">
                <Wallet size={20} strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold font-display text-ink">{t('salesReps.earnings.emptyHistoryTitle', 'Nothing yet')}</p>
                <p className="text-[12.5px] text-muted">{t('salesReps.earnings.emptyHistoryBody', 'Approved orders, payments and adjustments are listed here with the balance after each.')}</p>
              </div>
            </div>
          ) : (
            <History userId={userId} entries={history} canEdit={canEdit} />
          )}
        </>
      )}
    </section>
  );
}

function ApproveRow({ o, canEdit, changed }: { o: AdminRepPendingOrder; canEdit: boolean; changed: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const day = useMomentDay();
  const approve = useApproveRepOrderEarning();
  const go = () => approve.mutate({ id: o.id }, {
    onSuccess: () => toast.success(t('orderDetail.repEarning.approved', 'Earning approved')),
    onError: (e) => toast.error(t('orderDetail.repEarning.approveFailed', 'Could not approve'), e instanceof Error ? e.message : String(e)),
  });
  return (
    <li className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1 basis-[220px]">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <Link to={`/orders/${o.id}`} className="inline-block py-2.5 -my-2.5 text-sm font-mono font-semibold text-brand hover:underline">{o.order_number}</Link>
          <span className="text-[13px] text-ink truncate">{o.client_name}</span>
        </p>
        <p className="text-[12px] text-muted mt-0.5">
          {o.delivered_at && t('salesReps.earnings.deliveredOn', { day: day(o.delivered_at), defaultValue: 'Delivered {{day}}' })}
          {' · '}{euros(o.sales)}
        </p>
        {changed && (
          <p className="text-[12px] text-warning mt-0.5">
            {t('salesReps.earnings.changedSince', { from: euros(o.approved_earning ?? 0), to: euros(o.earning), defaultValue: 'Changed since approval: {{from}} → {{to}}' })}
          </p>
        )}
        {o.lines_without_cost > 0 && (
          <p className="flex items-center gap-1 text-[12px] text-warning mt-0.5">
            <AlertTriangle size={12} strokeWidth={2} />
            {t('orderDetail.repEarning.linesWithoutCost', { count: o.lines_without_cost, defaultValue: '{{count}} lines without a buying price' })}
          </p>
        )}
      </div>
      <span className="text-base font-bold font-display tabular-nums text-ink">{euros(o.earning)}</span>
      <span className="flex items-center gap-2">
        <Link to={`/orders/${o.id}`} className="h-9 px-3 rounded-lg text-xs font-semibold font-display border-2 border-border text-ink hover:border-brand inline-flex items-center">
          {t('salesReps.earnings.review', 'Review')}
        </Link>
        {canEdit && (
          <button
            type="button"
            onClick={go}
            disabled={approve.isPending}
            className="h-9 px-3 rounded-lg text-xs font-semibold font-display bg-brand text-white hover:bg-brand-mid disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {approve.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} strokeWidth={2} />}
            {changed ? t('orderDetail.repEarning.approveAgain', 'Approve again') : t('orderDetail.repEarning.approve', 'Approve')}
          </button>
        )}
      </span>
    </li>
  );
}

/** The ledger, newest first, with the balance after each line. A payment can be voided. */
function History({ userId, entries, canEdit }: { userId: string; entries: RepLedgerEntry[]; canEdit: boolean }) {
  const { t } = useTranslation();
  const day = useDay();
  const label = useLedgerLabel();
  const [voiding, setVoiding] = useState<RepLedgerEntry | null>(null);
  // The line opened, if one is: its breakdown (EntryDialog).
  const [opened, setOpened] = useState<string | null>(null);
  /** A whole row opens its line; the link and the void button inside it do their own thing. */
  const opens = (e: RepLedgerEntry) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': t('salesReps.earnings.openEntry', { what: label(e), defaultValue: 'Open {{what}}' }),
    onClick: () => setOpened(e.id),
    onKeyDown: (ev: React.KeyboardEvent) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setOpened(e.id); } },
  });
  const stop = (ev: React.SyntheticEvent) => ev.stopPropagation();
  const amountClass = (e: RepLedgerEntry) => (Number(e.amount) > 0 ? 'text-success' : Number(e.amount) < 0 ? 'text-ink' : 'text-muted');
  const signed = (v: string) => `${Number(v) > 0 ? '+' : Number(v) < 0 ? '−' : ''}${euros(Math.abs(Number(v)))}`;
  const what = (e: RepLedgerEntry): ReactNode => (
    <>
      <span className="font-semibold text-ink">{label(e)}</span>
      {e.order && (
        e.order.id
          ? <> · <Link to={`/orders/${e.order.id}`} onClick={stop} className="inline-block py-2.5 -my-2.5 font-mono text-brand hover:underline">{e.order.order_number}</Link></>
          : <> · <span className="font-mono text-muted">{e.order.order_number}</span></>
      )}
      {e.kind === 'order_not_earned' && e.reference_amount && Number(e.reference_amount) > 0 && (
        <span className="text-muted"> · {t('salesReps.earnings.wasExpected', { amount: euros(e.reference_amount), defaultValue: 'expected {{amount}}' })}</span>
      )}
      {e.voided && <span className="ml-1.5 inline-flex px-1.5 rounded bg-surface-cream text-[11px] font-semibold text-muted">{t('salesReps.earnings.voided', 'Voided')}</span>}
      {e.note && <span className="block text-[12px] text-muted">{e.note}</span>}
    </>
  );
  const voidButton = (e: RepLedgerEntry) => canEdit && e.kind === 'payout' && !e.voided && (
    <button
      type="button"
      onClick={(ev) => { stop(ev); setVoiding(e); }}
      title={t('salesReps.earnings.voidPayment', 'Void this payment')}
      aria-label={t('salesReps.earnings.voidPayment', 'Void this payment')}
      className="p-1.5 rounded-lg text-muted hover:text-danger hover:bg-danger-bg"
    >
      <Undo2 size={14} strokeWidth={1.75} />
    </button>
  );

  return (
    <>
      <ul className="md:hidden divide-y divide-border/70">
        {entries.map((e) => (
          <li key={e.id} {...opens(e)} className="px-4 py-3 flex items-start gap-3 cursor-pointer hover:bg-surface-cream/60 active:bg-surface-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40">
            <div className="min-w-0 flex-1 text-[13px]">
              <span className="block text-[11.5px] text-muted">{day(e.occurred_on)}</span>
              {what(e)}
            </div>
            <div className="text-right shrink-0">
              <span className={`block text-sm font-bold font-display tabular-nums ${amountClass(e)}`}>{signed(e.amount)}</span>
              <span className="block text-[11.5px] text-muted tabular-nums">{euros(e.balance)}</span>
            </div>
            {voidButton(e)}
          </li>
        ))}
      </ul>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-cream">
              {[['date', 'Date', 'left'], ['what', 'Entry', 'left'], ['amount', 'Amount', 'right'], ['balance', 'Balance', 'right']].map(([k, d, align]) => (
                <th key={k} className={`${align === 'right' ? 'text-right' : 'text-left'} text-xs font-semibold text-gray uppercase px-4 py-2.5 font-display whitespace-nowrap`}>{t(`salesReps.earnings.col.${k}`, d)}</th>
              ))}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} {...opens(e)} className="border-t border-border align-top cursor-pointer hover:bg-brand-mist/30 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40">
                <td className="px-4 py-2.5 text-sm text-gray whitespace-nowrap">{day(e.occurred_on)}</td>
                <td className="px-4 py-2.5 text-[13px]">{what(e)}</td>
                <td className={`px-4 py-2.5 text-sm font-bold font-display text-right tabular-nums whitespace-nowrap ${amountClass(e)}`}>{signed(e.amount)}</td>
                <td className="px-4 py-2.5 text-sm text-gray text-right tabular-nums whitespace-nowrap">{euros(e.balance)}</td>
                <td className="pr-2 py-1.5 text-right">{voidButton(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {voiding && <VoidDialog userId={userId} entry={voiding} onClose={() => setVoiding(null)} />}
      {opened && <EntryDialog userId={userId} entryId={opened} onClose={() => setOpened(null)} />}
    </>
  );
}

/**
 * A line of the history, opened (2026-10-28, user: "in history when we click
 * upon any row then we need to show the breakdown of the profits"): what it
 * moved and the balance after it, then the order's whole breakdown — buying
 * prices too, which the rep never sees — or the period statement's, and the note.
 */
function EntryDialog({ userId, entryId, onClose }: { userId: string; entryId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const day = useDay();
  const momentDay = useMomentDay();
  const label = useLedgerLabel();
  const { data, isLoading, isError } = useAdminRepEarningEntry(userId, entryId);
  const e = data?.entry;
  const order = data?.order;
  const statement = data?.statement;
  const n = Number(e?.amount ?? 0);
  // The figures the line was made from: as approved once the order is, else as they stand.
  const live = order?.earning;
  const f = live?.approved ?? live;
  const struck = live?.status === 'not_earned' || live?.status === 'reversed';
  const plain: Partial<Record<string, string>> = {
    payout: t('salesReps.earnings.entry.payout', 'A payment to them.'),
    payout_void: t('salesReps.earnings.entry.payoutVoid', 'A payment recorded by mistake, put back onto what is owed.'),
    adjustment: n < 0 ? t('salesReps.earnings.entry.deduction', 'A deduction made by an admin.') : t('salesReps.earnings.entry.bonus', 'A bonus added by an admin.'),
  };
  const lead: Partial<Record<string, string>> = {
    order_adjustment: t('salesReps.earnings.entry.adjustmentLead', 'The order changed after it was approved; this line is the difference. Its figures as approved now:'),
    order_reversal: t('salesReps.earnings.entry.reversalLead', 'The order ended after it was approved, so what had been approved comes off:'),
    order_not_earned: t('salesReps.earnings.entry.notEarnedLead', 'What the order would have earned, at its figures today:'),
  };
  const row = (text: string, value: string, opts: { tone?: string; sub?: string; strong?: boolean; indent?: boolean } = {}) => (
    <div className={`flex items-baseline justify-between gap-3 py-1 ${opts.indent ? 'pl-3' : ''}`}>
      <dt className={`text-[13px] ${opts.strong ? 'font-semibold font-display text-ink' : 'text-gray'}`}>
        {text}
        {opts.sub && <span className="block text-[11.5px] text-muted font-normal font-sans">{opts.sub}</span>}
      </dt>
      <dd className={`text-[13.5px] font-semibold tabular-nums whitespace-nowrap ${opts.tone ?? 'text-ink'}`}>{value}</dd>
    </div>
  );
  // A profit set by hand (2026-10-28): its row says so; what it replaces is marked as not counted.
  const setByHand = t('orderDetail.repEarning.setByHand', 'Set by hand');
  const notCounted = t('orderDetail.repEarning.notCounted', 'Not counted — the profit is set by hand');
  const breakdown = (b: { sales?: string; buying?: string; gross: string; grossSub?: string; expenses: { label: string; amount: string }[]; net: string; percentage: string | null; earning: string; basis?: RepProfitBasis | null }) => (
    <dl>
      {b.sales !== undefined && row(t('orderDetail.repEarning.sales', 'Products'), euros(b.sales), { sub: t('orderDetail.repEarning.salesHint', 'After discounts, IVA in, no delivery fee') })}
      {b.buying !== undefined && row(t('orderDetail.repEarning.buying', 'Buying prices'), `− ${euros(b.buying)}`, b.basis ? { tone: 'text-muted line-through', sub: notCounted } : {})}
      <div className={b.sales !== undefined ? 'border-t border-border mt-1 pt-1' : ''}>
        {row(t('orderDetail.repEarning.gross', 'Gross profit'), euros(b.gross), b.basis === 'gross'
          ? { strong: true, sub: setByHand }
          : b.basis === 'net' ? { tone: 'text-muted line-through', sub: notCounted }
            : { strong: true, sub: b.grossSub ?? t('orderDetail.repEarning.grossHint', 'Before expenses') })}
      </div>
      {b.expenses.length === 0
        ? row(t('salesReps.earnings.entry.noExpenses', 'No expenses'), `− ${euros(0)}`, { tone: 'text-muted', indent: true })
        : b.expenses.map((x, i) => <div key={i}>{row(x.label, `− ${euros(x.amount)}`, b.basis === 'net' ? { tone: 'text-muted line-through', indent: true } : { tone: 'text-gray', indent: true })}</div>)}
      <div className="border-t border-border mt-1 pt-1">
        {row(t('orderDetail.repEarning.net', 'Net profit'), euros(b.net), { strong: true, tone: Number(b.net) < 0 ? 'text-danger' : 'text-ink', sub: b.basis === 'net' ? setByHand : t('orderDetail.repEarning.netHint', 'After expenses') })}
        {row(t('orderDetail.repEarning.pct', 'Their %'), b.percentage == null ? '—' : `${Number(b.percentage)} %`)}
      </div>
      <div className="flex items-baseline justify-between gap-3 border-t border-dashed border-border mt-1.5 pt-2.5">
        <dt className="text-[13.5px] font-semibold font-display text-ink">{t('orderDetail.repEarning.earning', 'They earn')}</dt>
        <dd className={`text-xl font-bold font-display tabular-nums ${struck ? 'text-muted line-through' : 'text-brand'}`}>{euros(b.earning)}</dd>
      </div>
    </dl>
  );

  return (
    <Dialog
      title={e ? label(e) : t('salesReps.earnings.history', 'History')}
      subtitle={e ? day(e.occurred_on) : undefined}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className="h-11 px-4 rounded-xl text-sm font-semibold font-display border-2 border-border text-ink hover:border-brand">
            {t('common.close', 'Close')}
          </button>
          {order?.id && (
            <Link to={`/orders/${order.id}`} className="h-11 px-5 rounded-xl text-sm font-semibold font-display bg-brand text-white hover:bg-brand-mid inline-flex items-center">
              {t('salesReps.earnings.entry.openOrder', 'Open the order')}
            </Link>
          )}
        </>
      )}
    >
      {isError ? (
        <p className="text-[13px] text-gray">{t('salesReps.earnings.entry.failed', 'This line could not be loaded. Close it and try again.')}</p>
      ) : isLoading || !e ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-14 rounded-lg bg-surface-cream animate-pulse" />
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-4 rounded bg-surface-cream animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* What this line moved, and the balance it left. */}
          <div className="flex items-end justify-between gap-4 rounded-lg bg-surface-cream/70 px-4 py-3">
            <div>
              <p className="text-[12px] text-muted">{t('salesReps.earnings.entry.thisLine', 'This line')}</p>
              <p className={`mt-0.5 text-2xl font-bold font-display tabular-nums ${n > 0 ? 'text-success' : 'text-ink'}`}>
                {`${n > 0 ? '+' : n < 0 ? '−' : ''}${euros(Math.abs(n))}`}
                {e.voided && <span className="ml-2 align-middle inline-flex px-1.5 rounded bg-card text-[11px] font-semibold text-muted">{t('salesReps.earnings.voided', 'Voided')}</span>}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[12px] text-muted">{t('salesReps.earnings.entry.balanceAfter', 'Balance after')}</p>
              <p className="mt-0.5 text-base font-semibold font-display tabular-nums text-ink">{euros(e.balance)}</p>
            </div>
          </div>

          {order && live && f && (
            <section>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold font-display text-ink truncate">{order.client_name || order.order_number}</p>
                  <p className="text-[12px] text-muted mt-0.5">
                    <span className="font-mono">{order.order_number}</span>
                    {order.delivered_at && <> · {t('salesReps.earnings.deliveredOn', { day: momentDay(order.delivered_at), defaultValue: 'Delivered {{day}}' })}</>}
                  </p>
                </div>
                <EarningStatusChip status={live.status} />
              </div>
              {lead[e.kind] && <p className="mt-2 text-[12.5px] text-gray">{lead[e.kind]}</p>}
              <div className="mt-2">
                {breakdown({
                  sales: f.sales,
                  buying: f.buying,
                  gross: f.gross_profit ?? String(Number(f.sales) - Number(f.buying)),
                  expenses: f.expenses,
                  net: f.net_profit,
                  percentage: f.percentage,
                  earning: f.earning,
                  basis: f.profit_basis ?? null,
                })}
              </div>
              {live.changed_since_approval && (
                <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-warning">
                  <AlertTriangle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
                  {t('orderDetail.repEarning.changed', { from: euros(live.approved?.earning ?? 0), to: euros(live.earning), defaultValue: 'Changed since approval: {{from}} approved, {{to}} now. Approve again to settle the difference.' })}
                </p>
              )}
              {order.deleted && <p className="mt-2 text-[12.5px] text-muted">{t('salesReps.earnings.entry.orderDeleted', 'This order was deleted and can no longer be opened.')}</p>}
            </section>
          )}

          {statement && (
            <section>
              <p className="text-sm font-semibold font-display text-ink">
                {t('salesReps.earnings.entry.statement', { from: day(statement.period_from), to: day(statement.period_to), defaultValue: 'Statement, {{from}} to {{to}}' })}
              </p>
              <div className="mt-2">
                {breakdown({
                  gross: statement.gross_profit,
                  grossSub: t('salesReps.earnings.entry.statementGrossHint', 'The profit entered for the period, before expenses'),
                  expenses: statement.expenses,
                  net: statement.net_profit,
                  percentage: statement.percentage,
                  earning: statement.earning,
                })}
              </div>
            </section>
          )}

          {!order && !statement && plain[e.kind] && <p className="text-[13px] text-gray">{plain[e.kind]}</p>}

          {e.note && (
            <p className="rounded-lg border border-border px-3 py-2 text-[13px] text-charcoal">
              <span className="block text-[11.5px] text-muted mb-0.5">{t('salesReps.earnings.entry.note', 'Note — the rep sees it')}</span>
              {e.note}
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}

/** The frame every dialog here shares: a sheet on a phone, a box from sm. */
function Dialog({ title, subtitle, onClose, children, footer }: {
  title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer: ReactNode;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-card w-full sm:max-w-md max-h-[94vh] rounded-t-2xl sm:rounded-2xl shadow-modal flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-bold font-display text-ink">{title}</h3>
            {subtitle && <p className="text-xs text-muted mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.cancel', 'Cancel')} className="p-1.5 rounded-lg hover:bg-surface-linen">
            <X size={18} strokeWidth={1.75} className="text-muted" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
        <div className="shrink-0 px-5 py-3 border-t border-border flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

const field = 'h-10 px-3 rounded-lg border border-border bg-card text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30';
const fieldLabel = 'block text-[11px] font-display uppercase tracking-wider text-muted mb-1';

function DialogButtons({ onClose, onSubmit, pending, label, disabled }: { onClose: () => void; onSubmit: () => void; pending: boolean; label: string; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <button type="button" onClick={onClose} className="h-11 px-4 rounded-xl text-sm font-semibold font-display border-2 border-border text-ink hover:border-brand">
        {t('common.cancel', 'Cancel')}
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={pending || disabled}
        className="h-11 px-5 rounded-xl text-sm font-semibold font-display bg-brand text-white hover:bg-brand-mid disabled:opacity-50 inline-flex items-center gap-2"
      >
        {pending && <Loader2 size={15} className="animate-spin" />}
        {label}
      </button>
    </>
  );
}

function PayoutDialog({ userId, name, owed, onClose }: { userId: string; name: string; owed: number; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const pay = useRecordRepPayout();
  const [amount, setAmount] = useState(owed > 0 ? owed.toFixed(2).replace('.', ',') : '');
  const [paidOn, setPaidOn] = useState(madridToday());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const value = isNum(amount) ? num(amount) : NaN;
  const submit = () => {
    if (!(value > 0)) { setError(t('salesReps.earnings.invalid.payment', 'Enter an amount above 0.')); return; }
    pay.mutate({ userId, amount: Math.round(value * 100) / 100, paid_on: paidOn, note: note.trim() || null }, {
      onSuccess: () => { toast.success(t('salesReps.earnings.paymentRecorded', 'Payment recorded')); onClose(); },
      onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    });
  };
  return (
    <Dialog
      title={t('salesReps.earnings.recordPayment', 'Record payment')}
      subtitle={name}
      onClose={onClose}
      footer={<DialogButtons onClose={onClose} onSubmit={submit} pending={pay.isPending} label={t('salesReps.earnings.recordPayment', 'Record payment')} />}
    >
      <p className="text-[13px] text-gray">
        {t('salesReps.earnings.owedNow', { amount: euros(owed), defaultValue: 'Owed to them now: {{amount}}' })}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className={fieldLabel}>{t('salesReps.earnings.amount', 'Amount')}</span>
          <span className="relative block">
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" autoFocus className={`${field} w-full pr-7 text-right tabular-nums`} />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted">€</span>
          </span>
        </label>
        <label>
          <span className={fieldLabel}>{t('salesReps.earnings.paidOn', 'Paid on')}</span>
          <input type="date" value={paidOn} max={madridToday()} onChange={(e) => setPaidOn(e.target.value)} className={`${field} w-full`} />
        </label>
      </div>
      {value > owed && owed >= 0 && (
        <p className="flex items-start gap-1.5 text-[12.5px] text-warning">
          <AlertTriangle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
          {t('salesReps.earnings.overpay', 'More than is owed: the difference shows as paid ahead, and comes off what they earn next.')}
        </p>
      )}
      <label className="block">
        <span className={fieldLabel}>{t('salesReps.earnings.noteForRep', 'Note — the rep sees it')}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t('salesReps.earnings.paymentNotePh', 'Bank transfer, cash…')} className={`${field} w-full`} />
      </label>
      {error && <p className="text-[13px] text-danger">{error}</p>}
    </Dialog>
  );
}

function AdjustmentDialog({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const add = useAddRepAdjustment();
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const v = isNum(amount) ? num(amount) : NaN;
    if (!(v > 0)) { setError(t('salesReps.earnings.invalid.payment', 'Enter an amount above 0.')); return; }
    if (!note.trim()) { setError(t('salesReps.earnings.invalid.note', 'Say what it is for — the rep reads it.')); return; }
    add.mutate({ userId, amount: sign * Math.round(v * 100) / 100, note: note.trim() }, {
      onSuccess: () => { toast.success(t('salesReps.earnings.adjustmentRecorded', 'Adjustment recorded')); onClose(); },
      onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    });
  };
  const opt = (s: 1 | -1, icon: ReactNode, text: string) => (
    <button
      type="button"
      onClick={() => setSign(s)}
      aria-pressed={sign === s}
      className={`flex-1 h-10 rounded-lg text-[13px] font-semibold font-display inline-flex items-center justify-center gap-1.5 border-2 transition-colors ${
        sign === s ? (s > 0 ? 'border-success bg-success-bg text-success' : 'border-danger bg-danger-bg text-danger') : 'border-border text-gray hover:border-brand'
      }`}
    >
      {icon}{text}
    </button>
  );
  return (
    <Dialog
      title={t('salesReps.earnings.adjust', 'Bonus or deduction')}
      subtitle={name}
      onClose={onClose}
      footer={<DialogButtons onClose={onClose} onSubmit={submit} pending={add.isPending} label={t('salesReps.earnings.saveAdjustment', 'Save')} />}
    >
      <div className="flex gap-2">
        {opt(1, <Plus size={15} strokeWidth={2} />, t('salesReps.earnings.bonus', 'Bonus'))}
        {opt(-1, <Minus size={15} strokeWidth={2} />, t('salesReps.earnings.deduction', 'Deduction'))}
      </div>
      <label className="block">
        <span className={fieldLabel}>{t('salesReps.earnings.amount', 'Amount')}</span>
        <span className="relative block">
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0,00" autoFocus className={`${field} w-full pr-7 text-right tabular-nums`} />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted">€</span>
        </span>
      </label>
      <label className="block">
        <span className={fieldLabel}>{t('salesReps.earnings.reasonForRep', 'What it is for — the rep sees it')}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={`${field} w-full`} />
      </label>
      {error && <p className="text-[13px] text-danger">{error}</p>}
    </Dialog>
  );
}

function VoidDialog({ userId, entry, onClose }: { userId: string; entry: RepLedgerEntry; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const voidIt = useVoidRepPayout();
  const [reason, setReason] = useState('');
  return (
    <ConfirmModal
      open
      danger
      title={t('salesReps.earnings.voidPayment', 'Void this payment')}
      message={t('salesReps.earnings.voidBody', { amount: euros(Math.abs(Number(entry.amount))), defaultValue: 'The {{amount}} goes back onto what is owed to them. The payment stays in the history, marked voided.' })}
      confirmLabel={t('salesReps.earnings.voidConfirm', 'Void payment')}
      confirmDisabled={voidIt.isPending}
      onCancel={onClose}
      onConfirm={() => voidIt.mutate({ userId, entryId: entry.id, reason: reason.trim() || null }, {
        onSuccess: () => { toast.success(t('salesReps.earnings.voidedToast', 'Payment voided')); onClose(); },
        onError: (e) => toast.error(t('salesReps.earnings.failed', 'Could not save'), e instanceof Error ? e.message : String(e)),
      })}
    >
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        placeholder={t('salesReps.earnings.voidReasonPh', 'Why — the rep sees it (optional)')}
        className={`${field} w-full mt-3`}
      />
    </ConfirmModal>
  );
}
