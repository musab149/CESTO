import { Fragment, useRef, useState } from 'react';
import { useActiveTabInView } from '@/lib/useActiveTabInView';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, RefreshCw, Eye, FileDown, Loader2, Filter, Truck, Store, Trash2, ChevronRight, ChevronDown, ShoppingBasket, UserRound, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAdminOrderGroups, useAdminSalesRep, useAdminSettings, useDeleteOrder, adminOrders, deliveryFeeIsPending } from '@grocery-app/shared';
import QuotationsPage from './QuotationsPage';
import type { AdminOrderSource, AdminCustomerType } from '@grocery-app/shared';
import { downloadOrderInvoice } from '@grocery-app/shared/invoice';
import type { OrderStatus, AdminOrderGroup } from '@grocery-app/shared';
import StatusBadge from '@/components/StatusBadge';
import { PlanDeliveryStatus } from '@/components/home-grocery-plan/PlanDeliveries';
import { planDate } from '@/components/home-grocery-plan/planFormat';
import { TableSkeleton } from '@/components/Skeleton';
import Pagination from '@/components/Pagination';
import DeleteOrderModal from '@/components/DeleteOrderModal';
import { useToast } from '@/components/Toast';
import { buildInvoiceLabels } from '@/lib/invoiceLabels';

const PAGE_SIZE = 20;

/**
 * One row per customer purchase, not per Order row.
 *
 * A checkout can be stored as several Orders — split by store, and also by
 * availability, since an out-of-stock item is routed into its own `draft`
 * sub-order even when the cart never left one shop. This list used to render
 * those raw rows, so a single purchase appeared two or three times with
 * different numbers and part-totals, tied together only by a chip that was
 * hidden unless VITE_MV_ORDER_SPLIT happened to be set in the bundle.
 *
 * The server now groups them (GET /api/admin/orders?grouped=true) and the
 * parts live inside the row, one click away. The old flag is gone with the
 * chip: grouping is not a feature to switch on, it is what the data means.
 */


function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * An order still waiting for its delivery fee — every customer order arrives
 * without one (2026-10-23) — while the fee can still be set. A delivered or
 * cancelled one is past it, and a draft has nothing to deliver yet.
 */
function needsFee(group: { status: string; delivery_fee?: number | string | null }): boolean {
  if (group.delivery_fee == null) return false; // an older API
  return ['pending', 'confirmed', 'preparing'].includes(group.status) && deliveryFeeIsPending({ delivery_fee: group.delivery_fee });
}

function formatCurrency(amount: number): string {
  return amount.toFixed(2).replace('.', ',') + ' €';
}

/**
 * Which slice of the order book a tab shows.
 *
 * THE FIRST THREE ARE THE BOOKS. They split on who the order is FOR and who
 * placed it, and every order is in exactly one of them:
 *
 *     Daily Order      the shopper placed it themselves, retail
 *     Home Grocery     we built it for them, retail — the rashan trade
 *     Cesto Wholesale  a wholesale account, however it was placed
 *
 * CESTO SALESMAN IS NOT A FOURTH BOOK. It asks a different question — who
 * made this — and it asks it across all three, so a rep's orders appear
 * twice: in the book they belong to, and here. That is the point of it. A
 * rep's retail order is Home Grocery AND Cesto Salesman; their wholesale
 * order is Cesto Wholesale AND Cesto Salesman. The tab counts therefore do
 * NOT add up to All, and should not be made to.
 *
 * It used to be a fourth quadrant, meaning "wholesale, built in the panel",
 * from before sales reps existed and "our salesman" meant an admin keying in
 * a wholesale order. Those orders are wholesale orders and now sit in Cesto
 * Wholesale with the rest — which is why that tab no longer asks who placed
 * it. Nothing was orphaned by the change; the one such order on production
 * moved from this tab to that one.
 */
