import { useTranslation } from 'react-i18next';
import type { OrderStatus } from '@grocery-app/shared';

/**
 * The COLOUR of each order status. Not the words.
 *
 * This map used to carry a `label` too, and those labels were Spanish
 * string literals — so every order status in the admin read Spanish whatever
 * language was selected, in five pages' tables, the dashboard and both filter
 * dropdowns. The words were already translated in
 * `orderDetail.statusLabels.*`; nothing was reading them.
 *
 * The label is gone from here deliberately rather than translated in place:
 * leaving a `label` field is what let callers render a status without going
 * near i18n, which is how it drifted. Use `useOrderStatusLabel()` below.
 */
export const statusConfig: Record<OrderStatus, { bg: string; text: string }> = {
  pending: { bg: 'bg-amber-mist', text: 'text-amber-deep' },
  confirmed: { bg: 'bg-info-bg', text: 'text-info' },
  preparing: { bg: 'bg-st-violet-bg', text: 'text-st-violet-fg' },
  on_the_way: { bg: 'bg-brand-mist', text: 'text-brand' },
  delivered: { bg: 'bg-success-bg', text: 'text-success' },
  cancelled: { bg: 'bg-danger-bg', text: 'text-danger' },
  // MV Slice 4 — parent-only derived status when subs reach mixed terminal
  // states (some delivered, some cancelled). Amber signals partial success.
  partially_completed: { bg: 'bg-amber-mist', text: 'text-amber-deep' },
  // Out-of-stock line items land here instead of failing checkout. Neutral
  // tone — it's not yet an actionable "pending" order, it's blocked on
  // stock until an admin/vendor confirms or cancels it.
  draft: { bg: 'bg-surface-linen', text: 'text-muted' },
};

/**
 * The words, in the language that is actually selected.
 *
 * A hook rather than a plain function because it has to re-render what uses
 * it when the language changes — a filter dropdown built once at mount would
 * otherwise keep yesterday's language until something else moved.
 */
export function useOrderStatusLabel() {
  const { t } = useTranslation();
  // Falls back to the raw status rather than to a Spanish word: an unknown
  // status should look unknown, not look translated.
  return (status: OrderStatus) => t(`orderDetail.statusLabels.${status}`, status);
}

export default function StatusBadge({ status }: { status: OrderStatus }) {
  const label = useOrderStatusLabel();
  const config = statusConfig[status] ?? { bg: 'bg-surface-linen', text: 'text-muted' };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display ${config.bg} ${config.text}`}>
      {label(status)}
    </span>
  );
}
