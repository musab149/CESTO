import { useState } from 'react';
import { AlertTriangle, Loader2, PackagePlus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAdminProducts, useAdminProduct, type VatCategory } from '@grocery-app/shared';
import { formatCurrency } from '@/lib/format';

/**
 * Search the catalogue and pick one variant.
 *
 * Lifted out of EditOrderModal unchanged so a second caller (the admin order
 * builder) can use it without importing a 700-line modal. The i18n keys are
 * still under `orderDetail.editOrder.*`, which now reads oddly — renaming
 * them means touching both locale files and risks a missing key rendering a
 * raw dot-path in production, so it is left for a pass of its own.
 */
export interface PickedVariant {
  id: string;
  /** The variant's product. A Home Grocery plan stores both ids. */
  productId?: string;
  name: string;
  price: number;
  storeId: string | null;
  storeName: string | null;
  /** Primary product image, for callers that show one. ProductPicker's own
   *  list has no thumbnails, so it does not set this. */
  imageUrl?: string | null;
  /** The product's IVA bucket as its price carries it (effectiveVatCategory),
   *  so a basket can show a VAT breakdown without re-fetching every product.
   *  Absent reads as 0 %. */
  vatCategory?: VatCategory;
  /** The size's buying price (admin only), the line's starting one. */
  unitCost?: number;
}

export interface ProductPickerProps {
  /** Store to scope the search to. null = the Cesto house store. */
  orderStoreId: string | null;
  orderStoreName: string | null;
  onPick: (v: PickedVariant) => void;
  onClose: () => void;
  /** Offers a "create it now" row. Omitted = no such row, as before. */
  onCreateNew?: () => void;
  /** Lets the caller hide the all-stores escape hatch. Default true, which
   *  is what EditOrderModal has always had. */
  showStoreToggle?: boolean;
  /**
   * Start searching every shop instead of scoping to `orderStoreId`.
   *
   * For the admin order builder, where one order legitimately holds products
   * from any number of shops because Cesto delivers it. Default false keeps
   * EditOrderModal's behaviour, where the scope is a real constraint.
   */
  searchAllStores?: boolean;
  /**
   * Let a variant with no stock be picked. For a Home Grocery plan, a list
   * the household keeps for months: what is out today is restocked by the
   * day it is prepared, and the delivery is checked then, not now.
   */
  allowOutOfStock?: boolean;
}

