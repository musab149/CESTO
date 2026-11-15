import type { RepLedgerEntry, RepLedgerLineState } from '@grocery-app/shared';
import { useSalesT } from '../lib/i18n';
import { money } from '../lib/format';
import { LEDGER_TONE } from '../lib/ledgerTone';

/**
 * Where a line of the history stands, as a tag beside its name: "Pagado",
 * "Ganado", "Por cobrar" (with what is left when only part is), "Revertida",
 * "Anulado". Nothing for a line whose name already says it all.
 */
export default function LedgerStateChip({ entry, state }: { entry: Pick<RepLedgerEntry, 'amount' | 'voided'>; state: RepLedgerLineState | undefined }) {
  const t = useSalesT();
  if (!state) return null;
  const tone = LEDGER_TONE[state.tone].chip;
  let text: string | null = null;
  switch (state.tone) {
    case 'paid': text = t('sales.earnings.line.paid'); break;
    case 'settled': text = t('sales.earnings.line.settled'); break;
    case 'outstanding':
      // The amount only when it is not the whole line.
      text = state.left && Number(state.left) !== Math.abs(Number(entry.amount))
        ? t('sales.earnings.line.partial', { amount: money(state.left) })
        : t('sales.earnings.line.outstanding');
      break;
    case 'taken_back': text = t('sales.earnings.line.takenBack'); break;
    // The payment undone carries the tag; the line undoing it is named for it.
    case 'voided': text = entry.voided ? t('sales.earnings.voided') : null; break;
  }
  if (!text || !tone) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 h-[22px] pl-2 pr-2.5 rounded-full text-[11.5px] font-semibold font-display whitespace-nowrap align-middle ${tone.bg} ${tone.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`} aria-hidden="true" />
      {text}
    </span>
  );
}
