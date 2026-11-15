import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, Check, X as XIcon, Eye, ShoppingCart, HeartHandshake, ArrowRight, FileText, Archive } from 'lucide-react';
import {
  useAdminRashanLeads, useAdminUsers, useApproveRashanLead, useRejectRashanLead, useUpdateAdminRashanLead,
  type RashanLead,
} from '@grocery-app/shared';
import HomeGroceryDecisionModal, { type HomeGroceryDecision } from '@/components/HomeGroceryDecisionModal';
import { RashanLeadDrawer } from '@/pages/RashanLeadsPage';
import { useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import { TableSkeleton } from '@/components/Skeleton';
import AccountTypeBadge from '@/components/AccountTypeBadge';
import Pagination from '@/components/Pagination';
import EmptyState from '@/components/EmptyState';

const PAGE_SIZE = 20;

/**
 * Home Grocery: the requests and the subscribers they become, as one list.
 *
 * The same shape as the B2B tab (LeadDirectoryPage) for the same reason: a
 * request is a subscriber that has not been approved yet — one household at
 * two points in its life, not two things to manage in two places. Open
 * requests sit at the top because they are what needs doing.
 *
 * Its own page rather than another LeadDirectoryPage mode: a request here is
 * a RashanLead, not a B2bLead — a household with a size and a cadence, not a
 * company — and approving one LINKS an existing account more often than it
 * opens one (eight of the thirteen production requests matched an account),
 * which the B2B flow never does.
 *
 * Subscribers are the users tab's `rashan` segment: approved requests, plus
 * clients staff or a rep opened, plus anyone on a legacy self-serve
 * subscription. From a subscriber's row, "New order" builds the order that
 * lands in the Home Grocery book.
 */
export default function HomeGroceryDirectoryPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<
    { lead: RashanLead; mode: HomeGroceryDecision; error?: string | null } | null
  >(null);

  // The admin bell and the new-request email both link here with ?request=.
  const drawerId = searchParams.get('request');
  const setDrawerId = (id: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (id) params.set('request', id); else params.delete('request');
    setSearchParams(params, { replace: true });
  };

  // Open requests are a queue, not an archive — fetched whole, filtered
  // SERVER-side. Filtering a fetched page in the browser is how the B2B tab
  // once hid 15 open leads past the first hundred.
  const { data: leadData, isLoading: leadsLoading } = useAdminRashanLeads({ open: true, limit: 200 });
  const { data: userData, isLoading: usersLoading } = useAdminUsers({
    segment: 'rashan',
    q: search.trim() || undefined,
    page,
    limit: PAGE_SIZE,
  });

  const approve = useApproveRashanLead();
  const reject = useRejectRashanLead();
  // Closing is the third answer: out of the queue, nothing sent. Reject
  // always reaches the household, which is wrong for a duplicate.
  const closeLead = useUpdateAdminRashanLead();
  const [closing, setClosing] = useState<RashanLead | null>(null);
  const confirmClose = async () => {
    if (!closing) return;
    try {
      await closeLead.mutateAsync({ id: closing.id, payload: { status: 'closed' } });
      toast.success(
        t('homeGrocery.close.done', 'Request closed.'),
        t('homeGrocery.close.doneBody', 'Nothing was sent to them.'),
      );
      setClosing(null);
    } catch (e) {
      toast.error(t('homeGrocery.failed', 'Action failed.'), e instanceof Error ? e.message : undefined);
    }
  };
  const submitting = approve.isPending || reject.isPending;

  const openLeads = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (leadData?.items ?? []).filter((l) => !term
      || l.name.toLowerCase().includes(term)
      || l.phone.toLowerCase().includes(term)
      || (l.email ?? '').toLowerCase().includes(term)
      || (l.postcode ?? '').toLowerCase().includes(term));
  }, [leadData, search]);

  const users = userData?.items ?? [];
  const isLoading = leadsLoading || usersLoading;
  // Pinned to page 1 only — they head the queue, they are not account rows.
  const leadRows = page === 1 ? openLeads : [];

  const fmt = (v: string | null | undefined) => (v
    ? new Date(v).toLocaleDateString(i18n.language === 'en' ? 'en-GB' : 'es-ES',
      { day: '2-digit', month: 'short', year: 'numeric' })
    : '—');

  const submit = async (s: { mode: 'approve'; payload: Parameters<typeof approve.mutateAsync>[0]['payload'] } | { mode: 'reject'; reason: string }) => {
    if (!modal) return;
    const { lead } = modal;
    try {
      if (s.mode === 'approve') {
        const res = await approve.mutateAsync({ id: lead.id, payload: s.payload });
        if (res.account === 'linked') {
          toast.success(
            t('homeGrocery.approvedLinked', 'Approved — {{name}} is a Home Grocery subscriber.', { name: lead.name }),
            t('homeGrocery.approvedLinkedBody', 'Their account was linked as it is. They have been notified.'),
          );
        } else {
          toast.success(
            t('homeGrocery.approvedCreated', 'Approved — account opened for {{name}}.', { name: lead.name }),
            res.email_sent
              ? t('homeGrocery.approvedCreatedBody', 'Their login is on its way by email.')
              : t('homeGrocery.approvedCreatedNoMail', 'The login email did not go out. Resend the credentials from their customer page.'),
          );
        }
      } else {
        const res = await reject.mutateAsync({ id: lead.id, reason: s.reason });
        toast.success(
          t('homeGrocery.rejected', 'Request rejected.'),
          res.notified_in_app || res.email_sent
            ? t('homeGrocery.rejectedTold', 'The household has been told why.')
            : t('homeGrocery.rejectedUntold', 'No notification could reach them — let them know by phone.'),
        );
      }
      setModal(null);
    } catch (e) {
      setModal({ ...modal, error: e instanceof Error ? e.message : t('homeGrocery.failed', 'Action failed.') });
    }
  };

  const th = 'text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display';

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={t('homeGrocery.search', 'Search by name, phone, email or postcode…')}
            className="w-full h-10 bg-surface-cream border border-border rounded-lg pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
        {/* Every request ever sent — approved, rejected and the ones ops
            closed — lives on the history page. Nothing is dropped.
            py-2.5/-my-2.5: a 40px target on a phone, the same layout. */}
        <Link
          to="/rashan-leads"
          className="inline-flex items-center gap-1.5 py-2.5 -my-2.5 px-1 -mx-1 text-sm font-semibold font-display text-brand hover:text-brand-ink"
        >
          <FileText size={15} strokeWidth={1.75} />
          {t('homeGrocery.allRequests', 'All requests')}
          <ArrowRight size={14} strokeWidth={2} />
        </Link>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={8} />
      ) : leadRows.length === 0 && users.length === 0 ? (
        <EmptyState
          icon={<HeartHandshake size={22} strokeWidth={1.75} />}
          title={t('homeGrocery.emptyTitle', 'No Home Grocery subscribers yet')}
          description={search.trim()
            ? t('homeGrocery.emptySearch', 'Nobody matches that search.')
            : t('homeGrocery.emptyBody', 'Requests from the Home Grocery form on the website appear here, and stay as subscribers once approved.')}
        />
      ) : (
        <>
        {/* ON A PHONE (2026-11-05): a list — the table needed 1409px and hid
            the order count, the status and every action (approve, reject,
            close, new order) off to the right. Same rows, same handlers:
            tapping a request opens it (the eye button), tapping a subscriber
            opens their page. The table from sm. */}
        <ul className="sm:hidden bg-card rounded-xl border border-border divide-y divide-border overflow-hidden">
          {leadRows.map((l) => (
            <li key={`req-${l.id}`} className="bg-warning-bg/30">
              <button
                type="button"
                onClick={() => setDrawerId(l.id)}
                className="w-full text-left px-4 pt-3 pb-2.5 hover:bg-brand-mist/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold font-display text-ink truncate">{l.name}</span>
                  {/* Says up front whether approving links or opens. */}
                  {l.account ? (
                    <span className="inline-flex items-center h-5 px-1.5 rounded text-[11px] font-bold uppercase tracking-wide bg-success-bg text-success shrink-0">
                      {t('homeGrocery.hasAccount', 'Has account')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center h-5 px-1.5 rounded text-[11px] font-bold uppercase tracking-wide bg-surface-cream text-gray shrink-0">
                      {t('b2bDirectory.noAccount', 'No account')}
                    </span>
                  )}
                  <span className="ml-auto inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-warning-bg text-warning shrink-0">
                    {t('homeGrocery.pending', 'Pending')}
                  </span>
                </div>
                {(l.phone || l.email) && (
                  <p className="text-[12.5px] text-muted truncate mt-0.5">
                    {l.phone ? <span className="font-mono">{l.phone}</span> : null}
                    {l.phone && l.email ? '  ·  ' : null}
                    {l.email}
                  </p>
                )}
                <p className="text-[11.5px] text-muted mt-1">
                  {l.household_size} · {t(`homeGrocery.frequency.${l.frequency}`, l.frequency)}
                  {'  ·  '}
                  {t('homeGrocery.since', 'Since')} {fmt(l.created_at)}
                </p>
              </button>
              <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                <button
                  type="button"
                  onClick={() => setModal({ lead: l, mode: 'approve' })}
                  className="h-9 px-3 rounded-lg bg-brand hover:bg-brand-mid text-white text-xs font-semibold font-display inline-flex items-center gap-1.5"
                >
                  <Check size={14} strokeWidth={2.5} />
                  {t('b2bDirectory.approve', 'Approve')}
                </button>
                <button
                  type="button"
                  onClick={() => setModal({ lead: l, mode: 'reject' })}
                  className="h-9 px-3 rounded-lg border border-border bg-card text-danger text-xs font-semibold font-display hover:border-danger transition-colors inline-flex items-center gap-1.5"
                >
                  <XIcon size={14} strokeWidth={2.5} />
                  {t('b2bDirectory.reject', 'Reject')}
                </button>
                <button
                  type="button"
                  onClick={() => setClosing(l)}
                  title={t('homeGrocery.close.hint', 'Close without replying — a duplicate or a test')}
                  className="h-9 px-3 rounded-lg text-gray text-xs font-semibold font-display hover:text-ink hover:bg-surface-linen transition-colors inline-flex items-center gap-1.5"
                >
                  <Archive size={14} strokeWidth={2} />
                  {t('homeGrocery.close.action', 'Close')}
                </button>
              </div>
            </li>
          ))}

          {users.map((u) => {
            const phone = u.phone || u.home_grocery?.contact_phone || u.address_phone || u.contact_phone;
            const canOrder = u.status !== 'blocked';
            return (
              <li key={`user-${u.id}`}>
                <button
                  type="button"
                  onClick={() => navigate(`/customers/${u.id}`)}
                  className={`w-full text-left px-4 pt-3 ${canOrder ? 'pb-2.5' : 'pb-3'} hover:bg-brand-mist/30 transition-colors`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold font-display text-ink truncate">{u.name}</span>
                    <AccountTypeBadge isBusiness={u.is_business} />
                    {u.status === 'blocked' && (
                      <span className="inline-flex items-center h-5 px-1.5 rounded-full bg-danger-bg text-danger text-[11px] font-bold uppercase tracking-wide shrink-0">
                        {t('customers.blocked', 'Blocked')}
                      </span>
                    )}
                    <span className="ml-auto text-[11.5px] text-muted shrink-0">
                      {t('customers.table.orders')}{' '}
                      <span className="text-sm font-semibold text-ink tabular-nums">{u.purchase_count ?? u._count.orders}</span>
                    </span>
                  </div>
                  {(phone || u.email) && (
                    <p className="text-[12.5px] text-muted truncate mt-0.5">
                      {phone ? <span className="font-mono">{phone}</span> : null}
                      {phone && u.email ? '  ·  ' : null}
                      {u.email}
                    </p>
                  )}
                  <p className="text-[11.5px] text-muted mt-1">
                    {u.home_grocery && (
                      <>
                        {u.home_grocery.household_size} · {t(`homeGrocery.frequency.${u.home_grocery_plan?.frequency ?? u.home_grocery.frequency}`, u.home_grocery_plan?.frequency ?? u.home_grocery.frequency)}
                        {'  ·  '}
                      </>
                    )}
                    {t('homeGrocery.since', 'Since')} {fmt(u.home_grocery?.approved_at ?? u.created_at)}
                  </p>
                </button>
                {canOrder && (
                  <div className="px-4 pb-3">
                    <button
                      type="button"
                      onClick={() => navigate(`/customers/${u.id}/orders/new`)}
                      className="h-9 px-3 rounded-lg border border-border text-ink text-xs font-semibold font-display hover:border-brand hover:text-brand transition-colors inline-flex items-center gap-1.5"
                    >
                      <ShoppingCart size={14} strokeWidth={2} />
                      {t('homeGrocery.newOrder', 'New order')}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <div className="hidden sm:block bg-card rounded-xl border border-border overflow-x-auto">
          <table className="w-full min-w-[920px]">
            <thead>
              <tr className="bg-surface-cream">
                <th className={th}>{t('customers.table.name')}</th>
                <th className={th}>{t('homeGrocery.household', 'Household')}</th>
                <th className={th}>{t('customers.table.phone')}</th>
                <th className={th}>{t('customers.table.email')}</th>
                <th className={th}>{t('customers.table.orders')}</th>
                <th className={th}>{t('homeGrocery.since', 'Since')}</th>
                <th className={th}>{t('customers.table.status')}</th>
                <th className={th}>{t('customers.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {leadRows.map((l) => (
                <tr key={`req-${l.id}`} className="border-t border-border bg-warning-bg/30">
                  <td className="px-4 py-3 text-sm font-semibold font-display text-ink">
                    <span className="flex items-center gap-2">
                      {l.name}
                      {/* Says up front whether approving links or opens. */}
                      {l.account ? (
                        <span className="inline-flex items-center h-5 px-1.5 rounded text-[11px] font-bold uppercase tracking-wide bg-success-bg text-success shrink-0">
                          {t('homeGrocery.hasAccount', 'Has account')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center h-5 px-1.5 rounded text-[11px] font-bold uppercase tracking-wide bg-warning-bg text-warning shrink-0">
                          {t('b2bDirectory.noAccount', 'No account')}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink whitespace-nowrap">
                    {l.household_size} · {t(`homeGrocery.frequency.${l.frequency}`, l.frequency)}
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-gray">{l.phone || '—'}</td>
                  <td className="px-4 py-3 text-sm font-mono text-gray">{l.email || '—'}</td>
                  <td className="px-4 py-3 text-sm text-muted">{'—'}</td>
                  <td className="px-4 py-3 text-sm text-gray whitespace-nowrap">{fmt(l.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-warning-bg text-warning">
                      {t('homeGrocery.pending', 'Pending')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setDrawerId(l.id)}
                        className="p-1.5 rounded-lg text-muted hover:text-brand hover:bg-brand-mist/40 transition-colors"
                        aria-label={t('homeGrocery.viewRequest', 'View request')}
                      >
                        <Eye size={16} strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setModal({ lead: l, mode: 'approve' })}
                        className="h-8 px-2.5 rounded-lg bg-brand hover:bg-brand-mid text-white text-xs font-semibold font-display inline-flex items-center gap-1.5"
                      >
                        <Check size={13} strokeWidth={2.5} />
                        {t('b2bDirectory.approve', 'Approve')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setModal({ lead: l, mode: 'reject' })}
                        className="h-8 px-2.5 rounded-lg border border-border text-danger text-xs font-semibold font-display hover:border-danger transition-colors inline-flex items-center gap-1.5"
                      >
                        <XIcon size={13} strokeWidth={2.5} />
                        {t('b2bDirectory.reject', 'Reject')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setClosing(l)}
                        title={t('homeGrocery.close.hint', 'Close without replying — a duplicate or a test')}
                        className="h-8 px-2.5 rounded-lg text-gray text-xs font-semibold font-display hover:text-ink hover:bg-surface-linen transition-colors inline-flex items-center gap-1.5"
                      >
                        <Archive size={13} strokeWidth={2} />
                        {t('homeGrocery.close.action', 'Close')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {users.map((u) => (
                <tr key={`user-${u.id}`} className="border-t border-border hover:bg-brand-mist/30 transition">
                  <td className="px-4 py-3 text-sm font-semibold font-display text-ink">
                    <span className="flex items-center gap-2">
                      {u.name}
                      <AccountTypeBadge isBusiness={u.is_business} />
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink whitespace-nowrap">
                    {/* A client staff opened before the revamp has no profile —
                        a dash, not an invented household. */}
                    {u.home_grocery
                      // The plan's cadence once there is one; the request's before.
                      ? `${u.home_grocery.household_size} · ${t(`homeGrocery.frequency.${u.home_grocery_plan?.frequency ?? u.home_grocery.frequency}`, u.home_grocery_plan?.frequency ?? u.home_grocery.frequency)}`
                      : '—'}
                  </td>
                  {/* The number on their form comes before the address one:
                      it is the one they gave us to reach them. */}
                  <td className="px-4 py-3 text-sm font-mono text-gray">
                    {u.phone || u.home_grocery?.contact_phone || u.address_phone || u.contact_phone || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-gray">{u.email || '—'}</td>
                  <td className="px-4 py-3 text-sm font-semibold text-ink">{u.purchase_count ?? u._count.orders}</td>
                  <td className="px-4 py-3 text-sm text-gray whitespace-nowrap">{fmt(u.home_grocery?.approved_at ?? u.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide ${
                      u.status === 'blocked' ? 'bg-danger-bg text-danger' : 'bg-success-bg text-success'
                    }`}>
                      {u.status === 'blocked'
                        ? t('customers.blocked', 'Blocked')
                        : t('homeGrocery.subscriber', 'Subscriber')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => navigate(`/customers/${u.id}`)}
                        className="p-1.5 rounded-lg text-muted hover:text-brand hover:bg-brand-mist/40 transition-colors"
                        aria-label={t('customers.table.view', 'View')}
                      >
                        <Eye size={16} strokeWidth={1.75} />
                      </button>
                      {/* Built here, an order is staff-built for a retail
                          buyer — which is exactly the Home Grocery book. */}
                      {u.status !== 'blocked' && (
                        <button
                          type="button"
                          onClick={() => navigate(`/customers/${u.id}/orders/new`)}
                          className="h-8 px-2.5 rounded-lg border border-border text-ink text-xs font-semibold font-display hover:border-brand hover:text-brand transition-colors inline-flex items-center gap-1.5"
                        >
                          <ShoppingCart size={13} strokeWidth={2} />
                          {t('homeGrocery.newOrder', 'New order')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {!isLoading && userData && (
        <>
          {openLeads.length > 0 && (
            <p className="mt-4 text-sm font-body text-gray">
              {t('homeGrocery.openCount', '{{count}} requests waiting above, pinned to this page', { count: openLeads.length })}
            </p>
          )}
          <Pagination
            page={page}
            totalPages={userData.totalPages ?? 1}
            onPageChange={setPage}
            totalItems={userData.total}
            pageSize={PAGE_SIZE}
            className="mt-2"
          />
        </>
      )}

      {modal && (
        <HomeGroceryDecisionModal
          mode={modal.mode}
          lead={modal.lead}
          isSubmitting={submitting}
          errorMessage={modal.error}
          onCancel={() => setModal(null)}
          onSubmit={submit}
        />
      )}

      <ConfirmModal
        open={!!closing}
        title={t('homeGrocery.close.title', 'Close this request without replying?')}
        message={t(
          'homeGrocery.close.body',
          "{{name}}'s request leaves the queue and nothing is sent to them. Use it for a duplicate or a test — it stays in All requests.",
          { name: closing?.name ?? '' },
        )}
        confirmLabel={closeLead.isPending ? t('homeGrocery.close.closing', 'Closing…') : t('homeGrocery.close.confirm', 'Close request')}
        cancelLabel={t('common.cancel', 'Cancel')}
        confirmDisabled={closeLead.isPending}
        onConfirm={confirmClose}
        onCancel={() => setClosing(null)}
      />

      <RashanLeadDrawer
        id={drawerId}
        onClose={() => setDrawerId(null)}
        onDecide={(lead, mode) => { setDrawerId(null); setModal({ lead, mode }); }}
      />
    </div>
  );
}
