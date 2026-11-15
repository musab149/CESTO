import { useNavigate } from 'react-router-dom';
import { Clock, Star, CheckCircle2 } from 'lucide-react';
import { resolveImageUrl } from '@grocery-app/shared';
import type { Store } from '@grocery-app/shared';
import { bannerWash, logoPlate } from '@/lib/logoPlate';

/** 2300 → "2.3K+", 12500 → "13K+", 890 → "890+" — matches the Top Shops rail. */
function formatShopCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K+`;
  }
  return `${n}+`;
}

/**
 * The pill on a shop card.
 *
 * This used to read "30–45 min" or "45–60 min" — two windows nobody measures
 * and nothing in the system promises. `fast_delivery` is a real per-shop flag
 * an admin sets, so the pill now says that and nothing more.
 */
export function deliveryLabel(fast: boolean, lang: 'es' | 'en'): string {
  if (fast) return lang === 'es' ? 'Entrega rápida' : 'Fast delivery';
  return lang === 'es' ? 'A domicilio' : 'Home delivery';
}

/** Static fallback tag row — mirrors the Top Shops card so the two rails stay
 *  visually identical. When the schema grows a per-store tag list, swap it in. */
const STORE_CARD_TAGS_EN = ['Grocery', 'Fresh Food', 'Daily Essentials', 'Spices', 'Snacks'];
const STORE_CARD_TAGS_ES = ['Comestibles', 'Comida fresca', 'Básicos', 'Especias', 'Snacks'];

export interface StoreCardStore extends Store {
  /** Optional `_count.products` from the admin/list payload. */
  _count?: { products: number };
}

interface Props {
  store: StoreCardStore;
  lang: 'en' | 'es';
  /** Optional click override — defaults to `/stores/:slug`. */
  onClick?: () => void;
}

/**
 * Storefront-ready card matching the home "Top Shops" design. Used by both
 * the homepage row and the /stores directory grid so the two feel like the
 * same product surface.
 */
export default function StoreCard({ store, lang, onClick }: Props) {
  const navigate = useNavigate();
  const logoSrc = store.logo_url ? resolveImageUrl(store.logo_url, 'logo') : null;
  const coverSrc = store.cover_url ? resolveImageUrl(store.cover_url, 'tile') : null;
  const delivery = deliveryLabel(store.fast_delivery, lang);
  const reviewsLabel = lang === 'en' ? 'reviews' : 'reseñas';
  const allTags = lang === 'en' ? STORE_CARD_TAGS_EN : STORE_CARD_TAGS_ES;
  const visibleTags = allTags.slice(0, 3);
  const initials = store.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const handleClick = () => {
    if (onClick) onClick();
    else navigate(`/stores/${store.slug}`);
  };

  return (
    <div
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') handleClick(); }}
      className="relative w-full rounded-[14px] md:rounded-[18px] border border-border/70 bg-card overflow-hidden cursor-pointer hover:border-brand/50 hover:shadow-card transition-all"
    >
      {/* Banner — shorter now so the card leans more on the body content.
          Falls back to a store-tinted gradient when no cover image. */}
      <div
        className="relative h-[70px] md:h-[100px]"
        style={{
          background: coverSrc
            ? undefined
            : bannerWash(store.logo_bg),
        }}
      >
        {coverSrc && (
          <img
            src={coverSrc}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
        )}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 70%)' }}
        />

        {/* Delivery pill — lives on the cover at all breakpoints now. Slightly
            larger from md up so the desktop card doesn't feel too spare. */}
        <div className="absolute top-1.5 md:top-2 right-1.5 md:right-2 inline-flex items-center gap-1 md:gap-1.5 bg-white/95 backdrop-blur-sm rounded-full px-2 md:px-2.5 py-0.5 md:py-1 shadow-[0_1px_3px_rgba(15,23,42,0.18)]">
          <Clock size={10} strokeWidth={2.25} className="md:hidden text-amber-deep" />
          <Clock size={12} strokeWidth={2.25} className="hidden md:inline text-amber-deep" />
          <span className="text-[10px] md:text-[11.5px] font-bold text-amber-deep tracking-tight tabular-nums">{delivery}</span>
        </div>
      </div>

      {/* Floating circular logo — top values recomputed so the half-overlap
          still lands on the shorter cover (mobile: 70→48, desktop: 100→68). */}
      <div
        className={`${logoPlate(store.logo_bg).className} absolute left-2.5 md:left-4 w-11 h-11 md:w-16 md:h-16 rounded-full border-2 md:border-[3px] border-card overflow-hidden flex items-center justify-center shadow-[0_2px_4px_rgba(15,23,42,0.12)] top-[48px] md:top-[68px]`}
        style={logoPlate(store.logo_bg).style}
      >
        {logoSrc ? (
          <img
            src={logoSrc}
            alt={store.name}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <span className="font-ui text-[12px] md:text-[16px] font-extrabold text-brand tracking-wider">
            {initials}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-3 md:px-4 pt-6 md:pt-10 pb-3 md:pb-3.5">
        <h3 className="font-ui text-[13.5px] md:text-[17px] font-bold text-ink tracking-tight truncate flex items-center gap-1">
          <span className="truncate">{store.name}</span>
          {store.is_verified && (
            <CheckCircle2 size={13} strokeWidth={2.25} className="text-brand shrink-0" />
          )}
        </h3>

        {/* Rating row — delivery pill is on the cover now, so the row can
            focus on rating + review count and breathe a little more. */}
        <div className="mt-1.5 md:mt-2 flex items-center gap-1 md:gap-1.5 min-w-0">
          <Star size={11} strokeWidth={2} className="md:hidden text-amber-deep fill-amber-deep" />
          <Star size={14} strokeWidth={2} className="hidden md:inline text-amber-deep fill-amber-deep" />
          <span className="text-[11.5px] md:text-[13px] font-bold text-ink tabular-nums">
            {store.rating != null ? store.rating.toFixed(1) : '—'}
          </span>
          <span className="text-[10.5px] md:text-[12px] text-muted truncate">
            ({formatShopCount(store.rating_count)} {reviewsLabel})
          </span>
        </div>

        {/* Tag row — hidden on mobile to save vertical space */}
        <div className="hidden md:flex mt-3 flex-wrap gap-1.5">
          {visibleTags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-border bg-surface-linen px-2.5 py-1 text-[11px] font-semibold text-gray"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
