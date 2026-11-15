import type { ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Partner-side twin of the admin's ConfirmModal. Same props and the same
 * shape on screen, so a destructive confirm reads identically whichever
 * dashboard you are in — the partner UI deliberately mirrors admin.
 */
interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  children?: ReactNode;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open, title, message, confirmLabel, cancelLabel,
  danger = false, children, confirmDisabled = false, onConfirm, onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/50 px-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="bg-surface-cream rounded-2xl p-6 shadow-float w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 id="confirm-modal-title" className="text-lg font-bold font-display text-ink">{title}</h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label={cancelLabel}
            className="p-1.5 rounded-lg hover:bg-surface-linen transition-colors"
          >
            <X size={18} strokeWidth={1.75} className="text-muted" />
          </button>
        </div>
        <p className="text-sm font-body text-gray mb-4">{message}</p>
        {children && <div className="mb-6">{children}</div>}
        {!children && <div className="mb-2" />}
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`h-11 px-5 rounded-xl text-sm font-semibold font-display text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              danger ? 'bg-danger hover:bg-danger/90' : 'bg-brand hover:bg-brand-mid'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
