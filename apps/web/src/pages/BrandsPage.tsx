import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Sparkles, Tag, Search, X, SearchX, Clock } from 'lucide-react';
import {
  useBrandsList, useBrandCounts, resolveImageUrl,
} from '@grocery-app/shared';
import type { TopBrand } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { Skeleton } from '@/components/Skeleton';
import { useMemo, useEffect, useState, useRef, useCallback } from 'react';
import { logoPlate } from '@/lib/logoPlate';

type SortKey = 'featured' | 'name_asc' | 'name_desc' | 'count_desc';

/** Last-opened brands, newest first. Grocery shopping is repeat behaviour. */
const RECENT_KEY = 'cesto:recent-brands';
const RECENT_MAX = 8;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    // Private mode, quota, or a hand-edited value. A broken history is not
    // worth breaking the page over.
    return [];
  }
}

function pushRecent(name: string): string[] {
  const next = [name, ...readRecent().filter((n) => n !== name)].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

/**
 * Two-letter monogram for brands with no logo — reads far better at card size
 * than the full name shrunk to fit.
 */
function monogram(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

/**
 * The card's hover rule takes the brand's own colour, but logo_bg is usually a
 * pale wash chosen to sit behind a logo — painted as a 3px bar on white it
 * would be invisible. Anything above this luminance falls back to ink.
 */
function accentFor(bg: string | undefined): string {
  if (!bg || !/^#[0-9a-f]{6}$/i.test(bg)) return '#0F172A';
  const r = parseInt(bg.slice(1, 3), 16) / 255;
  const g = parseInt(bg.slice(3, 5), 16) / 255;
  const b = parseInt(bg.slice(5, 7), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.72 ? '#0F172A' : bg;
}

/**
 * Accent- and case-insensitive comparison key. Spanish brand and product
 * names carry diacritics that shoppers rarely type, so "espana" has to find
 * "España" or the search reads as broken.
 */
function foldText(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/** Bucket a brand under its initial. Anything not A–Z lands under '#'. */
function initialOf(name: string): string {
  const c = foldText(name).charAt(0).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
}

const ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];

function formatBrandCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K+`;
  }
  return `${n}+`;
}

/**
 * Monogram plate card. The previous version gave 60% of its area to a tinted
 * logo stage, which turned a grid of sixty brands into a patchwork and left
 * the name — the thing being scanned for — as the smallest element on it.
 *
 * Here the plate is a fixed 64px band, the name carries full weight, and the
 * brand's colour appears only as a rule that wipes in along the bottom on
 * hover. Colour on demand instead of colour everywhere.
 */
function BrandTile({
  brand, count, onClick, productsLabel,
}: { brand: TopBrand; count: number; onClick: () => void; productsLabel: string }) {
  const logo = brand.image_url ? resolveImageUrl(brand.image_url, 'logo') : null;
  const plate = logoPlate(brand.bg_color, '#F2F5F0');
  const accent = accentFor(brand.bg_color);

  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col gap-2 text-left p-2.5 rounded-xl border border-border/70 bg-card overflow-hidden transition-all duration-200 hover:border-ink/70 hover:shadow-[0_8px_24px_rgba(15,23,42,0.09)] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-mist"
      aria-label={brand.name}
    >
      {/* Plate fills the card edge to edge and scales with it, rather than
          being a fixed 64px band with the logo inset inside that. Ratio
          instead of a height so it keeps its proportion as the column count
          changes.
          object-cover, so the logo spans the full plate width: under contain
          a shorter plate scaled the logo down to fit the height, which took
          width away with it. The cost is that tall logos get trimmed top and
          bottom — the ratio is kept wide to keep that trim small. */}
      <div
        className={`${plate.className} aspect-[16/9] rounded-[10px] flex items-center justify-center overflow-hidden shrink-0`}
        style={plate.style}
      >
        {logo ? (
          <img
            src={logo}
            alt=""
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            draggable={false}
            // A full brand list is dozens of logos in a multi-column grid;
            // without this every one is fetched before the first paint.
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="font-display text-[20px] font-extrabold text-ink/35 tracking-tight">
            {monogram(brand.name)}
          </span>
        )}
      </div>

      <h3
        className="font-display text-[12.5px] text-ink leading-tight tracking-tight truncate"
        style={{ fontWeight: 700 }}
      >
        {brand.name}
      </h3>

      <div className="flex items-center justify-between gap-1.5">
        {/* Exact, not "48+". The count is known; rounding it up invented
            precision the data does not have. */}
        <span className="text-[10.5px] text-gray font-ui tabular-nums truncate">
          {count > 0 ? `${count} ${productsLabel}` : '—'}
        </span>
        <span
          aria-hidden
          className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-sand text-ink transition-colors duration-200 group-hover:bg-ink group-hover:text-card"
        >
          <ArrowRight size={10} strokeWidth={2.5} />
        </span>
      </div>

      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[3px] origin-left scale-x-0 transition-transform duration-250 group-hover:scale-x-100 motion-reduce:transition-none"
        style={{ background: accent }}
      />
    </button>
  );
}

function BrandTileSkeleton() {
  // Mirrors the card's own box so the grid does not reflow when data lands.
  return (
    <div className="rounded-xl border border-border/70 bg-card p-2.5 flex flex-col gap-2">
      <Skeleton className="aspect-[16/9] rounded-[10px]" />
      <Skeleton className="h-[12px] w-3/4 rounded" />
      <Skeleton className="h-[10px] w-1/2 rounded" />
    </div>
  );
}


export default function BrandsPage() {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const { data: brandsData, isLoading } = useBrandsList();
  const { data: countsData } = useBrandCounts();

  const counts = countsData ?? [];

  // Counts keyed case-insensitively so admin's display capitalisation doesn't
  // have to perfectly match Product.brand to surface a count.
  const countByBrand = new Map<string, number>(
    counts.map((c) => [c.name.toLowerCase(), c.product_count]),
  );

  // Adapt the new Brand row shape to the tile's TopBrand contract so we
  // don't have to touch the card component.
  const brands: TopBrand[] = (brandsData ?? []).map((b) => ({
    name: b.name,
    image_url: b.logo_url,
    bg_color: b.logo_bg ?? undefined,
    link: b.link ?? `/categories?brand=${encodeURIComponent(b.name)}`,
    is_active: true,
    display_order: b.sort_order,
  }));

  const totalProducts = brands.reduce(
    (sum, b) => sum + (countByBrand.get(b.name.toLowerCase()) ?? 0),
    0,
  );

  // Filter state lives in the URL, not component state, so a filtered view
  // survives a refresh, can be shared, and the back button steps through it.
  const [params, setParams] = useSearchParams();
  const q         = params.get('q') ?? '';
  const letter    = params.get('letter') ?? '';
  const sort      = (params.get('sort') as SortKey) || 'featured';
  const hideEmpty = params.get('stocked') === '1';

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const clearAll = () => setParams(new URLSearchParams(), { replace: true });
  const isFiltered = !!q || !!letter || hideEmpty || sort !== 'featured';

  const countOf = (b: TopBrand) => countByBrand.get(b.name.toLowerCase()) ?? 0;

  const visible = useMemo(() => {
    const folded = foldText(q);
    let list = brands.filter((b) => {
      if (folded && !foldText(b.name).includes(folded)) return false;
      if (letter && initialOf(b.name) !== letter) return false;
      if (hideEmpty && countOf(b) === 0) return false;
      return true;
    });

    // 'featured' keeps the admin's curated sort_order, which is the order the
    // API already returns — so it is the default and does nothing here.
    if (sort === 'name_asc')    list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'es'));
    if (sort === 'name_desc')   list = [...list].sort((a, b) => b.name.localeCompare(a.name, 'es'));
    if (sort === 'count_desc')  list = [...list].sort((a, b) => countOf(b) - countOf(a));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brands, q, letter, sort, hideEmpty, countsData]);

  const t = (en: string, es: string) => (lang === 'en' ? en : es);
  const productsLabel = t('products', 'productos');

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: 'featured',   label: t('Featured',      'Destacadas') },
    { value: 'name_asc',   label: 'A–Z' },
    { value: 'count_desc', label: t('Most products', 'Más productos') },
  ];

  // Grouping is tied to the A–Z sort: letter headings over a list ordered by
  // product count would be a lie about the order.
  const grouped = sort === 'name_asc';
  const groups = useMemo(() => {
    if (!grouped) return [];
    const map = new Map<string, TopBrand[]>();
    for (const b of visible) {
      const L = initialOf(b.name);
      (map.get(L) ?? map.set(L, []).get(L)!).push(b);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible, grouped]);

  const visibleInitials = useMemo(
    () => new Set(visible.map((b) => initialOf(b.name))),
    [visible],
  );

  // Spine click means "take me to S", so it switches into A–Z if needed and
  // then scrolls. One gesture, not a sort control plus a jump control.
  const scrollToLetter = (L: string) =>
    document.getElementById(`brand-group-${L}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // When the sort has to change first, the headings do not exist yet — not on
  // this tick and not reliably on the next frame either, since the sort lives
  // in the URL and comes back through a router update. Park the letter and
  // scroll once grouping is actually on.
  const pendingJump = useRef<string | null>(null);
  const jumpTo = (L: string) => {
    if (grouped) { scrollToLetter(L); return; }
    pendingJump.current = L;
    setParam('sort', 'name_asc');
  };
  useEffect(() => {
    if (!grouped || !pendingJump.current) return;
    const L = pendingJump.current;
    pendingJump.current = null;
    requestAnimationFrame(() => scrollToLetter(L));
  }, [grouped]);

  // Recently viewed, newest first. Seeded once on mount and updated in place
  // so the rail reorders as you open brands without a reload.
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => { setRecent(readRecent()); }, []);

  // Recording the visit still happens on the way out, so the rail below keeps
  // working now that opening a brand navigates instead of opening a drawer.
  const openBrand = useCallback((b: TopBrand) => {
    setRecent(pushRecent(b.name));
    navigate(b.link || `/categories?brand=${encodeURIComponent(b.name)}`);
  }, [navigate]);

  const recentBrands = recent
    .map((n) => brands.find((b) => b.name === n))
    .filter((b): b is TopBrand => !!b);

  // "/" focuses search, the way every catalogue-heavy site behaves. Ignored
  // while the user is already typing somewhere.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        || (el instanceof HTMLElement && el.isContentEditable);
      if (typing) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const gridCls = 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2.5 md:gap-3';

  return (
    <div className="bg-surface-linen min-h-screen">
      <div className="max-w-[1500px] mx-auto px-4 lg:px-6 py-6 lg:py-10">

        {/* ── Breadcrumb ─────────────────────────────────────── */}
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-1.5 text-[13px] text-gray hover:text-ink font-ui mb-4 transition-colors"
        >
          <ArrowLeft size={14} strokeWidth={2} />
          {lang === 'en' ? 'Back to home' : 'Volver al inicio'}
        </button>

        {/* ── Hero ───────────────────────────────────────────────
            Same gradient panel as the origins hero, just shorter. Content
            stacks naturally on the left; the decorative blob + sparkles
            live entirely in the right gutter so they never collide with
            the title, copy or stats. */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-whisper via-card to-brand-mist/60 border border-border/60 px-6 md:px-8 py-5 md:py-6 mb-3 md:mb-4">
          {/* Decorative wash — anchored entirely off-canvas in the right
              gutter so content always reads cleanly. */}
          <div
            className="absolute -right-16 -bottom-20 w-[220px] h-[220px] rounded-full bg-brand/[0.06] pointer-events-none"
            aria-hidden
          />
          <div
            className="absolute right-6 top-1/2 -translate-y-1/2 text-brand/25 pointer-events-none hidden md:block"
            aria-hidden
          >
            <Sparkles size={56} strokeWidth={1.25} />
          </div>

          <div className="relative max-w-xl pr-0 md:pr-24">
            <h1
              className="font-display text-[24px] md:text-[30px] text-ink tracking-tight leading-[1.15]"
              style={{ fontWeight: 700 }}
            >
              {lang === 'en' ? 'All brands' : 'Todas las marcas'}
            </h1>
            <p className="font-body text-[13px] md:text-[14px] text-gray mt-1.5 leading-snug">
              {lang === 'en'
                ? 'Tap a brand to see every product we stock from them.'
                : 'Toca una marca para ver todos sus productos.'}
            </p>
            {brands.length > 0 && (
              <div className="mt-3 inline-flex items-center gap-4 text-[12.5px] font-ui text-ink/70">
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-bold text-ink tabular-nums">{brands.length}</span>
                  {lang === 'en' ? 'brands' : 'marcas'}
                </span>
                {totalProducts > 0 && (
                  <>
                    <span className="w-px h-3 bg-border" aria-hidden />
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-bold text-ink tabular-nums">{formatBrandCount(totalProducts)}</span>
                      {lang === 'en' ? 'products in total' : 'productos en total'}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ── Toolbar ─────────────────────────────────────────
            Search, sort and a stocked-only toggle on one row; the A–Z rail
            below it. Not sticky: the header already pins three tiers and a
            fourth sticky band would leave very little catalogue on screen. */}
        {!isLoading && brands.length > 0 && (
          <section className="mb-5 md:mb-6 flex flex-col gap-3">
            {/* On a phone: search with the switch beside it, and the sort across
                the whole row below. From sm, all three share one row as before.
                The sort and the switch used to share a row at every width,
                which is wider than a phone: the switch ran off the edge and the
                page scrolled sideways. */}
            <div className="flex flex-wrap sm:flex-nowrap gap-3">
              <div className="relative flex-1 min-w-0 order-1">
                <Search
                  size={16}
                  strokeWidth={2}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                  aria-hidden
                />
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setParam('q', e.target.value || null)}
                  // Escape clears rather than only blurring, which is what the
                  // native search input does on some browsers and not others.
                  onKeyDown={(e) => { if (e.key === 'Escape') setParam('q', null); }}
                  placeholder={t('Search brands', 'Buscar marcas')}
                  aria-label={t('Search brands', 'Buscar marcas')}
                  className="w-full h-11 pl-10 pr-10 rounded-xl border border-border bg-card text-[13.5px] font-ui text-ink placeholder:text-muted focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-mist transition-colors"
                />
                {q && (
                  <button
                    onClick={() => setParam('q', null)}
                    aria-label={t('Clear search', 'Borrar búsqueda')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-surface-sand transition-colors"
                  >
                    <X size={15} strokeWidth={2.25} />
                  </button>
                )}
              </div>

              {/* Segmented, not a dropdown: three options do not deserve a
                  menu that hides two of them. */}
              <div className="order-3 sm:order-2 basis-full sm:basis-auto sm:shrink-0 flex items-center gap-0.5 p-[3px] rounded-xl bg-surface-sand">
                {sortOptions.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => setParam('sort', o.value === 'featured' ? null : o.value)}
                    aria-pressed={sort === o.value}
                    className={`flex-1 sm:flex-none h-[38px] px-2 sm:px-3.5 rounded-[9px] text-[12.5px] font-ui font-semibold whitespace-nowrap transition-colors ${
                      sort === o.value
                        ? 'bg-card text-ink shadow-[0_1px_2px_rgba(15,23,42,0.10)]'
                        : 'text-gray hover:text-ink'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>

              {/* Reads as a switch — the state dot says on/off, where a
                  plain button only looked pressed. */}
              <button
                onClick={() => setParam('stocked', hideEmpty ? null : '1')}
                aria-pressed={hideEmpty}
                className={`order-2 sm:order-3 shrink-0 h-11 px-4 rounded-xl border text-[12.5px] font-ui font-semibold transition-colors whitespace-nowrap inline-flex items-center gap-2 ${
                  hideEmpty
                    ? 'border-amber-deep bg-amber-mist text-amber-deep'
                    : 'border-border bg-card text-gray hover:text-ink hover:border-ink/25'
                }`}
              >
                <span
                  aria-hidden
                  className={`w-2 h-2 rounded-full transition-colors ${hideEmpty ? 'bg-amber-deep' : 'bg-border'}`}
                />
                {t('In stock only', 'Solo con stock')}
              </button>
            </div>

            {/* Recently viewed. Grocery shopping is repeat behaviour — the
                brand wanted today is usually one opened last week. Only
                rendered once there is history, so it never sits empty. */}
            {recentBrands.length > 0 && (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border bg-card">
                <span className="shrink-0 inline-flex items-center gap-1.5 text-[10px] font-ui font-bold uppercase tracking-[0.14em] text-muted">
                  <Clock size={12} strokeWidth={2.25} />
                  {t('Recent', 'Vistas')}
                </span>
                <div className="flex gap-1.5 overflow-x-auto hide-scrollbar">
                  {recentBrands.map((b) => (
                    <button
                      key={b.name}
                      onClick={() => openBrand(b)}
                      className="shrink-0 inline-flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-surface-sand hover:bg-brand-mist text-[12px] font-ui font-semibold text-charcoal hover:text-brand-ink transition-colors"
                    >
                      <span
                        aria-hidden
                        className={`${logoPlate(b.bg_color, '#E2E8F0').className} w-[22px] h-[22px] rounded-full flex items-center justify-center text-[9px] font-extrabold text-ink/50 shrink-0`}
                        style={logoPlate(b.bg_color, '#E2E8F0').style}
                      >
                        {monogram(b.name)}
                      </span>
                      {b.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Result line. aria-live so a screen reader hears the count
                change as the query narrows, rather than silence. */}
            {isFiltered && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12.5px] font-ui text-gray" aria-live="polite">
                  <span className="font-bold text-ink tabular-nums">{visible.length}</span>
                  {' '}
                  {lang === 'en'
                    ? `of ${brands.length} brands`
                    : `de ${brands.length} marcas`}
                </p>
                <button
                  onClick={clearAll}
                  className="text-[12.5px] font-ui font-semibold text-brand hover:text-brand-ink transition-colors"
                >
                  {t('Clear filters', 'Limpiar filtros')}
                </button>
              </div>
            )}
          </section>
        )}

        {/* ── Grid ───────────────────────────────────────────── */}
        {isLoading ? (
          <div className={gridCls}>
            {Array.from({ length: 15 }).map((_, i) => <BrandTileSkeleton key={i} />)}
          </div>
        ) : brands.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-card p-10 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-brand-mist text-brand mb-4">
              <Tag size={26} strokeWidth={1.75} />
            </div>
            <h2 className="font-display text-[18px] text-ink tracking-tight" style={{ fontWeight: 700 }}>
              {lang === 'en' ? 'No brands yet' : 'Sin marcas aún'}
            </h2>
            <p className="text-[13.5px] text-gray font-ui mt-1.5">
              {lang === 'en'
                ? 'Brands will appear here once the catalogue is set up.'
                : 'Las marcas aparecerán aquí cuando se configure el catálogo.'}
            </p>
          </div>
        ) : visible.length === 0 ? (
          // Distinct from "no brands yet" above: the catalogue has brands,
          // this particular query does not match any. Per design rule 10 it
          // gets an illustration, an explanation naming the query, and a way
          // out rather than a bare "no results".
          <div className="rounded-3xl border border-dashed border-border bg-card p-10 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-surface-sand text-gray mb-4">
              <SearchX size={26} strokeWidth={1.75} />
            </div>
            <h2 className="font-display text-[18px] text-ink tracking-tight" style={{ fontWeight: 700 }}>
              {t('No brands match', 'Ninguna marca coincide')}
            </h2>
            <p className="text-[13.5px] text-gray font-ui mt-1.5 max-w-sm mx-auto">
              {q
                ? (lang === 'en'
                    ? `Nothing found for “${q}”. Try a shorter search, or clear the filters.`
                    : `No encontramos nada para «${q}». Prueba con menos letras o limpia los filtros.`)
                : t('Try another letter or clear the filters.',
                    'Prueba con otra letra o limpia los filtros.')}
            </p>
            <button
              onClick={clearAll}
              className="mt-5 inline-flex items-center justify-center h-11 px-5 rounded-xl bg-brand hover:bg-brand-mid text-white text-[13px] font-ui font-bold transition-colors"
            >
              {t('Clear filters', 'Limpiar filtros')}
            </button>
          </div>
        ) : (
          // Grid plus the alphabet spine. The spine is a sticky column rather
          // than a row of buttons above the grid, so jumping and scrolling are
          // the same gesture and it never scrolls out of reach. Hidden below
          // md, where a 27-target column would be unusable with a thumb — the
          // search field covers that case.
          <div className="flex gap-4">
            <div className="flex-1 min-w-0">
              {grouped ? (
                groups.map(([L, items]) => (
                  <section
                    key={L}
                    id={`brand-group-${L}`}
                    // Clears the pinned header (Tier 0+1+2 = 156px on lg) so a
                    // jump does not park the heading underneath the navbar.
                    className="mb-7 scroll-mt-[120px] lg:scroll-mt-[170px]"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <span className="w-[26px] h-[26px] rounded-[7px] bg-ink text-card flex items-center justify-center font-display text-[14px] font-extrabold">
                        {L}
                      </span>
                      <span className="flex-1 h-px bg-border" aria-hidden />
                      <span className="text-[11px] font-ui font-bold text-muted tabular-nums">{items.length}</span>
                    </div>
                    <div className={gridCls}>
                      {items.map((brand) => (
                        <BrandTile
                          key={brand.name}
                          brand={brand}
                          count={countOf(brand)}
                          productsLabel={productsLabel}
                          onClick={() => openBrand(brand)}
                        />
                      ))}
                    </div>
                  </section>
                ))
              ) : (
                <div className={gridCls}>
                  {visible.map((brand) => (
                    <BrandTile
                      key={brand.name}
                      brand={brand}
                      count={countOf(brand)}
                      productsLabel={productsLabel}
                      onClick={() => openBrand(brand)}
                    />
                  ))}
                </div>
              )}
            </div>

            <nav
              aria-label={t('Jump to letter', 'Ir a la letra')}
              className="hidden md:flex flex-col gap-px sticky top-[170px] self-start shrink-0 w-[26px]"
            >
              {ALPHABET.map((L) => {
                const has = visibleInitials.has(L);
                return (
                  <button
                    key={L}
                    disabled={!has}
                    onClick={() => jumpTo(L)}
                    className={`h-[19px] rounded-[5px] text-[10.5px] font-ui font-bold transition-colors ${
                      has
                        ? 'text-gray hover:bg-brand-mist hover:text-brand-ink'
                        : 'text-muted/35 cursor-default'
                    }`}
                  >
                    {L}
                  </button>
                );
              })}
            </nav>
          </div>
        )}
      </div>

    </div>
  );
}
