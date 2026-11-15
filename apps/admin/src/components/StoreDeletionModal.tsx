import { useEffect, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import type { Store } from '@grocery-app/shared';

export type StoreDeletionIntent = 'schedule' | 'permanent';

interface Props {
  open: boolean;
  intent: StoreDeletionIntent;
  store: Pick<Store, 'id' | 'name'> & { _count?: { products: number } };
  /** Present + non-zero → shown in the confirmation body as "will affect N products". */
  productsCount?: number;
  /** Active sales reps who sell from this shop (lib/repStore on the API). */
  repsCount?: number;
  /** Show a specific error banner (e.g. server said grace period hasn't elapsed). */
  errorMessage?: string | null;
  isSubmitting?: boolean;
  onCancel: () => void;
  onConfirm: (payload: { confirmation_name: string; reason?: string }) => void;
}

/**
 * Two-step confirmation for store deletion. Same UX for both intents; the
 * `intent` prop switches the copy + whether a `reason` textarea is required.
 *
 *   intent="schedule"  — reason required (min 10 chars), triggers 5-day grace
 *   intent="permanent" — reason not required, super_admin gated at call site
 *
 * The confirmation-name typing gate is the primary safety mechanism: the user
 * must type the exact store name to enable the confirm button. Prevents
 * "double-tap a row and delete the wrong store" — the current failure mode
 * this whole feature exists to eliminate.
 */
export default function StoreDeletionModal({
  open, intent, store, productsCount = 0, repsCount = 0, errorMessage,
  isSubmitting = false, onCancel, onConfirm,
}: Props) {
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');

  // Clear inputs whenever the modal reopens with a different store. Guards
  // against typed text from a cancelled attempt bleeding into the next one.
  useEffect(() => {
    if (open) { setName(''); setReason(''); }
  }, [open, store.id, intent]);

  if (!open) return null;

  const nameMatches = name === store.name && name.length > 0;
  const reasonValid = intent === 'permanent' || reason.trim().length >= 10;
  const canConfirm = nameMatches && reasonValid && !isSubmitting;

  const title = intent === 'schedule'
    ? 'Schedule store deletion'
    : 'Permanently delete store';

  const heading = intent === 'schedule'
    ? 'This will hide the store from customers for 5 days.'
    : 'This CANNOT be undone easily.';

  const bodyLead = intent === 'schedule'
    ? 'The store enters a 5-day grace period. You can cancel deletion at any point during those 5 days. After the grace period ends, a super admin can permanently delete the row.'
    : 'The store row will be tombstoned (kept for order-history integrity but hidden from every surface). A super admin can still Restore it from the "Deleted stores" filter, but products and riders assigned to this store will need to be reassigned separately.';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="store-deletion-modal-title"
    >
      <div
        className="bg-card rounded-2xl shadow-modal w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — red banner for permanent, amber for schedule */}
        <div className={`flex items-start gap-3 p-5 border-b border-border ${intent === 'permanent' ? 'bg-danger-bg' : 'bg-amber-mist/40'}`}>
          <AlertTriangle
            className={`w-5 h-5 mt-0.5 shrink-0 ${intent === 'permanent' ? 'text-danger' : 'text-amber-deep'}`}
            strokeWidth={1.75}
          />
          <div className="flex-1 min-w-0">
            <h3 id="store-deletion-modal-title" className="text-base font-bold font-display text-ink">
              {title}
            </h3>
            <p className={`text-[13px] mt-0.5 font-body ${intent === 'permanent' ? 'text-danger' : 'text-amber-deep'}`}>
              {heading}
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
          <p className="text-sm font-body text-gray">{bodyLead}</p>

          {productsCount > 0 && (
            <div className="bg-surface-cream border border-border rounded-lg px-3 py-2 text-[13px] font-body text-ink">
              <span className="font-semibold">{productsCount}</span> product{productsCount === 1 ? '' : 's'} currently attached to this store.
              {intent === 'permanent'
                ? ' They will remain in the catalogue with their store link intact — but the storefront will hide them along with the store.'
                : ' They will be hidden from customers while the store is scheduled for deletion.'}
            </div>
          )}

          {/* Reps sell from one shop (lib/repStore on the API): this one going
              leaves them nothing to sell until they are given another. */}
          {repsCount > 0 && (
            <div className="bg-warning-bg border border-warning/30 rounded-lg px-3 py-2 text-[13px] font-body text-ink">
              <span className="font-semibold">{repsCount}</span> sales rep{repsCount === 1 ? '' : 's'} sell{repsCount === 1 ? 's' : ''} from this store.
              {' '}Its products leave their catalogue, and a rep with no other shop cannot build orders until you assign one.
            </div>
          )}

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted font-display">
              Type <span className="font-mono text-ink">{store.name}</span> to confirm
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              placeholder={store.name}
              className="mt-1.5 w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-mono text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </label>

          {intent === 'schedule' && (
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted font-display">
                Reason (audit log) — min 10 characters
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Store owner requested closure, low sales for 3 months, contract not renewed…"
                className="mt-1.5 w-full bg-surface-cream border border-border rounded-lg px-3 py-2 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 resize-none"
              />
              <span className="mt-1 block text-[11px] font-mono text-muted">
                {reason.trim().length}/10 characters minimum
              </span>
            </label>
          )}

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
            onClick={() => onConfirm({ confirmation_name: name, reason: intent === 'schedule' ? reason : undefined })}
            disabled={!canConfirm}
            className={`h-11 px-5 rounded-xl text-sm font-semibold font-display text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              intent === 'permanent' ? 'bg-danger hover:bg-danger/90' : 'bg-amber-deep hover:bg-amber-deep/90'
            }`}
          >
            {isSubmitting
              ? 'Working…'
              : intent === 'permanent'
                ? 'Permanently delete'
                : 'Schedule deletion'}
          </button>
        </div>
      </div>
    </div>
  );
}
