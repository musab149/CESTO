import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  UserRound, Mail, Phone, BadgeCheck, Ban, ShoppingCart, Users, Wallet, XCircle,
  KeyRound, Loader2, ChevronRight,
} from 'lucide-react';
import {
  useAdminSalesRep, useUpdateSalesRep, useResendSalesRepCredentials, useAdminMe, repStoresOf,
  type AdminResendCredentialsResult,
} from '@grocery-app/shared';
import CredentialsDialog from '@/components/CredentialsDialog';
import BackLink from '@/components/BackLink';
import StatusBadge from '@/components/StatusBadge';
import { TableSkeleton } from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import { useToast } from '@/components/Toast';
import { useGoBack } from '@/lib/useGoBack';
import { formatCurrency } from '@/lib/format';
import { RepShopCard } from '@/components/salesRep/RepShopControls';
import { RepProductsCard } from '@/components/salesRep/RepProducts';
import { RepEarningsSummary, RepEarningsActivity } from '@/components/salesRep/RepEarnings';

/** The windows an admin actually asks for, rather than a date picker nobody
 *  wants to fill in to answer "how are they doing?". */
const RANGES = [
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
  { key: 'all', days: null as number | null },
] as const;

export default function SalesRepDetailPage() {
  const { t, i18n } = useTranslation();
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('30d');

  const days = RANGES.find((r) => r.key === range)?.days ?? null;
  const from = days
    ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    : undefined;

  const { data: rep, isLoading } = useAdminSalesRep(userId, from ? { from } : {});
  const update = useUpdateSalesRep();
  const resend = useResendSalesRepCredentials();
  const toast = useToast();
  /** Re-issuing a login is super-admin, like hiring and revoking. */
  const { data: me } = useAdminMe();
  const isSuperAdmin = me?.role === 'super_admin';

  const [confirmResend, setConfirmResend] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  /** The one-time credentials, once issued. Cleared when the dialog closes. */
  const [issued, setIssued] = useState<AdminResendCredentialsResult | null>(null);

  /**
   * Both of these say what happened, which the revoke button here did not.
   *
   * It called update.mutate() with no handlers at all — so a success was
   * silent and a failure was too: the button went disabled for the request,
   * came back, and nothing else. The global mutationCache.onError in main.tsx
   * only acts on 5xx, so every 4xx landed nowhere. That is exactly how this
   * looked broken on staging.
   */
  const toggleAccess = () => {
    if (!rep) return;
    const next = !rep.is_active;
    update.mutate({ userId: rep.user_id, is_active: next }, {
      onSuccess: () => toast.success(
        next
          ? t('salesReps.reinstated', 'Access restored')
          : t('salesReps.revoked', 'Access removed'),
        next
          ? t('salesReps.reinstatedBody', '{{name}} can sell again.', { name: rep.name })
          : t('salesReps.revokedBody', '{{name}} can no longer work as a rep. Their orders and clients are untouched.', { name: rep.name }),
      ),
      onError: (e) => toast.error(
        next
          ? t('salesReps.reinstateFailed', 'Could not restore their access')
          : t('salesReps.revokeFailed', 'Could not remove their access'),
        e instanceof Error ? e.message : String(e),
      ),
    });
  };

  /**
   * Issue a new login, optionally mailing it.
   *
   * There is no "show me their current password" — it is a bcrypt hash, so
   * the only way to put one in an admin's hand is to replace it. Both choices
   * therefore rotate; the choice is only whether an email goes too.
   */
  const issue = (sendEmail: boolean) => {
    if (!rep) return;
    setResendError(null);
    resend.mutate({ userId: rep.user_id, sendEmail }, {
      onSuccess: (res) => setIssued(res ?? null),
      // In the dialog, which is still in front. A failure here means nothing
      // was rotated — the server does that before it answers — so the old
      // password still works and saying so matters.
      onError: (e) => setResendError(e instanceof Error ? e.message : String(e)),
    });
  };

  const fmtDate = (v: string | null | undefined) => (v
    ? new Date(v).toLocaleDateString(i18n.language === 'en' ? 'en-GB' : 'es-ES',
      { day: '2-digit', month: 'short', year: 'numeric' })
    : '—');

  if (isLoading) return <TableSkeleton rows={6} cols={3} />;
  if (!rep) {
    return (
      <EmptyState
        icon={<UserRound size={22} strokeWidth={1.75} />}
        title={t('salesReps.notFound', 'Not a sales rep')}
        description={t('salesReps.notFoundBody', 'This account does not hold the sales rep role.')}
        action={{ label: t('common.back', 'Back'), onClick: () => goBack('/users?tab=salesreps') }}
      />
    );
  }

  // The money in the window: revenue excludes cancelled orders, so the
  // average is over the ones that were not.
  const kept = rep.stats.orders - rep.stats.cancelled;
  const average = kept > 0 ? Number(rep.stats.revenue) / kept : null;
  const stats: { icon: React.ReactNode; label: string; value: string; hint?: string }[] = [
    { icon: <ShoppingCart size={12} strokeWidth={2} />, label: t('salesReps.orders', 'Orders'), value: String(rep.stats.orders) },
    // Revenue deliberately excludes cancelled orders — the work happened, the
    // money did not. The cancellation count sits beside it so the difference
    // is visible rather than hidden.
    {
      icon: <Wallet size={12} strokeWidth={2} />,
      label: t('salesReps.revenue', 'Revenue'),
      value: formatCurrency(Number(rep.stats.revenue)),
      hint: average !== null ? t('salesReps.avgOrder', '{{amount}} per order on average', { amount: formatCurrency(average) }) : t('salesReps.revenueHint', 'Cancelled orders excluded'),
    },
    { icon: <XCircle size={12} strokeWidth={2} />, label: t('salesReps.cancelled', 'Cancelled'), value: String(rep.stats.cancelled) },
    { icon: <Users size={12} strokeWidth={2} />, label: t('salesReps.clientsOpened', 'Clients opened'), value: String(rep.stats.clients_opened) },
  ];

  return (
    <div>
      <BackLink
        label={t('common.back', 'Back')}
        onClick={() => goBack('/users?tab=salesreps')}
        className="mb-3"
      />

      {/* ─── Who they are ───────────────────────────── */}
      <section className="bg-card rounded-xl border border-border/60 shadow-card p-4 lg:p-5 mb-4 lg:mb-5">
        <div className="flex flex-wrap items-start gap-3 lg:gap-4">
          <span className="w-12 h-12 lg:w-14 lg:h-14 rounded-full bg-brand text-white flex items-center justify-center text-sm lg:text-base font-bold font-display shrink-0">
            {rep.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold font-display text-ink truncate">{rep.name}</h1>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide ${
                rep.is_active ? 'bg-success-bg text-success' : 'bg-surface-linen text-muted'
              }`}>
                {rep.is_active
                  ? <><BadgeCheck size={11} strokeWidth={2.5} />{t('salesReps.active', 'Active')}</>
                  : t('salesReps.revokedBadge', 'Revoked')}
              </span>
              {/* The role can be live while the account is blocked, and then
                  they still cannot work. Both facts or neither. */}
              {rep.account_status === 'blocked' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-danger-bg text-danger">
                  {t('salesReps.accountBlocked', 'Account blocked')}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-gray">
              {rep.code && <span className="font-mono">{rep.code}</span>}
              {rep.email && (
                <span className="inline-flex items-center gap-1.5">
                  <Mail size={13} strokeWidth={1.75} className="text-brand shrink-0" />
                  <span className="font-mono truncate">{rep.email}</span>
                </span>
              )}
              {rep.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone size={13} strokeWidth={1.75} className="text-brand shrink-0" />
                  <span className="font-mono">{rep.phone}</span>
                </span>
              )}
            </div>
            <p className="mt-1 text-[11.5px] text-muted">
              {t('salesReps.grantedOn', 'Rep since {{date}}', { date: fmtDate(rep.granted_at) })}
              {rep.granted_by && ` · ${t('salesReps.grantedByWhom', 'added by {{who}}', { who: rep.granted_by })}`}
            </p>
          </div>

          {/* Both of these mint or withdraw access, so both are super-admin —
              the same gate hiring has. An ops admin sees the figures and no
              buttons, which is the read-only view they should have. */}
          {isSuperAdmin && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {/* Only while they are a rep. The mail points at /sales and
                  names their staff number, neither of which means anything
                  once the role is gone — the server refuses it too. */}
              {rep.is_active && rep.email && (
                <button
                  type="button"
                  disabled={resend.isPending}
                  onClick={() => { setResendError(null); setConfirmResend(true); }}
                  className="h-10 px-4 rounded-xl text-sm font-semibold font-display border-2 border-border text-ink hover:border-brand hover:bg-brand-mist/40 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {resend.isPending
                    ? <Loader2 size={15} strokeWidth={2} className="animate-spin" />
                    : <KeyRound size={15} strokeWidth={2} />}
                  {t('salesReps.resend', 'Resend login')}
                </button>
              )}
              <button
                type="button"
                disabled={update.isPending}
                onClick={toggleAccess}
                className={`h-10 px-4 rounded-xl text-sm font-semibold font-display inline-flex items-center gap-1.5 shrink-0 transition-colors disabled:opacity-50 ${
                  rep.is_active
                    ? 'border-2 border-danger/40 text-danger hover:bg-danger hover:text-white'
                    : 'bg-brand text-white hover:bg-brand-mid'
                }`}
              >
                {rep.is_active
                  ? <><Ban size={15} strokeWidth={2} />{t('salesReps.revoke', 'Revoke')}</>
                  : t('salesReps.reinstate', 'Reinstate')}
              </button>
            </div>
          )}
        </div>
      </section>

      {/*
        Two columns from lg: the work on the left (how they are doing, what
        they have been paid for), their set-up on the right (what is owed,
        their shops). On a phone the short side column comes first — the
        figure an admin most often opens this for is what the rep is owed.
      */}
      <div className="grid gap-4 lg:gap-5 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <aside className="space-y-4 lg:space-y-5 lg:order-2">
          <RepEarningsSummary userId={rep.user_id} name={rep.name} canEdit={isSuperAdmin} />
          <RepShopCard userId={rep.user_id} name={rep.name} stores={repStoresOf(rep)} canEdit={isSuperAdmin} assignedProducts={rep.assigned_products} />
          <RepProductsCard userId={rep.user_id} canEdit={isSuperAdmin} />
        </aside>

        <div className="space-y-4 lg:space-y-5 lg:order-1 min-w-0">
          {/* ─── How they are doing ─────────────────── */}
          {/* The range sits on the card it changes: the figures and the
              orders under them both follow it. */}
          <section className="bg-card rounded-xl border border-border/60 shadow-card overflow-hidden">
            <div className="px-4 py-3 flex flex-wrap items-center gap-3 border-b border-border/60">
              {/* Wide enough for its line, or the range drops under it. */}
              <div className="min-w-[200px] flex-1">
                <h2 className="text-sm font-bold font-display text-ink">{t('salesReps.performance', 'Performance')}</h2>
                <p className="text-[12px] text-muted mt-0.5">{t('salesReps.performanceHint', 'Orders they built in this period.')}</p>
              </div>
              <div role="group" aria-label={t('salesReps.performance', 'Performance')} className="inline-flex rounded-lg border border-border bg-surface-cream p-0.5">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setRange(r.key)}
                    aria-pressed={range === r.key}
                    className={`h-9 sm:h-8 px-3 rounded-md text-xs font-semibold font-display transition-colors ${
                      range === r.key ? 'bg-card text-ink shadow-card' : 'text-gray hover:text-ink'
                    }`}
                  >
                    {t(`salesReps.range.${r.key}`, r.key)}
                  </button>
                ))}
              </div>
            </div>

            {/* One strip, not four cards: they are one answer. */}
            <div className="grid grid-cols-2 sm:grid-cols-4">
              {stats.map((s, i) => (
                <div
                  key={s.label}
                  className={`px-4 py-4 border-border/60 ${i % 2 === 1 ? 'border-l' : ''} ${i >= 2 ? 'border-t sm:border-t-0' : ''} ${i === 2 ? 'sm:border-l' : ''}`}
                >
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-display uppercase tracking-wider text-muted">
                    {s.icon}{s.label}
                  </span>
                  <p className="mt-1 text-2xl font-bold font-display text-ink tabular-nums">{s.value}</p>
                  {s.hint && <p className="text-[11.5px] text-muted mt-0.5">{s.hint}</p>}
                </div>
              ))}
            </div>

            <div className="border-t border-border/60">
              {/* Ten at most (the API's `take`), so the card never grows past
                  them; when there are more, it says so and the full list is
                  one tap away, with the Orders page's own filters. */}
              <div className="px-4 pt-3 pb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-[11px] font-display uppercase tracking-wider text-muted">
                  {rep.stats.orders > rep.recent_orders.length
                    ? t('salesReps.latestCount', 'Latest {{shown}} of {{total}} in this period', { shown: rep.recent_orders.length, total: rep.stats.orders })
                    : t('salesReps.latestOrders', 'Latest orders in this period')}
                </p>
                {/* A 16px-tall link was hard to hit on a phone (2026-11-05):
                    padding with a matching negative margin gives it a 36px
                    tap area without moving the line. */}
                {rep.stats.orders > 0 && (
                  <button
                    type="button"
                    onClick={() => navigate(`/orders?rep=${rep.user_id}${from ? `&from=${from}` : ''}`)}
                    className="inline-flex items-center gap-1 py-2.5 -my-2.5 px-1 -mx-1 text-xs font-semibold font-display text-brand hover:underline"
                  >
                    {t('salesReps.viewAllOrders', { count: rep.stats.orders, defaultValue: 'View all {{count}} in Orders' })}
                    <ChevronRight size={14} strokeWidth={2} />
                  </button>
                )}
              </div>
              {rep.recent_orders.length === 0 ? (
                <p className="px-4 pb-5 text-sm text-muted">
                  {t('salesReps.noOrders', 'Nothing built in this period.')}
                </p>
              ) : (
                <>
                  {/* A phone: one row per order. */}
                  <ul className="md:hidden divide-y divide-border/70 border-t border-border/60">
                    {rep.recent_orders.map((o) => (
                      <li key={o.id}>
                        <button type="button" onClick={() => navigate(`/orders/${o.id}`)} className="w-full text-left px-4 py-3 flex items-center gap-3 active:bg-surface-cream">
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-ink truncate">{o.user?.name ?? '—'}</span>
                            <span className="block text-[12px] font-mono text-muted truncate">{o.order_number} · {fmtDate(o.created_at)}</span>
                          </span>
                          <span className="flex flex-col items-end gap-1 shrink-0">
                            <span className="text-sm font-semibold text-ink tabular-nums">{formatCurrency(Number(o.total))}</span>
                            <StatusBadge status={o.status} />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full min-w-[560px]">
                      <thead>
                        <tr className="bg-surface-cream">
                          <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-2.5 font-display">{t('orders.table.order', 'Order')}</th>
                          <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-2.5 font-display">{t('customers.table.name')}</th>
                          <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-2.5 font-display">{t('customers.table.status')}</th>
                          <th className="text-right text-xs font-semibold text-gray uppercase px-4 py-2.5 font-display">{t('orderCreate.total', 'Total')}</th>
                          <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-2.5 font-display">{t('customers.table.registered')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rep.recent_orders.map((o) => (
                          <tr
                            key={o.id}
                            onClick={() => navigate(`/orders/${o.id}`)}
                            className="border-t border-border hover:bg-brand-mist/30 transition cursor-pointer"
                          >
                            <td className="px-4 py-2.5 text-sm font-mono text-ink">{o.order_number}</td>
                            <td className="px-4 py-2.5 text-sm text-gray truncate">{o.user?.name ?? '—'}</td>
                            <td className="px-4 py-2.5"><StatusBadge status={o.status} /></td>
                            <td className="px-4 py-2.5 text-sm text-ink text-right tabular-nums">{formatCurrency(Number(o.total))}</td>
                            <td className="px-4 py-2.5 text-sm text-gray whitespace-nowrap">{fmtDate(o.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ─── What each order earned them, and what was paid ── */}
          <RepEarningsActivity userId={rep.user_id} canEdit={isSuperAdmin} />
        </div>
      </div>

      <CredentialsDialog
        open={confirmResend}
        title={t('salesReps.resendTitle', 'Send a new login?')}
        body={t('salesReps.resendBody2', 'This issues a NEW temporary password — the one they have cannot be read back. It stops working immediately and they are signed out everywhere, including the shop, which is the same account.')}
        issuedTitle={t('salesReps.issuedTitle', 'New login for {{name}}', { name: rep.name })}
        issuedHint={t('salesReps.issuedHint', 'Shown once. Their previous password no longer works and they have been signed out everywhere.')}
        email={rep.email ?? ''}
        pending={resend.isPending}
        error={resendError}
        issued={issued}
        onEmail={() => issue(true)}
        onShow={() => issue(false)}
        onClose={() => { setConfirmResend(false); setResendError(null); setIssued(null); }}
      />
    </div>
  );
}
