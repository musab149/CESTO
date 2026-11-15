import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Store as StoreIcon, Globe, Briefcase, Settings2,
  ArrowLeft,
} from 'lucide-react';
import { useStores, useStoresHero, defaultStoresHero, resolveImageUrl } from '@grocery-app/shared';
import type { Store } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import StoreCardRich from '@/components/StoreCardRich';
import { FilterChip, SearchField } from '@/components/form';
import { paintedTile } from '@/lib/logoPlate';

type StoreWithCount = Store & { _count?: { products: number } };

function StoreCardSkeleton() {
  return (
    <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
      {/* Cover placeholder — mirrors StoreHeroCard's cover exactly, h-28 below
          sm and the 8/3 ratio above it, or the grid reflows when data lands. */}
      <div className="h-28 sm:h-auto sm:aspect-[8/3] bg-surface-linen animate-pulse" />
      {/* Blue section — name + nested white card (info + 2 CTA buttons). */}
      <div className="bg-brand px-3 sm:px-4 pt-2.5 pb-3">
        <div className="h-5 w-2/3 bg-white/25 animate-pulse rounded mb-2.5" />
        <div className="bg-card rounded-xl px-2 py-1.5 space-y-1.5">
          <div className="h-9 bg-surface-linen animate-pulse rounded" />
          <div className="grid grid-cols-2 gap-1.5">
            <div className="h-9 bg-brand/60 animate-pulse rounded-lg" />
            <div className="h-9 bg-surface-linen animate-pulse rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K+`;
  }
  return `${n}`;
}

