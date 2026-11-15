import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';
import { LayoutGrid, MapPin, Package, Store, Tag, WifiOff } from 'lucide-react';
import { resolveImageUrl } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { Card, PageHeader, SearchInput } from '@/sales/components/ui';
import EmptyState from '@/sales/components/EmptyState';
import {
  BrandTile, BrowseTabs, CategoryTile, ORIGIN_GRID, OriginCard, OriginSkeleton,
  STORE_GRID, StoreCard, StoreCardSkeleton, TILE_GRID, TileSkeleton,
} from '@/sales/components/catalogue/Browse';
import { BROWSE_KINDS, HOUSE, fold, nameOf, type BrowseKind } from '@/sales/components/catalogue/data';
import { logoPlate } from '@/lib/logoPlate';
import { useBizT } from './lib/i18n';
import { useBizBrowseData } from './lib/catalogue';
import { ProductResults } from './components/catalogue';

/**
 * The business Catálogo (2026-10-29, user: "In catalog we will have the
 * stores, brands, origin, and categories as we have on reps"). The rep's
 * browse page (sales/SalesCataloguePage): four ways in — Tiendas,
 * Categorías, Orígenes, Marcas — each a grid of cards, a card opening its
 * products (BusinessCatalogueListPage). The tab is in the URL (`?by=`) and
 * remembered. Searching does not wait for a card: the cards that match come
 * first, then the products (`?q=`).
 *
 * Every product behind these cards has a wholesale price (user: "Only
 * products with a B2B price").
 */

const TAB_KEY = 'cesto-business-catalogue-by';
const SCROLL_KEY = 'cesto-business-catalogue-scroll';

function rememberedTab(): BrowseKind {
  try {
    const v = localStorage.getItem(TAB_KEY);
    if (v && (BROWSE_KINDS as string[]).includes(v)) return v as BrowseKind;
  } catch { /* storage blocked: the first tab */ }
  return 'stores';
}

