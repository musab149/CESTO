import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, X, Save, CheckCircle2, Users, Phone, Mail, MapPin, CalendarClock,
  Wallet, MessageSquare, Clock, User, HeartHandshake, ArrowLeft, Check, XCircle,
  MessageCircle, ExternalLink, Archive,
} from 'lucide-react';
import {
  useAdminRashanLeads, useAdminRashanLead, useUpdateAdminRashanLead,
  type RashanLead, type RashanLeadStatus, type RashanLeadFrequency,
  type RashanLeadContactPref, type RashanLeadApprovalStatus,
} from '@grocery-app/shared';
import { TableSkeleton } from '@/components/Skeleton';
import { whatsappUrl } from '@/lib/whatsapp';
import ConfirmModal from '@/components/ConfirmModal';
import EmptyState from '@/components/EmptyState';
import Pagination from '@/components/Pagination';

/* ═══════════════════════════════════════════════════════
   ALL HOME GROCERY REQUESTS — every request ever sent from the
   form on /rashan: waiting, approved, rejected, and the ones ops
   closed without a decision.

   The working view is the Home Grocery tab under Users, which
   shows only what is waiting, above the subscribers it becomes.
   This page is the record — nothing sent is ever dropped from it.
   ═══════════════════════════════════════════════════════ */

const PAGE_SIZE = 20;

const STATUS_ORDER: RashanLeadStatus[] = [
  'new', 'contacted', 'qualified', 'converted', 'closed', 'archived',
];

const STATUS_LABELS: Record<RashanLeadStatus, string> = {
  new:       'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  converted: 'Converted',
  closed:    'Closed',
  archived:  'Archived',
};

const STATUS_CLASSES: Record<RashanLeadStatus, string> = {
  new:       'bg-info-bg text-info',
  contacted: 'bg-amber-mist text-amber-deep',
  qualified: 'bg-cool-mist text-cool-deep',
  converted: 'bg-success-bg text-success',
  closed:    'bg-surface-sand text-gray',
  archived:  'bg-surface-sand text-muted',
};

const FREQUENCY_LABELS: Record<RashanLeadFrequency, string> = {
  weekly:        'Every week',
  biweekly:      'Every 2 weeks',
  every_3_weeks: 'Every 3 weeks',
  monthly:       'Every 4 weeks',
};

const CONTACT_PREF_LABELS: Record<RashanLeadContactPref, string> = {
  whatsapp: 'WhatsApp',
  call:     'Phone call',
  sms:      'SMS',
  email:    'Email',
};

const FREQUENCY_FILTERS: { value: 'all' | RashanLeadFrequency; label: string }[] = [
  { value: 'all', label: 'All frequencies' },
  ...(Object.keys(FREQUENCY_LABELS) as RashanLeadFrequency[]).map((f) => ({
    value: f, label: FREQUENCY_LABELS[f],
  })),
];

const APPROVAL_LABELS: Record<RashanLeadApprovalStatus, string> = {
  pending_review: 'Pending',
  approved:       'Approved',
  rejected:       'Rejected',
};

