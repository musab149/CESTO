import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, SlidersHorizontal, Package, Loader2, Building2, Home, WifiOff, Plus, PackageCheck, Store,
} from 'lucide-react';
import {
  resolveImageUrl, useSalesProductsFullInfinite, useSalesProductsList,
  type SalesProduct, type SalesProductVariant, type SalesProductsListParams,
} from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useSalesT } from '../../lib/i18n';
import { money } from '../../lib/format';
import { newOrderWith } from '../../lib/pendingAdd';
import Combobox, { type ComboboxOption } from '../form/Combobox';
import { Card } from '../ui';
import { Button, Dialog } from '../Dialog';
import EmptyState from '../EmptyState';
import { Skeleton } from '../Skeleton';
import { nameOf } from './data';

/**
 * The Catálogo's products: the grid, a product's card and its sheet, and the
 * filter drawer — shared by the search on the browse page and the list behind
 * every card (a shop, a category, an origin, a brand). Moved out of the page
 * when it became two (2026-10-28).
 *
 * For answering a client rather than building a basket: what do we have, in
 * which sizes, what does it cost a household and what a business, and is
 * there any left. Building an order keeps its own panel
 * (components/OrderProductPanel), which prices for the one client picked —
 * the one thing done from here is starting an order with a product, which
 * hands the size to that screen (lib/pendingAdd).
 *
 * The API is the builder's (/api/sales/catalogue/*), so the scope is the same
 * by construction: active products in the rep's sellable shops, nothing at all
 * without one. `prices: 'both'` is the one difference — with nobody picked,
 * every size carries its retail and its wholesale price.
 *
 * A product opens in a sheet whose state is in the URL (`?p=`), so a phone's
 * back gesture closes the sheet instead of leaving the catalogue.
 */

export const PAGE_SIZE = 30;

export type Lang = 'es' | 'en';


/** Wholesale for a size, or null where a business simply pays retail. */
function wholesaleOf(v: SalesProductVariant): number | null {
  if (v.b2b_price == null) return null;
  const n = Number(v.b2b_price);
  return Number.isFinite(n) && n !== Number(v.price) ? n : null;
}

type StockState = 'out' | 'low' | 'in';
const stockOf = (v: SalesProductVariant): StockState =>
  v.stock_quantity <= 0 ? 'out' : v.stock_quantity <= v.low_stock_threshold ? 'low' : 'in';

/**
 * The products a query finds, as the grid: the count, the cards, the next page
 * as the end comes into view, and the product open in its sheet (`?p=`).
 *
 * `params` is the whole query — the list's fixed scope and whatever narrows
 * it. Always active, always both prices: the server forces the first, and the
 * second is what browsing with nobody picked means.
 */