export default function BusinessCataloguePage() {
  const t = useBizT();
  const lang = useLanguageStore((s) => s.lang) as 'es' | 'en';
  const navigate = useNavigate();
  const location = useLocation();
  const navType = useNavigationType();
  const [searchParams, setSearchParams] = useSearchParams();
  const data = useBizBrowseData();
  const { queries } = data;

  const byParam = searchParams.get('by');
  const by: BrowseKind = byParam && (BROWSE_KINDS as string[]).includes(byParam) ? byParam as BrowseKind : rememberedTab();
  const setBy = (k: BrowseKind) => {
    try { localStorage.setItem(TAB_KEY, k); } catch { /* not remembered, still shown */ }
    const next = new URLSearchParams(searchParams);
    next.set('by', k);
    setSearchParams(next, { replace: true });
  };

  const q = searchParams.get('q') ?? '';
  const [typed, setTyped] = useState(q);
  useEffect(() => {
    const id = setTimeout(() => {
      const v = typed.trim();
      if (v === q) return;
      const next = new URLSearchParams(searchParams);
      if (v) next.set('q', v); else next.delete('q');
      setSearchParams(next, { replace: true });
    }, 250);
    return () => clearTimeout(id);
  }, [typed, q, searchParams, setSearchParams]);
  const clearSearch = () => { setTyped(''); const next = new URLSearchParams(searchParams); next.delete('q'); setSearchParams(next, { replace: true }); };

  const open = (path: string) => {
    try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ at: location.search, y: window.scrollY })); } catch { /* top it is */ }
    navigate(`/business/catalogue/${path}`, { state: { fromCatalogue: true } });
  };
  const ready = !queries[by].isLoading;
  useEffect(() => {
    if (navType !== 'POP' || !ready) return;
    let saved: { at: string; y: number } | null = null;
    try { saved = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? 'null'); sessionStorage.removeItem(SCROLL_KEY); } catch { /* none */ }
    if (!saved || saved.at !== location.search) return;
    const y = saved.y;
    const raf = requestAnimationFrame(() => window.scrollTo(0, y));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const label = (o: { label_es: string; label_en?: string | null }) => (lang === 'en' && o.label_en) || o.label_es;
  const matches = useMemo(() => {
    const needle = fold(q);
    if (!needle) return [];
    const hit = (s: string | null | undefined) => !!s && fold(s).includes(needle);
    type Match = { key: string; kind: BrowseKind; name: string; image: string | null; logoBg?: string | null; path: string };
    const out: Match[] = [
      ...data.shopCards.filter((s) => hit(s.name)).map((s) => ({ key: `s-${s.id}`, kind: 'stores' as const, name: s.name, image: s.logo_url, logoBg: s.logo_bg, path: `stores/${s.id}` })),
      ...data.categories.filter((c) => hit(c.name_es) || hit(c.name_en)).map((c) => ({ key: `c-${c.id}`, kind: 'categories' as const, name: nameOf(c, lang), image: c.icon_url, path: `categories/${c.id}` })),
      ...data.origins.filter((o) => hit(o.label_es) || hit(o.label_en)).map((o) => ({ key: `o-${o.id}`, kind: 'origins' as const, name: label(o), image: o.image_url || null, path: `origins/${o.id}` })),
      ...data.brands.filter((b) => hit(b.name)).map((b) => ({ key: `b-${b.id}`, kind: 'brands' as const, name: b.name, image: b.logo_url, logoBg: b.logo_bg, path: `brands/${b.id}` })),
    ];
    return out.slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, lang, data.shopCards, data.categories, data.origins, data.brands]);

  const retry = (k: BrowseKind) => { queries[k].refetch(); };

  return (
    <div>
      <PageHeader
        title={t('biz.cat.title')}
        subtitle={t('biz.cat.subtitle')}
        actions={(
          <button
            type="button"
            onClick={() => open('all')}
            aria-label={t('biz.cat.seeAll')}
            className="h-10 px-3.5 rounded-xl bg-card border border-border shadow-card inline-flex items-center gap-2 text-[13.5px] font-semibold font-display text-ink hover:border-brand/40 hover:text-brand transition-colors"
          >
            <Package size={17} strokeWidth={1.75} className="text-brand" />
            <span className="hidden sm:inline">{t('biz.cat.seeAll')}</span>
            <span className="sm:hidden">{t('biz.cat.seeAllShort')}</span>
          </button>
        )}
      />

      <div className="sticky top-14 z-10 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 pt-1 pb-3 bg-surface-linen">
        <Card as="div" className="p-3">
          <SearchInput value={typed} onChange={(v) => { setTyped(v); if (!v) clearSearch(); }} placeholder={t('biz.cat.searchAll')} />
        </Card>
      </div>

      {q ? (
        <>
          {matches.length > 0 && (
            <section aria-label={t('biz.cat.matches')} className="mb-4">
              <div className="-mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 overflow-x-auto hide-scrollbar">
                <ul className="flex gap-2 min-w-max">
                  {matches.map((m) => (
                    <li key={m.key}>
                      <MatchChip kind={m.kind} name={m.name} image={m.image} logoBg={m.logoBg} kindLabel={t(`biz.cat.kindOne.${m.kind}`)} onOpen={() => open(m.path)} />
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
          <ProductResults
            params={{ q }}
            narrowed
            onReset={clearSearch}
            showShop={data.manyShops}
            none={{ title: t('biz.cat.noneTitle'), body: t('biz.cat.noneBody'), action: { label: t('biz.cat.backHome'), onClick: () => navigate('/business') } }}
          />
        </>
      ) : (
        <>
          <BrowseTabs value={by} onChange={setBy} />
          <div id="catalogue-panel" role="tabpanel" aria-labelledby={`catalogue-tab-${by}`} className="mt-4">
            {by === 'stores' && (
              <TabBody
                loading={queries.stores.isLoading}
                failed={queries.stores.isError}
                empty={data.shopCards.length === 0 && !data.house}
                onRetry={() => retry('stores')}
                skeleton={<ul className={STORE_GRID}>{Array.from({ length: 3 }).map((_, i) => <li key={i}><StoreCardSkeleton /></li>)}</ul>}
                emptyState={{ icon: Store, title: t('biz.cat.tabEmpty.storesTitle'), body: t('biz.cat.tabEmpty.body'), action: { label: t('biz.cat.seeAll'), onClick: () => open('all') } }}
              >
                <ul className={STORE_GRID}>
                  {data.house && (
                    <li className="min-w-0">
                      <StoreCard id={HOUSE} house name={t('biz.house')} count={data.houseCount} onOpen={() => open(`stores/${HOUSE}`)} />
                    </li>
                  )}
                  {data.shopCards.map((s) => (
                    <li key={s.id} className="min-w-0">
                      <StoreCard id={s.id} name={s.name} cover={s.cover_url} logo={s.logo_url} logoBg={s.logo_bg} hours={s.shop_hours} count={s.products} onOpen={() => open(`stores/${s.id}`)} />
                    </li>
                  ))}
                </ul>
              </TabBody>
            )}

            {by === 'categories' && (
              <TabBody
                loading={queries.categories.isLoading}
                failed={queries.categories.isError}
                empty={data.categories.length === 0}
                onRetry={() => retry('categories')}
                skeleton={<ul className={TILE_GRID}>{Array.from({ length: 14 }).map((_, i) => <li key={i}><TileSkeleton /></li>)}</ul>}
                emptyState={{ icon: LayoutGrid, title: t('biz.cat.tabEmpty.categoriesTitle'), body: t('biz.cat.tabEmpty.body'), action: { label: t('biz.cat.seeAll'), onClick: () => open('all') } }}
              >
                <ul className={TILE_GRID}>
                  {data.categories.map((c) => (
                    <li key={c.id} className="min-w-0">
                      <CategoryTile id={c.id} name={nameOf(c, lang)} image={c.icon_url} count={c.products} onOpen={() => open(`categories/${c.id}`)} />
                    </li>
                  ))}
                </ul>
              </TabBody>
            )}

            {by === 'origins' && (
              <TabBody
                loading={queries.origins.isLoading}
                failed={queries.origins.isError}
                empty={data.origins.length === 0}
                onRetry={() => retry('origins')}
                skeleton={<ul className={ORIGIN_GRID}>{Array.from({ length: 4 }).map((_, i) => <li key={i}><OriginSkeleton /></li>)}</ul>}
                emptyState={{ icon: MapPin, title: t('biz.cat.tabEmpty.originsTitle'), body: t('biz.cat.tabEmpty.body'), action: { label: t('biz.cat.byCategory'), onClick: () => setBy('categories') } }}
              >
                <ul className={ORIGIN_GRID}>
                  {data.origins.map((o) => (
                    <li key={o.id} className="min-w-0">
                      <OriginCard id={o.id} label={label(o)} image={o.image_url || null} count={o.products} onOpen={() => open(`origins/${o.id}`)} />
                    </li>
                  ))}
                </ul>
              </TabBody>
            )}

            {by === 'brands' && (
              <TabBody
                loading={queries.brands.isLoading}
                failed={queries.brands.isError}
                empty={data.brands.length === 0}
                onRetry={() => retry('brands')}
                skeleton={<ul className={TILE_GRID}>{Array.from({ length: 14 }).map((_, i) => <li key={i}><TileSkeleton wide /></li>)}</ul>}
                emptyState={{ icon: Tag, title: t('biz.cat.tabEmpty.brandsTitle'), body: t('biz.cat.tabEmpty.body'), action: { label: t('biz.cat.byCategory'), onClick: () => setBy('categories') } }}
              >
                <ul className={TILE_GRID}>
                  {data.brands.map((b) => (
                    <li key={b.id} className="min-w-0">
                      <BrandTile name={b.name} logo={b.logo_url} logoBg={b.logo_bg} count={b.products} onOpen={() => open(`brands/${b.id}`)} />
                    </li>
                  ))}
                </ul>
              </TabBody>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** A tab's cards — or their shimmer, or why there are none, or a retry. */
function TabBody({ loading, failed, empty, onRetry, skeleton, emptyState, children }: {
  loading: boolean; failed: boolean; empty: boolean; onRetry: () => void; skeleton: React.ReactNode;
  emptyState: { icon: React.ElementType; title: string; body: string; action: { label: string; onClick: () => void } };
  children: React.ReactNode;
}) {
  const t = useBizT();
  if (loading) return <>{skeleton}</>;
  if (failed && empty) {
    return (
      <Card>
        <EmptyState
          icon={<WifiOff size={28} strokeWidth={1.75} className="text-muted" />}
          title={t('biz.cat.errorTitle')}
          description={t('biz.loadError')}
          action={{ label: t('biz.retry'), onClick: onRetry }}
        />
      </Card>
    );
  }
  if (empty) {
    const Icon = emptyState.icon;
    return (
      <Card>
        <EmptyState icon={<Icon size={28} strokeWidth={1.75} className="text-muted" />} title={emptyState.title} description={emptyState.body} action={emptyState.action} />
      </Card>
    );
  }
  return <>{children}</>;
}

const MATCH_ICON: Record<BrowseKind, React.ElementType> = { stores: Store, categories: LayoutGrid, origins: MapPin, brands: Tag };

/** A card the search matched: its picture small, its name, and what it is. */
function MatchChip({ kind, name, image, logoBg, kindLabel, onOpen }: {
  kind: BrowseKind; name: string; image: string | null; logoBg?: string | null; kindLabel: string; onOpen: () => void;
}) {
  const Icon = MATCH_ICON[kind];
  const contain = kind === 'brands';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="h-12 pl-1.5 pr-3.5 rounded-xl bg-card border border-border shadow-card inline-flex items-center gap-2.5 text-left hover:border-brand/40 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <span
        className={`w-9 h-9 rounded-lg overflow-hidden shrink-0 flex items-center justify-center ${image ? `sales-photo ring-1 ring-inset ring-border ${contain ? logoPlate(logoBg).className : ''}` : 'bg-brand-whisper text-brand'}`}
        style={image && contain ? logoPlate(logoBg).style : undefined}
      >
        {image
          ? <img src={resolveImageUrl(image, 'thumb')} alt="" className={`w-full h-full ${contain ? 'object-contain p-1' : 'object-cover'}`} loading="lazy" draggable={false} />
          : <Icon size={17} strokeWidth={1.75} />}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block max-w-[200px] truncate text-[13.5px] font-semibold font-display text-ink">{name}</span>
        <span className="block text-[11.5px] font-medium font-display text-muted">{kindLabel}</span>
      </span>
    </button>
  );
}
