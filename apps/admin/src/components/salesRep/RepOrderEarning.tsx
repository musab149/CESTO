import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Loader2, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { useApproveRepOrderEarning, useSetRepOrderEarning, type AdminRepOrderEarning, type RepProfitBasis } from '@grocery-app/shared';
import { useToast } from '@/components/Toast';
import { formatCurrency } from '@/lib/format';
import EarningStatusChip from './EarningStatusChip';
import { useMomentDay } from './repEarningFormat';

/*
 * What the rep who built an order earns from it, on the admin's order page
 * (2026-10-28, user: "In every order we will add the expenses of that order,
 * the net profit after calculation based on the commission percentage of that
 * rep"). API lib/repEarnings: products after discounts (IVA in, delivery fee
 * out) − buying prices − these expenses = net profit; the rep's % of it, 0 at
 * a loss. Owed once the order is delivered and approved here. The rep sees
 * the same breakdown on their order, without the buying prices.
 *
 * The admin may type the profit in by hand instead (2026-10-28, user: "admin
 * should be able to edit the profits himself on orders... that will be
 * recorded against that order"; asked which: "Either one") — the GROSS profit
 * (the expenses still come off it) or the NET profit (nothing comes off). The
 * card says which, who set it and when, and marks what no longer counts.
 */

const euros = (v: string | number) => formatCurrency(Number(v));
const num = (s: string) => Number(s.trim().replace(',', '.'));
const isNum = (s: string) => s.trim() !== '' && Number.isFinite(num(s));
const typed = (v: string) => String(Number(v)).replace('.', ',');

interface ExpenseRow { key: number; label: string; amount: string }

