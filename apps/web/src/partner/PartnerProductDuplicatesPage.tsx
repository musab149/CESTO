import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Copy, AlertTriangle, CheckCircle2, Package, Archive, Trash2,
  ShoppingCart, Image as ImageIcon, Boxes, RefreshCcw, XCircle, PackageOpen,
  Store as StoreIcon, Info, GitMerge, EyeOff, X, Undo2, FileSpreadsheet, Plus,
} from 'lucide-react';
import {
  usePartnerProductDuplicates,
  useResolvePartnerDuplicates,
  useMergePartnerDuplicates,
  resolveImageUrl,
  type PartnerProductDuplicateEntry,
  type PartnerProductDuplicateGroup,
  type PartnerDuplicateMatchReason,
  type PartnerResolveDuplicatesResult,
  type PartnerMergeDuplicatesResult,
  type PartnerDuplicateVariantSnapshot,
  usePartnerImportDuplicates,
  useCreateFromPartnerImportDuplicate,
  useDismissPartnerImportDuplicate,
  useDismissAllPartnerImportDuplicates,
  type PartnerProductImportDuplicate,
} from '@grocery-app/shared';

/**
 * Partner-scoped duplicate management page. Structural mirror of admin's
 * ProductDuplicatesPage.tsx but hits /api/partner/products/duplicates — the
 * server side already scopes results to `store_id = req.partnerRole.store.id`,
 * so is_cross_store is always false in this UI. Rashan-pack blocking is
 * dropped because rashan is Cesto-only.
 *
 * Local-storage dismissed keys are namespaced under `partner.` so a partner
 * signing in on the same browser as an admin doesn't inherit admin's
 * dismissals (which are for a totally different catalogue).
 */

type TabView = 'duplicates' | 'import';

const REASON_LABEL: Record<PartnerDuplicateMatchReason, string> = {
  same_name: 'Same name',
  same_brand_variant: 'Same brand + size',
  same_image: 'Same image',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

/** Best-guess canonical for a group: prefer rows with order history (deleting
 *  them rewrites customers' past), then active rows, then rows with more
 *  variants+images, then oldest. Same heuristic as admin's version. */
function pickCanonical(products: PartnerProductDuplicateEntry[]): string {
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

// Dismissals persist in localStorage so a partner doesn't have to keep
// dismissing the same false-positive groups on every rescan. Namespaced
// so it doesn't collide with the admin key if both accounts sign in on
// the same browser.
const DISMISSED_KEY = 'partner.duplicates.dismissed_group_keys';
function loadDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set(); }
}
function saveDismissed(s: Set<string>) {
  try { window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...s])); } catch { /* quota / private mode */ }
}

