import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Eye, UserPlus } from 'lucide-react';
import { useAdminUsers } from '@grocery-app/shared';
import AccountTypeBadge from '@/components/AccountTypeBadge';
import type { AdminCustomerType, AdminUserSegment } from '@grocery-app/shared';
import { TableSkeleton } from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import Pagination from '@/components/Pagination';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 20;

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Retail shoppers, or wholesale accounts — the same table either way.
 *
 * Split because they are run by different people answering different
 * questions, not because the record differs: a B2B customer is a User with
 * is_business set, and everything else about the page is identical.
 */
/**
 * How many times this customer has BOUGHT.
 *
 * Not `_count.orders`, which counts Order ROWS: a split checkout is several
 * of those and one purchase, so the row count read 7 for somebody who had
 * ordered twice. The detail page has grouped correctly for a while; this list
 * did not, and this is the number a human reads as "how many times have they
 * ordered".
 *
 * Falls back to the row count for an API deployed before `purchase_count`
 * existed — wrong in the same old way rather than blank, which is the right
 * failure for the few minutes a deploy takes.
 */
function purchaseCount(user: { purchase_count?: number; _count?: { orders: number } }): number {
  return user.purchase_count ?? user._count?.orders ?? 0;
}

export default function CustomersPage(
  { customerType, segment, embedded }: {
    customerType?: AdminCustomerType;
    /** Which tab's slice of the user base — see AdminUserSegment. */
    segment?: AdminUserSegment;
    /** Rendered inside UsersPage, which owns the title and the tab bar. */
    embedded?: boolean;
  } = {},
) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'blocked'>('all');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useAdminUsers({
    q: search.trim() || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
    segment,
    page,
    limit: PAGE_SIZE,
  });
  const users = data?.items ?? [];

  // Any filter change resets the pager — otherwise a filter cull can
  // leave the admin stranded on an empty page.
  function handleSearchChange(v: string) { setSearch(v); setPage(1); }
  function handleStatusChange(v: 'all' | 'active' | 'blocked') { setStatusFilter(v); setPage(1); }
  function handlePageChange(p: number) {
    setPage(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="space-y-0">
      {/* Page header. Empty when embedded — UsersPage owns the title and the
          action — so the whole row goes rather than leaving a gap. */}
      {!embedded && (
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">
            {customerType === 'b2b' ? t('customers.b2bTitle', 'B2B customers') : t('customers.title')}
          </h1>
        </div>
        <button
          onClick={() => navigate('/customers/new')}
          className="min-h-[52px] px-5 rounded-xl bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm inline-flex items-center justify-center gap-2 shrink-0"
        >
          <UserPlus size={16} strokeWidth={2} />
          {t('clients.newTitle', 'New client')}
        </button>
      </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted"
            strokeWidth={1.75}
          />
          <input
            type="text"
            placeholder={t('customers.searchPlaceholder')}
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full bg-surface-cream border border-border rounded-lg h-11 pl-10 pr-4 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value as 'all' | 'active' | 'blocked')}
          className="bg-surface-cream border border-border rounded-lg h-11 px-4 text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
        >
          <option value="all">{t('customers.allStatuses')}</option>
          <option value="active">{t('customers.activeStatus')}</option>
          <option value="blocked">{t('customers.blockedStatus')}</option>
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton rows={5} cols={7} />
      ) : users.length === 0 ? (
        <EmptyState
          title={t('customers.noResults')}
          description={t('customers.noResultsDesc')}
          action={
            search || statusFilter !== 'all'
              ? {
                  label: t('customers.clearFilters'),
                  onClick: () => {
                    setSearch('');
                    setStatusFilter('all');
                    setPage(1);
                  },
                }
              : undefined
          }
        />
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <>
        {/* Eight columns at 720px minimum scrolls sideways on a phone, and
            what scrolls away is the order count and the last order — the two
            reasons anyone looks a customer up rather than searching for them.
            The same rows read downward below sm, with registration date
            dropped: it is the one column you would open the customer to see. */}
        <ul className="sm:hidden divide-y divide-border">
          {users.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                onClick={() => navigate(`/customers/${user.id}`)}
                className="w-full text-left px-4 py-3 hover:bg-brand-mist/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink truncate">{user.name || '\u2014'}</span>
                  <AccountTypeBadge isBusiness={user.is_business} />
                  {user.status !== 'active' && (
                    <span className="inline-flex items-center h-5 px-1.5 rounded-full bg-danger-bg text-danger text-[11px] font-semibold shrink-0">
                      {t('customers.status.blocked')}
                    </span>
                  )}
                  <span className="ml-auto text-[11.5px] text-muted shrink-0">
                    {t('customers.table.orders')}{' '}
                    <span className="text-sm font-semibold text-ink tabular-nums">{purchaseCount(user)}</span>
                  </span>
                </div>

                {(user.phone || user.address_phone || user.email) && (
                  <p className="text-[12.5px] text-muted truncate mt-0.5">
                    {(user.phone || user.address_phone)
                      ? <span className="font-mono">{user.phone || user.address_phone}</span>
                      : null}
                    {(user.phone || user.address_phone) && user.email ? '  \u00b7  ' : null}
                    {user.email}
                  </p>
                )}

                <p className="text-[11.5px] text-muted mt-1">
                  {t('customers.table.lastOrder')}: {formatDate(user.last_order_at)}
                </p>
              </button>
            </li>
          ))}
        </ul>

        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="bg-surface-cream">
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.name')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.type', 'Type')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.phone')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.email')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.orders')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.lastOrder')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.registered')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.status')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-border hover:bg-brand-mist/30 transition">
                  <td className="px-4 py-3 text-sm font-medium text-ink">{user.name || '—'}</td>
                  <td className="px-4 py-3"><AccountTypeBadge isBusiness={user.is_business} /></td>
                  {/* A retail customer is never asked for a phone at sign-up, so
                      the one on their delivery address is usually the only one on
                      file — 29 of 94 production accounts have one that way, and
                      none have User.phone. */}
                  <td className="px-4 py-3 text-sm text-muted font-mono">{user.phone || user.address_phone || '—'}</td>
                  <td className="px-4 py-3 text-sm text-muted">{user.email ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-ink font-semibold">{purchaseCount(user)}</td>
                  <td className="px-4 py-3 text-sm text-muted">{formatDate(user.last_order_at)}</td>
                  <td className="px-4 py-3 text-sm text-muted">{formatDate(user.created_at)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display ${
                        user.status === 'active' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'
                      }`}
                    >
                      {user.status === 'active' ? t('customers.status.active') : t('customers.status.blocked')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => navigate(`/customers/${user.id}`)}
                      className="p-2 rounded-lg hover:bg-surface-linen transition-colors"
                      title="Ver detalle"
                    >
                      <Eye className="w-4 h-4 text-muted" strokeWidth={1.75} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
        </div>
      )}

      {!isLoading && data && (
        <Pagination
          page={page}
          totalPages={data.totalPages ?? 1}
          onPageChange={handlePageChange}
          totalItems={data.total}
          pageSize={PAGE_SIZE}
          className="mt-6"
        />
      )}
    </div>
  );
}
