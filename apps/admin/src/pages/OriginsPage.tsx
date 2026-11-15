import { useMemo, useState } from 'react';
import { Plus, Search, Globe, ArrowUp, ArrowDown, Trash2, Edit2, Eye, EyeOff, X, Save, Sparkles } from 'lucide-react';
import {
  useAdminOriginsTable, useCreateOrigin, useUpdateOrigin, useDeleteOrigin, useReorderOrigins,
  type Origin, type OriginWritePayload, resolveImageUrl,
} from '@grocery-app/shared';
import { useToast } from '@/components/Toast';
import ImageUploadField from '@/components/home-preview/ImageUploadField';
import { TableSkeleton } from '@/components/Skeleton';

// Curated Shop-by-Origin cards were promoted from a `home_sections` JSON blob
// to their own table on 2026-07-13 (migration `20260713140000_add_brands_and_origins`).
// This page owns the table — the old Shop by Origin tab on Home Sections is
// scheduled for removal.

type FilterMode = 'all' | 'active' | 'inactive' | 'suggestions';

const isSuggestion = (o: { source: string; is_active: boolean }) =>
  o.source === 'import' && !o.is_active;

export default function OriginsPage() {
  const { data: origins = [], isLoading } = useAdminOriginsTable();
  const reorder = useReorderOrigins();
  const deleteOrigin = useDeleteOrigin();
  const toast = useToast();

  const [q, setQ] = useState('');
  const [mode, setMode] = useState<FilterMode>('all');
  const [editing, setEditing] = useState<Origin | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const suggestionCount = useMemo(() => origins.filter(isSuggestion).length, [origins]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return origins
      .filter((o) => {
        if (mode === 'all') return true;
        if (mode === 'active') return o.is_active;
        if (mode === 'inactive') return !o.is_active;
        return isSuggestion(o);
      })
      .filter((o) => (needle
        ? o.label_es.toLowerCase().includes(needle) || o.label_en.toLowerCase().includes(needle) || o.key.toLowerCase().includes(needle)
        : true));
  }, [origins, q, mode]);

  async function move(index: number, dir: -1 | 1) {
    const flat = [...origins].sort((a, b) => a.sort_order - b.sort_order || a.label_es.localeCompare(b.label_es));
    const origin = filtered[index];
    const flatIdx = flat.findIndex((o) => o.id === origin.id);
    const swapIdx = flatIdx + dir;
    if (swapIdx < 0 || swapIdx >= flat.length) return;
    [flat[flatIdx], flat[swapIdx]] = [flat[swapIdx], flat[flatIdx]];
    try {
      await reorder.mutateAsync(flat.map((o) => o.id));
    } catch (err) {
      toast.error('Reorder failed', err instanceof Error ? err.message : 'Please try again.');
    }
  }

  async function confirmDelete() {
    if (!confirmDeleteId) return;
    try {
      const res = await deleteOrigin.mutateAsync(confirmDeleteId);
      toast.success(
        'Origin deleted',
        res.product_count > 0
          ? `${res.product_count} product(s) had their origin cleared.`
          : 'No products were referencing this origin.',
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
            Origins
            {!isLoading && (
              <span className="text-base font-normal text-muted ml-2">({origins.length})</span>
            )}
          </h1>
          <p className="text-sm text-muted mt-1">
            Curated country / region cards shown on the customer "Shop by Origin" rail. Products link here by <span className="font-mono text-[13px]">origin_id</span>; the Excel importer auto-adds new origins as <span className="italic">inactive</span> for you to review.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition shrink-0 w-full sm:w-auto"
        >
          <Plus className="w-5 h-5" strokeWidth={1.75} />
          New origin
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as FilterMode)}
          className="bg-surface-cream border border-border rounded-lg h-11 px-4 text-sm font-display text-ink min-w-[200px] focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="all">All origins</option>
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
            placeholder="Search by label or key…"
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
              These origins were auto-created from Excel imports and are waiting for review.
            </p>
            <p className="mt-0.5 text-amber-deep/80">
              Click <span className="font-semibold">Edit</span> to add proper labels, colours, and an image, then toggle <span className="font-semibold">Active</span> to feature it on the customer Shop by Origin rail.
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={6} cols={5} />
      ) : filtered.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-cream flex items-center justify-center mx-auto mb-4">
            <Globe className="w-8 h-8 text-muted" strokeWidth={1.75} />
          </div>
          <h3 className="text-lg font-semibold font-display text-ink mb-1">
            {q || mode !== 'all' ? 'No origins match your filters' : 'No origins yet'}
          </h3>
          <p className="text-sm text-muted mb-4">
            {q || mode !== 'all'
              ? 'Try clearing the filters or search box.'
              : 'Add your first origin to start showing it on the customer "Shop by Origin" rail.'}
          </p>
          {!(q || mode !== 'all') && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-2 bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition"
            >
              <Plus className="w-4 h-4" strokeWidth={1.75} />
              New origin
            </button>
          )}
        </div>
      ) : (
        <>
        {/* ON A PHONE (2026-11-05): a card per row — the table needed 820px
            and put status and every action off to the right. Same handlers. */}
        <ul className="sm:hidden bg-card rounded-xl border border-border divide-y divide-border">
          {filtered.map((o, i) => (
            <li key={o.id} className="px-3 py-3">
              <div className="flex items-start gap-3">
                {o.image_url ? (
                  <img
                    src={resolveImageUrl(o.image_url, 'tile') ?? ''}
                    alt=""
                    className="w-11 h-11 rounded-lg object-cover border border-border shrink-0"
                    style={{ backgroundColor: o.bg_color ?? '#FFFFFF' }}
                  />
                ) : (
                  <span
                    className="w-11 h-11 rounded-lg border border-border flex items-center justify-center shrink-0"
                    style={{ backgroundColor: o.bg_color ?? '#F5F0E8' }}
                  >
                    <Globe className="w-5 h-5" style={{ color: o.accent_color ?? '#7A7A7A' }} strokeWidth={1.75} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold font-display text-ink text-sm">{o.label_es}</p>
                    {isSuggestion(o) && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold font-display bg-amber-mist text-amber-deep border border-amber/40">
                        <Sparkles className="w-3 h-3" strokeWidth={2} />
                        From import
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted mt-0.5 truncate">{o.label_en} · <span className="font-mono">{o.key}</span></p>
                  <p className="text-xs text-muted mt-0.5 tabular-nums">{o._count?.products ?? 0} products</p>
                </div>
                {o.is_active ? (
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
                {isSuggestion(o) ? (
                  <button
                    type="button"
                    onClick={() => setEditing(o)}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-brand text-white text-xs font-semibold font-display"
                  >
                    <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
                    Create origin
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditing(o)}
                    className="w-9 h-9 rounded-lg bg-surface-cream flex items-center justify-center transition"
                    aria-label="Edit"
                  >
                    <Edit2 className="w-4 h-4 text-ink" strokeWidth={1.75} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(o.id)}
                  className="w-9 h-9 rounded-lg bg-surface-cream flex items-center justify-center transition"
                  aria-label={isSuggestion(o) ? 'Dismiss suggestion' : 'Delete'}
                >
                  <Trash2 className="w-4 h-4 text-danger" strokeWidth={1.75} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="hidden sm:block bg-card rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead className="bg-surface-cream border-b border-border">
              <tr>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display w-16">Order</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display w-20">Image</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">Labels</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">Products</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">Status</th>
                <th className="text-right text-xs font-semibold text-gray uppercase px-4 py-3 font-display">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o, i) => (
                <tr key={o.id} className="border-t border-border hover:bg-brand-mist/20 transition">
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
                    {o.image_url ? (
                      <img
                        src={resolveImageUrl(o.image_url, 'tile') ?? ''}
                        alt={o.label_es}
                        className="w-10 h-10 rounded-lg object-cover border border-border"
                        style={{ backgroundColor: o.bg_color ?? '#FFFFFF' }}
                      />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-lg border border-border flex items-center justify-center"
                        style={{ backgroundColor: o.bg_color ?? '#F5F0E8' }}
                      >
                        <Globe className="w-5 h-5" style={{ color: o.accent_color ?? '#7A7A7A' }} strokeWidth={1.75} />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold font-display text-ink">{o.label_es}</p>
                      {isSuggestion(o) && (
                        <span
                          title="Auto-created by the Excel importer. Review and toggle active to feature it on the customer rail."
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold font-display bg-amber-mist text-amber-deep border border-amber/40"
                        >
                          <Sparkles className="w-3 h-3" strokeWidth={2} />
                          From import
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-muted mt-0.5">{o.label_en}</p>
                    <p className="text-[11px] text-muted font-mono mt-0.5">{o.key}</p>
                  </td>
                  <td className="px-4 py-3 text-ink">{o._count?.products ?? 0}</td>
                  <td className="px-4 py-3">
                    {o.is_active ? (
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
                      {isSuggestion(o) ? (
                        <button
                          type="button"
                          onClick={() => setEditing(o)}
                          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-brand text-white text-xs font-semibold font-display hover:bg-brand-mid transition"
                        >
                          <Sparkles className="w-3.5 h-3.5" strokeWidth={2} />
                          Create origin
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditing(o)}
                          className="w-9 h-9 rounded-lg bg-surface-cream hover:bg-brand-mist flex items-center justify-center transition"
                          aria-label="Edit"
                        >
                          <Edit2 className="w-4 h-4 text-ink" strokeWidth={1.75} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(o.id)}
                        className="w-9 h-9 rounded-lg bg-surface-cream hover:bg-danger-bg flex items-center justify-center transition"
                        aria-label={isSuggestion(o) ? 'Dismiss suggestion' : 'Delete'}
                        title={isSuggestion(o) ? 'Dismiss this suggestion' : 'Delete'}
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
        <OriginFormModal
          origin={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}

      {confirmDeleteId && (
        <ConfirmDeleteModal
          origin={origins.find((o) => o.id === confirmDeleteId)!}
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={confirmDelete}
          isPending={deleteOrigin.isPending}
        />
      )}
    </div>
  );
}

// ─── Create / Edit modal ────────────────────────────────

function OriginFormModal({ origin, onClose }: { origin: Origin | null; onClose: () => void }) {
  // Same "promote suggestion → create origin" reframing as the BrandsPage
  // modal. `promoteMode` shifts the title, save button, and default active
  // flag so an admin clicking a suggestion sees a Create flow, not an Edit.
  const promoteMode = !!origin && origin.source === 'import' && !origin.is_active;
  const isEdit = !!origin;
  const create = useCreateOrigin();
  const update = useUpdateOrigin();
  const toast = useToast();

  const [labelEs, setLabelEs]       = useState(origin?.label_es ?? '');
  const [labelEn, setLabelEn]       = useState(origin?.label_en ?? '');
  const [key, setKey]               = useState(origin?.key ?? '');
  const [bgColor, setBgColor]       = useState(origin?.bg_color ?? '#F5F0E8');
  const [accentColor, setAccentColor] = useState(origin?.accent_color ?? '#7A7A7A');
  const [imageUrl, setImageUrl]     = useState<string | null>(origin?.image_url ?? null);
  const [link, setLink]             = useState(origin?.link ?? '');
  const [isActive, setIsActive]     = useState(promoteMode ? true : (origin?.is_active ?? true));

  async function save() {
    if (!labelEs.trim() || !labelEn.trim()) {
      toast.error('Both labels are required', 'Enter Spanish AND English labels.');
      return;
    }
    const payload: OriginWritePayload = {
      key: key.trim() || undefined,
      label_es: labelEs.trim(),
      label_en: labelEn.trim(),
      bg_color: bgColor,
      accent_color: accentColor,
      image_url: imageUrl,
      link: link.trim() || null,
      is_active: isActive,
    };
    try {
      if (isEdit && origin) {
        await update.mutateAsync({ id: origin.id, payload });
        toast.success(promoteMode ? 'Origin created' : 'Origin updated');
      } else {
        await create.mutateAsync(payload);
        toast.success('Origin created');
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
              {promoteMode ? 'Create origin from suggestion'
                : isEdit ? `Edit origin — ${origin!.label_es}`
                : 'New origin'}
            </h2>
            {promoteMode && (
              <p className="text-xs text-muted font-body mt-0.5">
                Auto-created by the Excel importer. Fill in labels, colours, and an image, then save to publish.
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold font-display text-ink mb-1">Label (Spanish) *</label>
              <input
                type="text"
                value={labelEs}
                onChange={(e) => setLabelEs(e.target.value)}
                placeholder="España"
                className="w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold font-display text-ink mb-1">Label (English) *</label>
              <input
                type="text"
                value={labelEn}
                onChange={(e) => setLabelEn(e.target.value)}
                placeholder="Spain"
                className="w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold font-display text-ink mb-1">Key</label>
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              placeholder="Auto-generated from label if blank"
              className="w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-display text-ink font-mono focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <p className="text-[11px] text-muted mt-1">Slug used in customer URLs like <span className="font-mono">/categories?origin={key || 'spain'}</span>. Also the value the Excel importer resolves against.</p>
          </div>

          <ImageUploadField
            value={imageUrl}
            onChange={setImageUrl}
            label="Image (optional)"
            helperText="Falls back to the accent-coloured globe placeholder if blank."
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold font-display text-ink mb-1">Background color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="w-11 h-11 rounded-lg border border-border cursor-pointer"
                />
                <input
                  type="text"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="flex-1 bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-mono text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold font-display text-ink mb-1">Accent color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="w-11 h-11 rounded-lg border border-border cursor-pointer"
                />
                <input
                  type="text"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="flex-1 bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-mono text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold font-display text-ink mb-1">Link (optional)</label>
            <input
              type="text"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="/categories?origin=spain"
              className="w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 accent-brand"
            />
            <span className="text-sm font-display text-ink">
              Active <span className="text-muted font-normal">— shown on the customer Shop by Origin rail</span>
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
            {promoteMode ? 'Create origin' : isEdit ? 'Save changes' : 'Create origin'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete confirmation ────────────────────────────────

function ConfirmDeleteModal({
  origin, onCancel, onConfirm, isPending,
}: {
  origin: Origin; onCancel: () => void; onConfirm: () => void; isPending: boolean;
}) {
  const count = origin._count?.products ?? 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="bg-card rounded-2xl shadow-modal w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold font-display text-ink mb-2">Delete "{origin.label_es}"?</h2>
        <p className="text-sm text-muted mb-2">
          The origin row will be permanently removed.
        </p>
        {count > 0 && (
          <p className="text-sm text-amber-deep bg-amber-mist/40 border border-amber rounded-lg px-3 py-2 mb-2">
            {count} product{count === 1 ? '' : 's'} reference this origin. Their <span className="font-mono">origin_id</span> and free-text <span className="font-mono">origin</span> field will be cleared — the products themselves stay put.
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
            {isPending ? 'Deleting…' : 'Delete origin'}
          </button>
        </div>
      </div>
    </div>
  );
}
