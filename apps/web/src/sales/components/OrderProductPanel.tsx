import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, X, SlidersHorizontal, RotateCcw, Loader2, PackagePlus, Package, LayoutGrid, ChevronDown,
  Plus, Minus, Store, PackageCheck,
} from 'lucide-react';
import {
  useSalesProductsFullInfinite, useSalesCategories, useSalesSubcategories,
  useSalesBrandsTable, useSalesOriginsTable, useSalesStores, resolveImageUrl, effectiveVatCategory,
  type SalesProduct as Product, type SalesProductVariant as ProductVariant, type SalesRepStore,
} from '@grocery-app/shared';
import Combobox, { type ComboboxOption } from './form/Combobox';
import RollingText from './RollingText';
import { Button, Dialog } from './Dialog';
import { formatCurrency } from '../lib/format';
import type { PickedVariant } from '../lib/picked';
import { usePortT } from '../lib/portT';
import { ASSIGNED, listNames, splitShops } from '../lib/shops';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * The catalogue, alongside the order being built.
 *
 * PORTED VERBATIM from apps/admin/src/components/OrderProductPanel.tsx. Same
 * filter rail, same cards, same variant picker on the card, same infinite
 * scroll. The only changes are the data hooks (/api/sales/catalogue/* instead
 * of /api/admin/*) and the i18n binding.
 *
 * The rep's endpoint serves the same shapes deliberately, so nothing below had
 * to be rewritten to read them — with two differences it does not have to
 * know about: inactive products never arrive, and `variant.price` is already
 * the price the client being sold to will pay.
 *
 * It replaced a one-shot picker — search, pick a variant, close — which was
 * the right shape for correcting a single line in a modal and the wrong one
 * for building an order from nothing, where a rep adds eight things in a row
 * and the cost is not the picking but the eight reopenings. That modal is
 * gone: editing an order is now this same screen, so this panel serves both.
 *
 * ADDING IS ONE CLICK. The Add button is on the product row itself. The list
 * endpoint already returns each product's active variants with price and
 * stock — only their NAMES need `full`, which is why this asks for the full
 * row — so nothing has to be fetched to know what adding would add. A product
 * with one variant (most of them) adds it directly. Only a product with
 * several has anything to choose, and only that row expands.
 *
 * FILTERS ARE A DRAWER, not an accordion inside this panel. Expanding them in
 * place pushed the results down and out of view, so you set a filter and lost
 * the thing you were filtering — you were looking at the controls instead of
 * what they did. The drawer leaves the results where they are.
 *
 * They are the filters that help you FIND something for a customer: category,
 * brand, origin, shop, stock. The catalogue-curation flags (featured,
 * sponsored, verified, needs-review) are deliberately absent — they say
 * nothing about whether this is the jar the customer is asking for.
 */

export interface OrderProductPanelProps {
  open: boolean;
  onClose: () => void;
  /** Quantity already in the basket, keyed by variant id. */
  quantities: Record<string, number>;
  onAdd: (v: PickedVariant) => void;
  onSetQuantity: (variantId: string, quantity: number) => void;
  /** Offers the "not in the catalogue" row. Omitted = no such row. */
  onCreateNew?: () => void;
  /**
   * The client the order is for. The server prices every card for them —
   * wholesale for a business — so the price on the card is the price the
   * order is written at. Without it the catalogue answered at retail and a
   * wholesale client's basket showed B2C prices until it was saved.
   */
  forClient?: string;
  /**
   * The shops the rep sells from (lib/repStore on the API): the catalogue
   * holds only their products. None that can be sold from, and there is
   * nothing to add. Undefined = an API from before shops — shown as before.
   */
  shops?: SalesRepStore[];
  /**
   * Products an admin assigned the rep by hand, from any shop (2026-10-27):
   * in the catalogue beside their shops', and enough to sell without a shop.
   */
  assigned?: number;
}

const PAGE_SIZE = 30;

export default function OrderProductPanel({
  open, onClose, quantities, onAdd, onSetQuantity, onCreateNew, forClient, shops, assigned = 0,
}: OrderProductPanelProps) {
  const t = usePortT();
  const lang = useLanguageStore((s) => s.lang);
  const shopKnown = shops !== undefined;
  const { sellable, unavailable } = splitShops(shops);
  const shopOk = sellable.length > 0 || assigned > 0;
  // What the panel can narrow to: each shop, and the products assigned by hand.
  const sources = [
    ...sellable.map((s) => ({ id: s.id, name: s.name })),
    ...(assigned > 0 ? [{ id: ASSIGNED, name: `${t('repShop.assigned', 'Assigned')} (${assigned})` }] : []),
  ];

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  /**
   * Loads the next page when the bottom of the list comes into view.
   *
   * The button is still there and still works — this only means a rep
   * scrolling with one hand does not have to stop and press it. rootMargin
   * starts the fetch a screen early, so the next row of cards is usually
   * already there by the time the last one clears the fold.
   */
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  // Which variant each card is showing. The card picks on the card, so
  // there is no expanded row and no second fetch.
  const [chosenVariant, setChosenVariant] = useState<Record<string, string>>({});

  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [originId, setOriginId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [stock, setStock] = useState('');
  const [sort, setSort] = useState('newest');

  // Typing is a keystroke per render otherwise, and this list is a network
  // round trip per render.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(id);
  }, [q]);

  // Escape closes the panel only where it is an overlay. At xl it is a column
  // of the page, and a page column that vanishes on Escape would be a
  // surprise. A dialog over it — its filters, a new product — takes the key
  // itself (components/Dialog), and one Escape should not close two layers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role=dialog]')) return;
      if (open && !window.matchMedia('(min-width: 1280px)').matches) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const { data: allCategories } = useSalesCategories();
  // Only those with something in the rep's shop; every one on an API from
  // before shops, which sends no count.
  const categories = useMemo(
    () => (allCategories ?? []).filter((c) => c.shop_products === undefined || c.shop_products > 0),
    [allCategories],
  );
  const { data: subcategoriesAll } = useSalesSubcategories();
  const { data: brandsData = [] } = useSalesBrandsTable();
  const { data: originsData = [] } = useSalesOriginsTable();
  const { data: storesData } = useSalesStores({ limit: 200 });

  const subcategories = useMemo(() => {
    if (!categoryId) return [];
    return (subcategoriesAll ?? []).filter((s) => s.category_id === categoryId);
  }, [subcategoriesAll, categoryId]);

  const {
    data, isLoading, isFetching, refetch, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useSalesProductsFullInfinite({
    q: debouncedQ || undefined,
    categoryId: categoryId || undefined,
    subcategoryId: subcategoryId || undefined,
    brandId: brandId || undefined,
    originId: originId || undefined,
    // 'cesto' is the sentinel for Product.store_id IS NULL — a query string
    // cannot carry a real null, so "Cesto only" needs a word of its own.
    storeId: (storeId && storeId !== ASSIGNED ? storeId : undefined) as string | 'cesto' | undefined,
    // The "Asignados" pill: the products assigned by hand, whichever shop.
    assigned: storeId === ASSIGNED ? 'true' : undefined,
    stock: (stock === 'in' || stock === 'out' || stock === 'low') ? stock : undefined,
    sort: sort !== 'newest' ? (sort as 'oldest' | 'name_asc' | 'name_desc' | 'rating_desc') : undefined,
    /**
     * ACTIVE ONLY, and not negotiable from the UI.
     *
     * A deactivated product is one somebody took off sale. Offering it here
     * puts it one tap from a real order, and the rep has no way of knowing it
     * was withdrawn — the card looks like every other card. The catalogue
     * screen is where inactive rows belong, because that is where they get
     * fixed.
     */
    isActive: 'true',
    for_client: forClient || undefined,
    limit: PAGE_SIZE,
  });

  // Every page fetched so far, as one list.
  const products = (data?.pages ?? []).flatMap((p) => p.items);
  const total = data?.pages?.[0]?.total ?? 0;

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) fetchNextPage(); },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, products.length]);

  /**
   * What the DRAWER is holding. Category is deliberately not counted.
   *
   * The strip above the grid already shows which category is on, lit and
   * impossible to miss, so counting it again put a "1" on the Filters button
   * for a choice nothing was hiding — and made picking a category look like
   * something that needed clearing before the catalogue was whole again.
   */
  // With the rep's shops in a row of their own (below), the shop is picked
  // there, like the category, and is not counted either.
  const activeFilters =
    [subcategoryId, brandId, originId, shopKnown ? '' : storeId, stock].filter(Boolean).length +
    (sort !== 'newest' ? 1 : 0);

  /**
   * Clears the filters, and leaves the category where it is.
   *
   * Same reason it is not counted: the category is where the rep has
   * navigated to, not something narrowing what they are looking at. "Clear
   * all" sitting in a row of brand and stock chips should not also throw them
   * back to the whole catalogue — the All tab is how that is undone, and it
   * is right there. The subcategory does go, since it only means anything
   * inside the category and the drawer is where it was set.
   */
  const resetFilters = () => {
    setSubcategoryId(''); setBrandId('');
    setOriginId(''); if (!shopKnown) setStoreId(''); setStock(''); setSort('newest');
  };

  const pickCategory = (v: string) => { setCategoryId(v); setSubcategoryId(''); };

  // What is on, in words, so it can be read and undone without opening the
  // drawer that set it. Clearing a category clears its subcategory too —
  // leaving a subcategory whose parent is gone would filter by something the
  // row no longer says.
  const chips: { key: string; label: string; onClear: () => void }[] = [];
  // No chip for the category: the strip says which one is on and the tab is
  // how it comes off again. A chip repeating it is a second control for one
  // choice, and the row it sat in pushed the products down to hold it.
  if (subcategoryId) {
    const sc = subcategories.find((x) => x.id === subcategoryId);
    chips.push({
      key: 'subcategory',
      label: sc?.name_es ?? t('products.chips.subcategory'),
      onClear: () => setSubcategoryId(''),
    });
  }
  if (brandId) {
    const b = brandsData.find((x) => x.id === brandId);
    chips.push({ key: 'brand', label: b?.name ?? t('products.chips.brand'), onClear: () => setBrandId('') });
  }
  if (originId) {
    const o = originsData.find((x) => x.id === originId);
    chips.push({ key: 'origin', label: o?.label_es ?? t('products.chips.origin'), onClear: () => setOriginId('') });
  }
  if (storeId && !shopKnown) {
    const st = (storesData?.items ?? []).find((x) => x.id === storeId);
    chips.push({
      key: 'store',
      label: storeId === 'cesto'
        ? t('orderDetail.editOrder.cestoHouseStore')
        : (st?.name ?? t('products.chips.store')),
      onClear: () => setStoreId(''),
    });
  }
  if (stock) {
    const labels: Record<string, string> = {
      in: t('products.inStock'),
      low: t('products.stockStatus.lowStock'),
      out: t('products.outOfStock'),
    };
    chips.push({ key: 'stock', label: labels[stock] ?? stock, onClear: () => setStock('') });
  }
  if (sort !== 'newest') {
    const labels: Record<string, string> = {
      oldest: t('products.sort.oldest'),
      name_asc: t('products.sort.nameAsc'),
      name_desc: t('products.sort.nameDesc'),
      rating_desc: t('products.sort.ratingDesc'),
    };
    chips.push({ key: 'sort', label: labels[sort] ?? sort, onClear: () => setSort('newest') });
  }

  // One variant means its name is an implementation detail ("500g" under
  // "Toor Dal") and the rep is adding the product. Several means the name is
  // the whole point of the choice, so it has to survive into the basket.
  const toPicked = (p: Product, v: ProductVariant, variantLabel?: string): PickedVariant => ({
    id: v.id,
    name: variantLabel ? `${p.name_es} — ${variantLabel}` : p.name_es,
    price: Number(v.price),
    storeId: p.store_id ?? null,
    storeName: p.store?.name ?? null,
    imageUrl: p.images?.[0]?.url ?? null,
    vatCategory: effectiveVatCategory(p),
  });

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
    { value: 'cesto', label: t('orderDetail.editOrder.cestoHouseStore') },
    ...((storesData?.items ?? []).map((s) => ({ value: s.id, label: s.name }))),
  ];
  const stockOpts: ComboboxOption[] = [
    { value: '',    label: t('products.allStock') },
    { value: 'in',  label: t('products.inStock') },
    { value: 'low', label: t('products.stockStatus.lowStock') },
    { value: 'out', label: t('products.outOfStock') },
  ];
  const sortOpts: ComboboxOption[] = [
    { value: 'newest',      label: t('products.sort.newest') },
    { value: 'oldest',      label: t('products.sort.oldest') },
    { value: 'name_asc',    label: t('products.sort.nameAsc') },
    { value: 'name_desc',   label: t('products.sort.nameDesc') },
    { value: 'rating_desc', label: t('products.sort.ratingDesc') },
  ];

  return (
    <>
      {/* Backdrop below lg only. Above it the panel is a column, not a modal,
          so there is nothing to dim. */}
      {open && (
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="fixed inset-0 z-40 bg-veil/40 backdrop-blur-[2px] animate-fade-in xl:hidden"
        />
      )}

      <aside
        className={`bg-card border-border flex-col
          fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[440px] border-l sm:rounded-l-3xl sales-drawer shadow-modal
          xl:z-auto xl:w-auto xl:flex-1 xl:min-w-0 xl:border xl:rounded-2xl xl:shadow-card
          xl:sticky xl:top-[72px] xl:h-[calc(100vh-104px)] xl:overflow-hidden
          ${open ? 'flex' : 'hidden xl:flex'}`}
        aria-label={t('orderCreate.panel.title')}
      >
        {/* ─── Search ─────────────────────────────────
            One row, as the mockup draws it: the field, the action, and the way
            into the rest of the filters. The panel had a title line above this
            reading "Add products", which is what the whole right-hand half of
            the screen plainly is. */}
        <div className="shrink-0 px-4 py-3 flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted" strokeWidth={1.75} />
            <input
              autoFocus={open}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('orderCreate.panel.search')}
              className="w-full bg-card border border-border rounded-xl h-11 pl-10 pr-9 text-sm font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                aria-label={t('common.clear')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded hover:bg-border/60 flex items-center justify-center"
              >
                <X size={13} strokeWidth={2} className="text-muted" />
              </button>
            )}
          </div>

          {/* Results already follow the typing, so this re-reads the catalogue
              rather than pretending to start the search: prices and stock move
              while a basket is being built, and this is the way to pull the
              current ones without losing the basket. */}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            title={t('orderCreate.panel.refresh', 'Refresh prices and stock')}
            className="h-11 px-5 shrink-0 rounded-xl bg-brand hover:bg-brand-mid disabled:opacity-60 text-white text-sm font-semibold font-display inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            {isFetching
              ? <Loader2 size={16} strokeWidth={2.5} className="animate-spin" />
              : <Search size={16} strokeWidth={2.5} />}
            <span className="hidden sm:inline">{t('orderCreate.panel.searchButton', 'Search')}</span>
          </button>

          {/* The mockup labels this one "Categories". Ours opens brand, origin,
              shop and stock as well as category, so it keeps the name of what
              it actually does — the strip below already IS the categories. */}
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            // Its word is gone on a phone, the icon alone left.
            aria-label={t('products.filters.title')}
            className={`h-11 px-3.5 shrink-0 rounded-xl border inline-flex items-center gap-1.5 text-sm font-semibold font-display transition-colors ${
              activeFilters
                ? 'border-brand text-brand bg-brand-mist/30'
                : 'border-border text-ink hover:border-brand'
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

        {/* ─── Active filters ─────────────────────── */}
        {chips.length > 0 && (
          <div className="shrink-0 px-4 py-2.5 border-b border-border bg-surface-cream/40 flex flex-wrap items-center gap-1.5">
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

        {/* Whose products these are. One source: said in a line. Several —
            shops, or a shop and the products assigned by hand: a row to
            narrow to one of them, one tap, as the category strip is. */}
        {sources.length === 1 && (
          <div className="shrink-0 px-4 py-1.5 border-b border-border bg-surface-cream/60 flex items-center gap-1.5 text-[12px] text-gray font-display">
            {sources[0].id === ASSIGNED
              ? <PackageCheck size={13} strokeWidth={1.75} className="text-brand shrink-0" />
              : <Store size={13} strokeWidth={1.75} className="text-brand shrink-0" />}
            <span className="truncate">
              {sources[0].id === ASSIGNED
                ? t('repShop.panelAssigned', 'Your assigned products')
                : t('repShop.panelFrom', 'Products from {{name}}', { name: sources[0].name })}
            </span>
          </div>
        )}
        {sources.length > 1 && (
          <div className="shrink-0 border-b border-border bg-surface-cream/60 overflow-x-auto">
            <div role="group" aria-label={t('repShop.shopsLabel', 'Your shops')} className="flex items-center gap-1.5 px-3 py-1.5 min-w-max">
              <Store size={14} strokeWidth={1.75} className="text-brand shrink-0 mx-1" aria-hidden="true" />
              {[{ id: '', name: t('repShop.allShops', 'All shops') }, ...sources].map((s) => (
                <button
                  key={s.id || 'all'}
                  type="button"
                  onClick={() => setStoreId(s.id)}
                  aria-pressed={storeId === s.id}
                  className={`h-8 px-3 shrink-0 max-w-[200px] rounded-full inline-flex items-center gap-1.5 text-[12px] font-semibold font-display transition-colors ${
                    storeId === s.id ? 'bg-brand text-white' : 'bg-card border border-border text-gray hover:border-brand'
                  }`}
                >
                  {s.id === ASSIGNED && <PackageCheck size={13} strokeWidth={2} className="shrink-0" />}
                  <span className="truncate">{s.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ─── Category rail ──────────────── */}
        {/* The categories a rep reaches for are the ones they are standing in
            front of, so they are one tap rather than three in a drawer. The
            drawer keeps the rest — brand, origin, shop, stock — which are
            how you narrow a category, not how you pick one.

            Icon BESIDE the label, not above it. Stacked, each tab was 68px
            tall and the strip ate most of a product row; this is 36px and
            buys that row back, which is what the panel is actually for. */}
        {(categories ?? []).length > 0 && (
          <div className="shrink-0 border-b border-border overflow-x-auto">
            <div className="flex items-center gap-1.5 px-3 py-2 min-w-max">
              <button
                type="button"
                onClick={() => { setCategoryId(''); setSubcategoryId(''); }}
                className={`h-9 px-3 shrink-0 rounded-lg inline-flex items-center gap-1.5 text-xs font-semibold font-display whitespace-nowrap transition-colors ${
                  categoryId === ''
                    ? 'bg-brand text-white'
                    : 'text-gray hover:bg-surface-cream'
                }`}
              >
                <LayoutGrid size={15} strokeWidth={1.75} className="shrink-0" />
                {t('orderCreate.panel.allCategories', 'All')}
              </button>
              {(categories ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { setCategoryId(c.id); setSubcategoryId(''); }}
                  className={`h-9 px-3 shrink-0 max-w-[170px] rounded-lg inline-flex items-center gap-1.5 text-xs font-semibold font-display transition-colors ${
                    categoryId === c.id
                      ? 'bg-brand text-white'
                      : 'text-gray hover:bg-surface-cream'
                  }`}
                >
                  {/* The category's own icon, falling back to a parcel. An
                      icon that fails to load must not leave a broken-image
                      glyph sitting in the strip. */}
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

        {/* ─── Results ───────────────────── */}
        {/* A grid of cards, not a list of rows. A rep picking from a shelf is
            matching packaging, and a 44px thumbnail beside a line of text is
            the wrong shape for that — the picture should be the biggest thing
            on the card. */}
        <div className="flex-1 overflow-y-auto bg-surface-linen/40">
          {shopKnown && !shopOk ? (
            <div className="px-6 py-12 text-center max-w-sm mx-auto">
              <span className="mx-auto w-14 h-14 rounded-full bg-brand-mist text-brand flex items-center justify-center">
                <Store size={24} strokeWidth={1.75} />
              </span>
              <p className="mt-3 text-sm font-semibold font-display text-ink">
                {unavailable.length === 0
                  ? t('repShop.noneTitle', 'You have no shop yet')
                  : unavailable.length === 1
                    ? t('repShop.unavailableTitle', 'Your shop is not available')
                    : t('repShop.unavailableTitleMany', 'Your shops are not available')}
              </p>
              <p className="mt-1 text-[13px] text-muted">
                {unavailable.length === 0
                  ? t('repShop.panelNoneBody', 'An admin has to assign you a shop before you can add products.')
                  : unavailable.length === 1
                    ? t('repShop.unavailableBody', '{{name}} is switched off, suspended or being deleted. Ask an admin to assign you another.', { name: unavailable[0].name })
                    : t('repShop.unavailableBodyMany', '{{names}} are switched off, suspended or being deleted. Ask an admin to assign you another.', { names: listNames(unavailable.map((s) => s.name), lang) })}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 h-11 px-4 rounded-xl border border-border bg-card text-sm font-semibold font-display text-ink hover:border-brand xl:hidden"
              >
                {t('common.close', 'Close')}
              </button>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted">
              <Loader2 className="w-5 h-5 animate-spin" strokeWidth={1.75} />
            </div>
          ) : products.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-muted">{t('orderCreate.panel.noResults')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-2 p-2.5">
              {products.map((p) => {
                const variants = p.variants ?? [];
                const chosenId = chosenVariant[p.id] ?? variants[0]?.id;
                const v = variants.find((x) => x.id === chosenId) ?? variants[0];
                const img = p.images?.[0]?.url;
                const inBasket = v ? (quantities[v.id] ?? 0) : 0;
                const wasPrice = v?.compare_at_price != null ? Number(v.compare_at_price) : null;
                const onOffer = v != null && wasPrice != null && wasPrice > Number(v.price);

                return (
                  <div
                    key={p.id}
                    className="group flex flex-col rounded-2xl border border-border/70 bg-card p-2 hover:border-border hover:shadow-card transition-all"
                  >
                    {/* Image holds the badge and the add control. Floating the
                        control over the picture is what the customer-facing
                        card does, and it buys back a whole row — which is the
                        row the variant box was squatting in. */}
                    {/* 4:3 rather than square — the picture only has to identify the
                        product, and the shorter box puts more cards on screen,
                        which is what an order builder is short of. */}
                    <div className="relative aspect-[3/2] rounded-xl overflow-hidden bg-surface-cream">
                      {onOffer ? (
                        <span className="absolute top-1.5 left-1.5 z-10 inline-flex items-center bg-danger text-white text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md shadow-card">
                          {t('orderCreate.panel.offer', 'Offer')}
                        </span>
                      ) : p.is_top_seller ? (
                        <span className="absolute top-1.5 left-1.5 z-10 inline-flex items-center bg-amber-deep text-white text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md shadow-card">
                          {t('orderCreate.panel.topSeller', 'Top')}
                        </span>
                      ) : null}

                      {img
                        ? <img src={resolveImageUrl(img)} alt="" className="absolute inset-0 w-full h-full object-contain p-1.5 group-hover:scale-[1.03] transition-transform duration-500 ease-out" draggable={false} />
                        : <div className="absolute inset-0 flex items-center justify-center"><Package size={28} strokeWidth={1.5} className="text-muted/50" /></div>}
                    </div>

                    {/* Price anchors the left, brand sits right with the space
                        between them, so the price keeps the visual weight. */}
                    <div className="mt-2 flex items-baseline gap-2">
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span className="text-[14.5px] font-bold text-brand tabular-nums leading-none">
                          {v ? formatCurrency(Number(v.price)) : '\u2014'}
                        </span>
                        {onOffer && (
                          <span className="text-[11.5px] text-muted line-through">
                            {formatCurrency(wasPrice!)}
                          </span>
                        )}
                      </div>
                      {p.brand && (
                        <span className="ml-auto text-[11px] font-semibold text-muted leading-none truncate max-w-[50%] self-center text-right">
                          {p.brand}
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-[12px] font-medium text-ink leading-snug line-clamp-2">
                      {p.name_es}
                    </p>

                    <p className="mt-0.5 text-[10px] text-muted truncate">
                      {/* Theirs by hand, not through one of their shops: a
                          small tick in blue, as on the Catálogo's cards. */}
                      {p.assigned && (
                        <PackageCheck size={11} strokeWidth={2} className="inline -mt-px mr-1 text-brand" aria-label={t('repShop.assigned', 'Assigned')} />
                      )}
                      {t('orderCreate.panel.soldBy', 'Sold by')}{' '}
                      {/* The shop carries the weight, not the words in front of
                          it: a rep scanning the grid is looking for whose stock
                          it is, and "Sold by" is the same on every card. */}
                      <span className={`font-semibold ${p.assigned ? 'text-brand' : 'text-gray'}`}>
                        {p.store?.name ?? t('orderDetail.editOrder.cestoHouseStore')}
                      </span>
                    </p>

                    {/* Only when there is genuinely a choice. One variant has
                        nothing to pick, and a disabled box repeating the size
                        was the thing cluttering these cards. */}
                    {variants.length > 1 && (
                      <select
                        value={chosenId}
                        onChange={(e) => setChosenVariant((m) => ({ ...m, [p.id]: e.target.value }))}
                        aria-label={t('orderDetail.table.variant')}
                        className="mt-1.5 w-full h-7 px-2 rounded-lg border border-border bg-card text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                      >
                        {variants.map((x) => (
                          <option key={x.id} value={x.id}>{x.name_es}</option>
                        ))}
                      </select>
                    )}

                    {/* A full-width, labelled action rather than the floating
                        circle the customer card uses. That circle is right for
                        browsing — small, out of the way, one of many on a
                        scrolling page. This is an order being built at a
                        counter: the button is pressed over and over, often in
                        a hurry, so it takes the whole width, says what it does
                        and turns into the stepper in place rather than
                        swapping a 44px target for a different 44px target
                        somewhere else on the card.

                        `mt-auto` pins it to the bottom, so cards in a row end
                        level even when one name wraps to two lines and its
                        neighbour does not. */}
                    {v && (
                      <div className="mt-auto pt-1.5">
                        {inBasket === 0 ? (
                          <button
                            type="button"
                            disabled={v.stock_quantity <= 0}
                            onClick={() => onAdd(toPicked(p, v, variants.length > 1 ? v.name_es : undefined))}
                            className="w-full h-9 rounded-xl bg-brand hover:bg-brand-mid disabled:bg-surface-cream disabled:text-muted disabled:cursor-not-allowed text-white text-[12px] font-semibold font-display inline-flex items-center justify-center gap-1.5 transition-colors"
                          >
                            {v.stock_quantity <= 0 ? (
                              t('products.outOfStock')
                            ) : (
                              <>
                                <Plus size={15} strokeWidth={2.75} />
                                {t('orderCreate.panel.add', 'Add')}
                              </>
                            )}
                          </button>
                        ) : (
                          <div className="w-full h-9 rounded-xl border-2 border-brand flex items-center overflow-hidden">
                            <button
                              type="button"
                              onClick={() => onSetQuantity(v.id, inBasket - 1)}
                              aria-label={t('orderCreate.decrease', 'Decrease')}
                              className="h-full w-9 shrink-0 flex items-center justify-center text-brand hover:bg-brand-whisper transition-colors"
                            >
                              <Minus size={15} strokeWidth={2.75} />
                            </button>
                            <span className="flex-1 text-center text-[13px] font-bold text-brand tabular-nums">
                              {inBasket}
                            </span>
                            <button
                              type="button"
                              onClick={() => onSetQuantity(v.id, inBasket + 1)}
                              aria-label={t('orderCreate.increase', 'Increase')}
                              className="h-full w-9 shrink-0 flex items-center justify-center text-brand hover:bg-brand-whisper transition-colors"
                            >
                              <Plus size={15} strokeWidth={2.75} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Pulls the next page when it scrolls into view. A rep hunting one
              product among thousands cannot be handed the first thirty and
              left there — with no pager underneath, "the first thirty that
              matched" looks exactly like "all that matched". */}
          {hasNextPage && (
            <div ref={loadMoreRef} className="px-3 pb-4 pt-1 flex items-center justify-center">
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="h-9 px-4 rounded-lg border border-border text-xs font-semibold font-display text-gray hover:border-brand hover:text-brand disabled:opacity-60 inline-flex items-center gap-1.5 transition-colors"
              >
                {isFetchingNextPage && <Loader2 size={13} strokeWidth={2.5} className="animate-spin" />}
                {isFetchingNextPage
                  ? t('common.loading', 'Loading…')
                  : t('orderCreate.panel.loadMore', 'Load more')}
              </button>
            </div>
          )}
        </div>

        {/* ─── Footer ─────────────────────────────── */}
        <div className="shrink-0 border-t border-border px-4 py-2.5 flex items-center gap-2">
          {/* No spinner. The last count is still the right answer until the
              next one lands, so it stays and rolls over to the new figure
              rather than being cleared and reinstated — and nothing appears
              beside it to shunt it sideways.

              `total` comes off the first page of THIS query, so it already
              counts only active products in the chosen category with whatever
              the drawer is holding: the figure moves with the tab. */}
          <span className="text-[11px] text-muted flex-1 min-w-0 truncate leading-4">
            {total > 0 && (
              <RollingText
                className="h-4"
                value={t('orderCreate.panel.countLoaded', '{{loaded}} of {{total}} products', {
                  loaded: products.length, total,
                })}
              />
            )}
          </span>
          {onCreateNew && (
            <button
              type="button"
              onClick={onCreateNew}
              className="h-8 px-2.5 rounded-lg border border-dashed border-border hover:border-brand text-xs font-semibold font-display text-brand inline-flex items-center gap-1.5 shrink-0"
            >
              <PackagePlus size={13} strokeWidth={1.75} />
              {t('orderCreate.panel.createNew')}
            </button>
          )}
        </div>
      </aside>

      {/* ─── Filter drawer ────────────────────────── */}
      {/* Over the drawer this opens from, so one layer up. */}
      {filtersOpen && (
        <Dialog
          variant="side"
          layer="z-[58]"
          onClose={() => setFiltersOpen(false)}
          closeLabel={t('common.close')}
          icon={SlidersHorizontal}
          title={t('products.filters.title')}
          bodyClassName="px-5 py-4 space-y-3"
          footer={(
            <div className="flex gap-2.5">
              <Button variant="secondary" className="flex-1" onClick={resetFilters} disabled={activeFilters === 0}>
                {t('products.filters.clearAll')}
              </Button>
              <Button className="flex-1" onClick={() => setFiltersOpen(false)}>{t('products.filters.done')}</Button>
            </div>
          )}
        >
              <div className="rounded-xl bg-surface-cream/60 border border-border p-3 space-y-2.5">
                <PanelField label={t('products.chips.category')}>
                  <Combobox
                    value={categoryId} onChange={pickCategory}
                    ariaLabel={t('products.allCategories')} placeholder={t('products.allCategories')}
                    options={categoryOpts} searchable
                    menuPortal
                  />
                </PanelField>
                <PanelField label={t('products.chips.subcategory')}>
                  <Combobox
                    value={subcategoryId} onChange={setSubcategoryId}
                    ariaLabel={t('products.allSubcategories')}
                    placeholder={categoryId ? t('products.allSubcategories') : t('products.filters.pickCategoryFirst')}
                    options={subcategoryOpts} disabled={!categoryId} searchable
                    menuPortal
                  />
                </PanelField>
              </div>

              <PanelField label={t('products.chips.brand')}>
                <Combobox
                  value={brandId} onChange={setBrandId}
                  ariaLabel={t('products.allBrands')} placeholder={t('products.allBrands')}
                  options={brandOpts} searchable
                  menuPortal
                />
              </PanelField>
              <PanelField label={t('products.chips.origin')}>
                <Combobox
                  value={originId} onChange={setOriginId}
                  ariaLabel={t('products.allOrigins')} placeholder={t('products.allOrigins')}
                  options={originOpts} searchable
                  menuPortal
                />
              </PanelField>
              {/* A rep's shops have their own row above; an API from before
                  shops has none, and the drawer offers every shop. */}
              {!shopKnown && (
                <PanelField label={t('products.chips.store')}>
                  <Combobox
                    value={storeId} onChange={setStoreId}
                    ariaLabel={t('products.allStores')} placeholder={t('products.allStores')}
                    options={storeOpts} searchable
                    menuPortal
                  />
                </PanelField>
              )}
              <PanelField label={t('products.chips.stock')}>
                <Combobox
                  value={stock} onChange={setStock}
                  ariaLabel={t('products.allStock')} placeholder={t('products.allStock')}
                  options={stockOpts}
                  menuPortal
                />
              </PanelField>
              <PanelField label={t('products.chips.sort')}>
                <Combobox
                  value={sort} onChange={setSort}
                  ariaLabel={t('products.chips.sort')} placeholder={t('products.sort.newest')}
                  options={sortOpts}
                  menuPortal
                />
              </PanelField>
        </Dialog>
      )}
    </>
  );
}

/**
 * A labelled filter field.
 *
 * A <div>, NOT a <label>, and that is the whole point. <button> is a labelable
 * element, so a <label> wrapping this Combobox adopts its trigger — and then
 * a click ANYWHERE inside the label, including on an option in the open menu,
 * is re-dispatched onto that trigger. Selecting an option therefore closed the
 * menu (commit) and immediately reopened it (the forwarded click), which read
 * as the dropdown refusing to close.
 *
 * Nothing is lost: Combobox takes `ariaLabel`, which is what actually names it
 * for assistive tech, and every caller here passes one.
 */
function PanelField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12.5px] font-medium text-gray font-display">
        {label}
      </span>
      {children}
    </div>
  );
}
