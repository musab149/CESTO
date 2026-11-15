import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import {
  Plus, Search, Pencil, Package, Trash2, AlertTriangle, FileSpreadsheet,
  Flame, Copy, X, SlidersHorizontal, RotateCcw, Download, ChevronDown, Loader2,
  Table2, Zap, MoreHorizontal,
} from 'lucide-react';
import {
  useAdminProducts, useAdminCategories, useAdminSubcategories, useAdminProductTypes,
  useAdminBrandsTable, useAdminOriginsTable, useAdminStores,
  useDeleteProduct, usePurgeProduct, useBulkProductAction, resolveImageUrl,
  adminProducts, BULK_EDIT_MAX_PRODUCTS,
  type AdminProductsListParams,
} from '@grocery-app/shared';
import { TableSkeleton } from '@/components/Skeleton';
import { useTranslation } from 'react-i18next';
import ImportProductsModal from '@/components/ImportProductsModal';
import ConfirmModal from '@/components/ConfirmModal';
import Pagination from '@/components/Pagination';
import Combobox, { type ComboboxOption } from '@/components/form/Combobox';
import { AudienceRowSelect, NeedsB2bPriceDialog, useAudienceOptions, useAudienceWords } from '@/components/product/AudienceControls';
import type { ProductAudience, VatCategory } from '@grocery-app/shared';
import { useToast } from '@/components/Toast';
import { useBulkEditStore, toSelectionFilter } from '@/stores/bulkEditStore';
import QuickCreateProductModal from '@/components/QuickCreateProductModal';

const PAGE_SIZE = 50;

