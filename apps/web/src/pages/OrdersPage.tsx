import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Package, ChevronRight, Eye, Store, GitBranch } from 'lucide-react';
import { useInfiniteOrders, HOME_GROCERY_PROFILE_PATH } from '@grocery-app/shared';
import type { OrderListItem, OrderStatus } from '@grocery-app/shared';
import { Skeleton } from '@/components/Skeleton';
import InfiniteScroll from '@/components/InfiniteScroll';
import HopBasket from '@/components/home-grocery/HopBasket';
import PlanHistory from '@/components/home-grocery/plan/PlanHistory';
import { PLAN_COPY, WINDOW_TITLES } from '@/components/home-grocery/planCopy';
import { useHomeGroceryShopper } from '@/lib/homeGroceryShopper';
import { useLanguageStore } from '@/stores/languageStore';

const PAGE_SIZE = 24;

const statusStyles: Record<OrderStatus, { color: string; bg: string }> = {
  pending: { color: 'text-muted', bg: 'bg-surface-linen' },
  confirmed: { color: 'text-info', bg: 'bg-info-bg' },
  preparing: { color: 'text-amber-deep', bg: 'bg-amber-mist' },
  on_the_way: { color: 'text-st-orange-fg', bg: 'bg-st-orange-bg' },
  delivered: { color: 'text-brand', bg: 'bg-brand-mist' },
  cancelled: { color: 'text-danger', bg: 'bg-danger-bg' },
  // MV Slice 4 — parent-only derived status (mixed terminal subs). Amber.
  partially_completed: { color: 'text-amber-deep', bg: 'bg-amber-mist' },
  // Out-of-stock at checkout — blocked on stock, not yet an active order.
  draft: { color: 'text-muted', bg: 'bg-surface-linen' },
};

/**
 * A Home Grocery household's Mis pedidos (2026-10-23): its Home Grocery order
 * history — the list on its Home Grocery page, filters, Editar and Repetir —
 * each row opening the order. Every order it places is a Home Grocery one;
 * anything from before it joined is listed under it, the ordinary way.
 */
function HomeGroceryOrders() {
  const navigate = useNavigate();
  const { lang, t } = useLanguageStore();
  const c = PLAN_COPY[lang];
  const earlier = useInfiniteOrders({ limit: 10, home_grocery: 'exclude' });
  // Filtered here as well: an API from before the filter sends every order.
  const others = useMemo(
    () => (earlier.data?.pages.flatMap((p) => p.items) ?? []).filter((o) => !o.rashan_subscription_id),
    [earlier.data],
  );

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-10 py-8">
      <div className="flex items-center gap-2 text-sm font-body text-muted mb-6">
        <button onClick={() => navigate('/')} className="hover:text-brand transition-colors">{t('common.home')}</button>
        <ChevronRight size={14} />
        <span className="text-ink font-semibold">{t('orders.title')}</span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold text-ink font-display">{t('orders.title')}</h1>
          <p className="mt-1.5 text-[14.5px] text-gray font-body max-w-[70ch]">{c.allYourOrders}</p>
        </div>
        <Link to={HOME_GROCERY_PROFILE_PATH}
          className="self-start sm:self-auto shrink-0 min-h-[44px] px-4 rounded-xl border border-border bg-card text-ink text-[14px] font-bold font-display inline-flex items-center gap-2 hover:border-brand/40 transition-colors">
          <HopBasket size={18} className="text-success" /> {c.myPlan}
        </Link>
      </div>

      <PlanHistory lang={lang} heading={false} />

      {others.length > 0 && (
        <section className="mt-10">
          <h2 className="text-[18px] font-bold text-ink font-display">{c.otherOrdersTitle}</h2>
          <p className="text-[13.5px] text-gray font-body">{c.otherOrdersLead}</p>
          <div className="mt-3 flex flex-col divide-y divide-border/60">
            {others.map((order) => <OrderRow key={order.id} order={order} />)}
          </div>
          <InfiniteScroll
            hasMore={!!earlier.hasNextPage}
            isLoading={earlier.isFetchingNextPage}
            onLoadMore={() => earlier.fetchNextPage()}
          />
        </section>
      )}
    </div>
  );
}

export default function OrdersPage() {
  const hg = useHomeGroceryShopper();
  if (hg.loading) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
        <Skeleton className="h-10 w-48 mb-8" />
        <div className="flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      </div>
    );
  }
  return hg.shopper ? <HomeGroceryOrders /> : <AllOrders />;
}