const BOOKS: Array<{
  key: string;
  labelKey: string;
  fallback: string;
  source?: AdminOrderSource;
  customerType?: AdminCustomerType;
}> = [
  { key: 'all',        labelKey: 'orders.books.all',       fallback: 'All' },
  { key: 'customer',   labelKey: 'orders.books.customer',  fallback: 'Customer',   source: 'customer', customerType: 'retail' },
  { key: 'rashan',     labelKey: 'orders.books.rashan',    fallback: 'Rashan',     source: 'admin',    customerType: 'retail' },
  // Every wholesale order, keyed in or placed online. No `source`.
  { key: 'b2b-online', labelKey: 'orders.books.b2bOnline', fallback: 'Cesto Wholesale', customerType: 'b2b' },
  // Every order a REP built, retail or wholesale. No `customerType` — it
  // cuts across the books above rather than dividing them.
  { key: 'b2b-rep',    labelKey: 'orders.books.b2bRep',    fallback: 'Cesto Salesman', source: 'sales_rep' },
  // Not an order book at all: a quotation is a request for a price, with no
  // lines and no total yet. It is here because it is the start of the same
  // pipeline, and it renders its own table rather than pretending otherwise.
  { key: 'quotations', labelKey: 'orders.books.quotations', fallback: 'B2B Quotation' },
];

/**
 * One order page, with the books as tabs over the same table.
 *
 * They were three routes in three different sidebar sections, which meant
 * answering "where is this order" required knowing who had placed it before
 * you could go looking. Same rows, same columns, same filters and actions
 * either way — the only thing that differed was a `where` clause, which is a
 * tab, not a page.
 */