export function ProductResults({ params, narrowed, onReset, showShop, none }: {
  params: Omit<SalesProductsListParams, 'page' | 'limit' | 'isActive' | 'prices'>;
  /** Something narrows it, so an empty answer offers to undo that. */
  narrowed: boolean;
  onReset: () => void;
  /** Each card names its shop: more than one can be on screen. */
  showShop: boolean;
  /** Nothing narrows it and there is nothing: what to say, and where to go. */
  none: { title: string; body: string; action: { label: string; onClick: () => void } };
}) {
  const t = useSalesT();
  const lang = useLanguageStore((s) => s.lang) as Lang;
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useSalesProductsFullInfinite({ sort: 'name_asc', ...params, isActive: 'true', prices: 'both', limit: PAGE_SIZE });
  const products = (data?.pages ?? []).flatMap((p) => p.items);
  const total = data?.pages?.[0]?.total ?? 0;

  // The next page as the end of the grid comes into view — a rep scrolling
  // with one hand should not have to stop and press anything.
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) fetchNextPage(); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, products.length]);

  // ─── The open product, held in the URL ─────────────────
  const openId = searchParams.get('p');
  const [held, setHeld] = useState<SalesProduct | null>(null);
  const inList = openId ? (products.find((p) => p.id === openId) ?? (held?.id === openId ? held : null)) : null;
  // Arriving with ?p= — a reload, or back from the order screen, which
  // remounts this page with a fresh list — the product is read on its own.
  const { data: alone } = useSalesProductsList(
    { productId: openId ?? undefined, prices: 'both', limit: 1 },
    !!openId && !inList,
  );
  const open = inList ?? (alone?.items[0]?.id === openId ? alone.items[0] : null);
  const openProduct = (p: SalesProduct) => {
    setHeld(p);
    const next = new URLSearchParams(searchParams);
    next.set('p', p.id);
    navigate({ search: `?${next}` }, { state: { ...(location.state as object | null), sheet: true } });
  };
  const closeProduct = () => {
    // Opened from here: going back is closing it, so the phone's back gesture
    // and the × agree. Arrived with ?p= (a reload): drop it in place.
    if ((location.state as { sheet?: boolean } | null)?.sheet) { navigate(-1); return; }
    const next = new URLSearchParams(searchParams);
    next.delete('p');
    setSearchParams(next, { replace: true });
  };
  const order = (productId: string, variantId: string) => navigate(newOrderWith({ variantId, productId }));

  return (
    <>
      {isLoading ? (
        <ul className={GRID} aria-busy="true">
          {Array.from({ length: 12 }).map((_, i) => <li key={i}><CardSkeleton /></li>)}
        </ul>
      ) : isError && products.length === 0 ? (
        <Card>
          <EmptyState
            icon={<WifiOff size={28} strokeWidth={1.75} className="text-muted" />}
            title={t('sales.catalogue.errorTitle')}
            description={t('sales.catalogue.errorBody')}
            action={{ label: t('sales.catalogue.retry'), onClick: () => { refetch(); } }}
          />
        </Card>
      ) : products.length === 0 ? (
        <Card>
          {narrowed ? (
            <EmptyState
              icon={<Search size={28} strokeWidth={1.75} className="text-muted" />}
              title={t('sales.catalogue.emptyTitle')}
              description={t('sales.catalogue.emptyBody')}
              action={{ label: t('sales.catalogue.emptyCta'), onClick: onReset }}
            />
          ) : (
            <EmptyState
              icon={<Package size={28} strokeWidth={1.75} className="text-muted" />}
              title={none.title}
              description={none.body}
              action={none.action}
            />
          )}
        </Card>
      ) : (
        <>
          <p className="mb-2.5 px-0.5 text-[12.5px] text-muted tabular-nums">
            {t('sales.catalogue.showing', { loaded: products.length, total })}
          </p>
          <ul className={GRID}>
            {products.map((p) => (
              <li key={p.id} className="min-w-0">
                <ProductCard
                  product={p}
                  lang={lang}
                  showShop={showShop}
                  onOpen={() => openProduct(p)}
                  onOrder={(variantId) => order(p.id, variantId)}
                  t={t}
                />
              </li>
            ))}
            {/* The next page arriving, as cards rather than a spinner. */}
            {isFetchingNextPage && Array.from({ length: 6 }).map((_, i) => <li key={`more-${i}`}><CardSkeleton /></li>)}
          </ul>

          {/* The next page comes in as the end of the grid nears. The button
              stays for anyone who gets here before it does. */}
          {hasNextPage ? (
            <div ref={loadMoreRef} className="pt-5 pb-2 flex flex-col items-center gap-2">
              {!isFetchingNextPage && (
                <button
                  type="button"
                  onClick={() => fetchNextPage()}
                  className="h-10 px-4 rounded-xl border border-border bg-card shadow-card text-[13.5px] font-semibold font-display text-gray hover:border-brand/40 hover:text-brand inline-flex items-center gap-2 transition-colors"
                >
                  {t('sales.catalogue.loadMore')}
                </button>
              )}
              {isFetchingNextPage && (
                <span className="inline-flex items-center gap-2 text-[13px] text-gray">
                  <Loader2 size={15} strokeWidth={2.5} className="animate-spin text-brand" />
                  {t('sales.catalogue.loadingMore')}
                </span>
              )}
            </div>
          ) : products.length > PAGE_SIZE && (
            <p className="pt-5 pb-2 text-center text-[12.5px] text-muted">{t('sales.catalogue.end', { count: total })}</p>
          )}
        </>
      )}

      {open && (
        <ProductSheet
          key={open.id}
          product={open}
          lang={lang}
          onClose={closeProduct}
          onOrder={(variantId) => order(open.id, variantId)}
          t={t}
        />
      )}
    </>
  );
}

