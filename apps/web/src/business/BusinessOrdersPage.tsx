import { useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { History, Receipt, ShoppingCart, Truck, WifiOff } from 'lucide-react';
import { useBusinessMe, useOrders } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useCartStore } from '@/stores/cartStore';
import { Card, PageHeader } from '@/sales/components/ui';
import EmptyState from '@/sales/components/EmptyState';
import Pagination from '@/sales/components/Pagination';
import { ListSkeleton } from '@/sales/components/ui';
import { StatsCard } from '@/sales/components/StatsCard';
import { money, shortDate } from '@/sales/lib/format';
import { useSalesT } from '@/sales/lib/i18n';
import { useBizT } from './lib/i18n';
import { MonthSpendCard, TintCard } from './components/MoneyCards';
import OrderRow from './components/OrderRow';

/**
 * Every order the business has placed (2026-10-29, user: "We will be showing
 * my complete orders history that I placed and every thing related to the
 * orders") — and the ones a rep built for it, since it is the buyer of those
 * too. The customer order list (GET /api/orders), a purchase split across
 * shops as one row; filtered by status, a page at a time, both in the URL.
 *
 * Above it, the figures that used to open the home (2026-10-31, user: "the
 * content like stat cards and stuff will go on orders page", with a mockup):
 * this month's purchases, what is on its way, the cart, and since the start —
 * orders and delivered, which filter the list below and bring it into view.
 *
 *   ┌── bought this month ──┐┌ in progress ┐┌ cart ┐┌ since the start: orders │ delivered ┐   (xl)
 */

const PAGE = 15;
const STATUSES = ['', 'pending', 'confirmed', 'preparing', 'on_the_way', 'delivered', 'cancelled'] as const;

export default function BusinessOrdersPage() {
  const t = useBizT();
  const salesT = useSalesT();
  const lang = useLanguageStore((s) => s.lang) as 'es' | 'en';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status') ?? '';
  const status = (STATUSES as readonly string[]).includes(statusParam) ? statusParam : '';
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const { data, isLoading, isError, refetch } = useOrders({ status: status || undefined, page, limit: PAGE });
  const { data: me, isLoading: meLoading } = useBusinessMe();
  const cartLines = useCartStore((s) => s.items.length);
  const listRef = useRef<HTMLDivElement>(null);
  const stats = me?.stats;
  const business = me?.business;

  const set = (next: { status?: string; page?: number }) => {
    const p = new URLSearchParams(params);
    if (next.status !== undefined) { if (next.status) p.set('status', next.status); else p.delete('status'); p.delete('page'); }
    if (next.page !== undefined) { if (next.page > 1) p.set('page', String(next.page)); else p.delete('page'); }
    setParams(p, { replace: next.page === undefined });
    if (next.page !== undefined) listRef.current?.scrollIntoView({ block: 'start' });
  };
  /** A figure's tile: the list below, filtered to it, brought into view. */
  const show = (next: string) => {
    set({ status: next });
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-12 gap-3 md:gap-3.5 2xl:gap-4 mb-6 lg:mb-7">
        <MonthSpendCard
          className="col-span-2 md:col-span-6 xl:col-span-4"
          spent={stats?.this_month.spent ?? 0}
          orders={stats?.this_month.orders ?? 0}
          loading={meLoading}
        />
        <TintCard
          className="md:col-span-3 xl:col-span-2"
          tone="orange"
          icon={Truck}
          label={t('biz.stats.inProgress')}
          value={String(stats?.in_progress ?? 0)}
          sub={t('biz.stats.inProgressSub')}
          loading={meLoading}
        />
        <TintCard
          className="md:col-span-3 xl:col-span-2"
          tone="green"
          icon={ShoppingCart}
          label={t('biz.stats.cart')}
          value={String(cartLines)}
          sub={cartLines > 0 ? t('biz.stats.cartToOrder') : t('biz.stats.cartEmptySub')}
          loading={false}
          onClick={() => navigate(cartLines > 0 ? '/business/cart' : '/business/catalogue')}
        />
        <StatsCard
          className="col-span-2 md:col-span-12 xl:col-span-4"
          label={t('biz.stats.countsLabel')}
          loading={meLoading}
          groups={[{
            key: 'all',
            title: t('biz.stats.groupAll'),
            icon: History,
            note: business?.approved_at ? t('biz.stats.since', { date: shortDate(business.approved_at, lang) }) : t('biz.stats.sinceStart'),
            items: [
              { key: 'orders', tone: 'violet', label: t('biz.stats.countOrders'), value: String(stats?.all_time.orders ?? 0), sub: t('biz.stats.allSpent', { amount: money(stats?.all_time.spent ?? 0) }), onClick: () => show('') },
              { key: 'delivered', tone: 'sky', label: t('biz.stats.countDelivered'), value: String(stats?.delivered ?? 0), sub: t('biz.stats.deliveredSub'), onClick: () => show('delivered') },
            ],
          }]}
        />
      </div>

      <div ref={listRef} className="scroll-mt-20">
        <PageHeader title={t('biz.orders.title')} count={data?.total} subtitle={t('biz.orders.subtitle')} />

        <div className="-mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 mb-3 overflow-x-auto hide-scrollbar">
          <div role="group" aria-label={t('biz.orders.filter')} className="flex items-center gap-1.5 min-w-max">
            {STATUSES.map((s) => {
              const on = s === status;
              return (
                <button
                  key={s || 'all'}
                  type="button"
                  onClick={() => set({ status: s })}
                  aria-pressed={on}
                  className={`h-9 px-3.5 rounded-full border text-[13px] font-semibold font-display whitespace-nowrap transition-colors ${
                    on ? 'bg-brand text-white border-brand' : 'bg-card border-border text-gray hover:text-ink hover:border-ink/20'
                  }`}
                >
                  {s ? salesT(`sales.status.${s}`) : t('biz.orders.all')}
                </button>
              );
            })}
          </div>
        </div>

        <Card className="overflow-hidden">
          {isLoading ? (
            <ListSkeleton rows={6} />
          ) : isError && !data ? (
            <EmptyState
              icon={<WifiOff size={28} strokeWidth={1.75} className="text-muted" />}
              title={t('biz.orders.errorTitle')}
              description={t('biz.loadError')}
              action={{ label: t('biz.retry'), onClick: () => { refetch(); } }}
            />
          ) : (data?.items.length ?? 0) === 0 ? (
            status ? (
              <EmptyState
                icon={<Receipt size={28} strokeWidth={1.75} className="text-muted" />}
                title={t('biz.orders.noneWithStatus')}
                description={t('biz.orders.noneWithStatusBody')}
                action={{ label: t('biz.orders.seeAll'), onClick: () => set({ status: '' }) }}
              />
            ) : (
              <EmptyState
                icon={<Receipt size={28} strokeWidth={1.75} className="text-muted" />}
                title={t('biz.orders.noneYet')}
                description={t('biz.orders.noneYetBody')}
                action={{ label: t('biz.orders.startFirst'), onClick: () => navigate('/business/catalogue') }}
              />
            )
          ) : (
            <ul className="divide-y divide-border">
              {data!.items.map((o) => (
                <li key={o.id}><OrderRow order={o} lang={lang} onOpen={() => navigate(`/business/orders/${o.id}`)} /></li>
              ))}
            </ul>
          )}
        </Card>

        {(data?.totalPages ?? 1) > 1 && (
          <Pagination
            className="mt-4"
            page={page}
            totalPages={data!.totalPages}
            onPageChange={(p) => set({ page: p })}
            totalItems={data!.total}
            pageSize={PAGE}
          />
        )}
      </div>
    </div>
  );
}
