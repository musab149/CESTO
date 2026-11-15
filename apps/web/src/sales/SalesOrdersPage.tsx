import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, ChevronRight, ChevronDown, Plus, ShoppingCart, SearchX, CornerDownRight } from 'lucide-react';
import { useSalesOrderGroups } from '@grocery-app/shared';
import type { AdminOrderGroup } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import SalesStatusBadge from './components/SalesStatusBadge';
import EmptyState from './components/EmptyState';
import Pagination from './components/Pagination';
import { Avatar, Card, ListSkeleton, PageHeader, SearchInput, Segmented } from './components/ui';
import { money, shortDate, shortTime } from './lib/format';
import { usePortT } from './lib/portT';
import { useSalesT } from './lib/i18n';

const PAGE_SIZE = 20;

/**
 * The columns a row lines up on from xl: client, shop, date, items, status,
 * total, and the way in. Below xl a row is the dashboard's two lines.
 */
const COLS = 'xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,140px)_92px_92px_128px_100px_18px] xl:gap-3 2xl:grid-cols-[minmax(0,1fr)_minmax(0,170px)_110px_100px_150px_110px_18px] 2xl:gap-4';

/**
 * A rep's orders, one row per PURCHASE (redesigned 2026-10-26).
 *
 * A checkout can be stored as several Orders — split by store, and by
 * availability, since an out-of-stock line is routed into its own `draft`
 * sub-order. The server groups them (GET /api/sales/orders?grouped=true, the
 * same function the admin list uses) and a split's parts open under its row.
 *
 * The rows are the dashboard's: who it is for, its number and day, its total
 * and status. On a wide screen they line up into columns so a long list still
 * scans, with sentence-case headings rather than the admin table's capitals.
 * The status filter is a row of chips — the axis a rep actually scans by — and
 * the rider column is gone: the order itself says who is carrying it.
 *
 * No delete and no invoice download: neither endpoint exists under
 * /api/sales/* (see routes/sales/orders.ts).
 */
