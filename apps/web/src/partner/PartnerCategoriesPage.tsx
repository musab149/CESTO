import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Grid3X3, Search, ChevronDown, ChevronRight, Package, Info, Plus, X, Clock, CheckCircle2, XCircle,
} from 'lucide-react';
import {
  usePartnerCategories,
  usePartnerSubcategories,
  usePartnerProductTypes,
  usePartnerMyCategories,
  useCreatePartnerCategory,
  useDismissPartnerCategorySubmission,
  resolveImageUrl,
  type PartnerCategory,
  type PartnerSubcategory,
  type PartnerCategorySubmission,
} from '@grocery-app/shared';

/**
 * Browse of the global Cesto taxonomy, plus the ability to request a new
 * category. Partners pick subcategories and product types FROM the curated
 * list as before — those stay admin-only to create. Categories are the one
 * exception (Ground Rule 9 carve-out, docs/MULTIVENDOR_ROADMAP.md): a
 * partner can submit one, but it only appears in the picker below (and
 * everywhere else) once an admin approves it from the Cesto panel.
 *
 * Structure mirrors admin's CategoriesPage.tsx: collapsible category
 * cards → expand to subcategories → expand to product types. Every row
 * has a "View products" shortcut that jumps to /partner/products with
 * the matching filter pre-applied.
 */