const APPROVAL_CLASSES: Record<RashanLeadApprovalStatus, string> = {
  pending_review: 'bg-amber-mist text-amber-deep',
  approved:       'bg-success-bg text-success',
  rejected:       'bg-danger-bg text-danger',
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatRelative(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return formatDateTime(iso).split(',')[0];
}

/** "4 (2 adults · 2 children)" when we have the split, otherwise just the size. */
function householdLabel(lead: RashanLead): string {
  if (lead.adults == null && lead.children == null) return String(lead.household_size);
  return `${lead.household_size} (${lead.adults ?? '?'} adults · ${lead.children ?? '?'} children)`;
}

export default function RashanLeadsPage() {
  const [search, setSearch]       = useState('');
  const [status, setStatus]       = useState<RashanLeadStatus | 'all'>('all');
  const [frequency, setFrequency] = useState<'all' | RashanLeadFrequency>('all');
  const [activeId, setActive]     = useState<string | null>(null);
  const [page, setPage]           = useState(1);

  const params = useMemo(() => ({
    q: search.trim() || undefined,
    status: status === 'all' ? undefined : status,
    frequency: frequency === 'all' ? undefined : frequency,
    page,
    limit: PAGE_SIZE,
  }), [search, status, frequency, page]);

  const { data, isLoading } = useAdminRashanLeads(params);

  // Filter change → back to page 1, otherwise a cull can strand you on an
  // empty page.
  useEffect(() => { setPage(1); }, [search, status, frequency]);

  const items  = data?.items ?? [];
  const counts = data?.counts ?? {};

  useEffect(() => {
    if (activeId && !items.some((l) => l.id === activeId)) setActive(null);
  }, [items, activeId]);

  function handlePageChange(p: number) {
    setPage(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div>
      <div className="mb-5">
        {/* 36px tall (py-2) for a thumb; -mt-2 and no mb pay it back, so the
            title sits exactly where the old mb-2 put it. */}
        <Link
          to="/users?tab=rashan"
          className="inline-flex items-center gap-1.5 text-sm font-semibold font-display text-muted hover:text-brand py-2 -mt-2 px-1 -mx-1"
        >
          <ArrowLeft size={15} strokeWidth={1.75} />
          Home Grocery
        </Link>
        <h1 className="text-2xl font-bold font-display text-ink">All Home Grocery requests</h1>
        <p className="text-sm text-muted mt-0.5">
          Every request from the website form — waiting, approved, rejected or closed. Decide waiting ones from the Home Grocery tab.
        </p>
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
            placeholder="Search by name, phone, email, city or postcode"
            className="w-full bg-surface-cream border border-border rounded-lg h-11 pl-10 pr-4 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
          />
        </div>
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as 'all' | RashanLeadFrequency)}
          className="h-11 bg-surface-cream border border-border rounded-lg px-3 text-sm font-display text-ink cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          {FREQUENCY_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<HeartHandshake size={28} strokeWidth={1.75} className="text-muted" />}
          title="No rashan requests yet"
          description={
            search || status !== 'all' || frequency !== 'all'
              ? 'No requests match these filters.'
              : 'Submissions from the "tell us what your family needs" form on /rashan land here.'
          }
        />
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {/* ON A PHONE (2026-11-05): a list — the table needed 900px and hid
              the area, the decision and Open off to the right. A row opens the
              request drawer, as the table row and its Open → do; the table
              from sm. */}
          <ul className="sm:hidden divide-y divide-border">
            {items.map((lead) => {
              const area = [lead.postcode, lead.city].filter(Boolean).join(' · ');
              return (
                <li key={lead.id}>
                  <button
                    type="button"
                    onClick={() => setActive(lead.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-brand-mist/30 transition-colors ${
                      activeId === lead.id ? 'bg-brand-mist/40' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold font-display text-ink truncate">{lead.name}</span>
                      <span className="shrink-0"><ApprovalPill status={lead.approval_status} closed={isClosed(lead)} /></span>
                      <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-mist text-brand text-xs font-bold font-display tabular-nums shrink-0">
                        <Users className="w-3 h-3" strokeWidth={2} />
                        {lead.household_size}
                      </span>
                    </div>

                    <p className="text-[12.5px] text-muted truncate mt-0.5">
                      <span className="font-mono">{lead.phone}</span>
                      {area ? `  ·  ${area}` : null}
                    </p>

                    <div className="text-[11.5px] text-muted font-display mt-1 flex items-center flex-wrap gap-x-1.5 gap-y-1">
                      <span>{FREQUENCY_LABELS[lead.frequency]}</span>
                      {lead.adults != null && lead.children != null && (
                        <span>{'·'} {lead.adults}A · {lead.children}N</span>
                      )}
                      <span title={formatDateTime(lead.created_at)}>{'·'} {formatRelative(lead.created_at)}</span>
                      <span className={`ml-auto inline-flex items-center h-5 px-1.5 rounded-full text-[11px] font-semibold ${STATUS_CLASSES[lead.status]}`}>
                        {STATUS_LABELS[lead.status]}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="bg-surface-cream">
                  {['Household', 'Contact', 'Frequency', 'Area', 'Received', 'Decision', 'Status', ''].map((h, i) => (
                    <th
                      key={h || `sp-${i}`}
                      className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display"
                    >
                      {h}
                    </th>
                  ))}
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
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-mist text-brand text-xs font-bold font-display tabular-nums">
                          <Users className="w-3 h-3" strokeWidth={2} />
                          {lead.household_size}
                        </span>
                        {lead.adults != null && lead.children != null && (
                          <span className="text-xs text-muted font-display">
                            {lead.adults}A · {lead.children}N
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-ink">{lead.name}</div>
                      <div className="text-xs text-muted mt-0.5 font-mono">{lead.phone}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink">{FREQUENCY_LABELS[lead.frequency]}</td>
                    <td className="px-4 py-3 text-sm text-charcoal">
                      {lead.postcode || lead.city
                        ? [lead.postcode, lead.city].filter(Boolean).join(' · ')
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted" title={formatDateTime(lead.created_at)}>
                      {formatRelative(lead.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <ApprovalPill status={lead.approval_status} closed={isClosed(lead)} />
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex w-fit items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display ${STATUS_CLASSES[lead.status]}`}>
                        {STATUS_LABELS[lead.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActive(lead.id); }}
                        className="text-xs font-bold font-display text-brand hover:text-brand-ink"
                      >
                        Open →
                      </button>
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

      <RashanLeadDrawer id={activeId} onClose={() => setActive(null)} />
    </div>
  );
}

/** Undefined from an API older than the revamp — reads as pending, which it was. */
/** Taken out of the queue without a decision — a duplicate, a test. */
function isClosed(lead: { status: RashanLeadStatus }) {
  return lead.status === 'closed' || lead.status === 'archived';
}

/**
 * The decision. A request closed without one is not "Pending" — it is not
 * waiting on anybody — so it reads as Closed.
 */
function ApprovalPill({ status, closed = false }: { status?: RashanLeadApprovalStatus; closed?: boolean }) {
  const s = status ?? 'pending_review';
  const asClosed = closed && s === 'pending_review';
  return (
    <span className={`inline-flex w-fit items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display ${asClosed ? 'bg-surface-sand text-gray' : APPROVAL_CLASSES[s]}`}>
      {asClosed ? 'Closed' : APPROVAL_LABELS[s]}
    </span>
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

/* ─────────────────────────────────────────────────────────
   DETAIL DRAWER — full request, the decision, ops notes.
   ───────────────────────────────────────────────────────── */

/**
 * Full request + ops notes. No ops status: the decision (waiting / approved /
 * rejected) is what a request is now, and a second funnel beside it only
 * asked to be kept in step by hand.
 *
 * Exported for the Home Grocery tab, which passes
 * `onDecide` so a waiting request can be approved or rejected from here. On
 * this page it is omitted, and a waiting request links to the tab instead —
 * one place decides, so there is one dialog to keep right.
 */
export function RashanLeadDrawer({ id, onClose, onDecide }: {
  id: string | null;
  onClose: () => void;
  onDecide?: (lead: RashanLead, mode: 'approve' | 'reject') => void;
}) {
  const { data, isLoading } = useAdminRashanLead(id);
  const update = useUpdateAdminRashanLead();
  const [notes, setNotes]   = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (!data) return;
    setNotes(data.notes ?? '');
    setSavedAt(null);
  }, [data]);

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

  const dirty = !!data && (notes ?? '') !== (data.notes ?? '');

  /** Out of the queue with nothing sent — for a duplicate or a test. */
  async function closeWithoutReply() {
    if (!data) return;
    await update.mutateAsync({ id: data.id, payload: { status: 'closed' } });
    setConfirmClose(false);
  }

  const waiting = !!data && (data.approval_status ?? 'pending_review') === 'pending_review' && !isClosed(data);

  async function save() {
    if (!data || !dirty) return;
    await update.mutateAsync({
      id: data.id,
      payload: { notes: notes.trim() ? notes.trim() : null },
    });
    setSavedAt(Date.now());
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close request detail"
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
                <h2 className="text-lg font-bold font-display text-ink leading-tight">{data.name}</h2>
                <p className="text-sm text-gray mt-0.5">
                  Family of {data.household_size} · {FREQUENCY_LABELS[data.frequency]}
                </p>
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
              <Section title="Contact">
                <DetailRow icon={User}  label="Name"  value={data.name} />
                <DetailRow icon={Phone} label="Phone" value={data.phone} link={`tel:${data.phone}`} />
                {data.email && (
                  <DetailRow icon={Mail} label="Email" value={data.email} link={`mailto:${data.email}`} />
                )}
                <DetailRow
                  icon={MessageSquare}
                  label="Prefers"
                  value={CONTACT_PREF_LABELS[data.contact_pref]}
                  action={data.contact_pref === 'whatsapp' && whatsappUrl(data.phone) ? (
                    // Straight into a chat with their number, in a new tab —
                    // WhatsApp Web, or the desktop app if it is installed.
                    <a
                      href={whatsappUrl(data.phone)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 h-9 sm:h-8 px-3 rounded-lg bg-success text-white text-xs font-bold font-display hover:opacity-90 transition-opacity"
                    >
                      <MessageCircle size={14} strokeWidth={2} />
                      Open chat
                      <ExternalLink size={12} strokeWidth={2} />
                    </a>
                  ) : undefined}
                />
                {data.language && <DetailRow label="Language" value={data.language.toUpperCase()} />}
                {data.user_id && (
                  <DetailRow label="Existing customer" value={`${data.user_id.slice(0, 8)}…`} />
                )}
              </Section>

              <Section title="Household">
                <DetailRow icon={Users} label="Size" value={householdLabel(data)} />
                <DetailRow
                  icon={CalendarClock}
                  label="Frequency"
                  value={FREQUENCY_LABELS[data.frequency]}
                />
                {data.preferred_start_date && (
                  <DetailRow
                    icon={Clock}
                    label="Wants to start around"
                    value={formatDate(data.preferred_start_date)}
                  />
                )}
                {data.budget_per_cycle && (
                  <DetailRow
                    icon={Wallet}
                    label="Budget per delivery"
                    value={`€${Number(data.budget_per_cycle).toFixed(2)}`}
                  />
                )}
                {data.interested_pack_slug && (
                  <DetailRow label="Looking at pack" value={data.interested_pack_slug} />
                )}
              </Section>

              {(data.address_line || data.city || data.postcode || data.preferred_slot) && (
                <Section title="Delivery">
                  {data.address_line && (
                    <DetailRow icon={MapPin} label="Address" value={data.address_line} />
                  )}
                  {(data.city || data.postcode) && (
                    <DetailRow
                      label="Area"
                      value={[data.postcode, data.city].filter(Boolean).join(' · ')}
                    />
                  )}
                  {data.preferred_slot && (
                    <DetailRow icon={Clock} label="Preferred time" value={data.preferred_slot} />
                  )}
                </Section>
              )}

              {data.dietary_notes && (
                <Section title="What they told us">
                  <p className="text-sm text-ink font-body whitespace-pre-wrap leading-relaxed">
                    {data.dietary_notes}
                  </p>
                </Section>
              )}

              <Section title="Decision">
                <div className="flex items-center gap-2">
                  <ApprovalPill status={data.approval_status} closed={isClosed(data)} />
                  {(data.approved_at || data.rejected_at) && (
                    <span className="text-xs text-muted">{formatDateTime((data.approved_at ?? data.rejected_at)!)}</span>
                  )}
                </div>
                {data.rejection_reason && (
                  <div className="bg-surface-cream border border-border rounded-lg px-3 py-2">
                    <p className="text-[11px] text-muted font-display mb-0.5">Reason they were given</p>
                    <p className="text-sm text-ink font-body whitespace-pre-wrap">{data.rejection_reason}</p>
                  </div>
                )}
                {/* The account it maps to — linked on approval, or the one
                    approval WOULD link. Either way, one click to it.
                    Its tap area reaches 8px above and below (a ::before), so a
                    thumb gets 36px without moving the rows around it — padding
                    here would fight the section's space-y. */}
                {(data.approved_user_id || data.account) && (
                  <Link
                    to={`/customers/${data.approved_user_id ?? data.account!.id}`}
                    className="relative inline-flex items-center gap-1.5 text-sm font-semibold font-display text-brand hover:text-brand-ink before:absolute before:-inset-y-2 before:-inset-x-1"
                  >
                    <User size={14} strokeWidth={1.75} />
                    {data.account?.name ?? 'Open account'}
                    {data.account?.is_business && <span className="text-[11px] font-bold uppercase text-cool-deep">B2B</span>}
                  </Link>
                )}
                {waiting && !data.approved_user_id && !data.account && (
                  <p className="text-xs text-muted">No account yet — approving opens one.</p>
                )}
                {(data.approval_status ?? 'pending_review') === 'pending_review' && isClosed(data) && (
                  <p className="text-xs text-muted">Closed without a reply — nothing was sent to them.</p>
                )}
                {/* A duplicate or a test has no answer worth sending, and
                    Reject always sends one. This takes it out of the queue
                    and tells nobody. */}
                {waiting && (
                  <button
                    type="button"
                    onClick={() => setConfirmClose(true)}
                    className="inline-flex items-center gap-1.5 py-2.5 -my-2.5 px-1 -mx-1 text-xs font-semibold font-display text-gray hover:text-ink transition-colors"
                  >
                    <Archive size={13} strokeWidth={1.75} />
                    Close without replying — a duplicate or a test
                  </button>
                )}
              </Section>

              <Section title="Ops notes">
                <label className="block">
                  <div className="flex items-center justify-between mb-1.5">
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
                    placeholder="Called on 4 Aug — wants to start after Eid…"
                    aria-invalid={notes.length > 2000}
                    className={`w-full bg-surface-cream border rounded-lg px-3 py-2.5 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 transition resize-none ${
                      notes.length > 2000
                        ? 'border-danger focus:ring-danger/20 focus:border-danger'
                        : 'border-border focus:ring-brand/30 focus:border-brand'
                    }`}
                  />
                  {notes.length > 2000 && (
                    <p role="alert" className="mt-1 text-[12px] text-danger font-display font-medium">
                      Maximum 2000 characters.
                    </p>
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
                  `Request ID ${data.id.slice(0, 8)}…`
                )}
              </span>
              <div className="flex items-center gap-2">
              {waiting && (
                onDecide ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onDecide(data, 'reject')}
                      className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg border border-border text-danger text-sm font-bold font-display hover:border-danger transition-colors"
                    >
                      <XCircle size={14} strokeWidth={2} />
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => onDecide(data, 'approve')}
                      className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg bg-brand text-white text-sm font-bold font-display hover:bg-brand-mid transition-colors"
                    >
                      <Check size={14} strokeWidth={2.25} />
                      Approve
                    </button>
                  </>
                ) : (
                  <Link
                    to={`/users?tab=rashan&request=${data.id}`}
                    className="inline-flex items-center h-10 px-3 rounded-lg border border-border text-sm font-bold font-display text-brand hover:border-brand transition-colors"
                  >
                    Decide →
                  </Link>
                )
              )}
              <button
                type="button"
                onClick={save}
                disabled={!dirty || update.isPending || notes.length > 2000}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-brand text-white text-sm font-bold font-display hover:bg-brand-deepest transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save size={14} strokeWidth={2.25} />
                {update.isPending ? 'Saving…' : 'Save notes'}
              </button>
              </div>
            </div>

            <ConfirmModal
              open={confirmClose}
              title="Close this request without replying?"
              message={`${data.name}'s request leaves the queue and nothing is sent to them. It stays here in All requests.`}
              confirmLabel={update.isPending ? 'Closing…' : 'Close request'}
              cancelLabel="Cancel"
              confirmDisabled={update.isPending}
              onConfirm={closeWithoutReply}
              onCancel={() => setConfirmClose(false)}
            />
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

function DetailRow({ icon: Icon, label, value, link, action }: {
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  value: string | null;
  link?: string;
  /** Something to do with this value, at the end of the row. */
  action?: React.ReactNode;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5">
      {Icon ? <Icon size={14} strokeWidth={1.75} className="text-muted shrink-0 mt-0.5" /> : <span className="w-3.5 shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted font-display mb-0.5">{label}</p>
        {link ? (
          // py-2 on an inline link grows the tap area (to call, to mail) to
          // about 36px without changing the line it sits on.
          <a
            href={link}
            className="py-2 text-sm text-brand hover:text-brand-ink underline-offset-2 hover:underline break-words"
          >
            {value}
          </a>
        ) : (
          <span className="text-sm text-ink font-body break-words">{value}</span>
        )}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}
