import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, Search, Package, Info } from 'lucide-react';
import { usePartnerBrands, resolveImageUrl } from '@grocery-app/shared';

/**
 * Read-only browse of the global Cesto brand list. Partners select FROM
 * this curated list on the product form — they don't create brands
 * themselves. Admin owns the writes on /brands in the admin panel.
 *
 * Each card links to /partner/products?brand=<id> so a partner can jump
 * from the brand roster into the filtered products view.
 */
export default function PartnerBrandsPage() {
  const { data: brands = [], isLoading } = usePartnerBrands();
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return brands;
    return brands.filter((b) => b.name.toLowerCase().includes(needle) || b.slug.toLowerCase().includes(needle));
  }, [brands, q]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold font-display text-ink inline-flex items-center gap-2">
            <Award size={22} strokeWidth={1.75} />
            Brands
            {!isLoading && (
              <span className="text-base font-normal text-muted ml-2">({brands.length})</span>
            )}
          </h1>
          <p className="text-sm text-muted font-body mt-1">
            The Cesto-wide brand list. Products link here by <span className="font-mono text-[13px]">brand_id</span>; pick one on the product form to have it show on customer cards.
          </p>
        </div>
      </div>

      <div className="bg-info-bg border border-info/30 rounded-xl p-3 mb-6 flex items-start gap-3">
        <Info size={18} strokeWidth={1.75} className="text-info shrink-0 mt-0.5" />
        <p className="text-sm text-ink font-body">
          Read-only view. Contact your Cesto admin if a brand you carry is missing from this list.
        </p>
      </div>

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" strokeWidth={1.75} />
        <input
          type="text"
          placeholder="Search brands…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full bg-surface-cream border border-border rounded-lg h-11 pl-10 pr-4 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted py-8">Loading brands…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-8 text-center">
          <Package className="w-10 h-10 text-muted mx-auto mb-2" strokeWidth={1.5} />
          <p className="text-sm text-muted font-body">No brands match "{q}".</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((b) => (
            <Link
              key={b.id}
              to={`/partner/products?brand=${b.id}`}
              title={`View your products under ${b.name}`}
              className="bg-white rounded-xl border border-border overflow-hidden hover:border-brand hover:shadow-card transition group"
            >
              <div
                className="aspect-square flex items-center justify-center p-4"
                style={{ backgroundColor: b.logo_bg ?? '#FFFFFF' }}
              >
                {b.logo_url ? (
                  <img
                    src={resolveImageUrl(b.logo_url, 'logo') ?? ''}
                    alt={b.name}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <Award className="w-10 h-10 text-muted/50" strokeWidth={1.5} />
                )}
              </div>
              <div className="border-t border-border px-3 py-2 bg-white">
                <p className="text-sm font-semibold text-ink truncate">{b.name}</p>
                <p className="text-[11px] text-muted font-mono truncate">{b.slug}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
