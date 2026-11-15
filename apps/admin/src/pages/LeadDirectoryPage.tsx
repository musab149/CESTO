import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, Check, X as XIcon, Eye, Building2, KeyRound } from 'lucide-react';
import {
  useAdminLeads, useAdminUsers, useApproveBusiness, useApprovePartner, useRejectPartner,
  type AdminUserSegment, type B2bLead, type B2bLeadType,
} from '@grocery-app/shared';
import PartnerApprovalModal, { type PartnerApprovalMode } from '@/components/PartnerApprovalModal';
import LinkPartnerDialog from '@/components/partner/LinkPartnerDialog';
import PartnerCredentialsDialog from '@/components/partner/PartnerCredentialsDialog';
import { useToast } from '@/components/Toast';
import { TableSkeleton } from '@/components/Skeleton';
import AccountTypeBadge from '@/components/AccountTypeBadge';
import Pagination from '@/components/Pagination';
import EmptyState from '@/components/EmptyState';

const PAGE_SIZE = 20;

interface Props {
  /** Which funnel supplies the open leads. */
  leadType: B2bLeadType;
  /** Which accounts those leads turn into. */
  segment: AdminUserSegment;
  /**
   * What approving one does. `approve-business` makes a wholesale account;
   * `approve` additionally creates a Store and makes them its owner, which is
   * why the modal shows a different form for each.
   */
  approvalMode: 'approve-business' | 'approve';
  /** Column header over the lead's company / the account's store. */
  secondColumnKey: string;
  secondColumnFallback: string;
  /** Badge on an account row — what the lead has become. */
  accountBadgeKey: string;
  accountBadgeFallback: string;
  searchKey: string;
  searchFallback: string;
  emptyTitleKey: string;
  emptyTitleFallback: string;
  emptyBodyKey: string;
  emptyBodyFallback: string;
  /**
   * The Vendors tab registers "Add partner" here: giving somebody a store
   * without an application (LinkPartnerDialog). Absent on the B2B tab, whose
   * accounts are made on the New client page.
   */
  registerCreate?: (open: () => void) => void;
}

/**
 * A pipeline and the accounts it produces, as one list.
 *
 * A lead is an account that has not been approved yet — the same company at
 * two points in its life, not two things to manage in two places. Open leads
 * sit at the top because they are what needs doing; the accounts follow.
 * Approving does not move a row between screens, it changes what the row is.
 *
 * Shared by the B2B and Partners tabs because the shape is identical and only
 * the funnel, the approval and the wording differ. The two diverge in exactly
 * one way that matters: a partner approval also creates a Store, which is why
 * the modal takes a different mode rather than this page taking a flag.
 */
