import { useEffect, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';

interface Props {
  open: boolean;
  orderNumber: string;
  /** Decides what this delete actually does — see the body copy. */
  status?: string;
  errorMessage?: string | null;
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: (payload: { reason?: string }) => void;
}

/**
 * Type-to-confirm delete for an order — same safety mechanism as
 * StoreDeletionModal's confirmation-name gate: the admin must type the
 * exact order number to enable the delete button. This is a SOFT delete
 * (see packages/api/src/routes/admin/orders.ts POST /:id/delete) — the row
 * stays in the database, `deleted_at` just hides it everywhere — but the
 * confirmation is still deliberately strict, since it silently changes
 * revenue/order-count figures the moment it lands.
 */
export default function DeleteOrderModal({
  open, orderNumber, status, errorMessage, isSubmitting = false, onCancel, onConfirm,
}: Props) {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) { setTyped(''); setReason(''); }
  }, [open, orderNumber]);

  if (!open) return null;

  const canConfirm = typed === orderNumber && typed.length > 0 && !isSubmitting;

  // Mirrors HOLDS_STOCK in the delete route. Promising a restock that will not
  // happen is worse than saying nothing: a draft never reserved any, and a
  // cancelled order was already given its stock back when it was cancelled.
  const restocks = ['pending', 'confirmed', 'preparing', 'on_the_way'].includes(status ?? '');
  const wasFulfilled = status === 'delivered';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-order-modal-title"
    >
      <div
        className="bg-card rounded-2xl shadow-modal w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 p-5 border-b border-border bg-danger-bg">
          <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-danger" strokeWidth={1.75} />
          <div className="flex-1 min-w-0">
            <h3 id="delete-order-modal-title" className="text-base font-bold font-display text-ink">
              Delete order
            </h3>
            <p className="text-[13px] mt-0.5 font-body text-danger">
              This hides the order everywhere — lists, dashboard stats, the customer's own order history.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-black/10 transition-colors shrink-0"
            aria-label="Close"
            type="button"
          >
            <X size={18} strokeWidth={1.75} className="text-muted" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm font-body text-gray">
            {restocks
              ? 'Any stock this order reserved is restored. '
              : 'No stock changes hands. '}
            The order itself isn't erased — it stays queryable
            directly (support lookups, this same page by direct link) but drops out of every list and stat.
          </p>

          {/* A delivered order is money that was actually taken. Hiding it is
              allowed, and it is not the same act as hiding one that never
              shipped, so it does not get the same sentence. */}
          {wasFulfilled && (
            <p className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2.5 text-[13px] font-body text-ink">
              This order was delivered. Its revenue leaves the dashboard and the customer's history,
              and the goods are not returned to stock.
            </p>
          )}

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted font-display">
              Type <span className="font-mono text-ink">{orderNumber}</span> to confirm
            </span>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              placeholder={orderNumber}
              className="mt-1.5 w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-mono text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-danger/30"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted font-display">
              Reason (optional, internal only)
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Test order from checkout QA"
              className="mt-1.5 w-full bg-surface-cream border border-border rounded-lg px-3 py-2 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-danger/30 resize-none"
            />
          </label>

          {errorMessage && (
            <div className="bg-danger-bg border border-danger/40 rounded-lg px-3 py-2 text-[13px] font-body text-danger">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end px-5 pb-5 pt-0">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ reason: reason.trim() || undefined })}
            disabled={!canConfirm}
            className="h-11 px-5 rounded-xl text-sm font-semibold font-display text-white bg-danger hover:bg-danger/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Deleting…' : 'Delete order'}
          </button>
        </div>
      </div>
    </div>
  );
}
