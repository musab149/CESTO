import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useGoBack } from '@/lib/useGoBack';
import { useTranslation } from 'react-i18next';
import BackLink from '@/components/BackLink';
import { Copy, AlertTriangle, CheckCircle2, Package, Archive, Trash2,
  ShoppingCart, Image as ImageIcon, Boxes, RefreshCcw, XCircle, PackageOpen,
  Store as StoreIcon, Info, GitMerge, EyeOff, X, Undo2, FileSpreadsheet,
  ArrowRight, Loader2, PlusCircle,
} from 'lucide-react';
import {
  useAdminProductDuplicates,
  useResolveProductDuplicates,
  useMergeProductDuplicates,
  useProductImportDuplicates,
  useCreateFromImportDuplicate,
  useDismissImportDuplicate,
  useDismissAllImportDuplicates,
  resolveImageUrl,
  type AdminProductDuplicateEntry,
  type AdminProductDuplicateGroup,
  type DuplicateMatchReason,
  type ResolveDuplicatesResult,
  type MergeDuplicatesResult,
  type DuplicateVariantSnapshot,
  type ProductImportDuplicate,
} from '@grocery-app/shared';

// ─── Small helpers ──────────────────────────────────────

const REASON_LABEL: Record<DuplicateMatchReason, string> = {
  same_name: 'Same name',
  same_brand_variant: 'Same brand + size',
  same_image: 'Same image',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

/** Best-guess canonical for a same-store group. Prefers rows with order
 *  history (destroying them rewrites customers' past), then active, then
 *  more variants+images, then oldest. Cross-store groups DON'T get an
 *  auto-pick — admin decides. */
function pickCanonical(products: AdminProductDuplicateEntry[]): string {
  const sorted = [...products].sort((a, b) => {
    if ((a.order_item_count > 0) !== (b.order_item_count > 0)) return a.order_item_count > 0 ? -1 : 1;
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    const aScore = a.variant_count + a.image_count;
    const bScore = b.variant_count + b.image_count;
    if (aScore !== bScore) return bScore - aScore;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
  return sorted[0].id;
}

// ─── Dismissed-group persistence ────────────────────────
// "Not a duplicate" is a client-side dismissal — persists in localStorage
// so admins don't have to keep dismissing the same false-positive groups
// on every rescan. Keyed by the group's stable server-side key.
const DISMISSED_KEY = 'admin.duplicates.dismissed_group_keys';
function loadDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set(); }
}
function saveDismissed(s: Set<string>) {
  try { window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...s])); } catch { /* quota / private */ }
}

// ─── Page ───────────────────────────────────────────────

type TabView = 'duplicates' | 'multi-store' | 'import';

