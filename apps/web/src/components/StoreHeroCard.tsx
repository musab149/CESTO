import {
  Clock, BadgeCheck, ShoppingBasket,
  Plus, Check, Share2, Bike,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { resolveImageUrl, useStoreSettings } from '@grocery-app/shared';
import type { Store, ShopHours, ShopHoursDay } from '@grocery-app/shared';
import { bannerWash } from '@/lib/logoPlate';

interface Props {
  store: Store & { _count?: { products: number } };
  lang: 'en' | 'es';
  isFollowed: boolean;
  onFollow: (e: React.MouseEvent) => void;
  followPending?: boolean;
  onShare: (e: React.MouseEvent) => void;
  /** Optional — provided by the grid card so the whole surface navigates
   *  to `/stores/:slug`. Omit on the store detail page (already there). */
  onClick?: () => void;
  /** Explicit product count — the grid card passes `_count.products` on
   *  the store object; the detail page uses `store.products_count` and
   *  should pass it here instead. Kept for API compat even though the new
   *  design doesn't surface the count. */
  productCount?: number;
  className?: string;
}

function deliveryLabel(fast: boolean, lang: 'es' | 'en'): string {
  if (fast) return lang === 'es' ? 'Entrega rápida' : 'Fast delivery';
  return lang === 'es' ? 'A domicilio' : 'Home delivery';
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function formatHourLabel(hhmm: string): string {
  const [hRaw, mRaw] = hhmm.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`;
}

function todaysOpenLabel(hours: ShopHours | null): string | null {
  if (!hours) return null;
  const day = hours[DAY_KEYS[new Date().getDay()]] as ShopHoursDay | undefined;
  if (!day || day.closed) return null;
  return formatHourLabel(day.open);
}

/**
 * The card printed five cells and invented three of them: a €5 minimum order
 * (there is no minimum), a €2.50 delivery fee, and "free over €50" — which
 * contradicted the real freeDeliveryMin on every shop it was shown for. A
 * fourth, distance, was hardcoded null and always rendered an em dash.
 *
 * Only what the system knows is shown now. Delivery and free-over are
 * platform-wide settings rather than per-shop columns, so they come from
 * useStoreSettings, and a cell is dropped when there is nothing true to put
 * in it. When Prisma gains real per-store min_order_amount / delivery_fee,
 * add them back as cells of their own. Mirrors apps/mobile's StoreHeroCard,
 * so the two cards do not disagree.
 */
type Cell = { icon: LucideIcon; value: string; label: string };

/** Info-row cell — stacked icon / value / label. */
function InfoCell({
  icon: Icon, value, label,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
}) {
  return (
    <div className="flex-1 min-w-0 px-1 py-0.5 text-center">
      <Icon size={13} strokeWidth={2} className="text-brand mx-auto" />
      <div className="text-[11px] sm:text-[12px] font-bold text-ink tabular-nums leading-none mt-0.5 truncate">{value}</div>
      <div className="text-[9px] sm:text-[10px] font-ui text-muted leading-tight mt-0.5 truncate">{label}</div>
    </div>
  );
}

/**
 * Marketplace-style store card matching the Shaiekh Cash & Carry mockup.
 *
 *   ┌─── Cover (aspect-3/1) ─────────────────────┐
 *   │  [Delivery pill]                            │  ← top-left only
 *   └─────────────────────────────────────────────┘
 *   ┌─── Blue section (wraps everything below) ──┐
 *   │  Store Name ✓                                │
 *   │  ┌─── Nested white card ────────────────┐   │
 *   │  │ [🕐][🚲][🚚]                             │   │ ← the cells we can answer
 *   │  │ [ + Follow Store ] [ Share Store ]      │   │ ← 2-col button row below
 *   │  └─────────────────────────────────────────┘   │
 *   └────────────────────────────────────────────────┘
 *
 * Blue frames the white card on all four sides. The info cells span the full
 * row and Follow / Share are a 2-col button row directly under them — no
 * icons on the cover. How many cells there are depends on what the settings
 * actually say; see the Cell type above.
 */
function formatCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K`;
  }
  return `${n}`;
}

export default function StoreHeroCard({
  store, lang, isFollowed, onFollow, followPending, onShare, onClick,
  productCount: productCountProp, className,
}: Props) {
  const coverSrc = store.cover_url ? resolveImageUrl(store.cover_url, 'hero') : null;
  const productCount = productCountProp ?? store._count?.products ?? 0;
  const opensAt = todaysOpenLabel(store.shop_hours);
  const { data: settings } = useStoreSettings();
  const t = (en: string, es: string) => (lang === 'en' ? en : es);

  const clickable = Boolean(onClick);

  const money = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)}€`;

  const cells: Cell[] = [];
  if (opensAt) cells.push({ icon: Clock, value: opensAt, label: t('Open From', 'Abre') });
  // In distance mode there is no single fee to quote — it is worked out from
  // the address at checkout, so naming one here would be a guess.
  if (settings && settings.deliveryPricingMode !== 'distance' && settings.deliveryFee > 0) {
    cells.push({ icon: Bike, value: money(settings.deliveryFee), label: t('Delivery', 'Envío') });
  }

  return (
    <article
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onClick?.(); } : undefined}
      className={`group relative bg-card rounded-2xl border border-border/60 overflow-hidden transition-all duration-200 ${
        clickable ? 'cursor-pointer hover:border-brand/40 hover:shadow-card' : ''
      } ${className ?? ''}`}
    >
      {/* Cover — clean; only the delivery pill top-left.
          Fixed h-28 below sm to match the storefront's own cover band, which
          is h-28 there. Under aspect-[8/3] a full-width card on a phone came
          out around 123px against the storefront's 112px, so the same store
          changed shape between the grid and its own page. The ratio takes
          over from sm, where cards are narrower and it holds. */}
      <div
        className="relative h-28 sm:h-auto sm:aspect-[8/3] overflow-hidden"
        style={{
          background: coverSrc
            ? undefined
            : bannerWash(store.logo_bg, 'var(--color-brand-mist)', 'var(--color-brand-whisper)'),
        }}
      >
        {coverSrc && (
          <img
            src={coverSrc}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            draggable={false}
          />
        )}

        <div className="absolute top-2 left-2 inline-flex items-center gap-1 bg-white/95 backdrop-blur-sm rounded-full pl-1.5 pr-2 py-0.5 shadow-[0_1px_4px_rgba(15,23,42,0.15)]">
          <Clock size={10} strokeWidth={2.25} className="text-brand" />
          <span className="text-[10px] font-bold text-ink tracking-tight tabular-nums">
            {deliveryLabel(store.fast_delivery, lang)}
          </span>
        </div>

        {/* Product count pill — top-right */}
        <div className="absolute top-2 right-2 inline-flex items-center gap-1 bg-white/95 backdrop-blur-sm rounded-full pl-1.5 pr-2 py-0.5 shadow-[0_1px_4px_rgba(15,23,42,0.15)]">
          <ShoppingBasket size={10} strokeWidth={2.25} className="text-brand" />
          <span className="text-[10px] font-bold text-ink tracking-tight tabular-nums">
            {formatCount(productCount)}+ {t('products', 'productos')}
          </span>
        </div>
      </div>

      {/* Blue section — title, then the nested white card carrying info +
          Follow / Share buttons. Blue is visible around all four sides. */}
      <div className="bg-brand px-3 sm:px-4 pt-2.5 pb-3">
        <div className="flex items-center gap-1.5 min-w-0 pb-2.5">
          <h3 className="font-display text-[15px] sm:text-[17px] lg:text-[19px] font-bold text-white tracking-tight leading-tight truncate">
            {store.name}
          </h3>
          {store.is_verified && (
            <BadgeCheck size={16} strokeWidth={2} className="text-white shrink-0" />
          )}
        </div>

        {/* Nested white card — the info cells the system can answer, then
            Follow + Share buttons in a 2-col row directly below. */}
        <div className="bg-card rounded-xl px-2 py-1.5 space-y-1.5">
          {cells.length > 0 && (
            <div className="flex items-stretch divide-x divide-border/60">
              {cells.map((cell) => (
                <InfoCell key={cell.label} icon={cell.icon} value={cell.value} label={cell.label} />
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onFollow}
              disabled={followPending}
              aria-pressed={isFollowed}
              className={`h-9 inline-flex items-center justify-center gap-1.5 rounded-lg text-[12px] sm:text-[13px] font-bold font-ui transition-colors disabled:opacity-70 disabled:cursor-wait ${
                isFollowed
                  ? 'bg-brand-mist text-brand border border-brand/30'
                  : 'bg-brand text-white hover:bg-brand-deepest'
              }`}
            >
              {isFollowed ? (
                <>
                  <Check size={13} strokeWidth={2.5} />
                  {t('Following', 'Siguiendo')}
                </>
              ) : (
                <>
                  <Plus size={13} strokeWidth={2.5} />
                  {t('Follow Store', 'Seguir tienda')}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onShare}
              className="h-9 inline-flex items-center justify-center gap-1.5 rounded-lg bg-card text-brand border border-brand/40 hover:border-brand hover:bg-brand-whisper text-[12px] sm:text-[13px] font-bold font-ui transition-colors"
            >
              <Share2 size={13} strokeWidth={2.5} />
              {t('Share Store', 'Compartir')}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
