import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Extra content inserted between the message and the buttons — e.g. a
   *  textarea for the "reason" on a cancel dialog. Parent owns the state. */
  children?: ReactNode;
  /** When true, disables the confirm button (parent-side validation). */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open, title, message, confirmLabel, cancelLabel,
  danger = false, children, confirmDisabled = false, onConfirm, onCancel,
}: ConfirmModalProps) {
  // The defaults were Spanish literals, so a caller that left them out — the
  // order cancel box among them — said "Cancelar" in the English panel.
  const { t } = useTranslation();
  if (!open) return null;

  return (
    // ON A PHONE (2026-11-05): a sheet from the bottom edge, buttons full
    // width with the answer nearest the thumb; capped at 90% of the screen
    // and scrolling, so a long one (the recargo box, a reason field) can't
    // push its buttons off-screen. From sm, the centred dialog it was.
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        className="bg-card rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6 shadow-modal w-full sm:max-w-md sm:mx-4 max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="text-lg font-bold font-display text-ink">{title}</h3>
          <button onClick={onCancel} aria-label={t('common.close', 'Close')} className="w-9 h-9 -mr-1.5 shrink-0 rounded-lg flex items-center justify-center hover:bg-surface-linen transition-colors">
            <X size={18} strokeWidth={1.75} className="text-muted" />
          </button>
        </div>
        <p className="text-sm font-body text-gray mb-4">{message}</p>
        {children && <div className="mb-6">{children}</div>}
        {!children && <div className="mb-2" />}
        <div className="flex flex-col-reverse sm:flex-row gap-2.5 sm:gap-3 sm:justify-end">
          <button
            onClick={onCancel}
            className="h-12 sm:h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors"
          >
            {cancelLabel ?? t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`h-12 sm:h-11 px-5 rounded-xl text-sm font-semibold font-display text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              danger ? 'bg-danger hover:bg-danger/90' : 'bg-brand hover:bg-brand-mid'
            }`}
          >
            {confirmLabel ?? t('common.confirm', 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
