import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { ledgerStates, type RepLedgerEntry, type RepLedgerLineState } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useSalesT } from '../lib/i18n';
import { money } from '../lib/format';
import { useLedgerLabel } from '../lib/ledger';
import { LEDGER_TONE } from '../lib/ledgerTone';
import { dayLabel } from '../lib/periods';
import EntryDialog from './EntryDialog';
import LedgerStateChip from './LedgerStateChip';

/** Date, what, amount and the balance after it — from lg. */
const HISTORY_COLS = 'lg:grid lg:grid-cols-[110px_minmax(0,1fr)_120px_120px_16px] lg:gap-4 lg:items-center';

/**
 * The lines of a rep's history, newest first, each tinted by where it stands
 * (lib/ledgerTone) and opening its breakdown (EntryDialog). Where each stands
 * is worked out over EVERY line even when only the latest few are shown — a
 * payment pays the oldest earnings first, so a recent line's state depends
 * on the lines before it.
 */
export default function HistoryList({ entries, limit }: { entries: RepLedgerEntry[]; limit?: number }) {
  const t = useSalesT();
  const states = useMemo(() => ledgerStates(entries), [entries]);
  const [open, setOpen] = useState<string | null>(null);
  const shown = limit ? entries.slice(0, limit) : entries;
  return (
    <>
      <div className={`hidden ${HISTORY_COLS} px-5 h-10 border-b border-border bg-surface-cream text-[12px] font-semibold font-display text-muted`}>
        <span>{t('sales.earnings.colDate')}</span>
        <span>{t('sales.earnings.colWhat')}</span>
        <span className="text-right">{t('sales.earnings.colAmount')}</span>
        <span className="text-right">{t('sales.earnings.colBalance')}</span>
        <span />
      </div>
      <ul className="divide-y divide-border">
        {shown.map((e) => <HistoryRow key={e.id} e={e} state={states[e.id]} compact={!!limit} onOpen={() => setOpen(e.id)} />)}
      </ul>
      {open && <EntryDialog id={open} state={states[open]} onClose={() => setOpen(null)} />}
    </>
  );
}

/** A line of the history: the whole row opens its breakdown. */
function HistoryRow({ e, state, compact, onOpen }: { e: RepLedgerEntry; state: RepLedgerLineState | undefined; compact: boolean; onOpen: () => void }) {
  const t = useSalesT();
  const lang = useLanguageStore((s) => s.lang);
  const label = useLedgerLabel();
  const tone = LEDGER_TONE[state?.tone ?? 'none'];
  const Icon = tone.icon;
  const n = Number(e.amount);
  const signed = `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-tone={state?.tone ?? 'none'}
        className={`group relative w-full text-left px-4 lg:px-5 py-3 flex items-start gap-3 ${HISTORY_COLS} transition-colors before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${tone.row} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40`}
      >
        <span className="hidden lg:block text-[13.5px] text-gray">{dayLabel(e.occurred_on, lang)}</span>
        <span className="min-w-0 flex-1 flex items-start gap-3">
          <span className={`lg:hidden w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tone.tile}`}>
            <Icon size={17} strokeWidth={1.75} />
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14.5px] font-semibold font-display text-ink">
              {label(e)}
              <LedgerStateChip entry={e} state={state} />
            </span>
            <span className="block text-[12.5px] text-muted mt-0.5">
              <span className="lg:hidden">{dayLabel(e.occurred_on, lang)}</span>
              {e.order && <><span className="lg:hidden">{'  ·  '}</span><span className="font-mono">{e.order.order_number}</span></>}
              {e.kind === 'order_not_earned' && e.reference_amount && Number(e.reference_amount) > 0 && (
                <>{'  ·  '}{t('sales.earnings.wouldHave', { amount: money(e.reference_amount) })}</>
              )}
            </span>
            {e.note && <span className={`block text-[12.5px] text-gray mt-0.5 ${compact ? 'line-clamp-1' : 'line-clamp-2'}`}>{e.note}</span>}
          </span>
        </span>
        <span className="shrink-0 text-right lg:contents">
          <span className={`block lg:text-right text-[15.5px] font-bold font-display tabular-nums ${tone.amount} ${e.voided ? 'line-through' : ''}`}>{signed}</span>
          <span className="block lg:text-right text-[12px] lg:text-[13.5px] text-muted lg:text-gray tabular-nums">
            <span className="lg:hidden">{t('sales.earnings.balanceShort')} </span>{money(e.balance)}
          </span>
        </span>
        <ChevronRight size={16} strokeWidth={2} className="hidden lg:block text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden="true" />
      </button>
    </li>
  );
}
