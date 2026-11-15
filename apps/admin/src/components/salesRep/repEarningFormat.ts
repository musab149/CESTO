import { useTranslation } from 'react-i18next';
import type { RepLedgerEntry } from '@grocery-app/shared';

/*
 * What the rep earnings screens share (API lib/repEarnings): how a day, a
 * line of the history are written. The status chip is in EarningStatusChip.
 */

/** A moment (an order delivered) as its day in Madrid. */
export function useMomentDay() {
  const { i18n } = useTranslation();
  return (iso: string) => new Date(iso).toLocaleDateString(i18n.language?.startsWith('es') ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' });
}

/** A calendar date ('2026-10-28'). */
export function useDay() {
  const { i18n } = useTranslation();
  return (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(i18n.language?.startsWith('es') ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** What a line of the history is, in a word or two. */
export function useLedgerLabel() {
  const { t } = useTranslation();
  // An order that can no longer be opened was deleted; one that can, cancelled.
  return (e: Pick<RepLedgerEntry, 'kind' | 'amount' | 'order'>) => {
    const deleted = !!e.order && !e.order.id;
    switch (e.kind) {
      case 'order_earning': return t('salesReps.earnings.kind.order_earning', 'Order approved');
      case 'order_adjustment': return t('salesReps.earnings.kind.order_adjustment', 'Order approved again');
      case 'order_reversal': return deleted
        ? t('salesReps.earnings.kind.order_reversal_deleted', 'Taken back — order deleted')
        : t('salesReps.earnings.kind.order_reversal_cancelled', 'Taken back — order cancelled');
      case 'order_not_earned': return deleted
        ? t('salesReps.earnings.kind.order_not_earned_deleted', 'Not earned — order deleted')
        : t('salesReps.earnings.kind.order_not_earned_cancelled', 'Not earned — order cancelled');
      case 'adjustment': return Number(e.amount) < 0
        ? t('salesReps.earnings.kind.deduction', 'Deduction')
        : t('salesReps.earnings.kind.bonus', 'Bonus');
      case 'payout': return t('salesReps.earnings.kind.payout', 'Payment');
      case 'payout_void': return t('salesReps.earnings.kind.payout_void', 'Payment voided');
      case 'legacy_statement': return t('salesReps.earnings.kind.legacy_statement', 'Earlier statement');
      default: return e.kind;
    }
  };
}
