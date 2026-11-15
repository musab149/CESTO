import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import {
  Plus, Search, Pencil, Package, Trash2, AlertTriangle,
  X, SlidersHorizontal, RotateCcw, Copy, FileSpreadsheet,
} from 'lucide-react';
import {
  // Everything the partner touches lives under /api/partner/* (see
  // routes/partner/taxonomy.ts + uploads.ts). This isolates the partner
  // surface from admin + public customer endpoints — no cross-app
  // coupling, no accidental data leaks, and every partner call goes
  // through requirePartnerRole().
  usePartnerCategories, usePartnerSubcategories, usePartnerProductTypes,
  usePartnerBrands, usePartnerOrigins,
  usePartnerProducts, useDeletePartnerProduct,
  resolveImageUrl,
  type PartnerProductsListParams,
} from '@grocery-app/shared';
import { TableSkeleton } from './components/Skeleton';
import Pagination from './components/Pagination';
import Combobox, { type ComboboxOption } from './components/form/Combobox';
import PartnerImportProductsModal from './components/ImportProductsModal';
import { usePartnerT } from './lib/i18n';

/**
 * Partner-scoped products list. Structural sibling of pages/ProductsPage.tsx
 * but uses partner API hooks (server enforces store_id from JWT) and hides
 * admin-only affordances: no Duplicates button, no CSV Import, no Store
 * filter (partner is scoped to their own store anyway), and the delete
 * modal is Deactivate-only — Permanent + Purge stay admin-exclusive because
 * they can affect cross-store order history + rashan bundles.
 *
 * The two pages intentionally duplicate ~500 lines rather than extract a
 * shared "context-aware" component. Trade-off documented in the Slice 3
 * Chunk 2 entry of [[pending-deploy-notes]]: refactor into shared later
 * if the drift proves painful.
 */

const PAGE_SIZE = 20;

