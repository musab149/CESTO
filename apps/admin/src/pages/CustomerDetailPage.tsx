import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Phone, Mail, MapPin, Calendar, Shield, ShieldOff, Trash2,
  ShoppingBag, ShoppingCart, Wallet, Receipt, Clock, Star, Repeat, Briefcase, ChevronRight,
  KeyRound, UserCog, MoreVertical,
  Store as StoreIcon, ExternalLink, Users, HeartHandshake,
} from 'lucide-react';
import {
  useAdminMe, useAdminUser, useEraseUser, useSetUserStatus, useAdminHomeGroceryPlan,
  useUpdateAdminUser, useResendClientCredentials,
  type AdminResendCredentialsResult,
} from '@grocery-app/shared';
import StatusBadge from '@/components/StatusBadge';
import BackLink from '@/components/BackLink';
import { TableSkeleton } from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import ConfirmModal from '@/components/ConfirmModal';
import CredentialsDialog from '@/components/CredentialsDialog';
import PartnerCredentialsDialog from '@/components/partner/PartnerCredentialsDialog';
import { useToast } from '@/components/Toast';
import { useTranslation } from 'react-i18next';
import { useGoBack } from '@/lib/useGoBack';
import { PlanDeliveryStatus } from '@/components/home-grocery-plan/PlanDeliveries';
import DeliveryInformation from '@/components/home-grocery-plan/DeliveryInformation';
import AgreedPrices from '@/components/customer/AgreedPrices';

/**
 * The admin's view of one customer.
 *
 * This was an order-history table with a profile sidebar, which is why it
 * read as an order page: the first and largest thing on it was a list of
 * orders. A customer is more than their orders — what they are worth, what
 * they have open right now, what they have said in public, and where they
 * live — and an admin on the phone to one needs all of it at a glance.
 *
 * Orders are the ten most recent with a link to the rest, rather than a
 * pager. The old page paginated client-side over a list the API caps at ten,
 * so a customer with 47 orders showed one page and a total of "10".
 */

