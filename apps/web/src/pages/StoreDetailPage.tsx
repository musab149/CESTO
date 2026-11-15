import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Search, Star, Users, Package, Store as StoreIcon, CheckCircle2,
  Heart, Share2, Grid, List, ChevronRight, ChevronDown, Clock, X,
} from 'lucide-react';
import { deliveryLabel } from '@/components/StoreCard';
import {
  useStore, useInfiniteStoreProducts, useToggleFollowStore,
  useStoreSubcategories, useStoreProductTypes,
  resolveImageUrl,
  formatHoursStatus, WEEKDAY_KEYS, weekdayLabel, jsDayToWeekdayKey,
  type Product,
} from '@grocery-app/shared';
import ProductCard from '@/components/ProductCard';
import InfiniteScroll from '@/components/InfiniteScroll';
import LoadFailed, { ListLoadFailed } from '@/components/LoadFailed';
import { isNotFound } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/components/Toast';
import { bannerWash, logoPlate } from '@/lib/logoPlate';

/**
 * Every tab is a filter over this store's products. There used to be a
 * `rashan` tab listing the store's recurring packs; it went when rashan
 * became Home Grocery — an application to Cesto rather than a pack bought
 * from a shop — since every pack tile led to a builder that no longer exists.
 */
type Tab = 'all' | 'offers' | 'best-sellers' | 'new-arrivals' | 'featured';
type Sort = 'popular' | 'price_asc' | 'price_desc' | 'newest' | 'name_asc';
type View = 'grid' | 'list';

const VIEW_STORAGE_KEY = 'stores.viewAs';

/**
 * Six across at xl. The 280px sidebar this layout replaced was taking that
 * sixth column on every screen wide enough to have one.
 */
const PRODUCT_GRID =
  'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3';

function loadInitialView(): View {
  if (typeof window === 'undefined') return 'grid';
  return (window.localStorage.getItem(VIEW_STORAGE_KEY) as View) || 'grid';
}

/** 2300 → "2.3k", 12500 → "12.5k", 890 → "890". */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}

