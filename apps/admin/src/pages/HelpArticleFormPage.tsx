import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useGoBack } from '@/lib/useGoBack';
import { useTranslation } from 'react-i18next';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Save, Eye, Code } from 'lucide-react';
import {
  useAdminHelpArticle,
  useAdminHelpCategories,
  useCreateHelpArticle,
  useUpdateHelpArticle,
} from '@grocery-app/shared';
import type { HelpArticle } from '@grocery-app/shared';
import { useToast } from '@/components/Toast';
import BackLink from '@/components/BackLink';
import { TextField, Textarea, Select, Checkbox } from '@/components/form';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';

type Lang = 'en' | 'es';

interface FormState {
  category_id: string;
  slug: string;
  title_en: string;
  title_es: string;
  body_en: string;
  body_es: string;
  sort_order: string;
  is_active: boolean;
}

const empty: FormState = {
  category_id: '', slug: '', title_en: '', title_es: '',
  body_en: '', body_es: '', sort_order: '1', is_active: true,
};

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function articleToForm(a: HelpArticle): FormState {
  return {
    category_id: a.category_id,
    slug: a.slug,
    title_en: a.title_en,
    title_es: a.title_es,
    body_en: a.body_en ?? '',
    body_es: a.body_es ?? '',
    sort_order: String(a.sort_order),
    is_active: a.is_active,
  };
}

/* Lightweight inline markdown preview — kept admin-bundle small. */

// Whitelist URL schemes that are safe as an href in a rendered preview.
// javascript: / data: / vbscript: are the classic self-XSS vectors here —
// [click](javascript:alert(1)) would otherwise execute on admin origin.
function safeHref(raw: string): string {
  const url = raw.trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (/^mailto:/i.test(url)) return url;
  // Relative path (in-admin link); reject protocol-relative //x to avoid open-redirect.
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  return '#';
}

// Escape only the characters that let a URL break out of a "" attribute.
function attrEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function previewMarkdown(src: string): string {
  if (!src) return '';
  let html = src
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
    return `<a href="${attrEscape(safeHref(url))}" rel="noopener noreferrer">${text}</a>`;
  });
  html = html.replace(/(?:^|\n)((?:- .+(?:\n|$))+)/g, (_m, block) => {
    const items = block.trim().split('\n').map((l: string) => `<li>${l.replace(/^- /, '')}</li>`).join('');
    return `\n<ul>${items}</ul>`;
  });
  html = html
    .split(/\n{2,}/)
    .map((chunk: string) =>
      chunk.startsWith('<h') || chunk.startsWith('<ul') ? chunk : `<p>${chunk.replace(/\n/g, '<br/>')}</p>`,
    )
    .join('\n');
  return html;
}

