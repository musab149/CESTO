import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useBusinessStores } from '@grocery-app/shared';
import { StoreCard, StoreCardSkeleton } from '@/sales/components/catalogue/Browse';
import { HOUSE } from '@/sales/components/catalogue/data';
import { useBizT } from '../../lib/i18n';

/*
 * The shops a business can buy from, as a row on its home (2026-10-31): the
 * catalogue's own shop cards — Cesto first, then every shop with something at
 * a business price — each opening that shop's products. A swipe on a phone,
 * a scroll on a computer.
 */
export function ShopsStrip() {
  const t = useBizT();
  const navigate = useNavigate();
  const { data, isLoading } = useBusinessStores();
  const shops = (data?.items ?? []).filter((s) => s.products > 0);
  if (!isLoading && shops.length === 0 && !(data?.house.products)) return null;
  const open = (id: string) => navigate(`/business/catalogue/stores/${id}`);
  const CARD = 'snap-start shrink-0 w-[78%] sm:w-[300px]';

  return (
    <section aria-labelledby="biz-shops">
      <div className="flex items-end justify-between gap-3 mb-2.5 px-0.5">
        <div className="min-w-0">
          <h2 id="biz-shops" className="text-[18px] lg:text-[20px] font-bold font-display text-white leading-tight">{t('biz.shops.title')}</h2>
          <p className="text-[13px] text-white/70 mt-0.5">{t('biz.shops.sub')}</p>
        </div>
        <button type="button" onClick={() => navigate('/business/catalogue')} className="shrink-0 inline-flex items-center gap-1 h-9 px-1 text-[13.5px] font-semibold font-display text-white hover:underline">
          {t('biz.rail.seeAll')}
          <ArrowRight size={15} strokeWidth={2} />
        </button>
      </div>
      {/* relative: the row is what clips its cards — an absolutely placed piece inside one would otherwise escape it and widen the page.
          scroll-px: the cards snap to the page's gutter, not the screen's edge. */}
      <ul className="relative -mx-4 px-4 scroll-px-4 sm:-mx-6 sm:px-6 sm:scroll-px-6 lg:mx-0 lg:px-0 lg:scroll-px-0 flex gap-3 lg:gap-3.5 overflow-x-auto hide-scrollbar snap-x snap-mandatory pb-1">
        {isLoading ? (
          Array.from({ length: 3 }, (_, i) => <li key={i} className={CARD}><StoreCardSkeleton /></li>)
        ) : (
          <>
            {(data?.house.products ?? 0) > 0 && (
              <li className={CARD}><StoreCard id={HOUSE} house name={t('biz.house')} count={data!.house.products} onOpen={() => open(HOUSE)} /></li>
            )}
            {shops.map((s) => (
              <li key={s.id} className={CARD}>
                <StoreCard id={s.id} name={s.name} cover={s.cover_url} logo={s.logo_url} logoBg={s.logo_bg} hours={s.shop_hours} count={s.products} onOpen={() => open(s.id)} />
              </li>
            ))}
          </>
        )}
      </ul>
    </section>
  );
}