export function RepOrderEarningCard({ orderId, earning, canEdit }: { orderId: string; earning: AdminRepOrderEarning; canEdit: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const day = useMomentDay();
  const approve = useApproveRepOrderEarning();
  const [editing, setEditing] = useState(false);
  const e = earning;
  const ended = e.status === 'not_earned' || e.status === 'reversed';

  const doApprove = () => approve.mutate({ id: orderId }, {
    onSuccess: () => toast.success(t('orderDetail.repEarning.approved', 'Earning approved')),
    onError: (err) => toast.error(t('orderDetail.repEarning.approveFailed', 'Could not approve'), err instanceof Error ? err.message : String(err)),
  });

  const pctNote = e.pct_source === 'order'
    ? t('orderDetail.repEarning.pctOrder', 'this order')
    : e.pct_source === 'rep'
      ? t('orderDetail.repEarning.pctRep', 'their usual')
      : t('orderDetail.repEarning.pctNone', 'not set');
  const basis = e.profit_basis ?? null;
  // Which profit was typed in by hand, by whom and when — said on its row.
  const setLine = e.profit_set
    ? (e.profit_set.by && e.profit_set.at
      ? t('orderDetail.repEarning.setBy', { by: e.profit_set.by, day: day(e.profit_set.at), defaultValue: 'Set by hand · {{by}}, {{day}}' })
      : t('orderDetail.repEarning.setByHand', 'Set by hand'))
    : null;
  const notCounted = t('orderDetail.repEarning.notCounted', 'Not counted — the profit is set by hand');
  const row = (label: string, value: string, opts: { strong?: boolean; tone?: string; sub?: string; set?: boolean } = {}) => (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={opts.strong ? 'text-sm font-semibold font-display text-ink' : 'text-[13px] text-gray'}>
        {label}
        {opts.sub && <span className={`block text-[11.5px] font-normal font-sans ${opts.set ? 'text-brand' : 'text-muted'}`}>{opts.sub}</span>}
      </dt>
      <dd className={`tabular-nums whitespace-nowrap ${opts.strong ? 'text-lg font-bold font-display' : 'text-[13px] font-semibold'} ${opts.tone ?? 'text-ink'}`}>{value}</dd>
    </div>
  );

  return (
    <section className="bg-card rounded-xl border border-border p-5" aria-label={t('orderDetail.repEarning.title', 'Rep earning')}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-bold font-display text-ink">
            <Wallet size={17} strokeWidth={1.75} className="text-brand" />
            {t('orderDetail.repEarning.title', 'Rep earning')}
          </h2>
          <Link to={`/sales-reps/${e.rep.user_id}`} className="text-[12.5px] text-brand hover:underline">{e.rep.name}</Link>
        </div>
        <EarningStatusChip status={e.status} />
      </div>

      {editing ? (
        <EarningEditor orderId={orderId} earning={e} onClose={() => setEditing(false)} />
      ) : (
        <>
          <dl className="space-y-1.5">
            {row(t('orderDetail.repEarning.sales', 'Products'), euros(e.sales), { sub: t('orderDetail.repEarning.salesHint', 'After discounts, IVA in, no delivery fee') })}
            {row(t('orderDetail.repEarning.buying', 'Buying prices'), `− ${euros(e.buying)}`, basis ? { tone: 'text-muted line-through', sub: notCounted } : {})}
            {/* Two profits (user, 2026-10-28): before the order's expenses, and after. */}
            <div className="border-t border-border pt-1.5">
              {row(t('orderDetail.repEarning.gross', 'Gross profit'), euros(e.gross_profit ?? Number(e.sales) - Number(e.buying)),
                basis === 'gross' ? { sub: setLine ?? undefined, set: true }
                  : basis === 'net' ? { tone: 'text-muted line-through', sub: notCounted }
                    : { sub: t('orderDetail.repEarning.grossHint', 'Before expenses') })}
            </div>
            {e.expenses.map((x, i) => row(x.label, `− ${euros(x.amount)}`, basis === 'net' ? { tone: 'text-muted line-through', sub: i === 0 ? notCounted : undefined } : { tone: 'text-gray' }))}
            {e.expenses.length === 0 && row(t('orderDetail.repEarning.expenses', 'Expenses'), `− ${euros(0)}`, { tone: 'text-muted' })}
            <div className="border-t border-border pt-1.5">
              {row(t('orderDetail.repEarning.net', 'Net profit'), euros(e.net_profit),
                basis === 'net'
                  ? { tone: Number(e.net_profit) < 0 ? 'text-danger' : 'text-ink', sub: setLine ?? undefined, set: true }
                  : { tone: Number(e.net_profit) < 0 ? 'text-danger' : 'text-ink', sub: t('orderDetail.repEarning.netHint', 'After expenses') })}
            </div>
            {row(t('orderDetail.repEarning.pct', 'Their %'), e.percentage == null ? '—' : `${Number(e.percentage)} %`, { sub: pctNote })}
            <div className="border-t border-border pt-1.5">
              {row(t('orderDetail.repEarning.earning', 'They earn'), euros(e.earning), { strong: true, tone: 'text-brand' })}
            </div>
          </dl>

          {/* Not a concern once the profit is set by hand: buying prices no longer count. */}
          {e.lines_without_cost > 0 && !ended && !basis && (
            <p className="mt-3 flex items-start gap-1.5 text-[12.5px] text-warning">
              <AlertTriangle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
              {t('orderDetail.repEarning.linesWithoutCost', { count: e.lines_without_cost, defaultValue: '{{count}} lines without a buying price' })}
            </p>
          )}

          {/* Where it stands, in a sentence. */}
          <div className="mt-3 rounded-lg bg-surface-cream/70 px-3 py-2.5 text-[12.5px] text-gray">
            {e.status === 'approved' && e.approved && !e.changed_since_approval && (
              t('orderDetail.repEarning.approvedOn', { amount: euros(e.approved.earning), day: day(e.approved.at), defaultValue: '{{amount}} approved on {{day}} — owed to them.' })
            )}
            {e.status === 'approved' && e.approved && e.changed_since_approval && (
              <span className="text-warning">
                {t('orderDetail.repEarning.changed', { from: euros(e.approved.earning), to: euros(e.earning), defaultValue: 'Changed since approval: {{from}} approved, {{to}} now. Approve again to settle the difference.' })}
              </span>
            )}
            {e.status === 'awaiting_approval' && t('orderDetail.repEarning.awaiting', 'Delivered. Check the buying prices and expenses, then approve.')}
            {e.status === 'expected' && t('orderDetail.repEarning.expectedHint', 'Approved once the order is delivered.')}
            {e.status === 'draft' && t('orderDetail.repEarning.draftHint', 'A draft earns nothing until it is placed.')}
            {e.status === 'not_earned' && t('orderDetail.repEarning.notEarnedHint', 'Cancelled before approval — nothing owed.')}
            {e.status === 'reversed' && t('orderDetail.repEarning.reversedHint', { amount: euros(e.approved?.earning ?? 0), defaultValue: 'The {{amount}} approved was taken back when the order ended.' })}
            {e.approve_blocker === 'no_percentage' && !ended && (
              <span className="block mt-1 text-warning">{t('orderDetail.repEarning.noPct', 'Set their usual % on their profile, or one for this order, to approve.')}</span>
            )}
          </div>

          {canEdit && !ended && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="h-9 px-3.5 rounded-lg text-xs font-semibold font-display border-2 border-border text-ink hover:border-brand inline-flex items-center gap-1.5"
              >
                <Pencil size={13} strokeWidth={1.75} />
                {t('orderDetail.repEarning.edit', 'Expenses, profit and %')}
              </button>
              {e.can_approve && (
                <button
                  type="button"
                  onClick={doApprove}
                  disabled={approve.isPending}
                  className="h-9 px-3.5 rounded-lg text-xs font-semibold font-display bg-brand text-white hover:bg-brand-mid disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {approve.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} strokeWidth={2} />}
                  {e.changed_since_approval
                    ? t('orderDetail.repEarning.approveAgain', 'Approve again')
                    : t('orderDetail.repEarning.approveAmount', { amount: euros(e.earning), defaultValue: 'Approve {{amount}}' })}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function EarningEditor({ orderId, earning, onClose }: { orderId: string; earning: AdminRepOrderEarning; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const save = useSetRepOrderEarning();
  const [rows, setRows] = useState<ExpenseRow[]>(() => earning.expenses.map((x, i) => ({ key: -(i + 1), label: x.label, amount: typed(x.amount) })));
  const [nextKey, setNextKey] = useState(1);
  const [ownPct, setOwnPct] = useState(earning.order_pct != null);
  // The profit: worked out, or typed in by hand as the gross or the net.
  const [mode, setMode] = useState<'auto' | RepProfitBasis>(earning.profit_set?.basis ?? 'auto');
  const [profit, setProfit] = useState(earning.profit_set ? typed(earning.profit_set.amount) : '');
  const [pct, setPct] = useState(earning.order_pct != null ? typed(earning.order_pct) : (earning.rep_pct != null ? typed(earning.rep_pct) : ''));
  const [error, setError] = useState<string | null>(null);

  const expensesTotal = rows.reduce((s, r) => s + (isNum(r.amount) ? num(r.amount) : 0), 0);
  const effectivePct = ownPct ? (isNum(pct) ? num(pct) : 0) : (earning.rep_pct != null ? Number(earning.rep_pct) : 0);
  const typedProfit = isNum(profit) ? num(profit) : 0;
  const net = Math.round((mode === 'net' ? typedProfit
    : (mode === 'gross' ? typedProfit : Number(earning.sales) - Number(earning.buying)) - expensesTotal) * 100) / 100;
  const preview = net <= 0 ? 0 : Math.round(net * effectivePct) / 100;

  const submit = () => {
    if (rows.some((r) => !r.label.trim() || !isNum(r.amount) || num(r.amount) < 0)) {
      setError(t('orderDetail.repEarning.invalidExpense', 'Each expense needs a concept and an amount of 0 or more.'));
      return;
    }
    if (ownPct && !(isNum(pct) && num(pct) >= 0 && num(pct) <= 100)) {
      setError(t('orderDetail.repEarning.invalidPct', 'The percentage goes from 0 to 100.'));
      return;
    }
    if (mode !== 'auto' && !isNum(profit)) {
      setError(t('orderDetail.repEarning.invalidProfit', 'Type the profit as an amount in euros.'));
      return;
    }
    setError(null);
    save.mutate({
      id: orderId,
      body: {
        commission_pct: ownPct ? num(pct) : null,
        expenses: rows.map((r) => ({ label: r.label.trim(), amount: Math.round(num(r.amount) * 100) / 100 })),
        profit: mode === 'auto' ? null : { basis: mode, amount: Math.round(num(profit) * 100) / 100 },
      },
    }, {
      onSuccess: () => { toast.success(t('orderDetail.repEarning.saved', 'Saved')); onClose(); },
      onError: (err) => setError(err instanceof Error ? err.message : String(err)),
    });
  };
  const field = 'h-9 px-2.5 rounded-lg border border-border bg-card text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30';

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-display uppercase tracking-wider text-muted mb-1.5">{t('orderDetail.repEarning.expenses', 'Expenses')}</p>
        {rows.length === 0 && <p className="text-[12.5px] text-muted mb-1.5">{t('orderDetail.repEarning.noExpenses', 'None yet — delivery, fuel, a sample…')}</p>}
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-1.5">
              <input
                value={r.label}
                onChange={(ev) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, label: ev.target.value } : x)))}
                maxLength={120}
                placeholder={t('orderDetail.repEarning.concept', 'Concept')}
                aria-label={t('orderDetail.repEarning.concept', 'Concept')}
                className={`${field} min-w-0 flex-1`}
              />
              <span className="relative">
                <input
                  value={r.amount}
                  onChange={(ev) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, amount: ev.target.value } : x)))}
                  inputMode="decimal"
                  placeholder="0,00"
                  aria-label={t('orderDetail.repEarning.amountOf', { label: r.label || '—', defaultValue: 'Amount of {{label}}' })}
                  className={`${field} w-24 pr-6 text-right tabular-nums`}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">€</span>
              </span>
              <button
                type="button"
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                aria-label={t('orderDetail.repEarning.removeExpense', 'Remove this expense')}
                className="p-2 rounded-lg text-muted hover:text-danger hover:bg-danger-bg"
              >
                <Trash2 size={14} strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => { setRows((rs) => [...rs, { key: nextKey, label: '', amount: '' }]); setNextKey((k) => k + 1); }}
          className="mt-1.5 text-[12.5px] font-semibold font-display text-brand hover:underline inline-flex items-center gap-1"
        >
          <Plus size={13} strokeWidth={2} />
          {t('orderDetail.repEarning.addExpense', 'Add an expense')}
        </button>
      </div>

      <ProfitChoice
        earning={earning}
        mode={mode}
        onMode={setMode}
        amount={profit}
        onAmount={setProfit}
        field={field}
      />

      <div>
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" checked={ownPct} onChange={(ev) => setOwnPct(ev.target.checked)} className="w-4 h-4 accent-brand" />
          {t('orderDetail.repEarning.ownPct', 'A different % for this order')}
        </label>
        {ownPct ? (
          <span className="relative inline-block mt-1.5">
            <input
              value={pct}
              onChange={(ev) => setPct(ev.target.value)}
              inputMode="decimal"
              aria-label={t('orderDetail.repEarning.pct', 'Their %')}
              className={`${field} w-24 pr-7 text-right tabular-nums`}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
          </span>
        ) : (
          <p className="text-[12px] text-muted mt-1">
            {earning.rep_pct != null
              ? t('orderDetail.repEarning.usesUsual', { pct: Number(earning.rep_pct), defaultValue: 'Uses their usual {{pct}} %.' })
              : t('orderDetail.repEarning.noUsual', 'They have no usual % yet.')}
          </p>
        )}
      </div>

      <p className="text-[12.5px] text-gray">
        {t('orderDetail.repEarning.preview', { net: euros(net), amount: euros(preview), defaultValue: 'Net profit {{net}} → they earn {{amount}}' })}
      </p>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-9 px-3 rounded-lg text-xs font-semibold font-display border-2 border-border text-ink hover:border-brand">
          {t('common.cancel', 'Cancel')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={save.isPending}
          className="h-9 px-3.5 rounded-lg text-xs font-semibold font-display bg-brand text-white hover:bg-brand-mid disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {save.isPending && <Loader2 size={13} className="animate-spin" />}
          {t('orderDetail.repEarning.save', 'Save')}
        </button>
      </div>
    </div>
  );
}