type PlanRowStatus = Parameters<typeof PlanDeliveryStatus>[0]['status'];

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** "hace 3 días" is friendlier than a date when the question is recency. */
function relativeDays(iso: string | null | undefined, lang: string): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  const es = lang.startsWith('es');
  if (days <= 0) return es ? 'hoy' : 'today';
  if (days === 1) return es ? 'ayer' : 'yesterday';
  if (days < 31) return es ? `hace ${days} días` : `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return es ? `hace ${months} meses` : `${months} months ago`;
  const years = Math.floor(months / 12);
  return es ? `hace ${years} año${years > 1 ? 's' : ''}` : `${years} year${years > 1 ? 's' : ''} ago`;
}

/** Two letters from a name, for the monogram. Falls back to one, then to a
 *  dash — a blank disc reads as a loading state that never resolves. */
function initialsOf(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function StatTile({
  icon: Icon, label, value, sub,
}: { icon: typeof ShoppingBag; label: string; value: string; sub?: string | null }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <Icon className="w-4 h-4 text-brand shrink-0" strokeWidth={1.75} />
        <span className="text-[11px] font-display font-semibold text-muted uppercase tracking-wider truncate">{label}</span>
      </div>
      <p className="text-xl font-bold font-display text-ink tabular-nums leading-none">{value}</p>
      {sub && <p className="text-[11.5px] font-display text-muted mt-1.5">{sub}</p>}
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border">
        <h3 className="text-sm font-bold font-display text-ink">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({ icon: Icon, label, children }: { icon: typeof Phone; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="w-4 h-4 text-muted mt-0.5 flex-shrink-0" strokeWidth={1.75} />
      <div className="min-w-0">
        <p className="text-xs text-muted font-display">{label}</p>
        <div className="text-sm text-ink break-words">{children}</div>
      </div>
    </div>
  );
}

export default function CustomerDetailPage() {
  const { t, i18n } = useTranslation();
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const toast = useToast();

  const { data: user, isLoading } = useAdminUser(userId);
  // A Home Grocery household's delivery information, for its panel. Asked only for one.
  const { data: planView } = useAdminHomeGroceryPlan(user?.home_grocery_profile ? userId : undefined);
  const setStatus = useSetUserStatus();
  const eraseUser = useEraseUser();
  const { data: me } = useAdminMe();
  // Irreversible, so super_admin only — the API enforces the same rule.
  const isSuperAdmin = me?.role === 'super_admin';
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [blockError, setBlockError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const updateUser = useUpdateAdminUser();
  const qc = useQueryClient();
  const resendCredentials = useResendClientCredentials();
  const [resendOpen, setResendOpen] = useState(false);
  // A partner's login goes out on the partner route: same rotation, a mail
  // that names their stores rather than the shop's welcome.
  const [partnerResendOpen, setPartnerResendOpen] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  /** What the last issue returned, or null while the dialog is still asking. */
  const [issued, setIssued] = useState<AdminResendCredentialsResult | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  // Above the early return below, not beside the markup it serves: this
  // component returns early when a customer is not found, so an effect
  // declared after that point runs on some renders and not others.
  useEffect(() => {
    if (!actionsOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!actionsRef.current) return;
      if (!actionsRef.current.contains(e.target as Node)) setActionsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setActionsOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [actionsOpen]);

  const [editingRep, setEditingRep] = useState(false);
  const [repDraft, setRepDraft] = useState('');

  /**
   * RECARGO DE EQUIVALENCIA (2026-11-04): the office decides — only for a
   * customer legally under the regime, never because they are autónomo or
   * have a NIF. Confirmed first, because it changes what their next order
   * costs; open orders follow only when the box in the confirmation is ticked
   * (delivered or invoiced ones never do).
   */
  const [recargoAsk, setRecargoAsk] = useState<boolean | null>(null);
  /**
   * Also their OPEN orders — the order placed just before the switch is the
   * case this is for (2026-11-04). On by default: an order still being
   * prepared for someone under the regime should carry it. Orders delivered
   * or with an issued factura are never touched.
   */
  const [recargoOpenToo, setRecargoOpenToo] = useState(true);
  const saveRecargo = (on: boolean) => {
    if (!user) return;
    updateUser.mutate(
      { id: user.id, recargo_equivalencia: on, apply_to_open_orders: recargoOpenToo },
      {
        onSuccess: (res) => {
          setRecargoAsk(null);
          const moved = (res as { applied_to_open_orders?: { changed: number } }).applied_to_open_orders?.changed ?? 0;
          toast.success(
            on
              ? t('customerDetail.recargoOnDone', 'Recargo de equivalencia on')
              : t('customerDetail.recargoOffDone', 'Recargo de equivalencia off'),
            moved > 0
              ? t('customerDetail.recargoOpenMoved', '{{n}} open order(s) updated.', { n: moved })
              : undefined,
          );
          qc.invalidateQueries({ queryKey: ['admin-orders'] });
          qc.invalidateQueries({ queryKey: ['admin-order'] });
        },
        onError: (err) => toast.error(
          t('customerDetail.recargoFailed', 'Could not change recargo de equivalencia'),
          err instanceof Error ? err.message : String(err),
        ),
      },
    );
  };

  const saveRep = () => {
    if (!user) return;
    updateUser.mutate(
      { id: user.id, sales_manager_name: repDraft.trim() || null },
      {
        onSuccess: () => {
          setEditingRep(false);
          toast.success(t('clients.repSaved', 'Sales rep updated'));
        },
        onError: (err) => toast.error(
          t('clients.repSaveFailed', 'Could not update the sales rep'),
          err instanceof Error ? err.message : String(err),
        ),
      },
    );
  };

  /**
   * Issue the customer a new password — mailed, or handed back to be read out.
   *
   * The dialog stays OPEN on success, because the password it returns is the
   * point: closing it would throw away the one thing this call produced. It
   * closes when the admin says they are done with it.
   *
   * A failed email is NOT an error here. The route rotates first and reports
   * `email_sent: false` with a reason, so the password on screen is still the
   * live one — treating that as a failure would hide it and invite a retry
   * that rotates again.
   */
  const issue = (sendEmail: boolean) => {
    if (!user) return;
    setResendError(null);
    resendCredentials.mutate(
      { id: user.id, sendEmail },
      {
        onSuccess: (result) => {
          setIssued(result);
          if (result.email_sent) {
            toast.success(
              t('clients.credentialsResent', 'New credentials sent'),
              t('clients.credentialsResentBody', 'The previous password no longer works.'),
            );
          }
        },
        onError: (err) => setResendError(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  const orders = user?.orders ?? [];
  const addresses = user?.addresses ?? [];
  // The Home Grocery plan sits in the same table as the old self-serve
  // subscriptions; it has its own panel, so it is not listed as one of those.
  const subscriptions = (user?.subscriptions ?? []).filter((s) => s.id !== planView?.plan?.id);
  const reviews = user?.reviews ?? [];
  // Optional all the way down: an API deployed before this shipped sends no
  // `stats` at all, and the page has to render rather than crash on it.
  const stats = user?.stats;
  const languageLabel = user?.preferred_language === 'es' ? 'Español' : 'English';
  const es = i18n.language.startsWith('es');

  if (!isLoading && !user) {
    return (
      <div>
        <button
          type="button"
          onClick={() => goBack('/customers')}
          className="flex items-center gap-2 text-sm font-medium font-display text-brand hover:text-brand-mid transition mb-6"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={1.75} />
          {t('customerDetail.back')}
        </button>
        <EmptyState
          title={t('customerDetail.notFound')}
          description={t('customerDetail.notFoundDesc')}
          action={{ label: t('customerDetail.goToCustomers'), onClick: () => navigate('/customers') }}
        />
      </div>
    );
  }

  const onConfirmDelete = () => {
    if (!user) return;
    setDeleteError(null);
    eraseUser.mutate(user.id, {
      onSuccess: () => navigate('/customers'),
      // The API explains a refusal (an order still in progress, a partner
      // login) in words staff can act on, so show it as-is.
      onError: (err) => setDeleteError(err instanceof Error && err.message ? err.message : t('customerDetail.deleteFailed')),
    });
  };

  /**
   * Unblocking is immediate — it only ever restores access. Blocking asks
   * first, and asks for a reason, because the customer is shown it and it
   * ends whatever they were doing mid-session.
   */
  const onToggleStatus = () => {
    if (!user) return;
    if (user.status === 'active') {
      setBlockReason('');
      setBlockError(null);
      setBlockOpen(true);
      return;
    }
    setStatus.mutate({ id: user.id, status: 'active' });
  };

  const onConfirmBlock = () => {
    if (!user) return;
    setBlockError(null);
    setStatus.mutate(
      { id: user.id, status: 'blocked', reason: blockReason.trim() },
      {
        onSuccess: () => setBlockOpen(false),
        // The API refuses a reason that is too short to be useful to the
        // customer; show that rather than a generic failure.
        onError: (err) => setBlockError(
          err instanceof Error && err.message ? err.message : t('customerDetail.blockFailed', 'Could not block this customer.'),
        ),
      },
    );
  };

  const isBlocked = user?.status === 'blocked';

  /**
   * The shops this person sells through, if any.
   *
   * A partner is a vendor, not a shopper: you do not build an order for them,
   * you go and look at their store. Most of them have no delivery address at
   * all, so the button was offering an action that could not complete even if
   * it made sense. The one partner here with orders got them before they were
   * a partner — history stays, the button goes.
   */
  const partnerStores = user?.partner_roles ?? [];
  const isPartner = partnerStores.length > 0;

  // Declared once and placed twice — beside the name from sm, and in the
  // card's foot below it. Two copies of this markup would have drifted.
  const createOrderButton = !user ? null : isPartner ? (
    <button
      type="button"
      onClick={() => navigate(`/stores/${partnerStores[0].store_id}/edit`)}
      className="w-full sm:w-auto h-11 sm:h-10 px-4 sm:px-5 rounded-xl text-sm font-semibold border-2 border-brand/40 text-brand hover:bg-brand-mist/40 transition-colors inline-flex items-center justify-center gap-2"
    >
      <StoreIcon className="w-4 h-4 shrink-0" strokeWidth={1.75} />
      {partnerStores.length > 1
        ? t('customerDetail.openStores', 'Open stores')
        : t('customerDetail.openStore', 'Open store')}
    </button>
  ) : (
    <button
      type="button"
      onClick={() => navigate(`/customers/${user.id}/orders/new`)}
      disabled={isBlocked}
      title={isBlocked
        ? t('customerDetail.blockedNoOrder', 'Blocked customers cannot be given orders')
        : undefined}
      className="w-full sm:w-auto h-11 sm:h-10 px-4 sm:px-5 rounded-xl text-sm font-semibold bg-brand hover:bg-brand-mid disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors inline-flex items-center justify-center gap-2"
    >
      <ShoppingCart className="w-4 h-4 shrink-0" strokeWidth={1.75} />
      {t('customerDetail.createOrder', 'Create order')}
    </button>
  );

  // Purchases, matching what the table lists. Falls back to the row count
  // from an API that predates grouping, then to what was actually sent.
  const totalPurchases = stats?.orders.purchases ?? stats?.orders.total ?? user?._count?.orders ?? orders.length;
  const orderRows = stats?.orders.total ?? user?._count?.orders ?? orders.length;

  return (
    <div>
      {/* ── Header ─────────────────────────────────────── */}
      {/*
        One card, not four stacked rows.

        The pieces here answer one question each — who is this, are they in
        good standing, how do I reach them, and what do I do next — and they
        were laid out as four separate rows of equal weight, so the block read
        as a list of leftovers with no entry point.

        The monogram is the entry point. It gives the eye somewhere to land,
        distinguishes one customer record from the next at a glance, and
        carries the status on the most visible element in the block instead of
        spending a whole row on a chip. Active is the common case and the
        absence of alarm says so; only a block gets loud.
      */}
      <BackLink
        label={t('customerDetail.back')}
        // A wholesale account is not in the retail list. Cold-start fallback
        // only — goBack pops real history when there is any.
        onClick={() => goBack(user?.is_business ? '/b2b/customers' : '/customers')}
        className="mb-3"
      />

      <header className="bg-card rounded-xl border border-border shadow-card mb-4">
        <div className="p-4 sm:p-5 flex items-start gap-3.5 sm:gap-4">
          <div className="relative shrink-0">
            <div
              className={`w-[52px] h-[52px] sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center text-lg sm:text-2xl font-bold tracking-[-0.03em] select-none ${
                isBlocked ? 'bg-danger-bg text-danger' : 'bg-brand-whisper text-brand'
              }`}
              aria-hidden="true"
            >
              {initialsOf(user?.name)}
            </div>
            {user && (
              <span
                className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-[3px] border-card ${
                  isBlocked ? 'bg-danger' : 'bg-success'
                }`}
                title={isBlocked ? t('customerDetail.status.blocked') : t('customerDetail.status.active')}
              />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h1
                  className="truncate text-[21px] sm:text-[27px] leading-[1.15] font-bold tracking-[-0.02em] text-ink"
                  title={user?.name || undefined}
                >
                  {user?.name || t('customerDetail.loading')}
                </h1>
                {/* Reachable, not merely listed: these are the two things a
                    call starts with, so they are links sized to be tapped.
                    Directly under the name because that is the pair you read
                    together — who, then how to reach them. */}
                {(user?.email || user?.phone) && (
                  <div className="flex flex-wrap items-center gap-x-4 mt-0.5">
                    {user?.email && (
                      <a
                        href={`mailto:${user.email}`}
                        className="min-w-0 max-w-full inline-flex items-center gap-1.5 py-1.5 text-[13px] text-gray hover:text-brand transition-colors"
                      >
                        <Mail className="w-3.5 h-3.5 shrink-0 text-muted" strokeWidth={1.75} />
                        <span className="truncate">{user.email}</span>
                      </a>
                    )}
                    {user?.phone && (
                      <a
                        href={`tel:${user.phone}`}
                        className="inline-flex items-center gap-1.5 py-1.5 text-[13px] font-mono text-gray hover:text-brand transition-colors"
                      >
                        <Phone className="w-3.5 h-3.5 shrink-0 text-muted" strokeWidth={1.75} />
                        {user.phone}
                      </a>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="hidden sm:block">{createOrderButton}</span>
                {user && (
                  <div className="relative shrink-0" ref={actionsRef}>
                    <button
                      type="button"
                      onClick={() => setActionsOpen((v) => !v)}
                      aria-haspopup="menu"
                      aria-expanded={actionsOpen}
                      aria-label={t('customerDetail.moreActions', 'More actions')}
                      className={`w-10 h-10 rounded-xl border transition-colors inline-flex items-center justify-center ${
                        actionsOpen ? 'border-brand text-brand bg-brand-whisper' : 'border-border text-gray hover:bg-surface-linen'
                      }`}
                    >
                      <MoreVertical className="w-4 h-4" strokeWidth={1.75} />
                    </button>

                    {actionsOpen && (
                      <div
                        role="menu"
                        className="absolute right-0 mt-2 w-60 bg-card border border-border rounded-xl shadow-modal z-30 overflow-hidden"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => { setActionsOpen(false); onToggleStatus(); }}
                          disabled={setStatus.isPending}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brand-mist/40 disabled:opacity-60 text-left transition-colors"
                        >
                          {user.status === 'active'
                            ? <ShieldOff className="w-4 h-4 text-gray shrink-0" strokeWidth={1.75} />
                            : <Shield className="w-4 h-4 text-success shrink-0" strokeWidth={1.75} />}
                          <span className="text-sm font-semibold text-ink">
                            {user.status === 'active' ? t('customerDetail.blockUser') : t('customerDetail.unblockUser')}
                          </span>
                        </button>

                        {user.email && (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setActionsOpen(false);
                              setResendError(null);
                              if (isPartner) setPartnerResendOpen(true);
                              else setResendOpen(true);
                            }}
                            disabled={resendCredentials.isPending}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brand-mist/40 disabled:opacity-60 text-left border-t border-border transition-colors"
                          >
                            <KeyRound className="w-4 h-4 text-gray shrink-0" strokeWidth={1.75} />
                            <span className="text-sm font-semibold text-ink">
                              {t('clients.resendCredentials', 'Resend credentials')}
                            </span>
                          </button>
                        )}

                        {isSuperAdmin && (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => { setActionsOpen(false); setDeleteText(''); setDeleteError(null); setDeleteOpen(true); }}
                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-danger-bg text-left border-t border-border transition-colors"
                          >
                            <Trash2 className="w-4 h-4 text-danger shrink-0" strokeWidth={1.75} />
                            <span className="text-sm font-semibold text-danger">
                              {t('customerDetail.deleteCustomer')}
                            </span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {user?.is_business && (
              <span className="inline-flex items-center gap-1.5 mt-2.5 px-2 py-0.5 rounded-md text-[11.5px] font-semibold bg-brand-mist text-brand">
                <Briefcase className="w-3 h-3" strokeWidth={2} />
                {t('customerDetail.business', 'Business')}
                {user.pricing_mode === 'b2b' && ` · ${t('customerDetail.wholesale', 'wholesale prices')}`}
              </span>
            )}
          </div>
        </div>

        {/* A block is the one thing here that changes what you are allowed to
            do, so it gets its own strip rather than a chip among chips. */}
        {isBlocked && (
          <div className="px-4 sm:px-5 py-2.5 bg-danger-bg border-t border-danger/15 sm:rounded-b-xl flex items-start gap-2">
            <ShieldOff className="w-4 h-4 text-danger shrink-0 mt-px" strokeWidth={2} />
            <p className="text-[13px] text-danger min-w-0">
              <span className="font-semibold">{t('customerDetail.status.blocked')}</span>
              {user?.blocked_reason && <span className="opacity-90"> — {user.blocked_reason}</span>}
            </p>
          </div>
        )}

        {/* On a phone the primary action is the card's foot, where a thumb is,
            rather than squeezed beside a name that needs the width. */}
        {user && (
          <div className="sm:hidden border-t border-border rounded-b-xl p-3">
            {createOrderButton}
          </div>
        )}
      </header>

      {/* ── What this customer is worth ────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <StatTile
          icon={ShoppingBag}
          label={t('customerDetail.stats.orders', 'Orders')}
          value={String(totalPurchases)}
          sub={
            orderRows > totalPurchases
              ? t('customerDetail.stats.splitInto', '{{rows}} order rows', { rows: orderRows })
              : stats ? t('customerDetail.stats.paidOf', '{{paid}} paid', { paid: stats.orders.paid }) : null
          }
        />
        <StatTile
          icon={Wallet}
          label={t('customerDetail.stats.spend', 'Lifetime spend')}
          value={formatCurrency(stats?.lifetimeSpend)}
          sub={t('customerDetail.stats.excludesCancelled', 'excludes cancelled')}
        />
        <StatTile
          icon={Receipt}
          label={t('customerDetail.stats.aov', 'Average order')}
          value={formatCurrency(stats?.averageOrderValue)}
        />
        <StatTile
          icon={Clock}
          label={t('customerDetail.stats.lastOrder', 'Last order')}
          value={relativeDays(stats?.lastOrderAt, i18n.language) ?? '—'}
          sub={stats?.lastOrderAt ? formatDate(stats.lastOrderAt) : null}
        />
        {/* The single most useful thing when a customer rings mid-shop, and
            invisible on this page until now. */}
        <StatTile
          icon={ShoppingBag}
          label={t('customerDetail.stats.cart', 'In cart now')}
          value={stats ? String(stats.cart.items) : '—'}
          sub={stats && stats.cart.items > 0 ? formatCurrency(stats.cart.value) : null}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Main column ──────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          <Panel
            title={t('customerDetail.orderHistory')}
            action={
              /* Always offered, not only when the panel is truncated: the
                 dedicated page is also where you search and filter, which is
                 worth reaching with four orders as well as forty. It used to
                 send you to the GLOBAL orders list with the customer's name
                 in the search box — a different page, different filters, and
                 wrong outright for two customers sharing a name. */
              orders.length > 0 ? (
                <button
                  type="button"
                  onClick={() => navigate(`/customers/${userId}/orders`)}
                  className="text-[12.5px] font-semibold font-display text-brand hover:underline inline-flex items-center gap-1 py-2.5 -my-2.5"
                >
                  {t('customerDetail.seeAllOrders', 'See all')}
                  <ChevronRight className="w-3.5 h-3.5" strokeWidth={2.25} />
                </button>
              ) : null
            }
          >
            {isLoading ? (
              <TableSkeleton rows={4} cols={4} />
            ) : orders.length === 0 ? (
              <EmptyState title={t('customerDetail.noOrders')} description={t('customerDetail.noOrdersDesc')} />
            ) : (
              <>
                {/* A phone gets the rows as rows. Hiding two columns stopped
                    the sideways scroll but left a table pretending to be one:
                    a date that mattered and an item count that did not, both
                    gone, and three columns rattling around in the width. The
                    list puts the date back, because "when" is half of what you
                    are scanning an order history for. */}
                <ul className="sm:hidden divide-y divide-border">
                  {orders.map((order) => {
                    const shops = order.stores
                      ? order.stores.map((x) => x?.name ?? 'Cesto')
                      : order.store ? [order.store.name] : [];
                    return (
                      <li key={order.id}>
                        <button
                          type="button"
                          onClick={() => navigate(`/orders/${order.id}`)}
                          className="w-full text-left px-4 py-3 hover:bg-brand-mist/30 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-ink">{order.order_number}</span>
                            {(order.part_count ?? 1) > 1 && (
                              <span className="inline-flex items-center h-5 px-1.5 rounded-full bg-brand-mist text-brand text-[11px] font-semibold shrink-0">
                                {t('customerDetail.parts', '{{count}} parts', { count: order.part_count })}
                              </span>
                            )}
                            <span className="ml-auto text-sm font-semibold text-ink tabular-nums shrink-0">
                              {formatCurrency(order.total)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1.5">
                            {order.plan
                              ? <PlanDeliveryStatus status={order.status as PlanRowStatus} cancelledReason={order.plan.skipped ? 'Skipped' : null} />
                              : <StatusBadge status={order.status} />}
                            <span className="text-[11.5px] text-muted ml-auto shrink-0">
                              {formatDate(order.created_at)}
                            </span>
                          </div>
                          {shops.length > 0 && (
                            <p className="text-[11px] text-muted mt-1 truncate">{shops.join(' \u00b7 ')}</p>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full min-w-[560px]">
                    <thead>
                      <tr className="bg-surface-cream">
                        <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-2.5 font-display">{t('customerDetail.table.orderNumber')}</th>
                        <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-2.5 font-display">{t('customerDetail.table.items')}</th>
                        <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-2.5 font-display">{t('customerDetail.table.totalEur')}</th>
                        <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-2.5 font-display">{t('customerDetail.table.status')}</th>
                        <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-2.5 font-display">{t('customerDetail.table.date')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order) => (
                        <tr
                          key={order.id}
                          onClick={() => navigate(`/orders/${order.id}`)}
                          className="border-t border-border hover:bg-brand-mist/30 transition cursor-pointer"
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm text-ink">{order.order_number}</span>
                              {/* A split checkout is several Order rows; the row
                                  is the purchase, and this says how many parts
                                  are inside it. Opening it shows them. */}
                              {(order.part_count ?? 1) > 1 && (
                                <span className="inline-flex items-center h-5 px-1.5 rounded-full bg-brand-mist text-brand text-[11px] font-semibold font-display shrink-0">
                                  {t('customerDetail.parts', '{{count}} parts', { count: order.part_count })}
                                </span>
                              )}
                            </div>
                            {(() => {
                              // `stores` is the grouped shape, `store` the one an
                              // older API sends. null in either means Cesto.
                              const shops = order.stores
                                ? order.stores.map((x) => x?.name ?? 'Cesto')
                                : order.store ? [order.store.name] : [];
                              return shops.length > 0 ? (
                                <span className="block text-[11px] font-display text-muted mt-0.5">{shops.join(' \u00b7 ')}</span>
                              ) : null;
                            })()}
                          </td>
                          <td className="px-4 py-3 text-sm font-display text-gray">{order.item_count ?? order._count?.items ?? '\u2014'}</td>
                          <td className="px-4 py-3 text-sm font-semibold text-ink tabular-nums">{formatCurrency(order.total)}</td>
                          <td className="px-4 py-3">
                            {order.plan
                              ? <PlanDeliveryStatus status={order.status as PlanRowStatus} cancelledReason={order.plan.skipped ? 'Skipped' : null} />
                              : <StatusBadge status={order.status} />}
                          </td>
                          <td className="px-4 py-3 text-sm text-muted whitespace-nowrap">{formatDate(order.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Panel>

          {subscriptions.length > 0 && (
            <Panel title={t('customerDetail.subscriptions', 'Rashan subscriptions')}>
              <div className="divide-y divide-border">
                {subscriptions.map((sub) => (
                  <div key={sub.id} className="px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 sm:gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold font-display text-ink truncate">
                        {sub.pack_slug || t('customerDetail.customPack', 'Custom pack')}
                        {sub.store && <span className="font-normal text-muted"> · {sub.store.name}</span>}
                      </p>
                      <p className="text-[11.5px] font-display text-muted mt-0.5">
                        {sub.frequency}
                        {sub.next_delivery_date && ` · ${t('customerDetail.nextDelivery', 'next')} ${formatDate(sub.next_delivery_date)}`}
                      </p>
                    </div>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold font-display shrink-0 ${
                      sub.status === 'active' ? 'bg-success-bg text-success'
                        : sub.status === 'cancelled' ? 'bg-danger-bg text-danger'
                        : 'bg-amber-mist text-amber-deep'
                    }`}>
                      {t(`subscriptions.status.${sub.status}`, sub.status)}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {reviews.length > 0 && (
            <Panel title={t('customerDetail.reviews', 'Reviews written')}>
              <div className="divide-y divide-border">
                {reviews.map((review) => (
                  <div key={review.id} className="px-5 py-3.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-sm font-semibold font-display text-ink">
                        <Star className="w-3.5 h-3.5 text-amber-deep" strokeWidth={2} fill="currentColor" />
                        {review.rating}
                      </span>
                      {review.product && (
                        <button
                          type="button"
                          onClick={() => navigate(`/products/${review.product!.id}/edit`)}
                          className="text-sm font-display text-brand hover:underline truncate max-w-full sm:max-w-[280px]"
                        >
                          {review.product.name_es}
                        </button>
                      )}
                      {review.is_hidden && (
                        <span className="text-[11px] font-semibold font-display px-2 py-0.5 rounded-full bg-danger-bg text-danger">
                          {t('customerDetail.hidden', 'hidden')}
                        </span>
                      )}
                      <span className="text-[11.5px] font-display text-muted ml-auto">{formatDate(review.created_at)}</span>
                    </div>
                    {review.title && <p className="text-[12.5px] font-body text-ink/75 mt-1">{review.title}</p>}
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>

        {/* ── Sidebar ──────────────────────────────────── */}
        <div className="space-y-6">
          <Panel title={t('customerDetail.profile')}>
            <div className="p-5 space-y-4">
              <Field icon={Mail} label={t('customerDetail.email')}>{user?.email ?? '—'}</Field>
              {/* Falls back to the business contact number. Approving a B2B
                  lead stores the number it collected on BusinessProfile and
                  leaves User.phone null, so for a wholesale account this is
                  usually the only one on file — and a bare dash here reads as
                  "we have no way to reach them" when we do. */}
              <Field icon={Phone} label={t('customerDetail.phone')}>
                <span className="font-mono">
                  {user?.phone
                    ?? user?.business_profile?.contact_phone
                    ?? addresses[0]?.contact_phone
                    ?? '—'}
                </span>
                {!user?.phone && user?.business_profile?.contact_phone && (
                  <span className="ml-2 text-[11px] font-display text-muted">
                    {t('customerDetail.phoneFromBusiness', 'business contact')}
                  </span>
                )}
                {!user?.phone && !user?.business_profile?.contact_phone && addresses[0]?.contact_phone && (
                  <span className="ml-2 text-[11px] font-display text-muted">
                    {t('customerDetail.phoneFromAddress', 'from their address')}
                  </span>
                )}
              </Field>
              <Field icon={Calendar} label={t('customerDetail.registered')}>
                {formatDate(user?.created_at)}
                {user?.created_at && (
                  <span className="text-muted"> · {relativeDays(user.created_at, i18n.language)}</span>
                )}
              </Field>
              <Field icon={Shield} label={t('customerDetail.signInMethod', 'Sign-in')}>
                {user?.google_id ? 'Google' : t('customerDetail.passwordLogin', 'Email + password')}
              </Field>
              <Field icon={Repeat} label={t('customerDetail.language')}>{languageLabel}</Field>
              {/* Free text for now: reps share admin logins and type their own
                  name. `sales_manager_admin_id` exists on the row for when
                  they get their own accounts — read that first once it does. */}
              <Field icon={UserCog} label={t('clients.salesManagerLabel', 'Sales rep')}>
                {editingRep ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={repDraft}
                      onChange={(e) => setRepDraft(e.target.value)}
                      autoFocus
                      maxLength={120}
                      className="flex-1 min-w-0 h-9 px-2 rounded-lg border border-border bg-surface-cream text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                      placeholder={t('clients.salesManagerPlaceholder', 'Rep name')}
                    />
                    <button
                      type="button"
                      onClick={saveRep}
                      disabled={updateUser.isPending}
                      className="h-9 px-3 rounded-lg bg-brand text-white text-xs font-semibold disabled:opacity-60"
                    >
                      {t('common.save', 'Save')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingRep(false)}
                      className="h-9 px-3 rounded-lg border border-border text-xs font-semibold text-gray"
                    >
                      {t('common.cancel', 'Cancel')}
                    </button>
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    {user?.sales_manager_name || <span className="text-muted">—</span>}
                    <button
                      type="button"
                      onClick={() => { setRepDraft(user?.sales_manager_name ?? ''); setEditingRep(true); }}
                      className="text-xs font-semibold text-brand hover:underline py-2.5 -my-2.5 px-1 -mx-1"
                    >
                      {t('common.edit', 'Edit')}
                    </button>
                  </span>
                )}
              </Field>
              <Field icon={Receipt} label={t('customerDetail.recargo', 'Recargo de equivalencia')}>
                <span className="inline-flex items-center gap-2 flex-wrap">
                  {user?.recargo_equivalencia ? (
                    <span className="text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-warning-bg text-warning">
                      {t('customerDetail.recargoOn', 'Charged')}
                    </span>
                  ) : (
                    <span className="text-muted">{t('customerDetail.recargoOff', 'Not under the regime')}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setRecargoAsk(!user?.recargo_equivalencia)}
                    disabled={updateUser.isPending || !user}
                    className="text-xs font-semibold text-brand hover:underline disabled:opacity-60 py-2.5 -my-2.5 px-1 -mx-1"
                  >
                    {user?.recargo_equivalencia
                      ? t('customerDetail.recargoTurnOff', 'Turn off')
                      : t('customerDetail.recargoTurnOn', 'Turn on')}
                  </button>
                </span>
              </Field>
              {/* Staff or rep — at most one is set, and the label is the same
                  question either way. Reading both survives the window where
                  the API is ahead of this app, or behind it. */}
              {(user?.created_by_admin || user?.created_by_sales_rep) && (
                <Field icon={Shield} label={t('clients.createdBy', 'Opened by')}>
                  {user.created_by_admin?.name ?? user.created_by_sales_rep?.name}
                </Field>
              )}
            </div>
          </Panel>

            {/* What this person SELLS through. Placed above the buying
                profile because for a partner it is the more defining fact,
                and because the question that brings you to this page is
                usually "which store is this?". */}
            {isPartner && (
              <Panel title={t('customerDetail.vendor', 'Vendor')}>
                <ul className="divide-y divide-border">
                  {partnerStores.map((store) => (
                    <li key={store.store_id} className="p-4 sm:px-5 flex items-center gap-3">
                      <span className="w-9 h-9 rounded-lg bg-brand-whisper text-brand flex items-center justify-center shrink-0">
                        <StoreIcon className="w-4 h-4" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold font-display text-ink truncate">
                          {store.store_name}
                          <span className="ml-2 text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-mist text-brand">
                            {store.role}
                          </span>
                        </span>
                        <span className="block text-xs font-mono text-gray truncate mt-0.5">{store.store_slug}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => navigate(`/stores/${store.store_id}/edit`)}
                        className="h-9 px-3 rounded-lg border border-border text-xs font-semibold font-display text-ink hover:border-brand transition-colors inline-flex items-center gap-1.5 shrink-0"
                      >
                        <ExternalLink size={13} strokeWidth={1.75} />
                        {t('customerDetail.openStore', 'Open store')}
                      </button>
                    </li>
                  ))}
                </ul>
                {user?.email && user.status !== 'blocked' && (
                  <div className="px-4 sm:px-5 py-3 border-t border-border flex justify-end">
                    <button
                      type="button"
                      onClick={() => setPartnerResendOpen(true)}
                      className="h-9 px-3 rounded-lg border border-border text-xs font-semibold font-display text-ink hover:border-brand transition-colors inline-flex items-center gap-1.5"
                    >
                      <KeyRound size={13} strokeWidth={1.75} />
                      {t('partners.panel.resend', 'Send login again')}
                    </button>
                  </div>
                )}
              </Panel>
            )}

          {user?.business_profile && (
            <Panel title={t('customerDetail.businessProfile', 'Business')}>
              <div className="p-5 space-y-4">
                <Field icon={Briefcase} label={t('customerDetail.company', 'Company')}>
                  {user.business_profile.company}
                </Field>
                {user.business_profile.registration_no && (
                  <Field icon={Receipt} label={t('customerDetail.regNo', 'Registration no.')}>
                    <span className="font-mono">{user.business_profile.registration_no}</span>
                  </Field>
                )}
                {user.business_profile.contact_phone && (
                  <Field icon={Phone} label={t('customerDetail.contactPhone', 'Contact phone')}>
                    <a
                      href={`tel:${user.business_profile.contact_phone}`}
                      className="font-mono text-brand hover:underline"
                    >
                      {user.business_profile.contact_phone}
                    </a>
                  </Field>
                )}
                {user.business_profile.location && (
                  <Field icon={MapPin} label={t('customerDetail.locationLabel', 'Location')}>
                    {user.business_profile.location}
                  </Field>
                )}
              </div>
            </Panel>
          )}

          {/* A Home Grocery household (2026-10-23): what it told us in its
              request, and its delivery information — read and changed here.
              There is no household page: every order it places, or we or its
              rep place for it, is a Home Grocery order, listed with its others. */}
          {user?.home_grocery_profile && (
            <Panel title={t('customerDetail.homeGrocery', 'Home Grocery')}>
              <div className="p-5 space-y-4">
                <Field icon={Users} label={t('customerDetail.household', 'Household')}>
                  {user.home_grocery_profile.household_size}
                  {(user.home_grocery_profile.adults != null || user.home_grocery_profile.children != null) && (
                    <span className="text-muted">
                      {' · '}
                      {t('customerDetail.householdSplit', '{{adults}} adults, {{children}} children', {
                        adults: user.home_grocery_profile.adults ?? '?',
                        children: user.home_grocery_profile.children ?? '?',
                      })}
                    </span>
                  )}
                </Field>
                {/* The request's answers until the delivery information arrives. */}
                {!planView && (
                  <Field icon={Repeat} label={t('customerDetail.frequency', 'How often')}>
                    {t(`homeGrocery.frequency.${user.home_grocery_profile.frequency}`, user.home_grocery_profile.frequency)}
                  </Field>
                )}
                {!planView?.plan && user.home_grocery_profile.preferred_slot && (
                  <Field icon={Clock} label={t('customerDetail.preferredSlot', 'Preferred time')}>
                    {user.home_grocery_profile.preferred_slot}
                  </Field>
                )}
                {user.home_grocery_profile.contact_phone && (
                  <Field icon={Phone} label={t('customerDetail.contactPhone', 'Contact phone')}>
                    <a
                      href={`tel:${user.home_grocery_profile.contact_phone}`}
                      className="font-mono text-brand hover:underline"
                    >
                      {user.home_grocery_profile.contact_phone}
                    </a>
                  </Field>
                )}
                {user.home_grocery_profile.budget_per_cycle && (
                  <Field icon={Wallet} label={t('customerDetail.budget', 'Budget per delivery')}>
                    €{Number(user.home_grocery_profile.budget_per_cycle).toFixed(2)}
                  </Field>
                )}
                {user.home_grocery_profile.dietary_notes && (
                  <Field icon={HeartHandshake} label={t('customerDetail.whatTheyNeed', 'What they need')}>
                    <span className="whitespace-pre-wrap">{user.home_grocery_profile.dietary_notes}</span>
                  </Field>
                )}
                <Field icon={Calendar} label={t('customerDetail.subscriberSince', 'Subscriber since')}>
                  {new Date(user.home_grocery_profile.approved_at).toLocaleDateString(
                    i18n.language === 'en' ? 'en-GB' : 'es-ES',
                    { day: '2-digit', month: 'short', year: 'numeric' },
                  )}
                </Field>
                {planView && <DeliveryInformation view={planView} userId={user.id} />}
                {/* Every order for them is a Home Grocery one, its day and time suggested from the above. */}
                <button
                  type="button"
                  onClick={() => navigate(`/customers/${user.id}/orders/new`)}
                  className="w-full min-h-[44px] rounded-xl bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display inline-flex items-center justify-center gap-2"
                >
                  <ShoppingCart size={16} strokeWidth={1.75} />
                  {t('hgPlan.createOrder', 'Create order')}
                </button>
              </div>
            </Panel>
          )}

          {/* Prices agreed with them on past orders — per unit, remembered. */}
          {user && <AgreedPrices userId={user.id} />}

          <Panel title={`${t('customerDetail.addresses')}${addresses.length ? ` (${addresses.length})` : ''}`}>
            {addresses.length === 0 ? (
              <p className="px-5 py-4 text-sm font-display text-muted">{t('customerDetail.noAddresses')}</p>
            ) : (
              <div className="divide-y divide-border">
                {addresses.map((addr) => (
                  <div key={addr.id} className="px-5 py-3.5 flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-muted mt-0.5 flex-shrink-0" strokeWidth={1.75} />
                    <div className="min-w-0">
                      <p className="text-sm text-ink font-body leading-relaxed">
                        {addr.street_line_1}
                        {addr.street_line_2 ? `, ${addr.street_line_2}` : ''}
                        <br />
                        <span className="font-mono text-[12.5px]">{addr.postcode}</span> {addr.city}
                        {addr.province ? `, ${addr.province}` : ''}
                      </p>
                      {addr.is_default && (
                        <span className="inline-block mt-1.5 text-[11px] font-semibold font-display px-2 py-0.5 rounded-full bg-brand-mist text-brand">
                          {t('customerDetail.primaryBadge')}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Blocking and deleting both sit in the header where the rest of
              the actions are; this explains what they do rather than
              offering a second, easier-to-hit copy of the destroy button. */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-bold font-display text-ink mb-2">{t('customerDetail.actions')}</h3>
            <p className="text-[12.5px] font-body text-muted leading-relaxed">
              {es
                ? 'Bloquear impide iniciar sesión y hacer pedidos; la cuenta y su historial se conservan. Eliminar borra los datos personales y no se puede deshacer — los pedidos se conservan de forma anónima por obligación contable.'
                : 'Blocking stops sign-in and new orders; the account and its history stay. Deleting erases personal data and cannot be undone — orders are kept, anonymised, because accounting rules require them.'}
            </p>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={recargoAsk !== null}
        title={recargoAsk
          ? t('customerDetail.recargoOnTitle', 'Charge recargo de equivalencia?')
          : t('customerDetail.recargoOffTitle', 'Stop charging recargo de equivalencia?')}
        message={recargoAsk
          ? t('customerDetail.recargoOnBody', 'Only for a customer legally under the regime (a retailer) — not just because they are autónomo or have a NIF. Their orders from now on add 0,5 % / 1,4 % / 5,2 % of the base for 4 % / 10 % / 21 % IVA, and their facturas show it. Delivered or invoiced orders never change.')
          : t('customerDetail.recargoOffBody', 'Their orders from now on carry no recargo. Delivered or invoiced orders keep what they were charged.')}
        confirmLabel={recargoAsk
          ? t('customerDetail.recargoTurnOn', 'Turn on')
          : t('customerDetail.recargoTurnOff', 'Turn off')}
        confirmDisabled={updateUser.isPending}
        onConfirm={() => recargoAsk !== null && saveRecargo(recargoAsk)}
        onCancel={() => setRecargoAsk(null)}
      >
        <label className="mt-3 flex items-start gap-2 text-sm text-ink cursor-pointer">
          <input
            type="checkbox"
            checked={recargoOpenToo}
            onChange={(e) => setRecargoOpenToo(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            {recargoAsk
              ? t('customerDetail.recargoOpenOn', 'Also add it to their open orders (not yet delivered or invoiced)')
              : t('customerDetail.recargoOpenOff', 'Also take it off their open orders (not yet delivered or invoiced)')}
          </span>
        </label>
      </ConfirmModal>

      <ConfirmModal
        open={blockOpen}
        title={t('customerDetail.blockTitle', 'Block this customer?')}
        message={t(
          'customerDetail.blockMessage',
          'They will be signed out immediately and cannot sign in or order until you unblock them. The reason below is shown to them.',
        )}
        confirmLabel={t('customerDetail.blockUser')}
        cancelLabel={t('common.cancel')}
        danger
        confirmDisabled={blockReason.trim().length < 5 || setStatus.isPending}
        onConfirm={onConfirmBlock}
        onCancel={() => setBlockOpen(false)}
      >
        <label className="block text-xs font-semibold font-display text-gray mb-1.5">
          {t('customerDetail.blockReasonLabel', 'Reason shown to the customer')}
        </label>
        <textarea
          value={blockReason}
          onChange={(e) => setBlockReason(e.target.value)}
          rows={3}
          maxLength={500}
          autoFocus
          placeholder={t(
            'customerDetail.blockReasonPlaceholder',
            'e.g. Repeated refused deliveries. Contact support to resolve.',
          )}
          className="w-full px-3 py-2.5 rounded-xl border-2 border-border text-sm font-body text-ink focus:border-danger focus:outline-none resize-y"
        />
        <p className="mt-1.5 text-[11.5px] font-body text-muted">
          {t(
            'customerDetail.blockReasonHint',
            'Write it for the customer to read — they see this when they try to sign in.',
          )}
        </p>
        {blockError && <p className="mt-2 text-sm font-body text-danger">{blockError}</p>}
      </ConfirmModal>

      <ConfirmModal
        open={deleteOpen}
        title={t('customerDetail.deleteTitle')}
        message={t('customerDetail.deleteMessage')}
        confirmLabel={t('customerDetail.deleteConfirm')}
        cancelLabel={t('common.cancel')}
        danger
        confirmDisabled={deleteText.trim().toUpperCase() !== 'DELETE' || eraseUser.isPending}
        onConfirm={onConfirmDelete}
        onCancel={() => setDeleteOpen(false)}
      >
        <label className="block text-xs font-semibold font-display text-gray mb-1.5">
          {t('customerDetail.deleteTypeToConfirm')}
        </label>
        <input
          type="text"
          value={deleteText}
          onChange={(e) => setDeleteText(e.target.value)}
          autoFocus
          className="w-full h-11 px-3 rounded-xl border-2 border-border text-sm font-mono text-ink focus:border-danger focus:outline-none"
        />
        {deleteError && <p className="mt-2 text-sm font-body text-danger">{deleteError}</p>}
      </ConfirmModal>
      {/* The same dialog the rep page uses, with a customer's wording. Both
          routes answer the same shape, so the only thing that differs is what
          a rotation costs the person on the other end. */}
      <PartnerCredentialsDialog
        partner={partnerResendOpen && user ? { id: user.id, name: user.name, email: user.email ?? null } : null}
        onClose={() => setPartnerResendOpen(false)}
      />
      <CredentialsDialog
        open={resendOpen}
        title={t('clients.resendTitle', 'Issue new credentials?')}
        body={t('clients.resendBody2', 'This issues a NEW temporary password — the one they have cannot be read back. It stops working the moment you confirm, and THEY ARE SIGNED OUT IMMEDIATELY on every device, including mid-basket.')}
        issuedTitle={t('clients.issuedTitle', 'New login for {{name}}', { name: user?.name ?? '' })}
        issuedHint={t('clients.issuedHint', 'Shown once. Their previous password no longer works and they have been signed out everywhere.')}
        email={user?.email ?? ''}
        pending={resendCredentials.isPending}
        error={resendError}
        issued={issued}
        onEmail={() => issue(true)}
        onShow={() => issue(false)}
        onClose={() => { setResendOpen(false); setResendError(null); setIssued(null); }}
      />

    </div>
  );
}
