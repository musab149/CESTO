import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useGoBack } from '@/lib/useGoBack';
import { useTranslation } from 'react-i18next';
import { Search, X, SlidersHorizontal, RotateCcw, ShoppingBag } from 'lucide-react';
import { useAdminOrderGroups, useAdminUser } from '@grocery-app/shared';
import type { OrderStatus } from '@grocery-app/shared';
import StatusBadge, { statusConfig, useOrderStatusLabel } from '@/components/StatusBadge';
import BackLink from '@/components/BackLink';
import Pagination from '@/components/Pagination';
import EmptyState from '@/components/EmptyState';
import { TableSkeleton } from '@/components/Skeleton';
import Combobox, { type ComboboxOption } from '@/components/form/Combobox';

/**
 * Every order one customer has ever placed.
 *
 * The customer page shows the ten most recent and then stops. "View all" used
 * to send the admin to the global orders list with the customer's NAME in the
 * search box, which is wrong twice: it is a different page with different
 * filters, and a name is not unique — two customers called the same thing saw
 * each other's purchases.
 *
 * So this is scoped by user id, server-side (`userId` on
 * /api/admin/orders), and carries its own search and filters.
 */

const PAGE_SIZE = 25;

/** Filter keys live in the URL so a filtered view survives a refresh and can
 *  be pasted to someone else. */
const P = { q: 'q', status: 'status', from: 'from', to: 'to', page: 'page' } as const;

