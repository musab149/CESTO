import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Eye, Filter, Bell, Pause, XCircle, CheckCircle2, TrendingUp } from 'lucide-react';
import { useAdminSubscriptions, useAdminSubsSummary } from '@grocery-app/shared';
import type { RashanSubStatus } from '@grocery-app/shared';
import { TableSkeleton } from '@/components/Skeleton';
import Pagination from '@/components/Pagination';

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: 'all' | RashanSubStatus; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'cancelled', label: 'Cancelled' },
];

function statusPill(status: RashanSubStatus) {
  const map: Record<RashanSubStatus, string> = {
    active: 'bg-success-bg text-success',
    paused: 'bg-amber-mist text-amber-deep',
    cancelled: 'bg-danger-bg text-danger',
  };
  return map[status];
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function SubscriptionsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState<'all' | RashanSubStatus>(
    (searchParams.get('status') as 'all' | RashanSubStatus) ?? 'all',
  );
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '');
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const { data, isLoading } = useAdminSubscriptions({
    status: statusFilter === 'all' ? undefined : statusFilter,
    q: searchQuery.trim() || undefined,
    page,
    limit: PAGE_SIZE,
  });
  const { data: summary } = useAdminSubsSummary();
  const subs = data?.items ?? [];

  function handleStatusChange(value: 'all' | RashanSubStatus) {
    setStatusFilter(value);
    const params = new URLSearchParams(searchParams);
    if (value === 'all') params.delete('status'); else params.set('status', value);
    params.delete('page');
    setSearchParams(params, { replace: true });
  }
  function handleSearchChange(value: string) {
    setSearchQuery(value);
    const params = new URLSearchParams(searchParams);
    if (!value.trim()) params.delete('q'); else params.set('q', value);
    params.delete('page');
    setSearchParams(params, { replace: true });
  }
  function setPage(nextPage: number) {
    const params = new URLSearchParams(searchParams);
    if (nextPage <= 1) params.delete('page'); else params.set('page', String(nextPage));
    setSearchParams(params, { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">Rashan subscriptions</h1>
          <p className="text-sm text-muted mt-1">Customer monthly packs.</p>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {[
            { label: 'Total', value: summary.total, icon: TrendingUp, color: 'text-ink', bg: 'bg-surface-cream' },
            { label: 'Active', value: summary.active, icon: CheckCircle2, color: 'text-success', bg: 'bg-success-bg' },
            { label: 'Paused', value: summary.paused, icon: Pause, color: 'text-amber-deep', bg: 'bg-amber-mist' },
            { label: 'Cancelled', value: summary.cancelled, icon: XCircle, color: 'text-danger', bg: 'bg-danger-bg' },
            { label: 'Awaiting', value: summary.awaiting_confirmation, icon: Bell, color: 'text-info', bg: 'bg-info-bg' },
          ].map((s) => (
            <div key={s.label} className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-7 h-7 rounded-lg ${s.bg} flex items-center justify-center`}>
                  <s.icon className={`w-3.5 h-3.5 ${s.color}`} strokeWidth={2} />
                </div>
                <span className="text-xs text-muted font-display">{s.label}</span>
              </div>
              <p className="text-xl font-bold font-display text-ink">{s.value}</p>
            </div>
          ))}
          {/* ON A PHONE (2026-11-05): a row of its own — as the sixth card it
              shared a row with Awaiting, and a four-figure MRR overran half a
              phone. From sm it sits where it always did. */}
          <div className="col-span-2 sm:col-span-1 md:col-span-5 bg-card rounded-xl border border-border p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted font-display">Estimated MRR (active subscriptions)</p>
              <p className="text-2xl font-bold font-display text-ink">€{summary.mrr_eur.toFixed(2)}</p>
            </div>
            <TrendingUp className="text-brand" />
          </div>
        </div>
      )}

      {/* Filters */}
      {/* On a phone the status select and the search each take the full width. */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative w-full sm:w-auto">
          <Filter size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value as any)}
            className="w-full sm:w-auto h-10 bg-surface-cream border border-border rounded-lg pl-9 pr-8 text-sm font-display text-ink appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand/30"
          >
            {STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
        <div className="relative flex-1 min-w-[240px] sm:max-w-sm">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search by customer name, phone, email..."
            className="w-full h-10 bg-surface-cream border border-border rounded-lg pl-9 pr-3 text-sm font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={7} />
      ) : subs.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <p className="text-muted font-display text-sm">No subscriptions match your filters.</p>
        </div>
      ) : (
        <>
        {/* ON A PHONE (2026-11-05): a list — the table needed 1090px and hid
            the price, next delivery and status off to the right. A row opens
            the subscription, as the table row and its eye button do; the
            table from sm. */}
        <ul className="sm:hidden bg-card rounded-xl border border-border divide-y divide-border overflow-hidden">
          {subs.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => navigate(`/subscriptions/${s.id}`)}
                className="w-full text-left px-4 py-3 hover:bg-brand-mist/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold font-display text-ink truncate">{s.user.name}</span>
                  <span className={`inline-flex items-center h-5 px-1.5 rounded-full text-[11px] font-semibold font-display shrink-0 ${statusPill(s.status)}`}>
                    {s.status}
                  </span>
                  <span className="ml-auto text-[11.5px] text-muted font-display shrink-0 whitespace-nowrap">
                    Per cycle{' '}
                    <span className="text-sm font-semibold text-ink tabular-nums">€{Number(s.total_per_cycle).toFixed(2)}</span>
                  </span>
                </div>

                {(s.user.phone || s.user.email) && (
                  <p className="text-[12.5px] text-muted truncate mt-0.5">
                    {s.user.phone ? <span className="font-mono">{s.user.phone}</span> : s.user.email}
                  </p>
                )}

                <p className="text-[11.5px] text-muted font-display mt-1 truncate">
                  <span className="text-ink">{s.pack?.name_en ?? s.pack_slug ?? 'Custom'}</span>
                  {'  ·  '}{s.frequency.replace(/_/g, ' ')}
                  {'  ·  '}Household {s.household}
                  {'  ·  '}Cycles {s.cycles_completed}
                </p>

                <p className="text-[11.5px] text-muted font-display mt-0.5 flex items-center flex-wrap gap-x-1.5">
                  <span>Next delivery: {formatDate(s.next_delivery_date)}</span>
                  {s.needs_confirmation && (
                    <span className="inline-flex items-center text-[11px] font-bold text-info uppercase tracking-wider"><Bell size={10} className="mr-0.5" /> Awaiting</span>
                  )}
                </p>
              </button>
            </li>
          ))}
        </ul>

        <div className="hidden sm:block bg-card rounded-xl border border-border overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="bg-surface-cream">
                {['Customer', 'Pack', 'Frequency', 'Household', 'Cycles', 'Per cycle', 'Next delivery', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold font-display text-gray uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => navigate(`/subscriptions/${s.id}`)}
                  className="border-t border-border hover:bg-brand-mist/30 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 text-sm font-display">
                    <p className="font-bold text-ink truncate">{s.user.name}</p>
                    <p className="text-xs text-muted font-mono">{s.user.phone || s.user.email}</p>
                  </td>
                  <td className="px-4 py-3 text-sm font-display text-ink">{s.pack?.name_en ?? s.pack_slug ?? 'Custom'}</td>
                  <td className="px-4 py-3 text-sm font-display text-gray">{s.frequency.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-sm font-display text-gray text-center">{s.household}</td>
                  <td className="px-4 py-3 text-sm font-display text-gray text-center">{s.cycles_completed}</td>
                  <td className="px-4 py-3 text-sm font-display font-semibold text-ink whitespace-nowrap">€{Number(s.total_per_cycle).toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm font-display text-gray whitespace-nowrap">
                    {formatDate(s.next_delivery_date)}
                    {s.needs_confirmation && (
                      <span className="ml-1.5 inline-flex items-center text-[11px] font-bold text-info uppercase tracking-wider"><Bell size={10} className="mr-0.5" /> Awaiting</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display ${statusPill(s.status)}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/subscriptions/${s.id}`); }}
                      className="p-1.5 rounded-lg hover:bg-surface-linen text-muted hover:text-ink"
                    >
                      <Eye size={18} strokeWidth={1.75} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {data && (
        <Pagination
          page={page}
          totalPages={data.totalPages ?? 1}
          onPageChange={setPage}
          totalItems={data.total}
          pageSize={PAGE_SIZE}
          className="mt-6"
        />
      )}
    </div>
  );
}
