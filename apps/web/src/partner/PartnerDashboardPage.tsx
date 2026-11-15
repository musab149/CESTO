import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Euro, Users, Clock, ArrowRight, ChevronRight, ChevronDown,
  Package, AlertTriangle, Truck, PackageSearch, PackageX, MapPin,
  ExternalLink, Circle, CheckCircle2, Store as StoreIcon, PlayCircle,
} from 'lucide-react';
import {
  useCurrentPartner,
  usePartnerDashboardStats,
  usePartnerRecentOrders,
  type PartnerDashboardRange,
  type PartnerDashboardStats,
} from '@grocery-app/shared';

/**
 * Store-owner dashboard. Structural mirror of admin's DashboardPage
 * (range picker → metric grid → quick actions → recent orders table)
 * plus partner-specific value:
 *
 *   · Setup checklist — surfaces the missing pieces (logo / cover /
 *     hours / contact / first product / delivery zone / rider) so a
 *     freshly-approved partner has a clear "get me live" path.
 *   · Store profile pill in the header + one-click "View storefront"
 *     link to the customer-visible page.
 *   · Metrics scoped to their own store — revenue attributes only THIS
 *     store's line-items on multi-store checkouts.
 *   · Extra action tiles for the two "you have to do something" states
 *     partners hit most: unassigned deliveries + low/out-of-stock.
 */

const RANGE_OPTIONS: PartnerDashboardRange[] = ['today', '7d', '30d', 'month', 'year'];
const RANGE_LABEL: Record<PartnerDashboardRange, string> = {
  today: 'Today',
  '7d':  'Last 7 days',
  '30d': 'Last 30 days',
  month: 'This month',
  year:  'This year',
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  pending:    'bg-amber-mist text-amber-deep',
  confirmed:  'bg-info-bg text-info',
  preparing:  'bg-brand-mist text-brand',
  on_the_way: 'bg-brand-mist text-brand',
  delivered:  'bg-success-bg text-success',
  cancelled:  'bg-danger-bg text-danger',
};

