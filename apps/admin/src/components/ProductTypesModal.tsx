import { useState } from 'react';
import { X, Plus, Pencil, Trash2, Check, AlertTriangle, Sparkles } from 'lucide-react';
import {
  useAdminProductTypes,
  useCreateProductType,
  useUpdateProductType,
  useDeleteProductType,
  type ProductType,
} from '@grocery-app/shared';
import { useToast } from '@/components/Toast';

interface Props {
  open: boolean;
  subcategoryId: string;
  subcategoryName: string;
  categoryName: string;
  onClose: () => void;
}

/**
 * Manage the product types nested under one subcategory. Called from each
 * subcategory row on the admin CategoriesPage. Full inline CRUD — add form
 * at the top, editable rows underneath, delete with confirmation.
 *
 * Third tier of Category → SubCategory → ProductType. Optional on Product,
 * so admins can create/manage types without touching existing products.
 * See docs/MULTIVENDOR_ROADMAP if this feature ever moves to its own page.
 */
export default function ProductTypesModal({
  open, subcategoryId, subcategoryName, categoryName, onClose,
}: Props) {
  const toast = useToast();
  const { data: types, isLoading } = useAdminProductTypes({ subcategoryId });

  // Inline add form — kept as flat state so re-renders don't churn a nested object.
  const [newNameEs, setNewNameEs] = useState('');
  const [newNameEn, setNewNameEn] = useState('');
  const [newSort, setNewSort] = useState('');

  // Row-level edit: only one row can be in edit-mode at a time. Simpler than
  // per-row form state — matches how admin subcategory editing works.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNameEs, setEditNameEs] = useState('');
  const [editNameEn, setEditNameEn] = useState('');
  const [editSort, setEditSort] = useState('');
  const [editActive, setEditActive] = useState(true);
  // Delete confirmation — track the whole row (not just id) so the modal
  // can show name + product count + typed-name gate without re-querying.
  const [confirmDelete, setConfirmDelete] = useState<ProductType | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const createMut = useCreateProductType();
  const updateMut = useUpdateProductType();
  const deleteMut = useDeleteProductType();

  if (!open) return null;

  async function handleCreate() {
    const name_es = newNameEs.trim();
    const name_en = newNameEn.trim();
    if (!name_es || !name_en) {
      toast.error('Both Spanish and English names are required.');
      return;
    }
    try {
      await createMut.mutateAsync({
        subcategory_id: subcategoryId,
        name_es,
        name_en,
        sort_order: newSort ? parseInt(newSort, 10) || 0 : 0,
      });
      setNewNameEs(''); setNewNameEn(''); setNewSort('');
      toast.success(`Product type "${name_es}" created.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create product type.');
    }
  }

  function startEdit(t: ProductType) {
    setEditingId(t.id);
    setEditNameEs(t.name_es);
    setEditNameEn(t.name_en);
    setEditSort(String(t.sort_order));
    setEditActive(t.is_active);
  }

  async function saveEdit() {
    if (!editingId) return;
    const name_es = editNameEs.trim();
    const name_en = editNameEn.trim();
    if (!name_es || !name_en) {
      toast.error('Both Spanish and English names are required.');
      return;
    }
    try {
      await updateMut.mutateAsync({
        id: editingId,
        payload: {
          name_es,
          name_en,
          sort_order: parseInt(editSort, 10) || 0,
          is_active: editActive,
        },
      });
      setEditingId(null);
      toast.success('Product type updated.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update product type.');
    }
  }

  function openDeleteConfirm(row: ProductType) {
    setConfirmDelete(row);
    setDeleteConfirmText('');
  }
  function cancelDeleteConfirm() {
    setConfirmDelete(null);
    setDeleteConfirmText('');
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    try {
      const result = await deleteMut.mutateAsync(confirmDelete.id);
      cancelDeleteConfirm();
      toast.success(
        result.detached > 0
          ? `Product type deleted. ${result.detached} product${result.detached === 1 ? '' : 's'} moved back to the subcategory.`
          : 'Product type deleted.',
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete product type.');
    }
  }

  const rows = types ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-card rounded-2xl shadow-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-border">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted font-display">
              {categoryName} · {subcategoryName}
            </div>
            <h3 className="text-lg font-bold font-display text-ink mt-0.5">
              Product types
            </h3>
            <p className="text-[13px] text-muted font-body mt-0.5">
              A third-tier taxonomy under this subcategory. Optional per product — deleting a type leaves its products cleanly parked under the subcategory.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-linen transition-colors shrink-0" type="button" aria-label="Close">
            <X size={18} strokeWidth={1.75} className="text-muted" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Add form */}
          <div className="bg-surface-cream border border-border rounded-lg p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted font-display mb-2">
              Add product type
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_80px_auto] gap-2">
              <input
                type="text" value={newNameEs} onChange={(e) => setNewNameEs(e.target.value)}
                placeholder="Name (ES)"
                className="bg-card border border-border rounded-lg h-10 px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
              <input
                type="text" value={newNameEn} onChange={(e) => setNewNameEn(e.target.value)}
                placeholder="Name (EN)"
                className="bg-card border border-border rounded-lg h-10 px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
              <input
                type="number" value={newSort} onChange={(e) => setNewSort(e.target.value)}
                placeholder="Sort"
                className="bg-card border border-border rounded-lg h-10 px-3 text-sm font-mono text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
              />
              <button
                type="button"
                onClick={handleCreate}
                disabled={createMut.isPending}
                className="h-10 px-4 rounded-lg bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm inline-flex items-center gap-1.5 transition disabled:opacity-50"
              >
                <Plus className="w-4 h-4" strokeWidth={2} />
                Add
              </button>
            </div>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="text-sm text-muted py-6 text-center">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="bg-card border border-border border-dashed rounded-lg p-8 text-center">
              <p className="text-sm text-muted font-body">
                No product types yet. Add one above to start categorising products at a third tier.
              </p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-surface-cream">
                    <th className="text-left text-[11px] font-semibold text-muted uppercase tracking-wider px-3 py-2 font-display">Name (ES)</th>
                    <th className="text-left text-[11px] font-semibold text-muted uppercase tracking-wider px-3 py-2 font-display">Name (EN)</th>
                    <th className="text-left text-[11px] font-semibold text-muted uppercase tracking-wider px-3 py-2 font-display w-16">Sort</th>
                    <th className="text-left text-[11px] font-semibold text-muted uppercase tracking-wider px-3 py-2 font-display w-16">Products</th>
                    <th className="text-left text-[11px] font-semibold text-muted uppercase tracking-wider px-3 py-2 font-display w-24">Status</th>
                    <th className="text-right text-[11px] font-semibold text-muted uppercase tracking-wider px-3 py-2 font-display w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id} className="border-t border-border">
                      {editingId === t.id ? (
                        <>
                          <td className="px-3 py-2">
                            <input value={editNameEs} onChange={(e) => setEditNameEs(e.target.value)}
                              className="w-full bg-card border border-border rounded h-8 px-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30" />
                          </td>
                          <td className="px-3 py-2">
                            <input value={editNameEn} onChange={(e) => setEditNameEn(e.target.value)}
                              className="w-full bg-card border border-border rounded h-8 px-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30" />
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" value={editSort} onChange={(e) => setEditSort(e.target.value)}
                              className="w-full bg-card border border-border rounded h-8 px-2 text-sm font-mono text-ink focus:outline-none focus:ring-2 focus:ring-brand/30" />
                          </td>
                          <td className="px-3 py-2 text-sm text-muted tabular-nums">{t._count?.products ?? 0}</td>
                          <td className="px-3 py-2">
                            <label className="inline-flex items-center gap-1.5 text-[11px] font-body cursor-pointer">
                              <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)}
                                className="w-3.5 h-3.5 rounded border-border text-brand focus:ring-brand/30" />
                              Active
                            </label>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button type="button" onClick={saveEdit} disabled={updateMut.isPending}
                                className="w-7 h-7 rounded-md bg-brand hover:bg-brand-mid text-white inline-flex items-center justify-center transition disabled:opacity-50">
                                <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                              </button>
                              <button type="button" onClick={() => setEditingId(null)}
                                className="w-7 h-7 rounded-md hover:bg-surface-linen inline-flex items-center justify-center transition">
                                <X className="w-3.5 h-3.5 text-muted" strokeWidth={2} />
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-sm text-ink font-medium font-display flex items-center gap-1.5">
                            {t.name_es}
                            {t.source === 'import' && (
                              <span
                                title="Auto-created by the Excel importer. Review and mark active to publish."
                                className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full text-[11px] font-bold font-display bg-amber-mist text-amber-deep border border-amber/40"
                              >
                                <Sparkles className="w-2.5 h-2.5" strokeWidth={2} />
                                Import
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-sm text-muted font-body">{t.name_en}</td>
                          <td className="px-3 py-2 text-sm font-mono text-muted tabular-nums">{t.sort_order}</td>
                          <td className="px-3 py-2 text-sm text-muted tabular-nums">{t._count?.products ?? 0}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold font-display uppercase tracking-wide ${
                              t.is_active ? 'bg-success-bg text-success' : 'bg-gray-100 text-muted'
                            }`}>
                              {t.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="inline-flex items-center gap-1">
                              <button type="button" onClick={() => startEdit(t)}
                                className="w-7 h-7 rounded-md hover:bg-surface-linen inline-flex items-center justify-center transition" title="Edit">
                                <Pencil className="w-3.5 h-3.5 text-muted" strokeWidth={1.75} />
                              </button>
                              <button type="button" onClick={() => openDeleteConfirm(t)}
                                className="w-7 h-7 rounded-md hover:bg-danger-bg inline-flex items-center justify-center transition" title="Delete">
                                <Trash2 className="w-3.5 h-3.5 text-danger" strokeWidth={1.75} />
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation — typed-name gate. Not "too simple" per user
          feedback: admin must retype the exact product-type name (Spanish)
          into a text field before the delete button unlocks, and the
          product-count impact is called out explicitly. Cancel is the
          primary/safe path; delete sits secondary-danger. */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={cancelDeleteConfirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-pt-title"
        >
          <div
            className="bg-card rounded-2xl shadow-modal w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Danger header */}
            <div className="flex items-start gap-3 p-5 border-b border-border bg-danger-bg">
              <AlertTriangle className="w-5 h-5 text-danger shrink-0 mt-0.5" strokeWidth={1.75} />
              <div className="flex-1 min-w-0">
                <h4 id="delete-pt-title" className="text-base font-bold font-display text-ink">
                  Delete product type
                </h4>
                <p className="text-[13px] text-danger font-body mt-0.5">
                  This can be undone by recreating the type, but the FK link on affected products is dropped and won't come back automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={cancelDeleteConfirm}
                className="p-1.5 rounded-lg hover:bg-black/10 transition-colors shrink-0"
                aria-label="Close"
              >
                <X size={18} strokeWidth={1.75} className="text-muted" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* The row being deleted, prominently */}
              <div className="bg-surface-cream border border-border rounded-lg px-3 py-2.5">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted font-display">
                  You are deleting
                </div>
                <div className="text-base font-bold font-display text-ink mt-0.5">
                  {confirmDelete.name_es}
                </div>
                <div className="text-[12px] font-body text-muted">
                  {confirmDelete.name_en} · under <span className="font-mono">{subcategoryName}</span>
                </div>
              </div>

              {/* Impact call-out */}
              {(() => {
                const affected = confirmDelete._count?.products ?? 0;
                if (affected === 0) {
                  return (
                    <p className="text-[13px] text-muted font-body">
                      No products currently reference this type. Safe to remove.
                    </p>
                  );
                }
                return (
                  <div className="border border-warn/40 bg-warn/5 rounded-lg px-3 py-2.5 text-[13px] font-body text-ink">
                    <strong className="font-bold">{affected}</strong> product{affected === 1 ? '' : 's'} currently tagged with this type will be moved back to just the <span className="font-mono">{subcategoryName}</span> subcategory. No products are deleted — they simply lose the third-tier tag.
                  </div>
                );
              })()}

              {/* Typed-name gate */}
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted font-display">
                  Type <span className="font-mono text-ink">{confirmDelete.name_es}</span> to confirm
                </span>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={confirmDelete.name_es}
                  className="mt-1.5 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm font-mono text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-danger/30"
                />
              </label>
            </div>

            <div className="flex gap-2 justify-end px-5 pb-5">
              <button
                type="button"
                onClick={cancelDeleteConfirm}
                disabled={deleteMut.isPending}
                className="h-10 px-4 rounded-lg border-2 border-border text-sm font-semibold font-display text-gray hover:bg-surface-linen transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteMut.isPending || deleteConfirmText !== confirmDelete.name_es}
                className="h-10 px-4 rounded-lg bg-danger hover:bg-danger/90 text-white text-sm font-semibold font-display transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleteMut.isPending ? 'Deleting…' : 'Delete product type'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