export default function LeadDirectoryPage({
  leadType, segment, approvalMode,
  secondColumnKey, secondColumnFallback,
  accountBadgeKey, accountBadgeFallback,
  searchKey, searchFallback,
  emptyTitleKey, emptyTitleFallback,
  emptyBodyKey, emptyBodyFallback,
  registerCreate,
}: Props) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<
    { lead: B2bLead; mode: PartnerApprovalMode; error?: string | null } | null
  >(null);
  // Partners only: give somebody a store; send a partner their login again.
  const isPartners = segment === 'partner';
  const [linkOpen, setLinkOpen] = useState(false);
  const [resendFor, setResendFor] = useState<{ id: string; name: string; email: string | null } | null>(null);
  useEffect(() => { registerCreate?.(() => setLinkOpen(true)); });

  // Leads are a pipeline, not an archive — there are only ever a handful open,
  // so they are fetched whole and the paging belongs to the accounts.
  // `open: true` filters SERVER-side. Filtering a fetched page in the browser
  // truncated silently: production holds 118 business leads, this asked for
  // 100, and 15 open ones were cut before the filter ever saw them.
  const { data: leadData, isLoading: leadsLoading } = useAdminLeads({
    type: leadType, open: true, limit: 200,
  });
  const { data: userData, isLoading: usersLoading } = useAdminUsers({
    segment,
    q: search.trim() || undefined,
    page,
    limit: PAGE_SIZE,
  });

  const approveBusiness = useApproveBusiness();
  const approvePartner = useApprovePartner();
  const rejectLead = useRejectPartner();
  const submitting = approveBusiness.isPending || approvePartner.isPending || rejectLead.isPending;

  const openLeads = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (leadData?.items ?? []).filter((l) => !term
      || l.name.toLowerCase().includes(term)
      || l.company.toLowerCase().includes(term)
      || l.email.toLowerCase().includes(term));
  }, [leadData, search]);

  const users = userData?.items ?? [];
  const isLoading = leadsLoading || usersLoading;

  // Open leads are pinned to the top of the first page only. They are the head
  // of the pipeline, not rows of the account list, so repeating them above
  // page 2 would be noise.
  const leadRows = page === 1 ? openLeads : [];

  const fmt = (v: string | null | undefined) => (v
    ? new Date(v).toLocaleDateString(i18n.language === 'en' ? 'en-GB' : 'es-ES',
      { day: '2-digit', month: 'short', year: 'numeric' })
    : '\u2014');

  // The modal hands back a discriminated union, same as the leads board.
  const submit = async (sub: { mode: PartnerApprovalMode; payload: unknown }) => {
    if (!modal) return;
    const { lead } = modal;
    try {
      if (sub.mode === 'approve-business') {
        const res = await approveBusiness.mutateAsync({
          id: lead.id,
          payload: sub.payload as Parameters<typeof approveBusiness.mutateAsync>[0]['payload'],
        });
        toast.success(
          res.user_was_created
            ? t('b2bDirectory.approved', 'Approved. Business account created and credentials emailed.')
            : t('b2bDirectory.approvedLinked', 'Approved. Existing customer upgraded to a business account.'),
        );
      } else if (sub.mode === 'approve') {
        await approvePartner.mutateAsync({
          id: lead.id,
          payload: sub.payload as Parameters<typeof approvePartner.mutateAsync>[0]['payload'],
        });
        toast.success(t('b2bDirectory.approvedPartner',
          'Approved. Store created as a draft \u2014 the partner publishes it once they have added a delivery area.'));
      } else {
        await rejectLead.mutateAsync({
          id: lead.id,
          payload: sub.payload as Parameters<typeof rejectLead.mutateAsync>[0]['payload'],
        });
        toast.success(t('b2bDirectory.rejected', 'Rejection recorded.'));
      }
      setModal(null);
    } catch (e) {
      setModal({ ...modal, error: e instanceof Error ? e.message : 'Action failed.' });
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder={t(searchKey, searchFallback)}
            className="w-full h-10 bg-surface-cream border border-border rounded-lg pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={5} cols={7} />
      ) : leadRows.length === 0 && users.length === 0 ? (
        <EmptyState
          icon={<Building2 size={22} strokeWidth={1.75} />}
          title={t(emptyTitleKey, emptyTitleFallback)}
          description={t(emptyBodyKey, emptyBodyFallback)}
        />
      ) : (
        <>
        {/* ON A PHONE (2026-11-05): a list — the table needed 1108px (B2B) and
            1010px (Partners) and hid the order count, the status and every
            action (approve, reject, view, send login again) off to the right.
            Same rows, same handlers: tapping an account opens it (the eye
            button). A lead has no page, so its row is not a button and its
            phone number can be a tel: link. The table from sm. */}
        <ul className="sm:hidden bg-card rounded-xl border border-border divide-y divide-border overflow-hidden">
          {leadRows.map((l) => (
            <li key={`lead-${l.id}`} className="px-4 py-3 bg-warning-bg/30">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold font-display text-ink truncate">{l.name}</span>
                <span className="inline-flex items-center h-5 px-1.5 rounded text-[11px] font-bold uppercase tracking-wide bg-surface-cream text-gray shrink-0">
                  {t('b2bDirectory.noAccount', 'No account')}
                </span>
                <span className="ml-auto inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-warning-bg text-warning shrink-0">
                  {t(`b2bDirectory.status.${l.status}`, l.status)}
                </span>
              </div>
              {l.company && (
                <p className="text-[13px] text-ink truncate mt-0.5">{l.company}</p>
              )}
              {(l.phone || l.email) && (
                <div className="flex items-center gap-2 min-w-0 text-[12.5px] text-muted mt-0.5">
                  {l.phone && (
                    <a
                      href={`tel:${l.phone.replace(/[^\d+]/g, '')}`}
                      className="shrink-0 py-2.5 -my-2.5 font-mono text-brand hover:text-brand-ink"
                    >
                      {l.phone}
                    </a>
                  )}
                  {l.phone && l.email && <span aria-hidden="true">{'·'}</span>}
                  {l.email && <span className="min-w-0 truncate">{l.email}</span>}
                </div>
              )}
              <p className="text-[11.5px] text-muted mt-1">
                {t('customers.table.registered')}: {fmt(l.created_at)}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <button
                  type="button"
                  onClick={() => setModal({ lead: l, mode: approvalMode })}
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
              </div>
            </li>
          ))}

          {users.map((u) => {
            const second = u.company || u.partner_roles?.[0]?.store?.name;
            const phone = u.phone || u.contact_phone || u.address_phone;
            return (
              <li key={`user-${u.id}`} className="flex items-center">
                <button
                  type="button"
                  onClick={() => navigate(`/customers/${u.id}`)}
                  className="flex-1 min-w-0 text-left px-4 py-3 hover:bg-brand-mist/30 transition-colors"
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
                  {second && (
                    <p className="text-[13px] text-ink truncate mt-0.5">{second}</p>
                  )}
                  {(phone || u.email) && (
                    <p className="text-[12.5px] text-muted truncate mt-0.5">
                      {phone ? <span className="font-mono">{phone}</span> : null}
                      {phone && u.email ? '  ·  ' : null}
                      {u.email}
                    </p>
                  )}
                  <p className="text-[11.5px] text-muted mt-1">
                    {t('customers.table.registered')}: {fmt(u.created_at)}
                  </p>
                </button>
                {isPartners && u.email && u.status !== 'blocked' && (
                  <button
                    type="button"
                    onClick={() => setResendFor({ id: u.id, name: u.name, email: u.email })}
                    className="shrink-0 w-9 h-9 mr-3 rounded-lg flex items-center justify-center text-muted hover:text-brand hover:bg-brand-mist/40 transition-colors"
                    aria-label={t('partners.panel.resend', 'Send login again')}
                    title={t('partners.panel.resend', 'Send login again')}
                  >
                    <KeyRound size={18} strokeWidth={1.75} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <div className="hidden sm:block bg-card rounded-xl border border-border overflow-x-auto">
          <table className="w-full min-w-[840px]">
            <thead>
              <tr className="bg-surface-cream">
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.name')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t(secondColumnKey, secondColumnFallback)}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.phone')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.email')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.orders')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.registered')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.status')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {/* Leads first, tinted, because they are the only rows here that
                  are asking for something to be done. */}
              {leadRows.map((l) => (
                <tr key={`lead-${l.id}`} className="border-t border-border bg-warning-bg/30">
                  <td className="px-4 py-3 text-sm font-semibold font-display text-ink">
                    <span className="flex items-center gap-2">
                      {l.name}
                      <span className="inline-flex items-center h-5 px-1.5 rounded text-[11px] font-bold uppercase tracking-wide bg-warning-bg text-warning shrink-0">
                        {t('b2bDirectory.noAccount', 'No account')}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink">{l.company || '\u2014'}</td>
                  <td className="px-4 py-3 text-sm font-mono text-gray">{l.phone || '\u2014'}</td>
                  <td className="px-4 py-3 text-sm font-mono text-gray">{l.email || '\u2014'}</td>
                  <td className="px-4 py-3 text-sm text-muted">{'\u2014'}</td>
                  <td className="px-4 py-3 text-sm text-gray whitespace-nowrap">{fmt(l.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-warning-bg text-warning">
                      {t(`b2bDirectory.status.${l.status}`, l.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setModal({ lead: l, mode: approvalMode })}
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
                  {/* Company first, store second. This column is the trading
                      name on the B2B tab and the shop on the Partners tab, and
                      it only ever read partner_roles \u2014 which a wholesale BUYER
                      never has, so every B2B row showed a dash while the name
                      sat on BusinessProfile. A partner has no company row, so
                      one expression serves both tabs. */}
                  <td className="px-4 py-3 text-sm text-ink">
                    {u.company || u.partner_roles?.[0]?.store?.name || '\u2014'}
                  </td>
                  {/* Falls back to the BUSINESS contact number, because for a
                      wholesale account that is usually the only one on file:
                      approving a lead writes it to BusinessProfile and leaves
                      User.phone null. Showing a dash while the number sits one
                      table over is what made every B2B row look unreachable. */}
                  <td className="px-4 py-3 text-sm font-mono text-gray">{u.phone || u.contact_phone || u.address_phone || '\u2014'}</td>
                  <td className="px-4 py-3 text-sm font-mono text-gray">{u.email || '\u2014'}</td>
                  {/* Purchases, not Order rows — a split checkout is several
                      rows and one purchase. Same source and same reasoning as
                      the customers list; the fallback keeps an older API
                      rendering the old number rather than nothing. */}
                  <td className="px-4 py-3 text-sm font-semibold text-ink">{u.purchase_count ?? u._count.orders}</td>
                  <td className="px-4 py-3 text-sm text-gray whitespace-nowrap">{fmt(u.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide ${
                      u.status === 'blocked' ? 'bg-danger-bg text-danger' : 'bg-success-bg text-success'
                    }`}>
                      {u.status === 'blocked'
                        ? t('customers.blocked', 'Blocked')
                        : t(accountBadgeKey, accountBadgeFallback)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => navigate(`/customers/${u.id}`)}
                        className="p-1.5 rounded-lg text-muted hover:text-brand hover:bg-brand-mist/40 transition-colors"
                        aria-label={t('customers.table.view', 'View')}
                        title={t('customers.table.view', 'View')}
                      >
                        <Eye size={16} strokeWidth={1.75} />
                      </button>
                      {isPartners && u.email && u.status !== 'blocked' && (
                        <button
                          type="button"
                          onClick={() => setResendFor({ id: u.id, name: u.name, email: u.email })}
                          className="p-1.5 rounded-lg text-muted hover:text-brand hover:bg-brand-mist/40 transition-colors"
                          aria-label={t('partners.panel.resend', 'Send login again')}
                          title={t('partners.panel.resend', 'Send login again')}
                        >
                          <KeyRound size={16} strokeWidth={1.75} />
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

      {/* Open leads are pinned to page 1 and are not part of the accounts
          paging, so the strip says how many accounts there are and the line
          above it accounts for the leads. Reporting the account total alone
          made a tab holding 61 leads and 38 accounts read as "38 showing". */}
      {!isLoading && userData && (
        <>
          {openLeads.length > 0 && (
            <p className="mt-4 text-sm font-body text-gray">
              {t('b2bDirectory.openCount', '{{count}} open above, pinned to this page', { count: openLeads.length })}
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

      {isPartners && (
        <>
          <LinkPartnerDialog open={linkOpen} onClose={() => setLinkOpen(false)} />
          <PartnerCredentialsDialog partner={resendFor} onClose={() => setResendFor(null)} />
        </>
      )}

      {modal && (
        <PartnerApprovalModal
          open
          mode={modal.mode}
          lead={modal.lead}
          isSubmitting={submitting}
          errorMessage={modal.error}
          onCancel={() => setModal(null)}
          onSubmit={submit}
        />
      )}
    </div>
  );
}
