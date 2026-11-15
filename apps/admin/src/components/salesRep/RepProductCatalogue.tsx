import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search, X, SlidersHorizontal, RotateCcw, Loader2, Package, LayoutGrid, ChevronDown,
  Plus, Check, Store, ListChecks,
} from 'lucide-react';
import {
  HOUSE_STORE_ID, resolveImageUrl, useAdminRepProductSearch, useAdminCategories, useAdminSubcategories,
  useAdminBrandsTable, useAdminOriginsTable, useAdminStores,
  type AdminRepProduct, type AdminRepProductSearchParams,
} from '@grocery-app/shared';
import Combobox, { type ComboboxOption } from '@/components/form/Combobox';
import RollingText from '@/components/RollingText';
import { Skeleton } from '@/components/Skeleton';
import { priceLabel, useDebounced } from '@/components/salesRep/repProductFormat';

/**
 * The catalogue on the rep products page (2026-10-27, user: "instead of this
 * dialog we can show a full screen or side panel that can have the ui for
 * products the way we have on the create order stuff.. We should be able to
 * search products and also be able to filter them").
 *
 * The order builder's panel in look and in place — a column beside the list
 * from xl, a sheet over it below — with the same search, category strip and
 * filter drawer. What differs is the card's one action: a product is assigned
 * whole, every size, so there is no size box and no stepper, only a toggle.
 * Nothing is written from here; the page collects the changes and saves them.
 */

/** Where a product stands: theirs or not, and what the page is about to do to it. */
export type RepPickState = 'none' | 'adding' | 'assigned' | 'removing';

export interface RepProductCatalogueProps {
  userId: string;
  /** Below xl it is a sheet; this opens it. From xl it is always there. */
  open: boolean;
  onClose: () => void;
  stateOf: (p: AdminRepProduct) => RepPickState;
  onToggle: (p: AdminRepProduct) => void;
  /** Picks every shown product not theirs and not picked yet. */
  onPickMany: (ps: AdminRepProduct[]) => void;
  /** Ids of the shops they already sell from (HOUSE_STORE_ID for Cesto's own). */
  shopIds: Set<string>;
  /** How many changes are waiting — the sheet's Done button says so. */
  pending: number;
}

const PAGE_SIZE = 30;

type Show = '' | 'false' | 'true';
type Sort = NonNullable<AdminRepProductSearchParams['sort']>;

