import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart,
  ClipboardList,
  Building2,
  Briefcase,
  Euro,
  Users,
  Clock,
  ArrowRight,
  ChevronRight,
  ChevronDown,
  Package,
  AlertTriangle,
  Truck,
  PackageSearch,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAdminStats, useAdminRecentOrders } from '@grocery-app/shared';
import type { DashboardRange } from '@grocery-app/shared';
import StatusBadge from '@/components/StatusBadge';
import { MetricCardSkeleton, TableSkeleton } from '@/components/Skeleton';

const RANGE_OPTIONS: DashboardRange[] = ['today', '7d', '30d', 'month', 'year'];

function formatCurrency(value: number) {
  return value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [range, setRange] = useState<DashboardRange>('today');

  const { data: stats, isLoading: statsLoading } = useAdminStats({ range });
  const { data: recentOrders, isLoading: recentLoading } = useAdminRecentOrders();

  // Read the period block from either the current API shape (`period`) or the
  // legacy one (`today`). Lets the admin survive a window where the frontend
  // has redeployed but the API hasn't yet.
  const periodBlock = stats?.period ?? stats?.today;
  const periodOrders = Number(periodBlock?.orders ?? 0);
  const periodRevenue = Number(periodBlock?.revenue ?? 0);
  const totalUsers = Number(stats?.totalUsers ?? 0);
  const pendingOrders = Number(stats?.pendingOrders ?? 0);
  const activeOrders = Number(stats?.activeOrders ?? 0);
  const totalProducts = Number(stats?.totalProducts ?? 0);
  const lowStockVariants = Number(stats?.lowStockVariants ?? 0);

  /**
   * The two order books, side by side under the combined tiles.
   *
   * Absent on an API deployed before the split shipped, in which case the
   * section does not render at all and the page is exactly what it was.
   */
  const byBook = stats?.byBook;
  const books = byBook ? [
    { key: 'customer', label: t('orders.books.customer', 'Customer'),
      hint: t('dashboard.books.customerHint', 'Placed by shoppers'),
      to: '/orders?book=customer', icon: ShoppingCart, stats: byBook.customer },
    { key: 'rashan', label: t('orders.books.rashan', 'Rashan'),
      hint: t('dashboard.books.rashanHint', 'Built by a rep'),
      to: '/orders?book=rashan', icon: ClipboardList, stats: byBook.rashan },
    { key: 'b2b-online', label: t('orders.books.b2bOnline', 'B2B online'),
      hint: t('dashboard.books.b2bOnlineHint', 'Every wholesale order'),
      to: '/orders?book=b2b-online', icon: Building2, stats: byBook.b2bOnline },
    { key: 'b2b-rep', label: t('orders.books.b2bRep', 'B2B by rep'),
      hint: t('dashboard.books.b2bRepHint', 'Built by a rep, retail or wholesale'),
      to: '/orders?book=b2b-rep', icon: Briefcase, stats: byBook.b2bRep },
  ] : [];

  const metrics = [
    {
      key: 'orders',
      label: t('dashboard.metrics.orders'),
      formatted: String(periodOrders),
      subtitle: t('dashboard.metrics.ordersSubtitle'),
      icon: ShoppingCart,
      iconBg: 'bg-brand-mist',
      iconColor: 'text-brand',
      isRevenue: false,
    },
    {
      key: 'revenue',
      label: t('dashboard.metrics.revenue'),
      formatted: formatCurrency(periodRevenue),
      subtitle: t('dashboard.metrics.revenueSubtitle'),
      icon: Euro,
      iconBg: 'bg-brand-mist',
      iconColor: 'text-brand',
      isRevenue: true,
    },
    {
      key: 'pending',
      label: t('dashboard.metrics.pending'),
      formatted: String(pendingOrders),
      subtitle: pendingOrders > 5
        ? t('dashboard.metrics.pendingAlert')
        : t('dashboard.metrics.pendingSubtitle'),
      icon: pendingOrders > 5 ? AlertTriangle : Clock,
      iconBg: pendingOrders > 5 ? 'bg-danger-bg' : 'bg-amber-mist',
      iconColor: pendingOrders > 5 ? 'text-danger' : 'text-amber-deep',
      alert: pendingOrders > 5,
      isRevenue: false,
    },
    {
      key: 'active',
      label: t('dashboard.metrics.active'),
      formatted: String(activeOrders),
      subtitle: t('dashboard.metrics.activeSubtitle'),
      icon: Truck,
      iconBg: 'bg-info-bg',
      iconColor: 'text-info',
      isRevenue: false,
    },
    {
      key: 'customers',
      label: t('dashboard.metrics.customers'),
      formatted: String(totalUsers),
      subtitle: t('dashboard.metrics.customersSubtitle'),
      icon: Users,
      iconBg: 'bg-info-bg',
      iconColor: 'text-info',
      isRevenue: false,
    },
    {
      key: 'products',
      label: t('dashboard.metrics.products'),
      formatted: String(totalProducts),
      subtitle: t('dashboard.metrics.productsSubtitle'),
      icon: PackageSearch,
      iconBg: 'bg-brand-mist',
      iconColor: 'text-brand',
      isRevenue: false,
    },
    {
      key: 'lowStock',
      label: t('dashboard.metrics.lowStock'),
      formatted: String(lowStockVariants),
      subtitle: lowStockVariants > 0
        ? t('dashboard.metrics.lowStockAlert')
        : t('dashboard.metrics.lowStockSubtitle'),
      icon: lowStockVariants > 0 ? AlertTriangle : Package,
      iconBg: lowStockVariants > 0 ? 'bg-danger-bg' : 'bg-amber-mist',
      iconColor: lowStockVariants > 0 ? 'text-danger' : 'text-amber-deep',
      alert: lowStockVariants > 0,
      isRevenue: false,
    },
  ];

  const quickActions = [
    { label: t('dashboard.quickActions.viewPending'), icon: Package, to: '/orders?status=pending' },
    { label: t('dashboard.quickActions.addProduct'), icon: ShoppingCart, to: '/products/new' },
    { label: t('dashboard.quickActions.outOfStock'), icon: AlertTriangle, to: '/products?stock=out' },
  ];

  return (
    <div className="space-y-0">
      <div className="mb-5 sm:mb-8 flex flex-wrap items-start justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">{t('dashboard.title')}</h1>
          <p className="text-sm text-muted mt-1">{t('dashboard.subtitle')}</p>
        </div>

        <label className="relative inline-flex items-center">
          <span className="sr-only">{t('dashboard.range.label')}</span>
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as DashboardRange)}
            className="appearance-none bg-card border border-border rounded-xl pl-4 pr-10 py-2.5 text-sm font-medium font-display text-ink hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition cursor-pointer min-w-[180px]"
          >
            {RANGE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{t(`dashboard.range.${opt}`)}</option>
            ))}
          </select>
          <ChevronDown
            className="absolute right-3 w-4 h-4 text-muted pointer-events-none"
            strokeWidth={1.75}
          />
        </label>
      </div>

      {/* Two cards a row on a phone (2026-11-05): one a row was seven
          screen-heights of scrolling to read seven numbers. An odd last card
          takes the whole row rather than leaving a hole beside it. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {statsLoading
          ? Array.from({ length: 7 }).map((_, i) => <MetricCardSkeleton key={i} />)
          : metrics.map((m, i) => {
              const Icon = m.icon;
              const lastOdd = i === metrics.length - 1 && metrics.length % 2 === 1;
              return (
                <div
                  key={m.key}
                  className={`bg-card rounded-xl border p-4 sm:p-6 min-w-0 ${lastOdd ? 'col-span-2 lg:col-span-1' : ''} ${m.alert ? 'border-danger/40 ring-1 ring-danger/20' : 'border-border'}`}
                >
                  <div className="flex items-center gap-2.5 sm:gap-3">
                    <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0 ${m.iconBg}`}>
                      <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${m.iconColor}`} strokeWidth={1.75} />
                    </div>
                    <span className="text-xs sm:text-sm font-medium text-muted font-display leading-tight">{m.label}</span>
                  </div>
                  <p className="text-xl sm:text-2xl font-bold font-display text-ink mt-2.5 sm:mt-3 truncate">
                    {m.isRevenue ? `${m.formatted} €` : m.formatted}
                  </p>
                  <p className="text-xs text-muted mt-1 leading-snug">{m.subtitle}</p>
                </div>
              );
            })}
      </div>

      {books.length > 0 && (
        <section className="mt-6 sm:mt-8">
          <h2 className="text-lg font-bold font-display text-ink mb-3 sm:mb-4">
            {t('dashboard.books.title', 'By order book')}
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {books.map((b) => {
              const Icon = b.icon;
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => navigate(b.to)}
                  className="bg-card rounded-xl border border-border p-4 sm:p-5 text-left hover:shadow-card-hover hover:border-brand/40 transition group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-mist flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-brand" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold font-display text-ink truncate">{b.label}</p>
                      <p className="text-xs text-muted truncate">{b.hint}</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted group-hover:text-brand transition shrink-0" strokeWidth={1.75} />
                  </div>

                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 mt-4 pt-4 border-t border-border">
                    {[
                      { k: 'orders', label: t('dashboard.metrics.orders'), v: String(b.stats.orders) },
                      { k: 'revenue', label: t('dashboard.metrics.revenue'), v: `${formatCurrency(b.stats.revenue)} €` },
                      { k: 'pending', label: t('dashboard.metrics.pending'), v: String(b.stats.pendingOrders) },
                      { k: 'active', label: t('dashboard.metrics.active'), v: String(b.stats.activeOrders) },
                    ].map((cell) => (
                      <div key={cell.k} className="min-w-0">
                        <dt className="text-[11px] font-display uppercase tracking-wider text-muted truncate">{cell.label}</dt>
                        <dd className="text-base font-bold font-display text-ink mt-0.5 truncate">{cell.v}</dd>
                      </div>
                    ))}
                  </dl>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-6 sm:mt-8">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.to}
              type="button"
              onClick={() => navigate(action.to)}
              className="bg-card rounded-xl border border-border p-4 sm:p-5 hover:shadow-card-hover transition flex items-center gap-4 text-left group"
            >
              <div className="w-10 h-10 rounded-xl bg-brand-mist flex items-center justify-center flex-shrink-0">
                <Icon className="w-5 h-5 text-brand" strokeWidth={1.75} />
              </div>
              <span className="text-sm font-medium font-display text-ink flex-1">{action.label}</span>
              <ArrowRight className="w-4 h-4 text-muted group-hover:text-brand transition" strokeWidth={1.75} />
            </button>
          );
        })}
      </div>

      <div className="mt-6 sm:mt-8">
        <div className="flex items-center justify-between mb-3 sm:mb-4">
          <h2 className="text-lg font-bold font-display text-ink">{t('dashboard.recentOrders')}</h2>
          <button
            type="button"
            onClick={() => navigate('/orders')}
            className="text-sm font-medium text-brand hover:text-brand-mid transition flex items-center gap-1 py-2 -my-2"
          >
            {t('dashboard.viewAll')}
            <ChevronRight className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        {recentLoading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : (
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {/* A phone gets a list (table → list below sm): the table's five
                columns needed 720px and scrolled sideways, total and status
                out of sight. */}
            <ul className="sm:hidden divide-y divide-border">
              {(recentOrders ?? []).map((order) => (
                <li key={order.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/orders/${order.id}`)}
                    className="w-full text-left px-4 py-3 active:bg-brand-mist/30 transition"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-sm text-ink truncate">{order.order_number}</span>
                      <span className="text-sm font-semibold text-ink tabular-nums shrink-0">{formatCurrency(Number(order.total))} &euro;</span>
                    </div>
                    <p className="text-sm text-muted truncate mt-0.5">{order.user?.name || t('dashboard.table.unknownCustomer')}</p>
                    <div className="flex items-center justify-between gap-3 mt-1.5">
                      <StatusBadge status={order.status} />
                      <span className="text-xs text-muted shrink-0">{formatDate(order.created_at)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block overflow-x-auto">
          <table className="w-full min-w-[720px]">
              <thead>
                <tr className="bg-surface-cream">
                  <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('dashboard.table.orderNumber')}</th>
                  <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('dashboard.table.customer')}</th>
                  <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('dashboard.table.totalEur')}</th>
                  <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('dashboard.table.status')}</th>
                  <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('dashboard.table.date')}</th>
                </tr>
              </thead>
              <tbody>
                {(recentOrders ?? []).map((order) => (
                  <tr
                    key={order.id}
                    onClick={() => navigate(`/orders/${order.id}`)}
                    className="border-t border-border hover:bg-brand-mist/30 transition cursor-pointer"
                  >
                    <td className="px-4 py-3"><span className="font-mono text-sm text-ink">{order.order_number}</span></td>
                    <td className="px-4 py-3 text-sm text-ink">{order.user?.name || t('dashboard.table.unknownCustomer')}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-ink">{formatCurrency(Number(order.total))} &euro;</td>
                    <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
                    <td className="px-4 py-3 text-sm text-muted">{formatDate(order.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
