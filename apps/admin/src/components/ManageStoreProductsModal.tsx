import { useEffect, useMemo, useState } from 'react';
import { X, Search, Loader2, Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAdminProducts, resolveImageUrl } from '@grocery-app/shared';
import { useToast } from './Toast';

interface Props {
  storeId: string;
  storeName: string;
  assignedIds: string[];
  onAssign: (ids: string[]) => Promise<unknown>;
  onUnassign: (ids: string[]) => Promise<unknown>;
  onClose: () => void;
}

/**
 * Bulk product-assignment modal for the Store form. Shows a search-filtered
 * list of products with checkboxes. Save compares against the store's
 * currently-assigned IDs and issues the minimal diff — one bulk-assign call
 * for newly-checked, one bulk-unassign for newly-unchecked.
 *
 * We only load the first 100 products in one page; for larger catalogues the
 * admin narrows via search before checking. Keeps the modal responsive
 * without pagination controls inside a modal.
 */
export default function ManageStoreProductsModal({
  storeName, assignedIds, onAssign, onUnassign, onClose,
}: Props) {
  const { t } = useTranslation();
  const toast = useToast();

  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(assignedIds));
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useAdminProducts({ q: q || undefined, page: 1, limit: 100 });

  // The store's currently-assigned set is our baseline; the modal state is
  // the desired state. Diff at save time.
  const baseline = useMemo(() => new Set(assignedIds), [assignedIds]);

  // Keep local set in sync when the modal opens for the first time.
  useEffect(() => {
    setSelected(new Set(assignedIds));
  }, [assignedIds]);

  const products = data?.items ?? [];

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    const toAdd: string[] = [];
    const toRemove: string[] = [];
    for (const id of selected) if (!baseline.has(id)) toAdd.push(id);
    for (const id of baseline) if (!selected.has(id)) toRemove.push(id);
    if (toAdd.length === 0 && toRemove.length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      if (toAdd.length) await onAssign(toAdd);
      if (toRemove.length) await onUnassign(toRemove);
      toast.success(t('stores.productsSaved', `Saved · +${toAdd.length} / -${toRemove.length}`));
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-none sm:rounded-xl shadow-modal w-full sm:max-w-2xl h-full sm:h-auto sm:max-h-[85vh] flex flex-col sm:border sm:border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="min-w-0">
            <h3 className="text-lg font-bold font-display text-ink truncate">
              {t('stores.manageProductsTitle', 'Manage products')}
            </h3>
            <p className="text-sm text-muted mt-0.5 truncate">
              {storeName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg hover:bg-surface-cream flex items-center justify-center transition"
            aria-label={t('common.close', 'Close')}
          >
            <X className="w-4 h-4 text-muted" strokeWidth={1.75} />
          </button>
        </div>

        <div className="px-6 pt-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" strokeWidth={1.75} />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('stores.manageProductsSearch', 'Search products…')}
              className="w-full bg-surface-cream border border-border rounded-lg h-11 pl-10 pr-4 text-sm font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              {t('common.loading', 'Loading…')}
            </div>
          ) : products.length === 0 ? (
            <div className="bg-card rounded-xl border border-border p-8 text-center">
              <div className="w-12 h-12 rounded-2xl bg-surface-cream flex items-center justify-center mx-auto mb-3">
                <Package className="w-6 h-6 text-muted" strokeWidth={1.75} />
              </div>
              <p className="text-sm text-muted">
                {t('stores.noProductsFound', 'No products match your search.')}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border border border-border rounded-xl bg-card overflow-hidden">
              {products.map((p) => {
                const primaryImage = p.images?.[0]?.url;
                const price = p.variants?.[0]?.price;
                const checked = selected.has(p.id);
                return (
                  <li key={p.id}>
                    <label
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition ${
                        checked ? 'bg-brand-mist/40' : 'hover:bg-surface-cream'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(p.id)}
                        className="w-4 h-4 accent-brand shrink-0"
                      />
                      <div className="w-10 h-10 rounded-lg bg-surface-cream border border-border overflow-hidden flex items-center justify-center shrink-0">
                        {primaryImage ? (
                          <img src={resolveImageUrl(primaryImage, 'thumb')} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Package className="w-4 h-4 text-muted" strokeWidth={1.75} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-ink font-display truncate">
                          {p.name_es}
                        </div>
                        {p.brand && (
                          <div className="text-xs text-muted truncate mt-0.5">{p.brand}</div>
                        )}
                      </div>
                      {price != null && (
                        <div className="text-sm font-semibold text-ink tabular-nums shrink-0">
                          €{Number(price).toFixed(2)}
                        </div>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 sm:p-6 border-t border-border">
          <div className="text-sm text-muted font-display">
            <span className="font-semibold text-ink">{selected.size}</span>{' '}
            {t('stores.manageProductsSelected', 'selected')}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none h-[52px] px-6 rounded-xl border border-border text-sm font-semibold font-display text-ink hover:bg-surface-cream transition"
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 sm:flex-none h-[52px] px-6 sm:px-8 rounded-xl bg-brand hover:bg-brand-mid disabled:opacity-50 text-white font-semibold font-display text-sm transition inline-flex items-center justify-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('common.save', 'Save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