export default function ProductDuplicatesPage() {
  const { t } = useTranslation();
  const goBack = useGoBack();
  const [searchParams, setSearchParams] = useSearchParams();
  // Tab state lives in the URL (`?view=multi-store` | `?view=import`) so
  // admins can bookmark or share a direct link to a specific view.
  const rawView = searchParams.get('view');
  const activeTab: TabView =
    rawView === 'multi-store' ? 'multi-store' :
    rawView === 'import'      ? 'import'      :
                                'duplicates';
  function setTab(next: TabView) {
    const params = new URLSearchParams(searchParams);
    if (next === 'duplicates') params.delete('view');
    else params.set('view', next);
    setSearchParams(params, { replace: true });
  }
  const { data, isLoading, isRefetching, refetch } = useAdminProductDuplicates();
  // Import-duplicates load only when their tab is (or will be) rendered.
  // Enabled always so the count badge on the tab reflects reality without
  // requiring the admin to click the tab first.
  const {
    data: importDupsData,
    isLoading: importDupsLoading,
    isRefetching: importDupsRefetching,
    refetch: refetchImportDups,
  } = useProductImportDuplicates('pending');
  const importDups = importDupsData?.items ?? [];
  const dismissAllMutation = useDismissAllImportDuplicates();
  const [confirmDismissAll, setConfirmDismissAll] = useState(false);

  async function doDismissAll() {
    setConfirmDismissAll(false);
    try {
      await dismissAllMutation.mutateAsync(undefined);
    } catch { /* mutation error surfaces via the mutation state */ }
  }
  const resolveMutation = useResolveProductDuplicates();
  const mergeMutation   = useMergeProductDuplicates();
  const [lastResolveResult, setLastResolveResult] = useState<ResolveDuplicatesResult | null>(null);
  const [lastMergeResult,   setLastMergeResult]   = useState<MergeDuplicatesResult   | null>(null);

  // Per-group canonical override (admin clicked "Keep this" on a card).
  const [keepOverrides, setKeepOverrides] = useState<Record<string, string>>({});

  // Persistent client-side dismissals ("Not a duplicate").
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());
  useEffect(() => { saveDismissed(dismissed); }, [dismissed]);

  const allGroups = data?.groups ?? [];
  // Multi-store listings — same product across ≥2 stores. Informational
  // only (see backend comment in products.ts /duplicates handler).
  const multiStoreListings = data?.multi_store_listings ?? [];
  // Groups admin hasn't dismissed. Dismissed ones still count in the
  // page's "N hidden" indicator so admin can undo. Dismissals cover both
  // sections — same key namespace, so a dismissed multi-store listing
  // stays dismissed even if the fingerprint later moves into duplicates.
  const groups = useMemo(() => allGroups.filter((g) => !dismissed.has(g.key)), [allGroups, dismissed]);
  const dismissedGroups = useMemo(() => allGroups.filter((g) => dismissed.has(g.key)), [allGroups, dismissed]);

  const isPending = resolveMutation.isPending || mergeMutation.isPending;
  const isBusyGroupKey = resolveMutation.isPending || mergeMutation.isPending;

  function keepIdFor(g: AdminProductDuplicateGroup): string {
    if (keepOverrides[g.key]) return keepOverrides[g.key];
    // Cross-store groups default to "unpicked" — safer, since these are
    // usually intentional multi-store listings.
    return g.is_cross_store ? '' : pickCanonical(g.products);
  }

  async function runResolve(group: AdminProductDuplicateGroup) {
    const keep = keepIdFor(group);
    if (!keep) return;
    const removeIds = group.products.map((p) => p.id).filter((id) => id !== keep);
    if (removeIds.length === 0) return;
    try {
      const res = await resolveMutation.mutateAsync({ groups: [{ keep_id: keep, remove_ids: removeIds }] });
      setLastResolveResult(res);
      setLastMergeResult(null);
    } catch { /* mutation error surfaces below */ }
  }

  async function runMerge(group: AdminProductDuplicateGroup) {
    const keep = keepIdFor(group);
    if (!keep) return;
    const removeIds = group.products.map((p) => p.id).filter((id) => id !== keep);
    if (removeIds.length === 0) return;
    try {
      const res = await mergeMutation.mutateAsync({ groups: [{ keep_id: keep, remove_ids: removeIds }] });
      setLastMergeResult(res);
      setLastResolveResult(null);
    } catch { /* mutation error surfaces below */ }
  }

  function dismiss(key: string) {
    setDismissed((prev) => {
      const next = new Set(prev); next.add(key); return next;
    });
  }
  function undismiss(key: string) {
    setDismissed((prev) => {
      const next = new Set(prev); next.delete(key); return next;
    });
  }

  return (
    <div>
      {/* Header */}
      <BackLink
        label={t('common.backToProducts', 'Back to products')}
        onClick={() => goBack('/products')}
        className="mb-3"
      />
      <div className="flex flex-col md:flex-row md:items-center gap-4 mb-6">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold font-display text-ink inline-flex items-center gap-2">
              <Copy size={22} strokeWidth={1.75} />
              Duplicate products
            </h1>
            <p className="text-sm text-muted mt-1">
              Products with matching identity (name + brand + origin + category). Duplicates share a store; multi-store listings span several.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => { refetch(); refetchImportDups(); }}
            disabled={isLoading || isRefetching || importDupsLoading || importDupsRefetching}
            className="inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-surface-cream hover:bg-brand-mist text-ink font-semibold font-display text-sm transition disabled:opacity-50"
          >
            <RefreshCcw size={16} strokeWidth={1.75} className={(isRefetching || importDupsRefetching) ? 'animate-spin' : ''} />
            Rescan
          </button>
        </div>
      </div>

      {/* Tab bar — three views: actionable duplicates, informational
          multi-store listings, and Excel-import review queue. Counts
          on each tab so admin can see workload without switching. */}
      <div className="tab-strip flex items-center gap-1 border-b border-border mb-6 overflow-x-auto">
        <TabButton
          active={activeTab === 'duplicates'}
          onClick={() => setTab('duplicates')}
          icon={<Copy size={16} strokeWidth={1.75} />}
          label="Duplicates"
          count={allGroups.length}
        />
        <TabButton
          active={activeTab === 'multi-store'}
          onClick={() => setTab('multi-store')}
          icon={<StoreIcon size={16} strokeWidth={1.75} />}
          label="Multi-store listings"
          count={multiStoreListings.length}
        />
        <TabButton
          active={activeTab === 'import'}
          onClick={() => setTab('import')}
          icon={<FileSpreadsheet size={16} strokeWidth={1.75} />}
          label="From Excel import"
          count={importDups.length}
        />
      </div>

      {/* Actions legend — duplicates tab only. Multi-store is read-only,
          so the three-actions explainer doesn't apply there. */}
      {activeTab === 'duplicates' && (
        <div className="bg-info-bg border border-info/30 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <Info size={18} strokeWidth={1.75} className="text-info shrink-0 mt-0.5" />
            <div className="text-sm text-ink font-body">
              <p className="font-semibold text-info mb-1">Three ways to handle a duplicate group</p>
              <ul className="space-y-0.5 text-gray text-[13px]">
                <li>
                  <strong>Delete others</strong> — same product, same data. Keep one; the rest deactivate (if they have order history) or hard-delete (if not).
                </li>
                <li>
                  <strong>Merge variants</strong> — same product but split across rows with different sizes/prices. Moves every variant + image onto the canonical, then deletes the empty shells. Order history is preserved.
                </li>
                <li>
                  <strong>Not a duplicate</strong> — dismissal (stored in your browser). Rare — usually a false positive on identity match.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Result banners */}
      {lastResolveResult && (
        <ResolveResultBanner result={lastResolveResult} onDismiss={() => setLastResolveResult(null)} />
      )}
      {lastMergeResult && (
        <MergeResultBanner result={lastMergeResult} onDismiss={() => setLastMergeResult(null)} />
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center h-64">
          <p className="text-sm text-muted font-body">Loading duplicates…</p>
        </div>
      )}

      {/* Mutation error */}
      {(resolveMutation.isError || mergeMutation.isError) && (
        <div className="bg-danger-bg border border-danger/30 rounded-lg p-3 mb-4 text-sm text-danger font-body">
          {(resolveMutation.error ?? mergeMutation.error) instanceof Error
            ? ((resolveMutation.error ?? mergeMutation.error) as Error).message
            : 'Something failed. Try again.'}
        </div>
      )}

      {/* ── DUPLICATES TAB ──────────────────────────────── */}
      {activeTab === 'duplicates' && (
        <>
          {/* Empty state — no active groups and nothing dismissed either. */}
          {!isLoading && groups.length === 0 && dismissedGroups.length === 0 && (
            <div className="bg-card rounded-xl border border-border p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-success-bg mx-auto mb-4 flex items-center justify-center">
                <CheckCircle2 size={32} strokeWidth={1.5} className="text-success" />
              </div>
              <p className="text-lg font-bold font-display text-ink mb-1">No duplicate products found</p>
              <p className="text-sm text-muted font-body">
                No two products share the same identity within a single store.
                {multiStoreListings.length > 0 && (
                  <> Same identity across stores lives on the <button type="button" onClick={() => setTab('multi-store')} className="text-info hover:underline font-semibold">Multi-store listings</button> tab.</>
                )}
              </p>
            </div>
          )}

          {/* Dismissed strip — only relevant on the duplicates tab. */}
          {!isLoading && dismissedGroups.length > 0 && (
            <div className="flex items-center justify-between text-xs font-body text-muted mb-3">
              <span>
                <EyeOff size={11} strokeWidth={2} className="inline-block mr-1 -mt-0.5" />
                <strong>{dismissedGroups.length}</strong> group{dismissedGroups.length === 1 ? '' : 's'} dismissed as “not duplicates”.
              </span>
              <details className="cursor-pointer">
                <summary className="text-info hover:underline">Show dismissed</summary>
                <div className="mt-2 space-y-1">
                  {dismissedGroups.map((g) => (
                    <div key={g.key} className="flex items-center justify-between bg-surface-cream border border-border rounded px-2 py-1 text-[11px]">
                      <span className="truncate max-w-md">"{g.label}" — {g.products.length} products</span>
                      <button
                        type="button"
                        onClick={() => undismiss(g.key)}
                        className="text-info hover:underline inline-flex items-center gap-1 shrink-0"
                      >
                        <Undo2 size={11} strokeWidth={2} />
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}

          {/* Duplicate groups — actionable (same store, same identity). */}
          {!isLoading && groups.length > 0 && (
            <div className="space-y-6">
              {groups.map((g) => (
                <GroupCard
                  key={g.key}
                  group={g}
                  keepId={keepIdFor(g)}
                  isPending={isBusyGroupKey}
                  onKeepChange={(pid) => setKeepOverrides((prev) => ({ ...prev, [g.key]: pid }))}
                  onResolve={() => runResolve(g)}
                  onMerge={() => runMerge(g)}
                  onDismiss={() => dismiss(g.key)}
                />
              ))}
              {isPending && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 pointer-events-none">
                  <div className="bg-card shadow-modal rounded-xl px-4 py-2 text-sm font-semibold font-display text-ink pointer-events-auto">
                    Working…
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── MULTI-STORE LISTINGS TAB ────────────────────── */}
      {activeTab === 'multi-store' && (
        <>
          {/* Explainer banner — mirrors the duplicates tab's info card so
              the visual weight of the two views is consistent. */}
          <div className="bg-info-bg border border-info/30 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <StoreIcon size={18} strokeWidth={1.75} className="text-info shrink-0 mt-0.5" />
              <div className="text-sm text-ink font-body">
                <p className="font-semibold text-info mb-1">Same product, multiple stores</p>
                <p className="text-gray text-[13px]">
                  Products with the same identity (name + brand + origin + category) listed by ≥2 stores. Not duplicates — this is normal when several partners stock the same catalogue item. Shown for reference only; no actions here.
                </p>
              </div>
            </div>
          </div>

          {/* Empty state */}
          {!isLoading && multiStoreListings.length === 0 && (
            <div className="bg-card rounded-xl border border-border p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-surface-cream mx-auto mb-4 flex items-center justify-center">
                <StoreIcon size={32} strokeWidth={1.5} className="text-muted" />
              </div>
              <p className="text-lg font-bold font-display text-ink mb-1">No multi-store listings</p>
              <p className="text-sm text-muted font-body">
                No product is currently listed by more than one store.
              </p>
            </div>
          )}

          {/* Listings */}
          {!isLoading && multiStoreListings.length > 0 && (
            <div className="space-y-6">
              {multiStoreListings.map((g) => (
                <GroupCard
                  key={g.key}
                  group={g}
                  keepId=""
                  isPending={false}
                  onKeepChange={() => { /* read-only */ }}
                  onResolve={() => { /* read-only */ }}
                  onMerge={() => { /* read-only */ }}
                  onDismiss={() => { /* read-only */ }}
                  readOnly
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── FROM EXCEL IMPORT TAB ───────────────────────── */}
      {activeTab === 'import' && (
        <>
          {/* Explainer */}
          <div className="bg-info-bg border border-info/30 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <FileSpreadsheet size={18} strokeWidth={1.75} className="text-info shrink-0 mt-0.5" />
              <div className="text-sm text-ink font-body">
                <p className="font-semibold text-info mb-1">Rows the Excel importer flagged</p>
                <p className="text-gray text-[13px]">
                  When an import row matches an existing product's identity in the same store, we don't silently drop it — it lands here so you decide. <strong>Create anyway</strong> inserts the row as a real product (bypasses the duplicate guard). <strong>Dismiss</strong> drops it (kept for audit, hidden from this list).
                </p>
              </div>
            </div>
          </div>

          {/* Loading */}
          {importDupsLoading && (
            <div className="flex items-center justify-center h-40">
              <p className="text-sm text-muted font-body">Loading…</p>
            </div>
          )}

          {/* Empty */}
          {!importDupsLoading && importDups.length === 0 && (
            <div className="bg-card rounded-xl border border-border p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-surface-cream mx-auto mb-4 flex items-center justify-center">
                <FileSpreadsheet size={32} strokeWidth={1.5} className="text-muted" />
              </div>
              <p className="text-lg font-bold font-display text-ink mb-1">Nothing waiting for review</p>
              <p className="text-sm text-muted font-body">
                Excel imports haven't flagged any rows as duplicates lately.
              </p>
            </div>
          )}

          {/* Bulk actions bar — only shown when there's something to act on */}
          {!importDupsLoading && importDups.length > 0 && (
            <div className="flex items-center justify-between mb-4 text-xs font-body text-muted">
              <span>
                <strong className="text-ink">{importDups.length}</strong> row{importDups.length === 1 ? '' : 's'} waiting for review.
              </span>
              <button
                type="button"
                onClick={() => setConfirmDismissAll(true)}
                disabled={dismissAllMutation.isPending}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-card border border-border hover:border-info hover:text-info text-ink font-semibold font-display text-xs transition disabled:opacity-50"
              >
                {dismissAllMutation.isPending
                  ? <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                  : <EyeOff size={13} strokeWidth={2} />}
                Dismiss all
              </button>
            </div>
          )}

          {/* Rows */}
          {!importDupsLoading && importDups.length > 0 && (
            <div className="space-y-4">
              {importDups.map((row) => (
                <ImportDuplicateCard key={row.id} row={row} />
              ))}
            </div>
          )}

          {/* Confirm dialog — bulk-dismiss is not destructive (rows are
              soft-deleted, still queryable with ?status=all) but the
              scale of a bulk action deserves a beat. */}
          {confirmDismissAll && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmDismissAll(false)}>
              <div className="bg-card rounded-2xl p-6 shadow-modal w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-info-bg flex items-center justify-center flex-shrink-0">
                    <EyeOff size={20} strokeWidth={1.75} className="text-info" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold font-display text-ink">Dismiss all pending?</h3>
                    <p className="text-sm text-muted font-body mt-0.5">
                      <strong className="text-ink">{importDups.length}</strong> row{importDups.length === 1 ? '' : 's'} will be marked as dismissed.
                    </p>
                  </div>
                </div>
                <p className="text-sm text-gray font-body bg-surface-cream rounded-lg p-3 mb-4">
                  Rows stay in the database for audit — you can still find them under <span className="font-mono">?status=dismissed</span>. They just leave the pending review list.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setConfirmDismissAll(false)}
                    className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={doDismissAll}
                    disabled={dismissAllMutation.isPending}
                    className="h-11 px-5 rounded-xl text-sm font-semibold font-display bg-info text-white hover:bg-info/90 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {dismissAllMutation.isPending && <Loader2 size={14} strokeWidth={2} className="animate-spin" />}
                    Dismiss all
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── ImportDuplicateCard ────────────────────────────────
// Side-by-side comparison of the incoming Excel row vs the existing
// product it duplicates. Create Anyway / Dismiss are per-card mutations.

function ImportDuplicateCard({ row }: { row: ProductImportDuplicate }) {
  const createMutation  = useCreateFromImportDuplicate();
  const dismissMutation = useDismissImportDuplicate();
  const busy = createMutation.isPending || dismissMutation.isPending;
  const [lastError, setLastError] = useState<string | null>(null);

  const incoming = row.payload;
  const matched  = row.matched_product;
  const defaultVariant = incoming.variants.find((v) => v.is_default) ?? incoming.variants[0];
  const totalStock = incoming.variants.reduce((s, v) => s + v.stock_quantity, 0);
  const matchedImage = matched?.images?.[0]?.url ?? null;
  const incomingImage = incoming.image_urls?.[0] ?? null;

  async function doCreate() {
    setLastError(null);
    try {
      await createMutation.mutateAsync(row.id);
    } catch (err) {
      setLastError(err instanceof Error ? err.message : 'Create failed.');
    }
  }
  async function doDismiss() {
    setLastError(null);
    try {
      await dismissMutation.mutateAsync(row.id);
    } catch (err) {
      setLastError(err instanceof Error ? err.message : 'Dismiss failed.');
    }
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header — provenance */}
      <div className="px-4 py-3 border-b border-border bg-surface-cream flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide font-display font-semibold text-muted">
            From <span className="font-mono normal-case tracking-normal">{row.job?.filename ?? 'unknown file'}</span>
            {' · '}
            row <span className="font-mono">{row.source_row_number}</span>
          </p>
          <p className="text-sm font-mono text-ink mt-0.5 break-all">"{incoming.name_es}"</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[11px] font-body text-muted">Uploaded {new Date(row.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
          {row.job?.admin && (
            <p className="text-[11px] font-body text-muted">by {row.job.admin.name || row.job.admin.email}</p>
          )}
        </div>
      </div>

      {/* Body — side-by-side, 260px cards matching the Duplicate groups
          tab. Horizontally scrolls if the viewport can't fit both. */}
      <div className="p-4 overflow-x-auto">
        <div className="flex items-stretch gap-3 min-w-max">
          {/* Incoming (from Excel) */}
          <div className="w-[260px] shrink-0 rounded-lg border-2 border-info/40 bg-info-bg/20 overflow-hidden flex flex-col">
            <div className="px-2 py-1.5 border-b border-info/30 bg-info-bg/60 text-[11px] font-display font-bold uppercase tracking-wide text-info">
              Incoming (from Excel)
            </div>
            <div className="aspect-[4/3] bg-surface-cream flex items-center justify-center overflow-hidden">
              {incomingImage ? (
                <img src={resolveImageUrl(incomingImage, 'thumb') ?? ''} alt={incoming.name_es} className="w-full h-full object-cover" />
              ) : (
                <ImageIcon size={32} strokeWidth={1.25} className="text-muted" />
              )}
            </div>
            <div className="p-3 flex-1 flex flex-col gap-2">
              <p className="text-sm font-semibold font-display leading-tight text-ink">{incoming.name_es}</p>
              <p className="text-[11px] text-muted font-body -mt-1">{incoming.name_en}</p>
              <div className="inline-flex items-center gap-1 text-[11px] text-ink font-body">
                <StoreIcon size={11} strokeWidth={1.75} className="text-muted" />
                <span className="font-semibold">{incoming.store_slug ? incoming.store_slug : 'Cesto (default)'}</span>
              </div>
              {incoming.brand && (
                <div className="inline-flex items-center gap-1 text-[11px] text-muted font-body">
                  <Package size={11} strokeWidth={1.75} />
                  {incoming.brand}
                  {incoming.origin && <span>· {incoming.origin}</span>}
                </div>
              )}
              <div className="mt-1 border-t border-info/20 pt-2">
                <div className="text-[11px] uppercase tracking-wide text-muted font-display font-semibold mb-1">
                  Variants ({incoming.variants.length})
                </div>
                <div className="space-y-1">
                  {incoming.variants.slice(0, 3).map((v, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-[11px] font-body px-1.5 py-1 rounded bg-white/70">
                      <div className="min-w-0 flex-1">
                        <span className="font-semibold text-ink truncate">{v.name_es}</span>
                        {v.is_default && (
                          <span className="ml-1 text-[11px] font-bold text-info uppercase tracking-wide">default</span>
                        )}
                      </div>
                      <div className="shrink-0 flex items-center gap-2 text-ink">
                        <span className="font-mono">€{v.price}</span>
                        {/* The sheet's b2b_price reached the database but not
                            this screen, so the wholesale price was invisible
                            while deciding what to do with a flagged row. */}
                        {v.b2b_price != null && (
                          <span className="font-mono text-[11px] text-brand font-semibold" title="B2B / wholesale price">
                            €{v.b2b_price}
                          </span>
                        )}
                        <span className="font-mono text-[11px] text-muted">×{v.stock_quantity}</span>
                      </div>
                    </div>
                  ))}
                  {incoming.variants.length > 3 && (
                    <div className="text-[11px] text-muted font-body italic">+ {incoming.variants.length - 3} more</div>
                  )}
                </div>
              </div>
              <div className="mt-auto pt-2 border-t border-info/20 text-[11px] text-muted font-body">
                Total stock: {totalStock}{defaultVariant?.sku && ` · SKU ${defaultVariant.sku}`}
              </div>
            </div>
          </div>

          {/* Arrow separator */}
          <div className="flex items-center justify-center px-1 shrink-0">
            <ArrowRight size={18} strokeWidth={1.75} className="text-muted" />
          </div>

          {/* Existing match */}
          <div className={`w-[260px] shrink-0 rounded-lg border-2 overflow-hidden flex flex-col ${matched ? 'border-border bg-card' : 'border-amber/40 bg-amber-mist/20'}`}>
            <div className={`px-2 py-1.5 border-b text-[11px] font-display font-bold uppercase tracking-wide ${
              matched ? 'border-border bg-surface-cream text-muted' : 'border-amber/30 bg-amber-mist/40 text-amber-deep'
            }`}>
              {matched ? 'Already in catalogue' : 'Match no longer exists'}
            </div>
            {matched ? (
              <>
                <div className="aspect-[4/3] bg-surface-cream flex items-center justify-center overflow-hidden">
                  {matchedImage ? (
                    <img src={resolveImageUrl(matchedImage, 'thumb') ?? ''} alt={matched.name_es} className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon size={32} strokeWidth={1.25} className="text-muted" />
                  )}
                </div>
                <div className="p-3 flex-1 flex flex-col gap-2">
                  <p className="text-sm font-semibold font-display leading-tight text-ink">{matched.name_es}</p>
                  <p className="text-[11px] text-muted font-body -mt-1">{matched.name_en}</p>
                  <div className="inline-flex items-center gap-1 text-[11px] text-ink font-body">
                    <StoreIcon size={11} strokeWidth={1.75} className="text-muted" />
                    <span className="font-semibold">{matched.store?.name ?? 'Cesto (default)'}</span>
                  </div>
                  {matched.brand && (
                    <div className="inline-flex items-center gap-1 text-[11px] text-muted font-body">
                      <Package size={11} strokeWidth={1.75} />
                      {matched.brand}
                      {matched.origin && <span>· {matched.origin}</span>}
                    </div>
                  )}
                  <div className="mt-auto pt-2 border-t border-border/60 flex items-center justify-between gap-2 text-[11px] text-muted font-body">
                    <span>{matched._count.variants} variant{matched._count.variants === 1 ? '' : 's'} · {matched.is_active ? 'Active' : 'Inactive'}</span>
                    <Link
                      to={`/products/${matched.id}/edit`}
                      target="_blank"
                      className="inline-flex items-center gap-1 text-info hover:underline font-semibold font-display"
                    >
                      <Package size={11} strokeWidth={1.75} />
                      Open
                    </Link>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-3 flex-1 flex items-center">
                <p className="text-[11px] text-amber-deep font-body">
                  <strong>{row.matched_product_name}</strong> — this product was deleted after the import ran. Creating anyway is safe; dismissing drops the row.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mutation error */}
      {lastError && (
        <div className="px-4 pb-2 -mt-2 text-xs text-danger font-body">
          {lastError}
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-3 border-t border-border bg-surface-cream/60 flex items-center justify-end gap-2 flex-wrap">
        <button
          type="button"
          onClick={doDismiss}
          disabled={busy}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-card border border-border hover:border-info hover:text-info text-ink font-semibold font-display text-xs transition disabled:opacity-50"
        >
          {dismissMutation.isPending
            ? <Loader2 size={13} strokeWidth={2} className="animate-spin" />
            : <EyeOff size={13} strokeWidth={2} />}
          Dismiss
        </button>
        <button
          type="button"
          onClick={doCreate}
          disabled={busy}
          title="Insert this row as a real product, bypassing the duplicate guard."
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-brand hover:bg-brand-mid text-white font-semibold font-display text-xs transition disabled:opacity-50"
        >
          {createMutation.isPending
            ? <Loader2 size={13} strokeWidth={2} className="animate-spin" />
            : <PlusCircle size={13} strokeWidth={2} />}
          Create anyway
        </button>
      </div>
    </div>
  );
}

// ─── Tab button ─────────────────────────────────────────
// Kept next to the page so the styling doesn't leak into a shared
// component. Underline-below-active-tab pattern matches the admin's
// existing tabbed pages (product form, store form).
function TabButton({
  active, onClick, icon, label, count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 h-11 px-4 -mb-px border-b-2 font-display text-sm font-semibold transition ${
        active
          ? 'border-brand text-brand'
          : 'border-transparent text-muted hover:text-ink hover:border-border'
      }`}
    >
      {icon}
      {label}
      <span
        className={`min-w-[20px] h-5 inline-flex items-center justify-center px-1.5 rounded-full text-[11px] font-bold tabular-nums ${
          active ? 'bg-brand text-white' : 'bg-surface-cream text-muted'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

// ─── GroupCard ──────────────────────────────────────────

function GroupCard({
  group, keepId, isPending, onKeepChange, onResolve, onMerge, onDismiss, readOnly = false,
}: {
  group: AdminProductDuplicateGroup;
  keepId: string;
  isPending: boolean;
  onKeepChange: (pid: string) => void;
  onResolve: () => void;
  onMerge: () => void;
  onDismiss: () => void;
  /** Suppress destructive actions + canonical picker. Used for the
   *  multi-store listings section, which is informational only. */
  readOnly?: boolean;
}) {
  const distinctStoreNames = Array.from(
    new Set(group.products.map((p) => p.store?.name ?? 'Cesto (default)')),
  );
  const isCrossStore = group.is_cross_store;
  const nothingPicked = !keepId;

  // Signals per field so we can highlight matches vs. differences.
  const nameEsSame = new Set(group.products.map((p) => p.name_es.trim().toLowerCase())).size === 1;
  const brandSame  = new Set(group.products.map((p) => (p.brand ?? '').trim().toLowerCase())).size === 1;

  return (
    <div className={`bg-card border rounded-xl overflow-hidden ${isCrossStore ? 'border-info/50' : 'border-border'}`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b flex items-start justify-between gap-3 flex-wrap ${
        isCrossStore ? 'bg-info-bg/40 border-info/30' : 'bg-surface-cream border-border'
      }`}>
        <div className="min-w-0">
          <p className={`text-xs uppercase tracking-wide font-display font-semibold ${
            isCrossStore ? 'text-info' : 'text-muted'
          }`}>
            {isCrossStore ? `Multi-store listing (${distinctStoreNames.length} stores)` : `Duplicate group · ${group.products.length} products`}
          </p>
          <p className="text-sm font-mono text-ink mt-0.5 break-all">"{group.label}"</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {group.match_reasons?.map((r) => (
              <span
                key={r}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold font-display uppercase tracking-wide bg-info-bg text-info"
              >
                {REASON_LABEL[r]}
              </span>
            ))}
            {isCrossStore && distinctStoreNames.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold font-display bg-card border border-info/40 text-info"
              >
                <StoreIcon size={10} strokeWidth={2} />
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Info banner for cross-store */}
      {isCrossStore && (
        <div className="px-4 py-2 bg-info-bg/60 border-b border-info/30 flex items-start gap-2">
          <Info size={14} strokeWidth={2} className="text-info shrink-0 mt-0.5" />
          <p className="text-[11px] font-body text-info">
            This product exists across <span className="font-semibold">{distinctStoreNames.length}</span> stores.
            Usually intentional — leave it alone unless you actually want to consolidate.
          </p>
        </div>
      )}

      {/* Comparison grid — products side by side. Row scrolls
          horizontally when the group has more products than fit in the
          viewport (5+ cards ≈ overflow on typical laptop widths). Cards
          are fixed-width so they don't shrink into unreadability. */}
      <div className="p-4 overflow-x-auto">
        <div className="flex gap-3 min-w-max">
          {group.products.map((p) => (
            <div key={p.id} className="w-[260px] shrink-0">
              <ProductComparisonCard
                product={p}
                isCanonical={keepId === p.id}
                nameSame={nameEsSame}
                brandSame={brandSame}
                onSelect={() => onKeepChange(p.id)}
                readOnly={readOnly}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Actions — omitted entirely for read-only cards (multi-store
          listings). Nothing to do here; the section header carries the
          "these are informational" framing. */}
      {!readOnly && (
      <div className="px-4 py-3 border-t border-border bg-surface-cream/60 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11px] font-body text-muted">
          {nothingPicked
            ? 'Click "Keep this" on a card to pick the canonical, then choose an action.'
            : 'Canonical selected. Pick an action for the rest.'}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onDismiss}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-card border border-border hover:border-info hover:text-info text-ink font-semibold font-display text-xs transition disabled:opacity-50"
          >
            <EyeOff size={13} strokeWidth={2} />
            Not a duplicate
          </button>
          <button
            type="button"
            onClick={onMerge}
            disabled={isPending || nothingPicked}
            title={nothingPicked ? 'Pick a canonical first.' : 'Move all variants + images into the canonical, then delete the others.'}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-brand hover:bg-brand-mid text-white font-semibold font-display text-xs transition disabled:opacity-50"
          >
            <GitMerge size={13} strokeWidth={2} />
            Merge variants into canonical
          </button>
          <button
            type="button"
            onClick={onResolve}
            disabled={isPending || nothingPicked}
            title={nothingPicked ? 'Pick a canonical first.' : 'Delete or deactivate the non-canonical rows.'}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-danger hover:bg-danger/90 text-white font-semibold font-display text-xs transition disabled:opacity-50"
          >
            <Trash2 size={13} strokeWidth={2} />
            Delete others
          </button>
        </div>
      </div>
      )}
    </div>
  );
}

// ─── ProductComparisonCard ─────────────────────────────

function ProductComparisonCard({
  product: p, isCanonical, nameSame, brandSame, onSelect, readOnly = false,
}: {
  product: AdminProductDuplicateEntry;
  isCanonical: boolean;
  nameSame: boolean;
  brandSame: boolean;
  onSelect: () => void;
  /** Hide the "Keep this" button when the card is in the multi-store
   *  listings section — no canonical to pick, nothing destructive to do. */
  readOnly?: boolean;
}) {
  const isBlocked = (p.rashan_pack_names ?? []).length > 0;

  return (
    <div
      className={`relative rounded-lg border-2 overflow-hidden flex flex-col ${
        isCanonical
          ? 'border-brand bg-brand-mist/20'
          : isBlocked
            ? 'border-amber/50 bg-amber-mist/10'
            : 'border-border bg-card'
      }`}
    >
      {/* Canonical ribbon */}
      {isCanonical && (
        <div className="absolute top-0 right-0 bg-brand text-white text-[11px] font-bold font-display uppercase tracking-wide px-2 py-0.5 rounded-bl-lg">
          Canonical
        </div>
      )}

      {/* Image */}
      <div className="aspect-[4/3] bg-surface-cream flex items-center justify-center overflow-hidden">
        {p.primary_image_url ? (
          <img
            src={resolveImageUrl(p.primary_image_url, 'thumb') ?? ''}
            alt={p.name_es}
            className="w-full h-full object-cover"
          />
        ) : (
          <ImageIcon size={32} strokeWidth={1.25} className="text-muted" />
        )}
      </div>

      {/* Body */}
      <div className="p-3 flex-1 flex flex-col gap-2">
        {/* Name — highlight if it DIFFERS from the group */}
        <p
          className={`text-sm font-semibold font-display leading-tight ${
            nameSame ? 'text-ink' : 'text-danger'
          }`}
          title={nameSame ? undefined : 'Name differs from the other rows in this group'}
        >
          {p.name_es}
        </p>
        <p className="text-[11px] text-muted font-body -mt-1">{p.name_en}</p>

        {/* Store — always visible */}
        <div className="inline-flex items-center gap-1 text-[11px] text-ink font-body">
          <StoreIcon size={11} strokeWidth={1.75} className="text-muted" />
          <span className="font-semibold">{p.store?.name ?? 'Cesto (default)'}</span>
        </div>

        {/* Brand — highlight if it DIFFERS */}
        {p.brand && (
          <div className={`inline-flex items-center gap-1 text-[11px] font-body ${
            brandSame ? 'text-muted' : 'text-danger'
          }`}
          title={brandSame ? undefined : 'Brand differs from the other rows in this group'}
          >
            <Package size={11} strokeWidth={1.75} />
            {p.brand}
          </div>
        )}

        {/* Variants — the meat of the comparison */}
        <div className="mt-1 border-t border-border/60 pt-2">
          <div className="text-[11px] uppercase tracking-wide text-muted font-display font-semibold mb-1">
            Variants ({p.variants?.length ?? p.variant_count})
          </div>
          {(p.variants ?? []).length === 0 ? (
            <div className="text-[11px] text-muted italic">No variants</div>
          ) : (
            <div className="space-y-1">
              {(p.variants ?? []).map((v) => <VariantRow key={v.id} v={v} />)}
            </div>
          )}
        </div>

        {/* Signals row */}
        <div className="mt-auto pt-2 border-t border-border/60 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted font-body">
          <span className="inline-flex items-center gap-0.5" title="Order items referencing this product">
            <ShoppingCart size={10} strokeWidth={2} />{p.order_item_count}
          </span>
          <span className="inline-flex items-center gap-0.5" title="Variant count">
            <Boxes size={10} strokeWidth={2} />{p.variant_count}
          </span>
          <span className="inline-flex items-center gap-0.5" title="Image count">
            <ImageIcon size={10} strokeWidth={2} />{p.image_count}
          </span>
          <span title={`Created ${new Date(p.created_at).toLocaleDateString()}`}>
            {fmtDate(p.created_at)}
          </span>
          {!p.is_active && (
            <span className="ml-auto inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wide bg-surface-linen text-muted">
              Inactive
            </span>
          )}
        </div>

        {isBlocked && (
          <div className="mt-1 text-[11px] font-body text-amber-deep bg-amber-mist/40 border border-amber/30 rounded px-2 py-1">
            <PackageOpen size={10} strokeWidth={2} className="inline-block mr-1 -mt-0.5" />
            In rashan pack{(p.rashan_pack_names ?? []).length === 1 ? '' : 's'}: {(p.rashan_pack_names ?? []).join(', ')}
          </div>
        )}

        {/* Actions per card — "Keep this" hidden in read-only mode
            (multi-store listings). Edit link still available so admin
            can open any of the store copies from the inventory view. */}
        <div className="flex items-center gap-1.5 mt-2">
          {!readOnly && (
            <button
              type="button"
              onClick={onSelect}
              className={`flex-1 h-8 rounded-lg text-[11px] font-semibold font-display transition ${
                isCanonical
                  ? 'bg-brand text-white'
                  : 'bg-card border border-border hover:border-brand hover:text-brand text-ink'
              }`}
            >
              {isCanonical ? '✓ Selected' : 'Keep this'}
            </button>
          )}
          <Link
            to={`/products/${p.id}/edit`}
            target="_blank"
            title="Open product in a new tab"
            className={`${readOnly ? 'flex-1 h-8 inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold font-display' : 'w-8 h-8 inline-flex items-center justify-center'} rounded-lg bg-card border border-border hover:bg-surface-cream transition`}
          >
            <Package size={13} strokeWidth={1.75} className="text-ink" />
            {readOnly && <span className="text-ink">Open</span>}
          </Link>
        </div>
      </div>
    </div>
  );
}

function VariantRow({ v }: { v: DuplicateVariantSnapshot }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] font-body px-1.5 py-1 rounded bg-surface-cream/60">
      <div className="min-w-0 flex-1">
        <span className="font-semibold text-ink truncate">{v.name_es}</span>
        {v.is_default && (
          <span className="ml-1 text-[11px] font-bold text-brand uppercase tracking-wide">default</span>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2 text-ink">
        <span className="font-mono">€{v.price}</span>
        {v.b2b_price != null && (
          <span className="font-mono text-[11px] text-brand font-semibold" title="B2B / wholesale price">
            €{v.b2b_price}
          </span>
        )}
        <span
          className={`font-mono text-[11px] ${v.stock_quantity === 0 ? 'text-danger' : 'text-muted'}`}
          title={`Stock: ${v.stock_quantity}`}
        >
          ×{v.stock_quantity}
        </span>
      </div>
    </div>
  );
}

// ─── Result banners ─────────────────────────────────────

function ResolveResultBanner({ result, onDismiss }: { result: ResolveDuplicatesResult; onDismiss: () => void }) {
  const hasIssues = result.skipped.length > 0 || result.failed.length > 0;
  return (
    <div className={`border rounded-xl p-4 mb-6 ${hasIssues ? 'bg-amber-mist/40 border-amber/40' : 'bg-success-bg border-success/30'}`}>
      <div className="flex items-start gap-3">
        {hasIssues
          ? <AlertTriangle size={18} strokeWidth={1.75} className="text-amber-deep shrink-0 mt-0.5" />
          : <CheckCircle2  size={18} strokeWidth={1.75} className="text-success shrink-0 mt-0.5" />}
        <div className="flex-1 text-sm">
          <p className={`font-semibold mb-1 ${hasIssues ? 'text-amber-deep' : 'text-success'}`}>
            {hasIssues ? 'Delete-others done — with issues' : 'Delete-others done.'}
          </p>
          <p className="text-ink">
            <span className="inline-flex items-center gap-1 mr-3"><Archive size={12} strokeWidth={2} className="text-amber" />
              <span className="font-semibold">{result.deactivated}</span> deactivated
            </span>
            <span className="inline-flex items-center gap-1 mr-3"><Trash2 size={12} strokeWidth={2} className="text-danger" />
              <span className="font-semibold">{result.deleted}</span> deleted
            </span>
          </p>
          {result.skipped.length > 0 && <SkippedList list={result.skipped} />}
          {result.failed.length  > 0 && <FailedList  list={result.failed} />}
        </div>
        <button type="button" onClick={onDismiss} className="text-muted hover:text-ink transition-colors" aria-label="Dismiss">
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

function MergeResultBanner({ result, onDismiss }: { result: MergeDuplicatesResult; onDismiss: () => void }) {
  const hasIssues = result.skipped.length > 0 || result.failed.length > 0;
  return (
    <div className={`border rounded-xl p-4 mb-6 ${hasIssues ? 'bg-amber-mist/40 border-amber/40' : 'bg-success-bg border-success/30'}`}>
      <div className="flex items-start gap-3">
        {hasIssues
          ? <AlertTriangle size={18} strokeWidth={1.75} className="text-amber-deep shrink-0 mt-0.5" />
          : <GitMerge      size={18} strokeWidth={1.75} className="text-success shrink-0 mt-0.5" />}
        <div className="flex-1 text-sm">
          <p className={`font-semibold mb-1 ${hasIssues ? 'text-amber-deep' : 'text-success'}`}>
            {hasIssues ? 'Merge done — with issues' : 'Merge done.'}
          </p>
          <p className="text-ink">
            <span className="inline-flex items-center gap-1 mr-3"><Boxes    size={12} strokeWidth={2} className="text-brand" />
              <span className="font-semibold">{result.merged_variants}</span> variants moved
            </span>
            <span className="inline-flex items-center gap-1 mr-3"><ImageIcon size={12} strokeWidth={2} className="text-brand" />
              <span className="font-semibold">{result.merged_images}</span> images moved
            </span>
            <span className="inline-flex items-center gap-1"><Trash2 size={12} strokeWidth={2} className="text-danger" />
              <span className="font-semibold">{result.deleted}</span> shell products deleted
            </span>
          </p>
          {result.skipped.length > 0 && <SkippedList list={result.skipped} />}
          {result.failed.length  > 0 && <FailedList  list={result.failed} />}
        </div>
        <button type="button" onClick={onDismiss} className="text-muted hover:text-ink transition-colors" aria-label="Dismiss">
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

function SkippedList({ list }: { list: Array<{ id: string; reason: string }> }) {
  return (
    <details className="mt-2">
      <summary className="text-xs text-amber-deep cursor-pointer font-semibold">{list.length} skipped</summary>
      <ul className="mt-1.5 space-y-1 text-xs text-amber-deep font-body">
        {list.map((s) => (
          <li key={s.id} className="flex items-start gap-2">
            <PackageOpen size={11} strokeWidth={2} className="shrink-0 mt-0.5" />
            <span><span className="font-mono">{s.id.slice(0, 8)}…</span> — {s.reason}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function FailedList({ list }: { list: Array<{ id: string; error: string }> }) {
  return (
    <details className="mt-2">
      <summary className="text-xs text-danger cursor-pointer font-semibold">{list.length} failed</summary>
      <ul className="mt-1.5 space-y-1 text-xs text-danger font-body">
        {list.map((f) => (
          <li key={f.id} className="flex items-start gap-2">
            <XCircle size={11} strokeWidth={2} className="shrink-0 mt-0.5" />
            <span><span className="font-mono">{f.id.slice(0, 8)}…</span> — {f.error}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
