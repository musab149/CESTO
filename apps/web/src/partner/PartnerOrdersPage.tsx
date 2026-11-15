import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, RefreshCw, Eye, FileDown, Loader2, Filter, Truck, ShoppingCart } from 'lucide-react';
import {
  usePartnerOrders, partnerOrders, usePartnerStore, useStoreSettings,
  type PartnerOrdersListParams,
} from '@grocery-app/shared';
import { downloadOrderInvoice } from '@grocery-app/shared/invoice';
import { usePartnerT } from './lib/i18n';
import { useLanguageStore } from '@/stores/languageStore';
import { buildPartnerInvoiceLabels } from './lib/invoiceLabels';
import { useToast } from '@/components/Toast';

/**
 * Partner-scoped orders list. Structural mirror of admin's OrdersPage.tsx
 * but hits /api/partner/orders — the server filters to orders whose items
 * belong to the partner's store, so no cross-store leakage possible.
 */

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'all',        label: 'All statuses' },
  { value: 'pending',    label: 'Pending' },
  { value: 'confirmed',  label: 'Confirmed' },
  { value: 'preparing',  label: 'Preparing' },
  { value: 'on_the_way', label: 'On the way' },
  { value: 'delivered',  label: 'Delivered' },
  { value: 'cancelled',  label: 'Cancelled' },
  { value: 'draft',      label: 'Draft' },
];