export type T = (key: string, vars?: Record<string, string | number>) => string;

/** The product grid's columns and spacing — the panel's card spacing. */
export const GRID = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 md:gap-3.5 2xl:gap-4';

/** A category: its icon in a small round well, and its name. */
export function CategoryPill({ active, onClick, icon, children }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-9 pl-1.5 pr-3 shrink-0 max-w-[220px] rounded-full border inline-flex items-center gap-2 text-[13px] font-semibold font-display whitespace-nowrap transition-colors ${
        active ? 'bg-brand-whisper border-brand/30 text-brand' : 'bg-card border-border text-gray hover:text-ink hover:border-ink/20'
      }`}
    >
      <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${active ? 'bg-card text-brand' : 'bg-surface-cream text-muted'}`}>
        {icon}
      </span>
      <span className="truncate">{children}</span>
    </button>
  );
}

/** A category's own icon, or the box when it has none or it fails to load — never an empty well. */
export function CategoryIcon({ url }: { url?: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <Package size={14} strokeWidth={1.75} />;
  return <img src={resolveImageUrl(url)} alt="" className="w-4 h-4 object-contain" draggable={false} onError={() => setFailed(true)} />;
}

/** A card shimmering in the shape of a product card. */
export function CardSkeleton() {
  return (
    <div className="h-full rounded-2xl bg-card border border-border shadow-card overflow-hidden">
      <Skeleton className="aspect-[4/3] rounded-none" />
      <div className="px-2.5 pt-2 pb-2.5">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-4 w-full mt-2" />
        <Skeleton className="h-3 w-2/3 mt-1.5" />
      </div>
    </div>
  );
}

function StockLine({ v, t }: { v: SalesProductVariant; t: T }) {
  const s = stockOf(v);
  const tone = s === 'out' ? 'text-danger' : s === 'low' ? 'text-warning' : 'text-success';
  const dot = s === 'out' ? 'bg-danger' : s === 'low' ? 'bg-warning' : 'bg-success';
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold font-display ${tone}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {s === 'out' ? t('sales.catalogue.outOfStock') : s === 'low' ? t('sales.catalogue.lowStock', { count: v.stock_quantity }) : t('sales.catalogue.inStock')}
    </span>
  );
}

