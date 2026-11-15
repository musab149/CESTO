import { useEffect, useMemo, useState } from 'react';
import {
  X, PackageOpen, CheckCircle2, AlertCircle, Loader2, Trash2,
} from 'lucide-react';
import {
  useCategoryPendingProducts,
  usePublishPendingProducts,
  useDismissPendingProduct,
  useAdminSubcategories,
  type Category,
} from '@grocery-app/shared';
import { useToast } from './Toast';

interface Props {
  open: boolean;
  category: Category | null;
  onClose: () => void;
}

// Modal that surfaces every PendingProduct queued under the given Category and
// lets the admin publish or dismiss them. Opened either right after a category
// is created (from a bulk import) or by clicking the "N waiting" badge on the
// categories table row.
export default function PublishPendingProductsModal({ open, category, onClose }: Props) {
  const toast = useToast();
  const { data: pending, isLoading } = useCategoryPendingProducts(open && category ? category.id : undefined);
  const { data: allSubs } = useAdminSubcategories();
  const publishMutation = usePublishPendingProducts();
  const dismissMutation = useDismissPendingProduct();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subcategoryId, setSubcategoryId] = useState<string>('');

  // Reset selection state whenever the modal opens for a different category.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setSubcategoryId('');
  }, [open, category?.id]);

  // Default to all-selected once the pending list loads.
  useEffect(() => {
    if (!open || !pending) return;
    setSelected((prev) => (prev.size === 0 ? new Set(pending.map((p) => p.id)) : prev));
  }, [open, pending]);

  const subcategoriesForCat = useMemo(
    () => (allSubs ?? []).filter((s) => s.category_id === category?.id),
    [allSubs, category?.id],
  );

  if (!open || !category) return null;

  const items = pending ?? [];
  const allSelected = items.length > 0 && selected.size === items.length;
  const noneSelected = selected.size === 0;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((p) => p.id)));
  }

  async function handlePublish() {
    if (noneSelected || !category) return;
    try {
      const res = await publishMutation.mutateAsync({
        categoryId: category.id,
        ids: Array.from(selected),
        subcategoryId: subcategoryId || null,
      });
      if (res.published > 0) {
        toast.success(
          'Products published',
          `${res.published} product${res.published === 1 ? '' : 's'} now live under ${category.name_es}.`,
        );
      }
      if (res.failed > 0) {
        toast.warning(
          'Some failed',
          `${res.failed} product${res.failed === 1 ? '' : 's'} could not be published. Check the queue and retry.`,
        );
      }
      // Close once everything cleared; otherwise stay open so the admin can
      // see what's left.
      if (res.failed === 0) onClose();
      else setSelected(new Set());
    } catch (err) {
      toast.error(
        'Publish failed',
        err instanceof Error ? err.message : 'Could not publish queued products.',
      );
    }
  }

  async function handleDismiss(id: string) {
    try {
      await dismissMutation.mutateAsync(id);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      toast.error(
        'Dismiss failed',
        err instanceof Error ? err.message : 'Could not dismiss the queued product.',
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-modal w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-bold font-display text-ink">
              Publish queued products
            </h2>
            <p className="text-xs text-muted font-body">
              These products were uploaded earlier but were waiting for{' '}
              <span className="font-semibold text-ink">{category.name_es}</span> to exist.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg hover:bg-surface-cream flex items-center justify-center transition"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-ink" strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted gap-2">
              <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
              <span className="text-sm font-display">Loading queued products…</span>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <PackageOpen className="w-10 h-10 text-muted mb-2" strokeWidth={1.5} />
              <p className="text-sm font-semibold font-display text-ink">Nothing waiting</p>
              <p className="text-xs text-muted font-body mt-1">
                All queued products for this category have been published or dismissed.
              </p>
            </div>
          ) : (
            <>
              {/* Subcategory selector */}
              {subcategoriesForCat.length > 0 && (
                <div className="rounded-lg border border-border bg-surface-cream p-3">
                  <label className="text-xs font-semibold font-display text-ink mb-1.5 block">
                    Subcategory (optional)
                  </label>
                  <select
                    value={subcategoryId}
                    onChange={(e) => setSubcategoryId(e.target.value)}
                    className="bg-card border border-border rounded-lg h-10 px-3 text-sm font-display text-ink w-full focus:outline-none focus:ring-2 focus:ring-brand/30"
                  >
                    <option value="">— No subcategory —</option>
                    {subcategoriesForCat.map((s) => (
                      <option key={s.id} value={s.id}>{s.name_es}</option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted font-body mt-1.5">
                    Applies to every product you publish in this batch. You can move them later.
                  </p>
                </div>
              )}

              {/* Select-all toolbar */}
              <div className="flex items-center justify-between px-1">
                <label className="inline-flex items-center gap-2 text-sm font-semibold font-display text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-border text-brand focus:ring-brand/30"
                  />
                  Select all ({items.length})
                </label>
                <span className="text-xs text-muted font-body">
                  {selected.size} selected
                </span>
              </div>

              {/* Per-product rows */}
              <ul className="space-y-2">
                {items.map((p) => {
                  const isSel = selected.has(p.id);
                  const totalStock = p.variants.reduce((sum, v) => sum + (v.stock_quantity || 0), 0);
                  return (
                    <li
                      key={p.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                        isSel ? 'border-brand bg-brand-mist/30' : 'border-border bg-card'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggle(p.id)}
                        className="mt-1 h-4 w-4 rounded border-border text-brand focus:ring-brand/30"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold font-display text-ink truncate">
                          {p.name_es}
                          <span className="text-muted font-normal"> · {p.name_en}</span>
                        </p>
                        <p className="text-xs text-muted font-body mt-0.5">
                          <span className="font-mono">{p.product_key}</span>
                          {p.brand && <> · {p.brand}</>}
                          {p.subcategory_name_raw && <> · sub: {p.subcategory_name_raw}</>}
                          <> · row {p.source_row_number}</>
                        </p>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {p.variants.map((v, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1.5 bg-surface-cream rounded-full px-2 py-0.5 text-[11px] font-display text-ink"
                            >
                              <span className="font-semibold">{v.name_es}</span>
                              <span className="text-muted">€{v.price.toFixed(2)}</span>
                              <span className="text-muted">· {v.stock_quantity} in stock</span>
                            </span>
                          ))}
                        </div>
                        {p.image_urls.length > 0 && (
                          <p className="text-[11px] text-muted font-body mt-1.5">
                            {p.image_urls.length} image{p.image_urls.length === 1 ? '' : 's'} ·{' '}
                            total stock {totalStock}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDismiss(p.id)}
                        disabled={dismissMutation.isPending}
                        className="p-2 rounded-lg hover:bg-danger-bg text-muted hover:text-danger transition-colors disabled:opacity-50"
                        title="Dismiss this queued product"
                      >
                        <Trash2 size={15} strokeWidth={1.75} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-t border-border">
          <p className="text-xs text-muted font-body min-w-0 flex-1">
            Dismissed products are removed from the queue. Published products become live immediately.
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors whitespace-nowrap"
            >
              {items.length === 0 ? 'Done' : 'Later'}
            </button>
            {items.length > 0 && (
              <button
                type="button"
                onClick={handlePublish}
                disabled={noneSelected || publishMutation.isPending}
                className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl text-sm font-semibold font-display bg-brand text-white hover:bg-brand-mid disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
              >
                {publishMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" strokeWidth={1.75} />
                ) : (
                  <CheckCircle2 className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                )}
                <span>
                  {publishMutation.isPending
                    ? 'Publishing…'
                    : selected.size > 0
                      ? `Publish ${selected.size}`
                      : 'Publish'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Inline error band when the publish result includes failures */}
        {publishMutation.data && publishMutation.data.failed > 0 && (
          <div className="px-6 py-3 border-t border-border bg-danger-bg/30">
            <p className="text-xs text-danger font-display flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
              {publishMutation.data.failed} row{publishMutation.data.failed === 1 ? '' : 's'} failed
              to publish — see details above.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
