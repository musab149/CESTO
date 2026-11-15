import type { RepEarningStatus } from '@grocery-app/shared';
import { useSalesT } from './i18n';

/*
 * What the earnings screens share (API lib/repEarnings): an order's earning
 * status pill. What a line of the history is: lib/ledger.ts; dates: lib/periods.ts.
 */

const TONE: Record<RepEarningStatus, { pill: string; dot: string }> = {
  draft: { pill: 'bg-surface-sand text-gray', dot: 'bg-muted' },
  expected: { pill: 'bg-brand-whisper text-brand', dot: 'bg-brand' },
  awaiting_approval: { pill: 'bg-st-amber-bg text-st-amber-fg', dot: 'bg-st-amber-dot' },
  approved: { pill: 'bg-st-emerald-bg text-st-emerald-fg', dot: 'bg-st-emerald-dot' },
  not_earned: { pill: 'bg-surface-sand text-gray', dot: 'bg-muted' },
  reversed: { pill: 'bg-danger-bg text-danger', dot: 'bg-danger' },
};

/** Where an order's earning stands. Shaped like an order's status pill. */
export function EarningStatusPill({ status }: { status: RepEarningStatus }) {
  const t = useSalesT();
  const tone = TONE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 h-6 pl-2 pr-2.5 rounded-full text-[12px] font-semibold font-display whitespace-nowrap ${tone.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`} aria-hidden="true" />
      {t(`sales.earnings.status.${status}`)}
    </span>
  );
}