function AudienceBadge({ audience, t }: { audience: SalesProduct['audience']; t: T }) {
  if (audience !== 'b2b' && audience !== 'b2c') return null;
  return (
    <span className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md text-[10.5px] font-bold font-display ${
      audience === 'b2b' ? 'bg-info-bg text-info' : 'bg-brand-mist text-brand'
    }`}>
      {audience === 'b2b' ? <Building2 size={11} strokeWidth={2} /> : <Home size={11} strokeWidth={2} />}
      {audience === 'b2b' ? t('sales.catalogue.b2bOnly') : t('sales.catalogue.b2cOnly')}
    </span>
  );
}

/**
 * The prices a rep is asked for, labelled — PVP and Mayorista side by side.
 * A product sold to one audience only shows that audience's price: a B2B-only
 * jar's retail figure is not a price anybody can be charged.
 */
function Prices({ v, audience, t }: { v: SalesProductVariant; audience: SalesProduct['audience']; t: T }) {
  const retail = Number(v.price);
  const trade = wholesaleOf(v);
  const was = v.compare_at_price != null && Number(v.compare_at_price) > retail ? Number(v.compare_at_price) : null;
  const showRetail = audience !== 'b2b';
  const showTrade = audience !== 'b2c' && (trade != null || audience === 'b2b');
  const big = 'text-[15px]';
  return (
    <div className="flex items-end gap-x-4 gap-y-1 flex-wrap">
      {showRetail && (
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold font-display text-muted leading-none">{t('sales.catalogue.retail')}</p>
          <p className={`${big} font-bold font-display text-ink tabular-nums leading-tight mt-0.5`}>
            {money(retail)}
            {was != null && <span className="ml-1.5 text-[11px] font-medium text-muted line-through">{money(was)}</span>}
          </p>
        </div>
      )}
      {showTrade && (
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold font-display text-muted leading-none">{t('sales.catalogue.wholesale')}</p>
          <p className={`${big} font-bold font-display text-brand tabular-nums leading-tight mt-0.5`}>{money(trade ?? retail)}</p>
        </div>
      )}
    </div>
  );
}

/** A small tag over the product's picture — legible on any photo. */
function PhotoTag({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 h-[22px] px-1.5 rounded-md bg-white/90 backdrop-blur-sm shadow-[0_1px_2px_rgba(13,27,46,0.10)] text-[10.5px] font-semibold font-display whitespace-nowrap ${className}`}>
      {children}
    </span>
  );
}

/** Whether there is any, as a tag for the picture's corner. */
function StockTag({ v, t }: { v: SalesProductVariant; t: T }) {
  const s = stockOf(v);
  const tone = s === 'out' ? 'text-danger' : s === 'low' ? 'text-warning' : 'text-success';
  const dot = s === 'out' ? 'bg-danger' : s === 'low' ? 'bg-warning' : 'bg-success';
  return (
    <PhotoTag className={tone}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {s === 'out' ? t('sales.catalogue.outOfStock') : s === 'low' ? t('sales.catalogue.lowStock', { count: v.stock_quantity }) : t('sales.catalogue.inStock')}
    </PhotoTag>
  );
}

/**
 * A product in the grid, in the shop's own card shape (components/ProductCard)
 * dressed in the rep panel's colours — and kept SHORT (user, 2026-10-27: the
 * first version stood too tall). The picture runs edge to edge and carries
 * the tags: offer and audience top left, stock top right, the shop bottom
 * left and the round "+" bottom right. Under it, three tight lines: the price
 * (labelled, with Mayorista as a chip beside it), the name, and brand · size ·
 * how many sizes.
 *
 * The name is the way into the sheet and stretches over the whole card; the
 * "+" sits above it and starts an order with the product — its one size
 * straight away, or the sheet to pick one when there are several.
 */
