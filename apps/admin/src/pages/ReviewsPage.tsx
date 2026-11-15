import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search, MessageSquare, Flag, EyeOff, Eye, Trash2, Check, Star, AlertTriangle, X,
} from 'lucide-react';
import {
  useAdminReviews, useHideReview, useUnhideReview, useDeleteReview,
  useDismissReviewReports,
  type AdminProductReview, type ReviewReportReason,
} from '@grocery-app/shared';
import { TableSkeleton } from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import Pagination from '@/components/Pagination';

/**
 * Review moderation.
 *
 * There was no page for this at all — the hide / unhide / delete endpoints
 * existed and nothing called them. Adding customer reporting made that gap
 * load-bearing: Google Play's UGC policy expects moderation to actually
 * happen, and a report button feeding a queue nobody can see is worse than no
 * button, because it promises a review will be looked at.
 *
 * "Reported" is the default tab for that reason — this screen exists to be
 * emptied, and the other tabs are for going looking rather than responding.
 *
 * Hide is the normal action and is reversible. Delete is not, and is here only
 * for content that must not persist at all: personal data in the body, a legal
 * takedown. The wording on each says so.
 */

const PAGE_SIZE = 20;

type Tab = 'reported' | 'all' | 'visible' | 'hidden';

const TABS: { key: Tab; label: string }[] = [
  { key: 'reported', label: 'Reported' },
  { key: 'all',      label: 'All' },
  { key: 'visible',  label: 'Visible' },
  { key: 'hidden',   label: 'Hidden' },
];

const REASON_LABELS: Record<ReviewReportReason, string> = {
  spam:                'Spam or advertising',
  offensive:           'Offensive or hateful',
  off_topic:           'Not about this product',
  personal_info:       'Contains personal details',
  not_a_real_purchase: 'Looks fake',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ReviewsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('reported');
  const [q, setQ] = useState('');
  const [lowStarOnly, setLowStarOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [hideTarget, setHideTarget] = useState<AdminProductReview | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminProductReview | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading } = useAdminReviews({
    visibility: tab,
    q: q.trim() || undefined,
    maxRating: lowStarOnly ? 2 : undefined,
    page,
    limit: PAGE_SIZE,
  });

  const hide = useHideReview();
  const unhide = useUnhideReview();
  const remove = useDeleteReview();
  const dismiss = useDismissReviewReports();

  const items = data?.items ?? [];
  const busy = hide.isPending || unhide.isPending || remove.isPending || dismiss.isPending;

  // Any filter change resets to page 1 — a narrower filter can otherwise
  // strand you on a page that no longer exists.
  function change<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }

  function run(p: Promise<unknown>, onDone?: () => void) {
    setActionError(null);
    p.then(() => onDone?.()).catch((err: unknown) => {
      setActionError(err instanceof Error ? err.message : 'That did not work.');
    });
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold font-display text-ink inline-flex items-center gap-2">
          <MessageSquare size={22} strokeWidth={1.75} />
          Reviews
          {data && <span className="text-base font-normal text-muted ml-2">({data.total})</span>}
        </h1>
        <p className="text-sm text-muted font-body mt-1 max-w-2xl">
          Customer reviews and anything they have flagged. Hiding a review keeps it in the
          record but drops it from the storefront and the product's rating.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 mb-4 border-b border-border">
        {TABS.map((tItem) => (
          <button
            key={tItem.key}
            type="button"
            onClick={() => change(setTab)(tItem.key)}
            className={`relative -mb-px px-4 h-10 text-sm font-semibold font-display transition ${
              tab === tItem.key
                ? 'text-brand border-b-2 border-brand'
                : 'text-muted hover:text-ink border-b-2 border-transparent'
            }`}
          >
            {tItem.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[240px] sm:max-w-sm">
          <Search size={15} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            value={q}
            onChange={(e) => change(setQ)(e.target.value)}
            placeholder="Review text, customer or product"
            className="w-full h-11 pl-9 pr-3 bg-surface-cream border border-border rounded-lg text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
          />
        </div>
        <button
          type="button"
          onClick={() => change(setLowStarOnly)(!lowStarOnly)}
          className={`h-11 px-4 rounded-lg text-sm font-semibold font-display inline-flex items-center gap-2 border transition ${
            lowStarOnly
              ? 'bg-brand-mist border-brand/30 text-brand'
              : 'bg-surface-cream border-border text-gray hover:text-ink'
          }`}
        >
          <Star size={14} strokeWidth={1.75} />
          1–2 stars only
        </button>
      </div>

      {actionError && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-danger-bg border border-danger/30 p-3">
          <AlertTriangle size={16} strokeWidth={1.75} className="text-danger shrink-0 mt-0.5" />
          <p className="text-xs text-danger font-body flex-1">{actionError}</p>
          {/* 36px for a thumb, the negative margin keeping the alert its size;
              from sm the bare icon it always was. */}
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label={t('common.dismiss', 'Dismiss')}
            className="-m-2.5 w-9 h-9 flex items-center justify-center shrink-0 sm:m-0 sm:w-auto sm:h-auto sm:block"
          >
            <X size={14} className="text-danger" />
          </button>
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={6} cols={4} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<MessageSquare size={28} strokeWidth={1.75} className="text-muted" />}
          title={tab === 'reported' ? 'Nothing reported' : 'No reviews here'}
          description={
            tab === 'reported'
              ? 'When a customer flags a review in the app it lands here. An empty queue is the good outcome.'
              : q || lowStarOnly
                ? 'Nothing matches these filters.'
                : 'Customer reviews will show up here once people start writing them.'
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <ReviewCard
              key={r.id}
              review={r}
              busy={busy}
              onHide={() => setHideTarget(r)}
              onUnhide={() => run(unhide.mutateAsync(r.id))}
              onDelete={() => setDeleteTarget(r)}
              onDismiss={() => run(dismiss.mutateAsync(r.id))}
            />
          ))}
        </div>
      )}

      {!isLoading && data && (
        <Pagination
          page={page}
          totalPages={data.totalPages ?? 1}
          onPageChange={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          totalItems={data.total}
          pageSize={PAGE_SIZE}
          className="mt-6"
        />
      )}

      {hideTarget && (
        <HideModal
          review={hideTarget}
          busy={hide.isPending}
          onClose={() => setHideTarget(null)}
          onConfirm={(reason) => run(
            hide.mutateAsync({ id: hideTarget.id, reason }),
            () => setHideTarget(null),
          )}
        />
      )}

      {deleteTarget && (
        <DeleteModal
          review={deleteTarget}
          busy={remove.isPending}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => run(
            remove.mutateAsync(deleteTarget.id),
            () => setDeleteTarget(null),
          )}
        />
      )}
    </div>
  );
}

