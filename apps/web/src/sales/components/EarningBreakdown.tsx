import type { RepEarningExpense, RepProfitBasis } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useSalesT } from '../lib/i18n';
import { money } from '../lib/format';

/*
 * How an earning is made, line by line (2026-10-28, user: "there are two
 * profits, one before deducting expenses and other after expenses... in the
 * breakdown we can show the complete thing other then buying prices"):
 *
 *   Productos              80,00 €   with discounts, IVA in, no delivery
 *   Beneficio bruto        79,00 €   before expenses
 *     − Reparto             2,50 €
 *   Beneficio neto         76,50 €   after expenses
 *   Tu porcentaje            10 %
 *   Tu ganancia             7,65 €
 *
 * The buying prices are never a line: the API sends the rep no such figure.
 * The same rows on their order and in a history line they open.
 *
 * A profit the office set by hand (2026-10-28) is said on its row — never by
 * whom. Set as the net, nothing came off it, so the gross and the expenses
 * are not shown at all.
 */
export default function EarningBreakdown({ sales, gross, grossHint, expenses, expensesHint, net, percentage, earning, struck = false, basis = null }: {
  /** The products' total — absent for a period statement, which has none. */
  sales?: string;
  gross?: string;
  grossHint?: string;
  expenses: RepEarningExpense[];
  expensesHint?: string;
  net: string;
  percentage: string | null;
  earning: string;
  /** Not earned or taken back: the earning shown, struck through. */
  struck?: boolean;
  /** A profit the office set by hand, and which. */
  basis?: RepProfitBasis | null;
}) {
  const t = useSalesT();
  const lang = useLanguageStore((s) => s.lang);
  const row = (label: string, value: string, opts: { tone?: string; hint?: string; strong?: boolean; indent?: boolean } = {}) => (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${opts.indent ? 'pl-3' : ''}`}>
      <dt className={opts.strong ? 'text-[13.5px] font-semibold font-display text-ink' : 'text-[13.5px] text-gray'}>
        {label}
        {opts.hint && <span className="block text-[11.5px] font-normal font-sans text-muted leading-snug">{opts.hint}</span>}
      </dt>
      <dd className={`text-[15px] font-semibold font-display tabular-nums whitespace-nowrap ${opts.tone ?? 'text-ink'}`}>{value}</dd>
    </div>
  );
  const n = Number(net);
  return (
    <dl>
      {sales !== undefined && row(t('sales.earnings.order.products'), money(sales), { hint: t('sales.earnings.salesHint') })}
      {gross !== undefined && basis !== 'net' && row(t('sales.earnings.gross'), money(gross), { strong: true, hint: basis === 'gross' ? t('sales.earnings.grossSet') : grossHint ?? t('sales.earnings.grossHint') })}
      {basis !== 'net' && (expenses.length === 0
        ? row(t('sales.earnings.order.noExpenses'), `− ${money(0)}`, { tone: 'text-muted', indent: true })
        : expenses.map((x, i) => row(x.label, `− ${money(x.amount)}`, { tone: 'text-charcoal', indent: true, hint: i === 0 ? expensesHint ?? t('sales.earnings.order.expense') : undefined })))}
      <div className="border-t border-border mt-1.5 pt-1.5">
        {row(t('sales.earnings.net'), money(net), { strong: true, tone: n < 0 ? 'text-danger' : 'text-ink', hint: basis === 'net' ? t('sales.earnings.netSet') : t('sales.earnings.netHintAfter') })}
        {row(t('sales.earnings.pct'), percentage == null ? t('sales.earnings.order.pctPending') : `${Number(percentage).toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB')} %`)}
      </div>
      <div className="flex items-baseline justify-between gap-3 pt-3 mt-1.5 border-t border-dashed border-border">
        <dt className="text-[14px] font-semibold font-display text-ink">{t('sales.earnings.order.yours')}</dt>
        <dd className={`text-[22px] font-bold font-display tabular-nums ${struck ? 'text-muted line-through' : 'text-brand'}`}>{money(earning)}</dd>
      </div>
    </dl>
  );
}