function formatCurrency(value: number) {
  return value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** URL param names for each filter dimension. Kept in one place so we can
 *  toggle without hunting each string literal through the file. */
const P = {
  q:        'q',
  category: 'category',
  sub:      'sub',
  type:     'type',
  brand:    'brand',
  origin:   'origin',
  store:    'store',
  status:   'status',      // 'active' | 'inactive'
  stock:    'stock',       // 'in' | 'out' | 'low'
  orders:   'orders',      // 'sold' | 'never'
  review:   'review',      // 'needed' — the quick-create queue
  audience: 'audience',    // 'all' | 'b2c' | 'b2b' — who the shop shows it to
  sort:     'sort',        // 'newest' | 'oldest' | 'name_asc' | 'name_desc' | 'rating_desc'
  page:     'page',
} as const;

type SortKey = NonNullable<AdminProductsListParams['sort']>;

type VatBand = VatCategory;

/**
 * The Spanish bands, with the examples that decide which is which.
 *
 * Spelled out because the person doing this is clearing a catalogue, not
 * reading tax law: staples are 4%, the rest of food is 10%, anything not
 * edible is 21%, and 0% is the default a product sits at until one is
 * chosen (2026-11-01). Rates themselves live in packages/shared/src/tax.ts.
 */
const VAT_BANDS: Array<{ value: VatBand; rate: string; nameKey: string; fallback: string; egKey: string; eg: string }> = [
  { value: 'zero',          rate: '0\u00a0%',  nameKey: 'products.vat.zero',         fallback: 'Sin IVA',       egKey: 'products.vat.zeroEg',         eg: 'El tipo por defecto si no eliges otro' },
  { value: 'super_reduced', rate: '4\u00a0%',  nameKey: 'products.vat.superReduced', fallback: 'Superreducido', egKey: 'products.vat.superReducedEg', eg: 'Pan, leche, huevos, fruta, verdura, queso, cereales' },
  { value: 'reduced',       rate: '10\u00a0%', nameKey: 'products.vat.reduced',      fallback: 'Reducido',      egKey: 'products.vat.reducedEg',      eg: 'El resto de la alimentaci\u00f3n' },
  { value: 'general',       rate: '21\u00a0%', nameKey: 'products.vat.general',      fallback: 'General',       egKey: 'products.vat.generalEg',      eg: 'Todo lo no alimentario' },
];

export default function ProductsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  // Full return URL — path + current query string. Passed to Add/Edit so
  // the form can navigate back to the exact page + filter state the admin
  // was on. Fixes the "save bounces me to page 1" bug.
  const returnTo = `${location.pathname}${location.search}`;

  // ─── Filter state (URL-backed) ───────────────────────
  const searchQuery   = searchParams.get(P.q) ?? '';
  const categoryId    = searchParams.get(P.category) ?? '';
  const subcategoryId = searchParams.get(P.sub) ?? '';
  const productTypeId = searchParams.get(P.type) ?? '';
  const brandId       = searchParams.get(P.brand) ?? '';
  const originId      = searchParams.get(P.origin) ?? '';
  const storeId       = searchParams.get(P.store) ?? '';
  const statusFilter  = searchParams.get(P.status) ?? '';         // '' | 'active' | 'inactive'
  const stockFilter   = searchParams.get(P.stock) ?? '';          // '' | 'in' | 'out' | 'low'
  const ordersFilter  = searchParams.get(P.orders) ?? '';         // '' | 'sold' | 'never'
  const audienceFilter = searchParams.get(P.audience) ?? '';      // '' | 'all' | 'b2c' | 'b2b'
  const sortFilter    = (searchParams.get(P.sort) ?? 'newest') as SortKey;
  const page          = Math.max(1, Number(searchParams.get(P.page) ?? '1') || 1);

  // ─── Data hooks ──────────────────────────────────────
  const { data: categories } = useAdminCategories();
  const { data: subcategoriesAll } = useAdminSubcategories();
  const { data: productTypes = [] } = useAdminProductTypes(
    subcategoryId ? { subcategoryId } : { subcategoryId: undefined },
  );
  const { data: brandsData = [] } = useAdminBrandsTable();
  const { data: originsData = [] } = useAdminOriginsTable();
  const { data: storesData } = useAdminStores({ limit: 200 });

  // Subcategories are returned as a single flat list — filter client-side
  // so the picker only shows children of the picked category.
  const subcategories = useMemo(() => {
    if (!subcategoryId && !categoryId) return subcategoriesAll ?? [];
    return (subcategoriesAll ?? []).filter((s) => s.category_id === categoryId);
  }, [subcategoriesAll, categoryId, subcategoryId]);

  // ─── Products query — translate URL state into service params ──
  const reviewFilter = searchParams.get(P.review) ?? '';

  const listParams: AdminProductsListParams = {
    q:            searchQuery.trim() || undefined,
    categoryId:   categoryId || undefined,
    subcategoryId:subcategoryId || undefined,
    productTypeId:productTypeId || undefined,
    brandId:      brandId || undefined,
    originId:     originId || undefined,
    storeId:      storeId || undefined,
    isActive:     statusFilter === 'active' ? 'true' : statusFilter === 'inactive' ? 'false' : undefined,
    stock:        (stockFilter === 'in' || stockFilter === 'out' || stockFilter === 'low') ? stockFilter : undefined,
    hasOrders:    ordersFilter === 'sold' ? 'true' : ordersFilter === 'never' ? 'false' : undefined,
    reviewNeeded: reviewFilter === 'needed' ? 'true' : undefined,
    audience:     (audienceFilter === 'all' || audienceFilter === 'b2c' || audienceFilter === 'b2b') ? audienceFilter : undefined,
    sort:         sortFilter !== 'newest' ? sortFilter : undefined,
    page,
    limit:        PAGE_SIZE,
  };
  const { data, isLoading } = useAdminProducts(listParams);
  const deleteProduct = useDeleteProduct();
  const purgeProduct = usePurgeProduct();

  const products = (data?.items ?? []) as Array<any>;

  // ─── Bulk selection ─────────────────────────────────
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState<'delete' | 'set_vat' | 'set_audience' | null>(null);
  const [vatChoice, setVatChoice] = useState<VatBand | ''>('');
  const [audienceChoice, setAudienceChoice] = useState<ProductAudience | ''>('');
  // After a bulk B2B only: those left as they were, for want of a B2B price.
  const [needsB2bPrice, setNeedsB2bPrice] = useState<{ count: number; products: Array<{ id: string; name_es: string }> } | null>(null);
  const audienceOptions = useAudienceOptions();
  const audienceWords = useAudienceWords();
  const bulkAction = useBulkProductAction();
  const setBulkSelection = useBulkEditStore((s) => s.setSelection);

  // Any filter or page change invalidates the selection — the rows it refers
  // to may no longer be on screen. Select-all-matching covers the case this
  // would otherwise serve.
  const paramsKey = searchParams.toString();
  useEffect(() => {
    setSelected(new Set());
    setSelectAllMatching(false);
  }, [paramsKey]);

  const total = data?.total ?? 0;
  const allOnPageSelected = products.length > 0 && products.every((p) => selected.has(p.id));
  const someSelected = selected.size > 0 && !allOnPageSelected;
  const effectiveCount = selectAllMatching ? total : selected.size;
  const canOpenGrid = effectiveCount > 0 && effectiveCount <= BULK_EDIT_MAX_PRODUCTS;

  function toggleRow(id: string) {
    setSelectAllMatching(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelectAllMatching(false);
    setSelected(allOnPageSelected ? new Set() : new Set(products.map((p) => p.id)));
  }

  function clearSelection() {
    setSelected(new Set());
    setSelectAllMatching(false);
  }

  async function runBulkAction(
    action: 'activate' | 'deactivate' | 'delete' | 'set_vat' | 'set_audience',
    vatCategory?: VatBand,
    audience?: ProductAudience,
  ) {
    try {
      const scope = selectAllMatching
        ? { filter: toSelectionFilter(listParams) }
        : { ids: Array.from(selected) };
      const res = await bulkAction.mutateAsync({
        action,
        ...scope,
        ...(vatCategory ? { vat_category: vatCategory } : {}),
        ...(audience ? { audience } : {}),
      });
      toast.success(t('products.bulk.actionDone', { count: res.updated }));
      if (res.needs_b2b_price) setNeedsB2bPrice({ count: res.needs_b2b_price, products: res.needs_b2b_price_products ?? [] });
      clearSelection();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('products.bulk.actionFailed'));
    }
  }

  function openBulkEdit() {
    setBulkSelection({
      mode: selectAllMatching ? 'filter' : 'ids',
      ids: Array.from(selected),
      filter: toSelectionFilter(listParams),
      matchedTotal: effectiveCount,
      returnTo,
    });
    navigate('/products/bulk-edit');
  }

  // ─── Delete modal state (unchanged from previous version) ─────
  const [deletePending, setDeletePending] = useState<{ id: string; name: string; isActive: boolean } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [purgeResult, setPurgeResult] = useState<{ orders_deleted: number; rashan_packs_updated: number; rashan_subscriptions_updated: number } | null>(null);

  // ─── Export dropdown ────────────────────────────────
  // Split menu next to Import — format picker + click-outside close.
  const [exportOpen, setExportOpen] = useState(false);
  /** The phone header's "More" menu (Duplicates, Import, Export). */
  const [moreOpen, setMoreOpen] = useState(false);
  const [exportPending, setExportPending] = useState<'csv' | 'xlsx' | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!exportOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!exportMenuRef.current) return;
      if (!exportMenuRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExportOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [exportOpen]);

  async function runExport(format: 'csv' | 'xlsx') {
    setExportOpen(false);
    setExportPending(format);
    try {
      // Same filters currently driving the list view — export follows what
      // the admin sees. Skip pagination-only params so we get everything.
      await adminProducts.downloadExport({ ...listParams, page: undefined, limit: undefined, format });
      toast.success(
        'Export ready',
        `Downloaded a ${format.toUpperCase()} of the currently filtered products.`,
      );
    } catch (err) {
      toast.error(
        'Export failed',
        err instanceof Error ? err.message : 'Something went wrong. Try again.',
      );
    } finally {
      setExportPending(null);
    }
  }

  // Filter drawer state — right-side panel. Esc closes; body scroll is
  // locked while open so the page beneath doesn't scroll under the drawer.
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    if (!filtersOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFiltersOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [filtersOpen]);

  // ─── Filter update helpers ──────────────────────────
  // `updates` is a partial map. Undefined value = delete the param. Any
  // filter change also drops `page` so the user doesn't land on page 5 of
  // an empty filtered set.
  function updateParams(updates: Partial<Record<keyof typeof P, string | undefined>>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(updates)) {
      const paramName = P[k as keyof typeof P];
      if (v == null || v === '') next.delete(paramName);
      else next.set(paramName, v);
    }
    next.delete(P.page);
    setSearchParams(next);
  }

  function setPage(nextPage: number) {
    const next = new URLSearchParams(searchParams);
    if (nextPage <= 1) next.delete(P.page);
    else next.set(P.page, String(nextPage));
    setSearchParams(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Cascade resets — picking a category clears sub + product type; picking
  // a subcategory clears product type. Keeps the URL and pickers in sync.
  function pickCategory(v: string)    { updateParams({ category: v, sub: '', type: '' }); }
  function pickSubcategory(v: string) { updateParams({ sub: v, type: '' }); }

  function clearAllFilters() {
    // Keep only sort so the user's ordering preference persists across resets.
    const next = new URLSearchParams();
    if (sortFilter !== 'newest') next.set(P.sort, sortFilter);
    setSearchParams(next);
  }

  // ─── Chip data for the active-filters row ────────────
  // Resolve IDs → display labels so the chip shows "Rice" not a UUID.
  const chipData = useMemo(() => {
    const chips: Array<{ key: keyof typeof P; label: string; onClear: () => void }> = [];
    if (searchQuery) {
      chips.push({ key: 'q', label: `“${searchQuery}”`, onClear: () => updateParams({ q: '' }) });
    }
    if (categoryId) {
      const c = (categories ?? []).find((x) => x.id === categoryId);
      chips.push({ key: 'category', label: `${t('products.chips.category')}: ${c?.name_es ?? '—'}`, onClear: () => updateParams({ category: '', sub: '', type: '' }) });
    }
    if (subcategoryId) {
      const s = (subcategoriesAll ?? []).find((x) => x.id === subcategoryId);
      chips.push({ key: 'sub', label: `${t('products.chips.subcategory')}: ${s?.name_es ?? '—'}`, onClear: () => updateParams({ sub: '', type: '' }) });
    }
    if (productTypeId) {
      const pt = productTypes.find((x) => x.id === productTypeId);
      chips.push({ key: 'type', label: `${t('products.chips.type')}: ${pt?.name_es ?? '—'}`, onClear: () => updateParams({ type: '' }) });
    }
    if (brandId) {
      const b = brandsData.find((x) => x.id === brandId);
      chips.push({ key: 'brand', label: `${t('products.chips.brand')}: ${b?.name ?? '—'}`, onClear: () => updateParams({ brand: '' }) });
    }
    if (originId) {
      const o = originsData.find((x) => x.id === originId);
      chips.push({ key: 'origin', label: `${t('products.chips.origin')}: ${o?.label_es ?? '—'}`, onClear: () => updateParams({ origin: '' }) });
    }
    if (storeId) {
      const st = (storesData?.items ?? []).find((x) => x.id === storeId);
      chips.push({ key: 'store', label: `${t('products.chips.store')}: ${st?.name ?? '—'}`, onClear: () => updateParams({ store: '' }) });
    }
    if (statusFilter) {
      chips.push({ key: 'status', label: statusFilter === 'active' ? t('products.active') : t('products.inactive'), onClear: () => updateParams({ status: '' }) });
    }
    if (stockFilter) {
      const label = stockFilter === 'in' ? t('products.inStock') : stockFilter === 'out' ? t('products.outOfStock') : t('products.stockStatus.lowStock');
      chips.push({ key: 'stock', label, onClear: () => updateParams({ stock: '' }) });
    }
    if (audienceFilter === 'all' || audienceFilter === 'b2c' || audienceFilter === 'b2b') {
      chips.push({ key: 'audience', label: `${t('audience.label', 'Shown to')}: ${audienceWords.label(audienceFilter)}`, onClear: () => updateParams({ audience: '' }) });
    }
    if (reviewFilter === 'needed') {
      chips.push({
        key: 'review',
        label: t('products.chips.reviewNeeded', 'Needs review'),
        onClear: () => updateParams({ review: '' }),
      });
    }
    if (ordersFilter) {
      chips.push({ key: 'orders', label: ordersFilter === 'sold' ? t('products.chips.sold') : t('products.chips.neverSold'), onClear: () => updateParams({ orders: '' }) });
    }
    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    searchQuery, categoryId, subcategoryId, productTypeId, brandId, originId, storeId,
    statusFilter, stockFilter, ordersFilter,
    categories, subcategoriesAll, productTypes, brandsData, originsData, storesData,
  ]);

  const hasAnyFilter = chipData.length > 0;

  // ─── Delete handlers (unchanged) ─────────────────────
  function openDelete(p: any) {
    setDeletePending({ id: p.id, name: p.name_es, isActive: p.is_active });
    setDeleteError(null);
    setPurgeConfirmText('');
    setPurgeResult(null);
  }
  async function doDeactivate() {
    if (!deletePending) return;
    setDeleteError(null);
    try {
      await deleteProduct.mutateAsync({ id: deletePending.id });
      setDeletePending(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Deactivate failed');
    }
  }
  async function doPermanentDelete() {
    if (!deletePending) return;
    setDeleteError(null);
    try {
      await deleteProduct.mutateAsync({ id: deletePending.id, permanent: true });
      setDeletePending(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
    }
  }
  async function doPurge() {
    if (!deletePending) return;
    setDeleteError(null);
    try {
      const res = await purgeProduct.mutateAsync(deletePending.id);
      setPurgeResult({
        orders_deleted: res.orders_deleted,
        rashan_packs_updated: res.rashan_packs_updated,
        rashan_subscriptions_updated: res.rashan_subscriptions_updated,
      });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Purge failed');
    }
  }

  // ─── Options ─────────────────────────────────────────
  const categoryOpts: ComboboxOption[] = [
    { value: '', label: t('products.allCategories') },
    ...(categories ?? []).map((c) => ({ value: c.id, label: c.name_es })),
  ];
  const subcategoryOpts: ComboboxOption[] = [
    { value: '', label: t('products.allSubcategories') },
    ...subcategories.map((s) => ({ value: s.id, label: s.name_es })),
  ];
  const productTypeOpts: ComboboxOption[] = [
    { value: '', label: t('products.allTypes') },
    ...productTypes.map((pt) => ({ value: pt.id, label: pt.name_es })),
  ];
  const brandOpts: ComboboxOption[] = [
    { value: '', label: t('products.allBrands') },
    ...brandsData.map((b) => ({ value: b.id, label: b.name })),
  ];
  const originOpts: ComboboxOption[] = [
    { value: '', label: t('products.allOrigins') },
    ...originsData.map((o) => ({ value: o.id, label: o.label_es })),
  ];
  const storeOpts: ComboboxOption[] = [
    { value: '', label: t('products.allStores') },
    ...((storesData?.items ?? []).map((s) => ({ value: s.id, label: s.name }))),
  ];
  const statusOpts: ComboboxOption[] = [
    { value: '',         label: t('products.allStatus') },
    { value: 'active',   label: t('products.active') },
    { value: 'inactive', label: t('products.inactive') },
  ];
  const stockOpts: ComboboxOption[] = [
    { value: '',    label: t('products.allStock') },
    { value: 'in',  label: t('products.inStock') },
    { value: 'low', label: t('products.stockStatus.lowStock') },
    { value: 'out', label: t('products.outOfStock') },
  ];
  const ordersOpts: ComboboxOption[] = [
    { value: '',      label: t('products.allOrders') },
    { value: 'sold',  label: t('products.chips.sold') },
    { value: 'never', label: t('products.chips.neverSold') },
  ];
  const sortOpts: ComboboxOption[] = [
    { value: 'newest',      label: t('products.sort.newest') },
    { value: 'oldest',      label: t('products.sort.oldest') },
    { value: 'name_asc',    label: t('products.sort.nameAsc') },
    { value: 'name_desc',   label: t('products.sort.nameDesc') },
    { value: 'rating_desc', label: t('products.sort.ratingDesc') },
  ];

  return (
    <div className="space-y-0">
      {/* The actions WRAP to a second line rather than squeeze: in one
          unbreakable row, "Import from Excel" and "Add product" broke onto
          two lines on a laptop and pushed the whole page sideways below
          ~1230px. */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold font-display text-ink">
            {t('products.title')}
            {!isLoading && (
              <span className="text-base font-normal text-muted ml-2">({data?.total ?? products.length})</span>
            )}
          </h1>
          <p className="text-sm text-muted mt-1">{t('products.subtitle')}</p>
        </div>
        {/* ON A PHONE (2026-11-05): two rows — the six 52px buttons took the
            whole first screen. Add + Quick add, then Filters + a More menu
            with the rest. From sm the row below is the one there was. */}
        <div className="sm:hidden w-full space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => navigate('/products/new', { state: { from: returnTo } })}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm px-4 rounded-xl h-11 transition"
            >
              <Plus className="w-5 h-5" strokeWidth={1.75} />
              {t('products.addProduct')}
            </button>
            <button
              type="button"
              onClick={() => setQuickCreateOpen(true)}
              className="inline-flex items-center justify-center gap-1.5 bg-card border-2 border-border text-ink font-semibold font-display text-sm px-3.5 rounded-xl h-11 transition"
            >
              <Zap className="w-4 h-4" strokeWidth={1.75} />
              {t('products.quickAdd', 'Quick add')}
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className={`flex-1 relative inline-flex items-center justify-center gap-2 bg-card border-2 text-ink font-semibold font-display text-sm px-4 rounded-xl h-11 transition ${
                hasAnyFilter ? 'border-brand' : 'border-border'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" strokeWidth={1.75} />
              {t('products.filters.title')}
              {hasAnyFilter && (
                <span className="min-w-[20px] h-5 inline-flex items-center justify-center px-1.5 rounded-full bg-brand text-white text-[11px] font-bold tabular-nums">
                  {chipData.length}
                </span>
              )}
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                disabled={exportPending !== null}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                className="inline-flex items-center justify-center gap-1.5 bg-card border-2 border-border text-ink font-semibold font-display text-sm px-3.5 rounded-xl h-11 transition disabled:opacity-60"
              >
                {exportPending
                  ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
                  : <MoreHorizontal className="w-4 h-4" strokeWidth={1.75} />}
                {t('products.more', 'More')}
              </button>
              {moreOpen && (
                <>
                  {/* Tapping anywhere else closes it. */}
                  <button type="button" aria-hidden tabIndex={-1} onClick={() => setMoreOpen(false)} className="fixed inset-0 z-20 cursor-default" />
                  <div role="menu" className="absolute right-0 mt-2 w-64 bg-card border border-border rounded-xl shadow-modal z-30 overflow-hidden">
                    {[
                      { key: 'dupes', icon: Copy, label: t('products.duplicates', 'Duplicates'), run: () => navigate('/products/duplicates') },
                      { key: 'import', icon: FileSpreadsheet, label: t('products.importFromExcel'), run: () => setImportOpen(true) },
                      { key: 'xlsx', icon: FileSpreadsheet, label: t('products.exportXlsx', 'Export Excel (.xlsx)'), run: () => runExport('xlsx') },
                      { key: 'csv', icon: Download, label: t('products.exportCsv', 'Export CSV (.csv)'), run: () => runExport('csv') },
                    ].map((item, idx) => (
                      <button
                        key={item.key}
                        type="button"
                        role="menuitem"
                        onClick={() => { setMoreOpen(false); item.run(); }}
                        className={`w-full flex items-center gap-3 px-4 h-12 text-left active:bg-brand-mist/40 transition ${idx > 0 ? 'border-t border-border' : ''}`}
                      >
                        <item.icon className="w-5 h-5 text-brand shrink-0" strokeWidth={1.75} />
                        <span className="text-sm font-semibold font-display text-ink">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="hidden sm:flex flex-wrap items-center gap-3 [&_button]:whitespace-nowrap">
          <button
            type="button"
            onClick={() => navigate('/products/duplicates')}
            className="inline-flex items-center gap-2 bg-card border-2 border-border hover:border-amber hover:bg-amber-mist/30 text-ink font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition"
            title="Find and merge duplicate products"
          >
            <Copy className="w-5 h-5" strokeWidth={1.75} />
            Duplicates
          </button>
          {/* Filter drawer trigger. Icon + label, with a count badge showing
              how many filters are currently applied so the button reads at a
              glance without opening the drawer. */}
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className={`relative inline-flex items-center gap-2 bg-card border-2 text-ink font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition ${
              hasAnyFilter
                ? 'border-brand hover:bg-brand-mist/40'
                : 'border-border hover:border-brand hover:bg-brand-mist/40'
            }`}
            title={t('products.filters.title')}
          >
            <SlidersHorizontal className="w-5 h-5" strokeWidth={1.75} />
            {t('products.filters.title')}
            {hasAnyFilter && (
              <span className="min-w-[20px] h-5 inline-flex items-center justify-center px-1.5 rounded-full bg-brand text-white text-[11px] font-bold tabular-nums">
                {chipData.length}
              </span>
            )}
          </button>
          {/* Export dropdown — CSV / XLSX. Uses the same filter params
              the table is showing, so admin exports what they see. */}
          <div className="relative" ref={exportMenuRef}>
            <button
              type="button"
              onClick={() => setExportOpen((v) => !v)}
              disabled={exportPending !== null}
              aria-haspopup="menu"
              aria-expanded={exportOpen}
              className="inline-flex items-center gap-2 bg-card border-2 border-border hover:border-brand hover:bg-brand-mist/40 text-ink font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition disabled:opacity-60 disabled:cursor-wait"
              title="Download the currently filtered products as CSV or XLSX"
            >
              {exportPending ? (
                <Loader2 className="w-5 h-5 animate-spin" strokeWidth={1.75} />
              ) : (
                <Download className="w-5 h-5" strokeWidth={1.75} />
              )}
              {exportPending ? `Exporting ${exportPending.toUpperCase()}…` : 'Export'}
              {!exportPending && <ChevronDown className="w-4 h-4 -ml-1" strokeWidth={1.75} />}
            </button>
            {exportOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-56 bg-card border border-border rounded-xl shadow-modal z-30 overflow-hidden"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => runExport('xlsx')}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-brand-mist/40 text-left transition"
                >
                  <FileSpreadsheet className="w-5 h-5 text-brand mt-0.5 shrink-0" strokeWidth={1.75} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold font-display text-ink">Excel (.xlsx)</p>
                    <p className="text-[11px] text-muted font-body">Formatted, ready for Excel or Sheets.</p>
                  </div>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => runExport('csv')}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-brand-mist/40 text-left border-t border-border transition"
                >
                  <Download className="w-5 h-5 text-brand mt-0.5 shrink-0" strokeWidth={1.75} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold font-display text-ink">CSV (.csv)</p>
                    <p className="text-[11px] text-muted font-body">Plain text, matches the Import format.</p>
                  </div>
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-2 bg-card border-2 border-border hover:border-brand hover:bg-brand-mist/40 text-ink font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition"
          >
            <FileSpreadsheet className="w-5 h-5" strokeWidth={1.75} />
            {t('products.importFromExcel')}
          </button>
          <button
            type="button"
            onClick={() => setQuickCreateOpen(true)}
            className="inline-flex items-center gap-2 bg-card border-2 border-border hover:border-brand text-ink font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition"
          >
            <Zap className="w-5 h-5" strokeWidth={1.75} />
            {t('products.quickAdd', 'Quick add')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/products/new', { state: { from: returnTo } })}
            className="inline-flex items-center gap-2 bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition"
          >
            <Plus className="w-5 h-5" strokeWidth={1.75} />
            {t('products.addProduct')}
          </button>
        </div>
      </div>

      {/* ─── Bulk selection bar — takes the chips row's slot while any row
          is ticked, so the two never stack and shove the table down. */}
      {selected.size > 0 && (
        <div className="bg-card rounded-xl border-2 border-brand p-3 mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold font-display text-ink shrink-0 pl-1 tabular-nums">
            {t('products.bulk.selected', { count: effectiveCount })}
          </span>

          <button
            type="button"
            onClick={openBulkEdit}
            disabled={!canOpenGrid}
            title={canOpenGrid ? undefined : t('products.bulk.tooManyForGrid', { max: BULK_EDIT_MAX_PRODUCTS, count: effectiveCount })}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand hover:bg-brand-mid text-white text-xs font-bold font-display transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Table2 className="w-3.5 h-3.5" strokeWidth={1.75} />
            {t('products.bulk.edit')}
          </button>

          <button
            type="button"
            onClick={() => runBulkAction('activate')}
            disabled={bulkAction.isPending}
            className="h-8 px-3 rounded-lg bg-card border border-border hover:border-brand hover:bg-brand-mist/40 text-ink text-xs font-semibold font-display transition disabled:opacity-50"
          >
            {t('products.bulk.activate')}
          </button>
          <button
            type="button"
            onClick={() => runBulkAction('deactivate')}
            disabled={bulkAction.isPending}
            className="h-8 px-3 rounded-lg bg-card border border-border hover:border-brand hover:bg-brand-mist/40 text-ink text-xs font-semibold font-display transition disabled:opacity-50"
          >
            {t('products.bulk.deactivate')}
          </button>
          {/* The one action that makes a product invoiceable. Unlike the
              others it needs an answer, so it opens rather than fires. */}
          <button
            type="button"
            onClick={() => { setVatChoice(''); setBulkConfirm('set_vat'); }}
            disabled={bulkAction.isPending}
            className="h-8 px-3 rounded-lg bg-card border border-border hover:border-brand hover:bg-brand-mist/40 text-ink text-xs font-semibold font-display transition disabled:opacity-50"
          >
            {t('products.bulk.setVat', 'Set IVA')}
          </button>
          {/* Who the shop shows them to — needs an answer, so it opens. */}
          <button
            type="button"
            onClick={() => { setAudienceChoice(''); setBulkConfirm('set_audience'); }}
            disabled={bulkAction.isPending}
            className="h-8 px-3 rounded-lg bg-card border border-border hover:border-brand hover:bg-brand-mist/40 text-ink text-xs font-semibold font-display transition disabled:opacity-50"
          >
            {t('audience.bulkButton', 'Show to…')}
          </button>
          <button
            type="button"
            onClick={() => setBulkConfirm('delete')}
            // Filter-scoped delete is refused server-side — too easy to wipe a
            // catalogue by accident. Tick the rows to delete them.
            disabled={bulkAction.isPending || selectAllMatching}
            title={selectAllMatching ? t('products.bulk.tooManyForGrid', { max: BULK_EDIT_MAX_PRODUCTS, count: effectiveCount }) : undefined}
            className="h-8 px-3 rounded-lg bg-card border border-border hover:border-danger hover:bg-danger-bg text-danger text-xs font-semibold font-display transition disabled:opacity-50"
          >
            {t('products.bulk.delete')}
          </button>

          {bulkAction.isPending && <Loader2 className="w-4 h-4 animate-spin text-brand" strokeWidth={1.75} />}

          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold font-display text-muted hover:text-ink transition"
          >
            <X className="w-3.5 h-3.5" strokeWidth={2} />
            {t('products.bulk.clearSelection')}
          </button>

          {/* Select-all-matching — only meaningful once the whole page is
              ticked and there are more rows behind the filter. */}
          {allOnPageSelected && total > products.length && (
            <div className="w-full border-t border-border pt-2 mt-1 text-xs font-body text-muted">
              {selectAllMatching ? (
                <>
                  {t('products.bulk.allMatchingSelected', { count: total })}{' '}
                  <button type="button" onClick={() => setSelectAllMatching(false)} className="font-semibold font-display text-brand hover:underline">
                    {t('products.bulk.clearSelection')}
                  </button>
                </>
              ) : (
                <>
                  {t('products.bulk.pageSelected', { count: products.length })}{' '}
                  <button type="button" onClick={() => setSelectAllMatching(true)} className="font-semibold font-display text-brand hover:underline">
                    {t('products.bulk.selectAllMatching', { count: total })}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── Active-filter chips — always above the table when any filter
          is applied. Independent of the drawer so users see + remove
          filters without opening the drawer. */}
      {hasAnyFilter && selected.size === 0 && (
        <div className="bg-card rounded-xl border border-border p-3 mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted font-display shrink-0 pl-1">
            {t('products.filters.active')}
          </span>
          {chipData.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onClear}
              className="inline-flex items-center gap-1.5 h-7 pl-3 pr-2 rounded-full bg-brand text-white text-[11.5px] font-display font-bold hover:bg-brand-mid transition-colors"
            >
              {chip.label}
              <X className="w-3 h-3" strokeWidth={2.5} />
            </button>
          ))}
          <button
            type="button"
            onClick={clearAllFilters}
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold font-display text-danger hover:text-danger/80 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
            {t('products.filters.clearAll')}
          </button>
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={8} cols={8} />
      ) : products.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-cream flex items-center justify-center mx-auto mb-4">
            <Package className="w-8 h-8 text-muted" strokeWidth={1.75} />
          </div>
          <h3 className="text-lg font-semibold font-display text-ink mb-1">{t('products.noResults')}</h3>
          <p className="text-sm text-muted mb-4">{t('products.noResultsHint')}</p>
          {hasAnyFilter ? (
            <button
              type="button"
              onClick={clearAllFilters}
              className="inline-flex items-center gap-2 bg-card border-2 border-border hover:border-brand text-ink font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition"
            >
              <RotateCcw className="w-4 h-4" strokeWidth={1.75} />
              {t('products.filters.clearAll')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/products/new', { state: { from: returnTo } })}
              className="inline-flex items-center gap-2 bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition"
            >
              <Plus className="w-5 h-5" strokeWidth={1.75} />
              {t('products.addProduct')}
            </button>
          )}
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {/* ON A PHONE: a list (table → list below sm). The table needed
              780px; price, stock, status and the actions were off to the
              right. Tap a product to open it; the box ticks it for the bulk
              bar, and the first row ticks the whole page. */}
          <ul className="sm:hidden divide-y divide-border">
            <li className="flex items-center gap-3 px-3 py-2 bg-surface-cream">
              <label className="flex items-center gap-3 py-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAllOnPage}
                  className="w-5 h-5 rounded border-border text-brand focus:ring-brand"
                />
                <span className="text-xs font-semibold uppercase tracking-wide text-gray font-display">
                  {t('products.selectPage', 'Select this page')}
                </span>
              </label>
            </li>
            {products.map((p) => {
              const defaultVariant = p.variants?.find((v: any) => v.is_default) ?? p.variants?.[0] ?? null;
              const totalStock = p.variants?.reduce((sum: number, v: any) => sum + (v.stock_quantity ?? 0), 0) ?? 0;
              const stockStatus: 'out' | 'low' | 'ok' =
                totalStock === 0
                  ? 'out'
                  : defaultVariant && defaultVariant.stock_quantity <= (defaultVariant.low_stock_threshold ?? 0)
                    ? 'low'
                    : 'ok';
              const imageUrl = p.images?.[0]?.url ?? null;
              const b2bPrice = defaultVariant?.b2b_price;
              const hasB2b = b2bPrice != null && b2bPrice !== '';
              const costPrice = Number(defaultVariant?.cost_price ?? 0);
              return (
                <li key={p.id} className={`flex gap-2 px-3 py-3 ${selected.has(p.id) ? 'bg-brand-mist/40' : ''}`}>
                  <label className="shrink-0 -my-1 py-1 pr-1 flex items-start pt-3.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={() => toggleRow(p.id)}
                      aria-label={p.name_es}
                      className="w-5 h-5 rounded border-border text-brand focus:ring-brand"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => navigate(`/products/${p.id}/edit`, { state: { from: returnTo } })}
                    className="flex gap-3 flex-1 min-w-0 text-left"
                  >
                    {imageUrl ? (
                      <img src={resolveImageUrl(imageUrl, 'thumb')} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                    ) : (
                      <span className="w-12 h-12 rounded-lg bg-surface-cream flex items-center justify-center shrink-0">
                        <Package className="w-5 h-5 text-muted" strokeWidth={1.75} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink font-display leading-snug line-clamp-2">{p.name_es}</span>
                      <span className="block text-xs text-muted truncate mt-0.5">
                        {[p.brand, p.category?.name_es].filter(Boolean).join(' · ') || '—'}
                      </span>
                      <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 mt-1 text-xs tabular-nums">
                        <span className="text-sm font-semibold text-ink">
                          {defaultVariant ? `${formatCurrency(Number(defaultVariant.price))} €` : '—'}
                        </span>
                        {hasB2b && (
                          <span className="text-amber-deep font-semibold">B2B {formatCurrency(Number(b2bPrice))} €</span>
                        )}
                        {costPrice > 0 && (
                          <span className="text-muted">{t('products.table.costPrice', 'Buying price')} {formatCurrency(costPrice)} €</span>
                        )}
                      </span>
                    </span>
                  </button>
                  <span className="shrink-0 flex flex-col items-end gap-1.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold font-display ${
                      p.is_active ? 'bg-success-bg text-success' : 'bg-gray-100 text-gray'
                    }`}>
                      {p.is_active ? t('products.active') : t('products.inactive')}
                    </span>
                    <span className={`text-xs font-semibold tabular-nums ${
                      stockStatus === 'out' ? 'text-danger' : stockStatus === 'low' ? 'text-warning' : 'text-gray'
                    }`}>
                      {stockStatus === 'out'
                        ? t('products.stockStatus.outOfStock')
                        : t('products.inStockCount', '{{n}} in stock', { n: totalStock })}
                    </span>
                    <button
                      type="button"
                      onClick={() => openDelete(p)}
                      aria-label={t('products.deleteProduct', 'Delete')}
                      className="w-9 h-9 -mr-1.5 rounded-lg active:bg-danger-bg flex items-center justify-center transition"
                    >
                      <Trash2 className="w-4 h-4 text-danger" strokeWidth={1.75} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="hidden sm:block overflow-x-auto">
          <table className="w-full min-w-[780px]">
            <thead>
              <tr className="bg-surface-cream">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    // form/Checkbox has no indeterminate support and needs a
                    // label node, so the tri-state header uses a raw input.
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleAllOnPage}
                    className="w-4 h-4 rounded border-border text-brand focus:ring-brand cursor-pointer"
                  />
                </th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('products.table.image')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('products.table.name')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('products.table.category')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('products.table.price')}</th>
                <th className="text-right text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('products.table.b2bPrice', 'B2B price')}</th>
                <th className="text-right text-xs font-semibold text-gray uppercase px-4 py-3 font-display" title={t('products.table.costPriceHint', 'What we pay for one. Only admins see it.')}>{t('products.table.costPrice', 'Buying price')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('products.table.stock')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('products.table.status')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('audience.label', 'Shown to')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('products.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const defaultVariant = p.variants?.find((v: any) => v.is_default) ?? p.variants?.[0] ?? null;
                const totalStock = p.variants?.reduce((s: number, v: any) => s + (v.stock_quantity ?? 0), 0) ?? 0;
                const stockStatus: 'out' | 'low' | 'ok' =
                  totalStock === 0
                    ? 'out'
                    : defaultVariant && defaultVariant.stock_quantity <= (defaultVariant.low_stock_threshold ?? 0)
                      ? 'low'
                      : 'ok';
                const imageUrl = p.images?.[0]?.url ?? null;
                const categoryName = p.category?.name_es ?? '—';
                const b2bPrice = defaultVariant?.b2b_price;
                const hasB2b = b2bPrice != null && b2bPrice !== '';
                // The buying price (admin only); 0 until someone enters it.
                const costPrice = Number(defaultVariant?.cost_price ?? 0);

                return (
                  <tr key={p.id} className={`border-t border-border transition ${selected.has(p.id) ? 'bg-brand-mist/40' : 'hover:bg-brand-mist/30'}`}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleRow(p.id)}
                        className="w-4 h-4 rounded border-border text-brand focus:ring-brand cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3">
                      {imageUrl ? (
                        <img src={resolveImageUrl(imageUrl, 'thumb')} alt={p.name_es} className="w-10 h-10 rounded-lg object-cover" />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-surface-cream flex items-center justify-center">
                          <Package className="w-5 h-5 text-muted" strokeWidth={1.75} />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-ink font-display">{p.name_es}</span>
                      {p.brand && <span className="block text-xs text-muted mt-0.5">{p.brand}</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink">{categoryName}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-ink">
                      {defaultVariant ? `${formatCurrency(Number(defaultVariant.price))} €` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums">
                      {hasB2b ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-mist/70 text-amber-deep font-semibold px-2 py-0.5">
                          €{formatCurrency(Number(b2bPrice))}
                        </span>
                      ) : (
                        <span className="text-muted italic text-xs">{t('products.table.noB2b', 'Not set')}</span>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right text-sm tabular-nums ${costPrice > 0 ? 'text-ink' : 'text-muted'}`}>
                      {defaultVariant ? `${formatCurrency(costPrice)} €` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-sm font-semibold ${
                          stockStatus === 'out' ? 'text-danger' : stockStatus === 'low' ? 'text-warning' : 'text-ink'
                        }`}
                      >
                        {totalStock}
                      </span>
                      {stockStatus === 'out' && <span className="block text-xs text-danger">{t('products.stockStatus.outOfStock')}</span>}
                      {stockStatus === 'low' && <span className="block text-xs text-warning">{t('products.stockStatus.lowStock')}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display ${
                          p.is_active ? 'bg-success-bg text-success' : 'bg-gray-100 text-gray'
                        }`}
                      >
                        {p.is_active ? t('products.active') : t('products.inactive')}
                      </span>
                    </td>
                    {/* Who the shop shows it to — changed right here. */}
                    <td className="px-4 py-3">
                      <AudienceRowSelect productId={p.id} name={p.name_es} value={p.audience} variants={p.variants} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => navigate(`/products/${p.id}/edit`, { state: { from: returnTo } })}
                          className="w-9 h-9 rounded-lg bg-surface-cream hover:bg-brand-mist flex items-center justify-center transition"
                          title={t('products.editProduct')}
                        >
                          <Pencil className="w-4 h-4 text-ink" strokeWidth={1.75} />
                        </button>
                        <button
                          type="button"
                          onClick={() => openDelete(p)}
                          className="w-9 h-9 rounded-lg hover:bg-danger-bg flex items-center justify-center transition"
                          title="Delete"
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
        </div>
      )}

      {!isLoading && data && (
        <Pagination
          page={page}
          totalPages={data.totalPages ?? 1}
          onPageChange={setPage}
          totalItems={data.total}
          pageSize={PAGE_SIZE}
          className="mt-6"
        />
      )}

      {/* ─── Import from Excel Modal ─────────────────────── */}
      <ImportProductsModal open={importOpen} onClose={() => setImportOpen(false)} />

      {/* ─── Bulk delete confirm ──────────────────────────── */}
      <ConfirmModal
        open={bulkConfirm === 'delete'}
        title={t('products.bulk.deleteTitle')}
        message={t('products.bulk.deleteBody', { count: effectiveCount })}
        confirmLabel={t('products.bulk.delete')}
        danger
        onConfirm={() => { setBulkConfirm(null); runBulkAction('delete'); }}
        onCancel={() => setBulkConfirm(null)}
      />

      {/* Who the shop shows the selection to. */}
      <ConfirmModal
        open={bulkConfirm === 'set_audience'}
        title={t('audience.bulkTitle', 'Who sees these products?')}
        message={t('audience.bulkBody', {
          count: effectiveCount,
          defaultValue: 'Applies to {{count}} product(s), in the shop and the app.',
        })}
        confirmLabel={t('audience.bulkConfirm', 'Apply')}
        confirmDisabled={!audienceChoice}
        onConfirm={() => {
          const choice = audienceChoice;
          setBulkConfirm(null);
          if (choice) void runBulkAction('set_audience', undefined, choice);
        }}
        onCancel={() => setBulkConfirm(null)}
      >
        <div className="space-y-2">
          {(['all', 'b2c', 'b2b'] as ProductAudience[]).map((a) => {
            const picked = audienceChoice === a;
            return (
              <button
                key={a}
                type="button"
                onClick={() => setAudienceChoice(a)}
                className={`w-full text-left rounded-lg border-2 px-3 py-2.5 transition-colors ${
                  picked ? 'border-brand bg-brand-mist/40' : 'border-border hover:border-brand/40'
                }`}
              >
                <span className="block text-sm font-semibold font-display text-ink">{audienceWords.label(a)}</span>
                <span className="block text-xs font-body text-gray mt-0.5">{audienceWords.hint(a)}</span>
              </button>
            );
          })}
          {audienceChoice === 'b2b' && (
            <p className="text-xs font-body text-gray pt-1">
              {t('audience.bulkB2bNote', 'Products with a size that has no B2B price are left as they are. You will see which, and can price them there.')}
            </p>
          )}
        </div>
      </ConfirmModal>

      {needsB2bPrice && (
        <NeedsB2bPriceDialog
          count={needsB2bPrice.count}
          products={needsB2bPrice.products}
          onClose={() => setNeedsB2bPrice(null)}
        />
      )}

      {/* ─── Bulk IVA ─────────────────────────────────────
          Setting a band also marks it reviewed, which is the whole point:
          an unreviewed rate blocks a factura, so this is what turns a
          catalogue into one that can be invoiced. */}
      <ConfirmModal
        open={bulkConfirm === 'set_vat'}
        title={t('products.bulk.setVatTitle', 'Set the IVA rate')}
        message={t('products.bulk.setVatBody', {
          count: effectiveCount,
          defaultValue: 'Applies to {{count}} product(s). Their prices are stored without IVA, so what customers pay will include this rate.',
        })}
        confirmLabel={t('products.bulk.setVat', 'Set IVA')}
        confirmDisabled={!vatChoice}
        onConfirm={() => {
          const band = vatChoice;
          setBulkConfirm(null);
          if (band) void runBulkAction('set_vat', band);
        }}
        onCancel={() => setBulkConfirm(null)}
      >
        <div className="space-y-2">
          {VAT_BANDS.map((b) => {
            const picked = vatChoice === b.value;
            return (
              <button
                key={b.value}
                type="button"
                onClick={() => setVatChoice(b.value)}
                className={`w-full text-left rounded-lg border-2 px-3 py-2.5 transition-colors ${
                  picked ? 'border-brand bg-brand-mist/40' : 'border-border hover:border-brand/40'
                }`}
              >
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-sm font-semibold text-ink">{b.rate}</span>
                  <span className="text-sm font-semibold font-display text-ink">{t(b.nameKey, b.fallback)}</span>
                </span>
                <span className="block text-xs font-body text-gray mt-0.5">{t(b.egKey, b.eg)}</span>
              </button>
            );
          })}
        </div>
      </ConfirmModal>

      {/* ─── Filters drawer ────────────────────────────────
          Right-side panel with every filter picker. Every change writes
          to the URL immediately so there is no explicit Apply — closing
          the drawer just hides the pickers. Search lives in here too so
          the header stays clean. */}
      {filtersOpen && (
        <>
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setFiltersOpen(false)}
            className="fixed inset-0 z-40 bg-black/50"
          />
          <aside
            className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[420px] bg-card shadow-modal flex flex-col"
            role="dialog"
            aria-label={t('products.filters.title')}
          >
            {/* Drawer header */}
            <div className="h-14 shrink-0 px-4 border-b border-border flex items-center justify-between">
              <div className="inline-flex items-center gap-2 font-display font-bold text-ink">
                <SlidersHorizontal className="w-4 h-4" strokeWidth={2} />
                {t('products.filters.title')}
                {hasAnyFilter && (
                  <span className="min-w-[20px] h-5 inline-flex items-center justify-center px-1.5 rounded-full bg-brand text-white text-[11px] font-bold tabular-nums">
                    {chipData.length}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="w-8 h-8 rounded-lg text-ink/60 hover:text-ink hover:bg-surface-cream inline-flex items-center justify-center transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" strokeWidth={1.75} />
              </button>
            </div>

            {/* Drawer body — scrolls independently. */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Search */}
              <FilterField label={t('products.searchPlaceholder')}>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" strokeWidth={1.75} />
                  <input
                    type="text"
                    aria-label={t('products.searchPlaceholder')}
                    placeholder={t('products.searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => updateParams({ q: e.target.value })}
                    className="w-full bg-surface-cream border border-border rounded-lg h-11 pl-10 pr-4 text-sm font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </div>
              </FilterField>

              {/* Cascade block — visually grouped so the parent/child
                  relationship reads immediately. */}
              <div className="rounded-lg bg-surface-cream/60 border border-border p-3 space-y-2.5">
                <FilterField label={t('products.chips.category')}>
                  <Combobox
                    value={categoryId}
                    onChange={pickCategory}
                    ariaLabel={t('products.allCategories')}
                    placeholder={t('products.allCategories')}
                    options={categoryOpts}
                    searchable
                    searchPlaceholder="Buscar categoría…"
                    menuPortal
                  />
                </FilterField>
                <FilterField label={t('products.chips.subcategory')}>
                  <Combobox
                    value={subcategoryId}
                    onChange={pickSubcategory}
                    ariaLabel={t('products.allSubcategories')}
                    placeholder={categoryId ? t('products.allSubcategories') : t('products.filters.pickCategoryFirst')}
                    options={subcategoryOpts}
                    disabled={!categoryId}
                    searchable
                    searchPlaceholder="Buscar subcategoría…"
                    menuPortal
                  />
                </FilterField>
                <FilterField label={t('products.chips.type')}>
                  <Combobox
                    value={productTypeId}
                    onChange={(v) => updateParams({ type: v })}
                    ariaLabel={t('products.allTypes')}
                    placeholder={subcategoryId ? t('products.allTypes') : t('products.filters.pickSubcategoryFirst')}
                    options={productTypeOpts}
                    disabled={!subcategoryId}
                    menuPortal
                  />
                </FilterField>
              </div>

              <FilterField label={t('products.chips.brand')}>
                <Combobox
                  value={brandId}
                  onChange={(v) => updateParams({ brand: v })}
                  ariaLabel={t('products.allBrands')}
                  placeholder={t('products.allBrands')}
                  options={brandOpts}
                  searchable
                  searchPlaceholder="Buscar marca…"
                  menuPortal
                />
              </FilterField>
              <FilterField label={t('products.chips.origin')}>
                <Combobox
                  value={originId}
                  onChange={(v) => updateParams({ origin: v })}
                  ariaLabel={t('products.allOrigins')}
                  placeholder={t('products.allOrigins')}
                  options={originOpts}
                  searchable
                  searchPlaceholder="Buscar origen…"
                  menuPortal
                />
              </FilterField>
              <FilterField label={t('products.chips.store')}>
                <Combobox
                  value={storeId}
                  onChange={(v) => updateParams({ store: v })}
                  ariaLabel={t('products.allStores')}
                  placeholder={t('products.allStores')}
                  options={storeOpts}
                  searchable
                  searchPlaceholder="Buscar tienda…"
                  menuPortal
                />
              </FilterField>
              <FilterField label={t('products.chips.status')}>
                <Combobox value={statusFilter} onChange={(v) => updateParams({ status: v })} ariaLabel={t('products.allStatus')} placeholder={t('products.allStatus')} options={statusOpts} menuPortal />
              </FilterField>
              <FilterField label={t('products.chips.stock')}>
                <Combobox value={stockFilter} onChange={(v) => updateParams({ stock: v })} ariaLabel={t('products.allStock')} placeholder={t('products.allStock')} options={stockOpts} menuPortal />
              </FilterField>
              <FilterField label={t('audience.label', 'Shown to')}>
                <Combobox
                  value={audienceFilter}
                  onChange={(v) => updateParams({ audience: v })}
                  ariaLabel={t('audience.label', 'Shown to')}
                  placeholder={t('audience.any', 'Any audience')}
                  options={[{ value: '', label: t('audience.any', 'Any audience') }, ...audienceOptions]}
                  menuPortal
                />
              </FilterField>
              <FilterField label={t('products.chips.orders')}>
                <Combobox value={ordersFilter} onChange={(v) => updateParams({ orders: v })} ariaLabel={t('products.allOrders')} placeholder={t('products.allOrders')} options={ordersOpts} menuPortal />
              </FilterField>
              <FilterField label={t('products.chips.sort')}>
                <Combobox
                  value={sortFilter}
                  onChange={(v) => updateParams({ sort: v === 'newest' ? '' : v })}
                  ariaLabel={t('products.chips.sort')}
                  placeholder={t('products.sort.newest')}
                  options={sortOpts}
                  menuPortal
                />
              </FilterField>
            </div>

            {/* Drawer footer — sticky, holds the two escape hatches. */}
            <div className="shrink-0 p-4 border-t border-border flex items-center gap-2">
              <button
                type="button"
                onClick={clearAllFilters}
                disabled={!hasAnyFilter}
                className="inline-flex items-center gap-1.5 h-11 px-4 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:text-danger hover:border-danger/30 hover:bg-danger-bg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-4 h-4" strokeWidth={1.75} />
                {t('products.filters.clearAll')}
              </button>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="flex-1 h-11 px-5 rounded-xl text-sm font-semibold font-display bg-brand text-white hover:bg-brand-mid transition-colors"
              >
                {t('products.filters.done')}
              </button>
            </div>
          </aside>
        </>
      )}

      {/* ─── Delete Product Modal ───────────────────────────── */}
      {deletePending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setDeletePending(null); setPurgeResult(null); }}>
          <div className="bg-card rounded-2xl p-6 shadow-modal w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-danger-bg flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} strokeWidth={1.75} className="text-danger" />
              </div>
              <div>
                <h3 className="text-lg font-bold font-display text-ink">Delete product</h3>
                <p className="text-sm text-muted font-body mt-0.5">
                  <span className="font-semibold text-ink">{deletePending.name}</span>
                </p>
              </div>
            </div>

            {purgeResult ? (
              <>
                <p className="text-sm text-ink font-body bg-danger-bg border border-danger/30 rounded-lg p-3 mb-4">
                  <strong className="text-danger">Purged.</strong>{' '}
                  <span className="font-semibold">{purgeResult.orders_deleted}</span> order(s) deleted.{' '}
                  <span className="font-semibold">{purgeResult.rashan_packs_updated}</span> rashan pack(s) and{' '}
                  <span className="font-semibold">{purgeResult.rashan_subscriptions_updated}</span> subscription(s) updated.
                </p>
                <div className="flex justify-end">
                  <button
                    onClick={() => { setDeletePending(null); setPurgeResult(null); }}
                    className="h-11 px-5 rounded-xl text-sm font-semibold font-display bg-brand text-white hover:bg-brand-mid transition-colors"
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray font-body bg-surface-cream rounded-lg p-3 mb-3">
                  <strong>Recommended: Deactivate.</strong> The product is hidden from the storefront but stays in the database, so past orders that reference it remain intact. You can reactivate it later by editing.
                </p>
                <p className="text-sm text-gray font-body bg-amber-mist/50 border border-amber/30 rounded-lg p-3 mb-3">
                  <strong>Permanent delete</strong> removes the product, all its variants and images. Only allowed if <em>no order ever included it</em> — otherwise you'd break order history.
                </p>
                <p className="text-sm text-gray font-body bg-danger-bg border border-danger/30 rounded-lg p-3 mb-4">
                  <strong className="text-danger inline-flex items-center gap-1"><Flame size={13} strokeWidth={2} /> Purge (destructive)</strong> deletes the product AND every order that ever contained it AND scrubs it from rashan packs / subscriptions. Customer order history rewriting — irreversible. Use only for scrubs (GDPR, mistaken catalog entries).
                </p>

                <label className="block mb-4">
                  <span className="text-xs font-semibold text-ink font-display block mb-1.5">
                    To enable "Purge", type the product name below:{' '}
                    <code className="text-muted font-mono">{deletePending.name}</code>
                  </span>
                  <input
                    type="text"
                    value={purgeConfirmText}
                    onChange={(e) => setPurgeConfirmText(e.target.value)}
                    placeholder={deletePending.name}
                    className="w-full h-10 px-3 rounded-lg border-2 border-border font-mono text-sm focus:outline-none focus:border-danger transition-colors"
                  />
                </label>

                {deleteError && (
                  <p className="text-sm text-danger font-body mb-3 bg-danger-bg rounded-lg p-3">{deleteError}</p>
                )}

                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDeletePending(null)}
                      className="flex-1 h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors"
                    >
                      Cancel
                    </button>
                    {deletePending.isActive && (
                      <button
                        onClick={doDeactivate}
                        disabled={deleteProduct.isPending || purgeProduct.isPending}
                        className="flex-1 h-11 px-5 rounded-xl text-sm font-semibold font-display bg-brand text-white hover:bg-brand-mid transition-colors disabled:opacity-50"
                      >
                        {deleteProduct.isPending ? '…' : 'Deactivate'}
                      </button>
                    )}
                  </div>
                  <button
                    onClick={doPermanentDelete}
                    disabled={deleteProduct.isPending || purgeProduct.isPending}
                    className="w-full h-11 px-5 rounded-xl text-sm font-semibold font-display bg-danger text-white hover:bg-danger/90 transition-colors disabled:opacity-50"
                  >
                    {deleteProduct.isPending ? '…' : 'Delete permanently'}
                  </button>
                  <button
                    onClick={doPurge}
                    disabled={purgeProduct.isPending || deleteProduct.isPending || purgeConfirmText !== deletePending.name}
                    className="w-full h-11 px-5 rounded-xl text-sm font-semibold font-display bg-danger text-white hover:bg-danger/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
                    title={purgeConfirmText !== deletePending.name ? 'Type the product name to enable this' : ''}
                  >
                    <Flame size={14} strokeWidth={2} />
                    {purgeProduct.isPending ? 'Purging…' : 'Purge (also deletes orders)'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {quickCreateOpen && (
        <QuickCreateProductModal
          onCreated={() => setQuickCreateOpen(false)}
          onClose={() => setQuickCreateOpen(false)}
        />
      )}
    </div>
  );
}

/** Small wrapper — label above a filter control so the picker grid reads
 *  as a form, not just a random row of dropdowns. */
/**
 * A labelled filter field.
 *
 * A <div>, NOT a <label>. <button> is a labelable element, so a <label> here
 * adopts the Combobox's trigger, and a click anywhere inside the label is
 * re-dispatched onto it — including a click on an option in the open menu.
 * Choosing an option therefore closed the menu (commit) and reopened it (the
 * forwarded click) in one gesture, which looked like a dropdown that refused
 * to close.
 *
 * Ten of the eleven fields here hold a Combobox, named by `ariaLabel`, so the
 * label element was buying nothing and costing that. The eleventh is the
 * search input, which carries its own aria-label for the same reason.
 */
function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted font-display">
        {label}
      </span>
      {children}
    </div>
  );
}
