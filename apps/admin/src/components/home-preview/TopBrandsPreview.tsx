import { resolveImageUrl } from '@grocery-app/shared';
import type { TopBrandsConfig, TopBrand } from '@grocery-app/shared';

interface Props {
  config: TopBrandsConfig;
}

/**
 * Pixel-mirror of the customer "Top Brands" logo row
 * (apps/web/src/pages/HomePage.tsx → BrandLogoCard).
 * Driven by the live admin form state.
 */
export default function TopBrandsPreview({ config }: Props) {
  const brands = config.brands
    .filter((b) => b.is_active)
    .sort((a, b) => a.display_order - b.display_order);

  if (brands.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-gray font-display">
        No active brands yet. Add brands from the picker to see them here.
      </div>
    );
  }

  // Mirror the customer layout exactly. A flex scroller with fixed-width
  // cards keeps the inline single-card editor preview from being squashed
  // by a multi-column grid wrapper.
  return (
    <div className="flex flex-wrap gap-3">
      {brands.map((brand) => (
        <div key={brand.name} className="w-[160px]">
          <BrandTile brand={brand} />
        </div>
      ))}
    </div>
  );
}

function BrandTile({ brand }: { brand: TopBrand }) {
  const bg = brand.bg_color || '#FFFFFF';
  return (
    <div
      className="h-20 rounded-xl border border-border/60 flex items-center justify-center p-1.5 overflow-hidden"
      style={{ background: bg }}
    >
      {brand.image_url ? (
        <img
          src={resolveImageUrl(brand.image_url, 'logo')}
          alt={brand.name}
          className="w-full h-full object-contain scale-[1.15]"
        />
      ) : (
        <span className="text-[11px] font-display text-muted/70 uppercase tracking-wider text-center">
          {brand.name}
        </span>
      )}
    </div>
  );
}
