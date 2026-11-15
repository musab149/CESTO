import { useNavigate } from 'react-router-dom';
import { Loader2, MessageCircle, Package, Receipt, RotateCcw } from 'lucide-react';
import { useBizT } from '../../lib/i18n';
import ReorderButton from '../ReorderButton';

/*
 * What a buyer comes to the home to do, one tap each (2026-10-31): create an
 * order, order the last one again (only once one has been delivered), their
 * orders, and a word with Cesto. Four in a row at every width — a phone's
 * shortcuts, a computer's buttons.
 */

// Icon over words at every width: a quarter of the row is too narrow for both side by side.
const TILE = 'group w-full h-full min-h-[84px] rounded-2xl border p-2.5 sm:p-4 flex flex-col items-center sm:items-start gap-2 sm:gap-3 text-center sm:text-left transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-card-hover active:scale-[0.98] motion-reduce:transition-none';
const ICON = 'w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110 motion-reduce:transition-none';

function Body({ label, sub }: { label: string; sub: string }) {
  return (
    <span className="min-w-0">
      <span className="block text-[12px] sm:text-[14.5px] font-semibold font-display leading-tight">{label}</span>
      <span className="hidden sm:block mt-0.5 text-[12px] text-muted leading-snug line-clamp-2">{sub}</span>
    </span>
  );
}

export function QuickActions({ lastDeliveredId, inProgress }: { lastDeliveredId: string | null; inProgress: number }) {
  const t = useBizT();
  const navigate = useNavigate();
  return (
    <nav aria-label={t('biz.quick.label')}>
      <ul className="grid grid-cols-4 gap-2 sm:gap-3">
        <li>
          <button type="button" onClick={() => navigate('/business/catalogue')} className={`${TILE} bg-card border-brand/50 text-ink shadow-[0_12px_26px_-14px_rgba(4,18,58,0.6)]`}>
            <span className={`${ICON} bg-brand text-white`}><Package size={20} strokeWidth={1.9} /></span>
            <Body label={t('biz.nav.startOrder')} sub={t('biz.quick.createSub')} />
          </button>
        </li>
        <li>
          {lastDeliveredId ? (
            <ReorderButton orderId={lastDeliveredId} className={`${TILE} bg-card border-border text-ink disabled:opacity-60`}>
              {(busy) => (
                <>
                  <span className={`${ICON} bg-st-emerald-tile text-st-emerald-fg`}>
                    {busy ? <Loader2 size={20} className="animate-spin" /> : <RotateCcw size={20} strokeWidth={1.9} />}
                  </span>
                  <Body label={t('biz.quick.again')} sub={t('biz.quick.againSub')} />
                </>
              )}
            </ReorderButton>
          ) : (
            <button type="button" onClick={() => navigate('/business/catalogue/all?sort=newest')} className={`${TILE} bg-card border-border text-ink`}>
              <span className={`${ICON} bg-st-emerald-tile text-st-emerald-fg`}><RotateCcw size={20} strokeWidth={1.9} /></span>
              <Body label={t('biz.quick.new')} sub={t('biz.quick.newSub')} />
            </button>
          )}
        </li>
        <li>
          <button type="button" onClick={() => navigate('/business/orders')} className={`${TILE} bg-card border-border text-ink`}>
            <span className={`${ICON} bg-st-violet-tile text-st-violet-fg`}><Receipt size={20} strokeWidth={1.9} /></span>
            <Body
              label={t('biz.quick.orders')}
              sub={inProgress > 0 ? t(inProgress === 1 ? 'biz.quick.ordersSub_one' : 'biz.quick.ordersSub_other', { count: inProgress }) : t('biz.quick.ordersNone')}
            />
          </button>
        </li>
        <li>
          <button type="button" onClick={() => window.open('/contact', '_blank', 'noopener')} className={`${TILE} bg-card border-border text-ink`}>
            <span className={`${ICON} bg-st-amber-tile text-st-amber-fg`}><MessageCircle size={20} strokeWidth={1.9} /></span>
            <Body label={t('biz.quick.contact')} sub={t('biz.quick.contactSub')} />
          </button>
        </li>
      </ul>
    </nav>
  );
}
