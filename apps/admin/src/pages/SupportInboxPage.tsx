import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search, LifeBuoy, X, Mail, Phone, MessageSquare, Globe, Tag,
  CheckCircle2, Save, Package as PackageIcon,
} from 'lucide-react';
import {
  useAdminSupportTickets, useAdminSupportTicket, useUpdateAdminSupportTicket,
  type SupportTicketStatus,
} from '@grocery-app/shared';
import { TableSkeleton } from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import Pagination from '@/components/Pagination';

const PAGE_SIZE = 20;

const STATUS_ORDER: SupportTicketStatus[] = ['new', 'in_progress', 'resolved', 'archived'];
const STATUS_LABELS: Record<SupportTicketStatus, string> = {
  new:         'New',
  in_progress: 'In progress',
  resolved:    'Resolved',
  archived:    'Archived',
};
const STATUS_CLASSES: Record<SupportTicketStatus, string> = {
  new:         'bg-info-bg text-info',
  in_progress: 'bg-amber-mist text-amber-deep',
  resolved:    'bg-success-bg text-success',
  archived:    'bg-surface-sand text-muted',
};

const SOURCE_LABELS: Record<string, string> = {
  contact_form:  'Contact form',
  help_center:   'Help center',
  help_article:  'Help article',
  order_detail:  'Order detail',
  home_feedback: 'Homepage feedback',
};

function sourceLabel(s: string) {
  return SOURCE_LABELS[s] ?? s;
}

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