export default function PartnerProductDuplicatesPage() {
  const navigate = useNavigate();
  const { data, isLoading, isRefetching, refetch } = usePartnerProductDuplicates();

  const [searchParams, setSearchParams] = useSearchParams();
  const { data: importData, isLoading: importLoading } = usePartnerImportDuplicates('pending');
  const importRows = importData?.items ?? [];
  const createFromImport = useCreateFromPartnerImportDuplicate();
  const dismissImport = useDismissPartnerImportDuplicate();
  const dismissAllImport = useDismissAllPartnerImportDuplicates();
  const [importError, setImportError] = useState<string | null>(null);
  const resolveMutation = useResolvePartnerDuplicates();
  const mergeMutation   = useMergePartnerDuplicates();
  const [lastResolveResult, setLastResolveResult] = useState<PartnerResolveDuplicatesResult | null>(null);
  const [lastMergeResult,   setLastMergeResult]   = useState<PartnerMergeDuplicatesResult   | null>(null);

  const [keepOverrides, setKeepOverrides] = useState<Record<string, string>>({});

  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());
  useEffect(() => { saveDismissed(dismissed); }, [dismissed]);

  const allGroups = data?.groups ?? [];
  const groups          = useMemo(() => allGroups.filter((g) =>  !dismissed.has(g.key)), [allGroups, dismissed]);
  const dismissedGroups = useMemo(() => allGroups.filter((g) =>   dismissed.has(g.key)), [allGroups, dismissed]);

  const isPending      = resolveMutation.isPending || mergeMutation.isPending;
  const isBusyGroupKey = resolveMutation.isPending || mergeMutation.isPending;

  function keepIdFor(g: PartnerProductDuplicateGroup): string {
    if (keepOverrides[g.key]) return keepOverrides[g.key];
    return g.is_cross_store ? '' : pickCanonical(g.products);
  }

  async function runResolve(group: PartnerProductDuplicateGroup) {
    const keep = keepIdFor(group);
    if (!keep) return;
    const removeIds = group.products.map((p) => p.id).filter((id) => id !== keep);
    if (removeIds.length === 0) return;
    try {
      const res = await resolveMutation.mutateAsync({ groups: [{ keep_id: keep, remove_ids: removeIds }] });
      setLastResolveResult(res);
      setLastMergeResult(null);
    } catch { /* error surfaces below */ }
  }

  async function runMerge(group: PartnerProductDuplicateGroup) {
    const keep = keepIdFor(group);
    if (!keep) return;
    const removeIds = group.products.map((p) => p.id).filter((id) => id !== keep);
    if (removeIds.length === 0) return;
    try {
      const res = await mergeMutation.mutateAsync({ groups: [{ keep_id: keep, remove_ids: removeIds }] });
      setLastMergeResult(res);
      setLastResolveResult(null);
    } catch { /* error surfaces below */ }
  }

  function dismiss(key: string) {
    setDismissed((prev) => { const next = new Set(prev); next.add(key); return next; });
  }
  function undismiss(key: string) {
    setDismissed((prev) => { const next = new Set(prev); next.delete(key); return next; });
  }

  // Two queues, two tabs. `?view=import` so a partner can be linked straight
  // to the import queue from the import report.
  const activeTab: TabView = searchParams.get('view') === 'import' ? 'import' : 'duplicates';
  const setTab = (next: TabView) => {
    const p = new URLSearchParams(searchParams);
    if (next === 'duplicates') p.delete('view');
    else p.set('view', next);
    setSearchParams(p, { replace: true });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center gap-4 mb-6">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => navigate('/partner/products')}
            className="w-10 h-10 rounded-lg bg-surface-cream hover:bg-brand-mist flex items-center justify-center transition shrink-0"
            aria-label="Back to Products"
            title="Back to Products"
          >
            <ArrowLeft className="w-5 h-5 text-ink" strokeWidth={1.75} />
          </button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold font-display text-ink inline-flex items-center gap-2">
              <Copy size={22} strokeWidth={1.75} />
              Duplicate products
            </h1>
            <p className="text-sm text-muted font-body mt-1">
              Side-by-side comparison of products in your store that share the same identity — name, brand, origin, category, subcategory and type. Pack sizes, prices and images are ignored, so "Arroz 1kg" and "Arroz 5kg" count as one product with two sizes. Decide per group: keep one, merge variants, or dismiss.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isLoading || isRefetching}
            className="inline-flex items-center gap-2 h-11 px-4 rounded-xl bg-surface-cream hover:bg-brand-mist text-ink font-semibold text-sm transition disabled:opacity-50"
          >
            <RefreshCcw size={16} strokeWidth={1.75} className={isRefetching ? 'animate-spin' : ''} />
            Rescan
          </button>
        </div>
      </div>

      {/* Tabs — two different queues. "In your catalogue" finds products that
          already exist twice; "From Excel import" holds spreadsheet rows that
          were never created because they matched something. */}
      <div className="flex items-center gap-1 border-b border-border mb-6 overflow-x-auto hide-scrollbar">
        {([
          { key: 'duplicates' as const, label: 'In your catalogue', count: groups.length },
          { key: 'import' as const,     label: 'From Excel import', count: importRows.length },
        ]).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setTab(tab.key)}
            className={`relative shrink-0 px-4 py-2.5 text-sm font-semibold font-display transition-colors ${
              activeTab === tab.key
                ? 'text-brand border-b-2 border-brand -mb-px'
                : 'text-muted hover:text-ink'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold tabular-nums ${
                activeTab === tab.key ? 'bg-brand text-white' : 'bg-surface-cream text-muted'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'import' ? (
        <ImportDuplicatesSection
          rows={importRows}
          isLoading={importLoading}
          error={importError}
          onClearError={() => setImportError(null)}
          creatingId={createFromImport.isPending ? createFromImport.variables ?? null : null}
          dismissingId={dismissImport.isPending ? dismissImport.variables ?? null : null}
          isDismissingAll={dismissAllImport.isPending}
          onCreate={(id) => {
            setImportError(null);
            createFromImport.mutate(id, {
              onError: (e) => setImportError(e instanceof Error ? e.message : 'Create failed.'),
            });
          }}
          onDismiss={(id) => {
            setImportError(null);
            dismissImport.mutate(id, {
              onError: (e) => setImportError(e instanceof Error ? e.message : 'Dismiss failed.'),
            });
          }}
          onDismissAll={() => {
            setImportError(null);
            dismissAllImport.mutate(undefined, {
              onError: (e) => setImportError(e instanceof Error ? e.message : 'Dismiss failed.'),
            });
          }}
        />
      ) : (
      <>
      {/* Actions legend */}
      <div className="bg-info-bg border border-info/30 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <Info size={18} strokeWidth={1.75} className="text-info shrink-0 mt-0.5" />
          <div className="text-sm text-ink font-body">
            <p className="font-semibold text-info mb-1">Three ways to handle a group</p>
            <ul className="space-y-0.5 text-gray text-[13px]">
              <li>
                <strong>Delete others</strong> — same product, same data. Keep one; the rest deactivate (if they have order history) or hard-delete (if not).
              </li>
              <li>
                <strong>Merge variants</strong> — same product but split across rows with different sizes/prices. Moves every variant + image onto the canonical, then deletes the empty shells. Order history is preserved.
              </li>
              <li>
                <strong>Not a duplicate</strong> — dismissal (stored in your browser). Handy for two products that share a name but are actually distinct.
              </li>
            </ul>
          </div>
        </div>
      </div>

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

      {(resolveMutation.isError || mergeMutation.isError) && (
        <div className="bg-danger-bg border border-danger/30 rounded-lg p-3 mb-4 text-sm text-danger font-body">
          {(resolveMutation.error ?? mergeMutation.error) instanceof Error
            ? ((resolveMutation.error ?? mergeMutation.error) as Error).message
            : 'Something failed. Try again.'}
        </div>
      )}

      {!isLoading && groups.length === 0 && dismissedGroups.length === 0 && (
        <div className="bg-white rounded-xl border border-border p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-success-bg mx-auto mb-4 flex items-center justify-center">
            <CheckCircle2 size={32} strokeWidth={1.5} className="text-success" />
          </div>
          <p className="text-lg font-bold font-display text-ink mb-1">No duplicate products found</p>
          <p className="text-sm text-muted font-body">No two products in your store share the same identity.</p>
        </div>
      )}

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
              <div className="bg-white shadow-modal rounded-xl px-4 py-2 text-sm font-semibold font-display text-ink pointer-events-auto">
                Working…
              </div>
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}

// ─── Import queue ──────────────────────────────────────────
// Rows the importer flagged rather than created. Each card puts the incoming
// spreadsheet row beside the product it matched, so the decision is made by
// looking at both rather than by trusting the importer's verdict.

function ImportDuplicatesSection({
  rows, isLoading, error, onClearError,
  creatingId, dismissingId, isDismissingAll,
  onCreate, onDismiss, onDismissAll,
}: {
  rows: PartnerProductImportDuplicate[];
  isLoading: boolean;
  error: string | null;
  onClearError: () => void;
  creatingId: string | null;
  dismissingId: string | null;
  isDismissingAll: boolean;
  onCreate: (id: string) => void;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-muted font-body">Loading import queue…</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border p-12 text-center">
        <div className="w-16 h-16 rounded-full bg-success-bg mx-auto mb-4 flex items-center justify-center">
          <CheckCircle2 size={32} strokeWidth={1.5} className="text-success" />
        </div>
        <p className="text-lg font-bold font-display text-ink mb-1">Nothing waiting from an import</p>
        <p className="text-sm text-muted font-body">
          When a spreadsheet row matches a product you already have, it waits here instead of being skipped.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="bg-info-bg border border-info/30 rounded-xl p-4 mb-4">
        <div className="flex items-start gap-3">
          <Info size={18} strokeWidth={1.75} className="text-info shrink-0 mt-0.5" />
          <div className="text-sm text-ink font-body">
            <p className="font-semibold text-info mb-1">Rows your import did not create</p>
            <p className="text-gray text-[13px]">
              Each row below matched a product already in your store, so it was held back rather than added.
              <strong> Create anyway</strong> adds it as a separate product; <strong>Dismiss</strong> drops the
              row and keeps it out of future lists.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-danger-bg border border-danger/30 rounded-lg p-3 mb-4 text-sm text-danger font-body flex items-start justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={onClearError} aria-label="Dismiss error" className="shrink-0">
            <X size={15} strokeWidth={2} />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted font-body">
          <strong>{rows.length}</strong> row{rows.length === 1 ? '' : 's'} waiting
        </p>
        <button
          type="button"
          onClick={onDismissAll}
          disabled={isDismissingAll}
          className="text-xs font-semibold text-muted hover:text-ink inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          <EyeOff size={12} strokeWidth={2} />
          Dismiss all
        </button>
      </div>

      <div className="space-y-4">
        {rows.map((row) => (
          <ImportDuplicateCard
            key={row.id}
            row={row}
            isCreating={creatingId === row.id}
            isDismissing={dismissingId === row.id}
            onCreate={() => onCreate(row.id)}
            onDismiss={() => onDismiss(row.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ImportDuplicateCard({
  row, isCreating, isDismissing, onCreate, onDismiss,
}: {
  row: PartnerProductImportDuplicate;
  isCreating: boolean;
  isDismissing: boolean;
  onCreate: () => void;
  onDismiss: () => void;
}) {
  const p = row.payload;
  const busy = isCreating || isDismissing;
  const matched = row.matched_product;
  const defaultVariant = p.variants.find((v) => v.is_default) ?? p.variants[0] ?? null;

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 bg-surface-cream border-b border-border text-xs text-muted font-body">
        <FileSpreadsheet size={13} strokeWidth={2} className="inline-block mr-1.5 -mt-0.5" />
        <span className="font-mono">{row.job?.filename ?? 'Import'}</span>
        <span className="mx-1.5" aria-hidden>·</span>
        row {row.source_row_number}
        {row.job?.created_at && (
          <>
            <span className="mx-1.5" aria-hidden>·</span>
            {fmtDate(row.job.created_at)}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
        {/* Incoming spreadsheet row */}
        <div className="bg-white p-4">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-info mb-2">From your spreadsheet</p>
          <p className="text-sm font-semibold text-ink font-display">{p.name_es}</p>
          <p className="text-xs text-muted mt-0.5">{p.name_en}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[12px] text-gray">
            {p.brand && <span>{p.brand}</span>}
            {p.origin && <span>{p.origin}</span>}
            <span>
              <Boxes size={11} strokeWidth={2} className="inline-block mr-1 -mt-0.5" />
              {p.variants.length} variant{p.variants.length === 1 ? '' : 's'}
            </span>
            {p.image_urls.length > 0 && (
              <span>
                <ImageIcon size={11} strokeWidth={2} className="inline-block mr-1 -mt-0.5" />
                {p.image_urls.length}
              </span>
            )}
          </div>
          {defaultVariant && (
            <p className="text-[13px] text-ink mt-2">
              {defaultVariant.name_es} — <strong>{defaultVariant.price.toFixed(2)} €</strong>
              {/* The sheet's b2b_price column reached the database but never
                  this screen, so a partner reviewing a flagged row could not
                  see whether their wholesale price had come through, nor
                  compare it against the product already in the store. */}
              {defaultVariant.b2b_price != null && (
                <span className="text-brand font-semibold"> · B2B {defaultVariant.b2b_price.toFixed(2)} €</span>
              )}
              <span className="text-muted"> · stock {defaultVariant.stock_quantity}</span>
            </p>
          )}
        </div>

        {/* What it matched */}
        <div className="bg-white p-4">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-muted mb-2">Already in your store</p>
          {matched ? (
            <div className="flex gap-3">
              {matched.images[0]?.url ? (
                <img
                  src={resolveImageUrl(matched.images[0].url, 'thumb') ?? ''}
                  alt=""
                  className="w-12 h-12 rounded-lg object-cover bg-surface-linen shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-surface-cream grid place-items-center shrink-0">
                  <Package size={18} strokeWidth={1.75} className="text-muted" />
                </div>
              )}
              <div className="min-w-0">
                <Link
                  to={`/partner/products/${matched.id}/edit`}
                  className="text-sm font-semibold text-ink font-display hover:text-brand"
                >
                  {matched.name_es}
                </Link>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[12px] text-gray">
                  {matched.brand && <span>{matched.brand}</span>}
                  <span>
                    <Boxes size={11} strokeWidth={2} className="inline-block mr-1 -mt-0.5" />
                    {matched._count.variants}
                  </span>
                  {!matched.is_active && <span className="text-muted italic">inactive</span>}
                </div>
              </div>
            </div>
          ) : (
            /* matched_product_id went SET NULL — the product was deleted after
               this row was queued. Only the snapshot name survives, and
               creating is now clearly the right call. */
            <div className="flex items-start gap-2 rounded-lg bg-amber-mist/50 border border-amber-deep/30 p-2.5">
              <AlertTriangle size={15} strokeWidth={1.75} className="text-amber-deep shrink-0 mt-0.5" />
              <p className="text-[12.5px] text-ink font-body">
                &ldquo;{row.matched_product_name}&rdquo; has since been deleted, so there is nothing to duplicate any more.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-border">
        <button
          type="button"
          onClick={onDismiss}
          disabled={busy}
          className="inline-flex items-center gap-1.5 h-10 px-3.5 rounded-lg text-sm font-semibold text-muted hover:text-ink hover:bg-surface-cream transition disabled:opacity-50"
        >
          <EyeOff size={15} strokeWidth={1.75} />
          {isDismissing ? 'Dismissing…' : 'Dismiss'}
        </button>
        <button
          type="button"
          onClick={onCreate}
          disabled={busy}
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-mid transition disabled:opacity-50"
        >
          <Plus size={15} strokeWidth={2} />
          {isCreating ? 'Creating…' : 'Create anyway'}
        </button>
      </div>
    </div>
  );
}


function GroupCard({
  group, keepId, isPending, onKeepChange, onResolve, onMerge, onDismiss,
}: {
  group: PartnerProductDuplicateGroup;
  keepId: string;
  isPending: boolean;
  onKeepChange: (pid: string) => void;
  onResolve: () => void;
  onMerge: () => void;
  onDismiss: () => void;
}) {
  const distinctStoreNames = Array.from(
    new Set(group.products.map((p) => p.store?.name ?? 'Your store')),
  );
  const isCrossStore = group.is_cross_store;
  const nothingPicked = !keepId;

  const nameEsSame = new Set(group.products.map((p) => p.name_es.trim().toLowerCase())).size === 1;
  const brandSame  = new Set(group.products.map((p) => (p.brand ?? '').trim().toLowerCase())).size === 1;

  return (
    <div className={`bg-white border rounded-xl overflow-hidden ${isCrossStore ? 'border-info/50' : 'border-border'}`}>
      <div className={`px-4 py-3 border-b flex items-start justify-between gap-3 flex-wrap ${
        isCrossStore ? 'bg-info-bg/40 border-info/30' : 'bg-surface-cream border-border'
      }`}>
        <div className="min-w-0">
          <p className={`text-xs uppercase tracking-wide font-semibold ${
            isCrossStore ? 'text-info' : 'text-muted'
          }`}>
            {isCrossStore ? `Multi-store listing (${distinctStoreNames.length} stores)` : `Duplicate group · ${group.products.length} products`}
          </p>
          <p className="text-sm font-mono text-ink mt-0.5 break-all">"{group.label}"</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {group.match_reasons?.map((r) => (
              <span
                key={r}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-info-bg text-info"
              >
                {REASON_LABEL[r]}
              </span>
            ))}
          </div>
        </div>
      </div>

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
              />
            </div>
          ))}
        </div>
      </div>

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
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white border border-border hover:border-info hover:text-info text-ink font-semibold text-xs transition disabled:opacity-50"
          >
            <EyeOff size={13} strokeWidth={2} />
            Not a duplicate
          </button>
          <button
            type="button"
            onClick={onMerge}
            disabled={isPending || nothingPicked}
            title={nothingPicked ? 'Pick a canonical first.' : 'Move all variants + images into the canonical, then delete the others.'}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-brand hover:bg-brand-mid text-white font-semibold text-xs transition disabled:opacity-50"
          >
            <GitMerge size={13} strokeWidth={2} />
            Merge variants into canonical
          </button>
          <button
            type="button"
            onClick={onResolve}
            disabled={isPending || nothingPicked}
            title={nothingPicked ? 'Pick a canonical first.' : 'Delete or deactivate the non-canonical rows.'}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-danger hover:bg-danger/90 text-white font-semibold text-xs transition disabled:opacity-50"
          >
            <Trash2 size={13} strokeWidth={2} />
            Delete others
          </button>
        </div>
      </div>
    </div>
  );
}

function ProductComparisonCard({
  product: p, isCanonical, nameSame, brandSame, onSelect,
}: {
  product: PartnerProductDuplicateEntry;
  isCanonical: boolean;
  nameSame: boolean;
  brandSame: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`relative rounded-lg border-2 overflow-hidden flex flex-col ${
        isCanonical ? 'border-brand bg-brand-mist/20' : 'border-border bg-white'
      }`}
    >
      {isCanonical && (
        <div className="absolute top-0 right-0 bg-brand text-white text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-bl-lg">
          Canonical
        </div>
      )}

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

      <div className="p-3 flex-1 flex flex-col gap-2">
        <p
          className={`text-sm font-semibold leading-tight ${nameSame ? 'text-ink' : 'text-danger'}`}
          title={nameSame ? undefined : 'Name differs from the other rows in this group'}
        >
          {p.name_es}
        </p>
        <p className="text-[11px] text-muted font-body -mt-1">{p.name_en}</p>

        <div className="inline-flex items-center gap-1 text-[11px] text-ink font-body">
          <StoreIcon size={11} strokeWidth={1.75} className="text-muted" />
          <span className="font-semibold">{p.store?.name ?? 'Your store'}</span>
        </div>

        {p.brand && (
          <div
            className={`inline-flex items-center gap-1 text-[11px] font-body ${brandSame ? 'text-muted' : 'text-danger'}`}
            title={brandSame ? undefined : 'Brand differs from the other rows in this group'}
          >
            <Package size={11} strokeWidth={1.75} />
            {p.brand}
          </div>
        )}

        <div className="mt-1 border-t border-border/60 pt-2">
          <div className="text-[10px] uppercase tracking-wide text-muted font-semibold mb-1">
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

        <div className="mt-auto pt-2 border-t border-border/60 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted font-body">
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
            <span className="ml-auto inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-surface-linen text-muted">
              Inactive
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 mt-2">
          <button
            type="button"
            onClick={onSelect}
            className={`flex-1 h-8 rounded-lg text-[11px] font-semibold transition ${
              isCanonical
                ? 'bg-brand text-white'
                : 'bg-white border border-border hover:border-brand hover:text-brand text-ink'
            }`}
          >
            {isCanonical ? '✓ Selected' : 'Keep this'}
          </button>
          <Link
            to={`/partner/products/${p.id}/edit`}
            target="_blank"
            title="Open product in a new tab"
            className="w-8 h-8 rounded-lg bg-white border border-border hover:bg-surface-cream inline-flex items-center justify-center transition"
          >
            <Package size={13} strokeWidth={1.75} className="text-ink" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function VariantRow({ v }: { v: PartnerDuplicateVariantSnapshot }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] font-body px-1.5 py-1 rounded bg-surface-cream/60">
      <div className="min-w-0 flex-1">
        <span className="font-semibold text-ink truncate">{v.name_es}</span>
        {v.is_default && (
          <span className="ml-1 text-[9px] font-semibold text-brand uppercase tracking-wide">default</span>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-2 text-ink">
        <span className="font-mono">€{v.price}</span>
        {/* Wholesale sits beside retail rather than replacing it — the whole
            point of this row is comparing the two products, and a variant
            can differ on b2b_price while matching on price. */}
        {v.b2b_price != null && (
          <span className="font-mono text-[10px] text-brand font-semibold" title="B2B / wholesale price">
            €{v.b2b_price}
          </span>
        )}
        <span
          className={`font-mono text-[10px] ${v.stock_quantity === 0 ? 'text-danger' : 'text-muted'}`}
          title={`Stock: ${v.stock_quantity}`}
        >
          ×{v.stock_quantity}
        </span>
      </div>
    </div>
  );
}

function ResolveResultBanner({ result, onDismiss }: { result: PartnerResolveDuplicatesResult; onDismiss: () => void }) {
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

function MergeResultBanner({ result, onDismiss }: { result: PartnerMergeDuplicatesResult; onDismiss: () => void }) {
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