const STATUS_BADGE_CLASS: Record<string, string> = {
  pending:    'bg-amber-mist text-amber-deep',
  confirmed:  'bg-info-bg text-info',
  preparing:  'bg-brand-mist text-brand',
  on_the_way: 'bg-brand-mist text-brand',
  delivered:  'bg-success-bg text-success',
  cancelled:  'bg-danger-bg text-danger',
  draft:      'bg-surface-linen text-muted',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatCurrency(amount: number): string {
  return amount.toFixed(2).replace('.', ',') + ' €';
}

export default function PartnerOrdersPage() {
  const navigate = useNavigate();
  const t = usePartnerT();
  const lang = useLanguageStore((s) => s.lang);
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') ?? 'all');
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const params: PartnerOrdersListParams = {
    status: statusFilter === 'all' ? undefined : (statusFilter as PartnerOrdersListParams['status']),
    q: searchQuery.trim() || undefined,
  };
  const { data: orders = [], isLoading, refetch, isRefetching } = usePartnerOrders(params);

  // Seller block on the invoice: the partner's own store name (falls back
  // to Cesto if unavailable) plus Cesto's public contact details — Store
  // has no dedicated business address/phone/email of its own today.
  const { data: partnerStoreData } = usePartnerStore();
  const { data: cestoSettings } = useStoreSettings();

  async function handleDownloadInvoice(orderId: string) {
    setDownloadingId(orderId);
    try {
      const full = await partnerOrders.get(orderId);
      await downloadOrderInvoice({
        order: full as any,
        settings: {
          storeName: partnerStoreData?.name ?? cestoSettings?.storeName ?? 'Cesto',
          address: cestoSettings?.address ?? '',
          contactEmail: cestoSettings?.contactEmail ?? '',
          contactPhone: cestoSettings?.contactPhone ?? '',
        },
        labels: buildPartnerInvoiceLabels(t),
        lang,
      });
    } catch (err) {
      toast.error(
        t('orders.invoiceFailedTitle'),
        err instanceof Error ? err.message : t('orders.invoiceFailedBody'),
      );
    } finally {
      setDownloadingId(null);
    }
  }

  function handleStatusChange(value: string) {
    setStatusFilter(value);
    const p = new URLSearchParams(searchParams);
    if (value === 'all') p.delete('status');
    else p.set('status', value);
    setSearchParams(p, { replace: true });
  }

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    const p = new URLSearchParams(searchParams);
    if (!value.trim()) p.delete('q');
    else p.set('q', value);
    setSearchParams(p, { replace: true });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold font-display text-ink inline-flex items-center gap-2">
            <ShoppingCart size={22} strokeWidth={1.75} />
            Orders
            {!isLoading && (
              <span className="text-base font-normal text-muted ml-2">({orders.length})</span>
            )}
          </h1>
          <p className="text-sm text-muted font-body mt-1">
            Customer orders that include a product from your store. You can confirm, mark as preparing, and dispatch — Cesto admins handle delivered/cancelled after that.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="h-10 px-4 rounded-xl text-sm font-semibold border-2 border-border text-gray hover:bg-surface-linen transition-colors inline-flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw size={16} strokeWidth={1.75} className={isRefetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative">
          <Filter size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="h-10 bg-surface-cream border border-border rounded-lg pl-9 pr-8 text-sm text-ink cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand/30"
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
            placeholder="Search order # or customer…"
            className="w-full h-10 bg-surface-cream border border-border rounded-lg pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted py-8">Loading orders…</div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-12 text-center">
          <ShoppingCart className="w-10 h-10 text-muted mx-auto mb-2" strokeWidth={1.5} />
          <p className="text-sm text-ink font-semibold mb-1">No orders yet</p>
          <p className="text-xs text-muted font-body">
            Orders appear here as customers checkout products from your store.
          </p>
        </div>
      ) : (
        <>
        {/* Mobile: one card per order. The table needs 800px to stay legible,
            which on a phone means horizontal scrolling to reach Status and
            Total — the two columns a partner actually scans for. */}
        <div className="md:hidden space-y-2.5">
          {orders.map((order) => {
            const o = order as typeof order & {
              user?: { name: string };
              rider?: { id: string; name: string } | null;
              _count?: { items: number };
            };
            return (
              <button
                key={o.id}
                onClick={() => navigate(`/partner/orders/${o.id}`)}
                className="w-full text-left bg-white rounded-xl border border-border p-3.5 active:bg-brand-mist/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[13px] font-mono text-ink">{o.order_number}</span>
                  <span className={`shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ${STATUS_BADGE_CLASS[o.status] ?? 'bg-surface-linen text-ink'}`}>
                    {o.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 mt-2">
                  <span className="text-[14px] font-semibold text-ink truncate">{o.user?.name ?? '—'}</span>
                  <span className="text-[15px] font-bold text-ink shrink-0">{formatCurrency(Number(o.total))}</span>
                </div>
                <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-2 text-[12px] text-gray">
                  <span>{o._count?.items ?? 0} items</span>
                  <span aria-hidden>·</span>
                  <span>{formatDate(o.created_at)}</span>
                  {o.rider ? (
                    <span className="inline-flex items-center gap-1 text-ink">
                      <Truck size={12} strokeWidth={1.75} className="text-brand" />
                      {o.rider.name}
                    </span>
                  ) : (
                    <span className="text-muted/70 italic">Unassigned</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="hidden md:block bg-white rounded-xl border border-border overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="bg-surface-cream">
                {['Order #', 'Customer', 'Items', 'Total', 'Status', 'Rider', 'Date', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const o = order as typeof order & {
                  user?: { name: string };
                  rider?: { id: string; name: string } | null;
                  _count?: { items: number };
                };
                return (
                  <tr
                    key={o.id}
                    onClick={() => navigate(`/partner/orders/${o.id}`)}
                    className="border-t border-border hover:bg-brand-mist/30 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 text-sm font-mono text-ink whitespace-nowrap">{o.order_number}</td>
                    <td className="px-4 py-3 text-sm text-ink">{o.user?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray text-center">{o._count?.items ?? 0}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-ink whitespace-nowrap">{formatCurrency(Number(o.total))}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_BADGE_CLASS[o.status] ?? 'bg-surface-linen text-ink'}`}>
                        {o.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {o.rider ? (
                        <span className="inline-flex items-center gap-1.5 text-ink">
                          <Truck size={14} strokeWidth={1.75} className="text-brand" />
                          {o.rider.name}
                        </span>
                      ) : (
                        <span className="text-muted/70 text-xs italic">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray whitespace-nowrap">{formatDate(o.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/partner/orders/${o.id}`); }}
                          className="p-1.5 rounded-lg hover:bg-surface-linen text-muted hover:text-ink transition-colors"
                          aria-label={`View order ${o.order_number}`}
                        >
                          <Eye size={18} strokeWidth={1.75} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownloadInvoice(o.id); }}
                          disabled={downloadingId === o.id}
                          className="p-1.5 rounded-lg hover:bg-surface-linen text-muted hover:text-ink transition-colors disabled:opacity-50 disabled:cursor-wait"
                          aria-label={`${t('orders.downloadInvoice')} ${o.order_number}`}
                          title={t('orders.downloadInvoice')}
                        >
                          {downloadingId === o.id
                            ? <Loader2 size={18} strokeWidth={1.75} className="animate-spin" />
                            : <FileDown size={18} strokeWidth={1.75} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
