import type { RepLedgerEntry } from '@grocery-app/shared';
import { useSalesT } from './i18n';

/**
 * What a line of the history is, in a few words. An order that can no longer
 * be opened was deleted; one that can, cancelled.
 */
export function useLedgerLabel() {
  const t = useSalesT();
  return (e: Pick<RepLedgerEntry, 'kind' | 'amount' | 'order'>) => {
    const deleted = !!e.order && !e.order.id;
    switch (e.kind) {
      case 'order_reversal': return t(deleted ? 'sales.earnings.kind.order_reversal_deleted' : 'sales.earnings.kind.order_reversal_cancelled');
      case 'order_not_earned': return t(deleted ? 'sales.earnings.kind.order_not_earned_deleted' : 'sales.earnings.kind.order_not_earned_cancelled');
      case 'adjustment': return t(Number(e.amount) < 0 ? 'sales.earnings.kind.deduction' : 'sales.earnings.kind.bonus');
      default: return t(`sales.earnings.kind.${e.kind}`);
    }
  };
}
