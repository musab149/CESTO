import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search, X, SlidersHorizontal, RotateCcw, Loader2, Package, LayoutGrid, ChevronDown, Plus, Minus,
} from 'lucide-react';
import {
  useCategories, useSubcategories, useInfiniteProducts, useOriginsList, useStores, homeSectionsService,
  resolveImageUrl, effectiveVatCategory, type Product, type ProductVariant,
} from '@grocery-app/shared';
import Combobox, { type ComboboxOption } from '@/sales/components/form/Combobox';
import RollingText from '@/sales/components/RollingText';
import { formatCurrency } from '@/sales/lib/format';

/** What adding a product puts on the order. */
export interface CatalogPick {
  variantId: string;
  name: string;
  variantName: string;
  price: number;
  imageUrl: string | null;
  vatCategory: NonNullable<Product['vat_category']>;
}

/**
 * The catalogue, beside the order a customer is changing.
 *
 * PORTED from the rep's panel (sales/components/OrderProductPanel.tsx, itself
 * admin's) so a Home Grocery household edits an order on the screen staff and
 * reps use: the same search row, category strip, filter drawer, cards and
 * add-then-stepper button. The differences are the data, not the design:
 *
 *   · The customer's catalogue (/api/products) — active products only, priced
 *     for the signed-in customer, which is what the order is written at.
 *   · Brand and origin filter by name, as the shop's own filters do; there is
 *     no stock filter or rating sort on this endpoint, and no "not in the
 *     catalogue" row — creating products is staff's.
 *   · Words in the customer's language, Spanish first.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  /** Quantity already on the order, keyed by variant id. */
  quantities: Record<string, number>;
  onAdd: (p: CatalogPick) => void;
  onSetQuantity: (variantId: string, quantity: number) => void;
  lang: 'es' | 'en';
}

const PAGE_SIZE = 30;

