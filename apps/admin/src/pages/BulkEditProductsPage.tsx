import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useAdminProductsFull, useBulkUpdateProducts,
  useAdminCategories, useAdminSubcategories, useAdminProductTypes,
  useAdminBrandsTable, useAdminOriginsTable, useAdminStores,
  BULK_EDIT_MAX_PRODUCTS,
  type AdminBulkUpdateItem,
} from '@grocery-app/shared';
import type { ComboboxOption } from '@/components/form/Combobox';
import BackLink from '@/components/BackLink';
import ConfirmModal from '@/components/ConfirmModal';
import { TableSkeleton } from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import { useToast } from '@/components/Toast';
import { useBulkEditStore } from '@/stores/bulkEditStore';
import BulkEditGrid from '@/components/bulkEdit/BulkEditGrid';
import { buildRows, type BulkProduct, type GridRow } from '@/components/bulkEdit/types';
import ColumnsPicker from '@/components/bulkEdit/ColumnsPicker';
import { useBulkEditDraft, type BulkEditDraft } from '@/components/bulkEdit/useBulkEditDraft';
import {
  BULK_COLUMNS, STICKY_COLUMN_KEY, loadVisibleColumns, saveVisibleColumns,
  type ColumnDef, type OptionsSource,
} from '@/components/bulkEdit/columns';

/** Items per request. Each item runs its own transaction server-side. */
const SAVE_CHUNK = 50;

