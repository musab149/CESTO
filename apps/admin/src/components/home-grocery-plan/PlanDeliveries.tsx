import { useTranslation } from 'react-i18next';
import type { PlanDeliveryRow } from '@grocery-app/shared';
import StatusBadge from '@/components/StatusBadge';

/**
 * A plan delivery's status, as staff need to read it: a draft is "planned"
 * (it holds no stock and still follows the household's list), and a skip is
 * not a cancellation anybody has to look into.
 */
export function PlanDeliveryStatus({ status, cancelledReason }: {
  status: PlanDeliveryRow['status'];
  cancelledReason?: string | null;
}) {
  const { t } = useTranslation();
  if (status === 'draft') {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display bg-brand-whisper text-brand border border-brand/15">
        {t('hgPlan.status.planned', 'Planned')}
      </span>
    );
  }
  if (status === 'cancelled' && cancelledReason === 'Skipped') {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display bg-surface-linen text-gray">
        {t('hgPlan.status.skipped', 'Skipped')}
      </span>
    );
  }
  return <StatusBadge status={status} />;
}
