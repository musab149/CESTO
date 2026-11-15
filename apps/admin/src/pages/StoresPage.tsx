import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, Pencil, Trash2, Store as StoreIcon, CheckCircle2,
  Package, Sparkles, Clock, RotateCcw, ShieldAlert, UserPlus,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useAdminStores,
  useAdminMe,
  useScheduleStoreDeletion,
  useCancelStoreDeletion,
  usePermanentDeleteStore,
  useRestoreStore,
  resolveImageUrl,
} from '@grocery-app/shared';
import type { Store, AdminStorePartnerSummary } from '@grocery-app/shared';
import { TableSkeleton } from '@/components/Skeleton';
import Pagination from '@/components/Pagination';
import StoreDeletionModal, { type StoreDeletionIntent } from '@/components/StoreDeletionModal';
import { useToast } from '@/components/Toast';
import LinkPartnerDialog from '@/components/partner/LinkPartnerDialog';

type StoreRow = Store & {
  _count: { products: number; sales_reps?: number };
  source?: 'manual' | 'import';
  /** Who manages it. Absent on an API from before 2026-10-31. */
  partners?: AdminStorePartnerSummary[];
};

const GRACE_DAYS = 5;
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000;

/** Distilled per-row deletion state — drives all badge + action rendering. */
type DeletionState =
  | { kind: 'live' }
  | { kind: 'pending'; scheduledAt: Date; graceRemainingDays: number; graceElapsed: boolean }
  | { kind: 'deleted'; deletedAt: Date };

function deriveDeletionState(store: Pick<StoreRow, 'deletion_scheduled_at' | 'deleted_at'>): DeletionState {
  if (store.deleted_at) return { kind: 'deleted', deletedAt: new Date(store.deleted_at) };
  if (store.deletion_scheduled_at) {
    const scheduledAt = new Date(store.deletion_scheduled_at);
    const elapsedMs = Date.now() - scheduledAt.getTime();
    const remainingMs = GRACE_MS - elapsedMs;
    return {
      kind: 'pending',
      scheduledAt,
      graceRemainingDays: Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000))),
      graceElapsed: remainingMs <= 0,
    };
  }
  return { kind: 'live' };
}

/** Store row is an unreviewed Excel-importer auto-create. */
const isStoreSuggestion = (s: Pick<StoreRow, 'source' | 'is_active'>) =>
  s.source === 'import' && !s.is_active;

/** Distilled per-row visibility, drives the badge on the Stores table.
 *
 *  Previously the badge was a straight `is_active` reflection, which lied:
 *  a `is_active=true, status='draft'` store showed "Active" here but was
 *  hidden from the customer /stores endpoint. This helper collapses both
 *  flags into one truthful label with a priority order — most restrictive
 *  wins — so admins can tell at a glance which stores customers actually
 *  see. Priority: suspended > inactive > paused > draft > live.
 *  ('paused' outranks 'draft' because paused is a partner-controlled
 *  state a customer might have JUST seen serving orders — more urgent
 *  to surface than an admin-only draft.) */
type Visibility = 'live' | 'draft' | 'paused' | 'inactive' | 'suspended';
function storeVisibility(
  s: Pick<StoreRow, 'is_active'> & { status?: 'draft' | 'live' | 'paused' | 'suspended' },
): Visibility {
  if (s.status === 'suspended') return 'suspended';
  if (!s.is_active)              return 'inactive';
  if (s.status === 'paused')     return 'paused';
  if (s.status === 'draft')      return 'draft';
  return 'live';
}
const VISIBILITY_STYLES: Record<Visibility, { label: string; classes: string }> = {
  live:      { label: 'Live',      classes: 'bg-success-bg text-success' },
  // Paused reads amber like draft but with distinct copy — partner-initiated
  // pause is operationally different from admin-controlled draft-in-setup.
  paused:    { label: 'Paused',    classes: 'bg-warning-bg text-warning' },
  draft:     { label: 'Draft',     classes: 'bg-amber-mist text-amber-deep' },
  inactive:  { label: 'Inactive',  classes: 'bg-gray-100 text-gray' },
  suspended: { label: 'Suspended', classes: 'bg-danger-bg text-danger' },
};

