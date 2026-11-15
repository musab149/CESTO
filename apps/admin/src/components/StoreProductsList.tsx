import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Package, Pencil, Trash2, AlertTriangle, Plus, Loader2,
  Tag, ExternalLink,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useAdminProducts,
  useUnassignStoreProducts,
  resolveImageUrl,
} from '@grocery-app/shared';
import ConfirmModal from './ConfirmModal';
import { TableSkeleton } from './Skeleton';
import { useToast } from './Toast';

interface AdminProductRow {
  id: string;
  name_es: string;
  name_en: string;
  brand: string | null;
  is_active: boolean;
  category?: { id: string; name_es: string } | null;
  variants?: Array<{
    id: string;
    price: number | string;
    b2b_price?: number | string | null;
    stock_quantity: number;
    low_stock_threshold: number;
    is_default: boolean;
  }>;
  images?: Array<{ url: string }>;
}

interface Props {
  storeId: string;
  storeName: string;
  /** Called with the ADD action so the parent can open the picker modal. */
  onAdd: () => void;
}

function formatCurrency(value: number) {
  return value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Assigned-products manager for the store edit page. Shows the products that
 * currently reference this store and lets the admin unassign any of them
 * inline. Deep edits and re-assignments happen on the product's own form.
 */
export default function StoreProductsList({ storeId, storeName, onAdd }: Props) {
  const { t } = useTranslation();
  const toast = useToast();

  const [q, setQ] = useState('');
  const [confirmUnassign, setConfirmUnassign] = useState<AdminProductRow | null>(null);

  // Pull every assigned product in one shot — a store with hundreds of SKUs
  // is rare on Cesto's scale for MVP, and paginating a nested manager tab
  // reads as clutter. Bump the cap later if that stops holding.
  const { data, isLoading, refetch } = useAdminProducts({
    storeId,
    q: q.trim() || undefined,
    page: 1,
    limit: 200,
  });

  const unassignMutation = useUnassignStoreProducts();

  const rows = useMemo(() => (data?.items ?? []) as AdminProductRow[], [data]);

  async function handleUnassign() {
    if (!confirmUnassign) return;
    try {
      await unassignMutation.mutateAsync({ id: storeId, productIds: [confirmUnassign.id] });
      toast.success(
        t('storeProducts.unassignedToast', `Removed "${confirmUnassign.name_es}" from ${storeName}.`),
      );
      setConfirmUnassign(null);
      refetch();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: search + add */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" strokeWidth={1.75} />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('storeProducts.search', 'Search products in this store…')}
            className="w-full bg-surface-cream border border-border rounded-lg h-11 pl-10 pr-4 text-sm font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-2 bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm px-5 rounded-xl h-11 transition shrink-0"
        >
          <Plus className="w-4 h-4" strokeWidth={2} />
          {t('storeProducts.addProducts', 'Add products')}
        </button>
      </div>

      {/* Body */}
      {isLoading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : rows.length === 0 && !q ? (
        // Empty state — first-run "no products in this store" case
        <div className="bg-card rounded-xl border border-border p-10 text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-cream flex items-center justify-center mx-auto mb-4">
            <Package className="w-8 h-8 text-muted" strokeWidth={1.75} />
          </div>
          <h3 className="text-lg font-semibold font-display text-ink mb-1">
            {t('storeProducts.emptyTitle', 'No products in this store yet')}
          </h3>
          <p className="text-sm text-muted max-w-md mx-auto mb-5">
            {t(
              'storeProducts.emptyBody',
              'Assign products from your catalog to make them appear on the storefront. You can also change a product’s Store from its own edit page.',
            )}
          </p>
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-2 bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition"
          >
            <Plus className="w-5 h-5" strokeWidth={1.75} />
            {t('storeProducts.addFirstProducts', 'Add products')}
          </button>
        </div>
      ) : rows.length === 0 ? (
        // Empty-with-search state — the store has products but none match `q`
        <div className="bg-card rounded-xl border border-border p-8 text-center">
          <Search className="w-6 h-6 text-muted mx-auto mb-2" strokeWidth={1.75} />
          <p className="text-sm text-muted">
            {t('storeProducts.noSearchMatch', `No products in this store match “${q}”.`)}
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {/* Mobile card list — one card per product, up to md */}
          <ul className="md:hidden divide-y divide-border">
            {rows.map((product) => {
              const defaultVariant =
                product.variants?.find((v) => v.is_default) ?? product.variants?.[0] ?? null;
              const totalStock =
                product.variants?.reduce((s, v) => s + (v.stock_quantity ?? 0), 0) ?? 0;
              const stockStatus: 'out' | 'low' | 'ok' =
                totalStock === 0
                  ? 'out'
                  : defaultVariant &&
                    defaultVariant.stock_quantity <= (defaultVariant.low_stock_threshold ?? 0)
                    ? 'low'
                    : 'ok';
              const imageUrl = product.images?.[0]?.url ?? null;
              const b2bPrice = defaultVariant?.b2b_price;
              const hasB2b = b2bPrice != null && b2bPrice !== '';
              return (
                <li key={product.id} className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    {imageUrl ? (
                      <img
                        src={resolveImageUrl(imageUrl, 'thumb')}
                        alt=""
                        className="w-12 h-12 rounded-lg object-cover border border-border shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-surface-cream border border-border flex items-center justify-center shrink-0">
                        <Package className="w-5 h-5 text-muted" strokeWidth={1.75} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-ink font-display truncate">
                        {product.name_es}
                      </div>
                      {product.brand && (
                        <div className="text-xs text-muted truncate mt-0.5 inline-flex items-center gap-1">
                          <Tag className="w-3 h-3" strokeWidth={2} /> {product.brand}
                        </div>
                      )}
                      {product.category?.name_es && (
                        <div className="text-xs text-muted mt-0.5 truncate">
                          {product.category.name_es}
                        </div>
                      )}
                    </div>
                    <span
                      className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold font-display uppercase tracking-wide ${
                        product.is_active
                          ? 'bg-success-bg text-success'
                          : 'bg-gray-100 text-gray'
                      }`}
                    >
                      {product.is_active ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center border-y border-border py-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted font-display">
                        {t('storeProducts.col.b2cPrice', 'B2C')}
                      </div>
                      <div className="text-sm font-bold text-ink tabular-nums mt-0.5">
                        {defaultVariant ? `€${formatCurrency(Number(defaultVariant.price))}` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted font-display">
                        {t('storeProducts.col.b2bPrice', 'B2B')}
                      </div>
                      <div className="text-sm font-bold tabular-nums mt-0.5">
                        {hasB2b ? (
                          <span className="text-amber-deep">€{formatCurrency(Number(b2bPrice))}</span>
                        ) : (
                          <span className="text-muted text-xs italic">
                            {t('storeProducts.noB2b', 'Not set')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-muted font-display">
                        {t('storeProducts.col.stock', 'Stock')}
                      </div>
                      <div className={`text-sm font-bold tabular-nums mt-0.5 ${
                        stockStatus === 'out'
                          ? 'text-danger'
                          : stockStatus === 'low'
                            ? 'text-amber-deep'
                            : 'text-ink'
                      }`}>
                        {totalStock}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/products/${product.id}/edit`}
                      className="flex-1 h-10 rounded-lg bg-surface-cream hover:bg-brand-mist inline-flex items-center justify-center gap-2 text-sm font-semibold font-display text-ink transition"
                    >
                      <Pencil className="w-4 h-4" strokeWidth={1.75} />
                      {t('storeProducts.editProduct', 'Edit')}
                    </Link>
                    <button
                      type="button"
                      onClick={() => setConfirmUnassign(product)}
                      className="w-10 h-10 rounded-lg hover:bg-danger-bg flex items-center justify-center transition"
                      title={t('storeProducts.unassign', 'Remove from this store')}
                    >
                      <Trash2 className="w-4 h-4 text-danger" strokeWidth={1.75} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Desktop table (md+) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="bg-surface-cream">
                  <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">
                    {t('storeProducts.col.product', 'Product')}
                  </th>
                  <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">
                    {t('storeProducts.col.category', 'Category')}
                  </th>
                  <th className="text-right text-xs font-semibold text-gray uppercase px-4 py-3 font-display">
                    {t('storeProducts.col.b2cPrice', 'B2C price')}
                  </th>
                  <th className="text-right text-xs font-semibold text-gray uppercase px-4 py-3 font-display">
                    {t('storeProducts.col.b2bPrice', 'B2B price')}
                  </th>
                  <th className="text-right text-xs font-semibold text-gray uppercase px-4 py-3 font-display">
                    {t('storeProducts.col.stock', 'Stock')}
                  </th>
                  <th className="text-center text-xs font-semibold text-gray uppercase px-4 py-3 font-display">
                    {t('storeProducts.col.status', 'Status')}
                  </th>
                  <th className="text-right text-xs font-semibold text-gray uppercase px-4 py-3 font-display">
                    {t('storeProducts.col.actions', 'Actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((product) => {
                  const defaultVariant =
                    product.variants?.find((v) => v.is_default) ?? product.variants?.[0] ?? null;
                  const totalStock =
                    product.variants?.reduce((s, v) => s + (v.stock_quantity ?? 0), 0) ?? 0;
                  const stockStatus: 'out' | 'low' | 'ok' =
                    totalStock === 0
                      ? 'out'
                      : defaultVariant &&
                        defaultVariant.stock_quantity <= (defaultVariant.low_stock_threshold ?? 0)
                        ? 'low'
                        : 'ok';
                  const imageUrl = product.images?.[0]?.url ?? null;
                  const b2bPrice = defaultVariant?.b2b_price;
                  const hasB2b = b2bPrice != null && b2bPrice !== '';

                  return (
                    <tr
                      key={product.id}
                      className="border-t border-border hover:bg-brand-mist/30 transition"
                    >
                      {/* Product */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {imageUrl ? (
                            <img
                              src={resolveImageUrl(imageUrl, 'thumb')}
                              alt=""
                              className="w-10 h-10 rounded-lg object-cover border border-border shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-surface-cream border border-border flex items-center justify-center shrink-0">
                              <Package className="w-5 h-5 text-muted" strokeWidth={1.75} />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-ink font-display truncate">
                              {product.name_es}
                            </div>
                            {product.brand && (
                              <div className="text-xs text-muted truncate mt-0.5 inline-flex items-center gap-1">
                                <Tag className="w-3 h-3" strokeWidth={2} />
                                {product.brand}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Category */}
                      <td className="px-4 py-3 text-sm text-ink">
                        {product.category?.name_es ?? <span className="text-muted">—</span>}
                      </td>

                      {/* B2C price */}
                      <td className="px-4 py-3 text-right text-sm font-semibold text-ink tabular-nums">
                        {defaultVariant ? `€${formatCurrency(Number(defaultVariant.price))}` : '—'}
                      </td>

                      {/* B2B price */}
                      <td className="px-4 py-3 text-right text-sm tabular-nums">
                        {hasB2b ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-mist/70 text-amber-deep font-semibold px-2 py-0.5">
                            €{formatCurrency(Number(b2bPrice))}
                          </span>
                        ) : (
                          <span className="text-muted italic text-xs">
                            {t('storeProducts.noB2b', 'Not set')}
                          </span>
                        )}
                      </td>

                      {/* Stock */}
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`text-sm font-semibold tabular-nums ${
                            stockStatus === 'out'
                              ? 'text-danger'
                              : stockStatus === 'low'
                                ? 'text-amber-deep'
                                : 'text-ink'
                          }`}
                        >
                          {totalStock}
                        </span>
                        {stockStatus !== 'ok' && (
                          <div className="text-[11px] font-semibold uppercase tracking-wide mt-0.5 inline-flex items-center gap-0.5 justify-end">
                            <AlertTriangle
                              className={`w-2.5 h-2.5 ${
                                stockStatus === 'out' ? 'text-danger' : 'text-amber-deep'
                              }`}
                              strokeWidth={2}
                            />
                            <span
                              className={
                                stockStatus === 'out' ? 'text-danger' : 'text-amber-deep'
                              }
                            >
                              {stockStatus === 'out'
                                ? t('storeProducts.outOfStock', 'Out')
                                : t('storeProducts.lowStock', 'Low')}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display ${
                            product.is_active
                              ? 'bg-success-bg text-success'
                              : 'bg-gray-100 text-gray'
                          }`}
                        >
                          {product.is_active
                            ? t('common.active', 'Active')
                            : t('common.inactive', 'Inactive')}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            to={`/products/${product.id}/edit`}
                            className="w-9 h-9 rounded-lg bg-surface-cream hover:bg-brand-mist flex items-center justify-center transition"
                            title={t('storeProducts.editProduct', 'Open product editor')}
                          >
                            <Pencil className="w-4 h-4 text-ink" strokeWidth={1.75} />
                          </Link>
                          <button
                            type="button"
                            onClick={() => setConfirmUnassign(product)}
                            className="w-9 h-9 rounded-lg hover:bg-danger-bg flex items-center justify-center transition"
                            title={t('storeProducts.unassign', 'Remove from this store')}
                          >
                            <Trash2 className="w-4 h-4 text-danger" strokeWidth={1.75} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Footer strip: count + tip about the product form. Stacks on
              narrow so the hint doesn't get truncated. */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 border-t border-border bg-surface-cream/60 text-xs">
            <div className="text-muted">
              {t('storeProducts.count', `${rows.length} product${rows.length === 1 ? '' : 's'} shown`)}
            </div>
            <div className="text-muted inline-flex items-start sm:items-center gap-1">
              <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 sm:mt-0" strokeWidth={2} />
              <span>
                {t(
                  'storeProducts.editHint',
                  'Open a product to change price, stock, images, or reassign it to another store.',
                )}
              </span>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirmUnassign}
        title={t('storeProducts.unassignTitle', 'Remove product from store?')}
        message={
          confirmUnassign
            ? t(
                'storeProducts.unassignBody',
                `"${confirmUnassign.name_es}" will no longer appear on ${storeName}'s storefront. The product stays in the catalog and falls back to the Cesto Shop default. You can re-assign it later.`,
              )
            : ''
        }
        confirmLabel={t('storeProducts.confirmUnassign', 'Remove from store')}
        cancelLabel={t('common.cancel', 'Cancel')}
        onConfirm={handleUnassign}
        onCancel={() => setConfirmUnassign(null)}
        danger
      />

      {unassignMutation.isPending && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 inline-flex items-center gap-2 bg-ink text-card rounded-full px-4 py-2 text-sm font-display font-semibold shadow-modal">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('storeProducts.removing', 'Removing…')}
        </div>
      )}
    </div>
  );
}
