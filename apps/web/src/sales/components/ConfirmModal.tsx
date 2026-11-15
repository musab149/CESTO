import type { ReactNode } from 'react';
import { AlertTriangle, CircleHelp } from 'lucide-react';
import { usePortT } from '../lib/portT';
import { Button, Dialog } from './Dialog';

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

/**
 * A question before something that cannot be taken back — in the panel's one
 * dialog shell (components/Dialog). A destructive one wears the danger tone
 * on its icon and its button.
 */
export default function ConfirmModal({
  open, title, message, confirmLabel, cancelLabel,
  danger = false, children, confirmDisabled = false, onConfirm, onCancel,
}: ConfirmModalProps) {
  // The defaults were Spanish literals, so a caller that left them out — the
  // order cancel box among them — said "Cancelar" to a rep reading English.
  const t = usePortT();
  if (!open) return null;

  return (
    <Dialog
      onClose={onCancel}
      title={title}
      icon={danger ? AlertTriangle : CircleHelp}
      tone={danger ? 'danger' : 'brand'}
      size="sm"
      footer={(
        <div className="flex gap-2.5">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>
            {cancelLabel ?? t('common.cancel', 'Cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} className="flex-1" onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel ?? t('common.confirm', 'Confirm')}
          </Button>
        </div>
      )}
    >
      <p className="text-[14px] font-body text-gray leading-relaxed">{message}</p>
      {children && <div className="mt-4">{children}</div>}
    </Dialog>
  );
}
