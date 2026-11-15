import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGoBack } from '@/lib/useGoBack';
import { useTranslation } from 'react-i18next';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Save } from 'lucide-react';
import {
  useAdminHelpCategories,
  useCreateHelpCategory,
  useUpdateHelpCategory,
} from '@grocery-app/shared';
import type { HelpCategory } from '@grocery-app/shared';
import { useToast } from '@/components/Toast';
import BackLink from '@/components/BackLink';
import { TextField, Select, Checkbox } from '@/components/form';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';

interface FormState {
  slug: string;
  title_en: string;
  title_es: string;
  icon: string;
  sort_order: string;
  is_active: boolean;
}

const empty: FormState = {
  slug: '', title_en: '', title_es: '', icon: 'FolderOpen', sort_order: '1', is_active: true,
};

const ICON_CHOICES = [
  'Sparkles', 'Package', 'CreditCard', 'RotateCcw', 'ShoppingBag',
  'FileText', 'Lock', 'Store', 'FolderOpen', 'HelpCircle', 'Truck',
  'ShieldCheck', 'Wallet', 'MessageCircle', 'Settings',
];

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function categoryToForm(c: HelpCategory): FormState {
  return {
    slug: c.slug,
    title_en: c.title_en,
    title_es: c.title_es,
    icon: c.icon ?? 'FolderOpen',
    sort_order: String(c.sort_order),
    is_active: c.is_active,
  };
}

export default function HelpCategoryFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const toast = useToast();
  const { categoryId } = useParams<{ categoryId: string }>();
  const editing = Boolean(categoryId);
  const messages = useValidationMessages();

  const { data: categories, isLoading } = useAdminHelpCategories();
  const createCategory = useCreateHelpCategory();
  const updateCategory = useUpdateHelpCategory();

  const existing = useMemo(
    () => (editing ? categories?.find((c) => c.id === categoryId) ?? null : null),
    [categories, categoryId, editing],
  );

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      slug:       r.slug(),
      title_en:   r.name({ min: 2, max: 80 }),
      title_es:   r.name({ min: 2, max: 80 }),
      icon:       z.string(),
      sort_order: z.coerce.number().int().nonnegative(messages.positive),
      is_active:  z.boolean(),
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
  const titleEn = watch('title_en');

  useEffect(() => {
    if (editing && existing) reset(categoryToForm(existing));
  }, [editing, existing, reset]);

  // Auto-populate slug from EN title until the admin manually edits the slug.
  useEffect(() => {
    if (autoSlug && titleEn) {
      setValue('slug', slugify(titleEn), { shouldValidate: false });
    }
  }, [titleEn, autoSlug, setValue]);

  const onSubmit = async (values: FormState) => {
    const payload = {
      slug: values.slug,
      title_en: values.title_en,
      title_es: values.title_es,
      icon: values.icon || null,
      sort_order: Number(values.sort_order) || 0,
      is_active: values.is_active,
    };
    try {
      if (editing && categoryId) {
        await updateCategory.mutateAsync({ id: categoryId, payload });
        toast.success(t('helpCenter.form.savedCategory'));
      } else {
        await createCategory.mutateAsync(payload);
        toast.success(t('helpCenter.form.createdCategory'));
      }
      navigate('/help-center');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('helpCenter.form.saveError');
      toast.error(msg);
    }
  };

  if (editing && isLoading) {
    return <div className="h-64 bg-surface-cream rounded-xl animate-pulse" />;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <BackLink
        label={t('helpCenter.form.back')}
        onClick={() => goBack('/help-center')}
        className="mb-6"
      />

      <div>
        <h1 className="text-2xl font-bold font-display text-ink">
          {editing ? t('helpCenter.form.editCategoryTitle') : t('helpCenter.form.newCategoryTitle')}
        </h1>
        <p className="text-sm text-muted font-display mt-1">
          {t('helpCenter.form.categorySubtitle')}
        </p>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="bg-card border border-border rounded-xl p-6 space-y-5"
        noValidate
      >
        <TextField
          label={`${t('helpCenter.form.slug')} *`}
          placeholder="orders-delivery"
          hint={t('helpCenter.form.slugHelp')}
          error={errors.slug?.message}
          {...register('slug', {
            onChange: (e) => {
              setAutoSlug(false);
              setValue('slug', slugify(e.target.value), { shouldValidate: true });
            },
          })}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextField
            label={`${t('helpCenter.form.titleEn')} *`}
            placeholder="Orders & Delivery"
            error={errors.title_en?.message}
            {...register('title_en')}
          />
          <TextField
            label={`${t('helpCenter.form.titleEs')} *`}
            placeholder="Pedidos y entrega"
            error={errors.title_es?.message}
            {...register('title_es')}
          />
        </div>

        <Select
          label={t('helpCenter.form.icon')}
          options={ICON_CHOICES.map((name) => ({ value: name, label: name }))}
          hint={t('helpCenter.form.iconHelp')}
          error={errors.icon?.message}
          {...register('icon')}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <TextField
            label={t('helpCenter.form.sortOrder')}
            type="number"
            min={0}
            error={errors.sort_order?.message}
            {...register('sort_order')}
          />
          <div className="pb-3">
            {/* The label is 20px tall; padding with a matching negative
                margin makes it a 36px tap without moving it (2026-11-05). */}
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
