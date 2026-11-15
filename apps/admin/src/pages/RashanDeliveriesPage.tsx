import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, Truck, Calendar, MapPin, Eye, ChevronDown, AlertTriangle } from 'lucide-react';
import { useAdminDeliveries, useSetDeliveryStatus } from '@grocery-app/shared';
import type { SubDeliveryStatus } from '@grocery-app/shared';
import Pagination from '@/components/Pagination';

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: 'all' | SubDeliveryStatus; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'awaiting_confirmation', label: 'Awaiting confirmation' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'on_the_way', label: 'On the way' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'failed', label: 'Failed' },
];

const ALLOWED_TRANSITIONS: Record<SubDeliveryStatus, SubDeliveryStatus[]> = {
  scheduled: ['awaiting_confirmation', 'confirmed', 'skipped'],
  awaiting_confirmation: ['confirmed', 'skipped'],
  confirmed: ['preparing', 'skipped'],
  preparing: ['on_the_way', 'failed'],
  on_the_way: ['delivered', 'failed'],
  delivered: [],
  skipped: [],
  failed: [],
};

const STATUS_PILL: Record<SubDeliveryStatus, string> = {
  scheduled: 'bg-surface-linen text-charcoal',
  awaiting_confirmation: 'bg-info-bg text-info',
  confirmed: 'bg-info-bg text-info',
  preparing: 'bg-amber-mist text-amber-deep',
  on_the_way: 'bg-amber-mist text-amber-deep',
  delivered: 'bg-success-bg text-success',
  skipped: 'bg-surface-linen text-muted',
  failed: 'bg-danger-bg text-danger',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function RashanDeliveriesPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<'all' | SubDeliveryStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useAdminDeliveries({
    status: statusFilter === 'all' ? undefined : statusFilter,
    q: searchQuery.trim() || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    limit: PAGE_SIZE,
  });
  const deliveries = data?.items ?? [];

  // Filter change → reset to page 1. Otherwise a filter can strand you.
  const handleStatus = (v: 'all' | SubDeliveryStatus) => { setStatusFilter(v); setPage(1); };
  const handleSearch = (v: string) => { setSearchQuery(v); setPage(1); };
  const handleFrom = (v: string) => { setFrom(v); setPage(1); };
  const handleTo = (v: string) => { setTo(v); setPage(1); };
  const handlePageChange = (p: number) => {
    setPage(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const setStatus = useSetDeliveryStatus();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold font-display text-ink">Rashan deliveries</h1>
        <p className="text-sm text-muted mt-1">Upcoming and recent subscription deliveries — drives the ops pipeline.</p>
      </div>

      {/* Filters. On a phone: status full width, From and To side by side,
          search full width — the four used to squeeze dates to 47px. */}
      <div className="flex flex-wrap gap-3 mb-6 items-end">
        <div className="w-full sm:w-auto">
          <label className="block text-xs text-muted font-display mb-1">Status</label>
          <div className="relative">
            <Filter size={14} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <select
              value={statusFilter}
              onChange={(e) => handleStatus(e.target.value as any)}
              className="w-full sm:w-auto h-10 bg-surface-cream border border-border rounded-lg pl-9 pr-8 text-sm font-display text-ink appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand/30"
            >
              {STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex-1 sm:flex-initial">
          <label className="block text-xs text-muted font-display mb-1">From</label>
          <input type="date" value={from} onChange={(e) => handleFrom(e.target.value)} className="w-full sm:w-auto h-10 px-3 bg-surface-cream border border-border rounded-lg text-sm font-display" />
        </div>
        <div className="flex-1 sm:flex-initial">
          <label className="block text-xs text-muted font-display mb-1">To</label>
          <input type="date" value={to} onChange={(e) => handleTo(e.target.value)} className="w-full sm:w-auto h-10 px-3 bg-surface-cream border border-border rounded-lg text-sm font-display" />
        </div>
        <div className="relative flex-1 basis-full sm:basis-0 min-w-[240px] sm:max-w-sm">
          <label className="block text-xs text-muted font-display mb-1">Search</label>
          <Search size={14} strokeWidth={1.75} className="absolute left-3 top-1/2 translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Customer name or phone"
            className="w-full h-10 bg-surface-cream border border-border rounded-lg pl-9 pr-3 text-sm font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 bg-surface-cream rounded-xl animate-pulse" />)}
        </div>
      ) : deliveries.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <Truck size={32} className="mx-auto mb-3 text-muted" strokeWidth={1.5} />
          <p className="text-muted font-display text-sm">No deliveries match your filters.</p>
        </div>
      ) : (
        <>
        {/* ON A PHONE (2026-11-05): a list — the table needed 1100px and hid
            the total, the status and both actions off to the right. A row
            opens the subscription (the table's eye button); Update is the
            same menu with the same transitions, under the row. No
            overflow-hidden here: it would clip the last row's menu. The
            table from sm. */}
        <ul className="sm:hidden bg-card rounded-xl border border-border divide-y divide-border">
          {deliveries.map((d, i) => {
            const canUpdate = ALLOWED_TRANSITIONS[d.status].length > 0;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/subscriptions/${d.subscription.id}`)}
                  className={`w-full text-left px-4 pt-3 ${canUpdate ? 'pb-2' : 'pb-3'} hover:bg-brand-mist/30 transition-colors ${
                    i === 0 ? 'rounded-t-xl' : ''
                  } ${i === deliveries.length - 1 && !canUpdate ? 'rounded-b-xl' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold font-display text-ink truncate">{d.subscription.user.name}</span>
                    <span className={`inline-flex items-center h-5 px-1.5 rounded-full text-[11px] font-semibold font-display shrink-0 ${STATUS_PILL[d.status]}`}>
                      {d.status.replace(/_/g, ' ')}
                    </span>
                    <span className="ml-auto text-sm font-semibold font-display text-ink tabular-nums whitespace-nowrap shrink-0">
                      €{Number(d.total).toFixed(2)}
                    </span>
                  </div>

                  {d.subscription.user.phone && (
                    <p className="text-[12.5px] text-muted font-mono truncate mt-0.5">{d.subscription.user.phone}</p>
                  )}

                  <p className="text-[11.5px] text-muted font-display mt-1 flex items-center gap-1.5 min-w-0">
                    <Calendar size={12} className="shrink-0" />
                    <span className="truncate">
                      <span className="text-ink">{formatDate(d.scheduled_date)}</span>
                      {'  ·  '}{d.subscription.pack?.name_en ?? 'Custom'}
                      {'  ·  '}Items {d.item_count}
                    </span>
                  </p>

                  <p className="text-[11.5px] text-charcoal font-body mt-0.5 flex items-center gap-1.5 min-w-0">
                    <MapPin size={12} className="text-muted shrink-0" />
                    <span className="truncate">{d.subscription.address.street_line_1}, {d.subscription.address.postcode}</span>
                  </p>

                  {d.failure_reason && (
                    <p className="text-[11px] text-danger font-body mt-1 flex items-center gap-1"><AlertTriangle size={10} /> {d.failure_reason}</p>
                  )}
                </button>

                {canUpdate && (
                  <div className="px-4 pb-3 flex justify-end">
                    <StatusActionMenu
                      currentStatus={d.status}
                      onChange={(s, reason) => setStatus.mutate({ id: d.id, status: s, failureReason: reason })}
                      disabled={setStatus.isPending}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="hidden sm:block bg-card rounded-xl border border-border overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead>
              <tr className="bg-surface-cream">
                {['Scheduled', 'Customer', 'Pack', 'Address', 'Items', 'Total', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold font-display text-gray uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} className="border-t border-border hover:bg-brand-mist/30">
                  <td className="px-4 py-3 text-sm font-display text-ink whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Calendar size={13} className="text-muted" />
                      {formatDate(d.scheduled_date)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-display">
                    <p className="font-bold text-ink truncate">{d.subscription.user.name}</p>
                    <p className="text-xs text-muted font-mono">{d.subscription.user.phone}</p>
                  </td>
                  <td className="px-4 py-3 text-sm font-display text-ink">{d.subscription.pack?.name_en ?? 'Custom'}</td>
                  <td className="px-4 py-3 text-xs font-body text-charcoal max-w-[200px]">
                    <div className="flex items-start gap-1.5">
                      <MapPin size={12} className="text-muted mt-0.5 shrink-0" />
                      <span className="truncate">{d.subscription.address.street_line_1}, {d.subscription.address.postcode}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-display text-gray text-center">{d.item_count}</td>
                  <td className="px-4 py-3 text-sm font-display font-semibold text-ink whitespace-nowrap">€{Number(d.total).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display ${STATUS_PILL[d.status]}`}>
                      {d.status.replace(/_/g, ' ')}
                    </span>
                    {d.failure_reason && (
                      <p className="text-[11px] text-danger font-body mt-1 flex items-center gap-1"><AlertTriangle size={10} /> {d.failure_reason}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <StatusActionMenu
                        currentStatus={d.status}
                        onChange={(s, reason) => setStatus.mutate({ id: d.id, status: s, failureReason: reason })}
                        disabled={setStatus.isPending}
                      />
                      <button
                        onClick={() => navigate(`/subscriptions/${d.subscription.id}`)}
                        className="p-1.5 rounded-lg hover:bg-surface-linen text-muted hover:text-ink"
                        title="View subscription"
                      >
                        <Eye size={16} strokeWidth={1.75} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
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

function StatusActionMenu({
  currentStatus, onChange, disabled,
}: {
  currentStatus: SubDeliveryStatus;
  onChange: (next: SubDeliveryStatus, failureReason?: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  if (allowed.length === 0) return null;

  // A thumb gets 36px for the button and each choice below sm; the table
  // (sm up) keeps the 32px button and denser menu.
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="h-9 sm:h-8 px-3 rounded-lg bg-brand text-white text-xs font-bold font-display hover:bg-brand-mid inline-flex items-center gap-1.5 disabled:opacity-50"
      >
        Update <ChevronDown size={12} strokeWidth={2.5} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 sm:top-9 z-40 bg-card rounded-lg shadow-modal border border-border min-w-[180px] py-1">
            {allowed.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setOpen(false);
                  if (s === 'failed') {
                    const reason = window.prompt('Failure reason?') ?? 'Failed';
                    onChange(s, reason);
                  } else {
                    onChange(s);
                  }
                }}
                className="w-full text-left px-3 py-2.5 sm:py-2 text-xs font-display text-ink hover:bg-surface-cream"
              >
                Mark as <strong>{s.replace(/_/g, ' ')}</strong>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
