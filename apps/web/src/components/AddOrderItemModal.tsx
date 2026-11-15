import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Package, Plus, Loader2 } from 'lucide-react';
import { useProducts, resolveImageUrl, type Product, type ProductVariant } from '@grocery-app/shared';

/**
 * Pick a product to add to an order that has already been placed.
 *
 * Scoped to ONE store — the order's own. The server refuses a cross-store
 * add (it would otherwise spin the item off into a second order with its
 * own delivery fee), so searching the whole catalogue here would surface
 * products that can only ever come back as an error. `'cesto'` is the
 * sentinel for the house catalogue, whose products carry store_id = null.
 *
 * Deliberately NOT the cart's product browser: this returns a variant to
 * the caller instead of mutating anything. The order edit is one batched
 * save, so nothing here may write on its own.
 */

interface Props {
  /** The order's store. Null means the Cesto house catalogue. */
  storeId: string | null;
  lang: 'es' | 'en';
  /** Variant ids already on the order — shown as "added" rather than hidden,
   *  so someone searching for a thing they already have understands why it
   *  is not offering to add it again. */
  existingVariantIds: Set<string>;
  onPick: (product: Product, variant: ProductVariant) => void;
  onClose: () => void;
}

export default function AddOrderItemModal({
  storeId, lang, existingVariantIds, onPick, onClose,
}: Props) {
  const [raw, setRaw] = useState('');
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced: every keystroke would otherwise be a query, and the search
  // endpoint reads the whole catalogue.
  useEffect(() => {
    const id = setTimeout(() => setQ(raw.trim()), 300);
    return () => clearTimeout(id);
  }, [raw]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Escape closes. Registered on document because the dialog is portalled
  // out of the page's focus tree.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // /api/products rather than /api/search: only this one accepts a store
  // filter, and a search confined to one shop is a filtered listing anyway.
  // 'cesto' is the sentinel for the house catalogue (store_id IS NULL).
  const { data, isLoading, isFetching } = useProducts(
    { q, storeId: storeId ?? 'cesto', limit: 20 },
    { enabled: q.length > 0 },
  );

  // NOTE: the response is a NARROWER object than the `Product` type claims.
  // productSelect omits `is_active` on both the product and its variants —
  // it filters on them in the WHERE instead — so checking `p.is_active` here
  // would test undefined and drop every result. Filter on presence only.
  const results = useMemo(
    () => (data?.items ?? []).filter((p) => (p.variants?.length ?? 0) > 0),
    [data],
  );

  const t = (es: string, en: string) => (lang === 'en' ? en : es);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-veil/40 backdrop-blur-[2px] p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('Añadir productos', 'Add products')}
    >
      <div
        className="bg-surface-white w-full sm:max-w-lg sm:rounded-lg rounded-t-2xl shadow-xl flex flex-col max-h-[85vh] sm:max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header + search */}
        <div className="p-4 sm:p-5 border-b border-border/60 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-extrabold text-ink font-display">
              {t('Añadir productos', 'Add products')}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('Cerrar', 'Close')}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:bg-surface-linen hover:text-ink transition-colors"
            >
              <X size={18} strokeWidth={1.75} />
            </button>
          </div>
          <div className="relative">
            <Search
              size={16}
              strokeWidth={1.75}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            />
            <input
              ref={inputRef}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={t('Buscar en esta tienda…', 'Search this shop…')}
              className="w-full h-11 pl-9 pr-9 rounded-xl border border-border bg-surface-linen text-sm text-ink font-body placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
            />
            {isFetching && q !== '' && (
              <Loader2
                size={15}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted animate-spin"
              />
            )}
          </div>
        </div>

        {/* Results */}
        <div className="overflow-y-auto flex-1 min-h-0">
          {q === '' ? (
            <p className="px-5 py-10 text-center text-sm text-muted font-body">
              {t('Escribe para buscar productos de esta tienda.', 'Type to search this shop’s products.')}
            </p>
          ) : isLoading ? (
            <div className="p-4 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="w-12 h-12 rounded-xl bg-surface-linen shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-surface-linen rounded w-2/3" />
                    <div className="h-3 bg-surface-linen rounded w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          ) : results.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <Package size={28} strokeWidth={1.5} className="text-muted mx-auto mb-2" />
              <p className="text-sm text-ink font-display font-semibold">
                {t('Sin resultados', 'No results')}
              </p>
              <p className="text-xs text-muted font-body mt-1">
                {t(
                  'Esta tienda no vende nada que coincida con tu búsqueda.',
                  'This shop doesn’t sell anything matching your search.',
                )}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {results.map((p) => (
                <ProductRow
                  key={p.id}
                  product={p}
                  lang={lang}
                  existingVariantIds={existingVariantIds}
                  onPick={onPick}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ProductRow({
  product, lang, existingVariantIds, onPick,
}: {
  product: Product;
  lang: 'es' | 'en';
  existingVariantIds: Set<string>;
  onPick: (product: Product, variant: ProductVariant) => void;
}) {
  // Already active-only and default-first from the server (see the note in
  // the parent) — no client-side filter to apply.
  const active = product.variants ?? [];

  const [variantId, setVariantId] = useState(
    // Server orders is_default first, so active[0] is the right fallback.
    () => (active.find((v) => v.is_default) ?? active[0])?.id ?? '',
  );
  const variant = active.find((v) => v.id === variantId) ?? active[0];
  if (!variant) return null;

  const name = lang === 'en' ? product.name_en : product.name_es;
  const img = (product.images?.find((i) => i.is_primary) ?? product.images?.[0])?.url;
  const already = existingVariantIds.has(variant.id);
  const out = variant.stock_quantity <= 0;
  const t = (es: string, en: string) => (lang === 'en' ? en : es);

  return (
    <li className="flex items-center gap-3 px-4 sm:px-5 py-3">
      <div className="photo-well w-12 h-12 rounded-xl bg-surface-linen overflow-hidden shrink-0 border border-border/40 flex items-center justify-center">
        {img ? (
          <img
            src={resolveImageUrl(img, 'thumb')}
            alt={name}
            className="object-cover w-full h-full"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <Package size={16} strokeWidth={1.5} className="text-muted" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold text-ink font-display line-clamp-1">{name}</h4>
        {active.length > 1 ? (
          <select
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            className="mt-1 text-xs text-ink font-body bg-surface-linen border border-border rounded-lg h-7 px-1.5 max-w-[11rem] focus:outline-none focus:ring-2 focus:ring-brand/30"
          >
            {active.map((v) => (
              <option key={v.id} value={v.id}>
                {(lang === 'en' ? v.name_en : v.name_es)} · €{Number(v.price).toFixed(2)}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-xs text-muted font-body">
            {lang === 'en' ? variant.name_en : variant.name_es} · €{Number(variant.price).toFixed(2)}
          </p>
        )}
        {out && (
          <p className="text-xs text-danger font-body mt-0.5">{t('Sin stock', 'Out of stock')}</p>
        )}
      </div>

      <button
        type="button"
        disabled={already || out}
        onClick={() => onPick(product, variant)}
        className="shrink-0 h-9 px-3 rounded-xl text-xs font-bold font-display inline-flex items-center gap-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-surface-linen disabled:text-muted bg-brand text-white hover:bg-brand-mid"
      >
        {already ? (
          t('Añadido', 'Added')
        ) : (
          <>
            <Plus size={14} strokeWidth={2.25} />
            {t('Añadir', 'Add')}
          </>
        )}
      </button>
    </li>
  );
}