function AllOrders() {
  const navigate = useNavigate();
  const { t } = useLanguageStore();
  const {
    data: ordersData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteOrders({ limit: PAGE_SIZE });
  const orders = useMemo(
    () => ordersData?.pages.flatMap((p) => p.items) ?? [],
    [ordersData],
  );

  if (isLoading) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
        <Skeleton className="h-10 w-48 mb-8" />
        <div className="flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-20 flex flex-col items-center">
        <div className="w-28 h-28 bg-surface-linen rounded-full flex items-center justify-center mb-6">
          <Package size={48} strokeWidth={1.25} className="text-muted" />
        </div>
        <h2 className="text-2xl font-extrabold text-ink font-display text-center mb-2">{t('orders.empty')}</h2>
        <p className="text-sm text-gray font-body text-center mb-8">{t('orders.empty_desc')}</p>
        <button onClick={() => navigate('/')} className="h-12 px-8 bg-brand text-white rounded-xl font-semibold font-display hover:bg-brand-mid transition-colors shadow-md">
          {t('orders.first_order')}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm font-body text-muted mb-6">
        <button onClick={() => navigate('/')} className="hover:text-brand transition-colors">{t('common.home')}</button>
        <ChevronRight size={14} />
        <span className="text-ink font-semibold">{t('orders.title')}</span>
      </div>

      <h1 className="text-3xl font-extrabold text-ink font-display mb-8">{t('orders.title')}</h1>

      {/* Table header (desktop) */}
      <div className="hidden md:grid grid-cols-[1fr_140px_120px_100px_100px] gap-4 px-6 pb-3 text-xs font-semibold text-muted font-display uppercase tracking-wider border-b border-border">
        <span>{t('orders.order_number')}</span>
        <span>{t('orders.date')}</span>
        <span>{t('orders.status')}</span>
        <span className="text-right">{t('cart.total')}</span>
        <span className="text-center">{t('orders.action')}</span>
      </div>

      {/* Orders list */}
      <div className="flex flex-col divide-y divide-border/60">
        {orders.map((order) => <OrderRow key={order.id} order={order} />)}
      </div>

      <InfiniteScroll
        hasMore={!!hasNextPage}
        isLoading={isFetchingNextPage}
        onLoadMore={() => fetchNextPage()}
      />
    </div>
  );
}

/** One order in the list: number, what it is, when, where it stands, what it came to. */
function OrderRow({ order }: { order: OrderListItem }) {
  const navigate = useNavigate();
  const { lang, t } = useLanguageStore();

  // MV Slice 4 — rows come in two shapes:
  //   __shape='parent': a ParentOrder (was a cross-store checkout).
  //     Render a "N stores · M items" subtitle + a small badge that
  //     visually distinguishes it from single-store rows.
  //   __shape='order' (or undefined for old bundles): a solo Order,
  //     including all pre-mv rows. Renders as before + tiny store
  //     name subtitle when store is set.
  // A Home Grocery plan delivery waiting for us is planned, not short
  // of stock; one the household skipped is skipped, not a failure.
  const skipped = !!order.rashan_subscription_id && order.status === 'cancelled' && order.cancelled_reason === 'Skipped';
  const style = skipped ? { color: 'text-gray', bg: 'bg-surface-linen' } : statusStyles[order.status];
  const statusLabel = order.status === 'draft' && order.rashan_subscription_id
    ? t('orders.status.planned')
    : skipped ? t('orders.status.skipped') : t(`orders.status.${order.status}`);
  const date = new Date(order.created_at);
  const itemCount = order._count?.items ?? order.items?.length ?? 0;
  const itemWord = itemCount === 1 ? t('cart.item') : t('cart.items');
  const isParent = order.__shape === 'parent';
  const storeCount = isParent ? (order.sub_orders?.length ?? 0) : 0;
  const storeWord = lang === 'en'
    ? (storeCount === 1 ? 'store' : 'stores')
    : (storeCount === 1 ? 'tienda' : 'tiendas');
  const soloStoreName = !isParent ? (order.store?.name ?? 'Cesto') : null;

  return (
    <div
      className="grid grid-cols-1 md:grid-cols-[1fr_140px_120px_100px_100px] gap-3 md:gap-4 items-center py-5 px-6 hover:bg-surface-linen/30 transition-colors rounded-xl"
    >
      {/* Order info */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-ink font-mono">{order.order_number}</span>
          {isParent && (
            <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded-full bg-brand-mist text-brand text-[10px] font-bold uppercase tracking-wide">
              <GitBranch size={10} strokeWidth={2.25} />
              {storeCount} {storeWord}
            </span>
          )}
          {order.rashan_subscription_id && (
            <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full bg-success-bg text-success text-[11px] font-bold font-ui">
              <HopBasket size={12} />
              {lang === 'en' ? 'Home Grocery' : 'Compra del hogar'}
            </span>
          )}
        </div>
        {/* A Home Grocery order is for a day and a part of the day — the one thing to know at a glance. */}
        {order.rashan_subscription_id && order.scheduled_for && (
          <p className="text-xs text-charcoal font-ui mt-0.5 first-letter:uppercase">
            {new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
              .format(new Date(order.scheduled_for))}
            {order.delivery_window ? `, ${WINDOW_TITLES[order.delivery_window][lang].toLowerCase()}` : ''}
          </p>
        )}
        <p className="text-xs text-muted font-body mt-0.5 flex items-center gap-1.5">
          {soloStoreName && (
            <>
              <Store size={11} strokeWidth={1.75} className="text-muted shrink-0" />
              <span className="truncate">{soloStoreName}</span>
              <span className="opacity-40">·</span>
            </>
          )}
          <span>{itemCount} {itemWord}</span>
        </p>
      </div>

      {/* Date */}
      <span className="text-sm text-gray font-body">
        {date.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
      </span>

      {/* Status */}
      <span className={`inline-flex items-center self-start md:self-center text-xs font-bold rounded-full px-3 py-1.5 ${style.bg} ${style.color} w-fit`}>
        {statusLabel}
      </span>

      {/* Total */}
      <span className="text-base font-bold text-ink font-display text-right">
        €{parseFloat(String(order.total)).toFixed(2)}
      </span>

      {/* Action */}
      <div className="flex justify-center">
        <button
          onClick={() => navigate(`/orders/${order.id}`)}
          className="flex items-center gap-1.5 text-brand text-sm font-semibold font-display hover:underline"
        >
          <Eye size={14} strokeWidth={2} />
          {t('orders.view')}
        </button>
      </div>
    </div>
  );
}
