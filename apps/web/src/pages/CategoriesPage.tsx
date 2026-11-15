import { useNavigate, useSearchParams } from 'react-router-dom';
import { useCategories, useInfiniteProducts, useSubcategories, useProductTypesForSubcategory, useBrandsList, useOriginsList, resolveImageUrl } from '@grocery-app/shared';
import type { Product, TopBrand, OriginCard as OriginCardType, Category, SubCategory } from '@grocery-app/shared';
import ProductCard from '@/components/ProductCard';
import { ProductCardSkeleton, Skeleton } from '@/components/Skeleton';
import InfiniteScroll from '@/components/InfiniteScroll';
import { ListLoadFailed } from '@/components/LoadFailed';
import { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronDown, ChevronRight, Search, SlidersHorizontal, ArrowRight, Sparkles, X, Plus, Minus } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { useCartStore } from '@/stores/cartStore';
import { usePreviewModeStore } from '@/stores/previewModeStore';
import { emojiForCategory } from '@/lib/categoryIcon';
import { usePriceTone } from '@/lib/priceTone';
import { logoPlate } from '@/lib/logoPlate';

export default function CategoriesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { lang, t } = useLanguageStore();
  const { data: categories, isLoading: catLoading } = useCategories();
  const { data: brandsData } = useBrandsList();
  const topBrands: TopBrand[] = useMemo(
    () => (brandsData ?? []).map((b) => ({
      name: b.name,
      image_url: b.logo_url,
      bg_color: b.logo_bg ?? undefined,
      link: b.link ?? `/categories?brand=${encodeURIComponent(b.name)}`,
      is_active: true,
      display_order: b.sort_order,
    })),
    [brandsData],
  );
  const { data: originsData } = useOriginsList();
  const originCards: OriginCardType[] = useMemo(
    () => (originsData ?? []).map((o) => ({
      key: o.key.toLowerCase(),
      label_es: o.label_es,
      label_en: o.label_en,
      bg_color: o.bg_color ?? '#F5F0E8',
      accent_color: o.accent_color ?? '#7A7A7A',
      image_url: o.image_url,
      link: o.link ?? `/categories?origin=${o.key}`,
      is_active: true,
      display_order: o.sort_order,
    })),
    [originsData],
  );

  const [activeCatId, setActiveCatId] = useState<string | null>(searchParams.get('cat'));
  const [activeSubId, setActiveSubId] = useState<string | null>(searchParams.get('sub'));
  const [activeProductTypeId, setActiveProductTypeId] = useState<string | null>(searchParams.get('type'));
  const [activeBrand, setActiveBrand] = useState<string | null>(searchParams.get('brand'));
  const [activeOrigin, setActiveOrigin] = useState<string | null>(searchParams.get('origin'));
  const sponsoredOnly = searchParams.get('sponsored') === '1';
  const [sort, setSort] = useState('relevance');
  const [sortOpen, setSortOpen] = useState(false);
  const [sidebarQuery, setSidebarQuery] = useState('');

  useEffect(() => {
    setActiveCatId(searchParams.get('cat'));
    setActiveSubId(searchParams.get('sub'));
    setActiveProductTypeId(searchParams.get('type'));
    setActiveBrand(searchParams.get('brand'));
    setActiveOrigin(searchParams.get('origin'));
  }, [searchParams]);

  // Filters previously applied client-side (subcategoryId, brand) are now
  // pushed to the server so load-more pagination doesn't return partial
  // pages after client filtering. Sort stays client-side because the API
  // only supports 'name_asc'; broader sorting would need a server change.
  const {
    data: productsData,
    isLoading: prodLoading,
    error: prodError,
    refetch: refetchProducts,
    isFetching: prodFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteProducts({
    categoryId: activeCatId ?? undefined,
    subcategoryId: activeSubId ?? undefined,
    productTypeId: activeProductTypeId ?? undefined,
    origin: activeOrigin ?? undefined,
    brand: activeBrand ?? undefined,
    sponsored: sponsoredOnly ? '1' : undefined,
    limit: 24,
  });
  const allProducts: Product[] = useMemo(
    () => productsData?.pages.flatMap((p) => p.items) ?? [],
    [productsData],
  );
  // Nothing loaded AND the request failed: say that, not "No products".
  const productsFailed = !!prodError && allProducts.length === 0;
  const retryProducts = () => { void refetchProducts(); };
  // Authoritative filtered total from the API — reflects the current
  // category + subcategory + brand + origin + sponsored filters, and
  // counts every matching product not just what's loaded so far.
  const totalCount = productsData?.pages[0]?.total ?? 0;
  // Platform-wide total of ACTIVE products, derived by summing the static
  // per-category counts we already fetched in useCategories(). Used by the
  // sidebar's "All products" pill so that badge is independent of the
  // right-pane filter, of the load-more paging, and of anything else the
  // customer clicks. Backend `_count.products` is filtered to `is_active: true`.
  const platformTotal = useMemo(
    () => (categories ?? []).reduce((sum, c) => sum + (c._count?.products ?? 0), 0),
    [categories],
  );

  const { data: subcategoriesData } = useSubcategories(activeCatId ?? undefined);
  // Third-tier product types for the currently-active subcategory. Fires
  // only when a subcategory is picked (hook is enabled off !!subcategoryId).
  const { data: productTypesData } = useProductTypesForSubcategory(activeSubId ?? undefined);
  const productTypes = productTypesData ?? [];
  const isLoading = catLoading || prodLoading;
  const activeCategory = categories?.find((c) => c.id === activeCatId);
  const subcategories = subcategoriesData ?? [];
  const activeSub = subcategories.find((s) => s.id === activeSubId);

  const catName = (c: { name_en: string; name_es: string }) => (lang === 'en' ? c.name_en : c.name_es);

  // Server handles subcategoryId + brand filters. Sort stays client-side —
  // only the currently-loaded pages get sorted, so "price_asc" isn't a true
  // global sort until every page is loaded (acceptable for MVP).
  let products: Product[] = allProducts;
  if (sort === 'price_asc') products = [...products].sort((a, b) => (a.variants?.[0]?.price ?? 0) - (b.variants?.[0]?.price ?? 0));
  if (sort === 'price_desc') products = [...products].sort((a, b) => (b.variants?.[0]?.price ?? 0) - (a.variants?.[0]?.price ?? 0));
  if (sort === 'name_asc') products = [...products].sort((a, b) => catName(a).localeCompare(catName(b)));

  const selectCategory = (id: string | null) => {
    setActiveCatId(id);
    setActiveSubId(null);
    setActiveProductTypeId(null);
    const next = new URLSearchParams(searchParams);
    if (id) next.set('cat', id); else next.delete('cat');
    next.delete('sub');
    next.delete('type');
    setSearchParams(next, { replace: true });
  };

  const selectSubcategory = (id: string | null) => {
    setActiveSubId(id);
    // Cascading — always clear the product type when the parent changes.
    setActiveProductTypeId(null);
    const next = new URLSearchParams(searchParams);
    if (id) next.set('sub', id); else next.delete('sub');
    next.delete('type');
    setSearchParams(next, { replace: true });
  };

  const selectProductType = (id: string | null) => {
    setActiveProductTypeId(id);
    const next = new URLSearchParams(searchParams);
    if (id) next.set('type', id); else next.delete('type');
    setSearchParams(next, { replace: true });
  };

  const selectBrand = (name: string | null) => {
    setActiveBrand(name);
    const next = new URLSearchParams(searchParams);
    if (name) next.set('brand', name); else next.delete('brand');
    setSearchParams(next, { replace: true });
  };

  const selectOrigin = (key: string | null) => {
    setActiveOrigin(key);
    const next = new URLSearchParams(searchParams);
    if (key) next.set('origin', key); else next.delete('origin');
    setSearchParams(next, { replace: true });
  };

  const activeOriginCard = useMemo(
    () => originCards.find((c) => c.key.toLowerCase() === (activeOrigin ?? '').toLowerCase()),
    [originCards, activeOrigin],
  );
  const originLabel = activeOriginCard
    ? (lang === 'en' ? activeOriginCard.label_en : activeOriginCard.label_es)
    : activeOrigin;

  const sortOptions = [
    { key: 'relevance',  label: t('categories.sort.relevance') },
    { key: 'price_asc',  label: t('categories.sort.price_asc') },
    { key: 'price_desc', label: t('categories.sort.price_desc') },
    { key: 'name_asc',   label: t('categories.sort.name') },
  ];
  const activeSortLabel = sortOptions.find((s) => s.key === sort)?.label;

  const filteredCategories = useMemo(() => {
    const q = sidebarQuery.trim().toLowerCase();
    const list = categories ?? [];
    if (!q) return list;
    return list.filter((c) => catName(c).toLowerCase().includes(q));
  }, [categories, sidebarQuery, lang]);

  const headingName = activeSub
    ? catName(activeSub)
    : activeCategory
      ? catName(activeCategory)
      : activeBrand
        ? activeBrand
        : originLabel
          ? originLabel
          : t('categories.all');

  return (
    <div className="bg-surface-linen min-h-full">
      {/* ════════════════════════════════════════════════════════════════
          MOBILE (<lg): app-style rail + right pane. Full replacement of
          the desktop sidebar+grid, matching the RN Categories screen.
          ════════════════════════════════════════════════════════════════ */}
      <MobileCategoriesLayout
        categories={categories ?? []}
        isLoading={catLoading}
        activeCatId={activeCatId}
        onSelect={selectCategory}
        subcategories={subcategories}
        activeSubId={activeSubId}
        onSelectSub={selectSubcategory}
        productTypes={productTypes}
        activeProductTypeId={activeProductTypeId}
        onSelectProductType={selectProductType}
        activeBrand={activeBrand}
        activeOrigin={activeOrigin}
        activeOriginLabel={originLabel}
        onClearBrand={() => selectBrand(null)}
        onClearOrigin={() => selectOrigin(null)}
        topBrands={topBrands}
        onSelectBrand={selectBrand}
        originCards={originCards}
        onSelectOrigin={selectOrigin}
        products={products}
        productsLoading={prodLoading}
        productsFailed={productsFailed}
        onRetryProducts={retryProducts}
        retryingProducts={prodFetching}
        totalCount={totalCount}
        hasNextPage={!!hasNextPage}
        isFetchingNextPage={!!isFetchingNextPage}
        onFetchNextPage={() => fetchNextPage()}
      />

      <div className="hidden lg:flex">

        {/* ════════════════════════════════════════════
            SIDEBAR — flush left, connected to top navbar
            ════════════════════════════════════════════ */}
        <aside className="w-[260px] shrink-0 hidden lg:flex flex-col bg-card sticky top-[72px] self-start min-h-[calc(100vh-72px)] max-h-[calc(100vh-72px)] overflow-y-auto border-r border-border/60">

          {/* Section header */}
          <div className="px-4 pt-5 pb-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted mb-2">
              {lang === 'en' ? 'Browse' : 'Explorar'}
            </p>
            <h2 className="font-display text-[18px] text-ink leading-none tracking-tight" style={{ fontWeight: 700 }}>
              {lang === 'en' ? 'All categories' : 'Todas las categorías'}
            </h2>
          </div>

          <div className="h-px bg-border/60" />

          <div className="px-4 py-4">
            <div className="relative">
              <Search size={14} strokeWidth={2} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={sidebarQuery}
                onChange={(e) => setSidebarQuery(e.target.value)}
                placeholder={lang === 'en' ? 'Search categories' : 'Buscar categorías'}
                className="w-full h-10 pl-10 pr-3 rounded-full bg-surface-linen border border-transparent focus:bg-card focus:border-border text-[12.5px] font-ui text-ink placeholder:text-muted focus:outline-none transition-colors"
              />
            </div>
          </div>

          <div className="h-px bg-border/60" />

          <nav className="px-2 py-3 flex flex-col gap-0.5 flex-1">
            <SidebarRow
              active={!activeCatId}
              icon="🧺"
              name={t('categories.all')}
              count={platformTotal}
              onClick={() => selectCategory(null)}
            />
            {catLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 my-0.5 mx-1 !rounded-full" />
                ))
              : filteredCategories.map((cat) => {
                  const isActive = activeCatId === cat.id;
                  return (
                    <div key={cat.id}>
                      <SidebarRow
                        active={isActive}
                        icon={emojiForCategory(catName(cat))}
                        name={catName(cat)}
                        count={cat._count?.products ?? 0}
                        onClick={() => selectCategory(isActive ? null : cat.id)}
                      />
                      {isActive && subcategories.length > 0 && (
                        <div className="mt-1 mb-1 ml-6 pl-4 border-l border-border/70 flex flex-col gap-0.5">
                          <SubRow
                            active={!activeSubId}
                            name={lang === 'en' ? 'All in category' : 'Todo en categoría'}
                            onClick={() => selectSubcategory(null)}
                          />
                          {subcategories.map((sub) => {
                            const isSubActive = activeSubId === sub.id;
                            return (
                              <div key={sub.id}>
                                <SubRow
                                  active={isSubActive}
                                  name={catName(sub)}
                                  onClick={() => selectSubcategory(sub.id)}
                                />
                                {/* Third-tier product types — nested under
                                    the active subcategory. Same visual
                                    treatment as subcategories (indent +
                                    left border), one shade smaller. */}
                                {isSubActive && productTypes.length > 0 && (
                                  <div className="mt-0.5 mb-1 ml-4 pl-3 border-l border-border/60 flex flex-col gap-0">
                                    <button
                                      type="button"
                                      onClick={() => selectProductType(null)}
                                      className={`text-left text-[11px] font-ui leading-tight py-1 pl-2 pr-3 rounded-md transition-colors ${
                                        !activeProductTypeId
                                          ? 'text-brand-ink font-bold'
                                          : 'text-ink/55 hover:text-brand-ink font-medium'
                                      }`}
                                    >
                                      {lang === 'en' ? 'All types' : 'Todos los tipos'}
                                    </button>
                                    {productTypes.map((pt) => (
                                      <button
                                        key={pt.id}
                                        type="button"
                                        onClick={() => selectProductType(activeProductTypeId === pt.id ? null : pt.id)}
                                        className={`text-left text-[11px] font-ui leading-tight py-1 pl-2 pr-3 rounded-md transition-colors ${
                                          activeProductTypeId === pt.id
                                            ? 'text-brand-ink font-bold'
                                            : 'text-ink/55 hover:text-brand-ink font-medium'
                                        }`}
                                      >
                                        {catName(pt)}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
          </nav>

          <div className="h-px bg-border/60" />

          <div className="px-4 py-4">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-brand-ink mb-1.5 inline-flex items-center gap-1.5">
              <Sparkles size={11} strokeWidth={2.25} /> {lang === 'en' ? 'Tip' : 'Tip'}
            </p>
            <p className="text-[11.5px] text-ink/70 font-ui leading-relaxed">
              {/* Was: a €30 free-delivery threshold, "Madrid Centro", and a
                  same-day cutoff — none of which the code or the terms
                  support. Free delivery itself went on 2026-09-25. */}
              {lang === 'en' ? 'You pay when your order arrives.' : 'Pagas al recibir el pedido.'}
            </p>
          </div>
        </aside>

        {/* ════════════════════════════════════════════
            MAIN CONTENT — bounded by max-width
            ════════════════════════════════════════════ */}
        <div className="flex-1 min-w-0">
          <div className="max-w-[1240px] mx-auto px-4 lg:px-6 py-6 flex flex-col gap-5">

        {/* ── Breadcrumb ────────────────────────────── */}
        <nav className="flex items-center gap-1.5 text-[12px] font-ui tracking-tight text-muted">
          <button onClick={() => navigate('/')} className="hover:text-ink transition-colors">{t('common.home')}</button>
          <ChevronRight size={12} strokeWidth={2} className="text-border" />
          <button onClick={() => selectCategory(null)} className={`transition-colors ${!activeCategory ? 'text-ink font-semibold' : 'hover:text-ink'}`}>
            {t('common.categories')}
          </button>
          {activeCategory && (
            <>
              <ChevronRight size={12} strokeWidth={2} className="text-border" />
              <button onClick={() => setActiveSubId(null)} className={`transition-colors ${!activeSub ? 'text-ink font-semibold' : 'text-brand-ink hover:text-ink font-medium'}`}>
                {catName(activeCategory)}
              </button>
            </>
          )}
          {activeSub && (
            <>
              <ChevronRight size={12} strokeWidth={2} className="text-border" />
              <span className="text-brand-ink font-semibold">{catName(activeSub)}</span>
            </>
          )}
          {activeBrand && !activeCategory && (
            <>
              <ChevronRight size={12} strokeWidth={2} className="text-border" />
              <span className="text-brand-ink font-semibold">
                {lang === 'en' ? `Brand · ${activeBrand}` : `Marca · ${activeBrand}`}
              </span>
            </>
          )}
          {activeOrigin && !activeCategory && !activeBrand && (
            <>
              <ChevronRight size={12} strokeWidth={2} className="text-border" />
              <span className="text-brand-ink font-semibold">
                {lang === 'en' ? `Origin · ${originLabel}` : `Origen · ${originLabel}`}
              </span>
            </>
          )}
        </nav>

        {/* ── Brand filter row — only when arriving via a brand link ── */}
        {activeBrand && topBrands.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted font-ui shrink-0">
              {lang === 'en' ? 'Brand' : 'Marca'}
            </span>
            {topBrands.map((brand) => {
              const isActive = (activeBrand ?? '').toLowerCase() === brand.name.toLowerCase();
              return (
                <button
                  key={brand.name}
                  onClick={() => selectBrand(isActive ? null : brand.name)}
                  className={`h-8 inline-flex items-center gap-1.5 px-3 rounded-full text-[12px] font-bold font-ui transition-all ${
                    isActive
                      ? 'bg-brand text-white shadow-sm'
                      : 'bg-card border border-border text-ink hover:border-brand hover:text-brand'
                  }`}
                  aria-pressed={isActive}
                >
                  {brand.name}
                  {isActive && <X size={11} strokeWidth={2.5} />}
                </button>
              );
            })}
            {activeBrand && !topBrands.some((b) => b.name.toLowerCase() === activeBrand.toLowerCase()) && (
              <button
                onClick={() => selectBrand(null)}
                className="h-8 inline-flex items-center gap-1.5 px-3 rounded-full text-[12px] font-bold font-ui bg-ink text-card"
                aria-pressed
              >
                {activeBrand}
                <X size={11} strokeWidth={2.5} />
              </button>
            )}
            {activeBrand && (
              <button
                onClick={() => selectBrand(null)}
                className="text-[11px] font-semibold font-ui text-muted hover:text-ink ml-1"
              >
                {lang === 'en' ? 'Clear' : 'Quitar'}
              </button>
            )}
          </div>
        )}

        {/* ── Origin filter row — only when arriving via an origin link ── */}
        {activeOrigin && originCards.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted font-ui shrink-0">
              {lang === 'en' ? 'Origin' : 'Origen'}
            </span>
            {originCards.map((card) => {
              const isActive = (activeOrigin ?? '').toLowerCase() === card.key.toLowerCase();
              const label = lang === 'en' ? card.label_en : card.label_es;
              return (
                <button
                  key={card.key}
                  onClick={() => selectOrigin(isActive ? null : card.key)}
                  // Active state mirrors the brand pill (bg-brand text-white)
                  // — the per-origin bg_color/accent_color pastels read as
                  // "unselected" against the brand-blue selected brand pill
                  // one row above, so users couldn't tell an origin was
                  // active. Solid brand-blue keeps active-state consistent.
                  className={`h-8 inline-flex items-center gap-1.5 px-3 rounded-full text-[12px] font-bold font-ui transition-all ${
                    isActive
                      ? 'bg-brand text-white shadow-sm'
                      : 'bg-card border border-border text-ink hover:border-brand hover:text-brand'
                  }`}
                  aria-pressed={isActive}
                >
                  {label}
                  {isActive && <X size={11} strokeWidth={2.5} />}
                </button>
              );
            })}
            {activeOrigin && !originCards.some((c) => c.key.toLowerCase() === activeOrigin.toLowerCase()) && (
              <button
                onClick={() => selectOrigin(null)}
                className="h-8 inline-flex items-center gap-1.5 px-3 rounded-full text-[12px] font-bold font-ui bg-ink text-card"
                aria-pressed
              >
                {activeOrigin}
                <X size={11} strokeWidth={2.5} />
              </button>
            )}
            {activeOrigin && (
              <button
                onClick={() => selectOrigin(null)}
                className="text-[11px] font-semibold font-ui text-muted hover:text-ink ml-1"
              >
                {lang === 'en' ? 'Clear' : 'Quitar'}
              </button>
            )}
          </div>
        )}

        {/* ── Main content (sidebar moved to flush-left) ── */}
        <div className="flex flex-col gap-4">

            {/* Header — no card chrome, just line dividers */}
            <div className="flex flex-col">
              {/* Row 1 — title + sort */}
              <div className="flex items-end justify-between gap-4 flex-wrap pb-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    {activeCategory && (
                      <span className="text-[22px] leading-none">
                        {emojiForCategory(catName(activeCategory))}
                      </span>
                    )}
                    <h1 className="font-display text-[26px] md:text-[30px] text-ink leading-none tracking-tight" style={{ fontWeight: 600 }}>
                      {headingName}
                    </h1>
                    <span className="inline-flex items-center h-6 px-2.5 rounded-full bg-surface-linen text-[11px] font-mono font-bold text-ink/70 tabular-nums">
                      {totalCount}
                    </span>
                  </div>
                  <p className="text-[12.5px] text-gray font-ui">
                    {activeSub
                      ? (lang === 'en'
                          ? `Everything we have in ${catName(activeSub).toLowerCase()}.`
                          : `Todo lo que tenemos en ${catName(activeSub).toLowerCase()}.`)
                      : activeCategory
                        ? (lang === 'en'
                            ? `Everything we have in ${catName(activeCategory).toLowerCase()}.`
                            : `Todo lo que tenemos en ${catName(activeCategory).toLowerCase()}.`)
                        : activeBrand
                          ? (lang === 'en'
                              ? `Products from ${activeBrand} — switch brand using the chips above.`
                              : `Productos de ${activeBrand} — cambia de marca con los chips arriba.`)
                          : originLabel
                            ? (lang === 'en'
                                ? `Products from ${originLabel} — switch origin using the chips above.`
                                : `Productos de ${originLabel} — cambia de origen con los chips arriba.`)
                            : (lang === 'en'
                                ? 'The finest grocery staples — organised the way you actually cook.'
                                : 'Los mejores productos — organizados como realmente cocinas.')}
                  </p>
                </div>

                {/* Sort */}
                <div className="relative shrink-0">
                  <button
                    onClick={() => setSortOpen(!sortOpen)}
                    className="inline-flex items-center gap-2.5 h-10 pl-3.5 pr-3 rounded-full bg-card border border-border hover:border-brand/40 transition-all"
                  >
                    <SlidersHorizontal size={13} strokeWidth={1.75} className="text-charcoal" />
                    <span className="text-[12px] font-semibold font-ui text-muted">{t('categories.sort')}</span>
                    <span className="text-[12px] font-semibold font-ui text-ink">{activeSortLabel}</span>
                    <ChevronDown size={12} className={`text-muted transition-transform ${sortOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {sortOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                      <div className="absolute right-0 top-12 z-20 bg-card rounded-lg shadow-float border border-border py-2 min-w-[240px] overflow-hidden">
                        <div className="px-4 py-2 border-b border-border/60">
                          <p className="text-[10px] font-ui font-bold uppercase tracking-[0.15em] text-muted">
                            {lang === 'en' ? 'Sort by' : 'Ordenar por'}
                          </p>
                        </div>
                        {sortOptions.map((opt) => (
                          <button
                            key={opt.key}
                            onClick={() => { setSort(opt.key); setSortOpen(false); }}
                            className={`w-full text-left px-4 py-2.5 text-[12.5px] font-ui flex items-center justify-between tracking-tight transition-colors ${
                              sort === opt.key ? 'text-brand-ink font-semibold bg-brand-mist/50' : 'text-ink hover:bg-surface-linen'
                            }`}
                          >
                            {opt.label}
                            {sort === opt.key && <span className="w-1.5 h-1.5 rounded-full bg-brand-deepest" />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Divider before grid */}
              <div className="h-px bg-border/60 mt-4 mb-4" />
            </div>

            {/* Product grid */}
            {isLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-5 gap-3">
                {Array.from({ length: 10 }).map((_, i) => <ProductCardSkeleton key={i} />)}
              </div>
            ) : productsFailed ? (
              <ListLoadFailed lang={lang} onRetry={retryProducts} retrying={prodFetching} />
            ) : products.length === 0 ? (
              <div className="bg-card rounded-lg border border-border/60 flex flex-col items-center py-20 px-8">
                <div className="w-20 h-20 bg-surface-cream border border-border/60 rounded-full flex items-center justify-center mb-5">
                  <Search size={28} strokeWidth={1.75} className="text-muted" />
                </div>
                <h2 className="font-display text-[22px] text-ink text-center mb-2 tracking-tight" style={{ fontWeight: 600 }}>
                  {t('categories.no_products')}
                </h2>
                <p className="text-[13px] text-gray font-body text-center mb-6 max-w-sm">
                  {t('categories.no_products_desc')}
                </p>
                <button
                  onClick={() => { setActiveSubId(null); selectCategory(null); }}
                  className="inline-flex items-center gap-2 h-11 px-6 bg-brand text-white rounded-full font-bold font-ui text-[13px] hover:bg-brand-deepest transition-colors"
                >
                  {t('categories.view_all_products')}
                  <ArrowRight size={14} strokeWidth={2.5} />
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-5 gap-3">
                  {products.map((product) => <ProductCard key={product.id} product={product} />)}
                </div>
                <InfiniteScroll
                  hasMore={!!hasNextPage}
                  isLoading={isFetchingNextPage}
                  onLoadMore={() => fetchNextPage()}
                />
              </>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── */

function SidebarRow({
  active, icon, name, count, onClick,
}: {
  active: boolean; icon: string; name: string; count?: number; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group w-full flex items-center gap-3 h-11 pl-2.5 pr-3 rounded-full text-left transition-all ${
        active
          ? 'bg-brand text-white shadow-[0_6px_18px_-6px_rgba(5,78,232,0.55)]'
          : 'bg-transparent hover:bg-card text-ink'
      }`}
    >
      <span
        className={`w-8 h-8 rounded-full flex items-center justify-center text-[16px] leading-none shrink-0 transition-colors ${
          active ? 'bg-white/15' : 'bg-card border border-border/60 group-hover:border-brand/40'
        }`}
      >
        {icon}
      </span>
      <span
        className={`flex-1 text-[13px] font-ui tracking-tight truncate ${
          active ? 'text-white font-bold' : 'text-ink font-semibold'
        }`}
      >
        {name}
      </span>
      {typeof count === 'number' && count > 0 && (
        <span className={`text-[10.5px] font-mono tabular-nums ${active ? 'text-white/85 font-bold' : 'text-muted'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function SubRow({
  active, name, onClick,
}: {
  active: boolean; name: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left text-[12px] font-ui leading-tight py-1.5 pl-2 pr-3 rounded-md transition-colors ${
        active
          ? 'text-brand-ink font-bold'
          : 'text-ink/65 hover:text-brand-ink font-medium'
      }`}
    >
      {name}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MOBILE (<lg) — app-style rail + hero + subcategory sections.
   Mirrors apps/mobile/app/(tabs)/categories.tsx so the two clients
   feel like the same product on a small screen.
   ═══════════════════════════════════════════════════════════════════ */

const TILE_TONES = [
  '#E3ECFE', '#FDE7E1', '#E8F5EC', '#FBE9C0',
  '#F4D0DA', '#E0EFE3', '#EFEAE1', '#DCE6FD',
];

function MobileCategoriesLayout({
  categories, isLoading, activeCatId, onSelect,
  subcategories, activeSubId, onSelectSub,
  productTypes, activeProductTypeId, onSelectProductType,
  activeBrand, activeOrigin, activeOriginLabel,
  onClearBrand, onClearOrigin,
  topBrands, onSelectBrand,
  originCards, onSelectOrigin,
  products, productsLoading, productsFailed, onRetryProducts, retryingProducts, totalCount,
  hasNextPage, isFetchingNextPage, onFetchNextPage,
}: {
  categories: Category[];
  isLoading: boolean;
  activeCatId: string | null;
  onSelect: (id: string | null) => void;
  subcategories: SubCategory[];
  activeSubId: string | null;
  onSelectSub: (id: string | null) => void;
  productTypes: Array<{ id: string; name_es: string; name_en: string; sort_order: number }>;
  activeProductTypeId: string | null;
  onSelectProductType: (id: string | null) => void;
  activeBrand: string | null;
  activeOrigin: string | null;
  activeOriginLabel: string | null;
  onClearBrand: () => void;
  onClearOrigin: () => void;
  topBrands: TopBrand[];
  onSelectBrand: (name: string | null) => void;
  originCards: OriginCardType[];
  onSelectOrigin: (key: string | null) => void;
  products: Product[];
  productsLoading: boolean;
  productsFailed: boolean;
  onRetryProducts: () => void;
  retryingProducts: boolean;
  totalCount: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onFetchNextPage: () => void;
}) {
  const { lang } = useLanguageStore();
  // Default to first category once data arrives if URL didn't pick one —
  // but only on mobile. On desktop the sidebar exposes an "All categories"
  // row (activeCatId=null); auto-selecting here would fight that click and
  // silently revert the user back to the first category.
  // Skip when the URL is filtering by brand or origin — the user landed here
  // to see products for that filter across ALL categories, not the first
  // category's intersection with the filter (which is usually empty).
  // The ref ensures we auto-pick AT MOST ONCE per mount so that later
  // interactions ("All products" tap → clear cat, or clearing a brand
  // filter) don't re-trigger the auto-select and fight the user's intent.
  const autoPickedRef = useRef(false);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) return;
    if (autoPickedRef.current) return;
    // Wait for categories to load — otherwise we'd commit the ref with no
    // signal about what the user actually wanted.
    if (categories.length === 0) return;
    // A brand/origin filter came in via URL — the user's intent is clearly
    // "show me products for this filter", NOT "pick a category for me".
    // Commit the ref so a later clear (user taps × on the brand pill) doesn't
    // re-trigger the auto-select and silently drop them into the first
    // category. Same rationale as the plain-arrival auto-pick below: this
    // effect fires ONCE per mount, whatever branch it takes.
    if (activeBrand || activeOrigin) {
      autoPickedRef.current = true;
      return;
    }
    if (!activeCatId) {
      autoPickedRef.current = true;
      onSelect(categories[0].id);
    }
  }, [activeCatId, activeBrand, activeOrigin, categories, onSelect]);

  const selected = useMemo<Category | null>(
    () => categories.find((c) => c.id === activeCatId) ?? null,
    [categories, activeCatId],
  );
  const selectedIndex = selected
    ? Math.max(0, categories.findIndex((c) => c.id === selected.id))
    : 0;
  const selectedTone = TILE_TONES[selectedIndex % TILE_TONES.length];

  const orderedSubs = useMemo(
    () => [...subcategories].sort((a, b) => a.sort_order - b.sort_order),
    [subcategories],
  );

  return (
    <div className="lg:hidden bg-surface-linen">
      {/* Page title row */}
      <div className="px-4 pt-3 pb-2 flex items-baseline gap-2">
        <h1 className="font-display text-[22px] text-ink leading-none tracking-tight" style={{ fontWeight: 600 }}>
          {lang === 'es' ? 'Todas las categorías' : 'All Categories'}
        </h1>
        <span className="font-mono text-[11px] text-muted">
          {String(categories.length).padStart(2, '0')}
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 rounded-full border-2 border-brand/20 border-t-brand animate-spin" />
        </div>
      ) : categories.length === 0 ? (
        <div className="py-16 flex flex-col items-center px-8 text-center">
          <div className="w-16 h-16 rounded-full bg-surface-cream border border-border flex items-center justify-center mb-3">
            <Search size={22} strokeWidth={1.75} className="text-muted" />
          </div>
          <p className="font-display text-[17px] text-ink" style={{ fontWeight: 500 }}>
            {lang === 'es' ? 'Sin categorías' : 'No categories'}
          </p>
          <p className="text-[13px] text-gray font-body mt-1">
            {lang === 'es' ? 'Vuelve más tarde' : 'Check back later'}
          </p>
        </div>
      ) : (
        <div className="flex" style={{ minHeight: 'calc(100vh - 120px)' }}>
          {/* Left rail — "All" tile sits above every category so mobile has
              the same escape hatch desktop has via its sidebar "All products"
              row. Tapping it clears the active category (brand/origin filters
              stay — selectCategory only touches cat/sub/type). */}
          <div className="w-[92px] shrink-0 bg-surface-cream border-r border-border/60 overflow-y-auto hide-scrollbar max-h-[calc(100vh-120px)] sticky top-[60px] self-start">
            <MobileAllTile
              active={!activeCatId}
              onClick={() => onSelect(null)}
              lang={lang}
            />
            {categories.map((cat, i) => (
              <MobileRailTile
                key={cat.id}
                category={cat}
                active={activeCatId === cat.id}
                tone={TILE_TONES[i % TILE_TONES.length]}
                onClick={() => onSelect(cat.id)}
                lang={lang}
              />
            ))}
          </div>

          {/* Right pane */}
          <div className="flex-1 min-w-0 p-3.5 pb-10">
            {/* "All" tapped with no other filter active — show the full
                cross-category product grid. Reached when the user explicitly
                taps the "All" tile after having interacted (the useEffect's
                autoPickedRef gate prevents auto-select from re-firing). */}
            {!selected && !activeBrand && !activeOrigin && (
              <>
                <MobileAllProductsHero count={totalCount} lang={lang} />
                {productsLoading ? (
                  <div className="grid grid-cols-2 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <MobileProductSkeleton key={i} />
                    ))}
                  </div>
                ) : productsFailed ? (
                  <ListLoadFailed lang={lang} onRetry={onRetryProducts} retrying={retryingProducts} />
                ) : products.length === 0 ? (
                  <div className="rounded-2xl bg-card border border-border/60 p-8 flex flex-col items-center text-center">
                    <div className="w-14 h-14 rounded-full bg-surface-cream border border-border flex items-center justify-center mb-3">
                      <Search size={20} strokeWidth={1.75} className="text-muted" />
                    </div>
                    <p className="font-display text-[15px] text-ink mb-1" style={{ fontWeight: 600 }}>
                      {lang === 'en' ? 'No products yet' : 'Sin productos'}
                    </p>
                    <p className="text-[12px] text-gray font-body">
                      {lang === 'en' ? 'Check back later.' : 'Vuelve más tarde.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {products.map((p) => (
                        <MobileProductCard key={p.id} product={p} lang={lang} />
                      ))}
                    </div>
                    <InfiniteScroll
                      hasMore={hasNextPage}
                      isLoading={isFetchingNextPage}
                      onLoadMore={onFetchNextPage}
                    />
                  </>
                )}
              </>
            )}

            {/* Brand / origin filter arrived via URL with no category picked.
                Render a filter-hero + product grid so mobile visitors get the
                same "products matching this filter" experience desktop does.
                Category is intentionally NOT auto-selected in this branch
                (see the useEffect above). */}
            {!selected && (activeBrand || activeOrigin) && (
              <>
                <MobileFilterHero
                  label={activeBrand ?? activeOriginLabel ?? ''}
                  kind={activeBrand ? 'brand' : 'origin'}
                  count={totalCount}
                  lang={lang}
                  onClear={activeBrand ? onClearBrand : onClearOrigin}
                />
                {activeBrand && topBrands.length > 0 && (
                  <MobileBrandStrip
                    brands={topBrands}
                    activeBrand={activeBrand}
                    onSelectBrand={onSelectBrand}
                    lang={lang}
                  />
                )}
                {activeOrigin && originCards.length > 0 && (
                  <MobileOriginStrip
                    origins={originCards}
                    activeOrigin={activeOrigin}
                    activeOriginLabel={activeOriginLabel}
                    onSelectOrigin={onSelectOrigin}
                    lang={lang}
                  />
                )}
                {productsLoading ? (
                  <div className="grid grid-cols-2 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <MobileProductSkeleton key={i} />
                    ))}
                  </div>
                ) : productsFailed ? (
                  <ListLoadFailed lang={lang} onRetry={onRetryProducts} retrying={retryingProducts} />
                ) : products.length === 0 ? (
                  <div className="rounded-2xl bg-card border border-border/60 p-8 flex flex-col items-center text-center">
                    <div className="w-14 h-14 rounded-full bg-surface-cream border border-border flex items-center justify-center mb-3">
                      <Search size={20} strokeWidth={1.75} className="text-muted" />
                    </div>
                    <p className="font-display text-[15px] text-ink mb-1" style={{ fontWeight: 600 }}>
                      {lang === 'en' ? 'No products yet' : 'Sin productos'}
                    </p>
                    <p className="text-[12px] text-gray font-body">
                      {lang === 'en' ? 'Try clearing the filter.' : 'Prueba quitar el filtro.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {products.map((p) => (
                        <MobileProductCard key={p.id} product={p} lang={lang} />
                      ))}
                    </div>
                    <InfiniteScroll
                      hasMore={hasNextPage}
                      isLoading={isFetchingNextPage}
                      onLoadMore={onFetchNextPage}
                    />
                  </>
                )}
              </>
            )}

            {selected && (
              <>
                {/* Active brand / origin filter chips — shown ONLY when a
                    category is also picked, so the visitor can see the filter
                    is still narrowing this category's list and clear it if
                    they want. The brand-only view (no category) has the
                    filter baked into its hero, so no duplicate chip there. */}
                {/* Active brand + origin strips. Each is a full picker so
                    the user can switch or clear without leaving the page.
                    No separate "Filtered by" chips — the strips themselves
                    surface the active pill with an × affordance. */}
                {activeBrand && topBrands.length > 0 && (
                  <MobileBrandStrip
                    brands={topBrands}
                    activeBrand={activeBrand}
                    onSelectBrand={onSelectBrand}
                    lang={lang}
                  />
                )}
                {activeOrigin && originCards.length > 0 && (
                  <MobileOriginStrip
                    origins={originCards}
                    activeOrigin={activeOrigin}
                    activeOriginLabel={activeOriginLabel}
                    onSelectOrigin={onSelectOrigin}
                    lang={lang}
                  />
                )}
                <MobileCategoryHero
                  category={selected}
                  tone={selectedTone}
                  lang={lang}
                  count={totalCount}
                  onClick={() => onSelectSub(null)}
                />

                {/* Subcategory chip bar — horizontal scroll, sits directly under the hero. */}
                {orderedSubs.length > 0 && (
                  <div className="-mx-3.5 mb-2 overflow-x-auto hide-scrollbar">
                    <div className="flex items-center gap-2 px-3.5 pb-1">
                      <button
                        onClick={() => onSelectSub(null)}
                        aria-pressed={!activeSubId}
                        className={`h-8 shrink-0 inline-flex items-center px-3.5 rounded-full text-[11.5px] font-ui font-bold tracking-tight transition-colors ${
                          !activeSubId
                            ? 'bg-brand text-white'
                            : 'bg-card border border-border text-ink hover:border-brand/50'
                        }`}
                      >
                        {lang === 'en' ? 'All' : 'Todos'}
                      </button>
                      {orderedSubs.map((s) => {
                        const on = activeSubId === s.id;
                        const label = lang === 'en' ? s.name_en : s.name_es;
                        return (
                          <button
                            key={s.id}
                            onClick={() => onSelectSub(on ? null : s.id)}
                            aria-pressed={on}
                            className={`h-8 shrink-0 inline-flex items-center px-3.5 rounded-full text-[11.5px] font-ui font-semibold tracking-tight transition-colors ${
                              on
                                ? 'bg-brand text-white'
                                : 'bg-card border border-border text-ink hover:border-brand/50'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Product-type chip bar — third-tier drill-down. Only shown
                    when a subcategory is picked AND it has product types.
                    Smaller/subtler than the subcategory bar (7-height, tighter
                    padding, brand-deepest active pill) so the two tiers read
                    as parent → child. */}
                {activeSubId && productTypes.length > 0 && (
                  <div className="-mx-3.5 mb-3 overflow-x-auto hide-scrollbar">
                    <div className="flex items-center gap-1.5 px-3.5 pb-1">
                      <button
                        onClick={() => onSelectProductType(null)}
                        aria-pressed={!activeProductTypeId}
                        className={`h-7 shrink-0 inline-flex items-center px-3 rounded-full text-[11px] font-ui font-semibold tracking-tight transition-colors ${
                          !activeProductTypeId
                            ? 'bg-brand-deepest text-white'
                            : 'bg-transparent border border-border/60 text-ink/70 hover:border-brand/40 hover:text-brand-ink'
                        }`}
                      >
                        {lang === 'en' ? 'All types' : 'Todos los tipos'}
                      </button>
                      {productTypes.map((pt) => {
                        const on = activeProductTypeId === pt.id;
                        const label = lang === 'en' ? pt.name_en : pt.name_es;
                        return (
                          <button
                            key={pt.id}
                            onClick={() => onSelectProductType(on ? null : pt.id)}
                            aria-pressed={on}
                            className={`h-7 shrink-0 inline-flex items-center px-3 rounded-full text-[11px] font-ui font-medium tracking-tight transition-colors ${
                              on
                                ? 'bg-brand-deepest text-white font-semibold'
                                : 'bg-transparent border border-border/60 text-ink/70 hover:border-brand/40 hover:text-brand-ink'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Product grid + load more */}
                {productsLoading ? (
                  <div className="grid grid-cols-2 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <MobileProductSkeleton key={i} />
                    ))}
                  </div>
                ) : productsFailed ? (
                  <ListLoadFailed lang={lang} onRetry={onRetryProducts} retrying={retryingProducts} />
                ) : products.length === 0 ? (
                  <div className="rounded-2xl bg-card border border-border/60 p-8 flex flex-col items-center text-center">
                    <div className="w-14 h-14 rounded-full bg-surface-cream border border-border flex items-center justify-center mb-3">
                      <Search size={20} strokeWidth={1.75} className="text-muted" />
                    </div>
                    <p className="font-display text-[15px] text-ink mb-1" style={{ fontWeight: 600 }}>
                      {lang === 'en' ? 'No products yet' : 'Sin productos'}
                    </p>
                    <p className="text-[12px] text-gray font-body">
                      {lang === 'en'
                        ? 'Try a different subcategory.'
                        : 'Prueba otra subcategoría.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {products.map((p) => (
                        <MobileProductCard key={p.id} product={p} lang={lang} />
                      ))}
                    </div>
                    <InfiniteScroll
                      hasMore={hasNextPage}
                      isLoading={isFetchingNextPage}
                      onLoadMore={onFetchNextPage}
                    />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MobileRailTile({
  category, active, tone, onClick, lang,
}: {
  category: Category; active: boolean; tone: string;
  onClick: () => void; lang: 'en' | 'es';
}) {
  const name = lang === 'en' ? category.name_en : category.name_es;
  const iconUrl = category.icon_url ? resolveImageUrl(category.icon_url, 'tile') : null;
  return (
    <button
      onClick={onClick}
      className={`w-full relative py-2.5 pl-2 pr-1.5 text-center transition-colors ${
        active ? 'bg-brand-mist/60' : 'hover:bg-white/60'
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-brand" />
      )}
      <span
        className="photo-well mx-auto w-[60px] h-[60px] rounded-[14px] flex items-center justify-center overflow-hidden"
        style={{ background: tone }}
      >
        {iconUrl ? (
          <img src={iconUrl} alt="" className="w-full h-full object-cover" draggable={false} />
        ) : (
          <span className="text-[22px] leading-none">{emojiForCategory(name)}</span>
        )}
      </span>
      <p
        className={`mt-1.5 text-[10.5px] leading-tight tracking-tight line-clamp-2 font-ui ${
          active ? 'font-bold text-brand-ink' : 'font-medium text-gray'
        }`}
      >
        {name}
      </p>
    </button>
  );
}

/** "All" tile at the top of the mobile left rail. Same silhouette as
 *  MobileRailTile so the two read as one strip, but the icon is a generic
 *  grid glyph and it clears the active category on tap. */
function MobileAllTile({
  active, onClick, lang,
}: {
  active: boolean; onClick: () => void; lang: 'en' | 'es';
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full relative py-2.5 pl-2 pr-1.5 text-center transition-colors ${
        active ? 'bg-brand-mist/60' : 'hover:bg-white/60'
      }`}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-brand" />
      )}
      <span
        className="mx-auto w-[60px] h-[60px] rounded-[14px] flex items-center justify-center overflow-hidden bg-card border border-border/60"
      >
        <span className="text-[22px] leading-none">🛒</span>
      </span>
      <p
        className={`mt-1.5 text-[10.5px] leading-tight tracking-tight line-clamp-2 font-ui ${
          active ? 'font-bold text-brand-ink' : 'font-medium text-gray'
        }`}
      >
        {lang === 'en' ? 'All' : 'Todo'}
      </p>
    </button>
  );
}

function MobileCategoryHero({
  category, tone, lang, count, onClick,
}: {
  category: Category; tone: string; lang: 'en' | 'es'; count: number; onClick: () => void;
}) {
  const name = lang === 'en' ? category.name_en : category.name_es;
  const iconUrl = category.icon_url ? resolveImageUrl(category.icon_url, 'tile') : null;
  const bg = category.bg_color || tone;
  return (
    <button
      onClick={onClick}
      className="w-full rounded-[22px] p-4 flex items-center gap-3 overflow-hidden mb-4 text-left"
      style={{ background: bg }}
    >
      <div className="flex-1 min-w-0">
        <h2 className="font-display text-[19px] text-ink leading-tight tracking-tight line-clamp-2" style={{ fontWeight: 700 }}>
          {name}
        </h2>
        {count > 0 && (
          <p className="mt-1 text-[11.5px] text-ink/65 font-ui">
            {count}{' '}
            {lang === 'en'
              ? (count === 1 ? 'product found.' : 'products found.')
              : (count === 1 ? 'producto encontrado.' : 'productos encontrados.')}
          </p>
        )}
      </div>
      <div className="w-[92px] h-[76px] rounded-[16px] overflow-hidden flex items-center justify-center bg-white/40 shrink-0">
        {iconUrl ? (
          <img src={iconUrl} alt="" className="w-full h-full object-cover" draggable={false} />
        ) : (
          <span className="text-[46px] leading-none">{emojiForCategory(name)}</span>
        )}
      </div>
    </button>
  );
}

/** Horizontal-scrollable brand chip row for mobile — lets a visitor swap
 *  between brands without leaving the categories page. Active brand pill is
 *  brand-blue with an × affordance to clear; others are white with the
 *  brand's logo tile if one exists. Full-bleed edge-to-edge (mx-negative)
 *  so it fills the right pane width and scrolls naturally under the thumb.
 *  Rendered only when the caller has an active brand — keeps the mobile
 *  chrome light when nothing is filtered. */
function MobileBrandStrip({
  brands, activeBrand, onSelectBrand, lang,
}: {
  brands: TopBrand[];
  activeBrand: string;
  onSelectBrand: (name: string | null) => void;
  lang: 'en' | 'es';
}) {
  const activeLower = activeBrand.toLowerCase();
  const inList = brands.some((b) => b.name.toLowerCase() === activeLower);
  return (
    <div className="-mx-3.5 mb-3 overflow-x-auto hide-scrollbar">
      <div className="flex items-center gap-2 px-3.5 pb-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted font-ui shrink-0 self-center pr-0.5">
          {lang === 'en' ? 'Brand' : 'Marca'}
        </span>
        {brands.map((brand) => {
          const isActive = brand.name.toLowerCase() === activeLower;
          const logoUrl = brand.image_url ? resolveImageUrl(brand.image_url, 'logo') : null;
          return (
            <button
              key={brand.name}
              onClick={() => onSelectBrand(isActive ? null : brand.name)}
              aria-pressed={isActive}
              className={`h-9 shrink-0 inline-flex items-center gap-1.5 pl-1 pr-3 rounded-full text-[11.5px] font-ui font-bold tracking-tight transition-colors ${
                isActive
                  ? 'bg-brand text-white'
                  : 'bg-card border border-border text-ink hover:border-brand/50'
              }`}
            >
              <span
                className={`${logoPlate(brand.bg_color, isActive ? 'rgba(255,255,255,0.18)' : 'var(--color-surface-sand)').className} w-7 h-7 rounded-full flex items-center justify-center overflow-hidden shrink-0`}
                style={logoPlate(brand.bg_color, isActive ? 'rgba(255,255,255,0.18)' : 'var(--color-surface-sand)').style}
              >
                {logoUrl ? (
                  <img src={logoUrl} alt="" className="w-full h-full object-cover" draggable={false} />
                ) : (
                  <span className={`text-[10px] font-bold ${isActive ? 'text-white' : 'text-ink/60'}`}>
                    {brand.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </span>
              {brand.name}
              {isActive && <X size={11} strokeWidth={2.5} className="ml-0.5" />}
            </button>
          );
        })}
        {/* If the active brand isn't in the curated top-brands list, render
            it as a trailing pinned chip so the user can still see + clear it. */}
        {!inList && (
          <button
            onClick={() => onSelectBrand(null)}
            aria-pressed
            className="h-9 shrink-0 inline-flex items-center gap-1.5 px-3 rounded-full text-[11.5px] font-ui font-bold tracking-tight bg-ink text-card"
          >
            {activeBrand}
            <X size={11} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Horizontal-scrollable origin chip row for mobile — parallel to
 *  MobileBrandStrip. Rendered only when an origin filter is active so
 *  mobile chrome stays light when nothing is filtered. Falls back to the
 *  origin key/label letters when no image_url is set. */
function MobileOriginStrip({
  origins, activeOrigin, activeOriginLabel, onSelectOrigin, lang,
}: {
  origins: OriginCardType[];
  activeOrigin: string;
  activeOriginLabel: string | null;
  onSelectOrigin: (key: string | null) => void;
  lang: 'en' | 'es';
}) {
  const activeLower = activeOrigin.toLowerCase();
  const inList = origins.some((o) => o.key.toLowerCase() === activeLower);
  return (
    <div className="-mx-3.5 mb-3 overflow-x-auto hide-scrollbar">
      <div className="flex items-center gap-2 px-3.5 pb-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted font-ui shrink-0 self-center pr-0.5">
          {lang === 'en' ? 'Origin' : 'Origen'}
        </span>
        {origins.map((card) => {
          const isActive = card.key.toLowerCase() === activeLower;
          const label = lang === 'en' ? card.label_en : card.label_es;
          const imgUrl = card.image_url ? resolveImageUrl(card.image_url, 'tile') : null;
          return (
            <button
              key={card.key}
              onClick={() => onSelectOrigin(isActive ? null : card.key)}
              aria-pressed={isActive}
              className={`h-9 shrink-0 inline-flex items-center gap-1.5 pl-1 pr-3 rounded-full text-[11.5px] font-ui font-bold tracking-tight transition-colors ${
                isActive
                  ? 'bg-brand text-white'
                  : 'bg-card border border-border text-ink hover:border-brand/50'
              }`}
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center overflow-hidden shrink-0"
                style={{ background: isActive ? 'rgba(255,255,255,0.18)' : 'var(--color-surface-sand)' }}
              >
                {imgUrl ? (
                  <img src={imgUrl} alt="" className="w-full h-full object-cover" draggable={false} />
                ) : (
                  <span className={`text-[10px] font-bold ${isActive ? 'text-white' : 'text-ink/60'}`}>
                    {label.slice(0, 2).toUpperCase()}
                  </span>
                )}
              </span>
              {label}
              {isActive && <X size={11} strokeWidth={2.5} className="ml-0.5" />}
            </button>
          );
        })}
        {/* Active origin not in the curated list — trailing dark chip so the
            user can still see + clear it. */}
        {!inList && (
          <button
            onClick={() => onSelectOrigin(null)}
            aria-pressed
            className="h-9 shrink-0 inline-flex items-center gap-1.5 px-3 rounded-full text-[11.5px] font-ui font-bold tracking-tight bg-ink text-card"
          >
            {activeOriginLabel ?? activeOrigin}
            <X size={11} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Hero shown when the mobile "All" tile is active with no other filter.
 *  Simpler than the category/brand heroes — no icon, no CTA, just a title +
 *  total count so the "All products" state has a visual header matching the
 *  other two branches. */
function MobileAllProductsHero({
  count, lang,
}: {
  count: number; lang: 'en' | 'es';
}) {
  return (
    <div
      className="w-full rounded-[22px] p-4 flex items-center gap-3 overflow-hidden mb-4"
      style={{ background: 'var(--color-surface-dune)' }}
    >
      <div className="flex-1 min-w-0">
        <h2 className="font-display text-[19px] text-ink leading-tight tracking-tight" style={{ fontWeight: 700 }}>
          {lang === 'en' ? 'All products' : 'Todos los productos'}
        </h2>
        {count > 0 && (
          <p className="mt-1 text-[11.5px] text-ink/65 font-ui">
            {count}{' '}
            {lang === 'en'
              ? (count === 1 ? 'product across every category.' : 'products across every category.')
              : (count === 1 ? 'producto en todas las categorías.' : 'productos en todas las categorías.')}
          </p>
        )}
      </div>
      <div className="w-[64px] h-[64px] rounded-[16px] flex items-center justify-center bg-white/60 shrink-0">
        <span className="text-[32px] leading-none">🛒</span>
      </div>
    </div>
  );
}

/** Hero for the brand/origin-only mobile view. Same silhouette as
 *  MobileCategoryHero (rounded pill card, count line, action button) but the
 *  action clears the active filter instead of navigating deeper. */
function MobileFilterHero({
  label, kind, count, lang, onClear,
}: {
  label: string;
  kind: 'brand' | 'origin';
  count: number;
  lang: 'en' | 'es';
  onClear: () => void;
}) {
  const eyebrow = kind === 'brand'
    ? (lang === 'en' ? 'Brand' : 'Marca')
    : (lang === 'en' ? 'Origin' : 'Origen');
  return (
    <div
      className="w-full rounded-[22px] p-4 flex items-center gap-3 overflow-hidden mb-4"
      style={{ background: 'var(--color-brand-mist)' }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-ink/80 font-ui">
          {eyebrow}
        </p>
        <h2 className="font-display text-[19px] text-ink leading-tight tracking-tight line-clamp-2 mt-0.5" style={{ fontWeight: 700 }}>
          {label}
        </h2>
        {count > 0 && (
          <p className="mt-1 text-[11.5px] text-ink/65 font-ui">
            {count}{' '}
            {lang === 'en'
              ? (count === 1 ? 'product found.' : 'products found.')
              : (count === 1 ? 'producto encontrado.' : 'productos encontrados.')}
          </p>
        )}
        <button
          onClick={onClear}
          className="mt-3 inline-flex items-center gap-1.5 h-9 pl-3.5 pr-3.5 rounded-full bg-card border border-border text-ink text-[12px] font-ui font-bold hover:border-brand/40"
        >
          <X size={12} strokeWidth={2.5} />
          {lang === 'en' ? 'Clear filter' : 'Quitar filtro'}
        </button>
      </div>
    </div>
  );
}

function MobileProductCard({ product, lang }: { product: Product; lang: 'en' | 'es' }) {
  const navigate = useNavigate();
  const name = lang === 'en' ? product.name_en : product.name_es;
  const primary = product.images?.find((i) => i.is_primary) ?? product.images?.[0];
  const imageUrl = primary ? resolveImageUrl(primary.url, 'card') : null;
  const defaultVariant = product.variants?.find((v) => v.is_default) ?? product.variants?.[0];
  const price = defaultVariant?.price;
  const compareAt = defaultVariant?.compare_at_price;
  const hasDiscount = compareAt != null && price != null && compareAt > price;

  const quantity = useCartStore((s) => s.getQuantity(defaultVariant?.id ?? ''));
  const addItem = useCartStore((s) => s.addItem);
  const updateQty = useCartStore((s) => s.updateQuantity);
  const isPreview = usePreviewModeStore((s) => s.isPartnerPreview);
  const stock = defaultVariant?.stock_quantity ?? 0;
  const allOutOfStock = product.variants?.every((v) => v.stock_quantity === 0);
  const canAdd = !allOutOfStock && !isPreview && defaultVariant != null;

  const openProduct = () => navigate(`/products/${product.id}`);

  return (
    // A div, not a button: the add control is itself a button, and a button
    // inside a button is invalid markup — the browser drops one of them and
    // taps land on whichever survived.
    <div
      onClick={openProduct}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') openProduct(); }}
      className="text-left group flex flex-col bg-card rounded-2xl border border-border/60 overflow-hidden hover:border-border transition-colors cursor-pointer"
    >
      <div className="photo-well relative aspect-square bg-surface-cream flex items-center justify-center overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="w-full h-full object-cover group-active:scale-95 transition-transform"
            draggable={false}
          />
        ) : (
          <span className="text-[28px] leading-none">🛒</span>
        )}

        {allOutOfStock && <div className="absolute inset-0 bg-white/55 backdrop-blur-[1px] z-[5]" />}

        {/* Same floating add → stepper as the desktop card, one size up:
            36px rather than 32px, because this one is only ever hit with a
            thumb. Hidden in Partner Preview, where there is no real cart. */}
        {canAdd && (
          <div className="absolute bottom-1.5 right-1.5 z-10" onClick={(e) => e.stopPropagation()}>
            {quantity === 0 ? (
              <button
                onClick={() => addItem(product.id, defaultVariant!.id)}
                className="w-9 h-9 rounded-full bg-brand text-white flex items-center justify-center shadow-brand hover:bg-brand-mid active:scale-95 transition-all"
                aria-label={lang === 'en' ? 'Add to cart' : 'Añadir al carrito'}
              >
                <Plus size={18} strokeWidth={2.75} />
              </button>
            ) : (
              <div className="inline-flex items-center h-9 rounded-full bg-brand text-white shadow-brand overflow-hidden">
                <button
                  onClick={() => updateQty(defaultVariant!.id, quantity - 1)}
                  className="w-8 h-full flex items-center justify-center active:bg-brand-mid transition-colors"
                  aria-label={lang === 'en' ? 'Decrease quantity' : 'Reducir cantidad'}
                >
                  <Minus size={14} strokeWidth={2.75} />
                </button>
                <span className="px-0.5 text-[12.5px] font-bold font-ui tabular-nums min-w-[18px] text-center">
                  {quantity}
                </span>
                <button
                  onClick={() => quantity < stock && updateQty(defaultVariant!.id, quantity + 1)}
                  disabled={quantity >= stock}
                  className={`w-8 h-full flex items-center justify-center transition-colors ${quantity >= stock ? 'opacity-40 cursor-not-allowed' : 'active:bg-brand-mid'}`}
                  aria-label={lang === 'en' ? 'Increase quantity' : 'Aumentar cantidad'}
                >
                  <Plus size={14} strokeWidth={2.75} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="p-2.5 flex flex-col">
        {price != null && (
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <MobilePrice value={price} />
            {hasDiscount && (
              <span className="text-[11.5px] text-muted line-through font-ui">
                €{compareAt!.toFixed(2)}
              </span>
            )}
          </div>
        )}
        <p className="mt-1 text-[12.5px] font-semibold text-ink font-ui leading-snug line-clamp-2">
          {name}
        </p>
      </div>
    </div>
  );
}

// Matches the default ProductCard's <Price/> — same weight, sizes, and success-green.
function MobilePrice({ value }: { value: number }) {
  const [whole, cents] = value.toFixed(2).split('.');
  const tone = usePriceTone();
  return (
    <span className={`${tone} font-extrabold font-ui leading-none`}>
      <span className="text-[12px] align-top mr-0.5">€</span>
      <span className="text-[20px]">{whole}</span>
      <span className="text-[12px] align-top">.{cents}</span>
    </span>
  );
}

function MobileProductSkeleton() {
  return (
    <div className="rounded-2xl bg-card border border-border/60 overflow-hidden">
      <Skeleton className="aspect-square w-full !rounded-none" />
      <div className="p-2.5 flex flex-col gap-1.5">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3.5 w-1/2 mt-0.5" />
      </div>
    </div>
  );
}