function formatCurrency(value: number) {
  return value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PartnerDashboardPage() {
  const navigate = useNavigate();
  const { data: me } = useCurrentPartner();
  const [range, setRange] = useState<PartnerDashboardRange>('today');

  const { data: stats, isLoading: statsLoading }   = usePartnerDashboardStats({ range });
  const { data: recentOrders = [], isLoading: recentLoading } = usePartnerRecentOrders();

  const partner = me?.user;
  const store = me?.store;
  const firstName = partner?.name?.split(' ')[0] ?? 'there';

  const pending      = Number(stats?.pendingOrders      ?? 0);
  const active       = Number(stats?.activeOrders       ?? 0);
  const unassigned   = Number(stats?.unassignedOrders   ?? 0);
  const lowStock     = Number(stats?.lowStockVariants   ?? 0);
  const outOfStock   = Number(stats?.outOfStockVariants ?? 0);
  const totalProducts  = Number(stats?.totalProducts  ?? 0);
  const activeProducts = Number(stats?.activeProducts ?? 0);
  const customers      = Number(stats?.totalCustomers ?? 0);
  const periodOrders   = Number(stats?.period?.orders  ?? 0);
  const periodRevenue  = Number(stats?.period?.revenue ?? 0);

  const metrics = [
    {
      key: 'orders',
      label: 'Orders',
      value: String(periodOrders),
      subtitle: RANGE_LABEL[range].toLowerCase(),
      icon: ShoppingCart,
      iconBg: 'bg-brand-mist',
      iconColor: 'text-brand',
    },
    {
      key: 'revenue',
      label: 'Revenue',
      value: `${formatCurrency(periodRevenue)} €`,
      subtitle: `Your share, ${RANGE_LABEL[range].toLowerCase()}`,
      icon: Euro,
      iconBg: 'bg-brand-mist',
      iconColor: 'text-brand',
    },
    {
      key: 'pending',
      label: 'Pending',
      value: String(pending),
      subtitle: pending > 0 ? 'Waiting for you to confirm' : 'Nothing pending',
      icon: pending > 5 ? AlertTriangle : Clock,
      iconBg: pending > 5 ? 'bg-danger-bg' : 'bg-amber-mist',
      iconColor: pending > 5 ? 'text-danger' : 'text-amber-deep',
      alert: pending > 5,
    },
    {
      key: 'active',
      label: 'Active',
      value: String(active),
      subtitle: 'Confirmed → on the way',
      icon: Truck,
      iconBg: 'bg-info-bg',
      iconColor: 'text-info',
    },
    {
      key: 'unassigned',
      label: 'Needs a rider',
      value: String(unassigned),
      subtitle: unassigned > 0 ? 'Assign one to dispatch' : 'All active orders assigned',
      icon: unassigned > 0 ? AlertTriangle : Truck,
      iconBg: unassigned > 0 ? 'bg-danger-bg' : 'bg-info-bg',
      iconColor: unassigned > 0 ? 'text-danger' : 'text-info',
      alert: unassigned > 0,
    },
    {
      key: 'customers',
      label: 'Customers',
      value: String(customers),
      subtitle: 'Distinct shoppers · all time',
      icon: Users,
      iconBg: 'bg-info-bg',
      iconColor: 'text-info',
    },
    {
      key: 'products',
      label: 'Products',
      value: String(totalProducts),
      subtitle: totalProducts === 0
        ? 'Add your first product'
        : `${activeProducts} active${totalProducts - activeProducts > 0 ? ` · ${totalProducts - activeProducts} inactive` : ''}`,
      icon: PackageSearch,
      iconBg: 'bg-brand-mist',
      iconColor: 'text-brand',
    },
    {
      key: 'lowStock',
      label: 'Low stock',
      value: String(lowStock),
      subtitle: lowStock > 0 ? 'Restock these soon' : 'All variants above threshold',
      icon: lowStock > 0 ? AlertTriangle : Package,
      iconBg: lowStock > 0 ? 'bg-amber-mist' : 'bg-brand-mist',
      iconColor: lowStock > 0 ? 'text-amber-deep' : 'text-brand',
      alert: lowStock > 0,
    },
    {
      key: 'outOfStock',
      label: 'Out of stock',
      value: String(outOfStock),
      subtitle: outOfStock > 0 ? 'Customers can’t buy these' : 'Nothing sold out',
      icon: outOfStock > 0 ? PackageX : Package,
      iconBg: outOfStock > 0 ? 'bg-danger-bg' : 'bg-brand-mist',
      iconColor: outOfStock > 0 ? 'text-danger' : 'text-brand',
      alert: outOfStock > 0,
    },
  ];

  const quickActions = [
    { label: 'View pending orders', icon: Clock,          to: '/partner/orders?status=pending', tone: 'amber' as const, badge: pending > 0 ? String(pending) : null },
    { label: 'Add a product',       icon: Package,        to: '/partner/products/new',          tone: 'brand' as const, badge: null },
    { label: 'Low-stock alerts',    icon: AlertTriangle,  to: '/partner/products?stock=low',    tone: lowStock > 0 ? 'danger' as const : 'muted' as const, badge: lowStock > 0 ? String(lowStock) : null },
    { label: 'Delivery zones',      icon: MapPin,         to: '/partner/zones',                 tone: 'muted' as const,  badge: null },
  ];

  const storefrontUrl = store?.slug ? `/stores/${store.slug}` : null;

  return (
    <div className="space-y-0">
      {/* Header — welcome + store pill + range selector */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold font-display text-ink">
            Welcome back, {firstName}
          </h1>
          <p className="text-sm text-muted font-body mt-1">
            Your store's numbers for {RANGE_LABEL[range].toLowerCase()}. Restock alerts and pending orders live at the top so nothing slips.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {storefrontUrl && (
            <a
              href={storefrontUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-white border-2 border-border hover:border-brand hover:bg-brand-mist/40 text-ink text-sm font-semibold transition"
            >
              <ExternalLink size={16} strokeWidth={1.75} />
              View storefront
            </a>
          )}
          <label className="relative inline-flex items-center">
            <span className="sr-only">Time range</span>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as PartnerDashboardRange)}
              className="appearance-none bg-white border border-border rounded-xl pl-4 pr-10 py-2.5 text-sm font-medium text-ink hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition cursor-pointer min-w-[160px]"
            >
              {RANGE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{RANGE_LABEL[opt]}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 w-4 h-4 text-muted pointer-events-none" strokeWidth={1.75} />
          </label>
        </div>
      </div>

      {/* Store status pill */}
      {store && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-border bg-white px-4 py-3">
          <div className="w-10 h-10 rounded-xl bg-surface-cream border border-border overflow-hidden flex items-center justify-center shrink-0">
            {store.logo_url
              ? <img src={store.logo_url} alt="" className="w-full h-full object-cover" />
              : <StoreIcon size={20} strokeWidth={1.75} className="text-ink/50" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink truncate">{store.name}</p>
            <div className="flex items-center gap-2 text-[11px] text-muted font-body">
              <span className="inline-flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${store.status === 'live' ? 'bg-green-500' : 'bg-amber-500'}`} />
                <span className="uppercase tracking-wide font-semibold text-ink/70">{store.status}</span>
              </span>
              {store.is_verified && <span className="text-brand font-semibold">Verified</span>}
              {storefrontUrl && (
                <>
                  <span className="opacity-40">·</span>
                  <a href={storefrontUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline font-mono">
                    {storefrontUrl}
                  </a>
                </>
              )}
            </div>
          </div>
          <Link
            to="/partner/store"
            className="hidden md:inline-flex items-center gap-1 text-xs font-semibold text-brand hover:text-brand-mid"
          >
            Edit profile <ArrowRight size={12} strokeWidth={2} />
          </Link>
        </div>
      )}

      {/* Setup checklist — only when incomplete */}
      {stats && stats.setupDoneCount < stats.setupTotalCount && (
        <SetupChecklistCard stats={stats} />
      )}

      {/* Metric grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {statsLoading
          ? Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-border p-6 h-[128px] animate-pulse" />
            ))
          : metrics.map((m) => {
              const Icon = m.icon;
              return (
                <div
                  key={m.key}
                  className={`bg-white rounded-xl border p-6 ${m.alert ? 'border-danger/40 ring-1 ring-danger/20' : 'border-border'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${m.iconBg}`}>
                      <Icon className={`w-5 h-5 ${m.iconColor}`} strokeWidth={1.75} />
                    </div>
                    <span className="text-sm font-medium text-muted">{m.label}</span>
                  </div>
                  <p className="text-2xl font-bold font-display text-ink mt-3">{m.value}</p>
                  <p className="text-xs text-muted mt-1">{m.subtitle}</p>
                </div>
              );
            })}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-8">
        {quickActions.map((action) => {
          const Icon = action.icon;
          const bg = action.tone === 'danger' ? 'bg-danger-bg text-danger'
                  : action.tone === 'amber'   ? 'bg-amber-mist text-amber-deep'
                  : action.tone === 'brand'   ? 'bg-brand-mist text-brand'
                  : 'bg-surface-cream text-ink/60';
          return (
            <button
              key={action.to}
              type="button"
              onClick={() => navigate(action.to)}
              className="bg-white rounded-xl border border-border p-4 hover:shadow-card-hover transition flex items-center gap-3 text-left group"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${bg}`}>
                <Icon className="w-5 h-5" strokeWidth={1.75} />
              </div>
              <span className="text-sm font-medium text-ink flex-1">{action.label}</span>
              {action.badge && (
                <span className="inline-flex items-center justify-center h-6 min-w-[24px] px-1.5 rounded-full bg-danger text-white text-[11px] font-bold tabular-nums">
                  {action.badge}
                </span>
              )}
              <ArrowRight className="w-4 h-4 text-muted group-hover:text-brand transition" strokeWidth={1.75} />
            </button>
          );
        })}
      </div>

      {/* Recent orders */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold font-display text-ink">Recent orders</h2>
          <Link
            to="/partner/orders"
            className="text-sm font-medium text-brand hover:text-brand-mid transition flex items-center gap-1"
          >
            View all
            <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
          </Link>
        </div>
        {recentLoading ? (
          <div className="bg-white rounded-xl border border-border p-8 text-center text-sm text-muted">
            Loading recent orders…
          </div>
        ) : recentOrders.length === 0 ? (
          <div className="bg-white rounded-xl border border-border p-10 text-center">
            <ShoppingCart className="w-10 h-10 text-muted mx-auto mb-2" strokeWidth={1.5} />
            <p className="text-sm text-ink font-semibold mb-1">No orders yet</p>
            <p className="text-xs text-muted font-body">
              Orders appear here as customers checkout products from your store.
            </p>
          </div>
        ) : (
          <>
          {/* Mobile: compact rows. Same information, ordered by what a partner
              glances at first — number and status, then customer and total. */}
          <div className="md:hidden space-y-2.5">
            {recentOrders.map((o) => (
              <button
                key={o.id}
                onClick={() => navigate(`/partner/orders/${o.id}`)}
                className="w-full text-left bg-white rounded-xl border border-border p-3.5 active:bg-brand-mist/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-mono text-[13px] text-ink">{o.order_number}</span>
                  <span className={`shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ${STATUS_BADGE_CLASS[o.status] ?? 'bg-surface-linen text-ink'}`}>
                    {o.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 mt-2">
                  <span className="text-[14px] font-semibold text-ink truncate">{o.user?.name ?? 'Unknown'}</span>
                  <span className="text-[15px] font-bold text-ink shrink-0">{formatCurrency(Number(o.total))} €</span>
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
            ))}
          </div>

          <div className="hidden md:block bg-white rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="bg-surface-cream">
                    {['Order #', 'Customer', 'Items', 'Total', 'Status', 'Rider', 'Date'].map((h) => (
                      <th key={h} className="text-left text-xs font-semibold text-gray uppercase px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((o) => (
                    <tr
                      key={o.id}
                      onClick={() => navigate(`/partner/orders/${o.id}`)}
                      className="border-t border-border hover:bg-brand-mist/30 transition cursor-pointer"
                    >
                      <td className="px-4 py-3"><span className="font-mono text-sm text-ink">{o.order_number}</span></td>
                      <td className="px-4 py-3 text-sm text-ink">{o.user?.name ?? 'Unknown'}</td>
                      <td className="px-4 py-3 text-sm text-gray text-center">{o._count?.items ?? 0}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-ink whitespace-nowrap">{formatCurrency(Number(o.total))} €</td>
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
                      <td className="px-4 py-3 text-sm text-muted whitespace-nowrap">{formatDate(o.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </>
        )}
      </div>
    </div>
  );
}

function SetupChecklistCard({ stats }: { stats: PartnerDashboardStats }) {
  const items: Array<{ key: keyof PartnerDashboardStats['setup']; label: string; to: string }> = [
    { key: 'hasLogo',          label: 'Upload your logo',            to: '/partner/store' },
    { key: 'hasCover',         label: 'Add a cover image',           to: '/partner/store' },
    { key: 'hasContactEmail',  label: 'Set a contact email',         to: '/partner/store' },
    { key: 'hasShopHours',     label: 'Configure shop hours',        to: '/partner/store' },
    { key: 'hasProducts',      label: 'Add your first product',      to: '/partner/products/new' },
    { key: 'hasAddress',       label: 'Add your shop address',       to: '/partner/store' },
    { key: 'hasRiders',        label: 'Add your first rider',        to: '/partner/riders' },
  ];
  const pct = stats.setupTotalCount === 0 ? 100 : Math.round((stats.setupDoneCount / stats.setupTotalCount) * 100);

  return (
    <div className="mb-6 bg-white rounded-xl border border-brand/30 overflow-hidden">
      <div className="flex items-start gap-4 p-5">
        <div className="w-10 h-10 rounded-xl bg-brand-mist flex items-center justify-center shrink-0">
          <PlayCircle className="w-5 h-5 text-brand" strokeWidth={1.75} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-base font-bold font-display text-ink">
              Finish setting up your store
            </h2>
            <span className="text-xs font-semibold text-brand font-mono">
              {stats.setupDoneCount}/{stats.setupTotalCount}
            </span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-surface-cream overflow-hidden">
            <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {items.map((it) => {
              const done = stats.setup[it.key];
              return done ? (
                <div key={it.key} className="flex items-center gap-2 py-1.5 text-sm text-muted line-through">
                  <CheckCircle2 size={16} strokeWidth={1.75} className="text-success shrink-0" />
                  {it.label}
                </div>
              ) : (
                <Link
                  key={it.key}
                  to={it.to}
                  className="flex items-center gap-2 py-1.5 text-sm text-ink hover:text-brand transition group"
                >
                  <Circle size={16} strokeWidth={1.75} className="text-muted shrink-0" />
                  <span>{it.label}</span>
                  <ArrowRight size={12} strokeWidth={2} className="text-muted opacity-0 group-hover:opacity-100 transition" />
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