export default function OrdersPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  // In the URL so a tab is linkable and survives a reload — the same reason
  // status and the search term live there.
  const bookKey = searchParams.get('book') ?? 'all';
  const book = BOOKS.find((b) => b.key === bookKey) ?? BOOKS[0];
  const bookStrip = useRef<HTMLDivElement>(null);
  useActiveTabInView(bookStrip, book.key);
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? 'all');
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '');
  // One sales rep's orders — their profile's "view all", which shows only the
  // latest ten — from the start of the range it was showing, when it had one.
  const repFilter = searchParams.get('rep') ?? undefined;
  const sinceFilter = searchParams.get('from') ?? undefined;
  const { data: repShown } = useAdminSalesRep(repFilter);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; order_number: string; status: string } | null>(null);
  // Group ids whose parts are showing. Deliberately not persisted: a filter
  // change or a new page should start collapsed rather than re-open rows the
  // admin expanded minutes ago on a different result set.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const deleteOrder = useDeleteOrder();

  // Cached by react-query — shared with SettingsPage's own useAdminSettings()
  // call, so this doesn't add a request per invoice download.
  const { data: storeSettings } = useAdminSettings();

  function onConfirmDelete({ reason }: { reason?: string }) {
    if (!deleteTarget) return;
    deleteOrder.mutate(
      { id: deleteTarget.id, reason },
      {
        onSuccess: () => {
          toast.success(t('orderDetail.deleteSuccessTitle'), t('orderDetail.deleteSuccessBody', { orderNumber: deleteTarget.order_number }));
          setDeleteTarget(null);
        },
        // Modal stays open on failure so admin can see the error and retry.
      },
    );
  }

  async function handleDownloadInvoice(orderId: string, orderNumber: string) {
    setDownloadingId(orderId);
    try {
      const full = await adminOrders.get(orderId);
      // MV Slice 4 — a sub-order that belongs to a partner store shows that
      // store as the invoice's seller (matches what the partner panel's own
      // invoice does); house orders (store === null) fall back to Cesto.
      const storeName = (full as any).store?.name ?? storeSettings?.storeName ?? 'Cesto';
      await downloadOrderInvoice({
        order: full as any,
        settings: {
          storeName,
          address: storeSettings?.address ?? '',
          contactEmail: storeSettings?.contactEmail ?? '',
          contactPhone: storeSettings?.contactPhone ?? '',
        },
        labels: buildInvoiceLabels(t),
        lang: i18n.language,
      });
    } catch (err) {
      toast.error(
        t('orders.invoiceFailedTitle'),
        err instanceof Error ? err.message : t('orders.invoiceFailedBody', { orderNumber }),
      );
    } finally {
      setDownloadingId(null);
    }
  }

  const STATUS_OPTIONS: { value: string; label: string }[] = [
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
  const { data, isLoading, refetch } = useAdminOrderGroups({
    status: statusFilter === 'all' ? undefined : (statusFilter as OrderStatus),
    q: searchQuery.trim() || undefined,
    source: book.source,
    customerType: book.customerType,
    salesRepId: repFilter,
    from: sinceFilter ? `${sinceFilter}T00:00:00.000Z` : undefined,
    page,
    limit: PAGE_SIZE,
  });
  const groups = data?.items ?? [];

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

  const handleBookChange = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value === 'all') params.delete('book');
    else params.set('book', value);
    // Page and expanded rows belong to the previous result set.
    params.delete('page');
    setSearchParams(params, { replace: true });
    setExpanded(new Set());
  };

  const clearRepFilter = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('rep');
    params.delete('from');
    params.delete('page');
    setSearchParams(params, { replace: true });
    setExpanded(new Set());
  };

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

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          {/* The count stays ON the title row, so the subtitle below is not
              pushed out of line by it. */}
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold font-display text-ink">{t('orders.title')}</h1>
            <span className="inline-flex items-center justify-center h-6 min-w-[24px] px-2 rounded-full bg-brand-mist text-brand text-xs font-bold font-display">
              {data?.total ?? groups.length}
            </span>
          </div>
          <p className="text-sm text-muted mt-1">
            {t('orders.subtitle', 'Orders placed by customers and built by your team')}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="h-10 px-4 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors inline-flex items-center gap-2"
        >
          <RefreshCw size={16} strokeWidth={1.75} />
          {t('orders.refresh')}
        </button>
      </div>

      {/* The books, as tabs — plus Cesto Salesman, which overlaps them by
          design and is not a book at all. See BOOKS. */}
      <div ref={bookStrip} className="tab-strip flex flex-wrap items-center gap-1 mb-5 border-b border-border">
        {BOOKS.map((b) => (
          <button
            key={b.key}
            type="button"
            data-active={book.key === b.key}
            onClick={() => handleBookChange(b.key)}
            className={`relative -mb-px px-4 h-10 text-sm font-semibold font-display transition ${
              book.key === b.key
                ? 'text-brand border-b-2 border-brand'
                : 'text-muted hover:text-ink border-b-2 border-transparent'
            }`}
          >
            {t(b.labelKey, b.fallback)}
          </button>
        ))}
      </div>

      {book.key === 'quotations' ? <QuotationsPage /> : (
      <>
      {/* Says the list is narrowed, and undoes it in one tap. */}
      {repFilter && (
        <div className="mb-4 inline-flex max-w-full items-center gap-2 min-h-9 pl-3 pr-1 py-1 rounded-full bg-brand-mist text-brand text-sm font-semibold font-display">
          <UserRound size={15} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate">
            {t('orders.repFilter', 'Orders built by {{name}}', { name: repShown?.name ?? '…' })}
            {sinceFilter && ` · ${t('orders.repFilterSince', 'since {{date}}', {
              date: new Date(`${sinceFilter}T00:00:00`).toLocaleDateString(i18n.language === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short', year: 'numeric' }),
            })}`}
          </span>
          <button
            type="button"
            onClick={clearRepFilter}
            aria-label={t('orders.repFilterClear', 'Show every order')}
            className="w-7 h-7 rounded-full hover:bg-card flex items-center justify-center shrink-0"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative">
          <Filter size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="h-10 bg-surface-cream border border-border rounded-lg pl-9 pr-8 text-sm font-display text-ink appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand/30"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t('orders.searchPlaceholder')}
            className="w-full h-10 bg-surface-cream border border-border rounded-lg pl-9 pr-3 text-sm font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={8} />
      ) : groups.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <p className="text-muted font-display text-sm mb-1">{t('orders.noResults')}</p>
          <p className="text-muted/60 font-body text-xs">{t('orders.noResultsHint')}</p>
        </div>
      ) : (
        <>
        {/* A nine-column table at 880px minimum is a sideways scroll on every
            phone, and the columns that scroll away are the total, the status
            and the date — the three anyone is scanning this list for. The
            same rows read downward below sm.

            Split purchases do not expand here: the parts live one tap away on
            the order itself, and a disclosure control inside a row that is
            already a link is two targets fighting for the same thumb. */}
        <ul className="sm:hidden bg-card rounded-xl border border-border divide-y divide-border overflow-hidden">
          {groups.map((group) => (
            <li key={group.id}>
              <button
                type="button"
                onClick={() => navigate(`/orders/${group.id}`)}
                className="w-full text-left px-4 py-3 hover:bg-brand-mist/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-ink truncate">{group.order_number}</span>
                  {group.sub_orders.length > 1 && (
                    <span className="inline-flex items-center h-5 px-1.5 rounded-full bg-brand-mist text-brand text-[11px] font-semibold shrink-0">
                      {t('orders.partsCount', { count: group.sub_orders.length })}
                    </span>
                  )}
                  <span className="ml-auto text-sm font-semibold text-ink tabular-nums shrink-0 text-right">
                    {formatCurrency(Number(group.total))}
                    {needsFee(group) && (
                      <span className="block text-[11px] font-semibold text-warning">{t('orders.feeToSet', 'Delivery to set')}</span>
                    )}
                  </span>
                </div>

                <p className="text-[13px] text-gray truncate mt-0.5">
                  {group.user?.name ?? '\u2014'}
                  {group.built_by && (
                    <span className="text-muted">
                      {'  \u00b7  '}
                      {t('orders.table.via', 'via {{who}}', { who: group.built_by.name })}
                    </span>
                  )}
                </p>

                <div className="flex items-center gap-2 mt-1.5">
                  {group.plan
                    ? <PlanDeliveryStatus status={group.status as PlanRowStatus} cancelledReason={group.plan.skipped ? 'Skipped' : null} />
                    : <StatusBadge status={group.status} />}
                  {group.plan && <PlanTag day={group.plan.scheduled_for} />}
                  <span className="text-[11.5px] text-muted ml-auto shrink-0">{formatDate(group.created_at)}</span>
                </div>

                <div className="flex items-center gap-3 mt-1.5 text-[11.5px] text-muted">
                  <span className="inline-flex items-center gap-1 min-w-0">
                    <Store size={12} strokeWidth={1.75} className="shrink-0" />
                    <span className="truncate">{storeLabel(group)}</span>
                  </span>
                  {group.rider ? (
                    <span className="inline-flex items-center gap-1 min-w-0">
                      <Truck size={12} strokeWidth={1.75} className="shrink-0 text-brand" />
                      <span className="truncate">{group.rider.name}</span>
                    </span>
                  ) : group.rider_count > 1 ? (
                    <span className="inline-flex items-center gap-1">
                      <Truck size={12} strokeWidth={1.75} className="shrink-0" />
                      {t('orders.riderCount', { count: group.rider_count })}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 italic">
                      <Truck size={12} strokeWidth={1.75} className="shrink-0" />
                      {t('orders.table.unassigned')}
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>

        <div className="hidden sm:block bg-card rounded-xl border border-border overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[880px]">
            <thead>
              <tr className="bg-surface-cream">
                {[
                  t('orders.table.orderNumber'),
                  t('orders.table.customer'),
                  t('orders.table.store'),
                  t('orders.table.items'),
                  t('orders.table.total'),
                  t('orders.table.status'),
                  t('orders.table.rider'),
                  t('orders.table.date'),
                  t('orders.table.actions'),
                ].map((header) => (
                  <th key={header} className="px-4 py-3 text-left text-xs font-semibold font-display text-gray uppercase tracking-wider">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                // A purchase stored as several Orders. One sub means there is
                // nothing to expand — the row IS the order, as it always was.
                const parts = group.sub_orders;
                const isSplit = parts.length > 1;
                const isOpen = expanded.has(group.id);
                return (
                  <Fragment key={group.id}>
                    <tr
                      onClick={() => navigate(`/orders/${group.id}`)}
                      className="border-t border-border hover:bg-brand-mist/30 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 text-sm font-mono text-ink whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {isSplit ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); toggleExpanded(group.id); }}
                              className="p-0.5 -ml-1 rounded text-muted hover:text-ink hover:bg-surface-linen transition-colors"
                              aria-expanded={isOpen}
                              aria-label={t('orders.togglePartsAria', { orderNumber: group.order_number })}
                            >
                              {isOpen
                                ? <ChevronDown size={16} strokeWidth={1.75} />
                                : <ChevronRight size={16} strokeWidth={1.75} />}
                            </button>
                          ) : (
                            <span className="w-[22px]" aria-hidden="true" />
                          )}
                          {group.order_number}
                          {isSplit && (
                            <span
                              className="inline-flex items-center h-5 px-1.5 rounded-full bg-brand-mist text-brand text-[11px] font-semibold font-display"
                              title={t('orders.partsHint')}
                            >
                              {t('orders.partsCount', { count: parts.length })}
                            </span>
                          )}
                        </div>
                      </td>
                      {/* Under the client's name, not in a tenth column:
                          this table is already 880px of minimum width, and
                          "for whom, via whom" reads as one fact anyway. The
                          books say THAT a rep built it; this says which. */}
                      <td className="px-4 py-3 text-sm font-display text-ink">
                        {group.user?.name ?? '—'}
                        {group.plan ? (
                          <span className="block mt-0.5"><PlanTag day={group.plan.scheduled_for} /></span>
                        ) : group.built_by && (
                          <span className="block text-xs font-normal text-muted truncate">
                            {t('orders.table.via', 'via {{who}}', { who: group.built_by.name })}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-display whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 text-ink/80">
                          <Store size={13} strokeWidth={1.75} className="text-muted" />
                          {storeLabel(group)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-display text-gray text-center">{group.item_count}</td>
                      {/* The whole purchase's total — the parent's, not one part's. */}
                      <td className="px-4 py-3 text-sm font-display font-semibold text-ink whitespace-nowrap">
                        {formatCurrency(Number(group.total))}
                        {needsFee(group) && (
                          <span className="block text-[11px] font-semibold text-warning">{t('orders.feeToSet', 'Delivery to set')}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {group.plan
                          ? <PlanDeliveryStatus status={group.status as PlanRowStatus} cancelledReason={group.plan.skipped ? 'Skipped' : null} />
                          : <StatusBadge status={group.status} />}
                      </td>
                      <td className="px-4 py-3 text-sm font-display whitespace-nowrap">
                        {group.rider ? (
                          <span className="inline-flex items-center gap-1.5 text-ink">
                            <Truck size={14} strokeWidth={1.75} className="text-brand" />
                            {group.rider.name}
                          </span>
                        ) : group.rider_count > 1 ? (
                          // Each part can go out with its own rider; naming one
                          // of them here would be wrong for the others.
                          <span className="inline-flex items-center gap-1.5 text-ink/70 text-xs">
                            <Truck size={14} strokeWidth={1.75} className="text-muted" />
                            {t('orders.riderCount', { count: group.rider_count })}
                          </span>
                        ) : (
                          <span className="text-muted/70 text-xs italic">{t('orders.table.unassigned')}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-display text-gray whitespace-nowrap">{formatDate(group.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/orders/${group.id}`); }}
                            className="p-1.5 rounded-lg hover:bg-surface-linen transition-colors text-muted hover:text-ink"
                            aria-label={`Ver pedido ${group.order_number}`}
                          >
                            <Eye size={18} strokeWidth={1.75} />
                          </button>
                          {/* Invoices are per Order: each part has its own
                              items, subtotal and seller. A split purchase
                              therefore invoices from its rows below, not from
                              here — there is no one document to hand over. */}
                          {!isSplit && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDownloadInvoice(parts[0].id, parts[0].order_number); }}
                              disabled={downloadingId === parts[0].id}
                              className="p-1.5 rounded-lg hover:bg-surface-linen transition-colors text-muted hover:text-ink disabled:opacity-50 disabled:cursor-wait"
                              aria-label={`${t('orders.downloadInvoice')} ${parts[0].order_number}`}
                              title={t('orders.downloadInvoice')}
                            >
                              {downloadingId === parts[0].id
                                ? <Loader2 size={18} strokeWidth={1.75} className="animate-spin" />
                                : <FileDown size={18} strokeWidth={1.75} />}
                            </button>
                          )}
                          {/* Soft-delete — hides the order from lists/stats,
                              not shown for on_the_way/delivered (real fulfilled
                              history stays put). Same confirm modal as the
                              order detail page's danger zone. Per part as well:
                              deleting is an Order operation, and half a
                              purchase may be the half that was a mistake. */}
                          {!isSplit && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: parts[0].id, order_number: parts[0].order_number, status: parts[0].status }); }}
                              className="p-1.5 rounded-lg hover:bg-danger-bg transition-colors text-muted hover:text-danger"
                              aria-label={`${t('orderDetail.deleteOrder')} ${group.order_number}`}
                              title={t('orderDetail.deleteOrder')}
                            >
                              <Trash2 size={18} strokeWidth={1.75} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* The parts. Same columns, indented and muted, so the
                        purchase reads as one thing with contents rather than
                        as a second list. */}
                    {isSplit && isOpen && parts.map((part) => (
                      <tr
                        key={part.id}
                        onClick={() => navigate(`/orders/${part.id}`)}
                        className="border-t border-border/60 bg-surface-linen/40 hover:bg-brand-mist/30 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-2.5 text-xs font-mono text-ink/80 whitespace-nowrap">
                          <span className="inline-block w-[22px]" aria-hidden="true" />
                          <span className="text-muted mr-1.5">└</span>
                          {part.order_number}
                        </td>
                        <td className="px-4 py-2.5" />
                        <td className="px-4 py-2.5 text-xs font-display text-ink/70 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <Store size={12} strokeWidth={1.75} className="text-muted" />
                            {part.store?.name ?? 'Cesto'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs font-display text-gray text-center">{part._count?.items ?? 0}</td>
                        <td className="px-4 py-2.5 text-xs font-display text-ink/80 whitespace-nowrap">{formatCurrency(Number(part.total))}</td>
                        <td className="px-4 py-2.5"><StatusBadge status={part.status} /></td>
                        <td className="px-4 py-2.5 text-xs font-display whitespace-nowrap">
                          {part.rider ? (
                            <span className="inline-flex items-center gap-1.5 text-ink/80">
                              <Truck size={13} strokeWidth={1.75} className="text-brand" />
                              {part.rider.name}
                            </span>
                          ) : (
                            <span className="text-muted/70 text-xs italic">{t('orders.table.unassigned')}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5" />
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); navigate(`/orders/${part.id}`); }}
                              className="p-1.5 rounded-lg hover:bg-surface-cream transition-colors text-muted hover:text-ink"
                              aria-label={`Ver pedido ${part.order_number}`}
                            >
                              <Eye size={16} strokeWidth={1.75} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDownloadInvoice(part.id, part.order_number); }}
                              disabled={downloadingId === part.id}
                              className="p-1.5 rounded-lg hover:bg-surface-cream transition-colors text-muted hover:text-ink disabled:opacity-50 disabled:cursor-wait"
                              aria-label={`${t('orders.downloadInvoice')} ${part.order_number}`}
                              title={t('orders.downloadInvoice')}
                            >
                              {downloadingId === part.id
                                ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" />
                                : <FileDown size={16} strokeWidth={1.75} />}
                            </button>
                            {(
                              <button
                                onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: part.id, order_number: part.order_number, status: part.status }); }}
                                className="p-1.5 rounded-lg hover:bg-danger-bg transition-colors text-muted hover:text-danger"
                                aria-label={`${t('orderDetail.deleteOrder')} ${part.order_number}`}
                                title={t('orderDetail.deleteOrder')}
                              >
                                <Trash2 size={16} strokeWidth={1.75} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {!isLoading && data && (
        <Pagination
          page={page}
          totalPages={data.totalPages ?? 1}
          onPageChange={setPage}
          totalItems={data.total}
          pageSize={PAGE_SIZE}
          className="mt-6"
        />
      )}

      </>
      )}

      <DeleteOrderModal
        open={!!deleteTarget}
        orderNumber={deleteTarget?.order_number ?? ''}
        status={deleteTarget?.status}
        isSubmitting={deleteOrder.isPending}
        errorMessage={deleteOrder.isError ? (deleteOrder.error instanceof Error ? deleteOrder.error.message : null) : null}
        onConfirm={onConfirmDelete}
        onCancel={() => { if (!deleteOrder.isPending) setDeleteTarget(null); }}
      />
    </div>
  );
}

type PlanRowStatus = Parameters<typeof PlanDeliveryStatus>[0]['status'];

/** "Plan · Mon 2 Nov": a Home Grocery plan's delivery, and the day it is for. */
function PlanTag({ day }: { day: string | null }) {
  const { t, i18n } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold font-display text-success whitespace-nowrap">
      <ShoppingBasket size={12} strokeWidth={2} />
      {t('orders.planTag', 'Home Grocery')}
      {day && <span className="font-normal text-gray">· {planDate(day, i18n.language, { weekday: 'short', day: 'numeric', month: 'short' })}</span>}
    </span>
  );
}
