import { useMemo, useState } from 'react';
import { Plus, Search, Award, ArrowUp, ArrowDown, Trash2, Edit2, Eye, EyeOff, X, Save, Sparkles } from 'lucide-react';
import {
  useAdminBrandsTable, useCreateBrand, useUpdateBrand, useDeleteBrand, useReorderBrands,
  type Brand, type BrandWritePayload, resolveImageUrl,
} from '@grocery-app/shared';
import { useToast } from '@/components/Toast';
import ImageUploadField from '@/components/home-preview/ImageUploadField';
import { TableSkeleton } from '@/components/Skeleton';

// Curated Top Brands were promoted from a `home_sections` JSON blob to their
// own table on 2026-07-13 (migration `20260713140000_add_brands_and_origins`).
// This page is the primary admin surface for that table — the old Top Brands
// tab on Home Sections is scheduled for removal.

type FilterMode = 'all' | 'active' | 'inactive' | 'suggestions';

/** Row is an unreviewed Excel-importer auto-create. Drives the badge + filter. */
const isSuggestion = (b: { source: string; is_active: boolean }) =>
  b.source === 'import' && !b.is_active;

export default function BrandsPage() {
  const { data: brands = [], isLoading } = useAdminBrandsTable();
  const reorder = useReorderBrands();
  const deleteBrand = useDeleteBrand();
  const toast = useToast();

  const [q, setQ] = useState('');
  const [mode, setMode] = useState<FilterMode>('all');
  const [editing, setEditing] = useState<Brand | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const suggestionCount = useMemo(() => brands.filter(isSuggestion).length, [brands]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return brands
      .filter((b) => {
        if (mode === 'all') return true;
        if (mode === 'active') return b.is_active;
        if (mode === 'inactive') return !b.is_active;
        return isSuggestion(b);
      })
      .filter((b) => (needle ? b.name.toLowerCase().includes(needle) || b.slug.toLowerCase().includes(needle) : true));
  }, [brands, q, mode]);

  async function move(index: number, dir: -1 | 1) {
    // Reorder within the FULL brands list, not the filtered view — swapping
    // relative positions in a filtered list would leave the underlying
    // sort_order stale for hidden rows.
    const flat = [...brands].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    const brand = filtered[index];
    const flatIdx = flat.findIndex((b) => b.id === brand.id);
    const swapIdx = flatIdx + dir;
    if (swapIdx < 0 || swapIdx >= flat.length) return;
    [flat[flatIdx], flat[swapIdx]] = [flat[swapIdx], flat[flatIdx]];
    try {
      await reorder.mutateAsync(flat.map((b) => b.id));
    } catch (err) {
      toast.error('Reorder failed', err instanceof Error ? err.message : 'Please try again.');
    }
  }

  async function confirmDelete() {
    if (!confirmDeleteId) return;
    try {
      const res = await deleteBrand.mutateAsync(confirmDeleteId);
      toast.success(
        'Brand deleted',
        res.product_count > 0
          ? `${res.product_count} product(s) had their brand cleared.`
          : 'No products were referencing this brand.',
      );
      setConfirmDeleteId(null);
    } catch (err) {
      toast.error('Delete failed', err instanceof Error ? err.message : 'Please try again.');
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold font-display text-ink">
            Brands
            {!isLoading && (
              <span className="text-base font-normal text-muted ml-2">({brands.length})</span>
            )}
          </h1>
          <p className="text-sm text-muted mt-1">
            Curated brand chips shown on the customer Top Brands rail. Products link here by <span className="font-mono text-[13px]">brand_id</span>; the Excel importer auto-adds new brands as <span className="italic">inactive</span> for you to review.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition shrink-0 w-full sm:w-auto"
        >
          <Plus className="w-5 h-5" strokeWidth={1.75} />
          New brand
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as FilterMode)}
          className="bg-surface-cream border border-border rounded-lg h-11 px-4 text-sm font-display text-ink min-w-[200px] focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="all">All brands</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
          <option value="suggestions">
            Suggestions from imports{suggestionCount > 0 ? ` (${suggestionCount})` : ''}
          </option>
        </select>
        {suggestionCount > 0 && mode !== 'suggestions' && (
          <button
            type="button"
            onClick={() => setMode('suggestions')}
            className="inline-flex items-center gap-2 h-11 px-4 rounded-lg bg-amber-mist/60 border border-amber text-amber-deep font-semibold font-display text-sm hover:bg-amber-mist transition-colors"
          >
            <Sparkles className="w-4 h-4" strokeWidth={1.75} />
            {suggestionCount} suggestion{suggestionCount === 1 ? '' : 's'} to review
          </button>
        )}

        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" strokeWidth={1.75} />
          <input
            type="text"
            placeholder="Search by name or slug…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full bg-surface-cream border border-border rounded-lg h-11 pl-10 pr-4 text-sm font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
      </div>

      {mode === 'suggestions' && !isLoading && (
        <div className="bg-amber-mist/40 border border-amber rounded-xl px-4 py-3 mb-4 flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-amber-deep flex-shrink-0 mt-0.5" strokeWidth={1.75} />
          <div className="flex-1 text-[13px] font-body text-amber-deep">
            <p className="font-semibold">
              These brands were auto-created from Excel imports and are waiting for review.
            </p>
            <p className="mt-0.5 text-amber-deep/80">
              Click <span className="font-semibold">Edit</span> to add a logo, background colour, and link, then toggle <span className="font-semibold">Active</span> to feature it on the customer Top Brands rail.
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : filtered.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-cream flex items-center justify-center mx-auto mb-4">
            <Award className="w-8 h-8 text-muted" strokeWidth={1.75} />
          </div>
          <h3 className="text-lg font-semibold font-display text-ink mb-1">
            {q || mode !== 'all' ? 'No brands match your filters' : 'No brands yet'}
          </h3>
          <p className="text-sm text-muted mb-4">
            {q || mode !== 'all'
              ? 'Try clearing the filters or search box.'
              : 'Add your first brand to start showing it on the customer Top Brands rail.'}
          </p>
          {!(q || mode !== 'all') && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-2 bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition"
            >
              <Plus className="w-4 h-4" strokeWidth={1.75} />
              New brand
            </button>
          )}
        </div>
      ) : (
        <>
        {/* ON A PHONE (2026-11-05): a card per row — the table needed 720px
            and put status and every action off to the right. Same handlers. */}
        <ul className="sm:hidden bg-card rounded-xl border border-border divide-y divide-border">
          {filtered.map((b, i) => (
            <li key={b.id} className="px-3 py-3">
              <div className="flex items-start gap-3">
                {b.logo_url ? (
                  <img
                    src={resolveImageUrl(b.logo_url, 'logo') ?? ''}
                    alt=""
                    className="w-11 h-11 rounded-lg object-contain border border-border shrink-0"
                    style={{ backgroundColor: b.logo_bg ?? '#FFFFFF' }}
                  />
                ) : (
                  <span className="w-11 h-11 rounded-lg bg-surface-cream border border-border flex items-center justify-center shrink-0">
                    <Award className="w-5 h-5 text-muted" strokeWidth={1.75} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold font-display text-ink text-sm">{b.name}</p>
                    {isSuggestion(b) && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold font-display bg-amber-mist text-amber-deep border border-amber/40">
                        <Sparkles className="w-3 h-3" strokeWidth={2} />
                        From import
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted font-mono mt-0.5 truncate">{b.slug}</p>
                  <p className="text-xs text-muted mt-0.5 tabular-nums">{b._count?.products ?? 0} products</p>
                </div>
                {b.is_active ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold font-display bg-success-bg text-success shrink-0">
                    <Eye className="w-3 h-3" strokeWidth={2} />
                    Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold font-display bg-surface-cream text-muted shrink-0">
                    <EyeOff className="w-3 h-3" strokeWidth={2} />
                    Inactive
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2.5 pl-[3.5rem]">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={reorder.isPending || i === 0}
                  className="w-9 h-9 rounded-lg bg-surface-cream flex items-center justify-center transition disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ArrowUp className="w-4 h-4 text-ink" strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={reorder.isPending || i === filtered.length - 1}
                  className="w-9 h-9 rounded-lg bg-surface-cream flex items-center justify-center transition disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ArrowDown className="w-4 h-4 text-ink" strokeWidth={1.75} />
                </button>
                <span className="flex-1" />
                {isSuggestion(b) ? (
                  <button
                    type="button"
                    onClick={() => setEditing(b)}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-brand text-white text-xs font-semibold font-display"
                  >
                    <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
                    Create brand
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditing(b)}
                    className="w-9 h-9 rounded-lg bg-surface-cream flex items-center justify-center transition"
                    aria-label="Edit"
                  >
                    <Edit2 className="w-4 h-4 text-ink" strokeWidth={1.75} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(b.id)}
                  className="w-9 h-9 rounded-lg bg-surface-cream flex items-center justify-center transition"
                  aria-label={isSuggestion(b) ? 'Dismiss suggestion' : 'Delete'}
                >
                  <Trash2 className="w-4 h-4 text-danger" strokeWidth={1.75} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="hidden sm:block bg-card rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-surface-cream border-b border-border">
              <tr>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display w-16">Order</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display w-20">Logo</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">Name</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">Products</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">Status</th>
                <th className="text-right text-xs font-semibold text-gray uppercase px-4 py-3 font-display">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b, i) => (
                <tr key={b.id} className="border-t border-border hover:bg-brand-mist/20 transition">
                  <td className="px-4 py-3">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={reorder.isPending || i === 0}
                        className="w-7 h-7 rounded-lg bg-surface-cream hover:bg-brand-mist flex items-center justify-center transition disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="Move up"
                      >
                        <ArrowUp className="w-3.5 h-3.5 text-ink" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={reorder.isPending || i === filtered.length - 1}
                        className="w-7 h-7 rounded-lg bg-surface-cream hover:bg-brand-mist flex items-center justify-center transition disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="Move down"
                      >
                        <ArrowDown className="w-3.5 h-3.5 text-ink" strokeWidth={1.75} />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {b.logo_url ? (
                      <img
                        src={resolveImageUrl(b.logo_url, 'logo') ?? ''}
                        alt={b.name}
                        className="w-10 h-10 rounded-lg object-contain border border-border"
                        style={{ backgroundColor: b.logo_bg ?? '#FFFFFF' }}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-surface-cream border border-border flex items-center justify-center">
                        <Award className="w-5 h-5 text-muted" strokeWidth={1.75} />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold font-display text-ink">{b.name}</p>
                      {isSuggestion(b) && (
                        <span
                          title="Auto-created by the Excel importer. Review and toggle active to feature it on the customer rail."
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold font-display bg-amber-mist text-amber-deep border border-amber/40"
                        >
                          <Sparkles className="w-3 h-3" strokeWidth={2} />
                          From import
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted font-mono mt-0.5">{b.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-ink">{b._count?.products ?? 0}</td>
                  <td className="px-4 py-3">
                    {b.is_active ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold font-display bg-success-bg text-success">
                        <Eye className="w-3 h-3" strokeWidth={2} />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold font-display bg-surface-cream text-muted">
                        <EyeOff className="w-3 h-3" strokeWidth={2} />
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      {isSuggestion(b) ? (
                        // Suggestion row → open the modal in "Create from
                        // suggestion" mode: name pre-filled, is_active
                        // defaulted to true, and the save button reads
                        // "Create brand" so it matches the admin's mental
                        // model of promoting a suggestion into a real brand.
                        <button
                          type="button"
                          onClick={() => setEditing(b)}
                          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-brand text-white text-xs font-semibold font-display hover:bg-brand-mid transition"
                        >
                          <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
                          Create brand
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditing(b)}
                          className="w-9 h-9 rounded-lg bg-surface-cream hover:bg-brand-mist flex items-center justify-center transition"
                          aria-label="Edit"
                        >
                          <Edit2 className="w-4 h-4 text-ink" strokeWidth={1.75} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(b.id)}
                        className="w-9 h-9 rounded-lg bg-surface-cream hover:bg-danger-bg flex items-center justify-center transition"
                        aria-label={isSuggestion(b) ? 'Dismiss suggestion' : 'Delete'}
                        title={isSuggestion(b) ? 'Dismiss this suggestion' : 'Delete'}
                      >
                        <Trash2 className="w-4 h-4 text-danger" strokeWidth={1.75} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {(creating || editing) && (
        <BrandFormModal
          brand={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}

      {confirmDeleteId && (
        <ConfirmDeleteModal
          brand={brands.find((b) => b.id === confirmDeleteId)!}
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={confirmDelete}
          isPending={deleteBrand.isPending}
        />
      )}
    </div>
  );
}

// ─── Create / Edit modal ────────────────────────────────

function BrandFormModal({ brand, onClose }: { brand: Brand | null; onClose: () => void }) {
  // `promoteMode` is true when the modal was opened by clicking a
  // suggestion — i.e., an inactive Excel-importer auto-create. The row
  // exists in the DB but the admin is treating it like a fresh creation:
  // the title, save button, and default is_active all shift to match a
  // "New brand" flow instead of an "Edit existing" flow.
  const promoteMode = !!brand && brand.source === 'import' && !brand.is_active;
  const isEdit = !!brand;
  const create = useCreateBrand();
  const update = useUpdateBrand();
  const toast = useToast();

  const [name, setName]         = useState(brand?.name ?? '');
  const [slug, setSlug]         = useState(brand?.slug ?? '');
  const [logoUrl, setLogoUrl]   = useState<string | null>(brand?.logo_url ?? null);
  const [logoBg, setLogoBg]     = useState(brand?.logo_bg ?? '#FFFFFF');
  const [link, setLink]         = useState(brand?.link ?? '');
  // In promoteMode, default is_active to true — the admin's intent is to
  // publish this brand now, not leave it inactive again.
  const [isActive, setIsActive] = useState(promoteMode ? true : (brand?.is_active ?? true));

  async function save() {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    const payload: BrandWritePayload = {
      name: name.trim(),
      slug: slug.trim() || undefined,
      logo_url: logoUrl,
      logo_bg: logoBg,
      link: link.trim() || null,
      is_active: isActive,
    };
    try {
      if (isEdit && brand) {
        await update.mutateAsync({ id: brand.id, payload });
        toast.success(promoteMode ? 'Brand created' : 'Brand updated');
      } else {
        await create.mutateAsync(payload);
        toast.success('Brand created');
      }
      onClose();
    } catch (err) {
      toast.error(
        promoteMode ? 'Create failed' : (isEdit ? 'Update failed' : 'Create failed'),
        err instanceof Error ? err.message : 'Please try again.',
      );
    }
  }

  const isPending = create.isPending || update.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-modal w-full max-w-lg max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-lg font-bold font-display text-ink truncate">
              {promoteMode ? 'Create brand from suggestion'
                : isEdit ? `Edit brand — ${brand!.name}`
                : 'New brand'}
            </h2>
            {promoteMode && (
              <p className="text-xs text-muted font-body mt-0.5">
                Auto-created by the Excel importer. Fill in the details and save to publish.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg hover:bg-surface-cream flex items-center justify-center"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-ink" strokeWidth={1.75} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold font-display text-ink mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Carbonell"
              className="w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold font-display text-ink mb-1">Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              placeholder="Auto-generated from name if blank"
              className="w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-display text-ink font-mono focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <p className="text-[11px] text-muted mt-1">Lowercase letters, digits, hyphens. Used in customer URLs like <span className="font-mono">/brands/{slug || 'carbonell'}</span>.</p>
          </div>

          <ImageUploadField
            value={logoUrl}
            onChange={setLogoUrl}
            label="Logo"
            helperText="Square works best. Rendered on the customer Top Brands rail."
          />

          <div>
            <label className="block text-xs font-semibold font-display text-ink mb-1">Logo background</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={logoBg}
                onChange={(e) => setLogoBg(e.target.value)}
                className="w-11 h-11 rounded-lg border border-border cursor-pointer"
              />
              <input
                type="text"
                value={logoBg}
                onChange={(e) => setLogoBg(e.target.value)}
                placeholder="#FFFFFF"
                className="flex-1 bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-mono text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold font-display text-ink mb-1">Link (optional)</label>
            <input
              type="text"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="/categories?brand=Carbonell"
              className="w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <p className="text-[11px] text-muted mt-1">Defaults to the brand-filtered catalogue if left blank.</p>
          </div>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 accent-brand"
            />
            <span className="text-sm font-display text-ink">
              Active <span className="text-muted font-normal">— shown on the customer Top Brands rail</span>
            </span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={isPending}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-xl text-sm font-semibold font-display bg-brand text-white hover:bg-brand-mid disabled:opacity-50"
          >
            <Save className="w-4 h-4" strokeWidth={1.75} />
            {promoteMode ? 'Create brand' : isEdit ? 'Save changes' : 'Create brand'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete confirmation ────────────────────────────────

function ConfirmDeleteModal({
  brand, onCancel, onConfirm, isPending,
}: {
  brand: Brand; onCancel: () => void; onConfirm: () => void; isPending: boolean;
}) {
  const count = brand._count?.products ?? 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="bg-card rounded-2xl shadow-modal w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold font-display text-ink mb-2">Delete "{brand.name}"?</h2>
        <p className="text-sm text-muted mb-2">
          The brand row will be permanently removed.
        </p>
        {count > 0 && (
          <p className="text-sm text-amber-deep bg-amber-mist/40 border border-amber rounded-lg px-3 py-2 mb-2">
            {count} product{count === 1 ? '' : 's'} reference this brand. Their <span className="font-mono">brand_id</span> and free-text <span className="font-mono">brand</span> field will be cleared — the products themselves stay put.
          </p>
        )}
        <div className="flex items-center justify-end gap-3 mt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="h-11 px-5 rounded-xl text-sm font-semibold font-display bg-danger text-white hover:bg-danger/90 disabled:opacity-50"
          >
            {isPending ? 'Deleting…' : 'Delete brand'}
          </button>
        </div>
      </div>
    </div>
  );
}