export default function PartnerCategoriesPage() {
  const { data: categories = [], isLoading } = usePartnerCategories();
  const { data: mine = [] } = usePartnerMyCategories();
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showRequestForm, setShowRequestForm] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return categories;
    return categories.filter((c) =>
      c.name_es.toLowerCase().includes(needle) || c.name_en.toLowerCase().includes(needle),
    );
  }, [categories, q]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold font-display text-ink inline-flex items-center gap-2">
            <Grid3X3 size={22} strokeWidth={1.75} />
            Categories
            {!isLoading && (
              <span className="text-base font-normal text-muted ml-2">({categories.length})</span>
            )}
          </h1>
          <p className="text-sm text-muted font-body mt-1">
            The Cesto-wide taxonomy your products get filed under. Admin curates the list — pick from it when adding products, or request a new one below.
          </p>
        </div>
        <button
          onClick={() => setShowRequestForm(true)}
          className="h-[52px] px-5 bg-brand text-white rounded-xl text-sm font-semibold font-display hover:bg-brand-mid transition-colors flex items-center gap-2 shrink-0"
        >
          <Plus className="w-4 h-4" strokeWidth={1.75} />
          Request new category
        </button>
      </div>

      {/* Curation nudge — subcategories/product types stay admin-only */}
      <div className="bg-info-bg border border-info/30 rounded-xl p-3 mb-6 flex items-start gap-3">
        <Info size={18} strokeWidth={1.75} className="text-info shrink-0 mt-0.5" />
        <p className="text-sm text-ink font-body">
          Need a subcategory or product type added under an existing category? Contact your Cesto admin. New top-level categories can be requested above and go live once approved.
        </p>
      </div>

      {mine.length > 0 && <MySubmissions submissions={mine} />}

      {showRequestForm && <RequestCategoryModal onClose={() => setShowRequestForm(false)} />}

      {/* Search */}
      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" strokeWidth={1.75} />
        <input
          type="text"
          placeholder="Search categories…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full bg-surface-cream border border-border rounded-lg h-11 pl-10 pr-4 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
      </div>

      {isLoading ? (
        <div className="text-center text-sm text-muted py-8">Loading categories…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-8 text-center">
          <Package className="w-10 h-10 text-muted mx-auto mb-2" strokeWidth={1.5} />
          <p className="text-sm text-muted font-body">
            No categories match "{q}".
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((cat) => (
            <CategoryRow
              key={cat.id}
              category={cat}
              expanded={expanded.has(cat.id)}
              onToggle={() => toggle(cat.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryRow({
  category, expanded, onToggle,
}: {
  category: PartnerCategory;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Only fire the subcategory query when the row is expanded — keeps the
  // categories page cheap on first render.
  const { data: subs = [] } = usePartnerSubcategories(expanded ? category.id : undefined);

  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        <button
          type="button"
          onClick={onToggle}
          className="w-8 h-8 rounded-lg bg-surface-cream hover:bg-brand-mist flex items-center justify-center transition shrink-0"
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded
            ? <ChevronDown className="w-4 h-4 text-ink" strokeWidth={1.75} />
            : <ChevronRight className="w-4 h-4 text-ink" strokeWidth={1.75} />}
        </button>
        {category.icon_url ? (
          <img
            src={resolveImageUrl(category.icon_url, 'tile') ?? ''}
            alt=""
            className="w-10 h-10 rounded-lg object-cover border border-border shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-brand-mist flex items-center justify-center shrink-0">
            <Grid3X3 className="w-5 h-5 text-brand" strokeWidth={1.75} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{category.name_es}</p>
          <p className="text-xs text-muted font-body">{category.name_en}</p>
        </div>
        <Link
          to={`/partner/products?category=${category.id}`}
          className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-brand hover:bg-brand-mid text-white font-semibold text-xs transition"
          title="View your products under this category"
        >
          <Package className="w-3.5 h-3.5" strokeWidth={1.75} />
          View products
        </Link>
      </div>

      {expanded && (
        <div className="border-t border-border bg-surface-linen/30 p-4">
          {subs.length === 0 ? (
            <p className="text-xs text-muted font-body italic">
              No subcategories under this category yet.
            </p>
          ) : (
            <div className="space-y-2">
              {subs.map((sub) => (
                <SubcategoryRow key={sub.id} sub={sub} categoryId={category.id} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SubcategoryRow({ sub, categoryId }: { sub: PartnerSubcategory; categoryId: string }) {
  const [expanded, setExpanded] = useState(false);
  const { data: types = [] } = usePartnerProductTypes(expanded ? sub.id : undefined);

  return (
    <div className="bg-white rounded-lg border border-border">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-7 h-7 rounded-md bg-surface-cream hover:bg-brand-mist flex items-center justify-center transition shrink-0"
        >
          {expanded
            ? <ChevronDown className="w-3.5 h-3.5 text-ink" strokeWidth={1.75} />
            : <ChevronRight className="w-3.5 h-3.5 text-ink" strokeWidth={1.75} />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink">{sub.name_es}</p>
          <p className="text-[11px] text-muted font-body">{sub.name_en}</p>
        </div>
        <Link
          to={`/partner/products?category=${categoryId}&sub=${sub.id}`}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-surface-cream hover:bg-brand-mist text-ink font-semibold text-[11px] transition"
        >
          <Package className="w-3 h-3" strokeWidth={1.75} />
          Products
        </Link>
      </div>
      {expanded && (
        <div className="border-t border-border bg-surface-linen/50 px-3 py-2">
          {types.length === 0 ? (
            <p className="text-[11px] text-muted font-body italic pl-1">
              No product types under this subcategory.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {types.map((t) => (
                <Link
                  key={t.id}
                  to={`/partner/products?category=${categoryId}&sub=${sub.id}&type=${t.id}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-cream border border-border text-[11px] text-ink hover:border-brand hover:bg-brand-mist transition"
                >
                  {t.name_es}
                  <span className="text-[10px] text-muted">· {t.name_en}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MySubmissions({ submissions }: { submissions: PartnerCategorySubmission[] }) {
  const dismiss = useDismissPartnerCategorySubmission();

  return (
    <div className="mb-6 rounded-xl border border-border bg-surface-cream p-4">
      <h2 className="text-sm font-semibold font-display text-ink mb-3">
        Your category requests
      </h2>
      <div className="flex flex-wrap gap-2">
        {submissions.map((s) => (
          <div
            key={s.id}
            className="inline-flex items-center gap-2 bg-white border border-border rounded-full pl-3 pr-1 py-1 shadow-sm"
            title={s.approval_status === 'rejected' && s.rejection_reason ? s.rejection_reason : undefined}
          >
            <span className="text-sm font-semibold font-display text-ink">{s.name_es}</span>
            <StatusPill status={s.approval_status} />
            <button
              onClick={() => dismiss.mutate(s.id)}
              disabled={dismiss.isPending}
              className="p-1 rounded-full hover:bg-surface-linen text-muted hover:text-danger transition-colors disabled:opacity-50"
              title="Dismiss"
            >
              <X size={13} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: PartnerCategorySubmission['approval_status'] }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold font-display bg-success-bg text-success">
        <CheckCircle2 size={11} strokeWidth={2} /> Live
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold font-display bg-danger-bg text-danger">
        <XCircle size={11} strokeWidth={2} /> Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold font-display bg-amber-mist text-amber">
      <Clock size={11} strokeWidth={2} /> Pending review
    </span>
  );
}

function RequestCategoryModal({ onClose }: { onClose: () => void }) {
  const createCategory = useCreatePartnerCategory();
  const [nameEs, setNameEs] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [error, setError] = useState<string | null>(null);

  const inputClass = 'w-full h-11 px-4 bg-surface-cream border border-border rounded-lg text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition';
  const labelClass = 'block text-sm font-semibold text-ink mb-1.5';

  async function handleSubmit() {
    setError(null);
    if (!nameEs.trim() || !nameEn.trim()) {
      setError('Both names are required.');
      return;
    }
    try {
      await createCategory.mutateAsync({ name_es: nameEs.trim(), name_en: nameEn.trim() });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit the category.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 shadow-modal w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold font-display text-ink">Request new category</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-linen transition-colors">
            <X size={18} strokeWidth={1.75} className="text-muted" />
          </button>
        </div>
        <p className="text-sm text-muted font-body mb-4">
          Cesto admin reviews every request before it goes live. You'll see the status here once submitted.
        </p>
        <div className="space-y-4">
          <div>
            <label className={labelClass}>Name (Spanish)</label>
            <input
              type="text"
              value={nameEs}
              onChange={(e) => setNameEs(e.target.value)}
              placeholder="e.g. Especias y Condimentos"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Name (English)</label>
            <input
              type="text"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder="e.g. Spices and Condiments"
              className={inputClass}
            />
          </div>
          {error && (
            <div className="bg-danger-bg border border-danger/30 rounded-lg px-3 py-2 text-sm text-danger font-body">{error}</div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="h-11 px-5 rounded-xl border-2 border-border text-gray text-sm font-semibold hover:bg-surface-linen transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={createCategory.isPending}
            className="h-11 px-6 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-mid transition disabled:opacity-50"
          >
            {createCategory.isPending ? '…' : 'Submit request'}
          </button>
        </div>
      </div>
    </div>
  );
}