function formatCurrency(value: number) {
  return value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const P = {
  q:        'q',
  category: 'category',
  sub:      'sub',
  type:     'type',
  brand:    'brand',
  origin:   'origin',
  status:   'status',
  stock:    'stock',
  orders:   'orders',
  sort:     'sort',
  page:     'page',
} as const;

type SortKey = NonNullable<PartnerProductsListParams['sort']>;

export default function PartnerProductsPage() {
  const t = usePartnerT();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;

  const searchQuery   = searchParams.get(P.q) ?? '';
  const categoryId    = searchParams.get(P.category) ?? '';
  const subcategoryId = searchParams.get(P.sub) ?? '';
  const productTypeId = searchParams.get(P.type) ?? '';
  const brandId       = searchParams.get(P.brand) ?? '';
  const originId      = searchParams.get(P.origin) ?? '';
  const statusFilter  = searchParams.get(P.status) ?? '';
  const stockFilter   = searchParams.get(P.stock) ?? '';
  const ordersFilter  = searchParams.get(P.orders) ?? '';
  const sortFilter    = (searchParams.get(P.sort) ?? 'newest') as SortKey;
  const page          = Math.max(1, Number(searchParams.get(P.page) ?? '1') || 1);

  // Taxonomy — partner-owned endpoints under /api/partner/taxonomy/*.
  // Same shapes as the public/customer versions, but access is gated on
  // requirePartnerRole(). Keeps the partner surface self-contained.
  const { data: categories } = usePartnerCategories();
  const { data: subcategoriesForCategory = [] } = usePartnerSubcategories(categoryId || undefined);
  const { data: productTypes = [] } = usePartnerProductTypes(subcategoryId || undefined);
  const { data: brandsData = [] } = usePartnerBrands();
  const { data: originsData = [] } = usePartnerOrigins();

  // Subcategories always come pre-filtered by category server-side — no
  // client-side dance needed. Empty array when no category is picked yet.
  const subcategories = subcategoriesForCategory;

  const listParams: PartnerProductsListParams = {
    q:            searchQuery.trim() || undefined,
    categoryId:   categoryId || undefined,
    subcategoryId:subcategoryId || undefined,
    productTypeId:productTypeId || undefined,
    brandId:      brandId || undefined,
    originId:     originId || undefined,
    isActive:     statusFilter === 'active' ? 'true' : statusFilter === 'inactive' ? 'false' : undefined,
    stock:        (stockFilter === 'in' || stockFilter === 'out' || stockFilter === 'low') ? stockFilter : undefined,
    hasOrders:    ordersFilter === 'sold' ? 'true' : ordersFilter === 'never' ? 'false' : undefined,
    sort:         sortFilter !== 'newest' ? sortFilter : undefined,
    page,
    limit:        PAGE_SIZE,
  };
  const { data, isLoading } = usePartnerProducts(listParams);
  const deleteProduct = useDeletePartnerProduct();

  const products = (data?.items ?? []) as Array<any>;

  const [deletePending, setDeletePending] = useState<{ id: string; name: string; isActive: boolean } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

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

  function pickCategory(v: string)    { updateParams({ category: v, sub: '', type: '' }); }
  function pickSubcategory(v: string) { updateParams({ sub: v, type: '' }); }

  function clearAllFilters() {
    const next = new URLSearchParams();
    if (sortFilter !== 'newest') next.set(P.sort, sortFilter);
    setSearchParams(next);
  }

  const chipData = useMemo(() => {
    const chips: Array<{ key: keyof typeof P; label: string; onClear: () => void }> = [];
    if (searchQuery) chips.push({ key: 'q', label: `“${searchQuery}”`, onClear: () => updateParams({ q: '' }) });
    if (categoryId) {
      const c = (categories ?? []).find((x) => x.id === categoryId);
      chips.push({ key: 'category', label: `${t('products.chips.category')}: ${c?.name_es ?? '—'}`, onClear: () => updateParams({ category: '', sub: '', type: '' }) });
    }
    if (subcategoryId) {
      const s = subcategories.find((x) => x.id === subcategoryId);
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
    if (statusFilter) chips.push({ key: 'status', label: statusFilter === 'active' ? t('products.active') : t('products.inactive'), onClear: () => updateParams({ status: '' }) });
    if (stockFilter) {
      const label = stockFilter === 'in' ? t('products.inStock') : stockFilter === 'out' ? t('products.outOfStock') : t('products.stockStatus.lowStock');
      chips.push({ key: 'stock', label, onClear: () => updateParams({ stock: '' }) });
    }
    if (ordersFilter) chips.push({ key: 'orders', label: ordersFilter === 'sold' ? t('products.chips.sold') : t('products.chips.neverSold'), onClear: () => updateParams({ orders: '' }) });
    return chips;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, categoryId, subcategoryId, productTypeId, brandId, originId, statusFilter, stockFilter, ordersFilter, categories, subcategories, productTypes, brandsData, originsData]);

  const hasAnyFilter = chipData.length > 0;

  function openDelete(p: any) {
    setDeletePending({ id: p.id, name: p.name_es, isActive: p.is_active });
    setDeleteError(null);
  }
  async function doDeactivate() {
    if (!deletePending) return;
    setDeleteError(null);
    try {
      await deleteProduct.mutateAsync(deletePending.id);
      setDeletePending(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Deactivate failed');
    }
  }

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
      {/* Header — no Duplicates or Import buttons for partners. */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">
            {t('products.title')}
            {!isLoading && (
              <span className="text-base font-normal text-muted ml-2">({data?.total ?? products.length})</span>
            )}
          </h1>
          <p className="text-sm text-muted font-body mt-1">Products in your store</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/partner/products/duplicates')}
            className="inline-flex items-center gap-2 bg-white border-2 border-border hover:border-amber hover:bg-amber-mist/30 text-ink font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition"
            title="Find and merge duplicate products in your store"
          >
            <Copy className="w-5 h-5" strokeWidth={1.75} />
            Duplicates
          </button>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className={`relative inline-flex items-center gap-2 bg-white border-2 text-ink font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition ${
              hasAnyFilter ? 'border-brand hover:bg-brand-mist/40' : 'border-border hover:border-brand hover:bg-brand-mist/40'
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
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="inline-flex items-center gap-2 bg-white border-2 border-border hover:border-brand hover:bg-brand-mist/40 text-ink font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition"
          >
            <FileSpreadsheet className="w-5 h-5" strokeWidth={1.75} />
            Import Excel
          </button>
          <button
            type="button"
            onClick={() => navigate('/partner/products/new', { state: { from: returnTo } })}
            className="inline-flex items-center gap-2 bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition"
          >
            <Plus className="w-5 h-5" strokeWidth={1.75} />
            {t('products.addProduct')}
          </button>
        </div>
      </div>

      {/* Bulk import modal — enqueues a background job, polls until done. */}
      <PartnerImportProductsModal open={importOpen} onClose={() => setImportOpen(false)} />

      {hasAnyFilter && (
        <div className="bg-white rounded-xl border border-border p-3 mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted font-display shrink-0 pl-1">
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
        <div className="bg-white rounded-xl border border-border p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-cream flex items-center justify-center mx-auto mb-4">
            <Package className="w-8 h-8 text-muted" strokeWidth={1.75} />
          </div>
          <h3 className="text-lg font-semibold font-display text-ink mb-1">{t('products.noResults')}</h3>
          <p className="text-sm text-muted mb-4">{t('products.noResultsHint')}</p>
          {hasAnyFilter ? (
            <button
              type="button"
              onClick={clearAllFilters}
              className="inline-flex items-center gap-2 bg-white border-2 border-border hover:border-brand text-ink font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition"
            >
              <RotateCcw className="w-4 h-4" strokeWidth={1.75} />
              {t('products.filters.clearAll')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/partner/products/new', { state: { from: returnTo } })}
              className="inline-flex items-center gap-2 bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition"
            >
              <Plus className="w-5 h-5" strokeWidth={1.75} />
              {t('products.addProduct')}
            </button>
          )}
        </div>
      ) : (
        <>
        {/* Mobile: card per product. Seven columns cannot be read at 360px, and
            the ones that matter for a stock check — price, stock, active — are
            the last three, i.e. furthest into the horizontal scroll. */}
        <div className="md:hidden space-y-2.5">
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
            return (
              <div key={p.id} className="bg-white rounded-xl border border-border p-3 flex gap-3">
                {imageUrl ? (
                  <img src={resolveImageUrl(imageUrl, 'thumb')} alt={p.name_es} className="w-14 h-14 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-surface-cream flex items-center justify-center shrink-0">
                    <Package className="w-6 h-6 text-muted" strokeWidth={1.75} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium text-ink font-display leading-snug line-clamp-2">{p.name_es}</p>
                      {p.brand && <p className="text-[11.5px] text-muted mt-0.5">{p.brand}</p>}
                    </div>
                    {!p.is_active && (
                      <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold font-display bg-gray-100 text-gray">
                        {t('products.inactive')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3 mt-2">
                    <div className="flex items-baseline gap-2.5 min-w-0">
                      <span className="text-[14px] font-semibold text-ink">
                        {defaultVariant ? `${formatCurrency(Number(defaultVariant.price))} €` : '—'}
                      </span>
                      <span className={`text-[12.5px] font-semibold ${
                        stockStatus === 'out' ? 'text-danger' : stockStatus === 'low' ? 'text-amber-deep' : 'text-gray'
                      }`}>
                        {stockStatus === 'out'
                          ? t('products.stockStatus.outOfStock')
                          : `${totalStock} ${stockStatus === 'low' ? '· ' + t('products.stockStatus.lowStock') : ''}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => navigate(`/partner/products/${p.id}/edit`, { state: { from: returnTo } })}
                        className="w-9 h-9 rounded-lg bg-surface-cream active:bg-brand-mist flex items-center justify-center"
                        aria-label={t('products.editProduct')}
                      >
                        <Pencil className="w-4 h-4 text-ink" strokeWidth={1.75} />
                      </button>
                      {p.is_active && (
                        <button
                          type="button"
                          onClick={() => openDelete(p)}
                          className="w-9 h-9 rounded-lg active:bg-danger-bg flex items-center justify-center"
                          aria-label="Deactivate"
                        >
                          <Trash2 className="w-4 h-4 text-danger" strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="hidden md:block bg-white rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="bg-surface-cream">
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('products.table.image')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('products.table.name')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('products.table.category')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('products.table.price')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('products.table.stock')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('products.table.status')}</th>
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

                return (
                  <tr key={p.id} className="border-t border-border hover:bg-brand-mist/30 transition">
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
                    <td className="px-4 py-3">
                      <span
                        className={`text-sm font-semibold ${
                          stockStatus === 'out' ? 'text-danger' : stockStatus === 'low' ? 'text-amber-deep' : 'text-ink'
                        }`}
                      >
                        {totalStock}
                      </span>
                      {stockStatus === 'out' && <span className="block text-xs text-danger">{t('products.stockStatus.outOfStock')}</span>}
                      {stockStatus === 'low' && <span className="block text-xs text-amber-deep">{t('products.stockStatus.lowStock')}</span>}
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
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => navigate(`/partner/products/${p.id}/edit`, { state: { from: returnTo } })}
                          className="w-9 h-9 rounded-lg bg-surface-cream hover:bg-brand-mist flex items-center justify-center transition"
                          title={t('products.editProduct')}
                        >
                          <Pencil className="w-4 h-4 text-ink" strokeWidth={1.75} />
                        </button>
                        {p.is_active && (
                          <button
                            type="button"
                            onClick={() => openDelete(p)}
                            className="w-9 h-9 rounded-lg hover:bg-danger-bg flex items-center justify-center transition"
                            title="Deactivate"
                          >
                            <Trash2 className="w-4 h-4 text-danger" strokeWidth={1.75} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
        </>
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

      {/* ─── Filters drawer ─── */}
      {filtersOpen && (
        <>
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setFiltersOpen(false)}
            className="fixed inset-0 z-40 bg-black/50"
          />
          <aside
            className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[420px] bg-white shadow-modal flex flex-col"
            role="dialog"
            aria-label={t('products.filters.title')}
          >
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

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <FilterField label={t('products.searchPlaceholder')}>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" strokeWidth={1.75} />
                  <input
                    type="text"
                    placeholder={t('products.searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => updateParams({ q: e.target.value })}
                    className="w-full bg-surface-cream border border-border rounded-lg h-11 pl-10 pr-4 text-sm font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </div>
              </FilterField>

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
                />
              </FilterField>
              {/* No Store filter — partner is already scoped to their own store. */}
              <FilterField label={t('products.chips.status')}>
                <Combobox value={statusFilter} onChange={(v) => updateParams({ status: v })} ariaLabel={t('products.allStatus')} placeholder={t('products.allStatus')} options={statusOpts} />
              </FilterField>
              <FilterField label={t('products.chips.stock')}>
                <Combobox value={stockFilter} onChange={(v) => updateParams({ stock: v })} ariaLabel={t('products.allStock')} placeholder={t('products.allStock')} options={stockOpts} />
              </FilterField>
              <FilterField label={t('products.chips.orders')}>
                <Combobox value={ordersFilter} onChange={(v) => updateParams({ orders: v })} ariaLabel={t('products.allOrders')} placeholder={t('products.allOrders')} options={ordersOpts} />
              </FilterField>
              <FilterField label={t('products.chips.sort')}>
                <Combobox
                  value={sortFilter}
                  onChange={(v) => updateParams({ sort: v === 'newest' ? '' : v })}
                  ariaLabel={t('products.chips.sort')}
                  placeholder={t('products.sort.newest')}
                  options={sortOpts}
                />
              </FilterField>
            </div>

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

      {/* ─── Deactivate Product Modal — partner has ONE action (no permanent delete, no purge). ─── */}
      {deletePending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeletePending(null)}>
          <div className="bg-white rounded-2xl p-6 shadow-modal w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-danger-bg flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} strokeWidth={1.75} className="text-danger" />
              </div>
              <div>
                <h3 className="text-lg font-bold font-display text-ink">Deactivate product</h3>
                <p className="text-sm text-muted font-body mt-0.5">
                  <span className="font-semibold text-ink">{deletePending.name}</span>
                </p>
              </div>
            </div>
            <p className="text-sm text-gray font-body bg-surface-cream rounded-lg p-3 mb-4">
              The product is hidden from the storefront but stays in the database, so past orders that reference it remain intact. You can reactivate it later by editing.
            </p>
            {deleteError && (
              <p className="text-sm text-danger font-body mb-3 bg-danger-bg rounded-lg p-3">{deleteError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setDeletePending(null)}
                className="flex-1 h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={doDeactivate}
                disabled={deleteProduct.isPending}
                className="flex-1 h-11 px-5 rounded-xl text-sm font-semibold font-display bg-brand text-white hover:bg-brand-mid transition-colors disabled:opacity-50"
              >
                {deleteProduct.isPending ? '…' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted font-display">
        {label}
      </span>
      {children}
    </label>
  );
}