function ProductListItem({ product, lang }: { product: Product; lang: 'es' | 'en' }) {
  const navigate = useNavigate();
  const image = product.images?.find((i) => i.is_primary) ?? product.images?.[0];
  const variant = product.variants?.find((v) => v.is_default) ?? product.variants?.[0];
  return (
    <button
      type="button"
      onClick={() => navigate(`/products/${product.id}`)}
      className="w-full flex items-center gap-3 p-3 bg-surface-cream border border-border rounded-lg hover:border-brand/40 hover:shadow-card transition-all text-left"
    >
      <div className="photo-well w-20 h-20 rounded-lg bg-surface-linen border border-border overflow-hidden shrink-0 flex items-center justify-center">
        {image ? (
          <img src={resolveImageUrl(image.url, 'thumb')} alt="" className="w-full h-full object-cover" />
        ) : (
          <Package size={22} strokeWidth={1.5} className="text-muted" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-display font-semibold text-ink text-sm truncate">
          {lang === 'en' ? product.name_en : product.name_es}
        </div>
        {product.brand && <div className="text-xs font-body text-muted truncate">{product.brand}</div>}
      </div>
      {/* Price anchors the right edge rather than sitting under the name. At
          full width a left-stacked price left a long empty middle and nothing
          to scan down. */}
      <div className="shrink-0 text-right">
        {variant && (
          <div className="font-display font-bold text-ink tabular-nums">
            €{Number(variant.price).toFixed(2)}
          </div>
        )}
        {variant?.compare_at_price != null && (
          <div className="text-xs font-body text-muted line-through tabular-nums">
            €{Number(variant.compare_at_price).toFixed(2)}
          </div>
        )}
      </div>
      <ChevronRight size={18} strokeWidth={1.75} className="text-muted shrink-0" />
    </button>
  );
}

export default function StoreDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { lang } = useLanguageStore();
  const isAuthed = useAuthStore((s) => s.isAuthenticated);
  const navigate = useNavigate();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>('all');
  const [sort, setSort] = useState<Sort>('popular');
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [subcategoryId, setSubcategoryId] = useState<string | undefined>(undefined);
  const [productTypeId, setProductTypeId] = useState<string | undefined>(undefined);
  // Brand is orthogonal to the category drill-down — the server ANDs them, so
  // selecting a brand narrows within the current category and vice versa.
  // Neither reset touches the other; a brand clears only on an explicit toggle.
  const [brandId, setBrandId] = useState<string | undefined>(undefined);
  const [showAllBrands, setShowAllBrands] = useState(false);

  // Hours popover, anchored to the open/closed status in the store card.
  const [hoursOpen, setHoursOpen] = useState(false);
  const hoursRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hoursOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!hoursRef.current?.contains(e.target as Node)) setHoursOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHoursOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [hoursOpen]);
  const [q, setQ] = useState('');
  const [view, setView] = useState<View>(() => loadInitialView());

  useEffect(() => {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  }, [view]);

  // Category → subcategory drill-down helpers. selectCategory clears any
  // stale subcategory so a switch never carries over a subcategory from
  // the previous category (which would filter to zero rows).
  function selectCategory(id: string | undefined) {
    setCategoryId(id);
    setSubcategoryId(undefined);
    setProductTypeId(undefined);
  }
  function selectSubcategory(id: string | undefined) {
    setSubcategoryId(id);
    setProductTypeId(undefined);
  }
  function selectProductType(id: string | undefined) {
    setProductTypeId(id);
  }

  const { data: store, isLoading: loadingStore, error: storeError, refetch: refetchStore, isFetching: fetchingStore } = useStore(slug);
  // Fetch subcategories only when a category is active. Store-scoped — only the
  // subcategories this store actually has active products in, so a drill-down
  // pill never lands on an empty grid. (The global useSubcategories would list
  // every subcategory in the category across the whole catalogue.)
  const { data: subcategoriesData } = useStoreSubcategories(slug, categoryId);
  const subcategories = subcategoriesData ?? [];
  // Third tier. Store-scoped too; only fires once a subcategory is picked.
  const { data: productTypesData } = useStoreProductTypes(slug, subcategoryId);
  const productTypes = productTypesData ?? [];
  const {
    data: productsData,
    isLoading: loadingProducts,
    error: productsError,
    refetch: refetchProducts,
    isFetching: fetchingProducts,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteStoreProducts(slug, {
    tab,
    sort, categoryId, subcategoryId, productTypeId, brandId, q: q || undefined, limit: 24,
  });
  const toggleFollow = useToggleFollowStore();
  // Flatten every loaded page. `total` sits on the first page — every page's
  // `total` is the same (server returns the count of matching rows for the
  // filter, not the current page's size).
  const products      = useMemo(
    () => productsData?.pages.flatMap((pg) => pg.products) ?? [],
    [productsData],
  );
  const productsTotal = productsData?.pages[0]?.total ?? 0;

  const hoursStatus = useMemo(
    () => (store ? formatHoursStatus(store.shop_hours as never, lang) : ''),
    [store, lang],
  );

  async function handleFollowClick() {
    if (!store || !slug) return;
    if (!isAuthed) {
      toast.info(lang === 'en' ? 'Sign in to follow this store' : 'Inicia sesión para seguir esta tienda');
      navigate(`/login?redirect=/stores/${slug}`);
      return;
    }
    try {
      await toggleFollow.mutateAsync({ slug, follow: !store.is_followed });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleShare() {
    if (!store) return;
    const shareData = {
      title: store.name,
      text: lang === 'en'
        ? `Check out ${store.name} on Cesto`
        : `Descubre ${store.name} en Cesto`,
      url: window.location.href,
    };
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(lang === 'en' ? 'Link copied to clipboard' : 'Enlace copiado');
    } catch {
      toast.error(lang === 'en' ? 'Unable to share right now' : 'No se pudo compartir');
    }
  }

  if (loadingStore) {
    return (
      <div className="min-h-screen bg-surface-linen">
        <div className="max-w-[1400px] mx-auto px-3 sm:px-4 lg:px-6 py-8">
          <div className="h-48 sm:h-60 bg-surface-cream animate-pulse rounded-lg mb-6" />
          <div className="h-10 w-64 bg-surface-cream animate-pulse rounded mb-4" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-56 bg-surface-cream animate-pulse rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!store && !isNotFound(storeError)) {
    return (
      <LoadFailed
        lang={lang}
        title={lang === 'en' ? "We couldn't load this store" : 'No hemos podido cargar esta tienda'}
        onRetry={() => { void refetchStore(); void refetchProducts(); }}
        retrying={fetchingStore}
        secondary={
          <Link to="/stores" className="min-h-[52px] px-6 rounded-xl border-2 border-border bg-surface-white text-ink font-display font-semibold text-sm inline-flex items-center hover:border-brand transition-colors">
            {lang === 'en' ? 'Browse stores' : 'Ver tiendas'}
          </Link>
        }
      />
    );
  }

  if (!store) {
    return (
      <div className="min-h-screen bg-surface-linen flex flex-col items-center justify-center p-6 text-center">
        <StoreIcon size={40} strokeWidth={1.5} className="text-muted mb-3" />
        <h1 className="font-display font-bold text-ink mb-1">
          {lang === 'en' ? 'Store not found' : 'Tienda no encontrada'}
        </h1>
        <p className="text-sm font-body text-muted mb-4">
          {lang === 'en'
            ? "This store doesn't exist or is no longer available."
            : 'Esta tienda no existe o ya no está disponible.'}
        </p>
        <Link
          to="/stores"
          className="h-11 inline-flex items-center px-5 rounded-xl bg-brand text-white font-display font-semibold text-sm hover:bg-brand-dark"
        >
          {lang === 'en' ? 'Browse stores' : 'Ver tiendas'}
        </Link>
      </div>
    );
  }

  // Paused stores return a 200 with `is_paused: true` and only identity +
  // branding fields. Render a soft "temporarily unavailable" page instead
  // of the full storefront — no product grid, no follow button, no shop
  // hours. Draft / suspended / deleted stores never reach this branch
  // (they 404 from the API, handled by the block above).
  if ((store as { is_paused?: boolean }).is_paused) {
    return (
      <div className="min-h-screen bg-surface-linen">
        <div className="max-w-[720px] mx-auto px-6 py-16 text-center">
          <div className="w-20 h-20 rounded-2xl bg-card border border-border shadow-card mx-auto mb-6 overflow-hidden flex items-center justify-center">
            {store.logo_url
              ? <img src={store.logo_url} alt={store.name} className="w-full h-full object-cover" />
              : <StoreIcon size={36} strokeWidth={1.5} className="text-muted" />}
          </div>
          <h1 className="font-display font-bold text-2xl text-ink mb-2">
            {store.name}
          </h1>
          <div className="inline-flex items-center gap-2 h-7 px-3 rounded-full bg-warning-bg text-warning text-xs font-bold font-display uppercase tracking-wider mb-5">
            {lang === 'en' ? 'Temporarily unavailable' : 'Temporalmente no disponible'}
          </div>
          <p className="text-sm font-body text-muted max-w-md mx-auto mb-8 leading-relaxed">
            {lang === 'en'
              ? "This store has paused new orders for now. Please check back later — we'll notify you when it's open again."
              : 'Esta tienda ha pausado los pedidos por ahora. Vuelve más tarde — te avisaremos cuando esté abierta de nuevo.'}
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              to="/stores"
              className="h-11 inline-flex items-center px-5 rounded-xl bg-brand text-white font-display font-semibold text-sm hover:bg-brand-mid transition-colors"
            >
              {lang === 'en' ? 'Browse other stores' : 'Ver otras tiendas'}
            </Link>
            <Link
              to="/"
              className="h-11 inline-flex items-center px-5 rounded-xl bg-card border border-border text-ink font-display font-semibold text-sm hover:bg-surface-cream transition-colors"
            >
              {lang === 'en' ? 'Back to home' : 'Volver al inicio'}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const tagline = lang === 'en' ? store.tagline_en : store.tagline_es;
  const description = lang === 'en' ? store.description_en : store.description_es;

  // Sections rendered in more than one place, extracted so the markup is
  // written once. The categories UI is a single pill bar now, at every
  // width — the vertical sidebar list it replaced only existed on desktop.

  const categoriesPillsBlock = (
    <div className="space-y-2">
      <div className="-mx-3 sm:-mx-4 overflow-x-auto hide-scrollbar">
        <div className="flex items-center gap-2 px-3 sm:px-4 pb-1">
          <button
            type="button"
            onClick={() => selectCategory(undefined)}
            aria-pressed={categoryId === undefined}
            className={`h-8 shrink-0 inline-flex items-center gap-1.5 px-3.5 rounded-full text-[11.5px] font-ui font-bold tracking-tight transition-colors ${
              categoryId === undefined
                ? 'bg-brand text-white'
                : 'bg-card border border-border text-ink hover:border-brand/50'
            }`}
          >
            <span>{lang === 'en' ? 'All' : 'Todos'}</span>
            <span className="text-[10.5px] tabular-nums opacity-80">{store.products_count}</span>
          </button>
          {store.category_counts.map((c) => {
            const active = categoryId === c.category_id;
            return (
              <button
                key={c.category_id}
                type="button"
                onClick={() => selectCategory(active ? undefined : c.category_id)}
                aria-pressed={active}
                className={`h-8 shrink-0 inline-flex items-center gap-1.5 px-3.5 rounded-full text-[11.5px] font-ui font-semibold tracking-tight transition-colors ${
                  active
                    ? 'bg-brand text-white'
                    : 'bg-card border border-border text-ink hover:border-brand/50'
                }`}
              >
                <span className="truncate max-w-[10rem]">{lang === 'en' ? c.name_en : c.name_es}</span>
                <span className="text-[10.5px] tabular-nums opacity-80">{c.count}</span>
              </button>
            );
          })}
        </div>
      </div>
      {/* Subcategory pills. Same treatment as the category row above and as
          the products page — h-8, brand fill when active. They were h-7
          outline chips here, which read as a third tier and made the second
          tier look like a footnote. */}
      {categoryId && subcategories.length > 0 && (
        <div className="-mx-3 sm:-mx-4 overflow-x-auto hide-scrollbar">
          <div className="flex items-center gap-2 px-3 sm:px-4 pb-1">
            <button
              type="button"
              onClick={() => selectSubcategory(undefined)}
              aria-pressed={!subcategoryId}
              className={`h-8 shrink-0 inline-flex items-center px-3.5 rounded-full text-[11.5px] font-ui font-bold tracking-tight transition-colors ${
                !subcategoryId
                  ? 'bg-brand text-white'
                  : 'bg-card border border-border text-ink hover:border-brand/50'
              }`}
            >
              {lang === 'en' ? 'All' : 'Todos'}
            </button>
            {subcategories.map((sub) => {
              const active = subcategoryId === sub.id;
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => selectSubcategory(active ? undefined : sub.id)}
                  aria-pressed={active}
                  className={`h-8 shrink-0 inline-flex items-center px-3.5 rounded-full text-[11.5px] font-ui font-semibold tracking-tight transition-colors ${
                    active
                      ? 'bg-brand text-white'
                      : 'bg-card border border-border text-ink hover:border-brand/50'
                  }`}
                >
                  <span className="truncate max-w-[10rem]">{lang === 'en' ? sub.name_en : sub.name_es}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Product-type chips — third tier, only once a subcategory is picked.
          Deliberately smaller and outlined against the two pill rows above,
          so the three levels read as parent → child → grandchild rather than
          three equal filters. Matches the products page. */}
      {subcategoryId && productTypes.length > 0 && (
        <div className="-mx-3 sm:-mx-4 overflow-x-auto hide-scrollbar">
          <div className="flex items-center gap-1.5 px-3 sm:px-4 pb-1">
            <button
              type="button"
              onClick={() => selectProductType(undefined)}
              aria-pressed={!productTypeId}
              className={`h-7 shrink-0 inline-flex items-center px-3 rounded-full text-[11px] font-ui font-semibold tracking-tight transition-colors ${
                !productTypeId
                  ? 'bg-brand-deepest text-white'
                  : 'bg-transparent border border-border/60 text-ink/70 hover:border-brand/40 hover:text-brand-ink'
              }`}
            >
              {lang === 'en' ? 'All types' : 'Todos los tipos'}
            </button>
            {productTypes.map((pt) => {
              const active = productTypeId === pt.id;
              return (
                <button
                  key={pt.id}
                  type="button"
                  onClick={() => selectProductType(active ? undefined : pt.id)}
                  aria-pressed={active}
                  className={`h-7 shrink-0 inline-flex items-center px-3 rounded-full text-[11px] font-ui font-medium tracking-tight transition-colors ${
                    active
                      ? 'bg-brand-deepest text-white font-semibold'
                      : 'bg-transparent border border-border/60 text-ink/70 hover:border-brand/40 hover:text-brand-ink'
                  }`}
                >
                  <span className="truncate max-w-[10rem]">{lang === 'en' ? pt.name_en : pt.name_es}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  // Brands this store carries, derived server-side from its own active
  // products (store.brand_counts). Rendered as a "Shop by Brand" card — a grid
  // of logo tiles with product counts. Collapsed by default: 2 rows on a phone
  // (5 tiles + a "More Brands" tile), one row from sm up (9 tiles + a "More
  // Brands" tile). Tiles past the phone cap are CSS-hidden on mobile so the
  // count on each "More Brands" tile can differ per breakpoint without JS.
  // Selecting a tile filters the grid and composes with the category pills.
  const BRAND_MOBILE_CAP = 5;
  const BRAND_DESKTOP_CAP = 9;
  const brandCounts = store.brand_counts ?? [];
  const brandsExpandable = brandCounts.length > BRAND_MOBILE_CAP;
  const brandsCollapsed = !showAllBrands && brandsExpandable;
  const visibleBrands = brandsCollapsed
    ? brandCounts.slice(0, BRAND_DESKTOP_CAP)
    : brandCounts;
  const brandTileClass = (active: boolean, hiddenOnMobile: boolean) =>
    `${hiddenOnMobile ? 'hidden sm:flex' : 'flex'} flex-col items-center justify-center gap-2 px-2 py-3 rounded-xl border transition-colors ${
      active
        ? 'border-brand ring-1 ring-brand bg-brand/5'
        : 'border-border bg-card hover:border-brand/50'
    }`;

  const brandsBlock = brandCounts.length > 0 && (
    <section className="bg-surface-cream border border-border rounded-2xl shadow-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-display font-bold text-ink text-[16px] sm:text-[17px]">
          {lang === 'en' ? 'Shop by Brand' : 'Comprar por marca'}
        </h2>
        {brandsExpandable && (
          <button
            type="button"
            onClick={() => setShowAllBrands((v) => !v)}
            className="shrink-0 inline-flex items-center gap-1 text-brand text-[12.5px] sm:text-[13px] font-ui font-semibold hover:underline"
          >
            {showAllBrands
              ? lang === 'en' ? 'Show less' : 'Ver menos'
              : lang === 'en'
                ? `View all brands (${brandCounts.length})`
                : `Ver todas las marcas (${brandCounts.length})`}
            <ChevronDown
              size={14}
              strokeWidth={2.25}
              className={`transition-transform ${showAllBrands ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2.5">
        {visibleBrands.map((b, i) => {
          const active = brandId === b.brand_id;
          const logo = b.logo_url ? resolveImageUrl(b.logo_url, 'logo') : null;
          return (
            <button
              key={b.brand_id}
              type="button"
              onClick={() => setBrandId(active ? undefined : b.brand_id)}
              aria-pressed={active}
              aria-label={b.name}
              title={b.name}
              className={brandTileClass(active, brandsCollapsed && i >= BRAND_MOBILE_CAP)}
            >
              <span
                className={`${logoPlate(b.logo_bg, logo ? '#FFFFFF' : '#E2E8F0').className} h-10 w-full flex items-center justify-center overflow-hidden rounded`}
                style={logoPlate(b.logo_bg, logo ? '#FFFFFF' : '#E2E8F0').style}
              >
                {logo ? (
                  <img src={logo} alt={b.name} className="max-h-10 max-w-full object-contain" />
                ) : (
                  <span className="text-[13px] font-extrabold text-ink/50">
                    {b.name.trim().slice(0, 2).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="text-[11px] font-ui text-muted tabular-nums text-center leading-tight">
                {b.count} {lang === 'en' ? 'products' : 'productos'}
              </span>
            </button>
          );
        })}
        {/* Phone: "More Brands" from the 5-tile cap. Hidden from sm up. */}
        {brandsCollapsed && (
          <button
            type="button"
            onClick={() => setShowAllBrands(true)}
            className="flex sm:hidden flex-col items-center justify-center gap-1 px-2 py-3 rounded-xl border border-border bg-surface-linen hover:border-brand/50 transition-colors"
          >
            <span className="font-display font-bold text-ink text-[15px] tabular-nums">
              +{brandCounts.length - BRAND_MOBILE_CAP}
            </span>
            <span className="text-[11px] font-ui text-muted text-center leading-tight">
              {lang === 'en' ? 'More Brands' : 'Más marcas'}
            </span>
          </button>
        )}
        {/* sm and up: "More Brands" from the 9-tile cap, only when there's an overflow. */}
        {brandsCollapsed && brandCounts.length > BRAND_DESKTOP_CAP && (
          <button
            type="button"
            onClick={() => setShowAllBrands(true)}
            className="hidden sm:flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-xl border border-border bg-surface-linen hover:border-brand/50 transition-colors"
          >
            <span className="font-display font-bold text-ink text-[15px] tabular-nums">
              +{brandCounts.length - BRAND_DESKTOP_CAP}
            </span>
            <span className="text-[11px] font-ui text-muted text-center leading-tight">
              {lang === 'en' ? 'More Brands' : 'Más marcas'}
            </span>
          </button>
        )}
      </div>
    </section>
  );

  // Hours and contact used to be two cards at the foot of the page. Neither
  // is something anyone scrolls a storefront to find, and parking them in a
  // two-up grid under an infinite product list meant they were both too far
  // away and too loud when you got there.
  //
  // They now live where they are actually referenced: the open/closed state
  // is already in the store card, so it becomes the trigger for the week,
  // and contact becomes a row of links beside it.
  const todayKey = jsDayToWeekdayKey(new Date().getDay());
  const hoursMap = (store.shop_hours ?? null) as never as
    Record<string, { closed: boolean; open?: string; close?: string }> | null;

  return (
    <div className="min-h-screen bg-surface-linen">
      <div className="max-w-[1400px] mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6">
        {/* Breadcrumb */}
        <nav className="text-xs font-body text-muted mb-3 flex items-center gap-1.5">
          <Link to="/" className="hover:text-ink">
            {lang === 'en' ? 'Home' : 'Inicio'}
          </Link>
          <ChevronRight size={12} />
          <Link to="/stores" className="hover:text-ink">
            {lang === 'en' ? 'Stores' : 'Tiendas'}
          </Link>
          <ChevronRight size={12} />
          <span className="text-ink font-semibold truncate">{store.name}</span>
        </nav>

        {/* Single-column storefront. The old layout parked a 280px sidebar
            beside everything, which cost a column of product width at every
            breakpoint and split "browse by category" away from the products
            it filters. Store card, then pills, then products — in the order
            they get used. */}
        <div className="flex flex-col gap-4">

          {/* ── Store card ─────────────────────────────────────
              Full width, cover band on top, identity and stats in one row
              beneath it. Replaces the desktop logo card plus separate cover
              and the mobile StoreHeroCard with a single treatment. */}
          {/* No overflow-hidden on the card: it clipped the hours popover to
              the card's bottom edge. Only the cover band actually needs
              clipping, so the rounding moved onto it. */}
          <section className="bg-surface-cream border border-border rounded-2xl shadow-card">
            <div
              className="relative h-32 sm:h-44 lg:h-56 xl:h-64 rounded-t-2xl overflow-hidden"
              style={{
                background: store.cover_url
                  ? undefined
                  : bannerWash(store.logo_bg),
              }}
            >
              {store.cover_url ? (
                <img src={resolveImageUrl(store.cover_url, 'banner')} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
                  <span className="font-display font-black text-ink/[0.06] uppercase tracking-tight text-5xl sm:text-7xl lg:text-8xl truncate max-w-full px-6">
                    {store.name}
                  </span>
                </div>
              )}
              <div
                className={`absolute inset-0 ${
                  store.cover_url
                    ? 'bg-gradient-to-t from-black/45 via-black/10 to-transparent'
                    : 'bg-gradient-to-t from-ink/40 via-transparent to-transparent'
                }`}
              />
              <span className="absolute top-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 backdrop-blur px-2.5 py-1 text-xs font-display font-bold text-amber-deep shadow-sm">
                <Clock size={12} strokeWidth={2.25} />
                <span className="tabular-nums tracking-tight">{deliveryLabel(store.fast_delivery, lang)}</span>
              </span>
            </div>

            {/* relative + z-10: the cover band above is position:relative, and
                a positioned element paints over a static sibling regardless of
                DOM order. Without this the logo's overlap sits *behind* the
                cover instead of on top of it. */}
            <div className="relative z-10 px-4 sm:px-6 pt-3 sm:pt-4 pb-5">
              <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                {/* Logo overlaps the cover band — that overlap is what ties
                    the two halves of the card together instead of stacking
                    them as two unrelated strips. */}
                <div
                  className={`${logoPlate(store.logo_bg).className} w-20 h-20 sm:w-24 sm:h-24 rounded-2xl border-4 border-surface-cream overflow-hidden flex items-center justify-center shrink-0 -mt-10 sm:-mt-12 shadow-sm`}
                  style={logoPlate(store.logo_bg).style}
                >
                  {store.logo_url ? (
                    <img src={resolveImageUrl(store.logo_url, 'logo')} alt={store.name} className="w-full h-full object-contain p-1.5" />
                  ) : (
                    <StoreIcon size={34} strokeWidth={1.5} className="text-muted" />
                  )}
                </div>

                <div className="min-w-0 flex-1 lg:pb-1">
                  <h1 className="font-display font-bold text-ink text-[19px] sm:text-[22px] leading-tight flex items-center gap-1.5">
                    <span className="truncate">{store.name}</span>
                    {store.is_verified && <CheckCircle2 size={17} strokeWidth={2} className="text-brand shrink-0" />}
                  </h1>
                  {tagline && <p className="text-[12.5px] font-body text-muted mt-0.5">{tagline}</p>}
                  {description && (
                    <p className="text-[13px] font-body text-gray mt-1.5 line-clamp-2 max-w-3xl">{description}</p>
                  )}

                  {/* Stats read as a line rather than a boxed three-up grid —
                      at full width there is room for them to be a sentence. */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 text-[12.5px] font-ui">
                    <span className="inline-flex items-center gap-1.5 text-ink">
                      <Users size={13} strokeWidth={2} className="text-muted" />
                      <span className="font-bold tabular-nums">{formatCount(store.followers_count)}</span>
                      <span className="text-muted">{lang === 'en' ? 'followers' : 'seguidores'}</span>
                    </span>
                    <span className="hidden sm:block w-px h-3 bg-border" aria-hidden />
                    <span className="inline-flex items-center gap-1.5 text-ink">
                      <span className="font-bold tabular-nums">{formatCount(store.products_count)}</span>
                      <span className="text-muted">{lang === 'en' ? 'products' : 'productos'}</span>
                    </span>
                    <span className="hidden sm:block w-px h-3 bg-border" aria-hidden />
                    <span className="inline-flex items-center gap-1.5 text-ink">
                      <Star size={13} strokeWidth={2} className="text-warning fill-warning" />
                      <span className="font-bold tabular-nums">{store.rating != null ? store.rating.toFixed(1) : '—'}</span>
                      {store.rating_count > 0 && (
                        <span className="text-muted tabular-nums">({formatCount(store.rating_count)})</span>
                      )}
                    </span>
                    <span className="hidden sm:block w-px h-3 bg-border" aria-hidden />

                    {/* Status is the trigger for the week, because it is the
                        thing already asking the question. */}
                    <div className="relative" ref={hoursRef}>
                      <button
                        type="button"
                        onClick={() => setHoursOpen((v) => !v)}
                        aria-expanded={hoursOpen}
                        aria-haspopup="dialog"
                        className={`inline-flex items-center gap-1.5 font-semibold rounded-full -mx-1.5 px-1.5 py-0.5 transition-colors hover:bg-surface-sand ${
                          store.is_open_now ? 'text-amber-deep' : 'text-muted'
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`w-1.5 h-1.5 rounded-full ${store.is_open_now ? 'bg-amber-deep' : 'bg-muted'}`}
                        />
                        {hoursStatus}
                        <ChevronDown
                          size={12}
                          strokeWidth={2.5}
                          className={`transition-transform ${hoursOpen ? 'rotate-180' : ''}`}
                        />
                      </button>

                      {hoursOpen && (
                        <>
                          {/* Below sm the popover becomes a bottom sheet. A
                              300px panel anchored to a trigger that sits mid-row
                              in a wrapping stats line runs straight off a phone
                              screen — there is no left offset that is safe once
                              the row has wrapped. */}
                          <div
                            className="sm:hidden fixed inset-0 z-30 bg-veil/40"
                            onClick={() => setHoursOpen(false)}
                            aria-hidden
                          />
                        <div
                          role="dialog"
                          aria-label={lang === 'en' ? 'Opening hours' : 'Horario'}
                          className="fixed sm:absolute inset-x-3 bottom-3 sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 z-40 sm:w-[300px] rounded-xl border border-border bg-surface-cream shadow-float p-3"
                        >
                          {hoursMap ? (
                            <div className="grid grid-cols-7 gap-0.5">
                              {WEEKDAY_KEYS.map((k) => {
                                const day = hoursMap[k];
                                const shut = !day || day.closed;
                                const isToday = k === todayKey;
                                return (
                                  <div
                                    key={k}
                                    className={`rounded-lg px-0.5 py-1.5 text-center ${
                                      isToday ? 'bg-brand-whisper ring-1 ring-brand/30' : ''
                                    }`}
                                    title={`${weekdayLabel(k, lang)}: ${
                                      shut
                                        ? (lang === 'en' ? 'Closed' : 'Cerrado')
                                        : `${day!.open} – ${day!.close}`
                                    }`}
                                  >
                                    <div className={`text-[9.5px] font-ui font-bold uppercase tracking-wide ${isToday ? 'text-brand' : 'text-muted'}`}>
                                      {weekdayLabel(k, lang).slice(0, 2)}
                                    </div>
                                    {shut ? (
                                      <div className="mt-1 text-[10px] font-ui text-muted">—</div>
                                    ) : (
                                      <div className="mt-1 leading-tight tabular-nums">
                                        <div className="text-[9.5px] font-ui font-semibold text-ink">{day!.open}</div>
                                        <div className="text-[9.5px] font-ui text-muted">{day!.close}</div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs font-body text-muted py-1">
                              {lang === 'en' ? 'Hours not set' : 'Horario no disponible'}
                            </p>
                          )}
                        </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Store contact details are admin-only as of 2026-07-31 —
                      the phone / email / website row that sat here is gone,
                      and the API no longer serves those fields publicly. */}
                </div>

                {/* Full-width Follow on a phone, auto-width on desktop. A
                    120px button floating at the left edge under the store name
                    read as an afterthought on mobile. */}
                <div className="flex items-center gap-2 w-full lg:w-auto shrink-0 lg:pb-1">
                  <button
                    type="button"
                    onClick={handleFollowClick}
                    disabled={toggleFollow.isPending}
                    className={`h-11 px-5 flex-1 lg:flex-none rounded-xl font-display font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors ${
                      store.is_followed
                        ? 'bg-card border border-brand text-brand hover:bg-brand hover:text-white'
                        : 'bg-brand text-white hover:bg-brand-mid'
                    }`}
                  >
                    <Heart size={14} strokeWidth={2} className={store.is_followed ? 'fill-current' : ''} />
                    {store.is_followed
                      ? lang === 'en' ? 'Following' : 'Siguiendo'
                      : lang === 'en' ? 'Follow' : 'Seguir'}
                  </button>
                  <button
                    type="button"
                    onClick={handleShare}
                    aria-label={lang === 'en' ? 'Share store' : 'Compartir tienda'}
                    className="h-11 w-11 rounded-xl border border-border bg-card hover:bg-surface-linen text-ink inline-flex items-center justify-center transition-colors"
                  >
                    <Share2 size={15} strokeWidth={2} />
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* ── Category pills ─────────────────────────────── */}
          {categoriesPillsBlock}

          {/* ── Shop by Brand ─────────────────────────────── */}
          {brandsBlock}

          {/* ── Tabs + toolbar + products ──────────────────── */}
          <div className="min-w-0">
            {/* Toolbar, rebuilt on the brands-page pattern. The underline tabs
                and the loose row of h-10 controls beneath them read as two
                unrelated strips of furniture; both are pickers, so both are
                segmented controls sitting in one sand-filled well. */}
            {/* Column on a phone — tabs, then search, then sort + view — and a
                single wrapping row from sm. Left to wrap on its own the four
                controls landed in a ragged pile at 360px, with the sort select
                orphaned on its own line. */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2.5 mb-4">
              <div className="flex items-center gap-0.5 p-[3px] rounded-xl bg-surface-sand sm:shrink-0 overflow-x-auto hide-scrollbar max-w-full">
                {([
                  { key: 'all',           label_es: 'Todos',        label_en: 'All' },
                  { key: 'offers',        label_es: 'Ofertas',      label_en: 'Offers' },
                  { key: 'best-sellers',  label_es: 'Más vendidos', label_en: 'Best sellers' },
                  { key: 'new-arrivals',  label_es: 'Novedades',    label_en: 'New arrivals' },
                  { key: 'featured',      label_es: 'Destacados',   label_en: 'Featured' },
                ] as { key: Tab; label_es: string; label_en: string }[]).map((tk) => (
                  <button
                    key={tk.key}
                    type="button"
                    onClick={() => setTab(tk.key)}
                    aria-pressed={tab === tk.key}
                    className={`h-[38px] px-3.5 rounded-[9px] text-[12.5px] font-ui font-semibold whitespace-nowrap shrink-0 transition-colors ${
                      tab === tk.key
                        ? 'bg-card text-ink shadow-[0_1px_2px_rgba(15,23,42,0.10)]'
                        : 'text-gray hover:text-ink'
                    }`}
                  >
                    {lang === 'en' ? tk.label_en : tk.label_es}
                  </button>
                ))}
              </div>

              <div className="relative flex-1 min-w-0 sm:min-w-[200px]">
                <Search size={16} strokeWidth={2} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }}
                  placeholder={lang === 'en' ? 'Search this store' : 'Buscar en esta tienda'}
                  aria-label={lang === 'en' ? 'Search this store' : 'Buscar en esta tienda'}
                  className="w-full h-11 pl-10 pr-10 rounded-xl border border-border bg-card text-[13.5px] font-ui text-ink placeholder:text-muted focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-mist transition-colors"
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => setQ('')}
                    aria-label={lang === 'en' ? 'Clear search' : 'Borrar búsqueda'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-surface-sand transition-colors"
                  >
                    <X size={15} strokeWidth={2.25} />
                  </button>
                )}
              </div>

              {/* Sort and view share a line on a phone — neither is wide, and
                  a full-width select above a 40px pair of icons wastes a row. */}
              <div className="flex items-center gap-2.5 sm:contents">
              {/* Five options is too many to segment, so sort stays a select —
                  restyled to the same 44px rounded-xl box as the search. */}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                aria-label={lang === 'en' ? 'Sort products' : 'Ordenar productos'}
                className="h-11 px-3.5 flex-1 sm:flex-none min-w-0 rounded-xl border border-border bg-card text-[13px] font-ui font-medium text-ink focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-mist transition-colors cursor-pointer sm:shrink-0"
              >
                <option value="popular">{lang === 'en' ? 'Popular' : 'Popular'}</option>
                <option value="price_asc">{lang === 'en' ? 'Price: low to high' : 'Precio: menor a mayor'}</option>
                <option value="price_desc">{lang === 'en' ? 'Price: high to low' : 'Precio: mayor a menor'}</option>
                <option value="newest">{lang === 'en' ? 'Newest' : 'Más recientes'}</option>
                <option value="name_asc">{lang === 'en' ? 'Name A–Z' : 'Nombre A–Z'}</option>
              </select>

              <div className="flex items-center gap-0.5 p-[3px] rounded-xl bg-surface-sand shrink-0">
                <button
                  type="button"
                  onClick={() => setView('grid')}
                  aria-label={lang === 'en' ? 'Grid view' : 'Vista en cuadrícula'}
                  aria-pressed={view === 'grid'}
                  className={`h-[38px] w-[38px] rounded-[9px] inline-flex items-center justify-center transition-colors ${
                    view === 'grid' ? 'bg-card text-ink shadow-[0_1px_2px_rgba(15,23,42,0.10)]' : 'text-gray hover:text-ink'
                  }`}
                >
                  <Grid size={15} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => setView('list')}
                  aria-label={lang === 'en' ? 'List view' : 'Vista en lista'}
                  aria-pressed={view === 'list'}
                  className={`h-[38px] w-[38px] rounded-[9px] inline-flex items-center justify-center transition-colors ${
                    view === 'list' ? 'bg-card text-ink shadow-[0_1px_2px_rgba(15,23,42,0.10)]' : 'text-gray hover:text-ink'
                  }`}
                >
                  <List size={15} strokeWidth={2} />
                </button>
              </div>
              </div>
            </div>

            {/* Result line, as on brands. The page never said how much of the
                catalogue a filter was showing. */}
            {!loadingProducts && products.length > 0 && (
              <p className="text-[12.5px] font-ui text-gray mb-3" aria-live="polite">
                <span className="font-bold text-ink tabular-nums">{products.length}</span>
                {' '}
                {lang === 'en'
                  ? `of ${productsTotal} products`
                  : `de ${productsTotal} productos`}
              </p>
            )}

            {loadingProducts ? (
              <div className={view === 'grid' ? PRODUCT_GRID : 'space-y-2'}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className={view === 'grid' ? 'h-56 bg-surface-cream animate-pulse rounded-lg' : 'h-24 bg-surface-cream animate-pulse rounded-lg'} />
                ))}
              </div>
            ) : productsError && products.length === 0 ? (
              <ListLoadFailed lang={lang} onRetry={() => { void refetchProducts(); }} retrying={fetchingProducts} />
            ) : products.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Package size={32} strokeWidth={1.5} className="text-muted mb-2" />
                <div className="font-display font-semibold text-ink">
                  {lang === 'en' ? 'No products found' : 'No hay productos'}
                </div>
                <div className="text-sm font-body text-muted max-w-sm mt-1">
                  {tab !== 'all'
                    ? lang === 'en'
                      ? 'Try the "All products" tab or a different category.'
                      : 'Prueba con "Todos los productos" u otra categoría.'
                    : lang === 'en'
                      ? 'This store has no products in that filter.'
                      : 'Esta tienda no tiene productos con ese filtro.'}
                </div>
                {brandId && (
                  <button
                    type="button"
                    onClick={() => setBrandId(undefined)}
                    className="mt-3 h-9 px-4 rounded-full bg-card border border-border text-ink text-[12.5px] font-ui font-semibold hover:border-brand/50 transition-colors"
                  >
                    {lang === 'en' ? 'Clear brand filter' : 'Quitar filtro de marca'}
                  </button>
                )}
              </div>
            ) : view === 'grid' ? (
              <div className={PRODUCT_GRID}>
                {products.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            ) : (
              // Full width. The 3xl cap was there to stop list rows stretching
              // across a ~900px column beside the old sidebar; with the sidebar
              // gone it just left half the page empty.
              <div className="space-y-2">
                {products.map((p) => (
                  <ProductListItem key={p.id} product={p} lang={lang} />
                ))}
              </div>
            )}

            {products.length > 0 && (
              <InfiniteScroll
                className="mt-6"
                hasMore={!!hasNextPage}
                isLoading={isFetchingNextPage}
                onLoadMore={fetchNextPage}
                // Same grid as the rows above, so the incoming page appears
                // where it will land rather than shifting the layout.
                skeleton={
                  view === 'grid' ? (
                    <div className={`${PRODUCT_GRID} mt-3`}>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-56 bg-surface-cream animate-pulse rounded-lg" />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-2 mt-3">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-24 bg-surface-cream animate-pulse rounded-lg" />
                      ))}
                    </div>
                  )
                }
                endLabel={
                  lang === 'en'
                    ? `Showing all ${productsTotal} products`
                    : `Mostrando los ${productsTotal} productos`
                }
              />
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
