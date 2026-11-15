import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Globe, Search, Package, Info } from 'lucide-react';
import { usePartnerOrigins, resolveImageUrl } from '@grocery-app/shared';

/**
 * Read-only browse of the global Cesto origin list. Partners select FROM
 * this curated list on the product form — same policy as brands and
 * categories. Admin owns the writes on /origins in the admin panel.
 */
export default function PartnerOriginsPage() {
  const { data: origins = [], isLoading } = usePartnerOrigins();
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return origins;
    return origins.filter((o) =>
      o.label_es.toLowerCase().includes(needle)
      || o.label_en.toLowerCase().includes(needle)
      || o.key.toLowerCase().includes(needle),
    );
  }, [origins, q]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold font-display text-ink inline-flex items-center gap-2">
            <Globe size={22} strokeWidth={1.75} />
            Origins
            {!isLoading && (
              <span className="text-base font-normal text-muted ml-2">({origins.length})</span>
            )}
          </h1>
          <p className="text-sm text-muted font-body mt-1">
            Shop-by-Origin cards on the customer homepage. Products link here by <span className="font-mono text-[13px]">origin_id</span>; pick one on the product form to include it on the origin rail.
          </p>
        </div>
      </div>

      <div className="bg-info-bg border border-info/30 rounded-xl p-3 mb-6 flex items-start gap-3">
        <Info size={18} strokeWidth={1.75} className="text-info shrink-0 mt-0.5" />
        <p className="text-sm text-ink font-body">
          Read-only view. Contact your Cesto admin if an origin your catalogue represents is missing.
        </p>
      </div>

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" strokeWidth={1.75} />
        <input
          type="text"
          placeholder="Search origins…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full bg-surface-cream border border-border rounded-lg h-11 pl-10 pr-4 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted py-8">Loading origins…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-8 text-center">
          <Package className="w-10 h-10 text-muted mx-auto mb-2" strokeWidth={1.5} />
          <p className="text-sm text-muted font-body">No origins match "{q}".</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((o) => (
            <Link
              key={o.id}
              to={`/partner/products?origin=${o.id}`}
              title={`View your products from ${o.label_es}`}
              className="bg-white rounded-xl border border-border overflow-hidden hover:border-brand hover:shadow-card transition"
            >
              <div
                className="aspect-[4/3] flex items-center justify-center p-4 relative"
                style={{
                  backgroundColor: o.bg_color ?? 'var(--color-surface-cream)',
                  color: o.accent_color ?? 'var(--color-ink)',
                }}
              >
                {o.image_url ? (
                  <img
                    src={resolveImageUrl(o.image_url, 'tile') ?? ''}
                    alt={o.label_es}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <span className="text-3xl font-bold font-display opacity-80">
                    {o.label_es.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="border-t border-border px-3 py-2 bg-white">
                <p className="text-sm font-semibold text-ink truncate">{o.label_es}</p>
                <p className="text-[11px] text-muted font-body truncate">{o.label_en}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