export default function BulkEditProductsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const selection = useBulkEditStore((s) => s.selection);
  const clearSelection = useBulkEditStore((s) => s.clear);

  const draft = useBulkEditDraft();
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => loadVisibleColumns());
  const [saving, setSaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Deep-linked or refreshed — the selection only lives in memory.
  useEffect(() => {
    if (!selection) navigate('/products', { replace: true });
  }, [selection, navigate]);

  const queryParams = useMemo(() => {
    if (!selection) return null;
    return selection.mode === 'ids'
      ? { ids: selection.ids.join(','), limit: BULK_EDIT_MAX_PRODUCTS }
      : { ...selection.filter, limit: BULK_EDIT_MAX_PRODUCTS };
  }, [selection]);

  const { data, isLoading, isError } = useAdminProductsFull(queryParams ?? {}, !!queryParams);
  const bulkUpdate = useBulkUpdateProducts();

  const { data: categories } = useAdminCategories();
  const { data: subcategoriesAll } = useAdminSubcategories();
  const { data: productTypesAll = [] } = useAdminProductTypes();
  const { data: brandsData = [] } = useAdminBrandsTable();
  const { data: originsData = [] } = useAdminOriginsTable();
  const { data: storesData } = useAdminStores({ limit: 200 });

  const products = useMemo(() => (data?.items ?? []) as unknown as BulkProduct[], [data]);
  const rows = useMemo(() => buildRows(products), [products]);

  const visibleColumns = useMemo<ColumnDef[]>(() => {
    const set = new Set(visibleKeys);
    // Registry order, not click order — so toggling a column back on puts it
    // where the admin expects rather than at the far right.
    return BULK_COLUMNS.filter((c) => c.key !== STICKY_COLUMN_KEY && set.has(c.key));
  }, [visibleKeys]);

  function updateColumns(keys: string[]) {
    setVisibleKeys(keys);
    saveVisibleColumns(keys);
  }

  // Variant id → product id, so variant-only edits still resolve to an item.
  const variantOwner = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) for (const v of p.variants ?? []) m.set(v.id, p.id);
    return m;
  }, [products]);

  const optionsFor = useCallback((source: OptionsSource, row: GridRow): ComboboxOption[] => {
    const blank: ComboboxOption = { value: '', label: '—' };
    switch (source) {
      case 'category':
        return (categories ?? []).map((c) => ({ value: c.id, label: c.name_es }));
      case 'subcategory': {
        // Cascade off whatever category the row currently shows, edited or not.
        const catId = pickCurrent(row, 'category_id', draft);
        return [blank, ...(subcategoriesAll ?? [])
          .filter((s) => !catId || s.category_id === catId)
          .map((s) => ({ value: s.id, label: s.name_es }))];
      }
      case 'productType': {
        const subId = pickCurrent(row, 'subcategory_id', draft);
        return [blank, ...productTypesAll
          .filter((pt) => !subId || pt.subcategory_id === subId)
          .map((pt) => ({ value: pt.id, label: pt.name_es }))];
      }
      case 'store':
        return [blank, ...(storesData?.items ?? []).map((s) => ({ value: s.id, label: s.name }))];
      case 'brand':
        return [blank, ...brandsData.map((b) => ({ value: b.name, label: b.name }))];
      case 'origin':
        return [blank, ...originsData.map((o) => ({ value: o.label_es ?? o.key, label: o.label_es ?? o.key }))];
      default:
        return [];
    }
  }, [categories, subcategoriesAll, productTypesAll, storesData, brandsData, originsData, draft]);

  // Refresh / tab close. The in-app exits route through ConfirmModal, and
  // this page renders outside AdminLayout so there's no sidebar to slip out by.
  useEffect(() => {
    if (!draft.isDirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) { e.preventDefault(); }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [draft.isDirty]);

  function goBack() {
    const to = selection?.returnTo ?? '/products';
    clearSelection();
    navigate(to);
  }

  async function handleSave() {
    if (draft.hasErrors) {
      toast.error(t('products.bulk.fixErrors'));
      return;
    }
    const items = draft.buildItems(variantOwner);
    if (items.length === 0) {
      toast.info(t('products.bulk.noChanges'));
      return;
    }

    setSaving(true);
    let ok = 0;
    const failedIds: string[] = [];

    try {
      for (let i = 0; i < items.length; i += SAVE_CHUNK) {
        const chunk = items.slice(i, i + SAVE_CHUNK);
        const res = await bulkUpdate.mutateAsync(chunk as AdminBulkUpdateItem[]);
        const failedSet = new Set(res.failed.map((f) => f.id));
        ok += res.updated;
        for (const item of chunk) {
          if (failedSet.has(item.id)) failedIds.push(item.id);
          // Only clear what actually saved — failed rows stay dirty so the
          // admin can retry without retyping.
          else draft.clearProduct(item.id, (item.variants ?? []).map((v) => v.id));
        }
      }

      if (failedIds.length > 0) {
        toast.warning(t('products.bulk.savedPartial', { ok, failed: failedIds.length }));
      } else {
        toast.success(t('products.bulk.savedAll', { count: ok }));
        goBack();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('products.bulk.actionFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (!selection) return null;

  const title = t('products.bulk.title', { count: products.length || selection.matchedTotal });

  return (
    // Fixed-height flex column: header stays put, the grid takes the rest of
    // the viewport instead of collapsing to row height.
    <div className="h-screen flex flex-col bg-surface-linen">
      <header className="shrink-0 bg-card border-b border-border px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <BackLink
            label={t('products.bulk.back')}
            onClick={() => (draft.isDirty ? setConfirmLeave(true) : goBack())}
            className="mb-6"
          />
          <span className="w-px h-6 bg-border" />
          <h1 className="text-base font-bold font-display text-ink truncate">{title}</h1>
          {draft.isDirty && (
            <span className="shrink-0 px-2 py-0.5 rounded-full bg-amber-mist text-amber-deep text-[11px] font-bold font-display tabular-nums">
              {draft.dirtyCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <ColumnsPicker visible={visibleKeys} onChange={updateColumns} />
          <button
            type="button"
            onClick={handleSave}
            disabled={!draft.isDirty || saving}
            className="inline-flex items-center gap-2 bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm px-5 h-10 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving
              ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
              : <Save className="w-4 h-4" strokeWidth={1.75} />}
            {saving ? t('products.bulk.saving') : t('products.bulk.save')}
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 p-6">
        {isLoading ? (
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <TableSkeleton rows={10} cols={6} />
          </div>
        ) : isError ? (
          <div className="bg-card border border-border rounded-xl">
            <EmptyState
              icon={<AlertTriangle size={28} strokeWidth={1.75} className="text-danger" />}
              title={t('products.bulk.loadFailed')}
              description=""
              action={{ label: t('products.bulk.back'), onClick: goBack }}
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="bg-card border border-border rounded-xl">
            <EmptyState
              title={t('products.bulk.empty')}
              description=""
              action={{ label: t('products.bulk.back'), onClick: goBack }}
            />
          </div>
        ) : (
          <BulkEditGrid
            rows={rows}
            visibleColumns={visibleColumns}
            draft={draft}
            optionsFor={optionsFor}
          />
        )}
      </main>

      <ConfirmModal
        open={confirmLeave}
        title={t('products.bulk.unsavedTitle')}
        message={t('products.bulk.unsavedBody')}
        confirmLabel={t('products.bulk.discard')}
        cancelLabel={t('products.bulk.keepEditing')}
        danger
        onConfirm={() => { setConfirmLeave(false); goBack(); }}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}

/** Current value of a product field on the row that owns it (edited or not). */
function pickCurrent(row: GridRow, field: string, draft: BulkEditDraft): string | null {
  if (row.kind !== 'product') return null;
  const { value, dirty } = draft.getCell('product', row.productId, field);
  const v = dirty ? value : row.product[field];
  return typeof v === 'string' ? v : null;
}