export default function SupportInboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<SupportTicketStatus | 'all'>('all');
  const [activeId, setActive] = useState<string | null>(searchParams.get('ticket'));
  const [page, setPage] = useState(1);

  const params = useMemo(() => ({
    q: search.trim() || undefined,
    status: status === 'all' ? undefined : status,
    page,
    limit: PAGE_SIZE,
  }), [search, status, page]);

  const { data, isLoading } = useAdminSupportTickets(params);
  const items = data?.items ?? [];
  const counts = data?.counts ?? {};

  // Filter change → reset page so filter culls don't strand admins on a
  // now-empty page.
  useEffect(() => { setPage(1); }, [search, status]);
  function handlePageChange(p: number) {
    setPage(p);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Keep ?ticket=… in sync with the open drawer so deep-link from emails works.
  useEffect(() => {
    if (activeId) {
      if (searchParams.get('ticket') !== activeId) {
        const next = new URLSearchParams(searchParams);
        next.set('ticket', activeId);
        setSearchParams(next, { replace: true });
      }
    } else if (searchParams.get('ticket')) {
      const next = new URLSearchParams(searchParams);
      next.delete('ticket');
      setSearchParams(next, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    if (activeId && items.length && !items.some((t) => t.id === activeId)) {
      // selection fell out of the active filter — keep drawer open but it'll
      // fetch its own data via useAdminSupportTicket, no list dependency.
    }
  }, [items, activeId]);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold font-display text-ink">Support inbox</h1>
        <p className="text-sm text-muted mt-0.5">
          Customer messages from the Help Center and the public /contact page.
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

      {/* Search */}
      <div className="mb-6">
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" strokeWidth={1.75} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, subject or message"
            className="w-full bg-surface-cream border border-border rounded-lg h-11 pl-10 pr-4 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
          />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<LifeBuoy size={28} strokeWidth={1.75} className="text-muted" />}
          title="No support messages yet"
          description={
            search || status !== 'all'
              ? 'No tickets match these filters.'
              : 'Messages from /contact and the Help Center CTAs will show up here.'
          }
        />
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {/* ON A PHONE (2026-11-05): a list — the table needed 720px and hid
              the source, status and Open off to the right. A row opens the
              ticket drawer, as the table row and its Open → do; the table
              from sm. */}
          <ul className="sm:hidden divide-y divide-border">
            {items.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setActive(t.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-brand-mist/30 transition-colors ${
                    activeId === t.id ? 'bg-brand-mist/40' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold font-display text-ink truncate">{t.name}</span>
                    <span className={`inline-flex items-center h-5 px-1.5 rounded-full text-[11px] font-semibold font-display shrink-0 ${STATUS_CLASSES[t.status]}`}>
                      {STATUS_LABELS[t.status]}
                    </span>
                    <span className="ml-auto text-[11.5px] text-muted shrink-0" title={formatDateTime(t.created_at)}>
                      {formatRelative(t.created_at)}
                    </span>
                  </div>

                  <p className="text-[13px] text-ink truncate mt-0.5" title={t.subject}>{t.subject}</p>

                  <div className="mt-1 flex items-center gap-2 min-w-0">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold font-display bg-surface-sand text-gray shrink-0">
                      {sourceLabel(t.source)}
                    </span>
                    <span className="text-[12.5px] text-muted truncate">{t.email}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <div className="hidden sm:block overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="bg-surface-cream">
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">From</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">Subject</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">Source</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">Received</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr
                  key={t.id}
                  className={`border-t border-border hover:bg-brand-mist/30 transition cursor-pointer ${
                    activeId === t.id ? 'bg-brand-mist/40' : ''
                  }`}
                  onClick={() => setActive(t.id)}
                >
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-ink">{t.name}</div>
                    <div className="text-xs text-muted mt-0.5">{t.email}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-ink max-w-[320px] truncate" title={t.subject}>
                    {t.subject}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold font-display bg-surface-sand text-gray">
                      {sourceLabel(t.source)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted" title={formatDateTime(t.created_at)}>
                    {formatRelative(t.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display ${STATUS_CLASSES[t.status]}`}>
                      {STATUS_LABELS[t.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setActive(t.id); }}
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

      {/* Detail drawer */}
      <TicketDetailDrawer id={activeId} onClose={() => setActive(null)} />
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

/* ─────────────────────────────────────────────────────────
   DETAIL DRAWER — full message + status / admin notes editor.
   ───────────────────────────────────────────────────────── */

function TicketDetailDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading } = useAdminSupportTicket(id);
  const update = useUpdateAdminSupportTicket();
  const [status, setStatus] = useState<SupportTicketStatus>('new');
  const [notes, setNotes]   = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!data) return;
    setStatus(data.status);
    setNotes(data.admin_notes ?? '');
    setSavedAt(null);
  }, [data]);

  // Lock scroll + Escape to close.
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

  const dirty = !!data && (status !== data.status || (notes ?? '') !== (data.admin_notes ?? ''));

  async function save() {
    if (!data || !dirty) return;
    await update.mutateAsync({
      id: data.id,
      payload: {
        status,
        admin_notes: notes.trim() ? notes.trim() : null,
      },
    });
    setSavedAt(Date.now());
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close ticket detail"
        onClick={onClose}
        className="absolute inset-0 bg-veil/40 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-[520px] bg-card shadow-[0_24px_60px_rgba(15,23,42,0.18)] flex flex-col">
        {isLoading || !data ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted">Loading…</div>
        ) : (
          <>
            {/* Header */}
            <div className="px-6 py-5 border-b border-border flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold font-display ${STATUS_CLASSES[data.status]}`}>
                    {STATUS_LABELS[data.status]}
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold font-display bg-surface-sand text-gray">
                    {sourceLabel(data.source)}
                  </span>
                  {data.language && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted font-ui">
                      <Globe size={11} strokeWidth={2} />
                      {data.language.toUpperCase()}
                    </span>
                  )}
                </div>
                <h2 className="text-lg font-bold font-display text-ink leading-tight">
                  {data.subject}
                </h2>
                <p className="text-[11px] text-muted mt-1 font-mono">
                  Received {formatDateTime(data.created_at)} · ID {data.id.slice(0, 8)}
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

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* From */}
              <Section title="From">
                <DetailRow icon={Mail} label="Email" value={data.email} link={`mailto:${data.email}?subject=Re: ${encodeURIComponent(data.subject)}`} />
                {data.phone && (
                  <DetailRow icon={Phone} label="Phone" value={data.phone} link={`tel:${data.phone}`} />
                )}
                <DetailRow icon={Tag} label="Name" value={data.name} />
                {data.order_id && (
                  <DetailRow icon={PackageIcon} label="Order" value={data.order_id.slice(0, 8)} link={`/orders/${data.order_id}`} />
                )}
              </Section>

              {/* Message */}
              <Section title="Message">
                <div className="bg-surface-cream border border-border rounded-xl p-4">
                  <div className="flex gap-2.5 items-start">
                    <MessageSquare size={14} strokeWidth={1.75} className="text-muted mt-0.5 shrink-0" />
                    <p className="text-sm text-ink font-body whitespace-pre-wrap leading-relaxed">
                      {data.body}
                    </p>
                  </div>
                </div>
                <a
                  href={`mailto:${data.email}?subject=Re: ${encodeURIComponent(data.subject)}&body=${encodeURIComponent('\n\n--- Original message ---\n' + data.body)}`}
                  className="inline-flex items-center gap-2 mt-3 h-9 px-3.5 rounded-lg text-xs font-bold font-display bg-brand text-white hover:bg-brand-deepest transition-colors"
                >
                  <Mail size={13} strokeWidth={2} />
                  Reply by email
                </a>
              </Section>

              {/* Triage */}
              <Section title="Triage">
                <label className="block">
                  <span className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted font-display block mb-1.5">
                    Status
                  </span>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as SupportTicketStatus)}
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
                    rows={5}
                    maxLength={2100}
                    placeholder="What did the team do? Why was it closed? Future-you will thank you…"
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

            {/* Footer — save action */}
            <div className="px-6 py-4 border-t border-border bg-surface-cream flex items-center justify-between gap-3">
              {savedAt ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-success font-bold font-display">
                  <CheckCircle2 size={13} strokeWidth={2} />
                  Saved
                </span>
              ) : (
                <span className="text-xs text-muted font-display">
                  {dirty ? 'Unsaved changes' : 'Up to date'}
                </span>
              )}
              <button
                type="button"
                onClick={save}
                disabled={!dirty || update.isPending}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-bold font-display bg-brand text-white hover:bg-brand-deepest transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save size={14} strokeWidth={2} />
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
      <h3 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted font-display mb-2.5">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function DetailRow({
  icon: Icon, label, value, link,
}: {
  icon?: React.ElementType; label: string; value: string; link?: string;
}) {
  const body = (
    <span className="text-sm font-medium text-ink font-body break-words">{value}</span>
  );
  return (
    <div className="flex items-start gap-2.5">
      {Icon ? <Icon size={14} strokeWidth={1.75} className="text-muted mt-0.5 shrink-0" /> : <span className="w-3.5" />}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-[0.12em] font-bold text-muted font-display">{label}</p>
        {/* py-2 on an inline link grows the tap area (to mail, to call, to
            the order) to about 36px without changing the line it sits on. */}
        {link ? (
          <a href={link} className="py-2 hover:text-brand transition-colors">{body}</a>
        ) : body}
      </div>
    </div>
  );
}
