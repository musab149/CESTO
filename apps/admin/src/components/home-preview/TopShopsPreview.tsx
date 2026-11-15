import type { TopShopsConfig, TopShop } from '@grocery-app/shared';
import { resolveImageUrl } from '@grocery-app/shared';
import { Star, Clock } from 'lucide-react';

interface Props {
  config: TopShopsConfig;
}

function formatShopCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K+`;
  }
  return `${n}+`;
}

const SHOP_CARD_TAGS = ['Grocery', 'Fresh Food', 'Daily Essentials', 'Spices', 'Snacks'];

/**
 * Pixel-mirror of the customer "Top Shops" card row
 * (apps/web/src/pages/HomePage.tsx → TopShopCard).
 * Driven by the live admin form state.
 */
export default function TopShopsPreview({ config }: Props) {
  const shops = config.shops
    .filter((s) => s.is_active)
    .sort((a, b) => a.display_order - b.display_order);

  if (shops.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-gray font-display">
        No active shops yet. Add a shop from the editor to see it here.
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto hide-scrollbar pb-1">
      {shops.map((shop) => (
        <ShopTile key={shop.id} shop={shop} />
      ))}
    </div>
  );
}

function ShopTile({ shop }: { shop: TopShop }) {
  const delivery = shop.fast_delivery ? '30–45 min' : '45–60 min';
  const visibleTags = SHOP_CARD_TAGS.slice(0, 3);
  const initials = shop.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative w-[290px] shrink-0 rounded-[18px] border border-border/70 bg-card overflow-hidden">
      <div
        className="relative h-[130px]"
        style={{ background: 'linear-gradient(135deg, #1F4A29 0%, #3A7A3B 50%, #5FA133 100%)' }}
      >
        {shop.cover_url && (
          <img
            src={resolveImageUrl(shop.cover_url, 'tile') ?? undefined}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
        )}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 70%)' }}
        />
      </div>

      <div
        className="absolute left-4 w-16 h-16 rounded-full border-[3px] border-card overflow-hidden flex items-center justify-center shadow-[0_2px_4px_rgba(15,23,42,0.12)]"
        style={{ top: 130 - 32, background: shop.logo_bg || '#FFFFFF' }}
      >
        {shop.logo_url ? (
          <img
            src={resolveImageUrl(shop.logo_url, 'logo') ?? undefined}
            alt={shop.name}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <span className="font-display text-[16px] font-extrabold text-brand tracking-wider">
            {initials}
          </span>
        )}
      </div>

      <div className="px-4 pt-10 pb-3.5">
        <h3 className="font-display text-[17px] font-bold text-ink tracking-tight truncate">
          {shop.name}
        </h3>

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 shrink">
            <Star size={14} strokeWidth={2} className="text-amber-deep fill-amber-deep" />
            <span className="text-[13px] font-bold text-ink tabular-nums">{shop.rating.toFixed(1)}</span>
            <span className="text-[12px] text-muted truncate">
              ({formatShopCount(shop.rating_count)} reviews)
            </span>
          </div>
          <div className="inline-flex items-center gap-1.5 bg-amber-mist rounded-full px-2.5 py-1">
            <Clock size={12} strokeWidth={2.25} className="text-amber-deep" />
            <span className="text-[11.5px] font-bold text-amber-deep tracking-tight">{delivery}</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {visibleTags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-border bg-surface-linen px-2.5 py-1 text-[11px] font-semibold text-gray"
            >
              {tag}
            </span>
          ))}
        </div>

        <button
          type="button"
          className="mt-3.5 h-[42px] w-full rounded-xl bg-brand text-white text-[13px] font-bold font-display tracking-tight hover:bg-brand-mid transition-colors"
        >
          View Shop
        </button>
      </div>
    </div>
  );
}
