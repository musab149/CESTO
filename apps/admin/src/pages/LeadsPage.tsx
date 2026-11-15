import { useEffect, useMemo, useState } from 'react';
import {
  Search, Inbox, X, Mail, Phone, Globe, MapPin, FileText, Building2, User,
  CheckCircle2, MessageSquare, Save, Store, ExternalLink, XCircle, Clock,
} from 'lucide-react';
import {
  useAdminLeads, useAdminLead, useUpdateAdminLead,
  useApprovePartner,
  useApproveBusiness, useRequestPartnerInfo, useRejectPartner,
  type B2bLead, type B2bLeadStatus, type B2bLeadType, type B2bLeadApprovalStatus,
} from '@grocery-app/shared';
import { TableSkeleton } from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import Pagination from '@/components/Pagination';
import PartnerApprovalModal, { type PartnerApprovalMode } from '@/components/PartnerApprovalModal';
import { useToast } from '@/components/Toast';

// MV Slice 1 · client flag mirror REMOVED (2026-07-20). The server-side
// MV_PARTNER_APPROVAL gate on /api/admin/leads/:id/{approve,request-info,reject}
// is authoritative — the Vercel env-var mirror kept failing to bake in on
// staging redeploys, blocking the button UI even though the API was live.
// Buttons now render for every partner-type lead in a non-terminal approval
// state; on a prod deploy where the server flag is still OFF, clicks return
// a legible 404 from `requireMvFlag('partnerApproval')` instead of silently
// failing. When promoting to master, remember to flip MV_PARTNER_APPROVAL=true
// on the prod API so the buttons do something.
// (Kept the VITE_ env var reference for legacy compat; the value is ignored.)

const APPROVAL_LABELS: Record<B2bLeadApprovalStatus, string> = {
  pending_review: 'Pending review',
  approved:       'Approved',
  needs_info:     'Awaiting info',
  rejected:       'Rejected',
};

const APPROVAL_CLASSES: Record<B2bLeadApprovalStatus, string> = {
  pending_review: 'bg-cool-mist text-cool-deep',
  approved:       'bg-success-bg text-success',
  needs_info:     'bg-amber-mist text-amber-deep',
  rejected:       'bg-danger-bg text-danger',
};

/** Terminal states — no more approval actions available. */
function isApprovalTerminal(s: B2bLeadApprovalStatus | undefined): boolean {
  return s === 'approved' || s === 'rejected';
}

/** 'contact' and 'quotation' leads have no approval workflow — just triage. */
function hasApprovalFlow(type: B2bLeadType): boolean {
  return type !== 'contact' && type !== 'quotation';
}

const PAGE_SIZE = 20;

const TYPE_LABELS: Record<B2bLeadType, string> = {
  business:      'Business',
  partner_store: 'Partner store',
  contact:       'Contact',
  quotation:     'Quotation request',
};

/**
 * Top-level funnel split. These are genuinely different products with
 * different approval outcomes, so they get separate tabs rather than a
 * dropdown filter — an admin should never be one mis-click away from
 * creating a Store for a wholesale buyer.
 *
 *   business      → approval creates a User + BusinessProfile with B2B
 *                   pricing. No store, no dashboard.
 *   partner_store → approval creates a Store + PartnerStoreRole.
 *   contact       → sales-modal enquiries. No approval path, but they still
 *                   need somewhere to live or they'd be invisible.
 */
const FUNNEL_TABS: { key: B2bLeadType; label: string; blurb: string }[] = [
  { key: 'business',      label: 'B2B leads',     blurb: 'Wholesale buyers applying for a business account with B2B pricing.' },
  { key: 'partner_store', label: 'Partner deals', blurb: 'Shops applying to sell on Cesto. Approval creates their store.' },
  { key: 'contact',       label: 'Enquiries',     blurb: 'Sales enquiries from the contact modal. No approval flow.' },
  { key: 'quotation',     label: 'Quotations',    blurb: 'Product quotation requests from the product page. No approval flow.' },
];

const STATUS_ORDER: B2bLeadStatus[] = ['new', 'contacted', 'qualified', 'closed', 'archived'];
const STATUS_LABELS: Record<B2bLeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  closed: 'Closed',
  archived: 'Archived',
};

