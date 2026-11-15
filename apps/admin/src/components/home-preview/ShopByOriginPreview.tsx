import type { ShopByOriginConfig, OriginCard } from '@grocery-app/shared';
import { OriginCardArt } from '@grocery-app/shared';
import { ArrowRight } from 'lucide-react';

interface Props {
  config: ShopByOriginConfig;
  lang: 'en' | 'es';
  /** Optional real product counts keyed by lowercase origin slug. */
  countByOrigin?: Map<string, number>;
}

function formatOriginCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K+`;
  }
  return `${n}+`;
}

/**
 * Pixel-mirror of the customer Shop by Origin grid (apps/web/src/pages/HomePage.tsx).
 * Driven by the live admin form state.
 */
export default function ShopByOriginPreview({ config, lang, countByOrigin }: Props) {
  const cards = config.cards
    .filter((c) => c.is_active)
    .sort((a, b) => a.display_order - b.display_order);

  if (cards.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-gray font-display">
        No active origin cards yet. Add one to see the preview.
      </div>
    );
  }

  // Mirror the customer-facing layout exactly: a horizontal flex scroller
  // with fixed 200px-wide cards. This both matches what the user sees on the
  // home page AND keeps the inline single-card editor preview legible (the
  // old grid forced 2 columns minimum, squeezing the lone card to half-width).
  return (
    <div className="flex gap-4 overflow-x-auto hide-scrollbar pb-1">
      {cards.map((card) => (
        <div key={card.key} className="shrink-0 w-[200px]">
          <OriginTile
            card={card}
            count={countByOrigin?.get(card.key.toLowerCase()) ?? 0}
            lang={lang}
          />
        </div>
      ))}
    </div>
  );
}

function OriginTile({ card, count, lang }: { card: OriginCard; count: number; lang: 'en' | 'es' }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl flex flex-col text-left w-full aspect-[10/11]"
      style={{ background: card.bg_color }}
    >
      {/* Background art — admin upload wins, otherwise auto-generated. */}
      {card.image_url ? (
        <img
          src={card.image_url}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <OriginCardArt
          slug={card.key}
          bg={card.bg_color}
          accent={card.accent_color}
          className="absolute inset-0 w-full h-full"
        />
      )}

      {/* Bottom scrim for text legibility. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[40%] pointer-events-none"
        style={{ background: `linear-gradient(to top, ${card.bg_color} 0%, ${card.bg_color}E6 45%, transparent 100%)` }}
      />

      <div className="relative mt-auto p-4 pt-3 flex items-end justify-between gap-2 w-full">
        <div className="min-w-0">
          <h3 className="font-display text-[14px] text-ink leading-tight tracking-tight" style={{ fontWeight: 700 }}>
            {lang === 'en' ? card.label_en : card.label_es}
          </h3>
          <p className="text-[11.5px] text-ink/55 font-ui mt-0.5">
            {formatOriginCount(count)} {lang === 'en' ? 'products' : 'productos'}
          </p>
        </div>
        <ArrowRight size={18} strokeWidth={2.5} className="text-ink/80 shrink-0" />
      </div>
    </div>
  );
}
