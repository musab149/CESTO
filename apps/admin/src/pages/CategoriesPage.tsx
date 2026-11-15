import { useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, Grid3X3, X, AlertTriangle, Upload, Link as LinkIcon, Sparkles, Loader2, PackageOpen, AlertCircle, Store, Check } from 'lucide-react';
import { z } from 'zod';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';
import {
  useAdminCategories,
  useAdminSubcategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useCreateSubcategory,
  useUpdateSubcategory,
  useDeleteSubcategory,
  usePendingCategories,
  useDismissPendingCategory,
  usePartnerCategorySubmissions,
  useApproveCategory,
  useRejectCategory,
  adminUploads,
  resolveImageUrl,
} from '@grocery-app/shared';
import type { Category, SubCategory, PendingCategory } from '@grocery-app/shared';
import { TableSkeleton } from '@/components/Skeleton';
import PublishPendingProductsModal from '@/components/PublishPendingProductsModal';
import ProductTypesModal from '@/components/ProductTypesModal';
import { useTranslation } from 'react-i18next';

interface CategoryForm {
  name_es: string;
  name_en: string;
  icon_url: string;
  sort_order: string;
  is_active: boolean;
}

const emptyForm: CategoryForm = {
  name_es: '',
  name_en: '',
  icon_url: '',
  sort_order: '1',
  is_active: true,
};

function categoryToForm(c: Category): CategoryForm {
  return {
    name_es: c.name_es,
    name_en: c.name_en,
    icon_url: c.icon_url ?? '',
    sort_order: String(c.sort_order),
    is_active: c.is_active,
  };
}

interface SubCategoryForm {
  name_es: string;
  name_en: string;
  sort_order: string;
  is_active: boolean;
}

const emptySubForm: SubCategoryForm = {
  name_es: '',
  name_en: '',
  sort_order: '1',
  is_active: true,
};

