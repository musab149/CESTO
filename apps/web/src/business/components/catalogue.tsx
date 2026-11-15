import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Minus, Package, Plus, Search, Store, WifiOff } from 'lucide-react';
import {
  useBusinessProductsInfinite, type BusinessProduct, type BusinessProductsParams, type BusinessSize,
} from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useCartStore } from '@/stores/cartStore';
import { money } from '@/sales/lib/format';
import { Card } from '@/sales/components/ui';
import EmptyState from '@/sales/components/EmptyState';
import { Skeleton } from '@/sales/components/Skeleton';
import { GRID } from '@/sales/components/catalogue/Products';
import { nameOf } from '@/sales/components/catalogue/data';
import { useBizT } from '../lib/i18n';
import { pricesOf, stockOf, useLine } from '../lib/sizes';
import Photo from './Photo';

/*
 * The business catalogue's products (2026-10-29): the rep panel's grid and
 * card (sales/components/catalogue/Products), for a buyer. Every product here
 * has a wholesale price (API lib/businessCatalogue), so a card leads with
 * what THEY pay — never a retail price — and its "+" puts it in
 * the cart, then becomes the quantity (the shop's rule: the add button turns
 * into a stepper on the first tap).
 */

export type Lang = 'es' | 'en';
export const PAGE_SIZE = 30;

/** The add button, and once something is in the cart, its quantity. */
export function QtyStepper({ productId, size, compact = false, className = '' }: {
  productId: string; size: BusinessSize; compact?: boolean; className?: string;
}) {
  const t = useBizT();
  const line = useLine(productId, size);
  const out = stockOf(size) === 'out';
  const h = compact ? 'h-9' : 'h-11';
  if (line.qty === 0) {
    return (
      <button
        type="button"
        onClick={line.add}
        disabled={out}
        aria-label={t('biz.cat.add')}
        title={t('biz.cat.add')}
        className={compact
          ? `w-9 h-9 rounded-full bg-brand text-white flex items-center justify-center shadow-[0_6px_14px_-6px_rgba(5,78,232,0.7)] hover:bg-brand-mid active:scale-95 transition disabled:bg-surface-sand disabled:text-muted disabled:shadow-none ${className}`
          : `${h} px-5 rounded-xl bg-brand text-white text-[14.5px] font-semibold font-display inline-flex items-center justify-center gap-2 hover:bg-brand-mid active:scale-[0.99] transition disabled:bg-surface-sand disabled:text-muted ${className}`}
      >
        <Plus size={compact ? 19 : 17} strokeWidth={2.25} />
        {!compact && (out ? t('biz.cat.outOfStock') : t('biz.cat.add'))}
      </button>
    );
  }
  return (
    <div
      role="group"
      aria-label={t('biz.cat.inCart', { count: line.qty })}
      className={`${h} rounded-full bg-brand text-white inline-flex items-center shadow-[0_6px_14px_-6px_rgba(5,78,232,0.7)] ${compact ? '' : 'rounded-xl'} ${className}`}
    >
      <button type="button" onClick={line.minus} aria-label={t('biz.cat.less')} className={`${compact ? 'w-8' : 'w-11'} h-full flex items-center justify-center rounded-l-full hover:bg-white/10 active:scale-95 transition`}>
        <Minus size={compact ? 15 : 17} strokeWidth={2.5} />
      </button>
      <span className={`${compact ? 'min-w-[20px] text-[13.5px]' : 'min-w-[32px] text-[15px]'} text-center font-bold font-display tabular-nums`} aria-live="polite">{line.qty}</span>
      <button type="button" onClick={line.plus} disabled={line.qty >= line.max} aria-label={t('biz.cat.more')} className={`${compact ? 'w-8' : 'w-11'} h-full flex items-center justify-center rounded-r-full hover:bg-white/10 active:scale-95 transition disabled:opacity-40`}>
        <Plus size={compact ? 15 : 17} strokeWidth={2.5} />
      </button>
    </div>
  );
}