export default function ProductPicker({
  orderStoreId, orderStoreName, onPick, onClose,
  onCreateNew, showStoreToggle = true, searchAllStores = false, allowOutOfStock = false,
}: ProductPickerProps) {

  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [productId, setProductId] = useState<string | null>(null);
  const [allStores, setAllStores] = useState(searchAllStores);

  const scopeLabel = orderStoreName ?? t('orderDetail.editOrder.cestoHouseStore');
  // 'cesto' sentinel = Product.store_id IS NULL (product-filters.ts) — a
  // query string can't carry a real null, and "Cesto only" has to be
  // expressible or a house-store order would fall back to an unscoped search.
  const { data, isLoading } = useAdminProducts({
    q: q || undefined,
    storeId: allStores ? undefined : (orderStoreId ?? 'cesto'),
    page: 1,
    limit: 20,
  });
  const { data: detail, isLoading: detailLoading } = useAdminProduct(productId ?? undefined);
  const products = data?.items ?? [];

  if (productId) {
    const variants = detail?.variants ?? [];
    const storeId = detail?.store_id ?? null;
    const storeName = detail?.store?.name ?? null;
    return (
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between mb-2 gap-2">
          <div className="min-w-0 flex items-center gap-1.5">
            <p className="text-xs font-semibold text-ink truncate">{detail?.name_es ?? '…'}</p>
            {storeName && (
              <span className="text-[11px] font-semibold text-brand bg-brand-mist/40 rounded-full px-1.5 py-0.5 shrink-0">
                {storeName}
              </span>
            )}
          </div>
          <button type="button" onClick={() => setProductId(null)} className="text-xs text-muted hover:underline shrink-0">
            {t('orderDetail.editOrder.back')}
          </button>
        </div>
        {detailLoading ? (
          <div className="flex items-center justify-center py-4 text-muted">
            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
          </div>
        ) : variants.length === 0 ? (
          <p className="text-xs text-muted py-1">{t('orderDetail.editOrder.noVariants')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {variants.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  disabled={!allowOutOfStock && v.stock_quantity <= 0}
                  onClick={() => onPick({ id: v.id, productId: detail?.id ?? productId, name: v.name_es, price: Number(v.price), storeId, storeName })}
                  className="w-full flex items-center justify-between gap-2 py-2 px-2 text-left hover:bg-surface-cream disabled:opacity-40 disabled:cursor-not-allowed rounded"
                >
                  <span className="text-sm text-ink truncate">{v.name_es}</span>
                  <span className="text-xs text-gray shrink-0 whitespace-nowrap">
                    {formatCurrency(Number(v.price))} · {t('orderDetail.editOrder.stock')}: {v.stock_quantity}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" strokeWidth={1.75} />
        <input
          autoFocus
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('orderDetail.editOrder.searchPlaceholder')}
          className="w-full bg-surface-cream border border-border rounded-lg h-9 pl-8 pr-3 text-sm font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
      </div>
      {/* Scope toggle. Default (left) keeps every pick landing on THIS order;
          "all stores" is the explicit opt-in to the cross-store split. */}
      {showStoreToggle && (
      <div className="flex items-center gap-1 mb-2 p-0.5 rounded-lg bg-surface-cream border border-border">
        <button
          type="button"
          onClick={() => setAllStores(false)}
          className={`flex-1 h-7 rounded-md text-[11px] font-semibold font-display truncate px-2 transition ${
            !allStores ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink'
          }`}
        >
          {t('orderDetail.editOrder.scopeThisStore', { storeName: scopeLabel })}
        </button>
        <button
          type="button"
          onClick={() => setAllStores(true)}
          className={`flex-1 h-7 rounded-md text-[11px] font-semibold font-display truncate px-2 transition ${
            allStores ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink'
          }`}
        >
          {t('orderDetail.editOrder.scopeAllStores')}
        </button>
      </div>
      )}
      {showStoreToggle && allStores && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-700 font-body mb-2">
          <AlertTriangle size={13} strokeWidth={1.75} className="shrink-0 mt-0.5" />
          {t('orderDetail.editOrder.scopeAllStoresWarning')}
        </p>
      )}
      {isLoading ? (
        <div className="flex items-center justify-center py-4 text-muted">
          <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
        </div>
      ) : products.length === 0 ? (
        <div className="py-2">
          <p className="text-xs text-muted">{t('orderDetail.editOrder.noResults')}</p>
          {!allStores && (
            <button
              type="button"
              onClick={() => setAllStores(true)}
              className="mt-1 text-xs font-semibold text-brand hover:underline"
            >
              {t('orderDetail.editOrder.noResultsSearchAll')}
            </button>
          )}
        </div>
      ) : (
        <ul className="max-h-56 overflow-y-auto divide-y divide-border">
          {products.map((p) => {
            const variants = p.variants ?? [];
            const firstPrice = variants[0]?.price;
            const storeId = p.store_id ?? null;
            const storeName = p.store?.name ?? null;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (variants.length === 1) {
                      onPick({ id: variants[0].id, productId: p.id, name: p.name_es, price: Number(variants[0].price), storeId, storeName });
                    } else {
                      setProductId(p.id);
                    }
                  }}
                  className="w-full flex items-center gap-3 py-2 px-2 text-left hover:bg-surface-cream rounded"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-display text-ink truncate">{p.name_es}</p>
                      {storeName && (
                        <span className="text-[11px] font-semibold text-brand bg-brand-mist/40 rounded-full px-1.5 py-0.5 shrink-0">
                          {storeName}
                        </span>
                      )}
                    </div>
                    {p.brand && <p className="text-xs text-muted truncate">{p.brand}</p>}
                  </div>
                  {firstPrice != null && (
                    <span className="text-xs text-gray shrink-0 whitespace-nowrap">{formatCurrency(Number(firstPrice))}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {/* Only rendered when a caller offers it. EditOrderModal passes
          nothing, so its picker looks exactly as it always did. */}
      {onCreateNew && (
        <button
          type="button"
          onClick={onCreateNew}
          className="mt-2 w-full min-h-[44px] rounded-lg border-2 border-dashed border-border hover:border-brand text-xs font-semibold font-display text-brand inline-flex items-center justify-center gap-1.5"
        >
          <PackagePlus size={14} strokeWidth={2} />
          {t('orderDetail.editOrder.createNewProduct', 'Not listed? Create it now')}
        </button>
      )}
      <button type="button" onClick={onClose} className="mt-2 text-xs text-muted hover:underline">
        {t('orderDetail.editOrder.cancel')}
      </button>
    </div>
  );
}
