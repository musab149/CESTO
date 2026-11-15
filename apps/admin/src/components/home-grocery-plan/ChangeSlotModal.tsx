import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminChangeOrderSlot, type DeliveryWindow } from '@grocery-app/shared';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';
import PlanSlotFields, { type SlotValue } from './PlanSlotFields';
import { dayOf, madridToday } from './planFormat';

/**
 * Move a Home Grocery order to another day or part of the day. The API
 * refuses once preparing has started; the refusal stays in the modal.
 */
export default function ChangeSlotModal({ orderId, scheduledFor, deliveryWindow, preferredWeekday, onClose }: {
  orderId: string;
  scheduledFor: string | null;
  deliveryWindow: DeliveryWindow | null | undefined;
  preferredWeekday: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const change = useAdminChangeOrderSlot();
  const today = madridToday();
  const current = dayOf(scheduledFor);
  const [slot, setSlot] = useState<SlotValue>({
    scheduled_for: current && current >= today ? current : today,
    delivery_window: deliveryWindow ?? null,
  });

  const save = () => change.mutate({ orderId, slot }, {
    onSuccess: () => { toast.success(t('hgSlot.saved', 'Day and time changed')); onClose(); },
  });

  return (
    <ConfirmModal
      open
      title={t('hgSlot.changeTitle', 'Change day and time')}
      message={t('hgSlot.changeBody', 'Their order page shows the new day and time. It can move until preparing starts.')}
      confirmLabel={change.isPending ? t('hgPlan.saving', 'Saving…') : t('hgSlot.save', 'Save')}
      confirmDisabled={change.isPending}
      onConfirm={save}
      onCancel={() => !change.isPending && onClose()}
    >
      <PlanSlotFields value={slot} onChange={setSlot} preferredWeekday={preferredWeekday} compact />
      {change.error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-[12.5px] text-danger font-display">
          {change.error instanceof Error ? change.error.message : t('hgPlan.failed', 'That did not go through.')}
        </p>
      )}
    </ConfirmModal>
  );
}