export default function CatalogPanel({ open, onClose, quantities, onAdd, onSetQuantity, lang }: Props) {
  const L = (es: string, en: string) => (lang === 'en' ? en : es);
  const nameOf = (x: { name_es: string; name_en?: string | null }) => (lang === 'en' && x.name_en ? x.name_en : x.name_es);

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  // Which variant each card is showing: the card picks on the card.
  const [chosenVariant, setChosenVariant] = useState<Record<string, string>>({});

  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [brand, setBrand] = useState('');
  const [origin, setOrigin] = useState('');
  const [storeId, setStoreId] = useState('');
  const [sort, setSort] = useState('newest');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  // Escape closes the filter drawer first, then the panel — and the panel
  // only where it is an overlay. From xl it is a column of the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (filtersOpen) { setFiltersOpen(false); return; }
      if (open && !window.matchMedia('(min-width: 1280px)').matches) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, filtersOpen, onClose]);

  const { data: categories = [] } = useCategories();
  const { data: subcategories = [] } = useSubcategories(categoryId || undefined);
  const { data: origins = [] } = useOriginsList();
  const { data: stores } = useStores({ limit: 100, sort: 'name' });
  const { data: brandCounts = [] } = useQuery({
    queryKey: ['brand-counts'],
    queryFn: () => homeSectionsService.brandCounts(),
    staleTime: 5 * 60_000,
    meta: { inlineErrors: true },
  });
  const { data: originCounts = [] } = useQuery({
    queryKey: ['origin-counts'],
    queryFn: () => homeSectionsService.originCounts(),
    staleTime: 5 * 60_000,
    meta: { inlineErrors: true },
  });
  const originLabel = (key: string) => {
    const known = origins.find((x) => x.key.toLowerCase() === key.toLowerCase());
    return known ? (lang === 'en' ? known.label_en : known.label_es) : key.charAt(0).toUpperCase() + key.slice(1);
  };

  const {
    data, isLoading, isFetching, refetch, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteProducts({
    q: debouncedQ || undefined,
    categoryId: categoryId || undefined,
    subcategoryId: subcategoryId || undefined,
    brand: brand || undefined,
    origin: origin || undefined,
    storeId: storeId || undefined,
    sort: sort !== 'newest' ? (sort as 'name_asc' | 'popular') : undefined,
    limit: PAGE_SIZE,
  }, { inlineErrors: true });

  const products = useMemo(() => (data?.pages ?? []).flatMap((p) => p.items), [data]);
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

  // What the drawer holds. The category is on the strip, so it is not counted.
  const activeFilters = [subcategoryId, brand, origin, storeId].filter(Boolean).length + (sort !== 'newest' ? 1 : 0);
  const resetFilters = () => { setSubcategoryId(''); setBrand(''); setOrigin(''); setStoreId(''); setSort('newest'); };
  const pickCategory = (v: string) => { setCategoryId(v); setSubcategoryId(''); };

  const sortLabels: Record<string, string> = {
    newest: L('Más nuevos', 'Newest'),
    name_asc: L('Nombre (A–Z)', 'Name (A–Z)'),
    popular: L('Más vendidos', 'Best sellers'),
  };
  const cestoShop = 'Cesto Shop';

  const chips: { key: string; label: string; onClear: () => void }[] = [];
  if (subcategoryId) {
    const sc = subcategories.find((x) => x.id === subcategoryId);
    chips.push({ key: 'subcategory', label: sc ? nameOf(sc) : L('Subcategoría', 'Subcategory'), onClear: () => setSubcategoryId('') });
  }
  if (brand) chips.push({ key: 'brand', label: brand, onClear: () => setBrand('') });
  if (origin) chips.push({ key: 'origin', label: originLabel(origin), onClear: () => setOrigin('') });
  if (storeId) {
    const st = (stores?.items ?? []).find((x) => x.id === storeId);
    chips.push({ key: 'store', label: storeId === 'cesto' ? cestoShop : (st?.name ?? L('Tienda', 'Shop')), onClear: () => setStoreId('') });
  }
  if (sort !== 'newest') chips.push({ key: 'sort', label: sortLabels[sort] ?? sort, onClear: () => setSort('newest') });

  const toPick = (p: Product, v: ProductVariant, several: boolean): CatalogPick => ({
    variantId: v.id,
    name: nameOf(p),
    variantName: several ? nameOf(v) : '',
    price: Number(v.price),
    imageUrl: p.images?.[0]?.url ?? null,
    vatCategory: effectiveVatCategory(p),
  });

  const categoryOpts: ComboboxOption[] = [
    { value: '', label: L('Todas las categorías', 'All categories') },
    ...categories.map((c) => ({ value: c.id, label: nameOf(c) })),
  ];
  const subcategoryOpts: ComboboxOption[] = [
    { value: '', label: L('Todas las subcategorías', 'All subcategories') },
    ...subcategories.map((s) => ({ value: s.id, label: nameOf(s) })),
  ];
  const brandOpts: ComboboxOption[] = [
    { value: '', label: L('Todas las marcas', 'All brands') },
    ...[...brandCounts].sort((a, b) => a.name.localeCompare(b.name, lang)).map((b) => ({ value: b.name, label: b.name })),
  ];
  const originOpts: ComboboxOption[] = [
    { value: '', label: L('Todos los orígenes', 'All origins') },
    ...originCounts.map((o) => ({ value: o.key, label: originLabel(o.key) })),
  ];
  const storeOpts: ComboboxOption[] = [
    { value: '', label: L('Todas las tiendas', 'All shops') },
    { value: 'cesto', label: cestoShop },
    ...((stores?.items ?? []).map((s) => ({ value: s.id, label: s.name }))),
  ];
  const sortOpts: ComboboxOption[] = Object.entries(sortLabels).map(([value, label]) => ({ value, label }));

  return (
    <>
      {/* Backdrop below xl only. From xl the panel is a column, not a modal. */}
      {open && (
        <button
          type="button"
          onClick={onClose}
          aria-label={L('Cerrar', 'Close')}
          className="fixed inset-0 z-40 bg-black/50 xl:hidden"
        />
      )}

      <aside
        className={`bg-card border-border flex-col
          fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[420px] border-l shadow-modal
          xl:z-auto xl:w-auto xl:flex-1 xl:min-w-0 xl:border xl:rounded-xl xl:shadow-none
          xl:sticky xl:top-[172px] xl:h-[calc(100vh-188px)] xl:overflow-hidden
          ${open ? 'flex' : 'hidden xl:flex'}`}
        aria-label={L('Añadir productos', 'Add products')}
      >
        {/* ─── Search ───────────────────────────────── */}
        <div className="shrink-0 px-4 py-3 flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted" strokeWidth={1.75} />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={L('Buscar productos…', 'Search products…')}
              className="w-full bg-card border border-border rounded-xl h-11 pl-10 pr-9 text-sm font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                aria-label={L('Borrar', 'Clear')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded hover:bg-border/60 flex items-center justify-center"
              >
                <X size={13} strokeWidth={2} className="text-muted" />
              </button>
            )}
          </div>

          {/* Results already follow the typing: this re-reads prices and stock. */}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            title={L('Actualizar precios y stock', 'Refresh prices and stock')}
            className="h-11 px-5 shrink-0 rounded-xl bg-brand hover:bg-brand-mid disabled:opacity-60 text-white text-sm font-semibold font-display inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            {isFetching
              ? <Loader2 size={16} strokeWidth={2.5} className="animate-spin" />
              : <Search size={16} strokeWidth={2.5} />}
            <span className="hidden sm:inline">{L('Buscar', 'Search')}</span>
          </button>

          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className={`h-11 px-3.5 shrink-0 rounded-xl border inline-flex items-center gap-1.5 text-sm font-semibold font-display transition-colors ${
              activeFilters ? 'border-brand text-brand bg-brand-mist/30' : 'border-border text-ink hover:border-brand'
            }`}
          >
            <SlidersHorizontal size={16} strokeWidth={1.75} />
            <span className="hidden sm:inline">{L('Filtros', 'Filters')}</span>
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
            aria-label={L('Cerrar', 'Close')}
            className="xl:hidden w-9 h-9 rounded-lg hover:bg-surface-cream flex items-center justify-center shrink-0"
          >
            <X size={17} strokeWidth={1.75} className="text-muted" />
          </button>
        </div>

        {/* ─── Active filters ───────────────────────── */}
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
              {L('Quitar filtros', 'Clear filters')}
            </button>
          </div>
        )}

        {/* ─── Category strip ───────────────────────── */}
        {categories.length > 0 && (
          <div className="shrink-0 border-b border-border overflow-x-auto">
            <div className="flex items-center gap-1.5 px-3 py-2 min-w-max">
              <button
                type="button"
                onClick={() => pickCategory('')}
                className={`h-9 px-3 shrink-0 rounded-lg inline-flex items-center gap-1.5 text-xs font-semibold font-display whitespace-nowrap transition-colors ${
                  categoryId === '' ? 'bg-brand text-white' : 'text-gray hover:bg-surface-cream'
                }`}
              >
                <LayoutGrid size={15} strokeWidth={1.75} className="shrink-0" />
                {L('Todo', 'All')}
              </button>
              {categories.map((c) => (
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
                  <span className="truncate">{nameOf(c)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ─── Results ─────────────────────────────── */}
        <div className="flex-1 overflow-y-auto bg-surface-linen/40">
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-2 p-2.5">
              {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-[236px] !rounded-2xl" />)}
            </div>
          ) : products.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-muted">{L('No hay productos con esta búsqueda.', 'No products match this search.')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-2 p-2.5">
              {products.map((p) => {
                const variants = (p.variants ?? []).filter((x) => x.is_active !== false);
                const chosenId = chosenVariant[p.id] ?? variants[0]?.id;
                const v = variants.find((x) => x.id === chosenId) ?? variants[0];
                const img = p.images?.[0]?.url;
                const onOrder = v ? (quantities[v.id] ?? 0) : 0;
                const wasPrice = v?.compare_at_price != null ? Number(v.compare_at_price) : null;
                const onOffer = v != null && wasPrice != null && wasPrice > Number(v.price);

                return (
                  <div
                    key={p.id}
                    className="group flex flex-col rounded-2xl border border-border/70 bg-card p-2 hover:border-border hover:shadow-card transition-all"
                  >
                    <div className="relative aspect-[3/2] rounded-xl overflow-hidden bg-surface-cream">
                      {onOffer ? (
                        <span className="absolute top-1.5 left-1.5 z-10 inline-flex items-center bg-danger text-white text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md shadow-card">
                          {L('Oferta', 'Offer')}
                        </span>
                      ) : p.is_top_seller ? (
                        <span className="absolute top-1.5 left-1.5 z-10 inline-flex items-center bg-amber-deep text-white text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md shadow-card">
                          {L('Top', 'Top')}
                        </span>
                      ) : null}
                      {img
                        ? <img src={resolveImageUrl(img)} alt="" className="absolute inset-0 w-full h-full object-contain p-1.5 group-hover:scale-[1.03] transition-transform duration-500 ease-out" draggable={false} />
                        : <div className="absolute inset-0 flex items-center justify-center"><Package size={28} strokeWidth={1.5} className="text-muted/50" /></div>}
                    </div>

                    <div className="mt-2 flex items-baseline gap-2">
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span className="text-[14.5px] font-bold text-brand tabular-nums leading-none">
                          {v ? formatCurrency(Number(v.price)) : '—'}
                        </span>
                        {onOffer && (
                          <span className="text-[11.5px] text-muted line-through">{formatCurrency(wasPrice!)}</span>
                        )}
                      </div>
                      {p.brand && (
                        <span className="ml-auto text-[9.5px] font-bold uppercase tracking-[0.12em] text-muted/85 leading-none truncate max-w-[50%] self-center text-right">
                          {p.brand}
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-[12px] font-medium text-ink leading-snug line-clamp-2">{nameOf(p)}</p>
                    <p className="mt-0.5 text-[10px] text-muted truncate">
                      {L('Vendido por', 'Sold by')}{' '}
                      <span className="font-semibold text-gray">{p.store?.name ?? cestoShop}</span>
                    </p>

                    {variants.length > 1 && (
                      <select
                        value={chosenId}
                        onChange={(e) => setChosenVariant((m) => ({ ...m, [p.id]: e.target.value }))}
                        aria-label={L('Tamaño', 'Size')}
                        className="mt-1.5 w-full h-7 px-2 rounded-lg border border-border bg-card text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                      >
                        {variants.map((x) => <option key={x.id} value={x.id}>{nameOf(x)}</option>)}
                      </select>
                    )}

                    {/* Full width and labelled, turning into the stepper in
                        place; mt-auto keeps a row of cards level. */}
                    {v && (
                      <div className="mt-auto pt-1.5">
                        {onOrder === 0 ? (
                          <button
                            type="button"
                            disabled={v.stock_quantity <= 0}
                            onClick={() => onAdd(toPick(p, v, variants.length > 1))}
                            className="w-full h-9 rounded-xl bg-brand hover:bg-brand-mid disabled:bg-surface-cream disabled:text-muted disabled:cursor-not-allowed text-white text-[12px] font-semibold font-display inline-flex items-center justify-center gap-1.5 transition-colors"
                          >
                            {v.stock_quantity <= 0 ? L('Agotado', 'Out of stock') : (
                              <><Plus size={15} strokeWidth={2.75} />{L('Añadir', 'Add')}</>
                            )}
                          </button>
                        ) : (
                          <div className="w-full h-9 rounded-xl border-2 border-brand flex items-center overflow-hidden">
                            <button
                              type="button"
                              onClick={() => onSetQuantity(v.id, onOrder - 1)}
                              aria-label={L('Quitar uno', 'Decrease')}
                              className="h-full w-9 shrink-0 flex items-center justify-center text-brand hover:bg-brand-whisper transition-colors"
                            >
                              <Minus size={15} strokeWidth={2.75} />
                            </button>
                            <span className="flex-1 text-center text-[13px] font-bold text-brand tabular-nums">{onOrder}</span>
                            <button
                              type="button"
                              onClick={() => onSetQuantity(v.id, onOrder + 1)}
                              aria-label={L('Añadir uno', 'Increase')}
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

          {hasNextPage && (
            <div ref={loadMoreRef} className="px-3 pb-4 pt-1 flex items-center justify-center">
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="h-9 px-4 rounded-lg border border-border text-xs font-semibold font-display text-gray hover:border-brand hover:text-brand disabled:opacity-60 inline-flex items-center gap-1.5 transition-colors"
              >
                {isFetchingNextPage && <Loader2 size={13} strokeWidth={2.5} className="animate-spin" />}
                {isFetchingNextPage ? L('Cargando…', 'Loading…') : L('Cargar más', 'Load more')}
              </button>
            </div>
          )}
        </div>

        {/* ─── Footer ───────────────────────────────── */}
        <div className="shrink-0 border-t border-border px-4 py-2.5 flex items-center gap-2">
          <span className="text-[11px] text-muted flex-1 min-w-0 truncate leading-4">
            {total > 0 && (
              <RollingText
                className="h-4"
                value={L(`${products.length} de ${total} productos`, `${products.length} of ${total} products`)}
              />
            )}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="xl:hidden h-9 px-4 rounded-lg bg-brand text-white text-xs font-semibold font-display"
          >
            {L('Listo', 'Done')}
          </button>
        </div>
      </aside>

      {/* ─── Filter drawer ────────────────────────── */}
      {filtersOpen && (
        <>
          <button
            type="button"
            onClick={() => setFiltersOpen(false)}
            aria-label={L('Cerrar', 'Close')}
            className="fixed inset-0 z-[55] bg-black/50"
          />
          <aside className="fixed right-0 top-0 bottom-0 z-[56] w-full sm:w-[380px] bg-card shadow-modal flex flex-col">
            <div className="shrink-0 px-4 py-3 border-b border-border flex items-center gap-2">
              <h3 className="text-sm font-semibold font-display text-ink flex-1 inline-flex items-center gap-1.5">
                <SlidersHorizontal size={15} strokeWidth={1.75} className="text-brand" />
                {L('Filtros', 'Filters')}
              </h3>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                aria-label={L('Cerrar', 'Close')}
                className="w-9 h-9 rounded-lg hover:bg-surface-cream flex items-center justify-center"
              >
                <X size={17} strokeWidth={1.75} className="text-muted" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              <div className="rounded-lg bg-surface-cream/60 border border-border p-3 space-y-2.5">
                <PanelField label={L('Categoría', 'Category')}>
                  <Combobox value={categoryId} onChange={pickCategory} ariaLabel={L('Categoría', 'Category')}
                    placeholder={L('Todas las categorías', 'All categories')} options={categoryOpts} searchable menuPortal />
                </PanelField>
                <PanelField label={L('Subcategoría', 'Subcategory')}>
                  <Combobox value={subcategoryId} onChange={setSubcategoryId} ariaLabel={L('Subcategoría', 'Subcategory')}
                    placeholder={categoryId ? L('Todas las subcategorías', 'All subcategories') : L('Elige antes una categoría', 'Pick a category first')}
                    options={subcategoryOpts} disabled={!categoryId} searchable menuPortal />
                </PanelField>
              </div>
              <PanelField label={L('Marca', 'Brand')}>
                <Combobox value={brand} onChange={setBrand} ariaLabel={L('Marca', 'Brand')}
                  placeholder={L('Todas las marcas', 'All brands')} options={brandOpts} searchable menuPortal />
              </PanelField>
              <PanelField label={L('Origen', 'Origin')}>
                <Combobox value={origin} onChange={setOrigin} ariaLabel={L('Origen', 'Origin')}
                  placeholder={L('Todos los orígenes', 'All origins')} options={originOpts} searchable menuPortal />
              </PanelField>
              <PanelField label={L('Tienda', 'Shop')}>
                <Combobox value={storeId} onChange={setStoreId} ariaLabel={L('Tienda', 'Shop')}
                  placeholder={L('Todas las tiendas', 'All shops')} options={storeOpts} searchable menuPortal />
              </PanelField>
              <PanelField label={L('Ordenar', 'Sort')}>
                <Combobox value={sort} onChange={setSort} ariaLabel={L('Ordenar', 'Sort')}
                  placeholder={sortLabels.newest} options={sortOpts} menuPortal />
              </PanelField>
            </div>

            <div className="shrink-0 border-t border-border px-4 py-3 flex items-center gap-2">
              <button
                type="button"
                onClick={resetFilters}
                disabled={activeFilters === 0}
                className="flex-1 h-10 rounded-xl border border-border hover:border-brand disabled:opacity-40 text-sm font-semibold font-display text-ink"
              >
                {L('Quitar filtros', 'Clear filters')}
              </button>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="flex-1 h-10 rounded-xl bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display"
              >
                {L('Listo', 'Done')}
              </button>
            </div>
          </aside>
        </>
      )}
    </>
  );
}

/**
 * A labelled filter field — a <div>, never a <label>: a label wrapping the
 * Combobox adopts its trigger and re-fires every click inside it, so picking
 * an option reopened the menu.
 */
function PanelField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted font-display">{label}</span>
      {children}
    </div>
  );
}
