import { useTranslation } from 'react-i18next';
import type { RepEarningStatus } from '@grocery-app/shared';

/** Where an order's earning stands (API lib/repEarnings). */
const STATUS_STYLE: Record<RepEarningStatus, string> = {
  draft: 'bg-surface-cream text-gray',
  expected: 'bg-brand-mist text-brand',
  awaiting_approval: 'bg-warning-bg text-warning',
  approved: 'bg-success-bg text-success',
  not_earned: 'bg-surface-cream text-gray',
  reversed: 'bg-danger-bg text-danger',
};

export default function EarningStatusChip({ status }: { status: RepEarningStatus }) {
  const { t } = useTranslation();
  const label: Record<RepEarningStatus, string> = {
    draft: t('orderDetail.repEarning.status.draft', 'Draft'),
    expected: t('orderDetail.repEarning.status.expected', 'Expected'),
    awaiting_approval: t('orderDetail.repEarning.status.awaiting_approval', 'To approve'),
    approved: t('orderDetail.repEarning.status.approved', 'Approved'),
    not_earned: t('orderDetail.repEarning.status.not_earned', 'Not earned'),
    reversed: t('orderDetail.repEarning.status.reversed', 'Taken back'),
  };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide whitespace-nowrap ${STATUS_STYLE[status]}`}>{label[status]}</span>;
}