const PAGE_SIZE = 20;

/**
 * Who manages the store, in its row (2026-10-31, user: "on stores tab we do
 * not have the add partner buttons"): the partner's name, which opens the
 * store's Partner tab, or — for a store nobody manages — "Add partner" with
 * that store already chosen. A store deleted or on its way out offers nothing:
 * the API refuses to give it a partner.
 */
function PartnerSlot({ store, live, onAdd, onOpen }: {
  store: StoreRow;
  live: boolean;
  onAdd: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const partners = store.partners;
  if (!partners) return <span className="text-muted">—</span>;
  if (partners.length > 0) {
    const [first, ...rest] = partners;
    const off = partners.every((p) => !p.is_active);
    return (
      <button type="button" onClick={onOpen} className="group text-left min-w-0 max-w-[220px]" title={t('stores.partnerOpen', 'Open the Partner tab')}>
        <span className="block text-sm font-medium text-ink font-display truncate group-hover:text-brand">
          {first.name}
          {rest.length > 0 && <span className="text-muted font-normal"> {t('stores.partnerMore', '+{{count}}', { count: rest.length })}</span>}
        </span>
        <span className="block text-[11.5px] font-mono text-muted truncate">{first.email ?? '—'}</span>
        {off && (
          <span className="mt-0.5 inline-flex px-1.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-surface-linen text-muted">
            {t('partners.panel.roleOff', 'Access switched off')}
          </span>
        )}
      </button>
    );
  }
  if (!live) return <span className="text-muted">—</span>;
  return (
    <button
      type="button"
      onClick={onAdd}
      className="inline-flex items-center gap-1.5 h-9 sm:h-8 px-2.5 rounded-lg border-2 border-border text-xs font-semibold font-display text-ink hover:border-brand hover:text-brand transition-colors whitespace-nowrap"
    >
      <UserPlus className="w-3.5 h-3.5" strokeWidth={1.75} />
      {t('partners.add', 'Add partner')}
    </button>
  );
}

// Filter modes:
//   'all' / 'active' / 'inactive' — legacy is_active filter
//   'suggestions' — Excel-importer auto-creates awaiting review
//   'pending-deletion' — stores in the 5-day grace window
//   'deleted' — tombstoned archive (super_admin can restore)
type FilterMode = 'all' | 'active' | 'inactive' | 'suggestions' | 'pending-deletion' | 'deleted';

export default function StoresPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();

  const [q, setQ] = useState('');
  const [mode, setMode] = useState<FilterMode>('all');
  const [page, setPage] = useState(1);
  const [deletionModal, setDeletionModal] = useState<
    { store: StoreRow; intent: StoreDeletionIntent; error?: string | null } | null
  >(null);
  // "Add partner": from the header (choose or make the store) or a row (that store).
  const [linkTarget, setLinkTarget] = useState<{ store?: { id: string; name: string } } | null>(null);

  const isActive =
    mode === 'active'      ? 'true'
    : mode === 'inactive'  ? 'false'
    : mode === 'suggestions' ? 'false'
    : undefined;
  const source = mode === 'suggestions' ? 'import' : undefined;
  const deletionState =
    mode === 'pending-deletion' ? 'pending' as const
    : mode === 'deleted' ? 'deleted' as const
    : undefined;

  const { data, isLoading } = useAdminStores({
    q: q.trim() || undefined,
    isActive,
    source,
    deletionState,
    page,
    limit: PAGE_SIZE,
  });
  // Lightweight second query — pull the total number of suggestions
  // regardless of the current filter so the yellow CTA + count are always
  // accurate. `limit: 1` keeps the payload tiny; we only read `total`.
  const { data: suggCountData } = useAdminStores({
    source: 'import',
    isActive: 'false',
    limit: 1,
    page: 1,
  });
  const suggestionCount = suggCountData?.total ?? 0;

  // Pending-deletion count for the yellow CTA next to the filter dropdown —
  // even when we're not currently filtered to pending, surface how many
  // stores are mid-deletion so nobody forgets to cancel or finalise.
  const { data: pendingCountData } = useAdminStores({
    deletionState: 'pending',
    limit: 1,
    page: 1,
  });
  const pendingCount = pendingCountData?.total ?? 0;

  const { data: me } = useAdminMe();
  const isSuperAdmin = me?.role === 'super_admin';

  const scheduleDeletion    = useScheduleStoreDeletion();
  const cancelDeletion      = useCancelStoreDeletion();
  const permanentDeleteMut  = usePermanentDeleteStore();
  const restoreMut          = useRestoreStore();

  const stores = (data?.items ?? []) as StoreRow[];
  // Compute once per render — deriveDeletionState reads Date.now() so we
  // want a stable snapshot per row for badge + action gating consistency.
  const storeStates = useMemo(
    () => new Map(stores.map((s) => [s.id, deriveDeletionState(s)])),
    [stores],
  );

  async function handleCancelDeletion(store: StoreRow) {
    try {
      await cancelDeletion.mutateAsync(store.id);
      toast.success(`Deletion cancelled — "${store.name}" is live again.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to cancel deletion.';
      toast.error(msg);
    }
  }

  async function handleRestore(store: StoreRow) {
    try {
      await restoreMut.mutateAsync(store.id);
      toast.success(`"${store.name}" restored.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to restore store.';
      toast.error(msg);
    }
  }

  async function handleConfirmDeletion(payload: { confirmation_name: string; reason?: string }) {
    if (!deletionModal) return;
    const { store, intent } = deletionModal;
    try {
      if (intent === 'schedule') {
        await scheduleDeletion.mutateAsync({
          id: store.id,
          payload: { confirmation_name: payload.confirmation_name, reason: payload.reason ?? '' },
        });
        toast.success(`Deletion scheduled — grace period ends in ${GRACE_DAYS} days.`);
      } else {
        await permanentDeleteMut.mutateAsync({
          id: store.id,
          payload: { confirmation_name: payload.confirmation_name },
        });
        toast.success(`"${store.name}" permanently deleted (tombstoned).`);
      }
      setDeletionModal(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Deletion failed.';
      setDeletionModal({ ...deletionModal, error: msg });
    }
  }

  return (
    <div className="space-y-0">
      {/* Header — stacks on mobile so the CTA doesn't clip the title */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold font-display text-ink">
            {t('nav.stores', 'Stores')}
            {!isLoading && (
              <span className="text-base font-normal text-muted ml-2">({data?.total ?? stores.length})</span>
            )}
          </h1>
          <p className="text-sm text-muted mt-1">
            {t('stores.subtitle', 'Partner shops sold on Cesto. Manage their branding, hours, and products.')}
          </p>
        </div>
        {/* Side by side on a phone too (2026-11-05), half each — stacked they
            were two full-width 52px rows before the list even started. */}
        <div className="flex gap-2 shrink-0 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setLinkTarget({})}
            className="inline-flex items-center justify-center gap-2 border-2 border-border hover:border-brand text-ink font-semibold font-display text-sm px-3 sm:px-5 rounded-xl h-[52px] transition flex-1 sm:flex-none"
          >
            <UserPlus className="w-5 h-5" strokeWidth={1.75} />
            {t('partners.add', 'Add partner')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/stores/new')}
            className="inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm px-3 sm:px-5 rounded-xl h-[52px] transition flex-1 sm:flex-none"
          >
            <Plus className="w-5 h-5" strokeWidth={1.75} />
            {t('stores.new', 'New store')}
          </button>
        </div>
      </div>

      {/* Filters. On a phone (2026-11-05) the filter and search are full
          width and the two shortcuts fill their row, instead of a ragged
          stack of odd widths. */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={mode}
          onChange={(e) => { setMode(e.target.value as FilterMode); setPage(1); }}
          className="w-full sm:w-auto bg-surface-cream border border-border rounded-lg h-11 px-4 text-sm font-display text-ink min-w-[200px] focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="all">{t('stores.filter.all', 'All stores')}</option>
          <option value="active">{t('stores.filter.active', 'Active only')}</option>
          <option value="inactive">{t('stores.filter.inactive', 'Inactive only')}</option>
          <option value="suggestions">
            Suggestions from imports{suggestionCount > 0 ? ` (${suggestionCount})` : ''}
          </option>
          <option value="pending-deletion">
            Pending deletion{pendingCount > 0 ? ` (${pendingCount})` : ''}
          </option>
          <option value="deleted">Deleted stores (archive)</option>
        </select>
        {suggestionCount > 0 && mode !== 'suggestions' && (
          <button
            type="button"
            onClick={() => { setMode('suggestions'); setPage(1); }}
            className="flex-1 sm:flex-none justify-center inline-flex items-center gap-2 h-11 px-4 rounded-lg bg-amber-mist/60 border border-amber text-amber-deep font-semibold font-display text-sm hover:bg-amber-mist transition-colors"
          >
            <Sparkles className="w-4 h-4" strokeWidth={1.75} />
            {suggestionCount} suggestion{suggestionCount === 1 ? '' : 's'} to review
          </button>
        )}
        {pendingCount > 0 && mode !== 'pending-deletion' && (
          <button
            type="button"
            onClick={() => { setMode('pending-deletion'); setPage(1); }}
            className="flex-1 sm:flex-none justify-center inline-flex items-center gap-2 h-11 px-4 rounded-lg bg-danger-bg border border-danger/40 text-danger font-semibold font-display text-sm hover:bg-danger-bg/80 transition-colors"
          >
            <Clock className="w-4 h-4" strokeWidth={1.75} />
            {pendingCount} pending deletion{pendingCount === 1 ? '' : 's'}
          </button>
        )}

        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" strokeWidth={1.75} />
          <input
            type="text"
            placeholder={t('stores.search', 'Search stores…')}
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            className="w-full bg-surface-cream border border-border rounded-lg h-11 pl-10 pr-4 text-sm font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
      </div>

      {mode === 'suggestions' && !isLoading && (
        <div className="bg-amber-mist/40 border border-amber rounded-xl px-4 py-3 mb-4 flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-amber-deep flex-shrink-0 mt-0.5" strokeWidth={1.75} />
          <div className="flex-1 text-[13px] font-body text-amber-deep">
            <p className="font-semibold">
              These stores were auto-created from Excel imports and are waiting for review.
            </p>
            <p className="mt-0.5 text-amber-deep/80">
              Click <span className="font-semibold">Review &amp; create</span> to add a logo, cover, contact info, and shop hours, then toggle <span className="font-semibold">Active</span> to publish the storefront.
            </p>
          </div>
        </div>
      )}

      {mode === 'pending-deletion' && !isLoading && (
        <div className="bg-danger-bg border border-danger/40 rounded-xl px-4 py-3 mb-4 flex items-start gap-3">
          <Clock className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" strokeWidth={1.75} />
          <div className="flex-1 text-[13px] font-body text-danger">
            <p className="font-semibold">
              These stores are in the {GRACE_DAYS}-day deletion grace period.
            </p>
            <p className="mt-0.5 text-danger/85">
              They are hidden from customers. <span className="font-semibold">Cancel</span> restores them immediately. Once the countdown reaches zero, a <span className="font-semibold">super admin</span> can permanently delete them (row is preserved as a tombstone for order-history integrity).
            </p>
          </div>
        </div>
      )}

      {mode === 'deleted' && !isLoading && (
        <div className="bg-gray-100 border border-gray-300 rounded-xl px-4 py-3 mb-4 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-gray-700 flex-shrink-0 mt-0.5" strokeWidth={1.75} />
          <div className="flex-1 text-[13px] font-body text-gray-700">
            <p className="font-semibold">
              Deleted stores archive.
            </p>
            <p className="mt-0.5 text-gray-600">
              These rows are tombstoned — hidden from all customer and admin surfaces, but kept so historical orders, receipts, and audit logs stay intact. Only a <span className="font-semibold">super admin</span> can restore them.
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : stores.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-cream flex items-center justify-center mx-auto mb-4">
            {mode === 'pending-deletion' ? (
              <Clock className="w-8 h-8 text-muted" strokeWidth={1.75} />
            ) : mode === 'deleted' ? (
              <ShieldAlert className="w-8 h-8 text-muted" strokeWidth={1.75} />
            ) : (
              <StoreIcon className="w-8 h-8 text-muted" strokeWidth={1.75} />
            )}
          </div>
          <h3 className="text-lg font-semibold font-display text-ink mb-1">
            {mode === 'pending-deletion'
              ? 'No stores pending deletion'
              : mode === 'deleted'
                ? 'No deleted stores'
                : t('stores.emptyTitle', 'No stores yet')}
          </h3>
          <p className="text-sm text-muted mb-4">
            {mode === 'pending-deletion'
              ? 'Nothing is currently in the grace period. Good.'
              : mode === 'deleted'
                ? 'The archive is empty — no store has been permanently deleted.'
                : t('stores.emptyBody', 'Add your first partner shop to start associating products with a storefront.')}
          </p>
          {mode !== 'pending-deletion' && mode !== 'deleted' && (
            <button
              type="button"
              onClick={() => navigate('/stores/new')}
              className="inline-flex items-center gap-2 bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition"
            >
              <Plus className="w-5 h-5" strokeWidth={1.75} />
              {t('stores.new', 'New store')}
            </button>
          )}
        </div>
      ) : (
        <>
        {/* Mobile card list — one card per store. Rendered up to md, hidden
            from md up where the table takes over. Keeps the same fields but
            reflows them into a two-line stack that fits 375px viewports. */}
        <div className="md:hidden space-y-3">
          {stores.map((s) => {
            const state = storeStates.get(s.id) ?? { kind: 'live' as const };
            return (
            <div
              key={s.id}
              className={`bg-card border rounded-xl p-4 shadow-card space-y-3 ${
                state.kind === 'pending' ? 'border-danger/40 bg-danger-bg/20'
                : state.kind === 'deleted' ? 'border-border bg-gray-50 opacity-75'
                : 'border-border'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-12 h-12 rounded-lg border border-border flex items-center justify-center overflow-hidden shrink-0"
                  style={{ backgroundColor: s.logo_bg }}
                >
                  {s.logo_url ? (
                    <img src={resolveImageUrl(s.logo_url, 'logo')} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <StoreIcon className="w-6 h-6 text-muted" strokeWidth={1.75} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-display font-semibold text-ink truncate flex-wrap">
                    {s.name}
                    {s.is_verified && (
                      <CheckCircle2 className="w-4 h-4 text-brand shrink-0" strokeWidth={2} />
                    )}
                    {isStoreSuggestion(s) && state.kind === 'live' && (
                      <span
                        title="Auto-created by the Excel importer. Review and toggle active to publish the storefront."
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold font-display bg-amber-mist text-amber-deep border border-amber/40"
                      >
                        <Sparkles className="w-3 h-3" strokeWidth={2} />
                        From import
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-mono text-muted truncate">{s.slug}</div>
                  {s.origin && <div className="text-xs text-muted mt-0.5">{s.origin}</div>}
                </div>
                {state.kind === 'pending' ? (
                  <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold font-display uppercase tracking-wide bg-danger-bg text-danger border border-danger/40">
                    <Clock className="w-3 h-3" strokeWidth={2} />
                    {state.graceElapsed ? 'Ready to delete' : `${state.graceRemainingDays}d`}
                  </span>
                ) : state.kind === 'deleted' ? (
                  <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold font-display uppercase tracking-wide bg-gray-200 text-gray-700 border border-gray-300">
                    Deleted
                  </span>
                ) : (() => {
                  const style = VISIBILITY_STYLES[storeVisibility(s)];
                  return (
                    <span
                      className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold font-display uppercase tracking-wide ${style.classes}`}
                    >
                      {style.label}
                    </span>
                  );
                })()}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center border-y border-border py-2 -mx-1">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted font-display">
                    {t('stores.col.products', 'Products')}
                  </div>
                  <div className="text-sm font-bold text-ink tabular-nums mt-0.5">{s._count.products}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted font-display">
                    {t('stores.col.followers', 'Followers')}
                  </div>
                  <div className="text-sm font-bold text-ink tabular-nums mt-0.5">{s.followers_count}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted font-display">
                    {t('stores.col.rating', 'Rating')}
                  </div>
                  <div className="text-sm font-bold text-ink tabular-nums mt-0.5">
                    {s.rating != null ? s.rating.toFixed(1) : '—'}
                  </div>
                </div>
              </div>
              {s.partners && state.kind !== 'deleted' && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] uppercase tracking-wide text-muted font-display shrink-0">
                    {t('stores.col.partner', 'Partner')}
                  </span>
                  <div className="min-w-0 flex justify-end">
                    <PartnerSlot
                      store={s}
                      live={state.kind === 'live'}
                      onAdd={() => setLinkTarget({ store: { id: s.id, name: s.name } })}
                      onOpen={() => navigate(`/stores/${s.id}/edit?tab=partner`)}
                    />
                  </div>
                </div>
              )}
              {state.kind === 'pending' && (
                <div className="rounded-lg bg-card/70 border border-danger/30 px-3 py-2 text-[12px] font-body text-ink">
                  <div className="flex items-center gap-1.5 text-danger font-semibold">
                    <Clock className="w-3.5 h-3.5" strokeWidth={2} />
                    {state.graceElapsed
                      ? 'Grace elapsed — ready for permanent deletion.'
                      : `Permanent deletion in ${state.graceRemainingDays} day${state.graceRemainingDays === 1 ? '' : 's'}.`}
                  </div>
                  {s.deletion_reason && (
                    <div className="mt-1 text-muted italic truncate" title={s.deletion_reason}>
                      Reason: {s.deletion_reason}
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {state.kind === 'deleted' ? (
                  isSuperAdmin ? (
                    <button
                      type="button"
                      onClick={() => handleRestore(s)}
                      className="flex-1 h-10 rounded-lg bg-brand hover:bg-brand-mid inline-flex items-center justify-center gap-2 text-sm font-semibold font-display text-white transition"
                    >
                      <RotateCcw className="w-4 h-4" strokeWidth={1.75} />
                      Restore
                    </button>
                  ) : (
                    <div className="flex-1 h-10 rounded-lg bg-gray-100 inline-flex items-center justify-center gap-2 text-sm font-body text-muted">
                      <ShieldAlert className="w-4 h-4" strokeWidth={1.75} />
                      Super admin required
                    </div>
                  )
                ) : state.kind === 'pending' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleCancelDeletion(s)}
                      className="flex-1 h-10 rounded-lg bg-surface-cream hover:bg-brand-mist inline-flex items-center justify-center gap-2 text-sm font-semibold font-display text-ink transition"
                    >
                      <RotateCcw className="w-4 h-4" strokeWidth={1.75} />
                      Cancel deletion
                    </button>
                    {state.graceElapsed && isSuperAdmin && (
                      <button
                        type="button"
                        onClick={() => setDeletionModal({ store: s, intent: 'permanent' })}
                        className="w-10 h-10 rounded-lg bg-danger hover:bg-danger/90 flex items-center justify-center transition"
                        title="Permanently delete (super admin)"
                      >
                        <Trash2 className="w-4 h-4 text-white" strokeWidth={1.75} />
                      </button>
                    )}
                  </>
                ) : isStoreSuggestion(s) ? (
                  <>
                    <button
                      type="button"
                      onClick={() => navigate(`/stores/${s.id}/edit?promote=1`)}
                      className="flex-1 h-10 rounded-lg bg-brand hover:bg-brand-mid inline-flex items-center justify-center gap-2 text-sm font-semibold font-display text-white transition"
                    >
                      <Sparkles className="w-4 h-4" strokeWidth={2} />
                      Review &amp; create
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletionModal({ store: s, intent: 'schedule' })}
                      className="w-10 h-10 rounded-lg hover:bg-danger-bg flex items-center justify-center transition"
                      title="Schedule deletion"
                    >
                      <Trash2 className="w-4 h-4 text-danger" strokeWidth={1.75} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => navigate(`/stores/${s.id}/edit`)}
                      className="flex-1 h-10 rounded-lg bg-surface-cream hover:bg-brand-mist inline-flex items-center justify-center gap-2 text-sm font-semibold font-display text-ink transition"
                    >
                      <Pencil className="w-4 h-4" strokeWidth={1.75} />
                      {t('common.edit', 'Edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletionModal({ store: s, intent: 'schedule' })}
                      className="w-10 h-10 rounded-lg hover:bg-danger-bg flex items-center justify-center transition"
                      title="Schedule deletion"
                    >
                      <Trash2 className="w-4 h-4 text-danger" strokeWidth={1.75} />
                    </button>
                  </>
                )}
              </div>
            </div>
            );
          })}
        </div>

        {/* Desktop table (md+) */}
        <div className="hidden md:block bg-card rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="bg-surface-cream">
                  <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">
                    {t('stores.col.name', 'Store')}
                  </th>
                  {/* The slug has a column only on very wide screens; below, it sits under the name,
                      so the Partner column fits without pushing Actions out of the card. */}
                  <th className="hidden 2xl:table-cell text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">
                    {t('stores.col.slug', 'Slug')}
                  </th>
                  <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">
                    {t('stores.col.partner', 'Partner')}
                  </th>
                  <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">
                    {t('stores.col.products', 'Products')}
                  </th>
                  <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">
                    {t('stores.col.followers', 'Followers')}
                  </th>
                  <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">
                    {t('stores.col.rating', 'Rating')}
                  </th>
                  <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">
                    {t('stores.col.status', 'Status')}
                  </th>
                  <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">
                    {t('stores.col.actions', 'Actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {stores.map((s) => {
                  const state = storeStates.get(s.id) ?? { kind: 'live' as const };
                  const rowTint =
                    state.kind === 'pending' ? 'bg-danger-bg/30 hover:bg-danger-bg/40'
                    : state.kind === 'deleted' ? 'bg-gray-50 hover:bg-gray-100 opacity-75'
                    : 'hover:bg-brand-mist/30';
                  return (
                  <tr key={s.id} className={`border-t border-border transition ${rowTint}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-lg border border-border flex items-center justify-center overflow-hidden shrink-0"
                          style={{ backgroundColor: s.logo_bg }}
                        >
                          {s.logo_url ? (
                            <img src={resolveImageUrl(s.logo_url, 'logo')} alt="" className="w-full h-full object-contain" />
                          ) : (
                            <StoreIcon className="w-5 h-5 text-muted" strokeWidth={1.75} />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-sm font-medium text-ink font-display truncate flex-wrap">
                            {s.name}
                            {s.is_verified && (
                              <CheckCircle2 className="w-4 h-4 text-brand shrink-0" strokeWidth={2} />
                            )}
                            {isStoreSuggestion(s) && state.kind === 'live' && (
                              <span
                                title="Auto-created by the Excel importer. Review and toggle active to publish the storefront."
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold font-display bg-amber-mist text-amber-deep border border-amber/40"
                              >
                                <Sparkles className="w-3 h-3" strokeWidth={2} />
                                From import
                              </span>
                            )}
                          </div>
                          {state.kind === 'pending' && (
                            <div
                              className="text-[11px] text-danger font-semibold mt-0.5"
                              title={s.deletion_reason ?? undefined}
                            >
                              {state.graceElapsed
                                ? '⚠ Ready for permanent deletion'
                                : `Permanent deletion in ${state.graceRemainingDays}d`}
                            </div>
                          )}
                          {state.kind === 'deleted' && (
                            <div className="text-[11px] text-muted font-body italic mt-0.5">
                              Tombstoned — hidden from all surfaces
                            </div>
                          )}
                          <span className="2xl:hidden block text-[11px] font-mono text-muted truncate max-w-[260px]">{s.slug}</span>
                          {state.kind === 'live' && s.origin && (
                            <span className="block text-xs text-muted mt-0.5">{s.origin}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="hidden 2xl:table-cell px-4 py-3">
                      <span className="text-xs font-mono text-muted">{s.slug}</span>
                    </td>
                    <td className="px-4 py-3">
                      <PartnerSlot
                        store={s}
                        live={state.kind === 'live'}
                        onAdd={() => setLinkTarget({ store: { id: s.id, name: s.name } })}
                        onOpen={() => navigate(`/stores/${s.id}/edit?tab=partner`)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
                        <Package className="w-4 h-4 text-muted" strokeWidth={1.75} />
                        {s._count.products}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink tabular-nums">{s.followers_count}</td>
                    <td className="px-4 py-3 text-sm text-ink tabular-nums">
                      {s.rating != null
                        ? <>
                            <span className="font-semibold">{s.rating.toFixed(1)}</span>
                            <span className="text-muted ml-1">({s.rating_count})</span>
                          </>
                        : <span className="text-muted">—</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      {state.kind === 'pending' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold font-display bg-danger-bg text-danger border border-danger/40">
                          <Clock className="w-3 h-3" strokeWidth={2} />
                          {state.graceElapsed ? 'Ready to delete' : `${state.graceRemainingDays}d`}
                        </span>
                      ) : state.kind === 'deleted' ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display bg-gray-200 text-gray-700 border border-gray-300">
                          Deleted
                        </span>
                      ) : (() => {
                        const style = VISIBILITY_STYLES[storeVisibility(s)];
                        return (
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display ${style.classes}`}
                          >
                            {style.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {state.kind === 'deleted' ? (
                          isSuperAdmin ? (
                            <button
                              type="button"
                              onClick={() => handleRestore(s)}
                              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-brand text-white text-xs font-semibold font-display hover:bg-brand-mid transition"
                            >
                              <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                              Restore
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-body text-muted">
                              <ShieldAlert className="w-3.5 h-3.5" strokeWidth={1.75} />
                              Super admin
                            </span>
                          )
                        ) : state.kind === 'pending' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleCancelDeletion(s)}
                              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-surface-cream hover:bg-brand-mist text-ink text-xs font-semibold font-display transition"
                            >
                              <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.75} />
                              Cancel
                            </button>
                            {state.graceElapsed && isSuperAdmin && (
                              <button
                                type="button"
                                onClick={() => setDeletionModal({ store: s, intent: 'permanent' })}
                                className="w-9 h-9 rounded-lg bg-danger hover:bg-danger/90 flex items-center justify-center transition"
                                title="Permanently delete (super admin)"
                              >
                                <Trash2 className="w-4 h-4 text-white" strokeWidth={1.75} />
                              </button>
                            )}
                          </>
                        ) : isStoreSuggestion(s) ? (
                          <>
                            <button
                              type="button"
                              onClick={() => navigate(`/stores/${s.id}/edit?promote=1`)}
                              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-brand text-white text-xs font-semibold font-display hover:bg-brand-mid transition"
                            >
                              <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
                              Review &amp; create
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletionModal({ store: s, intent: 'schedule' })}
                              className="w-9 h-9 rounded-lg hover:bg-danger-bg flex items-center justify-center transition"
                              title="Schedule deletion"
                            >
                              <Trash2 className="w-4 h-4 text-danger" strokeWidth={1.75} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => navigate(`/stores/${s.id}/edit`)}
                              className="w-9 h-9 rounded-lg bg-surface-cream hover:bg-brand-mist flex items-center justify-center transition"
                              title={t('common.edit', 'Edit')}
                            >
                              <Pencil className="w-4 h-4 text-ink" strokeWidth={1.75} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletionModal({ store: s, intent: 'schedule' })}
                              className="w-9 h-9 rounded-lg hover:bg-danger-bg flex items-center justify-center transition"
                              title="Schedule deletion"
                            >
                              <Trash2 className="w-4 h-4 text-danger" strokeWidth={1.75} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {!isLoading && data && (
        <Pagination
          page={page}
          totalPages={data.totalPages ?? 1}
          onPageChange={setPage}
          totalItems={data.total}
          pageSize={PAGE_SIZE}
          className="mt-6"
        />
      )}

      <LinkPartnerDialog open={!!linkTarget} store={linkTarget?.store} onClose={() => setLinkTarget(null)} />

      {deletionModal && (
        <StoreDeletionModal
          open
          intent={deletionModal.intent}
          store={deletionModal.store}
          productsCount={deletionModal.store._count.products}
          repsCount={deletionModal.store._count.sales_reps}
          errorMessage={deletionModal.error}
          isSubmitting={scheduleDeletion.isPending || permanentDeleteMut.isPending}
          onCancel={() => setDeletionModal(null)}
          onConfirm={handleConfirmDeletion}
        />
      )}
    </div>
  );
}