export default function SalesOrdersPage() {
  const navigate = useNavigate();
  const t = usePortT();
  const salesT = useSalesT();
  const lang = useLanguageStore((s) => s.lang);
  const [searchParams, setSearchParams] = useSearchParams();
  // In the URL so a filter is linkable and survives a reload.
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? 'all');
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '');
  // Split purchases whose parts are showing. Not persisted: a new filter or
  // page starts collapsed rather than re-opening rows from another result set.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const STATUS_OPTIONS = [
    { value: 'all', label: t('orders.filter.all') },
    { value: 'pending', label: t('orders.filter.pending') },
    { value: 'confirmed', label: t('orders.filter.confirmed') },
    { value: 'preparing', label: t('orders.filter.preparing') },
    { value: 'on_the_way', label: t('orders.filter.on_the_way') },
    { value: 'delivered', label: t('orders.filter.delivered') },
    { value: 'cancelled', label: t('orders.filter.cancelled') },
    { value: 'draft', label: t('orders.filter.draft') },
  ];

  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  // No `source` or `customerType`: the server scopes this to the rep, and
  // every order it can return is one they built.
  const { data, isLoading, isFetching, refetch } = useSalesOrderGroups({
    status: statusFilter === 'all' ? undefined : statusFilter,
    q: searchQuery.trim() || undefined,
    page,
    limit: PAGE_SIZE,
  });
  const groups = data?.items ?? [];
  const filtered = statusFilter !== 'all' || searchQuery.trim() !== '';

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** `null` is the Cesto house store, the same convention as Product.store_id. */
  function storeLabel(group: AdminOrderGroup): string {
    if (group.stores.length > 1) return t('orders.storeCount', { count: group.stores.length });
    return group.stores[0]?.name ?? 'Cesto';
  }

  function setPage(nextPage: number) {
    const next = new URLSearchParams(searchParams);
    if (nextPage <= 1) next.delete('page');
    else next.set('page', String(nextPage));
    setSearchParams(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    const params = new URLSearchParams(searchParams);
    if (value === 'all') params.delete('status');
    else params.set('status', value);
    params.delete('page');
    setSearchParams(params, { replace: true });
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    const params = new URLSearchParams(searchParams);
    if (!value.trim()) params.delete('q');
    else params.set('q', value);
    params.delete('page');
    setSearchParams(params, { replace: true });
  };

  const clearFilters = () => {
    setStatusFilter('all');
    setSearchQuery('');
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const items = (n: number) => salesT(n === 1 ? 'sales.orders.items_one' : 'sales.orders.items_other', { count: n });

  return (
    <div>
      <PageHeader
        title={t('orders.title')}
        count={data?.total}
        subtitle={salesT('sales.orders.subtitle')}
        actions={(
          <>
            <button
              type="button"
              onClick={() => refetch()}
              aria-label={t('orders.refresh')}
              title={t('orders.refresh')}
              className="h-11 w-11 rounded-xl border border-border bg-card text-gray shadow-card hover:text-ink hover:border-ink/20 transition-colors inline-flex items-center justify-center"
            >
              <RefreshCw size={17} strokeWidth={1.75} className={isFetching && !isLoading ? 'animate-spin' : ''} />
            </button>
            {/* A phone has it as the tab bar's middle button. */}
            <button
              type="button"
              onClick={() => navigate('/sales/orders/new')}
              className="hidden lg:inline-flex h-11 px-4 rounded-xl text-sm font-semibold font-display bg-brand text-white hover:bg-brand-mid transition-colors items-center gap-2"
            >
              <Plus size={17} strokeWidth={2.25} />
              {salesT('sales.orders.new')}
            </button>
          </>
        )}
      />

      {/* One card: its filters in its own header, then the table. */}
      <Card className="overflow-hidden">
        <div className="px-3 sm:px-4 py-3 border-b border-border flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
          <SearchInput
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder={t('orders.searchPlaceholder')}
            className="xl:order-last xl:w-[300px] 2xl:w-[340px] shrink-0"
          />
          <Segmented
            label={salesT('sales.orders.statusFilter')}
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={handleStatusChange}
          />
        </div>

      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : groups.length === 0 ? (
        <>
          {filtered ? (
            <EmptyState
              icon={<SearchX size={28} strokeWidth={1.75} className="text-muted" />}
              title={t('orders.noResults')}
              description={t('orders.noResultsHint')}
              action={{ label: salesT('sales.orders.clearFilters'), onClick: clearFilters }}
            />
          ) : (
            <EmptyState
              icon={<ShoppingCart size={28} strokeWidth={1.75} className="text-muted" />}
              title={salesT('sales.today.noneYet')}
              description={salesT('sales.today.noneYetBody')}
              action={{ label: salesT('sales.today.startFirst'), onClick: () => navigate('/sales/orders/new') }}
            />
          )}
        </>
      ) : (
        <>
          <div className={`hidden ${COLS} px-5 h-10 items-center border-b border-border bg-surface-cream text-[12px] font-semibold font-display text-muted`}>
            <span>{t('orders.table.customer')}</span>
            <span>{t('orders.table.store')}</span>
            <span>{t('orders.table.date')}</span>
            <span>{t('orders.table.items')}</span>
            <span>{t('orders.table.status')}</span>
            <span className="text-right">{t('orders.table.total')}</span>
            <span />
          </div>
          <ul className="divide-y divide-border/80">
            {groups.map((group) => {
              const parts = group.sub_orders;
              const isSplit = parts.length > 1;
              const isOpen = expanded.has(group.id);
              const who = group.user?.company || group.user?.name || '—';
              const partsLabel = t('orders.partsCount', { count: parts.length });
              return (
                <li key={group.id}>
                  {/* The client's name is the link and stretches over the
                      whole row; the parts toggle sits above it. */}
                  <div className={`relative px-4 xl:px-5 py-3 min-h-[72px] flex items-center gap-3 ${COLS} xl:items-center hover:bg-surface-cream transition-colors`}>
                    <span className="min-w-0 flex-1 flex items-center gap-3">
                      <Avatar name={who} business={!!group.user?.company} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 min-w-0">
                          <button
                            type="button"
                            onClick={() => navigate(`/sales/orders/${group.id}`)}
                            className="min-w-0 truncate text-left text-[15px] font-semibold font-display text-ink focus:outline-none after:absolute after:inset-0 after:rounded-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-brand/40"
                          >
                            {who}
                          </button>
                          {isSplit && (
                            <>
                              <span className="xl:hidden inline-flex items-center h-5 px-1.5 rounded-full bg-brand-mist text-brand text-[10.5px] font-semibold font-display shrink-0" title={t('orders.partsHint')}>
                                {partsLabel}
                              </span>
                              <button
                                type="button"
                                onClick={() => toggleExpanded(group.id)}
                                aria-expanded={isOpen}
                                aria-label={t('orders.togglePartsAria', { orderNumber: group.order_number })}
                                title={t('orders.partsHint')}
                                className="hidden xl:inline-flex relative z-10 items-center gap-0.5 h-6 pl-2 pr-1 rounded-full bg-brand-mist text-brand text-[11px] font-semibold font-display shrink-0 hover:bg-brand hover:text-white transition-colors"
                              >
                                {partsLabel}
                                <ChevronDown size={14} strokeWidth={2} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                              </button>
                            </>
                          )}
                        </span>
                        <span className="block text-[12.5px] text-muted truncate mt-0.5">
                          <span className="font-mono text-[12px]">{group.order_number}</span>
                          <span className="xl:hidden">
                            <span aria-hidden="true">{'  •  '}</span>
                            {shortDate(group.created_at, lang)}
                          </span>
                        </span>
                      </span>
                    </span>

                    <span className="hidden xl:block min-w-0 truncate text-[14px] text-ink/80">{storeLabel(group)}</span>
                    <span className="hidden xl:block text-[14px] text-ink/80 leading-tight">
                      {shortDate(group.created_at, lang)}
                      <span className="block text-[12px] text-muted mt-0.5 tabular-nums">{shortTime(group.created_at, lang)}</span>
                    </span>
                    <span className="hidden xl:block text-[14px] text-gray">{items(group.item_count)}</span>
                    <span className="hidden xl:block"><SalesStatusBadge status={group.status} /></span>
                    <span className="hidden xl:block text-right text-[15px] font-bold font-display text-ink tabular-nums">{money(group.total)}</span>

                    <span className="xl:hidden shrink-0 flex flex-col items-end gap-1">
                      <span className="text-[15px] font-bold font-display text-ink tabular-nums">{money(group.total)}</span>
                      <SalesStatusBadge status={group.status} />
                    </span>
                    <ChevronRight size={18} strokeWidth={1.75} className="hidden sm:block text-muted shrink-0" />
                  </div>

                  {/* The parts, under their purchase, in the same columns. */}
                  {isSplit && isOpen && (
                    <ul className="hidden xl:block bg-surface-cream/70 border-t border-border/60 divide-y divide-border/60">
                      {parts.map((part) => (
                        <li key={part.id} className={`relative px-5 py-2.5 ${COLS} items-center hover:bg-brand-mist/30 transition-colors`}>
                          <span className="min-w-0 flex items-center gap-2 pl-[52px]">
                            <CornerDownRight size={15} strokeWidth={1.75} className="text-muted shrink-0" />
                            <button
                              type="button"
                              onClick={() => navigate(`/sales/orders/${part.id}`)}
                              className="min-w-0 truncate text-left text-[13px] text-ink focus:outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-brand/40"
                            >
                              <span className="font-display font-semibold">{salesT('sales.orders.part')}</span>
                              <span className="font-mono text-[12px] text-muted ml-2">{part.order_number}</span>
                            </button>
                          </span>
                          <span className="min-w-0 truncate text-[13px] text-ink/80">{part.store?.name ?? 'Cesto'}</span>
                          <span />
                          <span className="text-[13px] text-gray">{items(part._count?.items ?? 0)}</span>
                          <span><SalesStatusBadge status={part.status} /></span>
                          <span className="text-right text-[13.5px] font-semibold font-display text-ink/80 tabular-nums">{money(part.total)}</span>
                          <ChevronRight size={16} strokeWidth={1.75} className="text-muted" />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      </Card>

      {!isLoading && data && (
        <Pagination
          page={page}
          totalPages={data.totalPages ?? 1}
          onPageChange={setPage}
          totalItems={data.total}
          pageSize={PAGE_SIZE}
          className="mt-3"
        />
      )}
    </div>
  );
}