export default function HelpArticleFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const toast = useToast();
  const { articleId } = useParams<{ articleId: string }>();
  const [searchParams] = useSearchParams();
  const editing = Boolean(articleId);
  const messages = useValidationMessages();

  const { data: existing, isLoading: loadingArticle } = useAdminHelpArticle(articleId);
  const { data: categories } = useAdminHelpCategories();
  const createArticle = useCreateHelpArticle();
  const updateArticle = useUpdateHelpArticle();

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      category_id: z.string().min(1, messages.required),
      slug:        r.slug(),
      title_en:    r.name({ min: 2, max: 120 }),
      title_es:    r.name({ min: 2, max: 120 }),
      body_en:     r.optionalLongText(20000),
      body_es:     r.optionalLongText(20000),
      sort_order:  z.coerce.number().int().nonnegative(messages.positive),
      is_active:   z.boolean(),
    });
  }, [messages]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormState>({
    resolver: zodResolver(schema) as unknown as Resolver<FormState>,
    mode: 'onBlur',
    defaultValues: empty,
  });

  const [autoSlug, setAutoSlug] = useState(!editing);
  const [previewLang, setPreviewLang] = useState<Lang | null>(null);
  const titleEn = watch('title_en');
  const bodyEn = watch('body_en');
  const bodyEs = watch('body_es');
  const categoryId = watch('category_id');

  useEffect(() => {
    if (editing && existing) reset(articleToForm(existing));
    if (!editing) {
      const preset = searchParams.get('category');
      if (preset) setValue('category_id', preset, { shouldValidate: false });
    }
  }, [editing, existing, searchParams, reset, setValue]);

  useEffect(() => {
    if (autoSlug && titleEn) {
      setValue('slug', slugify(titleEn), { shouldValidate: false });
    }
  }, [titleEn, autoSlug, setValue]);

  // Default category to first available when creating, unless already set.
  useEffect(() => {
    if (!editing && !categoryId && categories?.length) {
      setValue('category_id', categories[0].id, { shouldValidate: false });
    }
  }, [editing, categoryId, categories, setValue]);

  const onSubmit = async (values: FormState) => {
    const payload = {
      category_id: values.category_id,
      slug: values.slug,
      title_en: values.title_en,
      title_es: values.title_es,
      body_en: values.body_en,
      body_es: values.body_es,
      sort_order: Number(values.sort_order) || 0,
      is_active: values.is_active,
    };
    try {
      if (editing && articleId) {
        await updateArticle.mutateAsync({ id: articleId, payload });
        toast.success(t('helpCenter.form.savedArticle'));
      } else {
        await createArticle.mutateAsync(payload);
        toast.success(t('helpCenter.form.createdArticle'));
      }
      navigate('/help-center');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('helpCenter.form.saveError');
      toast.error(msg);
    }
  };

  const bodyPreview = useMemo(() => {
    if (!previewLang) return '';
    return previewMarkdown(previewLang === 'en' ? (bodyEn ?? '') : (bodyEs ?? ''));
  }, [previewLang, bodyEn, bodyEs]);

  if (editing && loadingArticle) {
    return <div className="h-64 bg-surface-cream rounded-xl animate-pulse" />;
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <BackLink
        label={t('helpCenter.form.back')}
        onClick={() => goBack('/help-center')}
        className="mb-6"
      />

      <div>
        <h1 className="text-2xl font-bold font-display text-ink">
          {editing ? t('helpCenter.form.editArticleTitle') : t('helpCenter.form.newArticleTitle')}
        </h1>
        <p className="text-sm text-muted font-display mt-1">
          {t('helpCenter.form.articleSubtitle')}
        </p>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="bg-card border border-border rounded-xl p-6 space-y-5"
        noValidate
      >
        {/* Category + slug */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label={`${t('helpCenter.form.category')} *`}
            placeholder={t('helpCenter.form.selectCategory')}
            error={errors.category_id?.message}
            {...register('category_id')}
          >
            <option value="" disabled>{t('helpCenter.form.selectCategory')}</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.title_en} / {c.title_es}</option>
            ))}
          </Select>

          <TextField
            label={`${t('helpCenter.form.slug')} *`}
            placeholder="order-tracking"
            error={errors.slug?.message}
            {...register('slug', {
              onChange: (e) => {
                setAutoSlug(false);
                setValue('slug', slugify(e.target.value), { shouldValidate: true });
              },
            })}
          />
        </div>

        {/* Bilingual titles */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextField
            label={`${t('helpCenter.form.titleEn')} *`}
            placeholder="Order Tracking"
            error={errors.title_en?.message}
            {...register('title_en')}
          />
          <TextField
            label={`${t('helpCenter.form.titleEs')} *`}
            placeholder="Seguimiento de pedidos"
            error={errors.title_es?.message}
            {...register('title_es')}
          />
        </div>

        {/* Markdown bodies */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {(['en', 'es'] as const).map((lng) => {
            const isPreviewing = previewLang === lng;
            const fieldName = lng === 'en' ? 'body_en' : 'body_es';
            const error = lng === 'en' ? errors.body_en?.message : errors.body_es?.message;
            return (
              <div key={lng}>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-semibold font-display text-ink">
                    {lng === 'en' ? t('helpCenter.form.bodyEn') : t('helpCenter.form.bodyEs')}
                  </label>
                  {/* A 16px-tall link; padding with matching negative margins
                      makes it a 36px tap without moving anything (2026-11-05). */}
                  <button
                    type="button"
                    onClick={() => setPreviewLang(isPreviewing ? null : lng)}
                    className="inline-flex items-center gap-1.5 py-2.5 -my-2.5 px-1 -mx-1 text-xs font-semibold font-display text-brand hover:text-brand-mid"
                  >
                    {isPreviewing ? (
                      <><Code size={12} strokeWidth={1.75} /> {t('helpCenter.form.edit')}</>
                    ) : (
                      <><Eye size={12} strokeWidth={1.75} /> {t('helpCenter.form.preview')}</>
                    )}
                  </button>
                </div>
                {isPreviewing ? (
                  <div
                    className="min-h-[360px] p-4 rounded-lg border border-border bg-surface-cream/40 prose prose-sm max-w-none [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-semibold [&_h1]:mt-3 [&_h2]:mt-3 [&_h3]:mt-2 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_a]:text-brand [&_a]:underline [&_code]:bg-card [&_code]:px-1 [&_code]:rounded"
                    dangerouslySetInnerHTML={{ __html: bodyPreview }}
                  />
                ) : (
                  <Textarea
                    rows={16}
                    placeholder={t('helpCenter.form.bodyPlaceholder')}
                    hint={t('helpCenter.form.bodyHelp')}
                    error={error}
                    {...register(fieldName)}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Sort + active */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <TextField
            label={t('helpCenter.form.sortOrder')}
            type="number"
            min={0}
            error={errors.sort_order?.message}
            {...register('sort_order')}
          />
          <div className="pb-3">
            <Checkbox
              className="[&>label]:py-2 [&>label]:-my-2"
              label={t('helpCenter.form.isActive')}
              error={errors.is_active?.message}
              {...register('is_active')}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="h-[52px] px-5 bg-brand text-white rounded-xl text-sm font-semibold font-display hover:bg-brand-mid transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" strokeWidth={1.75} />
            {isSubmitting ? t('common.loading') : t('common.save')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/help-center')}
            className="h-[52px] px-5 border border-border text-ink rounded-xl text-sm font-semibold font-display hover:bg-surface-cream transition-colors"
          >
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
