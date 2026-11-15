import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { BusinessProduct } from '@grocery-app/shared';
import { ProductCard, ProductCardSkeleton } from '../catalogue';

/*
 * A row of the catalogue's own cards on the home (2026-10-31): "what you
 * order most" and "new in your catalogue". The same card as the catalogue —
 * the size on it, "+" adding to the cart there and then — so reordering is a
 * tap from the home. A swipe on a phone; on a computer the first four, then
 * six, with "see all" for the rest.
 */
export function ProductRail({ id, title, subtitle, products, loading, lang, seeAll, seeAllLabel }: {
  id: string;
  title: string;
  subtitle: string;
  products: BusinessProduct[];
  loading: boolean;
  lang: 'es' | 'en';
  seeAll?: string;
  seeAllLabel?: string;
}) {
  const navigate = useNavigate();
  if (!loading && products.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <div className="flex items-end justify-between gap-3 mb-2.5 px-0.5">
        <div className="min-w-0">
          <h2 id={id} className="text-[18px] lg:text-[20px] font-bold font-display text-white leading-tight">{title}</h2>
          <p className="text-[13px] text-white/70 mt-0.5">{subtitle}</p>
        </div>
        {seeAll && seeAllLabel && (
          <button
            type="button"
            onClick={() => navigate(seeAll)}
            className="shrink-0 inline-flex items-center gap-1 h-9 px-1 text-[13.5px] font-semibold font-display text-white hover:underline"
          >
            {seeAllLabel}
            <ArrowRight size={15} strokeWidth={2} />
          </button>
        )}
      </div>
      {/* scroll-px: the cards snap to the page's gutter, not the screen's edge. */}
      <ul className="relative -mx-4 px-4 scroll-px-4 sm:-mx-6 sm:px-6 sm:scroll-px-6 md:mx-0 md:px-0 md:scroll-px-0 flex gap-3 overflow-x-auto hide-scrollbar snap-x snap-mandatory md:grid md:grid-cols-4 xl:grid-cols-6 md:overflow-visible md:gap-3.5">
        {loading
          ? Array.from({ length: 6 }, (_, i) => (
            <li key={i} className={`shrink-0 w-[44%] sm:w-[31%] md:w-auto ${i >= 4 ? 'md:hidden xl:block' : ''}`}>
              <ProductCardSkeleton />
            </li>
          ))
          : products.map((p, i) => (
            <li key={p.id} className={`snap-start shrink-0 w-[44%] sm:w-[31%] md:w-auto ${i >= 6 ? 'md:hidden' : i >= 4 ? 'md:hidden xl:block' : ''}`}>
              <ProductCard product={p} lang={lang} showShop onOpen={() => navigate(`/business/products/${p.id}`)} />
            </li>
          ))}
      </ul>
    </section>
  );
}