/**
 * The order's profit: worked out (products − buying prices − expenses), or
 * typed in by hand as the gross profit (the expenses still come off) or the
 * net profit (nothing comes off). One amount field, under the choice it is for.
 */
function ProfitChoice({ earning, mode, onMode, amount, onAmount, field }: {
  earning: AdminRepOrderEarning; mode: 'auto' | RepProfitBasis; onMode: (m: 'auto' | RepProfitBasis) => void;
  amount: string; onAmount: (v: string) => void; field: string;
}) {
  const { t } = useTranslation();
  const worked = Number(earning.sales) - Number(earning.buying);
  const options: { value: 'auto' | RepProfitBasis; label: string; hint: string }[] = [
    { value: 'auto', label: t('orderDetail.repEarning.profitAuto', 'Worked out'), hint: t('orderDetail.repEarning.profitAutoHint', { amount: euros(worked), defaultValue: 'Products − buying prices = {{amount}}, then the expenses' }) },
    { value: 'gross', label: t('orderDetail.repEarning.profitGross', 'Set the gross profit'), hint: t('orderDetail.repEarning.profitGrossHint', 'The expenses still come off it') },
    { value: 'net', label: t('orderDetail.repEarning.profitNet', 'Set the net profit'), hint: t('orderDetail.repEarning.profitNetHint', 'Buying prices and expenses are not counted') },
  ];
  return (
    <fieldset>
      <legend className="text-[11px] font-display uppercase tracking-wider text-muted mb-1.5">{t('orderDetail.repEarning.profit', 'Profit')}</legend>
      <div className="space-y-1.5">
        {options.map((o) => {
          const on = mode === o.value;
          return (
            <div key={o.value} className={`rounded-lg border px-3 py-2 transition-colors ${on ? 'border-brand bg-brand-mist/30' : 'border-border hover:border-brand/40'}`}>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="radio" name="profit-mode" checked={on} onChange={() => onMode(o.value)} className="mt-0.5 w-4 h-4 accent-brand" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold font-display text-ink">{o.label}</span>
                  <span className="block text-[11.5px] text-muted">{o.hint}</span>
                </span>
              </label>
              {on && o.value !== 'auto' && (
                <span className="relative inline-block mt-2 ml-[26px]">
                  <input
                    value={amount}
                    onChange={(ev) => onAmount(ev.target.value)}
                    inputMode="decimal"
                    placeholder="0,00"
                    autoFocus
                    aria-label={o.label}
                    className={`${field} w-32 pr-6 text-right tabular-nums`}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">€</span>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/** A split purchase: what each part a rep built earns, and the way to it. */
export function PurchaseRepEarnings({ parts }: { parts: { id: string; order_number: string; rep_earning: AdminRepOrderEarning | null }[] }) {
  const { t } = useTranslation();
  const withEarning = parts.filter((p) => p.rep_earning);
  if (withEarning.length === 0) return null;
  return (
    <section className="bg-card rounded-xl border border-border p-5" aria-label={t('orderDetail.repEarning.title', 'Rep earning')}>
      <h2 className="flex items-center gap-2 text-base font-bold font-display text-ink mb-1">
        <Wallet size={17} strokeWidth={1.75} className="text-brand" />
        {t('orderDetail.repEarning.title', 'Rep earning')}
      </h2>
      <p className="text-[12.5px] text-muted mb-3">{t('orderDetail.repEarning.perPart', 'Each part earns on its own; open a part to see its figures and approve it.')}</p>
      <ul className="divide-y divide-border">
        {withEarning.map((p) => (
          <li key={p.id} className="py-2.5 flex items-center gap-3">
            <Link to={`/orders/${p.id}`} className="min-w-0 flex-1 py-2.5 -my-2.5 text-sm font-mono text-brand hover:underline truncate">{p.order_number}</Link>
            <EarningStatusChip status={p.rep_earning!.status} />
            <span className="text-sm font-bold font-display tabular-nums text-ink">{euros(p.rep_earning!.earning)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
