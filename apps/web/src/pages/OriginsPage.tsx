import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Globe2, Search, X, SearchX } from 'lucide-react';
import {
  useOriginsList, useOriginCounts, resolveImageUrl, OriginCardArt,
} from '@grocery-app/shared';
import type { OriginCard as OriginCardType } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { Skeleton } from '@/components/Skeleton';
import { useMemo, useRef, useEffect } from 'react';

type SortKey = 'featured' | 'name_asc' | 'count_desc';

/**
 * Accent- and case-insensitive comparison key, so "espana" finds "España".
 * Same reasoning as the brands page: Spanish labels carry diacritics that
 * shoppers rarely type.
 */
function foldText(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/**
 * Origin card — full-bleed art with the label set into a bottom scrim,
 * bento-packed so one card in every group of six runs twice the size of its
 * neighbours. With as few as four regions on the page, a uniform small grid
 * reads thin; a mix of one big showcase tile and smaller supporting ones
 * gives the page a focal point and makes the art itself worth looking at
 * instead of a caption's thumbnail.
 */
function OriginTile({
  card, count, lang, onClick, productsLabel, featured,
}: {
  card: OriginCardType;
  count: number;
  lang: 'en' | 'es';
  onClick: () => void;
  productsLabel: string;
  featured: boolean;
}) {
  const image = card.image_url ? resolveImageUrl(card.image_url, 'tile') : null;
  const label = lang === 'en' ? card.label_en : card.label_es;
  return (
    <button
      onClick={onClick}
      className={`group relative flex flex-col justify-end text-left w-full h-full rounded-2xl overflow-hidden transition-all duration-300 shadow-[0_1px_3px_rgba(15,23,42,0.08)] hover:shadow-[0_20px_44px_-14px_rgba(15,23,42,0.35)] hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
        featured ? 'col-span-2 row-span-2' : ''
      }`}
      style={{ background: card.bg_color }}
      aria-label={label}
    >
      {image ? (
        <img
          src={image}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
          draggable={false}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <OriginCardArt
          slug={card.key}
          bg={card.bg_color}
          accent={card.accent_color}
          className="absolute inset-0 w-full h-full transition-transform duration-500 group-hover:scale-[1.06]"
        />
      )}

      {/* Scrim: enough contrast for white text over any art, without going
          so dark it flattens the image underneath. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent" aria-hidden />

      {/* Origins carry a real accent_color, so unlike brands this needs no
          luminance fallback — the value is chosen to be seen. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100 motion-reduce:transition-none"
        style={{ background: card.accent_color }}
      />

      <div className={`relative text-white ${featured ? 'p-5 md:p-7' : 'p-3.5 md:p-4'}`}>
        <h3
          className={`font-display text-white tracking-tight leading-[1.05] ${
            featured ? 'text-[24px] md:text-[34px]' : 'text-[14.5px] md:text-[17px]'
          }`}
          style={{ fontWeight: 700, textShadow: '0 2px 16px rgba(0,0,0,0.45)' }}
        >
          {label}
        </h3>

        <div className={`flex items-center justify-between gap-2 ${featured ? 'mt-3' : 'mt-1.5'}`}>
          <span
            className={`font-ui tabular-nums text-white/85 truncate ${featured ? 'text-[13px]' : 'text-[10.5px]'}`}
          >
            {count > 0 ? `${count} ${productsLabel}` : '—'}
          </span>
          <span
            aria-hidden
            className={`shrink-0 inline-flex items-center justify-center rounded-full bg-white/20 backdrop-blur-sm text-white transition-colors duration-200 group-hover:bg-card group-hover:text-ink ${
              featured ? 'w-9 h-9' : 'w-6 h-6'
            }`}
          >
            <ArrowRight size={featured ? 16 : 11} strokeWidth={2.5} />
          </span>
        </div>
      </div>
    </button>
  );
}

function OriginTileSkeleton({ featured }: { featured: boolean }) {
  return (
    <Skeleton className={`rounded-2xl w-full h-full ${featured ? 'col-span-2 row-span-2' : ''}`} />
  );
}

export default function OriginsPage() {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const { data: originsData, isLoading: configLoading } = useOriginsList();
  const { data: countsData } = useOriginCounts();

  const counts = countsData ?? [];
  const countByOrigin = new Map<string, number>(
    counts.map((c) => [c.key.toLowerCase(), c.product_count]),
  );

  // Adapt the new Origin row shape to the existing OriginCardType so the
  // card component below stays untouched. Nulls in bg_color/accent_color
  // fall back to design-system defaults.
  const cards: OriginCardType[] = (originsData ?? []).map((o) => ({
    key: o.key.toLowerCase(),
    label_es: o.label_es,
    label_en: o.label_en,
    bg_color: o.bg_color ?? '#F5F0E8',
    accent_color: o.accent_color ?? '#7A7A7A',
    image_url: o.image_url,
    link: o.link ?? `/categories?origin=${o.key}`,
    is_active: true,
    display_order: o.sort_order,
  }));

  const totalProducts = cards.reduce(
    (sum, c) => sum + (countByOrigin.get(c.key) ?? 0),
    0,
  );

  const t = (en: string, es: string) => (lang === 'en' ? en : es);
  const productsLabel = t('products', 'productos');
  const countOf = (c: OriginCardType) => countByOrigin.get(c.key) ?? 0;

  // Filter state in the URL, so a filtered view survives a refresh and can be
  // shared. Same contract as the brands page.
  const [params, setParams] = useSearchParams();
  const q         = params.get('q') ?? '';
  const sort      = (params.get('sort') as SortKey) || 'featured';
  const hideEmpty = params.get('stocked') === '1';

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const clearAll = () => setParams(new URLSearchParams(), { replace: true });
  const isFiltered = !!q || hideEmpty || sort !== 'featured';

  const visible = useMemo(() => {
    const folded = foldText(q);
    let list = cards.filter((c) => {
      if (folded && !foldText(c.label_es).includes(folded) && !foldText(c.label_en).includes(folded)) return false;
      if (hideEmpty && countOf(c) === 0) return false;
      return true;
    });
    // 'featured' is the admin's curated sort_order, which is the order the API
    // returns, so it does nothing here.
    if (sort === 'name_asc') {
      list = [...list].sort((a, b) =>
        (lang === 'en' ? a.label_en : a.label_es).localeCompare(lang === 'en' ? b.label_en : b.label_es, 'es'));
    }
    if (sort === 'count_desc') list = [...list].sort((a, b) => countOf(b) - countOf(a));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originsData, countsData, q, sort, hideEmpty, lang]);

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: 'featured',   label: t('Featured',      'Destacados') },
    { value: 'name_asc',   label: 'A–Z' },
    { value: 'count_desc', label: t('Most products', 'Más productos') },
  ];

  const goToOrigin = (c: OriginCardType) =>
    navigate(c.link || `/categories?origin=${c.key}`);

  // "/" focuses search, ignored while already typing somewhere.
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

  // Bento: one card in six runs 2×2 to give the grid a focal point instead
  // of a wall of even tiles. auto-rows sets the small-tile height; a
  // featured tile spans two rows/cols of that same track, so the grid stays
  // one system rather than two card sizes fighting for their own math.
  const gridCls = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 auto-rows-[150px] sm:auto-rows-[175px] md:auto-rows-[190px] gap-3 md:gap-4';
  const isFeatured = (i: number) => i % 6 === 0;

  return (
    <div className="bg-surface-linen min-h-screen">
      <div className="max-w-[1500px] mx-auto px-4 lg:px-6 py-6 lg:py-10">

        {/* ── Breadcrumb ─────────────────────────────────────── */}
        <button
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-1.5 text-[13px] text-gray hover:text-ink font-ui mb-4 transition-colors"
        >
          <ArrowLeft size={14} strokeWidth={2} />
          {t('Back to home', 'Volver al inicio')}
        </button>

        {/* ── Hero ─────────────────────────────────────────────
            Same box as the brands banner: identical padding, blob, icon size
            and type scale. The old one was p-10 with a 44px title, an eyebrow
            chip and a two-line paragraph — nearly twice the height of its
            counterpart, which made the two pages feel unrelated. Globe stays
            in place of Sparkles; the geometry matches, the subject does not
            have to. */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-whisper via-card to-brand-mist/60 border border-border/60 px-6 md:px-8 py-5 md:py-6 mb-3 md:mb-4">
          <div
            className="absolute -right-16 -bottom-20 w-[220px] h-[220px] rounded-full bg-brand/[0.06] pointer-events-none"
            aria-hidden
          />
          <div
            className="absolute right-6 top-1/2 -translate-y-1/2 text-brand/25 pointer-events-none hidden md:block"
            aria-hidden
          >
            <Globe2 size={56} strokeWidth={1.25} />
          </div>

          <div className="relative max-w-xl pr-0 md:pr-24">
            <h1
              className="font-display text-[24px] md:text-[30px] text-ink tracking-tight leading-[1.15]"
              style={{ fontWeight: 700 }}
            >
              {t('Shop by origin', 'Compra por origen')}
            </h1>
            <p className="font-body text-[13px] md:text-[14px] text-gray mt-1.5 leading-snug">
              {t('Pick a region to see everything we stock from it.',
                 'Elige una región para ver todo lo que tenemos de ella.')}
            </p>
            {cards.length > 0 && (
              <div className="mt-3 inline-flex items-center gap-4 text-[12.5px] font-ui text-ink/70">
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-bold text-ink tabular-nums">{cards.length}</span>
                  {t('regions', 'regiones')}
                </span>
                {totalProducts > 0 && (
                  <>
                    <span className="w-px h-3 bg-border" aria-hidden />
                    <span className="inline-flex items-center gap-1.5">
                      <span className="font-bold text-ink tabular-nums">{totalProducts}</span>
                      {t('products in total', 'productos en total')}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ── Toolbar ─────────────────────────────────────────
            Only once the list is long enough to need narrowing. With four
            regions on screen a search field and a sort control are furniture
            that gets in the way of the thing being searched. */}
        {!configLoading && cards.length > 6 && (
          <section className="mb-5 md:mb-6 flex flex-col gap-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1 min-w-0">
                <Search size={16} strokeWidth={2} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
                <input
                  ref={searchRef}
                  type="search"
                  value={q}
                  onChange={(e) => setParam('q', e.target.value || null)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setParam('q', null); }}
                  placeholder={t('Search origins', 'Buscar orígenes')}
                  aria-label={t('Search origins', 'Buscar orígenes')}
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

              <div className="flex gap-3 shrink-0">
                <div className="flex items-center gap-0.5 p-[3px] rounded-xl bg-surface-sand shrink-0">
                  {sortOptions.map((o) => (
                    <button
                      key={o.value}
                      onClick={() => setParam('sort', o.value === 'featured' ? null : o.value)}
                      aria-pressed={sort === o.value}
                      className={`h-[38px] px-3.5 rounded-[9px] text-[12.5px] font-ui font-semibold whitespace-nowrap transition-colors ${
                        sort === o.value
                          ? 'bg-card text-ink shadow-[0_1px_2px_rgba(15,23,42,0.10)]'
                          : 'text-gray hover:text-ink'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setParam('stocked', hideEmpty ? null : '1')}
                  aria-pressed={hideEmpty}
                  className={`h-11 px-4 rounded-xl border text-[12.5px] font-ui font-semibold transition-colors whitespace-nowrap inline-flex items-center gap-2 ${
                    hideEmpty
                      ? 'border-amber-deep bg-amber-mist text-amber-deep'
                      : 'border-border bg-card text-gray hover:text-ink hover:border-ink/25'
                  }`}
                >
                  <span aria-hidden className={`w-2 h-2 rounded-full transition-colors ${hideEmpty ? 'bg-amber-deep' : 'bg-border'}`} />
                  {t('In stock only', 'Solo con stock')}
                </button>
              </div>
            </div>

            {isFiltered && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-[12.5px] font-ui text-gray" aria-live="polite">
                  <span className="font-bold text-ink tabular-nums">{visible.length}</span>
                  {' '}
                  {lang === 'en' ? `of ${cards.length} regions` : `de ${cards.length} regiones`}
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
        {configLoading ? (
          <div className={gridCls}>
            {Array.from({ length: 10 }).map((_, i) => <OriginTileSkeleton key={i} featured={isFeatured(i)} />)}
          </div>
        ) : cards.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-card p-10 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-brand-mist text-brand mb-4">
              <Globe2 size={26} strokeWidth={1.75} />
            </div>
            <h2 className="font-display text-[18px] text-ink tracking-tight" style={{ fontWeight: 700 }}>
              {t('No origins yet', 'Sin orígenes aún')}
            </h2>
            <p className="text-[13.5px] text-gray font-ui mt-1.5">
              {t('Origins will appear here once the catalogue is set up.',
                 'Los orígenes aparecerán aquí cuando se configure el catálogo.')}
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-card p-10 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-surface-sand text-gray mb-4">
              <SearchX size={26} strokeWidth={1.75} />
            </div>
            <h2 className="font-display text-[18px] text-ink tracking-tight" style={{ fontWeight: 700 }}>
              {t('No regions match', 'Ninguna región coincide')}
            </h2>
            <p className="text-[13.5px] text-gray font-ui mt-1.5 max-w-sm mx-auto">
              {q
                ? (lang === 'en'
                    ? `Nothing found for “${q}”. Try a shorter search, or clear the filters.`
                    : `No encontramos nada para «${q}». Prueba con menos letras o limpia los filtros.`)
                : t('Try clearing the filters.', 'Prueba a limpiar los filtros.')}
            </p>
            <button
              onClick={clearAll}
              className="mt-5 inline-flex items-center justify-center h-11 px-5 rounded-xl bg-brand hover:bg-brand-mid text-white text-[13px] font-ui font-bold transition-colors"
            >
              {t('Clear filters', 'Limpiar filtros')}
            </button>
          </div>
        ) : (
          <div className={gridCls}>
            {visible.map((card, i) => (
              <OriginTile
                key={card.key}
                card={card}
                count={countOf(card)}
                lang={lang}
                productsLabel={productsLabel}
                onClick={() => goToOrigin(card)}
                featured={isFeatured(i)}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
