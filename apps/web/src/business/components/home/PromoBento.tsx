import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Tag } from 'lucide-react';
import { resolveImageUrl, type BusinessPromotion } from '@grocery-app/shared';
import { useBizT } from '../../lib/i18n';
import { CANVAS, pick, type Lang } from '../../lib/homeLook';

/*
 * The promotions as a bento (2026-10-31, user: "some other promotional bento
 * grids"): the first one the team lists is the big tile, the rest fill around
 * it by how many there are, so any count from one to eight closes into whole
 * rows — on a phone (two columns) and a computer (four). The tiles come in
 * one after another the first time the grid scrolls into view; on a computer
 * a soft light follows the pointer across a tile and its photo leans closer.
 */

type Size = 'full' | 'half' | 'feature' | 'wide' | 'small';

/** Sizes by count: every pattern closes its rows at both widths. */
const PATTERNS: Record<number, Size[]> = {
  1: ['full'],
  2: ['half', 'half'],
  3: ['feature', 'wide', 'wide'],
  4: ['feature', 'wide', 'small', 'small'],
  5: ['feature', 'small', 'small', 'small', 'small'],
  6: ['feature', 'wide', 'small', 'small', 'wide', 'wide'],
  7: ['feature', 'small', 'small', 'small', 'small', 'wide', 'wide'],
  8: ['feature', 'wide', 'small', 'small', 'small', 'small', 'small', 'small'],
};

/** Where each size sits: two columns on a phone, four from lg; rows of 150 / 172 px. */
const SPAN: Record<Size, string> = {
  full: 'col-span-2 lg:col-span-4 row-span-2',
  half: 'col-span-2 row-span-2',
  feature: 'col-span-2 row-span-2',
  wide: 'col-span-2 row-span-1',
  small: 'col-span-1 row-span-1',
};

export function PromoBento({ promotions, lang, onOpen }: { promotions: BusinessPromotion[]; lang: Lang; onOpen: (link: string) => void }) {
  const t = useBizT();
  const ref = useRef<HTMLUListElement>(null);
  // A browser that cannot tell when it is in view just shows them.
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined');
  const list = promotions.slice(0, 8);
  const sizes = PATTERNS[list.length] ?? PATTERNS[8];

  // Into view once: the tiles come in, then stay.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); }
    }, { rootMargin: '0px 0px -10% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section aria-labelledby="biz-promos">
      <div className="mb-3 px-0.5">
        <h2 id="biz-promos" className="text-[18px] lg:text-[20px] font-bold font-display text-white leading-tight">{t('biz.promos.title')}</h2>
        <p className="text-[13px] text-white/70 mt-0.5">{t('biz.promos.sub')}</p>
      </div>
      <ul ref={ref} className={`grid grid-cols-2 lg:grid-cols-4 auto-rows-[150px] lg:auto-rows-[172px] gap-3 lg:gap-3.5 ${shown ? 'biz-bento-in' : ''}`}>
        {list.map((p, i) => (
          <li key={p.id} className={`biz-bento-tile ${SPAN[sizes[i]]}`} style={{ ['--i' as string]: i }}>
            <Tile promo={p} size={sizes[i]} lang={lang} onOpen={onOpen} openLabel={t('biz.home.promoOpen')} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tile({ promo, size, lang, onOpen, openLabel }: { promo: BusinessPromotion; size: Size; lang: Lang; onOpen: (link: string) => void; openLabel: string }) {
  const [broken, setBroken] = useState(false);
  const big = size === 'feature' || size === 'full' || size === 'half';
  const small = size === 'small';
  const badge = pick(promo, 'badge', lang);
  const body = pick(promo, 'body', lang);
  const img = promo.image_url && !broken ? promo.image_url : null;

  /** The light under the pointer: two custom properties, no re-render. */
  const follow = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  };

  const inner = (
    <>
      <span className={`absolute inset-0 bg-gradient-to-br ${CANVAS[promo.tone] ?? CANVAS.blue}`}>
        {!img && (
          <Tag aria-hidden="true" size={big ? 220 : 140} strokeWidth={1} className="absolute -right-8 -bottom-10 text-white/[0.12] rotate-[-12deg]" />
        )}
      </span>
      {img && (
        <img
          src={resolveImageUrl(img, big ? 'banner' : 'card')}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setBroken(true)}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05] motion-reduce:transition-none"
        />
      )}
      {img && <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(to_top,rgba(6,12,28,0.88)_0%,rgba(6,12,28,0.45)_45%,rgba(6,12,28,0)_75%)]" />}
      {/* the light that follows the pointer */}
      <span aria-hidden="true" className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-[radial-gradient(360px_circle_at_var(--mx,50%)_var(--my,50%),rgba(255,255,255,0.16),transparent_45%)]" />

      {badge && (
        <span className={`absolute left-3 top-3 h-7 px-2.5 rounded-full bg-white text-ink font-bold font-display inline-flex items-center shadow-[0_6px_14px_-6px_rgba(0,0,0,0.45)] ${big ? 'text-[13.5px]' : 'text-[12px]'}`}>
          {badge}
        </span>
      )}
      <span className={`absolute inset-x-0 bottom-0 flex items-end gap-3 text-white ${big ? 'p-5 lg:p-6' : 'p-3.5 lg:p-4'}`}>
        <span className="min-w-0 flex-1">
          <span className={`block font-bold font-display leading-[1.1] tracking-[-0.01em] ${big ? 'text-[24px] lg:text-[30px] line-clamp-3' : small ? 'text-[14.5px] line-clamp-3' : 'text-[18px] lg:text-[20px] line-clamp-2'}`}>
            {pick(promo, 'title', lang)}
          </span>
          {body && !small && (
            <span className={`block mt-1.5 text-white/85 leading-snug ${big ? 'text-[14px] lg:text-[15px] line-clamp-2' : 'text-[12.5px] line-clamp-1'}`}>{body}</span>
          )}
          {big && promo.link && (
            <span className="mt-3.5 inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white text-brand text-[14px] font-semibold font-display transition-transform group-hover:translate-x-0.5">
              {openLabel}
              <ArrowRight size={16} strokeWidth={2} />
            </span>
          )}
        </span>
        {!big && promo.link && (
          <span aria-hidden="true" className="w-8 h-8 rounded-full bg-white/20 backdrop-blur flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:rotate-45">
            <ArrowUpRight size={16} strokeWidth={2} />
          </span>
        )}
      </span>
    </>
  );
  const cls = 'group relative block w-full h-full overflow-hidden rounded-2xl text-left shadow-card isolate';
  return promo.link ? (
    <button type="button" onClick={() => onOpen(promo.link)} onPointerMove={follow} className={`${cls} transition-transform duration-300 hover:-translate-y-0.5 active:scale-[0.99] motion-reduce:transition-none`}>
      {inner}
    </button>
  ) : (
    <div onPointerMove={follow} className={cls}>{inner}</div>
  );
}
