import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Plus, Pencil, Trash2, FileText, FolderOpen, Eye, EyeOff, ChevronDown, ChevronRight,
} from 'lucide-react';
import {
  useAdminHelpCategories,
  useAdminHelpArticles,
  useDeleteHelpCategory,
  useDeleteHelpArticle,
  useUpdateHelpCategory,
  useUpdateHelpArticle,
} from '@grocery-app/shared';
import type { HelpArticle, HelpCategory } from '@grocery-app/shared';
import ConfirmModal from '@/components/ConfirmModal';
import EmptyState from '@/components/EmptyState';

/* ─────────────────────────────────────────────────────────
   Help Center admin
   - Top: list of categories (collapsible) with their articles
   - "+ New category" and "+ New article" buttons
   - Edit / delete / toggle-active inline
   - Forms live at /help-center/categories[/:id/edit]
                   /help-center/articles[/:id/edit]
   ───────────────────────────────────────────────────────── */

interface DeleteTarget { kind: 'category' | 'article'; id: string; name: string }

export default function HelpCenterPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language === 'es' ? 'es' : 'en';

  const { data: categories, isLoading: catsLoading } = useAdminHelpCategories();
  const { data: articles, isLoading: artsLoading } = useAdminHelpArticles();

  const updateCategory = useUpdateHelpCategory();
  const updateArticle = useUpdateHelpArticle();
  const deleteCategory = useDeleteHelpCategory();
  const deleteArticle = useDeleteHelpArticle();

  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  // Group articles by category for quick lookup.
  const articlesByCat = useMemo(() => {
    const map: Record<string, HelpArticle[]> = {};
    (articles ?? []).forEach((a) => {
      if (!map[a.category_id]) map[a.category_id] = [];
      map[a.category_id].push(a);
    });
    return map;
  }, [articles]);

  const isLoading = catsLoading || artsLoading;

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.kind === 'category') {
        await deleteCategory.mutateAsync(deleteTarget.id);
      } else {
        await deleteArticle.mutateAsync(deleteTarget.id);
      }
    } catch (err) { console.error(err); }
    setDeleteTarget(null);
  }

  function toggleCat(id: string) {
    setOpenCats((s) => ({ ...s, [id]: !s[id] }));
  }

  function toggleCategoryActive(cat: HelpCategory) {
    updateCategory.mutate({
      id: cat.id,
      payload: {
        slug: cat.slug,
        title_en: cat.title_en,
        title_es: cat.title_es,
        icon: cat.icon,
        sort_order: cat.sort_order,
        is_active: !cat.is_active,
      },
    });
  }

  function toggleArticleActive(art: HelpArticle) {
    updateArticle.mutate({
      id: art.id,
      payload: {
        category_id: art.category_id,
        slug: art.slug,
        title_en: art.title_en,
        title_es: art.title_es,
        body_en: art.body_en,
        body_es: art.body_es,
        sort_order: art.sort_order,
        is_active: !art.is_active,
      },
    });
  }

  // ── Loading ──────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-0">
        <div className="flex items-center justify-between mb-8">
          <div className="h-8 w-48 bg-surface-cream rounded-lg animate-pulse" />
          <div className="flex gap-3">
            <div className="h-11 w-36 bg-surface-cream rounded-xl animate-pulse" />
            <div className="h-11 w-36 bg-surface-cream rounded-xl animate-pulse" />
          </div>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-surface-cream rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">{t('helpCenter.title')}</h1>
          <p className="text-sm text-muted font-display mt-1">{t('helpCenter.subtitle')}</p>
        </div>
        {/* On a phone (2026-11-05) the two share one full-width row. */}
        <div className="flex gap-3 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => navigate('/help-center/categories/new')}
            className="flex-1 sm:flex-none h-[52px] px-5 border-2 border-brand text-brand rounded-xl text-sm font-semibold font-display hover:bg-brand-mist transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" strokeWidth={1.75} />
            {t('helpCenter.newCategory')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/help-center/articles/new')}
            className="flex-1 sm:flex-none h-[52px] px-5 bg-brand text-white rounded-xl text-sm font-semibold font-display hover:bg-brand-mid transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" strokeWidth={1.75} />
            {t('helpCenter.newArticle')}
          </button>
        </div>
      </div>

      {/* Empty state */}
      {!categories || categories.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="w-12 h-12 text-muted" strokeWidth={1.5} />}
          title={t('helpCenter.empty.title')}
          description={t('helpCenter.empty.desc')}
          action={{ label: t('helpCenter.newCategory'), onClick: () => navigate('/help-center/categories/new') }}
        />
      ) : (
        <div className="space-y-3">
          {categories.map((cat) => {
            const catArticles = articlesByCat[cat.id] ?? [];
            const isOpen = openCats[cat.id] ?? true;
            const title = (lang === 'es' ? cat.title_es : cat.title_en) || cat.slug;

            return (
              <div key={cat.id} className="bg-card rounded-xl border border-border overflow-hidden">
                {/* Category header. ON A PHONE (2026-11-05) the actions take a
                    second row (their wrapper is `contents` from sm, so the
                    desktop row is unchanged): in one row at 390px they left
                    the title no width at all. Buttons are 36px there. */}
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 p-4 border-b border-border bg-surface-cream/40">
                  <button
                    type="button"
                    onClick={() => toggleCat(cat.id)}
                    className="w-9 h-9 -mx-[9px] -my-2 sm:w-auto sm:h-auto sm:m-0 inline-flex items-center justify-center shrink-0 text-muted hover:text-ink"
                    aria-label={isOpen ? 'Collapse' : 'Expand'}
                  >
                    {isOpen ? <ChevronDown size={18} strokeWidth={2} /> : <ChevronRight size={18} strokeWidth={2} />}
                  </button>
                  <FolderOpen className="w-5 h-5 text-brand shrink-0" strokeWidth={1.75} />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-bold font-display text-ink truncate">{title}</h3>
                    <p className="text-xs text-muted font-display mt-0.5">
                      <span className="font-mono">/{cat.slug}</span> · {catArticles.length} {t('helpCenter.articles')}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold font-display ${
                      cat.is_active ? 'bg-success-bg text-success' : 'bg-border text-muted'
                    }`}
                  >
                    {cat.is_active ? t('common.active') : t('common.inactive')}
                  </span>
                  <div className="w-full sm:contents flex items-center gap-2 pl-[3.875rem]">
                  <button
                    type="button"
                    onClick={() => toggleCategoryActive(cat)}
                    className={`w-9 h-9 sm:w-auto sm:h-auto sm:p-2 inline-flex items-center justify-center shrink-0 rounded-lg transition-colors ${
                      cat.is_active ? 'hover:bg-surface-linen text-muted' : 'hover:bg-brand-mist text-brand'
                    }`}
                    title={cat.is_active ? t('common.inactive') : t('common.active')}
                  >
                    {cat.is_active ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
                  </button>
                  <span className="flex-1 sm:hidden" />
                  <button
                    type="button"
                    onClick={() => navigate(`/help-center/categories/${cat.id}/edit`)}
                    className="h-9 px-3 rounded-lg text-sm font-semibold font-display border-2 border-brand text-brand hover:bg-brand-mist transition-colors flex items-center gap-1.5"
                  >
                    <Pencil className="w-3.5 h-3.5" strokeWidth={1.75} />
                    {t('common.edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget({ kind: 'category', id: cat.id, name: title })}
                    className="h-9 px-3 rounded-lg text-sm font-semibold font-display border-2 border-danger text-danger hover:bg-danger-bg transition-colors flex items-center gap-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                    {t('common.delete')}
                  </button>
                  </div>
                </div>

                {/* Article rows */}
                {isOpen && (
                  <div>
                    {catArticles.length === 0 ? (
                      <div className="p-6 text-center text-sm text-muted font-display">
                        {t('helpCenter.noArticles')}
                      </div>
                    ) : (
                      <ul className="divide-y divide-border">
                        {catArticles.map((art) => {
                          const artTitle = (lang === 'es' ? art.title_es : art.title_en) || art.slug;
                          return (
                            // Same as the category header on a phone: the
                            // actions wrap to a second row (2026-11-05).
                            <li key={art.id} className="flex flex-wrap sm:flex-nowrap items-center gap-3 px-4 py-3 hover:bg-surface-cream/40 transition-colors">
                              <FileText className="w-4 h-4 text-muted shrink-0" strokeWidth={1.75} />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold font-display text-ink truncate">{artTitle}</p>
                                <p className="text-xs text-muted font-display mt-0.5 font-mono truncate">/{art.slug}</p>
                              </div>
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold font-display ${
                                  art.is_active ? 'bg-success-bg text-success' : 'bg-border text-muted'
                                }`}
                              >
                                {art.is_active ? t('common.active') : t('common.inactive')}
                              </span>
                              <div className="w-full sm:contents flex items-center gap-2 pl-7">
                              <button
                                type="button"
                                onClick={() => toggleArticleActive(art)}
                                className={`w-9 h-9 sm:w-auto sm:h-auto sm:p-1.5 inline-flex items-center justify-center shrink-0 rounded transition-colors ${
                                  art.is_active ? 'hover:bg-surface-linen text-muted' : 'hover:bg-brand-mist text-brand'
                                }`}
                                title={art.is_active ? t('common.inactive') : t('common.active')}
                              >
                                {art.is_active ? <EyeOff size={14} strokeWidth={1.75} /> : <Eye size={14} strokeWidth={1.75} />}
                              </button>
                              <span className="flex-1 sm:hidden" />
                              <button
                                type="button"
                                onClick={() => navigate(`/help-center/articles/${art.id}/edit`)}
                                className="h-9 sm:h-8 px-2.5 rounded text-xs font-semibold font-display text-brand hover:bg-brand-mist transition-colors flex items-center gap-1"
                              >
                                <Pencil className="w-3 h-3" strokeWidth={1.75} />
                                {t('common.edit')}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget({ kind: 'article', id: art.id, name: artTitle })}
                                className="h-9 sm:h-8 px-2.5 rounded text-xs font-semibold font-display text-danger hover:bg-danger-bg transition-colors flex items-center gap-1"
                              >
                                <Trash2 className="w-3 h-3" strokeWidth={1.75} />
                                {t('common.delete')}
                              </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        title={
          deleteTarget?.kind === 'category'
            ? t('helpCenter.deleteCategoryTitle')
            : t('helpCenter.deleteArticleTitle')
        }
        message={
          deleteTarget?.kind === 'category'
            ? t('helpCenter.deleteCategoryMsg', { name: deleteTarget?.name })
            : t('helpCenter.deleteArticleMsg', { name: deleteTarget?.name })
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
