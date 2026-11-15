import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useChangeOrderSlot } from '@grocery-app/shared';
import { useToast } from '@/components/Toast';
import { PLAN_COPY, type Lang } from '../planCopy';
import PlanSlotPicker from './PlanSlotPicker';
import { addDays, madridToday, type SlotValue } from './planSlot';

/**
 * Move one Home Grocery order to another day or part of the day. The API
 * refuses once preparing has started, and that refusal is shown here, in the
 * dialog, rather than closing on the person.
 */
export default function ChangeSlotDialog({
  orderId, initial, preferredWeekday, lang, onClose,
}: {
  orderId: string;
  initial: SlotValue;
  preferredWeekday: number | null;
  lang: Lang;
  onClose: () => void;
}) {
  const c = PLAN_COPY[lang];
  const toast = useToast();
  const change = useChangeOrderSlot();
  // A day already past (or today) is not offered again: start from tomorrow.
  const tomorrow = addDays(madridToday(), 1);
  const [slot, setSlot] = useState<SlotValue>({
    ...initial,
    scheduled_for: initial.scheduled_for >= tomorrow ? initial.scheduled_for : tomorrow,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !change.isPending) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, change.isPending]);

  const save = () => change.mutate({ orderId, slot }, {
    onSuccess: () => { toast.success(c.slotSaved); onClose(); },
  });

  return (
    <div className="fixed inset-0 z-50 bg-veil/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => !change.isPending && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="slot-dialog-title"
        className="bg-card rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto p-5 sm:p-6 shadow-modal"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-5">
          <h3 id="slot-dialog-title" className="text-[19px] font-bold text-ink font-display">{c.changeSlot}</h3>
          <button type="button" onClick={onClose} aria-label={c.cancel}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-gray hover:bg-surface-linen">
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <PlanSlotPicker value={slot} onChange={setSlot} lang={lang} preferredWeekday={preferredWeekday} />
        {change.error && (
          <p role="alert" className="mt-4 rounded-lg bg-danger-bg border border-danger/25 px-4 py-3 text-[13px] text-danger font-body">
            {change.error instanceof Error ? change.error.message : c.loadError}
          </p>
        )}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" onClick={onClose} disabled={change.isPending}
            className="min-h-[52px] rounded-xl border border-border text-ink text-[15px] font-bold font-display hover:bg-surface-linen disabled:opacity-50">
            {c.cancel}
          </button>
          <button type="button" onClick={save} disabled={change.isPending}
            className="min-h-[52px] rounded-xl bg-brand text-white text-[15px] font-bold font-display hover:bg-brand-mid disabled:opacity-50">
            {change.isPending ? c.saving : c.save}
          </button>
        </div>
      </div>
    </div>
  );
}
