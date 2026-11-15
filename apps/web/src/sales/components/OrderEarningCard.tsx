import { Wallet } from 'lucide-react';
import type { RepOrderEarning } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useSalesT } from '../lib/i18n';
import { momentDay } from '../lib/periods';
import { EarningStatusPill } from '../lib/earnings';
import EarningBreakdown from './EarningBreakdown';
import { SectionTitle } from './ui';

/**
 * What the rep earns from this order (2026-10-28, user: "the rep will be able
 * to see his information on the orders too... Like his earnings from that
 * order... Rep will not be able to see the buying prices"). The whole
 * breakdown — products, the profit before and after the order's expenses,
 * their % and their share — as approved once it is (API lib/repEarnings), and
 * never a buying price: the API does not send one.
 */
export default function OrderEarningCard({ earning }: { earning: RepOrderEarning }) {
  const t = useSalesT();
  const lang = useLanguageStore((s) => s.lang);
  const e = earning;
  const ended = e.status === 'not_earned' || e.status === 'reversed';
  const status: Record<typeof e.status, string> = {
    draft: t('sales.earnings.order.draft'),
    expected: t('sales.earnings.order.expected'),
    awaiting_approval: t('sales.earnings.order.awaiting'),
    approved: e.approved_at ? t('sales.earnings.order.approved', { date: momentDay(e.approved_at, lang) }) : '',
    not_earned: t('sales.earnings.order.notEarned'),
    reversed: t('sales.earnings.order.reversed'),
  };

  return (
    <div className="bg-card rounded-2xl border border-border shadow-card p-5" aria-label={t('sales.earnings.order.title')}>
      <SectionTitle title={t('sales.earnings.order.title')} icon={Wallet} action={<EarningStatusPill status={e.status} />} />
      <EarningBreakdown
        sales={e.sales}
        gross={e.gross_profit}
        expenses={e.expenses}
        net={e.net_profit}
        percentage={e.percentage}
        earning={e.earning}
        struck={ended}
        basis={e.profit_basis}
      />
      {Number(e.net_profit) < 0 && !ended && (
        <p className="mt-2 text-[12.5px] text-gray">{t('sales.earnings.order.loss')}</p>
      )}
      <p className="mt-3 rounded-xl bg-surface-cream px-3.5 py-2.5 text-[13px] text-gray leading-snug">{status[e.status]}</p>
    </div>
  );
}