function PhotoTag({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 h-[22px] px-1.5 rounded-md bg-white/90 backdrop-blur-sm shadow-[0_1px_2px_rgba(13,27,46,0.10)] text-[10.5px] font-semibold font-display whitespace-nowrap ${className}`}>
      {children}
    </span>
  );
}

export function StockTag({ v }: { v: BusinessSize }) {
  const t = useBizT();
  const s = stockOf(v);
  const tone = s === 'out' ? 'text-danger' : s === 'low' ? 'text-warning' : 'text-success';
  const dot = s === 'out' ? 'bg-danger' : s === 'low' ? 'bg-warning' : 'bg-success';
  return (
    <PhotoTag className={tone}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {s === 'out' ? t('biz.cat.outOfStock') : s === 'low' ? t('biz.cat.lowStock', { count: v.stock_quantity }) : t('biz.cat.inStock')}
    </PhotoTag>
  );
}

/**
 * A product in the grid (sales ProductCard's shape): the picture edge to
 * edge carrying the tags and the add button; under it their price, the name
 * (the way into the product page) and brand · size.
 *
 * SEVERAL SIZES ARE PICKED ON THE CARD (user, 2026-10-30: the "+" used to
 * open the product page to choose one — "bad ux… add the size dropdown
 * within product card as in rep"): a size box, as the rep's order builder
 * card has (OrderProductPanel), and the price, stock, add button and stepper
 * are the chosen size's. It starts on a size already in the cart, else the
 * default one (the API sends it first) unless that is sold out — so "+"
 * straight away adds the default size.
 *
 * EVERY CARD HAS THE SAME PARTS (user, 2026-10-31: cards of one height, some
 * with the size box and some without — "this looks bad"): the price with the
 * brand opposite it, the name, and at the foot, level across the row, the
 * size — the box to choose it when there are several, the one size in a plain
 * well (not a control) otherwise.
 */
export function ProductCard({ product: p, lang, showShop, onOpen }: {
  product: BusinessProduct; lang: Lang; showShop: boolean; onOpen: () => void;
}) {
  const t = useBizT();
  const [chosenId, setChosenId] = useState(() => {
    const inCart = new Set(useCartStore.getState().items.map((i) => i.variantId));
    return (p.variants.find((x) => inCart.has(x.id)) ?? p.variants.find((x) => stockOf(x) !== 'out') ?? p.variants[0])?.id;
  });
  const v = p.variants.find((x) => x.id === chosenId) ?? p.variants[0];
  const img = p.images?.[0]?.url;
  const several = p.variants.length > 1;
  const price = v ? pricesOf(v) : null;
  const soldOut = !!v && stockOf(v) === 'out';
  return (
    <div className="group relative isolate h-full flex flex-col rounded-2xl bg-card border border-border shadow-card overflow-hidden transition-[box-shadow,border-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-card-hover hover:border-brand/25 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div className="sales-photo relative aspect-[4/3] bg-surface-cream flex items-center justify-center">
        <Photo url={img} icon={30} className={`absolute inset-0 w-full h-full object-contain p-1 transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transition-none ${soldOut ? 'opacity-50' : ''}`} />
        <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-1.5">
          <div className="flex flex-col items-start gap-1 min-w-0">
            {price?.agreed && (
              <span className="inline-flex h-[22px] items-center px-1.5 rounded-md bg-success text-white text-[10.5px] font-bold font-display">{t('biz.cat.agreed')}</span>
            )}
            {p.is_new_arrival && !price?.agreed && (
              <span className="inline-flex h-[22px] items-center px-1.5 rounded-md bg-brand text-white text-[10.5px] font-bold font-display">{t('biz.cat.new')}</span>
            )}
          </div>
          {v && <StockTag v={v} />}
        </div>
        {showShop && (
          <PhotoTag className="absolute bottom-2 left-2 max-w-[calc(100%-3.75rem)] text-gray">
            <Store size={11} strokeWidth={2} className="shrink-0" />
            <span className="truncate">{p.store?.name ?? t('biz.house')}</span>
          </PhotoTag>
        )}
        <div className="absolute bottom-2 right-2 z-10">
          {v && <QtyStepper key={v.id} productId={p.id} size={v} compact />}
        </div>
      </div>

      <div className="flex-1 px-2.5 pt-2 pb-2.5 flex flex-col min-w-0">
        {/* The brand opposite the price (user, 2026-10-31), so no card has a line the others lack. */}
        {(price || p.brand) && (
          <div className="flex items-center justify-between gap-2 min-w-0">
            {price && <span className="shrink-0 text-[16px] font-bold font-display text-brand tabular-nums leading-none">{money(price.pay)}</span>}
            {p.brand && <span className="ml-auto min-w-0 truncate text-[11.5px] font-semibold font-display text-muted">{p.brand}</span>}
          </div>
        )}
        <button
          type="button"
          onClick={onOpen}
          className="mt-1.5 text-left text-[13px] font-semibold font-display text-ink leading-snug line-clamp-2 focus:outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-brand/40"
        >
          {nameOf(p, lang)}
        </button>
        {/* The size, at the foot of every card. The box sits above the name's link, which covers the card (relative z-10). */}
        {v && (
          <div className="mt-auto pt-2">
            {several ? (
              <select
                value={v.id}
                onChange={(e) => setChosenId(e.target.value)}
                aria-label={t('biz.cat.pickSize')}
                className="relative z-10 w-full h-8 pl-2 pr-1 rounded-lg border border-border bg-card text-[12px] font-semibold font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
              >
                {p.variants.map((x) => (
                  <option key={x.id} value={x.id}>
                    {nameOf(x, lang)} · {money(pricesOf(x).pay)}{stockOf(x) === 'out' ? ` · ${t('biz.cat.outOfStock')}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <p className="h-8 px-2 rounded-lg bg-surface-cream flex items-center text-[12px] font-semibold font-display text-gray">
                <span className="truncate">{nameOf(v, lang)}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** A card while it loads: the card's parts, the size row at its foot included. */
export function ProductCardSkeleton() {
  return (
    <div className="h-full flex flex-col rounded-2xl bg-card border border-border shadow-card overflow-hidden">
      <Skeleton className="aspect-[4/3] rounded-none" />
      <div className="flex-1 px-2.5 pt-2 pb-2.5 flex flex-col">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/5" />
        </div>
        <Skeleton className="h-4 w-full mt-2" />
        <Skeleton className="h-8 w-full mt-auto rounded-lg" />
      </div>
    </div>
  );
}

/**
 * The products a query finds, as the grid: the count, the cards, the next page
 * as the end comes into view. `params` is the list's fixed scope and whatever
 * narrows it.
 */
export function ProductResults({ params, narrowed, onReset, showShop, none }: {
  params: Omit<BusinessProductsParams, 'page' | 'limit'>;
  narrowed: boolean;
  onReset: () => void;
  showShop: boolean;
  none: { title: string; body: string; action: { label: string; onClick: () => void } };
}) {
  const t = useBizT();
  const lang = useLanguageStore((s) => s.lang) as Lang;
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useBusinessProductsInfinite({ sort: 'name_asc', ...params, limit: PAGE_SIZE });
  const products = (data?.pages ?? []).flatMap((p) => p.items);
  const total = data?.pages?.[0]?.total ?? 0;

  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) fetchNextPage(); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, products.length]);

  if (isLoading) {
    return <ul className={GRID} aria-busy="true">{Array.from({ length: 12 }).map((_, i) => <li key={i}><ProductCardSkeleton /></li>)}</ul>;
  }
  if (isError && products.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<WifiOff size={28} strokeWidth={1.75} className="text-muted" />}
          title={t('biz.cat.errorTitle')}
          description={t('biz.loadError')}
          action={{ label: t('biz.retry'), onClick: () => { refetch(); } }}
        />
      </Card>
    );
  }
  if (products.length === 0) {
    return (
      <Card>
        {narrowed ? (
          <EmptyState
            icon={<Search size={28} strokeWidth={1.75} className="text-muted" />}
            title={t('biz.cat.emptyTitle')}
            description={t('biz.cat.emptyBody')}
            action={{ label: t('biz.cat.emptyCta'), onClick: onReset }}
          />
        ) : (
          <EmptyState icon={<Package size={28} strokeWidth={1.75} className="text-muted" />} title={none.title} description={none.body} action={none.action} />
        )}
      </Card>
    );
  }
  return (
    <>
      <p className="mb-2.5 px-0.5 text-[12.5px] text-muted tabular-nums">{t('biz.cat.showing', { loaded: products.length, total })}</p>
      <ul className={GRID}>
        {products.map((p) => (
          <li key={p.id} className="min-w-0">
            <ProductCard product={p} lang={lang} showShop={showShop} onOpen={() => navigate(`/business/products/${p.id}`, { state: { fromList: true } })} />
          </li>
        ))}
        {isFetchingNextPage && Array.from({ length: 6 }).map((_, i) => <li key={`more-${i}`}><ProductCardSkeleton /></li>)}
      </ul>
      {hasNextPage ? (
        <div ref={loadMoreRef} className="pt-5 pb-2 flex flex-col items-center gap-2">
          {!isFetchingNextPage ? (
            <button
              type="button"
              onClick={() => fetchNextPage()}
              className="h-10 px-4 rounded-xl border border-border bg-card shadow-card text-[13.5px] font-semibold font-display text-gray hover:border-brand/40 hover:text-brand inline-flex items-center gap-2 transition-colors"
            >
              {t('biz.cat.loadMore')}
            </button>
          ) : (
            <span className="inline-flex items-center gap-2 text-[13px] text-gray">
              <Loader2 size={15} strokeWidth={2.5} className="animate-spin text-brand" />
              {t('biz.cat.loadingMore')}
            </span>
          )}
        </div>
      ) : products.length > PAGE_SIZE && (
        <p className="pt-5 pb-2 text-center text-[12.5px] text-muted">{t('biz.cat.end', { count: total })}</p>
      )}
    </>
  );
}