/* ── pieces ─────────────────────────────────────────────── */

function ReviewCard({
  review, busy, onHide, onUnhide, onDelete, onDismiss,
}: {
  review: AdminProductReview;
  busy: boolean;
  onHide: () => void;
  onUnhide: () => void;
  onDelete: () => void;
  onDismiss: () => void;
}) {
  const reported = review.report_count > 0;

  return (
    <div className={`bg-card rounded-xl border overflow-hidden ${reported ? 'border-danger/40' : 'border-border'}`}>
      {/* ON A PHONE (2026-11-05): the actions go under the review. Beside it,
          Keep it + Hide + Delete left the review text about 60px to wrap in.
          From sm the row is what it was. */}
      <div className="p-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:gap-4">
        <div className="min-w-0 sm:flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink">
              <Star size={13} strokeWidth={2} className="text-amber-deep fill-amber-deep" />
              {review.rating}
            </span>
            <span className="text-sm font-semibold text-ink truncate">{review.user.name}</span>
            <span className="text-xs text-muted">·</span>
            <span className="text-xs text-muted truncate">{review.product.name_es}</span>
            <span className="text-xs text-muted">·</span>
            <span className="text-xs text-muted whitespace-nowrap">{formatDate(review.created_at)}</span>
            {review.is_hidden && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold font-display bg-surface-sand text-muted uppercase tracking-wide">
                <EyeOff size={10} strokeWidth={2.5} /> Hidden
              </span>
            )}
            {reported && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold font-display bg-danger-bg text-danger uppercase tracking-wide">
                <Flag size={10} strokeWidth={2.5} /> {review.report_count} report{review.report_count === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {review.title && (
            <p className="text-sm font-semibold text-ink mt-2">{review.title}</p>
          )}
          <p className="text-sm text-charcoal font-body mt-1 whitespace-pre-line">{review.body}</p>

          {review.is_hidden && review.hidden_reason && (
            <p className="text-xs text-muted font-body mt-2">
              Hidden: {review.hidden_reason}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {reported && (
            <button
              type="button"
              onClick={onDismiss}
              disabled={busy}
              title="The review stays up and leaves the queue"
              className="h-9 px-3 rounded-lg border border-border text-xs font-semibold text-ink hover:bg-surface-cream inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Check size={13} strokeWidth={2} /> Keep it
            </button>
          )}
          {review.is_hidden ? (
            <button
              type="button"
              onClick={onUnhide}
              disabled={busy}
              className="h-9 px-3 rounded-lg border border-border text-xs font-semibold text-ink hover:bg-surface-cream inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Eye size={13} strokeWidth={2} /> Unhide
            </button>
          ) : (
            <button
              type="button"
              onClick={onHide}
              disabled={busy}
              className="h-9 px-3 rounded-lg bg-ink text-card text-xs font-semibold hover:bg-ink/90 inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <EyeOff size={13} strokeWidth={2} /> Hide
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="h-9 px-3 rounded-lg border border-danger/40 text-xs font-semibold text-danger hover:bg-danger-bg/40 inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Trash2 size={13} strokeWidth={2} /> Delete
          </button>
        </div>
      </div>

      {/* What the reporters actually said. Without this a moderator is deciding
          on the review alone and has to guess what the complaint was. */}
      {reported && (
        <div className="border-t border-border bg-danger-bg/20 px-4 py-3 space-y-1.5">
          {review.reports.map((rep) => (
            <div key={rep.id} className="flex flex-wrap items-baseline gap-2 text-xs">
              <span className="font-semibold text-danger">{REASON_LABELS[rep.reason] ?? rep.reason}</span>
              <span className="text-muted">— {rep.reporter.name}</span>
              <span className="text-muted">{formatDate(rep.created_at)}</span>
              {rep.note && <span className="text-charcoal font-body w-full">“{rep.note}”</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HideModal({
  review, busy, onClose, onConfirm,
}: {
  review: AdminProductReview;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string | null) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Overlay onClose={onClose}>
      <h2 className="text-lg font-bold font-display text-ink">Hide this review?</h2>
      <p className="text-sm text-muted font-body mt-1">
        It stays in the record and the author still sees it, but it leaves the storefront and stops
        counting towards {review.product.name_es}'s rating. You can undo this.
      </p>
      <label className="block text-xs font-semibold text-gray mt-4 mb-1">
        Reason (optional, for your own audit trail)
      </label>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={300}
        className="w-full h-11 px-3 bg-surface-cream border border-border rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
      />
      <div className="flex justify-end gap-3 mt-6">
        <button type="button" onClick={onClose} disabled={busy} className="h-11 px-5 rounded-xl text-sm font-semibold border-2 border-border text-gray hover:bg-surface-linen disabled:opacity-50">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onConfirm(reason.trim() || null)}
          disabled={busy}
          className="h-11 px-5 rounded-xl text-sm font-semibold bg-ink text-card hover:bg-ink/90 disabled:opacity-50"
        >
          Hide review
        </button>
      </div>
    </Overlay>
  );
}

function DeleteModal({
  review, busy, onClose, onConfirm,
}: {
  review: AdminProductReview;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <h2 className="text-lg font-bold font-display text-ink">Delete permanently?</h2>
      <p className="text-sm text-muted font-body mt-1">
        This removes {review.user.name}'s review from the database entirely. There is no undo and no
        audit trail afterwards — hide it instead unless the content itself must not persist, such as
        personal data in the body or a legal takedown.
      </p>
      <div className="flex justify-end gap-3 mt-6">
        <button type="button" onClick={onClose} disabled={busy} className="h-11 px-5 rounded-xl text-sm font-semibold border-2 border-border text-gray hover:bg-surface-linen disabled:opacity-50">
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="h-11 px-5 rounded-xl text-sm font-semibold bg-danger text-white hover:bg-danger/90 disabled:opacity-50"
        >
          Delete for good
        </button>
      </div>
    </Overlay>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-modal w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