export default function StoresIndexPage() {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const { data: heroConfig } = useStoresHero();
  const hero = heroConfig ?? defaultStoresHero;
  // `banner`, not `hero`: this is painted edge to edge behind the page title,
  // and `hero` resolves to the 800 px variant — soft on any 2× display.
  const heroImage = hero.image_url ? resolveImageUrl(hero.image_url, 'banner') : null;
  const heroTextCls = hero.text_theme === 'light' ? 'text-white' : 'text-ink';
  const heroSubtitleCls = hero.text_theme === 'light' ? 'text-white/85' : 'text-gray';
  const heroStatsCls = hero.text_theme === 'light' ? 'text-white/85' : 'text-ink/70';
  const heroStatsNumCls = hero.text_theme === 'light' ? 'text-white' : 'text-ink';
  const heroStatsDividerCls = hero.text_theme === 'light' ? 'bg-white/25' : 'bg-border';
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'popular' | 'rating' | 'newest' | 'name'>('popular');
  const [origin, setOrigin] = useState<string>('');
  // "Business Type" and "Service Type" filters have no API params yet — apply
  // them client-side to the loaded page. TODO(api): promote to real query params.
  const [businessType, setBusinessType] = useState<'' | 'verified' | 'community'>('');
  const [serviceType, setServiceType] = useState<'' | 'fast'>('');

  const { data, isLoading } = useStores({
    q: q || undefined,
    sort,
    origin: origin || undefined,
    limit: 24,
  });

  const rawStores = (data?.items ?? []) as StoreWithCount[];
  const stores = useMemo(() => {
    let list = rawStores;
    if (businessType === 'verified') list = list.filter((s) => s.is_verified);
    if (businessType === 'community') list = list.filter((s) => !s.is_verified);
    if (serviceType === 'fast') list = list.filter((s) => s.fast_delivery);
    return list;
  }, [rawStores, businessType, serviceType]);

  // Sort is excluded: it always has a value, so counting it would leave the
  // result line permanently on.
  const isFiltered = !!q || !!origin || !!businessType || !!serviceType;

  const originOptions = useMemo(() => {
    const set = new Set<string>();
    rawStores.forEach((s) => s.origin && set.add(s.origin));
    return Array.from(set).sort();
  }, [rawStores]);

  const totalStores = data?.total ?? 0;
  const loadedProducts = rawStores.reduce(
    (sum, s) => sum + (s._count?.products ?? 0),
    0,
  );
  // If the loaded page doesn't cover every store, mark the count as
  // approximate rather than pretending it's the exact catalogue-wide total.
  const productsCountLabel = totalStores > rawStores.length
    ? `${formatCount(loadedProducts)}+`
    : formatCount(loadedProducts);

  const clearAllFilters = () => {
    setQ(''); setOrigin(''); setSort('popular');
    setBusinessType(''); setServiceType('');
  };

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
            Same layout as the BrandsPage hero, but every visual field
            (background, title, subtitle, cover image, text theme) is
            driven by the admin-editable stores-hero HomeSection. */}
        <section
          className={`relative overflow-hidden rounded-3xl border border-border/60 px-6 md:px-8 py-8 md:py-11 mb-3 md:mb-4 ${paintedTile(hero.text_theme, !!heroImage)}`}
          style={{ background: hero.background }}
        >
          {heroImage && (
            <img
              src={heroImage}
              alt=""
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
            />
          )}

          <div className="relative max-w-xl">
            <h1
              className={`font-display text-[24px] md:text-[30px] tracking-tight leading-[1.15] ${heroTextCls}`}
              style={{ fontWeight: 700 }}
            >
              {lang === 'en' ? hero.title_en : hero.title_es}
            </h1>
            <p className={`font-body text-[13px] md:text-[14px] mt-1.5 leading-snug ${heroSubtitleCls}`}>
              {lang === 'en' ? hero.subtitle_en : hero.subtitle_es}
            </p>
            {totalStores > 0 && (
              <div className={`mt-3 inline-flex items-center gap-4 text-[12.5px] font-ui ${heroStatsCls}`}>
                <span className="inline-flex items-center gap-1.5">
                  <span className={`font-bold tabular-nums ${heroStatsNumCls}`}>{formatCount(totalStores)}</span>
                  {lang === 'en'
                    ? (totalStores === 1 ? 'store' : 'stores')
                    : (totalStores === 1 ? 'tienda' : 'tiendas')}
                </span>
                {loadedProducts > 0 && (
                  <>
                    <span className={`w-px h-3 ${heroStatsDividerCls}`} aria-hidden />
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`font-bold tabular-nums ${heroStatsNumCls}`}>{productsCountLabel}</span>
                      {lang === 'en' ? 'products in total' : 'productos en total'}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ── Toolbar ───────────────────────────────────────────
            Same shape as the brands page: search, then a segmented sort,
            then the filters that stay chips because their options come from
            data. Search shed the full-width pill and the blue circular
            button on its right — that button had an empty onClick, because
            the input already searches as you type. */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 mb-3">
          <SearchField
            className="flex-1 min-w-0"
            value={q}
            onValueChange={setQ}
            placeholder={lang === 'en' ? 'Search stores' : 'Buscar tiendas'}
          />

          {/* Sort leaves the chip row: four fixed options belong in a
              segmented control, where all four are readable at once. */}
          <div className="flex items-center gap-0.5 p-[3px] rounded-xl bg-surface-sand shrink-0 overflow-x-auto hide-scrollbar max-w-full">
            {([
              { value: 'popular', label: lang === 'en' ? 'Popular'   : 'Popular' },
              { value: 'rating',  label: lang === 'en' ? 'Top rated' : 'Mejor valoradas' },
              { value: 'newest',  label: lang === 'en' ? 'Newest'    : 'Recientes' },
              { value: 'name',    label: 'A–Z' },
            ] as { value: typeof sort; label: string }[]).map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setSort(o.value)}
                aria-pressed={sort === o.value}
                className={`h-[38px] px-3.5 rounded-[9px] text-[12.5px] font-ui font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  sort === o.value
                    ? 'bg-card text-ink shadow-[0_1px_2px_rgba(15,23,42,0.10)]'
                    : 'text-gray hover:text-ink'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Filter chip row ────────────────────────────────────
            Origin · Business Type · Service Type. Scrolls on narrow
            viewports. */}
        <div className="flex items-center gap-2.5 overflow-x-auto hide-scrollbar -mx-3 sm:mx-0 px-3 sm:px-0 pb-1 mb-4">
          <FilterChip
            icon={Globe}
            label={lang === 'en' ? 'All Origin' : 'Origen'}
            value={origin}
            onChange={setOrigin}
            options={[
              { value: '', label: lang === 'en' ? 'All Origin' : 'Todos los orígenes' },
              ...originOptions.map((o) => ({ value: o, label: o })),
            ]}
          />
          <FilterChip
            icon={Briefcase}
            label={lang === 'en' ? 'Business Type' : 'Tipo de negocio'}
            value={businessType}
            onChange={(v) => setBusinessType(v as typeof businessType)}
            options={[
              { value: '',          label: lang === 'en' ? 'All types' : 'Todos los tipos' },
              { value: 'verified',  label: lang === 'en' ? 'Verified partners' : 'Socios verificados' },
              { value: 'community', label: lang === 'en' ? 'Community stores' : 'Tiendas comunitarias' },
            ]}
          />
          <FilterChip
            icon={Settings2}
            label={lang === 'en' ? 'Service Type' : 'Tipo de servicio'}
            value={serviceType}
            onChange={(v) => setServiceType(v as typeof serviceType)}
            options={[
              { value: '',    label: lang === 'en' ? 'Any service' : 'Cualquier servicio' },
              { value: 'fast', label: lang === 'en' ? 'Fast delivery' : 'Entrega rápida' },
            ]}
          />
        </div>

        {/* Result line, as on brands — the page never said how many of the
            stores a filter was showing. */}
        {!isLoading && isFiltered && (
          <div className="flex items-center justify-between gap-3 mb-4">
            <p className="text-[12.5px] font-ui text-gray" aria-live="polite">
              <span className="font-bold text-ink tabular-nums">{stores.length}</span>
              {' '}
              {lang === 'en' ? `of ${rawStores.length} stores` : `de ${rawStores.length} tiendas`}
            </p>
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-[12.5px] font-ui font-semibold text-brand hover:text-brand-ink transition-colors"
            >
              {lang === 'en' ? 'Clear filters' : 'Limpiar filtros'}
            </button>
          </div>
        )}

        {/* ── Grid ───────────────────────────────────────────── */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 md:gap-4">
            {Array.from({ length: 8 }).map((_, i) => <StoreCardSkeleton key={i} />)}
          </div>
        ) : stores.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-surface-cream border border-border flex items-center justify-center mb-4">
              <StoreIcon size={28} strokeWidth={1.5} className="text-muted" />
            </div>
            <h3 className="font-display font-bold text-ink mb-1">
              {lang === 'en' ? 'No stores match' : 'Sin resultados'}
            </h3>
            <p className="text-sm font-body text-muted max-w-sm mb-4">
              {lang === 'en'
                ? 'Try clearing filters or searching for a different name.'
                : 'Prueba a borrar los filtros o buscar otro nombre.'}
            </p>
            <button
              type="button"
              onClick={clearAllFilters}
              className="h-11 px-5 rounded-xl bg-brand hover:bg-brand-deepest text-white font-display font-semibold text-sm transition-colors"
            >
              {lang === 'en' ? 'Clear filters' : 'Borrar filtros'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 md:gap-4">
            {stores.map((s) => (
              <StoreCardRich key={s.id} store={s} lang={lang} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