const STATUS_CLASSES: Record<B2bLeadStatus, string> = {
  new:        'bg-info-bg text-info',
  contacted:  'bg-amber-mist text-amber-deep',
  qualified:  'bg-success-bg text-success',
  closed:     'bg-surface-sand text-gray',
  archived:   'bg-surface-sand text-muted',
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatRelative(iso: string) {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return formatDateTime(iso).split(',')[0];
}

/**
 * One funnel board, pointed at a subset of the lead types.
 *
 * B2bLead is one table holding four unrelated things — wholesale buyers,
 * shops applying to sell, sales enquiries, quote requests. The B2B section
 * owns the two that are B2B; /leads keeps the rest. Passing the list in beats
 * a second copy of a 600-line board.
 */
export default function LeadsPage(
  { types, embedded }: { types?: B2bLeadType[]; embedded?: boolean } = {},
) {
  const toast = useToast();
  const [search, setSearch]   = useState('');
  const [status, setStatus]   = useState<B2bLeadStatus | 'all'>('all');
  // Funnel tab, not a filter — always exactly one type in view. Defaults to
  // the business queue since that's the higher-volume inbox.
  const tabs = types?.length
    ? FUNNEL_TABS.filter((tab) => types.includes(tab.key))
    : FUNNEL_TABS;
  const [type, setType]       = useState<B2bLeadType>(tabs[0]?.key ?? 'business');
  const [activeId, setActive] = useState<string | null>(null);
  const [page, setPage]       = useState(1);
  // MV Slice 1 · approval modal state. Single component handles all 3 intents.
  const [approvalModal, setApprovalModal] = useState<
    { lead: B2bLead; mode: PartnerApprovalMode; error?: string | null } | null
  >(null);

  const approveMut     = useApprovePartner();
  const approveBusinessMut = useApproveBusiness();
  const requestInfoMut = useRequestPartnerInfo();
  const rejectMut      = useRejectPartner();
  const approvalSubmitting = approveMut.isPending || approveBusinessMut.isPending || requestInfoMut.isPending || rejectMut.isPending;

  async function handleApprovalSubmit(
    submit: { mode: PartnerApprovalMode; payload: unknown },
  ) {
    if (!approvalModal) return;
    const { lead } = approvalModal;
    try {
      if (submit.mode === 'approve') {
        await approveMut.mutateAsync({ id: lead.id, payload: submit.payload as Parameters<typeof approveMut.mutateAsync>[0]['payload'] });
        toast.success(`Approved ${lead.company || lead.name}. Credentials emailed. Store created as a draft — the partner publishes it once they've added a delivery area.`);
      } else if (submit.mode === 'approve-business') {
        const res = await approveBusinessMut.mutateAsync({ id: lead.id, payload: submit.payload as Parameters<typeof approveBusinessMut.mutateAsync>[0]['payload'] });
        toast.success(
          res.user_was_created
            ? `Approved ${lead.company || lead.name}. Business account created and credentials emailed.`
            : `Approved ${lead.company || lead.name}. Existing customer upgraded to a business account; credentials emailed.`,
        );
      } else if (submit.mode === 'request-info') {
        await requestInfoMut.mutateAsync({ id: lead.id, payload: submit.payload as Parameters<typeof requestInfoMut.mutateAsync>[0]['payload'] });
        toast.success(`Info requested from ${lead.name}. Magic link emailed.`);
      } else {
        await rejectMut.mutateAsync({ id: lead.id, payload: submit.payload as Parameters<typeof rejectMut.mutateAsync>[0]['payload'] });
        toast.success(`Rejection recorded. ${lead.name} notified.`);
      }
      setApprovalModal(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Action failed.';
      setApprovalModal({ ...approvalModal, error: msg });
    }
  }

  const params = useMemo(() => ({
    q: search.trim() || undefined,
    status: status === 'all' ? undefined : status,
    type,
    page,
    limit: PAGE_SIZE,
  }), [search, status, type, page]);

  const { data, isLoading } = useAdminLeads(params);

  // Filter change → reset page. Otherwise a filter cull can strand the
  // admin on an empty page.
  useEffect(() => { setPage(1); }, [search, status, type]);
  function handlePageChange(p: number) {
    setPage(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const items = data?.items ?? [];
  const counts = data?.counts ?? {};

  // Convenience: clear active selection if the active id falls out of the
  // current filtered set.
  useEffect(() => {
    if (activeId && !items.some((l) => l.id === activeId)) setActive(null);
  }, [items, activeId]);

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        {!embedded && (
          <h1 className="text-2xl font-bold font-display text-ink">
            {tabs.find((t) => t.key === type)?.label ?? 'Leads'}
          </h1>
        )}
        <p className="text-sm text-muted mt-0.5">
          {tabs.find((t) => t.key === type)?.blurb}
        </p>
      </div>

      {/* Funnel tabs — business vs partner_store are different products with
          different approval outcomes, so they're separated at the top level
          rather than buried in a filter dropdown. */}
      <div className={`flex flex-wrap items-center gap-1 mb-5 border-b border-border ${tabs.length < 2 ? 'hidden' : ''}`}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setType(t.key)}
            className={`relative -mb-px px-4 h-10 text-sm font-semibold font-display transition ${
              type === t.key
                ? 'text-brand border-b-2 border-brand'
                : 'text-muted hover:text-ink border-b-2 border-transparent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <StatusTab
          label="All"
          count={Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)}
          active={status === 'all'}
          onClick={() => setStatus('all')}
        />
        {STATUS_ORDER.map((s) => (
          <StatusTab
            key={s}
            label={STATUS_LABELS[s]}
            count={counts[s] ?? 0}
            active={status === s}
            onClick={() => setStatus(s)}
          />
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" strokeWidth={1.75} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, company or email"
            className="w-full bg-surface-cream border border-border rounded-lg h-11 pl-10 pr-4 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
          />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Inbox size={28} strokeWidth={1.75} className="text-muted" />}
          title="No leads yet"
          description={
            search || status !== 'all'
              ? 'No leads match these filters.'
              : tabs.find((t) => t.key === type)?.blurb ?? 'Nothing here yet.'
          }
        />
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {/* ON A PHONE (2026-11-05): a list — the table needed 720px and hid
              the status, Approve / Request info / Reject and Open off to the
              right. A row opens the drawer (the row and Open → in the table);
              the approval buttons sit under it, same modal, same condition.
              The table from sm. */}
          <ul className="sm:hidden divide-y divide-border">
            {items.map((lead) => {
              const canDecide = hasApprovalFlow(lead.type) && !isApprovalTerminal(lead.approval_status);
              return (
                <li key={lead.id}>
                  <button
                    type="button"
                    onClick={() => setActive(lead.id)}
                    className={`w-full text-left px-4 pt-3 ${canDecide ? 'pb-2' : 'pb-3'} hover:bg-brand-mist/30 transition-colors ${
                      activeId === lead.id ? 'bg-brand-mist/40' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold font-display text-ink truncate">{lead.name}</span>
                      <span className={`inline-flex items-center h-5 px-1.5 rounded-full text-[11px] font-semibold font-display shrink-0 ${STATUS_CLASSES[lead.status]}`}>
                        {STATUS_LABELS[lead.status]}
                      </span>
                      <span className="ml-auto text-[11.5px] text-muted shrink-0" title={formatDateTime(lead.created_at)}>
                        {formatRelative(lead.created_at)}
                      </span>
                    </div>

                    {(lead.company || lead.email) && (
                      <p className="text-[12.5px] text-muted truncate mt-0.5">
                        {lead.company && <span className="text-ink">{lead.company}</span>}
                        {lead.company && lead.email ? '  ·  ' : null}
                        {lead.email}
                      </p>
                    )}

                    <div className="mt-1.5 flex items-center flex-wrap gap-1.5">
                      <TypeBadge type={lead.type} />
                      {hasApprovalFlow(lead.type) && lead.approval_status && lead.approval_status !== 'pending_review' && (
                        <span
                          className={`inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold font-display uppercase tracking-wide ${APPROVAL_CLASSES[lead.approval_status]}`}
                        >
                          {lead.approval_status === 'needs_info' && <Clock className="w-3 h-3" strokeWidth={2} />}
                          {APPROVAL_LABELS[lead.approval_status]}
                        </span>
                      )}
                    </div>
                  </button>

                  {canDecide && (
                    <div className="px-4 pb-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setApprovalModal({
                          lead,
                          mode: lead.type === 'business' ? 'approve-business' : 'approve',
                        })}
                        className="h-9 px-3 rounded-lg bg-brand hover:bg-brand-mid inline-flex items-center gap-1.5 text-xs font-semibold font-display text-white transition"
                        title={lead.type === 'business'
                          ? 'Approve business account + B2B pricing (no store)'
                          : 'Approve partner + create Store'}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2} />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => setApprovalModal({ lead, mode: 'request-info' })}
                        className="w-9 h-9 rounded-lg bg-warning-bg inline-flex items-center justify-center transition"
                        title="Request more information"
                        aria-label="Request more information"
                      >
                        <MessageSquare className="w-4 h-4 text-warning" strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setApprovalModal({ lead, mode: 'reject' })}
                        className="w-9 h-9 rounded-lg bg-danger-bg inline-flex items-center justify-center transition"
                        title="Reject application"
                        aria-label="Reject application"
                      >
                        <XCircle className="w-4 h-4 text-danger" strokeWidth={2} />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="hidden sm:block overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="bg-surface-cream">
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">Type</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">Contact</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">Company</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">Received</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((lead) => (
                <tr
                  key={lead.id}
                  className={`border-t border-border hover:bg-brand-mist/30 transition cursor-pointer ${
                    activeId === lead.id ? 'bg-brand-mist/40' : ''
                  }`}
                  onClick={() => setActive(lead.id)}
                >
                  <td className="px-4 py-3 text-sm">
                    <TypeBadge type={lead.type} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-ink">{lead.name}</div>
                    <div className="text-xs text-muted mt-0.5">{lead.email}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink">{lead.company}</td>
                  <td className="px-4 py-3 text-sm text-muted" title={formatDateTime(lead.created_at)}>
                    {formatRelative(lead.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span className={`inline-flex w-fit items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display ${STATUS_CLASSES[lead.status]}`}>
                        {STATUS_LABELS[lead.status]}
                      </span>
                      {/* Approval badge — both approvable funnels carry one. */}
                      {hasApprovalFlow(lead.type) && lead.approval_status && lead.approval_status !== 'pending_review' && (
                        <span
                          className={`inline-flex w-fit items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold font-display uppercase tracking-wide ${APPROVAL_CLASSES[lead.approval_status]}`}
                          title="MV partner approval state"
                        >
                          {lead.approval_status === 'needs_info' && <Clock className="w-3 h-3" strokeWidth={2} />}
                          {APPROVAL_LABELS[lead.approval_status]}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Approval actions. Both funnels share request-info and
                          reject; only the Approve button differs, because the
                          outcomes are completely different — a business gets an
                          account with B2B pricing, a partner_store gets a Store.
                          The button title says which, so an admin can't approve
                          the wrong thing without reading it. */}
                      {hasApprovalFlow(lead.type) && !isApprovalTerminal(lead.approval_status) && (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => setApprovalModal({
                              lead,
                              mode: lead.type === 'business' ? 'approve-business' : 'approve',
                            })}
                            className="h-8 px-2.5 rounded-lg bg-brand hover:bg-brand-mid inline-flex items-center gap-1 text-[11px] font-semibold font-display text-white transition"
                            title={lead.type === 'business'
                              ? 'Approve business account + B2B pricing (no store)'
                              : 'Approve partner + create Store'}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2} />
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => setApprovalModal({ lead, mode: 'request-info' })}
                            className="w-8 h-8 rounded-lg bg-warning-bg hover:bg-warning-bg/80 inline-flex items-center justify-center transition"
                            title="Request more information"
                          >
                            <MessageSquare className="w-3.5 h-3.5 text-warning" strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setApprovalModal({ lead, mode: 'reject' })}
                            className="w-8 h-8 rounded-lg hover:bg-danger-bg inline-flex items-center justify-center transition"
                            title="Reject application"
                          >
                            <XCircle className="w-3.5 h-3.5 text-danger" strokeWidth={2} />
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActive(lead.id); }}
                        className="text-xs font-bold font-display text-brand hover:text-brand-ink ml-1"
                      >
                        Open →
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
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

      {/* Detail drawer */}
      <LeadDetailDrawer id={activeId} onClose={() => setActive(null)} />

      {/* MV Slice 1 — approval modal */}
      {approvalModal && (
        <PartnerApprovalModal
          open
          mode={approvalModal.mode}
          lead={approvalModal.lead}
          isSubmitting={approvalSubmitting}
          errorMessage={approvalModal.error}
          onCancel={() => setApprovalModal(null)}
          onSubmit={handleApprovalSubmit}
        />
      )}
    </div>
  );
}

function StatusTab({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 px-3.5 inline-flex items-center gap-2 rounded-full text-xs font-bold font-display border transition-colors ${
        active
          ? 'bg-brand text-white border-brand'
          : 'bg-card text-ink border-border hover:border-brand hover:text-brand'
      }`}
    >
      {label}
      <span className={`text-[11px] tabular-nums ${active ? 'text-white/85' : 'text-muted'}`}>
        {count}
      </span>
    </button>
  );
}

function TypeBadge({ type }: { type: B2bLeadType }) {
  const cls = {
    business:      'bg-brand-mist text-brand',
    partner_store: 'bg-cool-mist text-cool-deep',
    contact:       'bg-amber-mist text-amber-deep',
    quotation:     'bg-success-bg text-success',
  }[type];
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display ${cls}`}>
      {TYPE_LABELS[type]}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────
   DETAIL DRAWER — full lead record + status / notes editor.
   ───────────────────────────────────────────────────────── */

function LeadDetailDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading } = useAdminLead(id);
  const update = useUpdateAdminLead();
  const [status, setStatus] = useState<B2bLeadStatus>('new');
  const [notes, setNotes]   = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!data) return;
    setStatus(data.status);
    setNotes(data.notes ?? '');
    setSavedAt(null);
  }, [data]);

  // Lock body scroll and close on Escape.
  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [id, onClose]);

  if (!id) return null;

  const dirty = !!data && (status !== data.status || (notes ?? '') !== (data.notes ?? ''));

  async function save() {
    if (!data || !dirty) return;
    await update.mutateAsync({
      id: data.id,
      payload: {
        status,
        notes: notes.trim() ? notes.trim() : null,
      },
    });
    setSavedAt(Date.now());
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close lead detail"
        onClick={onClose}
        className="absolute inset-0 bg-veil/40 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-[480px] bg-card shadow-[0_24px_60px_rgba(15,23,42,0.18)] flex flex-col">
        {isLoading || !data ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted">Loading…</div>
        ) : (
          <>
            <div className="px-6 py-5 border-b border-border flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <TypeBadge type={data.type} />
                  <span className="text-xs text-muted font-mono">{data.source}</span>
                </div>
                <h2 className="text-lg font-bold font-display text-ink leading-tight">
                  {data.name}
                </h2>
                <p className="text-sm text-gray mt-0.5">{data.company}</p>
                <p className="text-[11px] text-muted mt-1">
                  Received {formatDateTime(data.created_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 w-9 h-9 rounded-full border border-border text-ink hover:border-brand hover:text-brand flex items-center justify-center transition-colors"
              >
                <X size={16} strokeWidth={2.25} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Contact */}
              <Section title="Contact">
                <DetailRow icon={User}     label="Name"    value={data.name} />
                <DetailRow icon={Mail}     label="Email"   value={data.email} link={`mailto:${data.email}`} />
                <DetailRow icon={Phone}    label="Phone"   value={data.phone} link={`tel:${data.phone}`} />
                <DetailRow icon={Building2} label="Company" value={data.company} />
                {data.location && !data.shops?.length && (
                  <DetailRow icon={MapPin} label="Location" value={data.location} />
                )}
              </Section>

              {/* Shops (multi-location submissions) */}
              {data.shops && data.shops.length > 0 && (
                <Section title={`Shops (${data.shops.length})`}>
                  <ul className="space-y-3">
                    {data.shops.map((shop, i) => {
                      const hasCoords = typeof shop.lat === 'number' && typeof shop.lng === 'number';
                      const mapsUrl = shop.place_id
                        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shop.address)}&query_place_id=${encodeURIComponent(shop.place_id)}`
                        : hasCoords
                          ? `https://www.google.com/maps/search/?api=1&query=${shop.lat},${shop.lng}`
                          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shop.address)}`;
                      const meta = [shop.city, shop.postcode, shop.country].filter(Boolean).join(' · ');
                      return (
                        <li key={`${shop.place_id ?? shop.address}-${i}`} className="rounded-lg border border-border bg-surface-cream p-3">
                          <div className="flex items-start gap-2.5">
                            <Store size={14} strokeWidth={1.75} className="text-brand shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold text-ink font-display break-words">
                                {shop.name}
                              </p>
                              <p className="text-[12.5px] text-gray font-body break-words mt-0.5">
                                {shop.address}
                              </p>
                              {meta && (
                                <p className="text-[11px] text-muted font-mono mt-1">{meta}</p>
                              )}
                              <a
                                href={mapsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="-mt-0.5 -mb-2.5 py-2.5 inline-flex items-center gap-1 text-[12px] font-bold font-display text-brand hover:text-brand-ink"
                              >
                                Open in Maps
                                <ExternalLink size={11} strokeWidth={2.25} />
                              </a>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </Section>
              )}

              {/* Application extras (only when present) */}
              {(data.business_type || data.website || data.registration_no) && (
                <Section title="Business details">
                  {data.business_type && <DetailRow label="Business type" value={data.business_type} />}
                  {data.website && (
                    <DetailRow
                      icon={Globe}
                      label="Website"
                      value={data.website}
                      link={data.website.startsWith('http') ? data.website : `https://${data.website}`}
                    />
                  )}
                  {data.registration_no && (
                    <DetailRow icon={FileText} label="Registration #" value={data.registration_no} />
                  )}
                </Section>
              )}

              {/* Quotation details (quotation-request leads) */}
              {data.type === 'quotation' && (
                <Section title="Quotation">
                  <DetailRow label="Product" value={data.quote_product_name ?? '—'} />
                  <DetailRow label="Quantity" value={data.quote_quantity != null ? String(data.quote_quantity) : '—'} />
                </Section>
              )}

              {/* Message / intent (contact-modal leads) */}
              {(data.message || data.intent) && (
                <Section title="Message">
                  {data.intent && (
                    <p className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted font-display mb-2">
                      Reaching out as · {data.intent}
                    </p>
                  )}
                  {data.message && (
                    <div className="flex gap-2.5 items-start">
                      <MessageSquare size={14} strokeWidth={1.75} className="text-muted mt-0.5 shrink-0" />
                      <p className="text-sm text-ink font-body whitespace-pre-wrap leading-relaxed">
                        {data.message}
                      </p>
                    </div>
                  )}
                </Section>
              )}

              {/* Triage controls */}
              <Section title="Triage">
                <label className="block">
                  <span className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted font-display block mb-1.5">
                    Status
                  </span>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as B2bLeadStatus)}
                    className="w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <div className="flex items-center justify-between mb-1.5 mt-3">
                    <span className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted font-display">
                      Internal notes
                    </span>
                    <span className={`text-[11px] font-mono ${notes.length > 2000 ? 'text-danger font-bold' : 'text-muted'}`}>
                      {notes.length}/2000
                    </span>
                  </div>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={4}
                    maxLength={2100}
                    placeholder="Add a note for your team…"
                    aria-invalid={notes.length > 2000}
                    className={`w-full bg-surface-cream border rounded-lg px-3 py-2.5 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 transition resize-none ${
                      notes.length > 2000
                        ? 'border-danger focus:ring-danger/20 focus:border-danger'
                        : 'border-border focus:ring-brand/30 focus:border-brand'
                    }`}
                  />
                  {notes.length > 2000 && (
                    <p role="alert" className="mt-1 text-[12px] text-danger font-display font-medium">Maximum 2000 characters.</p>
                  )}
                </label>
              </Section>
            </div>

            <div className="px-6 py-4 border-t border-border bg-surface-cream flex items-center justify-between gap-3">
              <span className="text-xs text-muted font-display inline-flex items-center gap-1.5">
                {savedAt && Date.now() - savedAt < 4000 ? (
                  <>
                    <CheckCircle2 size={13} strokeWidth={2} className="text-success" />
                    Saved
                  </>
                ) : (
                  `Lead ID ${data.id.slice(0, 8)}…`
                )}
              </span>
              <button
                type="button"
                onClick={save}
                disabled={!dirty || update.isPending}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-brand text-white text-sm font-bold font-display hover:bg-brand-deepest transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save size={14} strokeWidth={2.25} />
                {update.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] font-bold tracking-[0.16em] uppercase text-muted font-display mb-3">
        {title}
      </h3>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function DetailRow({ icon: Icon, label, value, link }: {
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  value: string | null;
  link?: string;
}) {
  if (!value) return null;
  const content = (
    <span className="text-sm text-ink font-body break-words">{value}</span>
  );
  return (
    <div className="flex items-start gap-2.5">
      {Icon ? <Icon size={14} strokeWidth={1.75} className="text-muted shrink-0 mt-0.5" /> : <span className="w-3.5 shrink-0" />}
      <div className="min-w-0">
        <p className="text-[11px] text-muted font-display mb-0.5">{label}</p>
        {/* py-2 on an inline link grows the tap area (to call, to mail) to
            about 36px without changing the line it sits on. */}
        {link ? (
          <a href={link} target={link.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer"
            className="py-2 text-sm text-brand hover:text-brand-ink underline-offset-2 hover:underline break-words">
            {value}
          </a>
        ) : content}
      </div>
    </div>
  );
}