export default function RepProductCatalogue({
  userId, open, onClose, stateOf, onToggle, onPickMany, shopIds, pending,
}: RepProductCatalogueProps) {
  const { t } = useTranslation();

  const [typed, setTyped] = useState('');
  const q = useDebounced(typed.trim());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [show, setShow] = useState<Show>('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [originId, setOriginId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [stock, setStock] = useState('');
  const [sort, setSort] = useState<Sort>('name_asc');

  // Escape closes the drawer first, then the sheet — and the sheet only below
  // xl, where it is one. A page column that vanished on Escape would surprise.
  // An open menu inside either claims the key first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (filtersOpen) { setFiltersOpen(false); return; }
      if (open && !window.matchMedia('(min-width: 1280px)').matches) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, filtersOpen, onClose]);

  const { data: categories } = useAdminCategories();
  const { data: subcategoriesAll } = useAdminSubcategories();
  const { data: brandsData = [] } = useAdminBrandsTable();
  const { data: originsData = [] } = useAdminOriginsTable();
  // Only shops that can be sold from: a switched-off one would assign nothing.
  const { data: storesData } = useAdminStores({ isActive: 'true', deletionState: 'live', limit: 200 });
  const stores = useMemo(
    () => (storesData?.items ?? []).filter((s) => s.status !== 'suspended').sort((a, b) => a.name.localeCompare(b.name)),
    [storesData],
  );

  const subcategories = useMemo(
    () => (categoryId ? (subcategoriesAll ?? []).filter((s) => s.category_id === categoryId) : []),
    [subcategoriesAll, categoryId],
  );

  const {
    data, isLoading, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useAdminRepProductSearch(userId, {
    q: q || undefined,
    categoryId: categoryId || undefined,
    subcategoryId: subcategoryId || undefined,
    brandId: brandId || undefined,
    originId: originId || undefined,
    storeId: storeId || undefined,
    stock: (stock === 'in' || stock === 'out' || stock === 'low') ? stock : undefined,
    sort: sort !== 'name_asc' ? sort : undefined,
    assigned: show || undefined,
    limit: PAGE_SIZE,
  });
  const products = (data?.pages ?? []).flatMap((p) => p.items);
  const total = data?.pages?.[0]?.total ?? 0;

  // The next page a screen early, as the end of the grid comes into view.
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) fetchNextPage(); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, products.length]);

  // What the drawer holds. The category strip and the Show switch are on
  // screen already, so neither is counted — same as the order builder.
  const activeFilters = [subcategoryId, brandId, originId, storeId, stock].filter(Boolean).length + (sort !== 'name_asc' ? 1 : 0);
  const resetFilters = () => {
    setSubcategoryId(''); setBrandId(''); setOriginId(''); setStoreId(''); setStock(''); setSort('name_asc');
  };
  const pickCategory = (v: string) => { setCategoryId(v); setSubcategoryId(''); };

  const shopName = (id: string) => (id === HOUSE_STORE_ID
    ? t('salesReps.products.cesto', 'Cesto Shop')
    : stores.find((s) => s.id === id)?.name ?? t('products.chips.store'));

  const chips: { key: string; label: string; onClear: () => void }[] = [];
  if (subcategoryId) chips.push({ key: 'sub', label: subcategories.find((x) => x.id === subcategoryId)?.name_es ?? t('products.chips.subcategory'), onClear: () => setSubcategoryId('') });
  if (brandId) chips.push({ key: 'brand', label: brandsData.find((x) => x.id === brandId)?.name ?? t('products.chips.brand'), onClear: () => setBrandId('') });
  if (originId) chips.push({ key: 'origin', label: originsData.find((x) => x.id === originId)?.label_es ?? t('products.chips.origin'), onClear: () => setOriginId('') });
  if (storeId) chips.push({ key: 'store', label: shopName(storeId), onClear: () => setStoreId('') });
  if (stock) {
    const labels: Record<string, string> = { in: t('products.inStock'), low: t('products.stockStatus.lowStock'), out: t('products.outOfStock') };
    chips.push({ key: 'stock', label: labels[stock] ?? stock, onClear: () => setStock('') });
  }
  const sortLabels: Record<Sort, string> = {
    name_asc: t('products.sort.nameAsc'),
    name_desc: t('products.sort.nameDesc'),
    newest: t('products.sort.newest'),
    oldest: t('products.sort.oldest'),
  };
  if (sort !== 'name_asc') chips.push({ key: 'sort', label: sortLabels[sort], onClear: () => setSort('name_asc') });

  const categoryOpts: ComboboxOption[] = [
    { value: '', label: t('products.allCategories') },
    ...(categories ?? []).map((c) => ({ value: c.id, label: c.name_es })),
  ];
  const subcategoryOpts: ComboboxOption[] = [
    { value: '', label: t('products.allSubcategories') },
    ...subcategories.map((s) => ({ value: s.id, label: s.name_es })),
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
    { value: HOUSE_STORE_ID, label: t('salesReps.products.cesto', 'Cesto Shop') },
    ...stores.map((s) => ({ value: s.id, label: s.name })),
  ];
  const stockOpts: ComboboxOption[] = [
    { value: '', label: t('products.allStock') },
    { value: 'in', label: t('products.inStock') },
    { value: 'low', label: t('products.stockStatus.lowStock') },
    { value: 'out', label: t('products.outOfStock') },
  ];
  const sortOpts: ComboboxOption[] = (Object.keys(sortLabels) as Sort[]).map((k) => ({ value: k, label: sortLabels[k] }));

  const showOpts: { value: Show; label: string }[] = [
    { value: '', label: t('salesReps.products.filterAll', 'All') },
    { value: 'false', label: t('salesReps.products.filterNotAssigned', 'Not assigned') },
    { value: 'true', label: t('salesReps.products.filterAssigned', 'Assigned') },
  ];

  // The shown ones still free to pick — "Select all" picks these and no others.
  const pickable = products.filter((p) => stateOf(p) === 'none');

  return (
    <>
      {open && (
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="fixed inset-0 z-40 bg-black/50 xl:hidden"
        />
      )}

      <aside
        className={`bg-card border-border flex-col
          fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[460px] border-l shadow-modal
          xl:z-auto xl:w-auto xl:flex-1 xl:min-w-0 xl:border xl:rounded-xl xl:shadow-none
          xl:sticky xl:top-[72px] xl:h-[calc(100vh-104px)] xl:overflow-hidden
          ${open ? 'flex' : 'hidden xl:flex'}`}
        aria-label={t('salesReps.products.catalogue', 'Catalogue')}
      >
        {/* ─── Search ───────────────────────────── */}
        <div className="shrink-0 px-4 pt-3 pb-2 flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted pointer-events-none" strokeWidth={1.75} />
            <input
              type="search"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={t('salesReps.products.catalogueSearch', 'Name or brand…')}
              aria-label={t('salesReps.products.catalogueSearch', 'Name or brand…')}
              className="w-full bg-card border border-border rounded-xl h-11 pl-10 pr-9 text-sm font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 [&::-webkit-search-cancel-button]:hidden"
            />
            {typed && (
              <button
                type="button"
                onClick={() => setTyped('')}
                aria-label={t('common.clear')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded hover:bg-border/60 flex items-center justify-center"
              >
                <X size={13} strokeWidth={2} className="text-muted" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label={t('products.filters.title')}
            className={`h-11 px-3.5 shrink-0 rounded-xl border inline-flex items-center gap-1.5 text-sm font-semibold font-display transition-colors ${
              activeFilters ? 'border-brand text-brand bg-brand-mist/30' : 'border-border text-ink hover:border-brand'
            }`}
          >
            <SlidersHorizontal size={16} strokeWidth={1.75} />
            <span className="hidden sm:inline">{t('products.filters.title')}</span>
            {activeFilters > 0 && (
              <span className="min-w-[18px] h-[18px] inline-flex items-center justify-center px-1 rounded-full bg-brand text-white text-[10px] font-bold tabular-nums">
                {activeFilters}
              </span>
            )}
            <ChevronDown size={14} strokeWidth={2} className="text-muted" />
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="xl:hidden w-9 h-9 rounded-lg hover:bg-surface-cream flex items-center justify-center shrink-0"
          >
            <X size={17} strokeWidth={1.75} className="text-muted" />
          </button>
        </div>

        {/* ─── Theirs or not ────────────────────────
            The question this screen keeps asking, so it is a switch on screen
            rather than a field in the drawer. */}
        <div className="shrink-0 px-4 pb-2.5">
          <div role="radiogroup" aria-label={t('salesReps.products.filterShow', 'Show')} className="inline-flex p-1 rounded-xl bg-surface-cream border border-border/70">
            {showOpts.map((o) => (
              <button
                key={o.value || 'all'}
                type="button"
                role="radio"
                aria-checked={show === o.value}
                onClick={() => setShow(o.value)}
                className={`h-8 px-3 rounded-lg text-xs font-semibold font-display transition-colors ${
                  show === o.value ? 'bg-card text-ink shadow-card' : 'text-gray hover:text-ink'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* ─── Active filters ───────────────────── */}
        {chips.length > 0 && (
          <div className="shrink-0 px-4 py-2.5 border-t border-border bg-surface-cream/40 flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={c.onClear}
                className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1.5 rounded-full bg-brand text-white text-[11px] font-display font-bold hover:bg-brand-mid transition-colors max-w-full"
              >
                <span className="truncate">{c.label}</span>
                <X className="w-3 h-3 shrink-0" strokeWidth={2.5} />
              </button>
            ))}
            <button
              type="button"
              onClick={resetFilters}
              className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold font-display text-danger hover:text-danger/80 transition-colors shrink-0"
            >
              <RotateCcw className="w-3 h-3" strokeWidth={2} />
              {t('products.filters.clearAll')}
            </button>
          </div>
        )}

        {/* ─── Category strip ───────────────────── */}
        {(categories ?? []).length > 0 && (
          <div className="shrink-0 border-y border-border overflow-x-auto">
            <div className="flex items-center gap-1.5 px-3 py-2 min-w-max">
              <button
                type="button"
                onClick={() => pickCategory('')}
                className={`h-9 px-3 shrink-0 rounded-lg inline-flex items-center gap-1.5 text-xs font-semibold font-display whitespace-nowrap transition-colors ${
                  categoryId === '' ? 'bg-brand text-white' : 'text-gray hover:bg-surface-cream'
                }`}
              >
                <LayoutGrid size={15} strokeWidth={1.75} className="shrink-0" />
                {t('orderCreate.panel.allCategories', 'All')}
              </button>
              {(categories ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pickCategory(c.id)}
                  className={`h-9 px-3 shrink-0 max-w-[170px] rounded-lg inline-flex items-center gap-1.5 text-xs font-semibold font-display transition-colors ${
                    categoryId === c.id ? 'bg-brand text-white' : 'text-gray hover:bg-surface-cream'
                  }`}
                >
                  {c.icon_url
                    ? <img
                        src={resolveImageUrl(c.icon_url)}
                        alt=""
                        className="w-[15px] h-[15px] object-contain shrink-0"
                        draggable={false}
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    : <Package size={15} strokeWidth={1.75} className="shrink-0" />}
                  <span className="truncate">{c.name_es}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ─── Results ──────────────────────────── */}
        <div className="flex-1 overflow-y-auto overscroll-contain bg-surface-linen/40">
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-2 p-2.5" aria-busy="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-border/70 bg-card p-2 space-y-2">
                  <Skeleton className="aspect-[3/2] w-full rounded-xl" />
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-9 w-full rounded-xl" />
                </div>
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <span className="mx-auto w-12 h-12 rounded-2xl bg-surface-cream text-muted flex items-center justify-center">
                <Search size={22} strokeWidth={1.75} />
              </span>
              <p className="mt-3 text-sm font-bold font-display text-ink">{t('salesReps.products.noResults', 'No products match')}</p>
              <p className="mt-1 text-[12.5px] text-muted">{t('salesReps.products.noResultsBody', 'Try another name or brand, or clear the filters.')}</p>
              {(activeFilters > 0 || show || categoryId || typed) && (
                <button
                  type="button"
                  onClick={() => { resetFilters(); setShow(''); pickCategory(''); setTyped(''); }}
                  className="mt-4 h-10 px-4 rounded-xl border border-border hover:border-brand text-sm font-semibold font-display text-ink inline-flex items-center gap-1.5"
                >
                  <RotateCcw size={14} strokeWidth={2} />
                  {t('salesReps.products.startOver', 'Show everything')}
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-2 p-2.5">
              {products.map((p) => (
                <ProductCard key={p.id} p={p} state={stateOf(p)} onToggle={() => onToggle(p)} theirShop={shopIds.has(p.store?.id ?? HOUSE_STORE_ID)} />
              ))}
            </div>
          )}

          {hasNextPage && (
            <div ref={loadMoreRef} className="px-3 pb-4 pt-1 flex items-center justify-center">
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="h-9 px-4 rounded-lg border border-border text-xs font-semibold font-display text-gray hover:border-brand hover:text-brand disabled:opacity-60 inline-flex items-center gap-1.5 transition-colors"
              >
                {isFetchingNextPage && <Loader2 size={13} strokeWidth={2.5} className="animate-spin" />}
                {isFetchingNextPage ? t('common.loading', 'Loading…') : t('orderCreate.panel.loadMore', 'Load more')}
              </button>
            </div>
          )}
        </div>

        {/* ─── Footer ───────────────────────────── */}
        <div className="shrink-0 border-t border-border px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted flex-1 min-w-0 truncate leading-4">
            {total > 0 && (
              <RollingText
                className="h-4"
                value={t('salesReps.products.countLoaded', '{{loaded}} of {{total}} products', { loaded: products.length, total })}
              />
            )}
            {isFetching && !isFetchingNextPage && !isLoading && <Loader2 size={11} strokeWidth={2} className="inline ml-1 animate-spin" />}
          </span>
          {pickable.length > 1 && (
            <button
              type="button"
              onClick={() => onPickMany(pickable)}
              className="h-8 px-2.5 rounded-lg border border-dashed border-border hover:border-brand text-xs font-semibold font-display text-brand inline-flex items-center gap-1.5 shrink-0"
            >
              <ListChecks size={14} strokeWidth={1.75} />
              {t('salesReps.products.pickShown', { count: pickable.length, defaultValue: 'Select the {{count}} shown' })}
            </button>
          )}
          {/* The sheet covers the list it fills, so it says how much is waiting
              there and goes back to it. A row of its own on a phone, where it
              would squeeze the count out of the line. */}
          <button
            type="button"
            onClick={onClose}
            className="xl:hidden w-full sm:w-auto h-11 sm:h-9 px-3.5 rounded-xl bg-brand hover:bg-brand-mid text-white text-sm sm:text-xs font-semibold font-display inline-flex items-center justify-center gap-1.5 shrink-0"
          >
            <Check size={14} strokeWidth={2.5} />
            {pending > 0
              ? t('salesReps.products.doneN', { count: pending, defaultValue: 'Done · {{count}}' })
              : t('products.filters.done')}
          </button>
        </div>
      </aside>

      {/* ─── Filter drawer ──────────────────────── */}
      {filtersOpen && (
        <>
          <button
            type="button"
            onClick={() => setFiltersOpen(false)}
            aria-label={t('common.close')}
            className="fixed inset-0 z-[55] bg-black/50"
          />
          <aside className="fixed right-0 top-0 bottom-0 z-[56] w-full sm:w-[380px] bg-card shadow-modal flex flex-col" aria-label={t('products.filters.title')}>
            <div className="shrink-0 px-4 py-3 border-b border-border flex items-center gap-2">
              <h3 className="text-sm font-semibold font-display text-ink flex-1 inline-flex items-center gap-1.5">
                <SlidersHorizontal size={15} strokeWidth={1.75} className="text-brand" />
                {t('products.filters.title')}
              </h3>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                aria-label={t('common.close')}
                className="w-9 h-9 rounded-lg hover:bg-surface-cream flex items-center justify-center"
              >
                <X size={17} strokeWidth={1.75} className="text-muted" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              <div className="rounded-lg bg-surface-cream/60 border border-border p-3 space-y-2.5">
                <PanelField label={t('products.chips.category')}>
                  <Combobox value={categoryId} onChange={pickCategory} ariaLabel={t('products.allCategories')} placeholder={t('products.allCategories')} options={categoryOpts} searchable menuPortal />
                </PanelField>
                <PanelField label={t('products.chips.subcategory')}>
                  <Combobox
                    value={subcategoryId} onChange={setSubcategoryId}
                    ariaLabel={t('products.allSubcategories')}
                    placeholder={categoryId ? t('products.allSubcategories') : t('products.filters.pickCategoryFirst')}
                    options={subcategoryOpts} disabled={!categoryId} searchable menuPortal
                  />
                </PanelField>
              </div>
              <PanelField label={t('products.chips.store')}>
                <Combobox value={storeId} onChange={setStoreId} ariaLabel={t('products.allStores')} placeholder={t('products.allStores')} options={storeOpts} searchable menuPortal />
              </PanelField>
              <PanelField label={t('products.chips.brand')}>
                <Combobox value={brandId} onChange={setBrandId} ariaLabel={t('products.allBrands')} placeholder={t('products.allBrands')} options={brandOpts} searchable menuPortal />
              </PanelField>
              <PanelField label={t('products.chips.origin')}>
                <Combobox value={originId} onChange={setOriginId} ariaLabel={t('products.allOrigins')} placeholder={t('products.allOrigins')} options={originOpts} searchable menuPortal />
              </PanelField>
              <PanelField label={t('products.chips.stock')}>
                <Combobox value={stock} onChange={setStock} ariaLabel={t('products.allStock')} placeholder={t('products.allStock')} options={stockOpts} menuPortal />
              </PanelField>
              <PanelField label={t('products.chips.sort')}>
                <Combobox value={sort} onChange={(v) => setSort(v as Sort)} ariaLabel={t('products.chips.sort')} placeholder={sortLabels.name_asc} options={sortOpts} menuPortal />
              </PanelField>
            </div>

            <div className="shrink-0 border-t border-border px-4 py-3 flex items-center gap-2">
              <button
                type="button"
                onClick={resetFilters}
                disabled={activeFilters === 0}
                className="flex-1 h-10 rounded-xl border border-border hover:border-brand disabled:opacity-40 text-sm font-semibold font-display text-ink"
              >
                {t('products.filters.clearAll')}
              </button>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="flex-1 h-10 rounded-xl bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display"
              >
                {t('products.filters.done')}
              </button>
            </div>
          </aside>
        </>
      )}
    </>
  );
}

/**
 * One product, and the one thing to do with it here.
 *
 * The button says where the product stands and turns it the other way:
 * Assign → Selected (tap again to let go), Assigned → Will be removed (tap
 * again to keep it). Where a pointer can hover, Assigned reads "Remove" under
 * it, so the way to take one off is found without guessing.
 */
function ProductCard({ p, state, onToggle, theirShop }: {
  p: AdminRepProduct; state: RepPickState; onToggle: () => void; theirShop: boolean;
}) {
  const { t } = useTranslation();
  const price = priceLabel(p);
  const inStock = p.in_stock !== false;

  const frame = {
    none: 'border-border/70 hover:border-border hover:shadow-card',
    adding: 'border-brand ring-1 ring-brand shadow-card',
    assigned: 'border-success/40',
    removing: 'border-danger/50 ring-1 ring-danger/40',
  }[state];

  return (
    <div className={`group flex flex-col rounded-2xl border bg-card p-2 transition-all ${frame}`}>
      <div className="relative aspect-[3/2] rounded-xl overflow-hidden bg-surface-cream">
        <div className="absolute top-1.5 left-1.5 z-10 flex flex-col items-start gap-1">
          {!inStock && (
            <span className="inline-flex items-center bg-white/95 text-danger text-[11px] font-bold px-1.5 py-0.5 rounded-md shadow-card">
              {t('products.outOfStock')}
            </span>
          )}
          {(p.audience === 'b2b' || p.audience === 'b2c') && (
            <span className="inline-flex items-center bg-white/95 text-ink text-[11px] font-bold px-1.5 py-0.5 rounded-md shadow-card">
              {p.audience === 'b2b' ? t('audience.b2b') : t('audience.b2c')}
            </span>
          )}
        </div>
        {(state === 'adding' || state === 'assigned') && (
          <span
            aria-hidden="true"
            className={`absolute top-1.5 right-1.5 z-10 w-6 h-6 rounded-full flex items-center justify-center shadow-card ${
              state === 'adding' ? 'bg-brand text-white' : 'bg-success text-white'
            }`}
          >
            <Check size={14} strokeWidth={3} />
          </span>
        )}
        {p.image_url
          ? <img src={resolveImageUrl(p.image_url, 'card')} alt="" loading="lazy" className={`absolute inset-0 w-full h-full object-contain p-1.5 transition-transform duration-500 ease-out group-hover:scale-[1.03] ${state === 'removing' ? 'opacity-50 grayscale' : ''}`} draggable={false} />
          : <div className="absolute inset-0 flex items-center justify-center"><Package size={28} strokeWidth={1.5} className="text-muted/50" /></div>}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[14px] font-bold text-brand tabular-nums leading-none truncate">{price ?? '—'}</span>
        {p.brand && (
          <span className="ml-auto text-[11px] font-bold uppercase tracking-[0.12em] text-muted/85 leading-none truncate max-w-[50%] self-center text-right">
            {p.brand}
          </span>
        )}
      </div>

      <p className={`mt-1 text-[12px] font-medium leading-snug line-clamp-2 ${state === 'removing' ? 'text-muted line-through' : 'text-ink'}`}>
        {p.name_es}
      </p>

      <p className="mt-0.5 text-[11px] text-muted truncate">
        {t('orderCreate.panel.soldBy', 'Sold by')}{' '}
        <span className="font-semibold text-gray">{p.store?.name ?? t('salesReps.products.cesto', 'Cesto Shop')}</span>
        {p.sizes > 1 && <> · {t('salesReps.products.sizes', { count: p.sizes, defaultValue: '{{count}} sizes' })}</>}
      </p>
      {/* Already in their catalogue through the shop. Assigning it anyway is
          allowed — it keeps it theirs if that shop is ever taken away. */}
      {theirShop && state !== 'assigned' && state !== 'removing' && (
        <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-brand">
          <Store size={11} strokeWidth={2} className="shrink-0" />
          <span className="truncate">{t('salesReps.products.inTheirShop', 'Already in their shops')}</span>
        </p>
      )}

      <div className="mt-auto pt-2">
        {state === 'none' && (
          <button
            type="button"
            onClick={onToggle}
            className="w-full h-9 rounded-xl bg-brand hover:bg-brand-mid text-white text-[12px] font-semibold font-display inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            <Plus size={15} strokeWidth={2.75} />
            {t('salesReps.products.assign', 'Assign')}
          </button>
        )}
        {state === 'adding' && (
          <button
            type="button"
            onClick={onToggle}
            aria-pressed="true"
            className="w-full h-9 rounded-xl border-2 border-brand bg-brand-mist/40 text-brand text-[12px] font-semibold font-display inline-flex items-center justify-center gap-1.5 hover:bg-brand-mist/60 transition-colors"
          >
            <Check size={15} strokeWidth={2.75} />
            {t('salesReps.products.picked', 'Selected')}
          </button>
        )}
        {state === 'assigned' && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={t('salesReps.products.remove', { name: p.name_es, defaultValue: 'Remove {{name}}' })}
            className="group/btn w-full h-9 rounded-xl bg-success-bg text-success hover:bg-danger-bg hover:text-danger text-[12px] font-semibold font-display inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            <span className="inline-flex items-center gap-1.5 group-hover/btn:hidden">
              <Check size={15} strokeWidth={2.75} />
              {t('salesReps.products.assigned', 'Assigned')}
            </span>
            <span className="hidden items-center gap-1.5 group-hover/btn:inline-flex">
              <X size={15} strokeWidth={2.75} />
              {t('salesReps.products.removeShort', 'Remove')}
            </span>
          </button>
        )}
        {state === 'removing' && (
          <button
            type="button"
            onClick={onToggle}
            className="w-full h-9 rounded-xl border-2 border-danger/60 bg-danger-bg text-danger text-[12px] font-semibold font-display inline-flex items-center justify-center gap-1.5 hover:bg-card transition-colors"
          >
            <RotateCcw size={14} strokeWidth={2.5} />
            {t('salesReps.products.keep', 'Keep it')}
          </button>
        )}
      </div>
    </div>
  );
}

/** A labelled filter field — a div, never a label: see OrderProductPanel's PanelField. */
function PanelField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted font-display">{label}</span>
      {children}
    </div>
  );
}