export default function CategoriesPage() {
  const { t } = useTranslation();
  const messages = useValidationMessages();

  // Inline zod schemas — modal forms are small enough that a hand-rolled
  // validate-on-save pass is lighter than full react-hook-form integration.
  const categorySchema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      name_es:    r.name({ min: 1, max: 80 }),
      name_en:    r.name({ min: 1, max: 80 }),
      icon_url:   r.optionalUrl(),
      sort_order: z.coerce.number().int().min(1, messages.positive),
    });
  }, [messages]);

  const subSchema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      name_es:    r.name({ min: 1, max: 80 }),
      name_en:    r.name({ min: 1, max: 80 }),
      sort_order: z.coerce.number().int().min(1, messages.positive),
    });
  }, [messages]);

  const [formErrors, setFormErrors] = useState<Partial<Record<keyof CategoryForm, string>>>({});
  const [subFormErrors, setSubFormErrors] = useState<Partial<Record<keyof SubCategoryForm, string>>>({});

  const { data: categories, isLoading } = useAdminCategories();
  const { data: subcategories } = useAdminSubcategories();
  const { data: pendingCategories } = usePendingCategories();
  const dismissPending = useDismissPendingCategory();
  const { data: partnerSubmissions } = usePartnerCategorySubmissions('pending');
  const approveSubmission = useApproveCategory();
  const rejectSubmission = useRejectCategory();
  const createCat = useCreateCategory();
  const updateCat = useUpdateCategory();
  const deleteCat = useDeleteCategory();
  const createSub = useCreateSubcategory();
  const updateSub = useUpdateSubcategory();
  const deleteSub = useDeleteSubcategory();

  // Delete-category state. When `pending` is set, we show a modal that adapts:
  // - empty category → simple confirm
  // - has products → also requires picking a target to reassign to
  const [deletePending, setDeletePending] = useState<{ id: string; name: string; productCount: number } | null>(null);
  const [reassignTo, setReassignTo] = useState<string>('');
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Subcategory delete confirm
  const [subDeletePending, setSubDeletePending] = useState<{ id: string; name: string } | null>(null);

  // Reject-reason modal for a pending partner category submission
  const [rejectingSubmission, setRejectingSubmission] = useState<{ id: string; name: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CategoryForm>(emptyForm);

  const [showSubModal, setShowSubModal] = useState(false);
  const [subParentId, setSubParentId] = useState<string | null>(null);
  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [subForm, setSubForm] = useState<SubCategoryForm>(emptySubForm);

  // Drives the queued-products modal. Set to a Category to open it; null hides.
  const [publishQueueFor, setPublishQueueFor] = useState<Category | null>(null);
  // Drives the product-types modal — opened from a subcategory row. Carries
  // the subcategory + its parent category name for the modal header.
  const [productTypesFor, setProductTypesFor] = useState<
    { sub: SubCategory; categoryName: string } | null
  >(null);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openAddCategory() {
    setEditingId(null);
    setForm(emptyForm);
    setFormErrors({});
    setShowModal(true);
  }

  function openAddFromPending(pending: PendingCategory) {
    setEditingId(null);
    setForm({
      ...emptyForm,
      name_es: pending.name,
      name_en: pending.name,
      sort_order: String((categories?.length ?? 0) + 1),
    });
    setShowModal(true);
  }

  async function handleDismissPending(id: string) {
    try {
      await dismissPending.mutateAsync(id);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleApproveSubmission(id: string) {
    try {
      await approveSubmission.mutateAsync({ id });
    } catch (err) {
      console.error(err);
    }
  }

  function openRejectSubmission(submission: { id: string; name_es: string }) {
    setRejectingSubmission({ id: submission.id, name: submission.name_es });
    setRejectReason('');
  }

  async function confirmRejectSubmission() {
    if (!rejectingSubmission || !rejectReason.trim()) return;
    try {
      await rejectSubmission.mutateAsync({ id: rejectingSubmission.id, reason: rejectReason.trim() });
      setRejectingSubmission(null);
    } catch (err) {
      console.error(err);
    }
  }

  function openEditCategory(cat: Category) {
    setEditingId(cat.id);
    setForm(categoryToForm(cat));
    setFormErrors({});
    setShowModal(true);
  }

  async function handleSaveCategory() {
    const parsed = categorySchema.safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof CategoryForm, string>> = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as keyof CategoryForm;
        if (k && !next[k]) next[k] = issue.message;
      }
      setFormErrors(next);
      return;
    }
    setFormErrors({});
    const payload = {
      name_es: form.name_es,
      name_en: form.name_en,
      icon_url: form.icon_url || null,
      sort_order: parseInt(form.sort_order, 10) || 1,
      is_active: form.is_active,
    };
    try {
      if (editingId) {
        await updateCat.mutateAsync({ id: editingId, payload });
        setShowModal(false);
      } else {
        const created = await createCat.mutateAsync(payload);
        setShowModal(false);
        // If the new category absorbed queued imports, open the publish modal
        // immediately so the admin doesn't have to hunt for the badge.
        if (created && (created as Category).pending_products_count && (created as Category).pending_products_count! > 0) {
          setPublishQueueFor(created as Category);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  function openAddSub(categoryId: string) {
    setSubParentId(categoryId);
    setEditingSubId(null);
    setSubForm(emptySubForm);
    setSubFormErrors({});
    setShowSubModal(true);
    // Auto-expand the parent so the new subcategory becomes visible after save
    setExpandedIds((prev) => {
      if (prev.has(categoryId)) return prev;
      const next = new Set(prev);
      next.add(categoryId);
      return next;
    });
  }

  function openEditSub(sub: SubCategory) {
    setSubParentId(sub.category_id);
    setEditingSubId(sub.id);
    setSubForm({ name_es: sub.name_es, name_en: sub.name_en, sort_order: String(sub.sort_order), is_active: sub.is_active });
    setSubFormErrors({});
    setShowSubModal(true);
  }

  function openDeleteCategory(cat: Category) {
    const productCount = (cat as Category & { _count?: { products: number } })._count?.products ?? 0;
    setDeletePending({ id: cat.id, name: cat.name_es, productCount });
    setReassignTo('');
    setDeleteError(null);
  }

  async function confirmDeleteCategory() {
    if (!deletePending) return;
    setDeleteError(null);
    try {
      await deleteCat.mutateAsync({
        id: deletePending.id,
        reassignTo: deletePending.productCount > 0 ? reassignTo : undefined,
      });
      setDeletePending(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function deactivateInsteadOfDelete() {
    if (!deletePending) return;
    setDeleteError(null);
    const cat = categories?.find((c) => c.id === deletePending.id);
    if (!cat) return;
    try {
      await updateCat.mutateAsync({
        id: cat.id,
        payload: {
          name_es: cat.name_es,
          name_en: cat.name_en,
          icon_url: cat.icon_url ?? null,
          sort_order: cat.sort_order,
          is_active: false,
        },
      });
      setDeletePending(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Deactivate failed');
    }
  }

  function openDeleteSub(sub: SubCategory) {
    setSubDeletePending({ id: sub.id, name: sub.name_es });
  }

  async function confirmDeleteSub() {
    if (!subDeletePending) return;
    try {
      await deleteSub.mutateAsync(subDeletePending.id);
      setSubDeletePending(null);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleSaveSub() {
    if (!subParentId) return;
    const parsed = subSchema.safeParse(subForm);
    if (!parsed.success) {
      const next: Partial<Record<keyof SubCategoryForm, string>> = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as keyof SubCategoryForm;
        if (k && !next[k]) next[k] = issue.message;
      }
      setSubFormErrors(next);
      return;
    }
    setSubFormErrors({});
    const payload = {
      category_id: subParentId,
      name_es: subForm.name_es,
      name_en: subForm.name_en,
      sort_order: parseInt(subForm.sort_order, 10) || 1,
      is_active: subForm.is_active,
    };
    try {
      if (editingSubId) await updateSub.mutateAsync({ id: editingSubId, payload });
      else await createSub.mutateAsync(payload);
      setShowSubModal(false);
    } catch (err) {
      console.error(err);
    }
  }

  const inputClass = 'bg-surface-cream border border-border rounded-lg h-11 px-4 text-sm font-display text-ink w-full focus:outline-none focus:ring-2 focus:ring-brand/30';
  const labelClass = 'text-sm font-semibold text-ink mb-1.5 block font-display';
  const inputErrorClass = 'border-danger focus:ring-danger/20 focus:border-danger';
  const renderFieldError = (msg?: string) =>
    msg ? (
      <p role="alert" className="flex items-start gap-1.5 mt-1.5 text-[12px] text-danger font-display font-medium">
        <AlertCircle size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
        <span>{msg}</span>
      </p>
    ) : null;

  // subParentId is used by openAddSub / openEditSub — kept to avoid unused-var warning
  void subParentId;

  if (isLoading) return <TableSkeleton rows={8} cols={6} />;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">{t('categories.title')}</h1>
          <p className="text-sm text-muted mt-0.5">{t('categories.count', { count: categories?.length ?? 0 })}</p>
        </div>
        <button
          onClick={openAddCategory}
          className="h-[52px] px-5 bg-brand text-white rounded-xl text-sm font-semibold font-display hover:bg-brand-mid transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" strokeWidth={1.75} />
          {t('categories.newCategory')}
        </button>
      </div>

      {/* Pending from partners */}
      {partnerSubmissions && partnerSubmissions.length > 0 && (
        <div className="mb-6 rounded-xl border border-brand/30 bg-brand-mist/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Store size={16} strokeWidth={1.75} className="text-brand" />
            <h2 className="text-sm font-semibold font-display text-ink">
              Pending from partners
            </h2>
            <span className="text-xs text-muted font-body">
              · New categories submitted by vendors — approve to make them live
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {partnerSubmissions.map((s) => (
              <div
                key={s.id}
                className="inline-flex items-center gap-2 bg-card border border-border rounded-full pl-3 pr-1 py-1 shadow-sm"
              >
                {s.icon_url ? (
                  <img src={resolveImageUrl(s.icon_url, 'tile')} alt="" className="w-5 h-5 rounded-full object-cover" />
                ) : null}
                <span className="text-sm font-semibold font-display text-ink">{s.name_es}</span>
                <span className="text-[11px] text-muted font-body">
                  {s.submitted_by_store?.name ?? 'Unknown store'}
                </span>
                <button
                  onClick={() => handleApproveSubmission(s.id)}
                  disabled={approveSubmission.isPending}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-brand text-white text-xs font-semibold font-display hover:bg-brand-mid transition-colors disabled:opacity-50"
                  title="Approve — makes this category live"
                >
                  <Check size={12} strokeWidth={2} />
                  Approve
                </button>
                <button
                  onClick={() => openRejectSubmission(s)}
                  className="p-1 rounded-full hover:bg-surface-linen text-muted hover:text-danger transition-colors"
                  title="Reject"
                >
                  <X size={13} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Suggested from imports */}
      {pendingCategories && pendingCategories.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber/40 bg-amber-mist/40 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={16} strokeWidth={1.75} className="text-amber" />
            <h2 className="text-sm font-semibold font-display text-ink">
              Suggested from imports
            </h2>
            <span className="text-xs text-muted font-body">
              · Names that came in from a product upload but don't exist yet
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {pendingCategories.map((p) => (
              <div
                key={p.id}
                className="inline-flex items-center gap-2 bg-card border border-border rounded-full pl-3 pr-1 py-1 shadow-sm"
              >
                <span className="text-sm font-semibold font-display text-ink">{p.name}</span>
                <span className="text-[11px] text-muted font-mono">×{p.source_row_count}</span>
                <button
                  onClick={() => openAddFromPending(p)}
                  className="inline-flex items-center gap-1 h-9 sm:h-7 px-3 sm:px-2.5 rounded-full bg-brand text-white text-xs font-semibold font-display hover:bg-brand-mid transition-colors"
                  title="Promote to a real category"
                >
                  <Plus size={12} strokeWidth={2} />
                  Add
                </button>
                <button
                  onClick={() => handleDismissPending(p.id)}
                  disabled={dismissPending.isPending}
                  className="w-9 h-9 sm:w-auto sm:h-auto sm:p-1 inline-flex items-center justify-center rounded-full hover:bg-surface-linen text-muted hover:text-danger transition-colors disabled:opacity-50"
                  title="Dismiss"
                >
                  <X size={13} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table — and below sm a card per category (2026-11-05): the table
          needed 720px and put status and every action off to the right. */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <ul className="sm:hidden divide-y divide-border">
          {categories?.map((cat) => {
            const subs = cat.subcategories ?? subcategories?.filter((s) => s.category_id === cat.id) ?? [];
            return (
              <CatCard
                key={cat.id}
                cat={cat}
                subs={subs}
                isExpanded={expandedIds.has(cat.id)}
                onToggle={() => toggleExpand(cat.id)}
                onEdit={() => openEditCategory(cat)}
                onDelete={() => openDeleteCategory(cat)}
                onAddSub={() => openAddSub(cat.id)}
                onEditSub={openEditSub}
                onDeleteSub={openDeleteSub}
                onManageTypes={(sub) => setProductTypesFor({ sub, categoryName: cat.name_es })}
                onOpenPublishQueue={() => setPublishQueueFor(cat)}
              />
            );
          })}
        </ul>
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full min-w-[720px]">
          <thead>
            <tr className="bg-surface-cream">
              <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display w-10" />
              <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('categories.table.icon')}</th>
              <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('categories.table.nameEs')}</th>
              <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('categories.table.nameEn')}</th>
              <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('categories.table.order')}</th>
              <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('categories.table.subcategories')}</th>
              <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('categories.table.status')}</th>
              <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('categories.table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {categories?.map((cat) => {
              const isExpanded = expandedIds.has(cat.id);
              const subs = cat.subcategories ?? subcategories?.filter((s) => s.category_id === cat.id) ?? [];
              return (
                <CatRow
                  key={cat.id}
                  cat={cat}
                  subs={subs}
                  isExpanded={isExpanded}
                  onToggle={() => toggleExpand(cat.id)}
                  onEdit={() => openEditCategory(cat)}
                  onDelete={() => openDeleteCategory(cat)}
                  onAddSub={() => openAddSub(cat.id)}
                  onEditSub={openEditSub}
                  onDeleteSub={openDeleteSub}
                  onManageTypes={(sub) => setProductTypesFor({ sub, categoryName: cat.name_es })}
                  onOpenPublishQueue={() => setPublishQueueFor(cat)}
                />
              );
            })}
          </tbody>
        </table>
          </div>
      </div>

      {/* Category side panel — slides in from the right.
          Sticky header + sticky footer keep the close button and save CTAs
          visible no matter how tall the form (colour preview, image upload,
          etc.) grows. */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50 animate-[fadeIn_120ms_ease-out]"
            onClick={() => setShowModal(false)}
          />
          <div
            className="relative bg-card shadow-modal w-full max-w-[540px] h-full flex flex-col animate-[slideInRight_180ms_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sticky header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card shrink-0">
              <h3 className="text-lg font-bold font-display text-ink">
                {editingId ? t('categories.modal.editTitle') : t('categories.modal.newTitle')}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-lg hover:bg-surface-linen transition-colors"
                aria-label="Close"
              >
                <X size={18} strokeWidth={1.75} className="text-muted" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="space-y-4">
                <div>
                  <label className={labelClass}>{t('categories.modal.nameEs')}</label>
                  <input type="text" value={form.name_es} onChange={(e) => setForm({ ...form, name_es: e.target.value })} placeholder="Ej: Arroz" className={`${inputClass} ${formErrors.name_es ? inputErrorClass : ''}`} aria-invalid={!!formErrors.name_es} />
                  {renderFieldError(formErrors.name_es)}
                </div>
                <div>
                  <label className={labelClass}>{t('categories.modal.nameEn')}</label>
                  <input type="text" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} placeholder="Ej: Rice" className={`${inputClass} ${formErrors.name_en ? inputErrorClass : ''}`} aria-invalid={!!formErrors.name_en} />
                  {renderFieldError(formErrors.name_en)}
                </div>
                <div>
                  <CategoryIconField
                    value={form.icon_url}
                    onChange={(next) => setForm({ ...form, icon_url: next })}
                    label={t('categories.modal.iconUrl')}
                  />
                  {renderFieldError(formErrors.icon_url)}
                </div>

                <div>
                  <label className={labelClass}>{t('categories.modal.order')}</label>
                  <input type="number" min="1" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} className={`${inputClass} ${formErrors.sort_order ? inputErrorClass : ''}`} aria-invalid={!!formErrors.sort_order} />
                  {renderFieldError(formErrors.sort_order)}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold font-display text-ink">{t('categories.modal.active')}</span>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, is_active: !form.is_active })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.is_active ? 'bg-brand' : 'bg-border'}`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-card transition-transform ${form.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>
            </div>

            {/* Sticky footer */}
            <div className="flex gap-3 justify-end px-6 py-4 border-t border-border bg-card shrink-0">
              <button onClick={() => setShowModal(false)} className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors">{t('categories.modal.cancel')}</button>
              <button onClick={handleSaveCategory} className="h-11 px-5 rounded-xl text-sm font-semibold font-display bg-brand text-white hover:bg-brand-mid transition-colors">{editingId ? t('categories.modal.save') : t('categories.modal.create')}</button>
            </div>
          </div>
        </div>
      )}

      {/* SubCategory Modal */}
      {showSubModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowSubModal(false)}>
          <div className="bg-card rounded-2xl p-6 shadow-modal w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold font-display text-ink">{editingSubId ? t('categories.subModal.editTitle') : t('categories.subModal.newTitle')}</h3>
              <button onClick={() => setShowSubModal(false)} className="p-1.5 rounded-lg hover:bg-surface-linen transition-colors">
                <X size={18} strokeWidth={1.75} className="text-muted" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className={labelClass}>{t('categories.subModal.nameEs')}</label>
                <input type="text" value={subForm.name_es} onChange={(e) => setSubForm({ ...subForm, name_es: e.target.value })} className={`${inputClass} ${subFormErrors.name_es ? inputErrorClass : ''}`} aria-invalid={!!subFormErrors.name_es} />
                {renderFieldError(subFormErrors.name_es)}
              </div>
              <div>
                <label className={labelClass}>{t('categories.subModal.nameEn')}</label>
                <input type="text" value={subForm.name_en} onChange={(e) => setSubForm({ ...subForm, name_en: e.target.value })} className={`${inputClass} ${subFormErrors.name_en ? inputErrorClass : ''}`} aria-invalid={!!subFormErrors.name_en} />
                {renderFieldError(subFormErrors.name_en)}
              </div>
              <div>
                <label className={labelClass}>{t('categories.subModal.order')}</label>
                <input type="number" min="1" value={subForm.sort_order} onChange={(e) => setSubForm({ ...subForm, sort_order: e.target.value })} className={`${inputClass} ${subFormErrors.sort_order ? inputErrorClass : ''}`} aria-invalid={!!subFormErrors.sort_order} />
                {renderFieldError(subFormErrors.sort_order)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold font-display text-ink">{t('categories.subModal.active')}</span>
                <button
                  type="button"
                  onClick={() => setSubForm({ ...subForm, is_active: !subForm.is_active })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${subForm.is_active ? 'bg-brand' : 'bg-border'}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-card transition-transform ${subForm.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button onClick={() => setShowSubModal(false)} className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors">{t('categories.subModal.cancel')}</button>
              <button onClick={handleSaveSub} className="h-11 px-5 rounded-xl text-sm font-semibold font-display bg-brand text-white hover:bg-brand-mid transition-colors">{editingSubId ? t('categories.subModal.save') : t('categories.subModal.create')}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Delete Category Modal ──────────────────────── */}
      {deletePending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeletePending(null)}>
          <div className="bg-card rounded-2xl p-6 shadow-modal w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-danger-bg flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} strokeWidth={1.75} className="text-danger" />
              </div>
              <div>
                <h3 className="text-lg font-bold font-display text-ink">Delete category</h3>
                <p className="text-sm text-muted font-body mt-0.5">
                  Delete <span className="font-semibold text-ink">{deletePending.name}</span>?
                </p>
              </div>
            </div>

            {(() => {
              const otherCategories = categories?.filter((c) => c.id !== deletePending.id) ?? [];
              const noOtherCategories = otherCategories.length === 0;
              const isInactive = !categories?.find((c) => c.id === deletePending.id)?.is_active;

              if (deletePending.productCount === 0) {
                return (
                  <p className="text-sm text-gray font-body bg-surface-cream rounded-lg p-3 mb-4">
                    This category has no products. It will be deleted along with its subcategories.
                  </p>
                );
              }

              return (
                <>
                  <p className="text-sm text-gray font-body bg-amber-mist/50 border border-amber/30 rounded-lg p-3 mb-4">
                    This category has <strong>{deletePending.productCount} product(s)</strong>.
                    {noOtherCategories ? (
                      <> There are no other categories to move them to, so a hard delete isn't possible right now.</>
                    ) : (
                      <> Select another category to move the products to before deleting.</>
                    )}
                    <br />
                    <span className="text-xs text-muted">
                      (Subcategories will also be removed; products will lose their subcategory.)
                    </span>
                  </p>

                  {!noOtherCategories && (
                    <>
                      <label className="text-sm font-semibold font-display text-ink mb-1.5 block">
                        Move products to:
                      </label>
                      <select
                        value={reassignTo}
                        onChange={(e) => setReassignTo(e.target.value)}
                        className="bg-surface-cream border border-border rounded-lg h-11 px-4 text-sm font-display text-ink w-full focus:outline-none focus:ring-2 focus:ring-brand/30"
                      >
                        <option value="">— Select destination —</option>
                        {otherCategories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name_en || c.name_es}
                          </option>
                        ))}
                      </select>
                    </>
                  )}

                  {/* Deactivate-instead escape hatch */}
                  {!isInactive && (
                    <div className="mt-4 p-3 rounded-lg bg-surface-cream border border-border">
                      <p className="text-xs text-gray font-body mb-2">
                        <strong>Don't want to move the products?</strong> You can deactivate this category instead.
                        It stays in the database with all products attached, but is hidden from the customer site.
                      </p>
                      <button
                        type="button"
                        onClick={deactivateInsteadOfDelete}
                        disabled={updateCat.isPending}
                        className="text-xs font-semibold font-display text-brand hover:text-brand-mid disabled:opacity-50"
                      >
                        {updateCat.isPending ? 'Deactivating…' : 'Deactivate instead →'}
                      </button>
                    </div>
                  )}
                  {isInactive && (
                    <p className="text-xs text-muted font-body mt-3 italic">
                      This category is already deactivated.
                    </p>
                  )}
                </>
              );
            })()}

            {deleteError && (
              <p className="text-sm text-danger font-body mt-3">{deleteError}</p>
            )}

            <div className="flex gap-3 justify-end mt-6">
              <button
                onClick={() => setDeletePending(null)}
                className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteCategory}
                disabled={
                  deleteCat.isPending ||
                  (deletePending.productCount > 0 && !reassignTo)
                }
                className="h-11 px-5 rounded-xl text-sm font-semibold font-display bg-danger text-white hover:bg-danger/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleteCat.isPending ? '…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Publish Queued Products Modal ──────────────── */}
      <PublishPendingProductsModal
        open={!!publishQueueFor}
        category={publishQueueFor}
        onClose={() => setPublishQueueFor(null)}
      />

      {/* ─── Product Types Modal (third-tier taxonomy) ──── */}
      {productTypesFor && (
        <ProductTypesModal
          open
          subcategoryId={productTypesFor.sub.id}
          subcategoryName={productTypesFor.sub.name_es}
          categoryName={productTypesFor.categoryName}
          onClose={() => setProductTypesFor(null)}
        />
      )}

      {/* ─── Delete Subcategory Modal ───────────────────── */}
      {subDeletePending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSubDeletePending(null)}>
          <div className="bg-card rounded-2xl p-6 shadow-modal w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-danger-bg flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} strokeWidth={1.75} className="text-danger" />
              </div>
              <div>
                <h3 className="text-lg font-bold font-display text-ink">Delete subcategory</h3>
                <p className="text-sm text-muted font-body mt-0.5">
                  Delete <span className="font-semibold text-ink">{subDeletePending.name}</span>?
                </p>
              </div>
            </div>
            <p className="text-sm text-gray font-body bg-surface-cream rounded-lg p-3 mb-4">
              Associated products will lose this subcategory but will still belong to their parent category.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setSubDeletePending(null)}
                className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteSub}
                disabled={deleteSub.isPending}
                className="h-11 px-5 rounded-xl text-sm font-semibold font-display bg-danger text-white hover:bg-danger/90 transition-colors disabled:opacity-50"
              >
                {deleteSub.isPending ? '…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Reject Partner Submission Modal ────────────── */}
      {rejectingSubmission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setRejectingSubmission(null)}>
          <div className="bg-card rounded-2xl p-6 shadow-modal w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-danger-bg flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} strokeWidth={1.75} className="text-danger" />
              </div>
              <div>
                <h3 className="text-lg font-bold font-display text-ink">Reject category</h3>
                <p className="text-sm text-muted font-body mt-0.5">
                  Reject <span className="font-semibold text-ink">{rejectingSubmission.name}</span>?
                  The partner will see this reason.
                </p>
              </div>
            </div>
            <label className={labelClass}>Reason</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="e.g. Too similar to an existing category — use Spices instead."
              className={`${inputClass} h-auto py-2.5 resize-none mb-4`}
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setRejectingSubmission(null)}
                className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmRejectSubmission}
                disabled={rejectSubmission.isPending || !rejectReason.trim()}
                className="h-11 px-5 rounded-xl text-sm font-semibold font-display bg-danger text-white hover:bg-danger/90 transition-colors disabled:opacity-50"
              >
                {rejectSubmission.isPending ? '…' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Category Row ────────────────────────────────────────────

function CatRow({
  cat, subs, isExpanded, onToggle, onEdit, onDelete, onAddSub, onEditSub, onDeleteSub, onManageTypes, onOpenPublishQueue,
}: {
  cat: Category;
  subs: SubCategory[];
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddSub: () => void;
  onEditSub: (sub: SubCategory) => void;
  onDeleteSub: (sub: SubCategory) => void;
  onManageTypes: (sub: SubCategory) => void;
  onOpenPublishQueue: () => void;
}) {
  const { t } = useTranslation();
  const queued = cat.pending_products_count ?? 0;

  return (
    <>
      <tr className="border-t border-border hover:bg-brand-mist/30 transition-colors">
        <td className="px-4 py-3">
          <button onClick={onToggle} className="p-1 rounded hover:bg-surface-linen transition-colors">
            {isExpanded
              ? <ChevronDown size={16} strokeWidth={1.75} className="text-muted" />
              : <ChevronRight size={16} strokeWidth={1.75} className="text-muted" />
            }
          </button>
        </td>
        <td className="px-4 py-3">
          {cat.icon_url ? (
            <img src={resolveImageUrl(cat.icon_url, 'tile')} alt={cat.name_es} className="w-8 h-8 rounded-lg object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-surface-cream flex items-center justify-center">
              <Grid3X3 size={14} strokeWidth={1.75} className="text-muted" />
            </div>
          )}
        </td>
        <td className="px-4 py-3 text-sm font-medium text-ink font-display">{cat.name_es}</td>
        <td className="px-4 py-3 text-sm text-muted">{cat.name_en}</td>
        <td className="px-4 py-3 text-sm text-ink font-semibold">{cat.sort_order}</td>
        <td className="px-4 py-3 text-sm text-muted">{subs.length}</td>
        <td className="px-4 py-3">
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display ${cat.is_active ? 'bg-success-bg text-success' : 'bg-border text-muted'}`}>
            {cat.is_active ? t('categories.active') : t('categories.inactive')}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            {queued > 0 && (
              <button
                onClick={onOpenPublishQueue}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-amber-mist text-amber border border-amber/40 text-xs font-semibold font-display hover:bg-amber-mist/70 transition-colors"
                title={`${queued} product${queued === 1 ? '' : 's'} from a past import are queued for this category`}
              >
                <PackageOpen size={13} strokeWidth={2} />
                {queued} waiting
              </button>
            )}
            <button
              onClick={onAddSub}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-brand-mist text-brand text-xs font-semibold font-display hover:bg-brand-mist/70 transition-colors"
              title={t('categories.addSubcategory')}
            >
              <Plus size={13} strokeWidth={2} />
              {t('categories.addSubcategory')}
            </button>
            <button
              onClick={onEdit}
              className="p-2 rounded-lg hover:bg-surface-linen transition-colors"
              title={t('common.edit') || 'Editar'}
            >
              <Pencil size={15} strokeWidth={1.75} className="text-muted" />
            </button>
            <button
              onClick={onDelete}
              className="p-2 rounded-lg hover:bg-danger-bg transition-colors"
              title="Delete"
            >
              <Trash2 size={15} strokeWidth={1.75} className="text-danger" />
            </button>
          </div>
        </td>
      </tr>
      {isExpanded && subs.length > 0 && subs.map((sub) => (
        <tr key={sub.id} className="bg-surface-cream/50 border-t border-border/50">
          <td />
          <td className="px-4 py-2.5" />
          <td className="px-4 py-2.5 text-sm text-ink pl-8">↳ {sub.name_es}</td>
          <td className="px-4 py-2.5 text-sm text-muted">{sub.name_en}</td>
          <td className="px-4 py-2.5 text-sm text-muted">{sub.sort_order}</td>
          <td />
          <td className="px-4 py-2.5">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold font-display ${sub.is_active ? 'bg-success-bg text-success' : 'bg-border text-muted'}`}>
              {sub.is_active ? t('categories.active') : t('categories.inactive')}
            </span>
          </td>
          <td className="px-4 py-2.5">
            <div className="flex items-center gap-1">
              <button
                onClick={() => onManageTypes(sub)}
                className="inline-flex items-center gap-1 h-7 px-2 rounded-md bg-brand-mist text-brand text-[11px] font-semibold font-display hover:bg-brand-mist/70 transition-colors"
                title="Manage product types under this subcategory"
              >
                <Grid3X3 size={11} strokeWidth={2} />
                Types
              </button>
              <button onClick={() => onEditSub(sub)} className="p-1.5 rounded-lg hover:bg-surface-linen transition-colors" title="Editar">
                <Pencil size={13} strokeWidth={1.75} className="text-muted" />
              </button>
              <button onClick={() => onDeleteSub(sub)} className="p-1.5 rounded-lg hover:bg-danger-bg transition-colors" title="Delete">
                <Trash2 size={13} strokeWidth={1.75} className="text-danger" />
              </button>
            </div>
          </td>
        </tr>
      ))}
      {isExpanded && (
        <tr className="bg-surface-cream/30 border-t border-border/30">
          <td colSpan={8} className="px-4 py-2">
            <button onClick={onAddSub} className="text-xs font-semibold font-display text-brand hover:text-brand-mid flex items-center gap-1.5 pl-8 transition-colors">
              <Plus size={13} strokeWidth={2} />
              {t('categories.addSubcategory')}
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * A category on a phone — the same data and callbacks as CatRow, laid out as
 * a card (2026-11-05). Name and status first, the actions as thumb-sized
 * buttons under it, and the subcategories folding open beneath.
 */
function CatCard({
  cat, subs, isExpanded, onToggle, onEdit, onDelete, onAddSub, onEditSub, onDeleteSub, onManageTypes, onOpenPublishQueue,
}: Parameters<typeof CatRow>[0]) {
  const { t } = useTranslation();
  const queued = cat.pending_products_count ?? 0;
  const pill = (on: boolean) => `inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold font-display shrink-0 ${on ? 'bg-success-bg text-success' : 'bg-border text-muted'}`;
  return (
    <li>
      <div className="flex items-center gap-2.5 px-3 pt-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-label={cat.name_es}
          className="w-9 h-9 -ml-1 rounded-lg flex items-center justify-center text-muted active:bg-surface-linen shrink-0"
        >
          {isExpanded ? <ChevronDown size={18} strokeWidth={1.75} /> : <ChevronRight size={18} strokeWidth={1.75} />}
        </button>
        {cat.icon_url ? (
          <img src={resolveImageUrl(cat.icon_url, 'tile')} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
        ) : (
          <span className="w-10 h-10 rounded-lg bg-surface-cream flex items-center justify-center shrink-0">
            <Grid3X3 size={16} strokeWidth={1.75} className="text-muted" />
          </span>
        )}
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <span className="block text-sm font-semibold text-ink font-display truncate">{cat.name_es}</span>
          <span className="block text-xs text-muted truncate">
            {cat.name_en} · #{cat.sort_order} · {t('categories.subCount', '{{n}} subcategories', { n: subs.length })}
          </span>
        </button>
        <span className={pill(!!cat.is_active)}>{cat.is_active ? t('categories.active') : t('categories.inactive')}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-3 pt-2 pl-[3.25rem]">
        {queued > 0 && (
          <button
            type="button"
            onClick={onOpenPublishQueue}
            className="inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-amber-mist text-amber border border-amber/40 text-xs font-semibold font-display"
          >
            <PackageOpen size={14} strokeWidth={2} />
            {queued} waiting
          </button>
        )}
        <button
          type="button"
          onClick={onAddSub}
          className="inline-flex items-center gap-1 h-9 px-3 rounded-lg bg-brand-mist text-brand text-xs font-semibold font-display"
        >
          <Plus size={14} strokeWidth={2} />
          {t('categories.addSubcategory')}
        </button>
        <span className="flex-1" />
        <button type="button" onClick={onEdit} aria-label={t('common.edit', 'Edit')} className="w-9 h-9 rounded-lg border border-border flex items-center justify-center active:bg-surface-linen">
          <Pencil size={15} strokeWidth={1.75} className="text-muted" />
        </button>
        <button type="button" onClick={onDelete} aria-label={t('common.delete', 'Delete')} className="w-9 h-9 rounded-lg border border-border flex items-center justify-center active:bg-danger-bg">
          <Trash2 size={15} strokeWidth={1.75} className="text-danger" />
        </button>
      </div>
      {isExpanded && (
        <ul className="bg-surface-cream/50 border-t border-border/60 divide-y divide-border/50">
          {subs.map((sub) => (
            <li key={sub.id} className="flex items-center gap-2 pl-[3.25rem] pr-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-ink truncate">{sub.name_es}</span>
                <span className="block text-xs text-muted truncate">{sub.name_en} · #{sub.sort_order}</span>
              </span>
              <span className={pill(!!sub.is_active)}>{sub.is_active ? t('categories.active') : t('categories.inactive')}</span>
              <button
                type="button"
                onClick={() => onManageTypes(sub)}
                className="inline-flex items-center gap-1 h-9 px-2.5 rounded-lg bg-brand-mist text-brand text-xs font-semibold font-display shrink-0"
              >
                <Grid3X3 size={13} strokeWidth={2} />
                Types
              </button>
              <button type="button" onClick={() => onEditSub(sub)} aria-label={t('common.edit', 'Edit')} className="w-9 h-9 rounded-lg flex items-center justify-center active:bg-surface-linen shrink-0">
                <Pencil size={14} strokeWidth={1.75} className="text-muted" />
              </button>
              <button type="button" onClick={() => onDeleteSub(sub)} aria-label={t('common.delete', 'Delete')} className="w-9 h-9 rounded-lg flex items-center justify-center active:bg-danger-bg shrink-0">
                <Trash2 size={14} strokeWidth={1.75} className="text-danger" />
              </button>
            </li>
          ))}
          <li className="pl-[3.25rem] pr-3 py-1">
            <button type="button" onClick={onAddSub} className="h-10 text-xs font-semibold font-display text-brand flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2} />
              {t('categories.addSubcategory')}
            </button>
          </li>
        </ul>
      )}
    </li>
  );
}

// ── Category icon picker (URL paste OR file upload) ─────────
// File mode pushes the image through adminUploads.uploadImage('categories', ...)
// which posts to the API, and the API stores to Bunny or to local disk. The
// value stored on the form is always a URL (a b-cdn.net URL or /uploads/...),
// never a base64 blob, so the DB stays slim.

function CategoryIconField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'url' | 'file'>('url');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFile(file: File | null) {
    if (!file) return;
    setUploadError(null);
    if (!file.type.startsWith('image/')) {
      setUploadError('File must be an image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('Image too large (max 5 MB).');
      return;
    }
    setUploading(true);
    try {
      const res = await adminUploads.uploadImage('categories', file);
      onChange(res.url);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  const previewSrc = value ? resolveImageUrl(value, 'tile') : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-sm font-semibold text-ink block font-display">{label}</label>
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-[11px] font-semibold font-display">
          <button
            type="button"
            onClick={() => setMode('url')}
            className={`px-2.5 py-1 flex items-center gap-1 ${
              mode === 'url' ? 'bg-brand text-white' : 'bg-card text-gray hover:bg-surface-linen'
            }`}
          >
            <LinkIcon size={11} strokeWidth={2.25} /> URL
          </button>
          <button
            type="button"
            onClick={() => setMode('file')}
            className={`px-2.5 py-1 flex items-center gap-1 ${
              mode === 'file' ? 'bg-brand text-white' : 'bg-card text-gray hover:bg-surface-linen'
            }`}
          >
            <Upload size={11} strokeWidth={2.25} /> Upload
          </button>
        </div>
      </div>

      {mode === 'url' ? (
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://..."
          className="bg-surface-cream border border-border rounded-lg h-11 px-4 text-sm font-display text-ink w-full focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
      ) : (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFile(e.dataTransfer.files?.[0] ?? null);
          }}
          className="flex items-center gap-3 bg-surface-cream border border-dashed border-border rounded-lg p-3"
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="h-9 px-3 rounded-lg text-xs font-semibold font-display border-2 border-brand text-brand hover:bg-brand-mist transition-colors flex items-center gap-1.5 shrink-0 disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 size={13} strokeWidth={2} className="animate-spin" /> Uploading…
              </>
            ) : (
              <>
                <Upload size={13} strokeWidth={2} /> Choose file
              </>
            )}
          </button>
          <span className="text-xs text-muted font-display flex-1 truncate">
            or drag &amp; drop here · max 5 MB
          </span>
        </div>
      )}

      {previewSrc && (
        <div className="mt-2 flex items-center gap-3">
          <div className="w-14 h-14 rounded-lg overflow-hidden border border-border bg-surface-cream shrink-0">
            <img src={previewSrc} alt="" className="w-full h-full object-cover" />
          </div>
          <span className="text-[11px] text-muted font-display flex-1 truncate">{value}</span>
          <button
            type="button"
            onClick={() => onChange('')}
            className="p-1.5 rounded-lg hover:bg-surface-linen text-muted hover:text-danger transition-colors"
            aria-label="Remove image"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      )}

      {uploadError && <p className="mt-2 text-xs text-danger font-display">{uploadError}</p>}
    </div>
  );
}