function formatDate(value?: string | null, lang = 'es'): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function formatCurrency(value: number | string): string {
  return `${Number(value).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export default function CustomerOrdersPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const q = searchParams.get(P.q) ?? '';
  const status = searchParams.get(P.status) ?? '';
  const from = searchParams.get(P.from) ?? '';
  const to = searchParams.get(P.to) ?? '';
  const page = Number(searchParams.get(P.page) ?? '1') || 1;

  // The box is local and the URL lags it, so typing does not push a history
  // entry per keystroke.
  const [draftQ, setDraftQ] = useState(q);
  useEffect(() => { setDraftQ(q); }, [q]);
  useEffect(() => {
    const id = setTimeout(() => {
      if (draftQ !== q) update({ [P.q]: draftQ || undefined });
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftQ]);

  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    if (!filtersOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFiltersOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [filtersOpen]);

  /** Undefined removes the key. Any filter change resets to page 1 — staying
   *  on page 4 of a result set that no longer has one is the classic bug. */
  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete(P.page);
    setSearchParams(next, { replace: true });
  }

  const { data: user } = useAdminUser(userId);
  const { data, isLoading } = useAdminOrderGroups({
    userId,
    q: q || undefined,
    status: (status || undefined) as OrderStatus | undefined,
    // The API wants ISO datetimes; a date input gives a plain day, so `to`
    // has to mean the END of that day or the day itself is excluded.
    from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
    page,
    limit: PAGE_SIZE,
  });

  const groups = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  // statusConfig is the colours; the words come from the locale. Rebuilt when
  // the language changes, or the dropdown keeps the one it was built with.
  const statusLabel = useOrderStatusLabel();
  const statusOpts: ComboboxOption[] = useMemo(() => ([
    { value: '', label: t('orders.allStatuses', 'All statuses') },
    ...(Object.keys(statusConfig) as OrderStatus[]).map((s) => ({
      value: s, label: statusLabel(s),
    })),
  ]), [t, statusLabel]);

  const chips: { key: string; label: string; onClear: () => void }[] = [];
  if (status) {
    chips.push({
      key: 'status',
      label: statusLabel(status as OrderStatus),
      onClear: () => update({ [P.status]: undefined }),
    });
  }
  if (from) chips.push({ key: 'from', label: `${t('customerOrders.fromDate', 'From')} ${formatDate(from, i18n.language)}`, onClear: () => update({ [P.from]: undefined }) });
  if (to) chips.push({ key: 'to', label: `${t('customerOrders.toDate', 'To')} ${formatDate(to, i18n.language)}`, onClear: () => update({ [P.to]: undefined }) });

  const clearAll = () => update({ [P.status]: undefined, [P.from]: undefined, [P.to]: undefined });

  return (
    <div>
      <BackLink
        label={t('common.backToCustomer', 'Back to the customer')}
        onClick={() => goBack(`/customers/${userId}`)}
        className="mb-3"
      />

      <div className="flex items-end justify-between gap-3 mb-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold font-display text-ink truncate">
            {t('customerOrders.title', 'Orders')}
          </h1>
          <p className="text-[13px] text-muted mt-0.5 truncate">
            {user?.name}
            {total > 0 && (
              <span className="text-muted">{'  ·  '}{t('customerOrders.count', { count: total })}</span>
            )}
          </p>
        </div>
      </div>

      {/* ─── Search + filters ─────────────────────── */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" strokeWidth={1.75} />
          <input
            type="text"
            value={draftQ}
            onChange={(e) => setDraftQ(e.target.value)}
            placeholder={t('customerOrders.searchPlaceholder', 'Search by order number')}
            className="w-full bg-card border border-border rounded-xl h-11 pl-9 pr-9 text-sm font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
          {draftQ && (
            <button
              type="button"
              onClick={() => setDraftQ('')}
              aria-label={t('common.clear', 'Clear')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg hover:bg-surface-linen flex items-center justify-center"
            >
              <X size={14} strokeWidth={2} className="text-muted" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          className={`h-11 px-3.5 rounded-xl border inline-flex items-center gap-2 text-sm font-semibold font-display shrink-0 transition-colors ${
            filtersOpen || chips.length
              ? 'border-brand text-brand bg-brand-whisper'
              : 'border-border text-ink bg-card hover:border-brand'
          }`}
        >
          <SlidersHorizontal size={15} strokeWidth={1.75} />
          <span className="max-[379px]:hidden">{t('products.filters.title')}</span>
          {chips.length > 0 && (
            <span className="min-w-[18px] h-[18px] inline-flex items-center justify-center px-1 rounded-full bg-brand text-white text-[10px] font-bold tabular-nums">
              {chips.length}
            </span>
          )}
        </button>
      </div>

      {/* Filters live in a drawer, like the catalogue panel's and the
          products list's. Opening them in place pushed the results down the
          page, so setting a filter moved the thing you were filtering out of
          view — you ended up looking at the controls instead of what they
          did.

          Each field is a <div>, NOT a <label>: <button> is labelable, so a
          label wrapping a Combobox adopts its trigger and a click on an open
          option is re-dispatched onto it, closing the menu and reopening it in
          one gesture. See [[admin-combobox-label-bug]]. */}
      {filtersOpen && (
        <>
          <button
            type="button"
            onClick={() => setFiltersOpen(false)}
            aria-label={t('common.close', 'Close')}
            className="fixed inset-0 z-40 bg-black/50"
          />
          <aside
            role="dialog"
            aria-label={t('products.filters.title')}
            className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[380px] bg-card shadow-modal flex flex-col"
          >
            <div className="shrink-0 px-4 py-3 border-b border-border flex items-center gap-2">
              <h2 className="text-sm font-semibold font-display text-ink flex-1 inline-flex items-center gap-1.5">
                <SlidersHorizontal size={15} strokeWidth={1.75} className="text-brand" />
                {t('products.filters.title')}
              </h2>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                aria-label={t('common.close', 'Close')}
                className="w-9 h-9 rounded-lg hover:bg-surface-linen flex items-center justify-center"
              >
                <X size={17} strokeWidth={1.75} className="text-muted" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted font-display">
                  {t('orders.table.status')}
                </span>
                <Combobox
                  value={status}
                  onChange={(v) => update({ [P.status]: v || undefined })}
                  ariaLabel={t('orders.allStatuses', 'All statuses')}
                  placeholder={t('orders.allStatuses', 'All statuses')}
                  options={statusOpts}
                  menuPortal
                />
              </div>

              <div className="rounded-lg bg-surface-cream/60 border border-border p-3 space-y-2.5">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted font-display">
                    {t('customerOrders.fromDate', 'From')}
                  </span>
                  <input
                    type="date"
                    value={from}
                    max={to || undefined}
                    onChange={(e) => update({ [P.from]: e.target.value || undefined })}
                    className="h-10 px-3 bg-card border border-border rounded-lg text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted font-display">
                    {t('customerOrders.toDate', 'To')}
                  </span>
                  <input
                    type="date"
                    value={to}
                    min={from || undefined}
                    onChange={(e) => update({ [P.to]: e.target.value || undefined })}
                    className="h-10 px-3 bg-card border border-border rounded-lg text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                  />
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-border px-4 py-3 flex items-center gap-2">
              <button
                type="button"
                onClick={clearAll}
                disabled={chips.length === 0}
                className="flex-1 h-10 rounded-xl border border-border hover:border-brand disabled:opacity-40 text-sm font-semibold font-display text-ink"
              >
                {t('products.filters.clearAll')}
              </button>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                className="flex-1 h-10 rounded-xl bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display"
              >
                {t('products.filters.done')}
              </button>
            </div>
          </aside>
        </>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={c.onClear}
              className="inline-flex items-center gap-1 h-7 pl-3 pr-2 rounded-full bg-brand text-white text-[11.5px] font-bold hover:bg-brand-mid transition-colors max-w-full"
            >
              <span className="truncate">{c.label}</span>
              <X className="w-3 h-3 shrink-0" strokeWidth={2.5} />
            </button>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-danger hover:text-danger/80 transition-colors shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
            {t('products.filters.clearAll')}
          </button>
        </div>
      )}

      {/* ─── Results ──────────────────────────────── */}
      {isLoading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : groups.length === 0 ? (
        <div className="bg-card rounded-xl border border-border">
          <EmptyState
            icon={<ShoppingBag className="w-7 h-7 text-muted" strokeWidth={1.75} />}
            title={t('customerOrders.emptyTitle', 'No orders match')}
            description={chips.length || q
              ? t('customerOrders.emptyFiltered', 'Try a different search or clear the filters.')
              : t('customerOrders.emptyNone', 'This customer has not ordered yet.')}
          />
        </div>
      ) : (
        <>
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
                    <span className="ml-auto text-sm font-semibold text-ink tabular-nums shrink-0">
                      {formatCurrency(group.total)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <StatusBadge status={group.status} />
                    <span className="text-[11.5px] text-muted ml-auto shrink-0">
                      {formatDate(group.created_at, i18n.language)}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <div className="hidden sm:block bg-card rounded-xl border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-cream">
                  {[
                    t('orders.table.orderNumber'),
                    t('orders.table.items'),
                    t('orders.table.total'),
                    t('orders.table.status'),
                    t('orders.table.date'),
                  ].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold font-display text-gray uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr
                    key={group.id}
                    onClick={() => navigate(`/orders/${group.id}`)}
                    className="border-t border-border hover:bg-brand-mist/30 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-ink">{group.order_number}</span>
                        {group.sub_orders.length > 1 && (
                          <span className="inline-flex items-center h-5 px-1.5 rounded-full bg-brand-mist text-brand text-[11px] font-semibold shrink-0">
                            {t('orders.partsCount', { count: group.sub_orders.length })}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray text-center">{group.item_count}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-ink tabular-nums">{formatCurrency(group.total)}</td>
                    <td className="px-4 py-3"><StatusBadge status={group.status} /></td>
                    <td className="px-4 py-3 text-sm text-muted whitespace-nowrap">
                      {formatDate(group.created_at, i18n.language)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={(p) => update({ [P.page]: String(p) })}
            totalItems={total}
            pageSize={PAGE_SIZE}
            className="mt-4"
          />
        </>
      )}
    </div>
  );
}