function ProductCard({ product: p, lang, showShop, onOpen, onOrder, t }: {
  product: SalesProduct; lang: Lang; showShop: boolean; onOpen: () => void; onOrder: (variantId: string) => void; t: T;
}) {
  const v = p.variants[0];
  const img = p.images?.[0]?.url;
  const retail = v ? Number(v.price) : 0;
  const trade = v ? wholesaleOf(v) : null;
  const was = v && v.compare_at_price != null && Number(v.compare_at_price) > retail ? Number(v.compare_at_price) : null;
  // A product sold to businesses only leads with what a business pays.
  const businessOnly = p.audience === 'b2b';
  const lead = businessOnly ? (trade ?? retail) : retail;
  const showTrade = !businessOnly && p.audience !== 'b2c' && trade != null;
  const several = p.variants.length > 1;
  const orderable = several ? p.variants.some((x) => x.stock_quantity > 0) : !!v && v.stock_quantity > 0;
  const soldOut = !!v && !orderable;
  const meta = [p.brand, v ? nameOf(v, lang) : null].filter(Boolean).join('  ·  ');
  return (
    <div className="group relative isolate h-full flex flex-col rounded-2xl bg-card border border-border shadow-card overflow-hidden transition-[box-shadow,border-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-card-hover hover:border-brand/25 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      {/* The picture, edge to edge, carrying the tags. */}
      <div className="sales-photo relative aspect-[4/3] bg-surface-cream">
        {img
          ? <img src={resolveImageUrl(img)} alt="" loading="lazy" className={`absolute inset-0 w-full h-full object-contain p-1 mix-blend-multiply transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transition-none ${soldOut ? 'opacity-50' : ''}`} draggable={false} />
          : <div className="absolute inset-0 flex items-center justify-center"><Package size={30} strokeWidth={1.5} className="text-muted/50" /></div>}
        <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-1.5">
          <div className="flex flex-col items-start gap-1 min-w-0">
            {was != null && (
              <span className="inline-flex h-[22px] items-center px-1.5 rounded-md bg-danger text-white text-[10.5px] font-bold font-display">{t('sales.catalogue.offer')}</span>
            )}
            <AudienceBadge audience={p.audience} t={t} />
          </div>
          {v && <StockTag v={v} t={t} />}
        </div>
        {/* Its shop — in blue, with a tick, when it is the rep's by hand
            rather than through one of their shops. */}
        {(showShop || p.assigned) && (
          <PhotoTag className={`absolute bottom-2 left-2 max-w-[calc(100%-3.75rem)] ${p.assigned ? 'text-brand' : 'text-gray'}`}>
            {p.assigned
              ? <PackageCheck size={11} strokeWidth={2} className="shrink-0" aria-label={t('sales.catalogue.assignedTag')} />
              : <Store size={11} strokeWidth={2} className="shrink-0" />}
            <span className="truncate">{p.store?.name ?? t('sales.port.orderDetail.editOrder.cestoHouseStore')}</span>
          </PhotoTag>
        )}
        {orderable && (
          <button
            type="button"
            onClick={() => (several ? onOpen() : onOrder(v.id))}
            aria-label={t('sales.catalogue.order')}
            title={t('sales.catalogue.order')}
            className="absolute bottom-2 right-2 z-10 w-9 h-9 rounded-full bg-brand text-white flex items-center justify-center shadow-[0_6px_14px_-6px_rgba(5,78,232,0.7)] hover:bg-brand-mid active:scale-95 transition"
          >
            <Plus size={19} strokeWidth={2.25} />
          </button>
        )}
      </div>

      <div className="px-2.5 pt-2 pb-2.5 flex flex-col min-w-0">
        {v && (
          <div className="flex items-center gap-x-1.5 gap-y-1 flex-wrap">
            <span className="text-[16px] font-bold font-display text-ink tabular-nums leading-none">{money(lead)}</span>
            <span className="text-[10.5px] font-semibold font-display text-muted">{businessOnly ? t('sales.catalogue.wholesale') : t('sales.catalogue.retail')}</span>
            {was != null && <span className="text-[11px] text-muted line-through tabular-nums">{money(was)}</span>}
            {showTrade && (
              <span className="inline-flex items-center h-5 px-1.5 rounded-md bg-brand-whisper text-brand text-[10.5px] font-semibold font-display tabular-nums">
                {t('sales.catalogue.wholesale')} {money(trade)}
              </span>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onOpen}
          className="mt-1.5 text-left text-[13px] font-semibold font-display text-ink leading-snug line-clamp-2 focus:outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-brand/40"
        >
          {nameOf(p, lang)}
        </button>
        {(meta || several) && (
          <p className="mt-0.5 text-[11.5px] text-muted truncate">
            {meta}
            {several && <span className="text-brand font-semibold">{meta ? '  ·  ' : ''}{t('sales.catalogue.sizes_other', { count: p.variants.length })}</span>}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One product, all of it: every size with both prices and its stock, where it
 * comes from, and what it is. A sheet from the bottom on a phone, a panel on
 * the right from lg.
 *
 * Its one action starts an order with it (user, 2026-10-26). With several
 * sizes the rows become a choice — the first in stock to begin with — and the
 * button orders the one picked. The client is asked next, on the order screen,
 * which prices the line for them (lib/pendingAdd).
 */
function ProductSheet({ product: p, lang, onClose, onOrder, t }: {
  product: SalesProduct; lang: Lang; onClose: () => void; onOrder: (variantId: string) => void; t: T;
}) {
  const [chosenId, setChosenId] = useState(() => (p.variants.find((v) => v.stock_quantity > 0) ?? p.variants[0])?.id ?? '');
  const chosen = p.variants.find((v) => v.id === chosenId);
  const several = p.variants.length > 1;

  const img = p.images?.[0]?.url;
  const description = (lang === 'en' && p.description_en) || p.description_es;
  const origin = p.origin_ref ? ((lang === 'en' && p.origin_ref.label_en) || p.origin_ref.label_es) : p.origin;
  const anyTrade = p.audience !== 'b2c' && p.variants.some((v) => wholesaleOf(v) != null);
  const facts: { label: string; value: string }[] = [
    { label: t('sales.catalogue.shop'), value: p.store?.name ?? t('sales.port.orderDetail.editOrder.cestoHouseStore') },
    ...(p.category ? [{ label: t('sales.catalogue.category'), value: p.category.name_es }] : []),
    ...(origin ? [{ label: t('sales.catalogue.origin'), value: origin }] : []),
  ];

  return (
    <Dialog
      variant="side"
      onClose={onClose}
      closeLabel={t('sales.catalogue.close')}
      icon={Package}
      title={nameOf(p, lang)}
      subtitle={p.brand ?? undefined}
      // Pinned under the scroll, so it is there whichever part is showing.
      footer={chosen ? (
        <>
          <Button className="w-full" onClick={() => onOrder(chosen.id)} disabled={chosen.stock_quantity <= 0}>
            {chosen.stock_quantity <= 0 ? t('sales.catalogue.outOfStock') : (
              <>
                <Plus size={19} strokeWidth={2.25} />
                {t('sales.catalogue.order')}
              </>
            )}
          </Button>
          <p className="mt-1.5 text-center text-[12px] text-muted">{t('sales.catalogue.orderHint')}</p>
        </>
      ) : undefined}
    >
      <div className="sales-photo relative aspect-[4/3] rounded-2xl bg-surface-cream overflow-hidden">
        {img
          ? <img src={resolveImageUrl(img)} alt="" className="absolute inset-0 w-full h-full object-contain p-3 mix-blend-multiply" draggable={false} />
          : <div className="absolute inset-0 flex items-center justify-center"><Package size={44} strokeWidth={1.5} className="text-muted/50" /></div>}
      </div>

      {(p.audience === 'b2b' || p.audience === 'b2c') && (
        <p className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-semibold font-display ${
          p.audience === 'b2b' ? 'bg-info-bg text-info' : 'bg-brand-whisper text-brand'
        }`}>
          {p.audience === 'b2b' ? <Building2 size={15} strokeWidth={1.75} /> : <Home size={15} strokeWidth={1.75} />}
          {p.audience === 'b2b' ? t('sales.catalogue.b2bOnlyHint') : t('sales.catalogue.b2cOnlyHint')}
        </p>
      )}
      {/* Theirs by hand, not through one of their shops — said, so a product
          from a shop they do not sell from is not a surprise. */}
      {p.assigned && (
        <p className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 bg-brand-whisper text-brand text-[13px] font-semibold font-display">
          <PackageCheck size={15} strokeWidth={1.75} className="shrink-0 mt-px" />
          {t('sales.catalogue.assignedHint')}
        </p>
      )}

      <section className="mt-5">
        <h3 className="text-[15px] font-semibold font-display text-ink">{t('sales.catalogue.sizesTitle')}</h3>
        {several && <p className="mt-0.5 text-[12.5px] text-muted">{t('sales.catalogue.pickSize')}</p>}
        <ul className="mt-2.5 space-y-2" role={several ? 'radiogroup' : undefined} aria-label={t('sales.catalogue.sizesTitle')}>
          {p.variants.map((v) => {
            const on = several && v.id === chosenId;
            const body = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-start gap-2.5">
                    {/* A radio's dot, drawn: the row is the control. */}
                    {several && (
                      <span className={`mt-0.5 w-[18px] h-[18px] shrink-0 rounded-full border-2 flex items-center justify-center ${on ? 'border-brand' : 'border-border'}`} aria-hidden="true">
                        {on && <span className="w-2 h-2 rounded-full bg-brand" />}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold font-display text-ink">{nameOf(v, lang)}</p>
                      {v.sku && <p className="text-[11.5px] font-mono text-muted mt-0.5 break-all">{v.sku}</p>}
                    </div>
                  </div>
                  <span className="shrink-0 pt-0.5"><StockLine v={v} t={t} /></span>
                </div>
                <div className={`mt-2 ${several ? 'pl-[28px]' : ''}`}><Prices v={v} audience={p.audience} t={t} /></div>
              </>
            );
            return (
              <li key={v.id}>
                {several ? (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setChosenId(v.id)}
                    className={`w-full text-left px-3.5 py-3 rounded-xl border transition-colors ${on ? 'border-brand ring-1 ring-brand bg-brand-whisper/60' : 'border-border hover:border-brand/40'}`}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="px-3.5 py-3 rounded-xl border border-border bg-surface-cream/50">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[12px] text-muted">
          {anyTrade || p.audience === 'b2b' ? t('sales.catalogue.priceLegend') : p.audience === 'b2c' ? '' : t('sales.catalogue.noWholesale')}
        </p>
      </section>

      <dl className="mt-4 rounded-xl border border-border divide-y divide-border">
        {facts.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-4 px-3.5 py-2.5 text-[13.5px]">
            <dt className="text-muted font-display shrink-0">{f.label}</dt>
            <dd className="text-ink font-semibold font-display min-w-0 text-right break-words">{f.value}</dd>
          </div>
        ))}
      </dl>

      {description && (
        <section className="mt-5">
          <h3 className="text-[15px] font-semibold font-display text-ink">{t('sales.catalogue.description')}</h3>
          <p className="mt-1.5 text-[14px] font-body text-gray leading-relaxed whitespace-pre-line">{description}</p>
        </section>
      )}
    </Dialog>
  );
}

export interface DrawerField {
  key: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** Plain options — the first is the "all" choice, which doubles as the placeholder. */
  options: Extract<ComboboxOption, { label: string }>[];
  searchable?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * The filters that narrow a category — the builder panel's drawer, minus the
 * shop (which has its own row above the grid). A side panel in the dialog
 * shell (components/Dialog).
 *
 * Each field is a <div>, never a <label>: a label adopts the Combobox trigger
 * and re-fires every click inside it onto the trigger, which reopens the menu
 * that was just chosen from (see components/OrderProductPanel PanelField).
 */
export function FilterDrawer({ fields, onClose, onReset, resetDisabled, t }: {
  fields: DrawerField[]; onClose: () => void; onReset: () => void; resetDisabled: boolean; t: T;
}) {
  return (
    <Dialog
      variant="side"
      onClose={onClose}
      closeLabel={t('sales.catalogue.close')}
      icon={SlidersHorizontal}
      title={t('sales.port.products.filters.title')}
      bodyClassName="px-5 py-4 space-y-4"
      footer={(
        <div className="flex gap-2.5">
          <Button variant="secondary" className="flex-1" onClick={onReset} disabled={resetDisabled}>
            {t('sales.port.products.filters.clearAll')}
          </Button>
          <Button className="flex-1" onClick={onClose}>{t('sales.port.products.filters.done')}</Button>
        </div>
      )}
    >
      {fields.map((f) => (
        <div key={f.key} className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold font-display text-gray">{f.label}</span>
          <Combobox
            value={f.value}
            onChange={f.onChange}
            options={f.options}
            ariaLabel={f.label}
            placeholder={f.placeholder ?? f.options[0]?.label}
            searchable={f.searchable}
            disabled={f.disabled}
            menuPortal
          />
        </div>
      ))}
    </Dialog>
  );
}
