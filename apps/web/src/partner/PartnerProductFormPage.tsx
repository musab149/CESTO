import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Upload, AlertCircle } from 'lucide-react';
import { z } from 'zod';
import {
  usePartnerProduct,
  useCreatePartnerProduct,
  useUpdatePartnerProduct,
  usePartnerCategories,
  usePartnerSubcategories,
  usePartnerProductTypes,
  usePartnerBrands,
  usePartnerOrigins,
  partnerUploads,
  resolveImageUrl,
} from '@grocery-app/shared';
import type { ProductVariant } from '@grocery-app/shared';
import Combobox, { type ComboboxOption } from './components/form/Combobox';
import ConfirmModal from './components/ConfirmModal';
import { useValidationMessages } from './lib/validation-messages';
import { usePartnerT } from './lib/i18n';

/**
 * Partner-scoped product form. Structural mirror of admin's ProductFormPage
 * (same 4-tab layout: basic / variants / images / nutrition; same fields;
 * same styling; same variant + image handling) with the admin-only bits
 * stripped and every data hook + upload swapped to the /api/partner/*
 * surface.
 *
 * Kept out of the partner form (admin-only responsibilities):
 *   · Store dropdown — server forces store_id from the JWT.
 *   · is_verified / is_featured / is_top_seller / is_sponsored toggles —
 *     Cesto marketing signals, only admins set them.
 *   · Rating / rating_count fields — customer-authored.
 *   · Brand / origin "+ Add new" affordances + orphan warning banners —
 *     partners pick from the curated taxonomy only.
 *   · Similar-product warning that hit /admin/products?q= — deferred.
 */

// ── Types ──────────────────────────────────────────────────

type Tab = 'basic' | 'variants' | 'images' | 'nutrition';

interface VariantRow {
  id: string;
  name_es: string;
  price: string;
  compare_at_price: string;
  b2b_price: string;
  stock_quantity: string;
  low_stock_threshold: string;
  is_default: boolean;
}

const ALLERGEN_OPTIONS = [
  { key: 'gluten', label: 'Gluten' },
  { key: 'lactosa', label: 'Lactosa' },
  { key: 'frutos_secos', label: 'Frutos secos' },
  { key: 'soja', label: 'Soja' },
  { key: 'huevos', label: 'Huevos' },
  { key: 'pescado', label: 'Pescado' },
  { key: 'mariscos', label: 'Mariscos' },
  { key: 'cacahuetes', label: 'Cacahuetes' },
  { key: 'sesamo', label: 'Sesamo' },
  { key: 'mostaza', label: 'Mostaza' },
  { key: 'apio', label: 'Apio' },
  { key: 'sulfitos', label: 'Sulfitos' },
];

// ── Helpers ────────────────────────────────────────────────

function variantToRow(v: ProductVariant): VariantRow {
  return {
    id: v.id,
    name_es: v.name_es,
    price: String(v.price),
    compare_at_price: v.compare_at_price ? String(v.compare_at_price) : '',
    b2b_price: v.b2b_price != null ? String(v.b2b_price) : '',
    stock_quantity: String(v.stock_quantity),
    low_stock_threshold: String(v.low_stock_threshold),
    is_default: v.is_default,
  };
}

function emptyVariantRow(): VariantRow {
  return {
    id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name_es: '',
    price: '',
    compare_at_price: '',
    b2b_price: '',
    stock_quantity: '0',
    low_stock_threshold: '10',
    is_default: false,
  };
}

// ── Input classes ──────────────────────────────────────────

const inputClass =
  'bg-surface-cream border border-border rounded-lg h-11 px-4 text-sm font-display text-ink placeholder:text-muted w-full focus:outline-none focus:ring-2 focus:ring-brand/30';
const labelClass = 'text-sm font-semibold text-ink mb-1.5 block font-display';
const textareaClass =
  'bg-surface-cream border border-border rounded-lg px-4 py-3 text-sm font-display text-ink placeholder:text-muted w-full focus:outline-none focus:ring-2 focus:ring-brand/30 min-h-[100px] resize-y';

// ── Component ──────────────────────────────────────────────

export default function PartnerProductFormPage() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // Preserve the return URL passed via location.state so save / cancel
  // land back on the exact page + filter state the partner was on. Falls
  // back to /partner/products for direct URL / bookmark visits.
  const returnTo = (location.state as { from?: string } | null)?.from || '/partner/products';
  const t = usePartnerT();
  const isEdit = Boolean(productId);

  const TABS: { key: Tab; label: string }[] = [
    { key: 'basic',     label: t('productForm.tabs.basic') },
    { key: 'variants',  label: t('productForm.tabs.variants') },
    { key: 'images',    label: t('productForm.tabs.images') },
    { key: 'nutrition', label: t('productForm.tabs.nutrition') },
  ];

  const { data: existingProduct } = usePartnerProduct(isEdit ? productId : undefined);
  const { data: categories }      = usePartnerCategories();
  const { data: brandsData = [] } = usePartnerBrands();
  const { data: originsData = [] } = usePartnerOrigins();

  const brandOptions = useMemo(
    () => brandsData
      .filter((b) => b.is_active && b.name.trim().length > 0)
      .map((b) => b.name)
      .sort((a, b) => a.localeCompare(b)),
    [brandsData],
  );
  // Case-insensitive lookup so a legacy row with `ali baba` snaps to the
  // curated `ALI BABA` casing once the dropdown loads.
  const brandLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const name of brandOptions) m.set(name.toLowerCase(), name);
    return m;
  }, [brandOptions]);

  const originList = useMemo(
    () => originsData
      .filter((o) => o.is_active && o.label_es.trim().length > 0)
      .slice()
      .sort((a, b) => a.label_es.localeCompare(b.label_es)),
    [originsData],
  );
  const originOptions = useMemo(() => originList.map((o) => o.label_es), [originList]);
  const originLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of originList) {
      const canonical = o.label_es;
      m.set(o.key.toLowerCase(), canonical);
      m.set(o.label_en.toLowerCase(), canonical);
      m.set(o.label_es.toLowerCase(), canonical);
    }
    return m;
  }, [originList]);

  const createProduct = useCreatePartnerProduct();
  const updateProduct = useUpdatePartnerProduct();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const messages = useValidationMessages();

  // ── Validation (per-field errors so we can highlight only the offender)
  const [fieldErrors, setFieldErrors] = useState<{
    nameEs?: string;
    nameEn?: string;
    categoryId?: string;
    descEs?: string;
    descEn?: string;
  }>({});
  const [variantErrors, setVariantErrors] = useState<Record<string, { name_es?: string; price?: string; stock_quantity?: string }>>({});

  const productSchema = useMemo(() =>
    z.object({
      nameEs:      z.string().trim().min(2, messages.tooShort(2)).max(200, messages.tooLong(200)),
      nameEn:      z.string().trim().min(2, messages.tooShort(2)).max(200, messages.tooLong(200)),
      categoryId:  z.string().min(1, messages.required),
      descEs:      z.string().max(4000, messages.tooLong(4000)).optional(),
      descEn:      z.string().max(4000, messages.tooLong(4000)).optional(),
    }),
  [messages]);

  const variantRowSchema = useMemo(() => z.object({
    name_es: z.string().trim().min(1, messages.required),
    price:   z.string().refine((v) => v.trim() !== '' && Number(v) > 0, { message: messages.positive }),
    stock_quantity: z.string().refine(
      (v) => v.trim() === '' || (Number.isInteger(Number(v)) && Number(v) >= 0),
      { message: messages.positive },
    ),
  }), [messages]);

  // ── Form state ─────────────────────────────────────────

  const [activeTab, setActiveTab] = useState<Tab>('basic');

  // Basic info
  const [nameEs, setNameEs] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [sku, setSku] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [productTypeId, setProductTypeId] = useState('');
  const [brand, setBrand] = useState('');
  const [descEs, setDescEs] = useState('');
  const [descEn, setDescEn] = useState('');
  const [origin, setOrigin] = useState('');
  const [isActive, setIsActive] = useState(true);

  // Variants & images
  const [variants, setVariants] = useState<VariantRow[]>([emptyVariantRow()]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Nutrition (client-side only for now — nutrition_json on Product carries
  // these; the partner API accepts arbitrary JSON on the product body).
  const [ingredients, setIngredients] = useState('');
  const [allergens, setAllergens] = useState<string[]>([]);
  const [storageInstructions, setStorageInstructions] = useState('');
  const [countryOfOrigin, setCountryOfOrigin] = useState('');

  // Hydrate on edit
  useEffect(() => {
    if (!existingProduct) return;
    setNameEs(existingProduct.name_es ?? '');
    setNameEn(existingProduct.name_en ?? '');
    setSku(existingProduct.variants?.find((v) => v.is_default)?.sku ?? '');
    setCategoryId(existingProduct.category_id ?? '');
    setSubcategoryId(existingProduct.subcategory_id ?? '');
    setProductTypeId(existingProduct.product_type_id ?? '');
    setBrand(existingProduct.brand ?? '');
    setDescEs(existingProduct.description_es ?? '');
    setDescEn(existingProduct.description_en ?? '');
    setOrigin(existingProduct.origin ?? '');
    setIsActive(existingProduct.is_active ?? true);
    setVariants(existingProduct.variants?.length ? existingProduct.variants.map(variantToRow) : [emptyVariantRow()]);
    setImageUrls(existingProduct.images?.map((i) => i.url) ?? []);
  }, [existingProduct]);

  // Case-normalise brand once curated brands load.
  useEffect(() => {
    if (!brand) return;
    if (brandLookup.size === 0) return;
    const canonical = brandLookup.get(brand.toLowerCase());
    if (canonical && canonical !== brand) setBrand(canonical);
  }, [brand, brandLookup]);

  // Same for origin — snap to canonical label_es across key/label_en/label_es.
  useEffect(() => {
    if (!origin) return;
    if (originLookup.size === 0) return;
    const canonical = originLookup.get(origin.toLowerCase());
    if (canonical && canonical !== origin) setOrigin(canonical);
  }, [origin, originLookup]);

  // Filtered subcategories — dropdown gated on the parent category.
  const { data: subcategories = [] } = usePartnerSubcategories(categoryId || undefined);

  // Product types — third-tier taxonomy scoped to the picked subcategory.
  const { data: productTypes = [] } = usePartnerProductTypes(subcategoryId || undefined);

  // ── Variant handlers ───────────────────────────────────

  function updateVariant(id: string, field: keyof VariantRow, value: string | boolean) {
    setVariants((prev) =>
      prev.map((v) => {
        if (v.id !== id) {
          if (field === 'is_default' && value === true) {
            return { ...v, is_default: false };
          }
          return v;
        }
        return { ...v, [field]: value };
      }),
    );
  }
  function addVariant()          { setVariants((prev) => [...prev, emptyVariantRow()]); }
  function removeVariant(id: string) { setVariants((prev) => prev.filter((v) => v.id !== id)); }

  // Confirmed rather than immediate: the row carries price, stock and SKU,
  // there is no undo, and the trash button sits one icon away from the
  // default-variant radio.
  const [variantPendingDelete, setVariantPendingDelete] = useState<string | null>(null);
  const pendingVariant = variants.find((v) => v.id === variantPendingDelete) ?? null;

  // ── Image handlers ─────────────────────────────────────

  function removeImage(index: number) {
    setImageUrls((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const results = await Promise.all(list.map((f) => partnerUploads.uploadImage(f)));
      setImageUrls((prev) => [...prev, ...results.map((r) => r.url)]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }
  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) handleFiles(e.target.files);
  }
  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  }

  // ── Submit ─────────────────────────────────────────────

  async function handleSave() {
    setSubmitError(null);

    const topParsed = productSchema.safeParse({ nameEs, nameEn, categoryId, descEs, descEn });
    const nextTopErrors: typeof fieldErrors = {};
    if (!topParsed.success) {
      for (const issue of topParsed.error.issues) {
        const k = issue.path[0] as keyof typeof fieldErrors;
        if (k && !nextTopErrors[k]) nextTopErrors[k] = issue.message;
      }
    }

    const nextVariantErrors: typeof variantErrors = {};
    if (variants.length === 0) setSubmitError('At least one variant is required.');
    for (const v of variants) {
      const r = variantRowSchema.safeParse(v);
      if (!r.success) {
        const rowErrs: { name_es?: string; price?: string; stock_quantity?: string } = {};
        for (const issue of r.error.issues) {
          const k = issue.path[0] as 'name_es' | 'price' | 'stock_quantity';
          if (k && !rowErrs[k]) rowErrs[k] = issue.message;
        }
        nextVariantErrors[v.id] = rowErrs;
      }
    }
    setFieldErrors(nextTopErrors);
    setVariantErrors(nextVariantErrors);

    const hasTopErrors = Object.keys(nextTopErrors).length > 0;
    const hasVariantErrors = Object.keys(nextVariantErrors).length > 0;
    if (hasTopErrors || hasVariantErrors || variants.length === 0) {
      if (hasTopErrors) setActiveTab('basic');
      else if (hasVariantErrors) setActiveTab('variants');
      setSubmitError('Please fix the highlighted fields.');
      return;
    }

    // Exactly one default variant.
    const hasDefault = variants.some((v) => v.is_default);
    const variantsPayload = variants.map((v, idx) => ({
      ...(v.id && !v.id.startsWith('new-') ? { id: v.id } : {}),
      name_es: v.name_es,
      name_en: v.name_es, // mirror ES — UI doesn't expose a separate EN name for variants
      price: parseFloat(v.price) || 0,
      compare_at_price: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
      b2b_price: v.b2b_price ? parseFloat(v.b2b_price) : null,
      stock_quantity: parseInt(v.stock_quantity, 10) || 0,
      low_stock_threshold: parseInt(v.low_stock_threshold, 10) || 10,
      is_default: hasDefault ? v.is_default : idx === 0,
      is_active: true,
      sku: idx === 0 && sku ? sku : null,
    }));

    const imagesPayload = imageUrls.map((url, idx) => ({
      url,
      alt_text: nameEs,
      sort_order: idx,
      is_primary: idx === 0,
    }));

    // Brand / origin canonicalisation. If the typed value matches a curated
    // row case-insensitively, persist the canonical casing so the DB doesn't
    // accumulate look-alikes.
    const trimmedBrand = brand.trim();
    const canonicalBrand = trimmedBrand
      ? (brandOptions.find((n) => n.toLowerCase() === trimmedBrand.toLowerCase()) ?? trimmedBrand)
      : null;
    const trimmedOrigin = origin.trim();
    const canonicalOrigin = trimmedOrigin
      ? (originLookup.get(trimmedOrigin.toLowerCase()) ?? trimmedOrigin)
      : null;

    const payload = {
      name_es: nameEs,
      name_en: nameEn,
      description_es: descEs || null,
      description_en: descEn || null,
      brand: canonicalBrand,
      origin: canonicalOrigin,
      category_id: categoryId,
      subcategory_id: subcategoryId || null,
      product_type_id: productTypeId || null,
      is_active: isActive,
      variants: variantsPayload,
      images: imagesPayload,
    };

    try {
      if (isEdit && productId) {
        await updateProduct.mutateAsync({ id: productId, payload: payload as any });
      } else {
        await createProduct.mutateAsync(payload as any);
      }
      navigate(returnTo);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Save failed');
    }
  }
  const isSaving = createProduct.isPending || updateProduct.isPending;

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          type="button"
          onClick={() => navigate(returnTo)}
          className="w-10 h-10 rounded-lg bg-surface-cream hover:bg-brand-mist flex items-center justify-center transition"
        >
          <ArrowLeft className="w-5 h-5 text-ink" strokeWidth={1.75} />
        </button>
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">
            {isEdit ? t('productForm.titleEdit') : t('productForm.titleNew')}
          </h1>
          <p className="text-sm text-muted font-body mt-0.5">
            {isEdit
              ? `${t('productForm.basic.editingLabel')} ${existingProduct?.name_es ?? ''}`
              : t('productForm.newProductSubtitle')}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border mb-6">
        <div className="flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-3 text-sm font-semibold font-display border-b-2 transition ${
                activeTab === tab.key
                  ? 'border-brand text-brand'
                  : 'border-transparent text-gray hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="bg-white rounded-xl border border-border p-6">
        {/* ── Tab 1: Basic Info ────────────────────────────── */}
        {activeTab === 'basic' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className={labelClass}>{t('productForm.basic.nameEs')}</label>
                <input
                  type="text"
                  value={nameEs}
                  onChange={(e) => setNameEs(e.target.value)}
                  placeholder="Nombre del producto en español"
                  aria-invalid={!!fieldErrors.nameEs}
                  className={`${inputClass} ${fieldErrors.nameEs ? 'border-danger focus:ring-danger/20' : ''}`}
                />
                {fieldErrors.nameEs && (
                  <p role="alert" className="mt-1.5 text-[12px] text-danger font-display font-medium flex items-start gap-1.5">
                    <AlertCircle size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
                    <span>{fieldErrors.nameEs}</span>
                  </p>
                )}
              </div>
              <div>
                <label className={labelClass}>{t('productForm.basic.nameEn')}</label>
                <input
                  type="text"
                  value={nameEn}
                  onChange={(e) => setNameEn(e.target.value)}
                  placeholder="Product name in English"
                  aria-invalid={!!fieldErrors.nameEn}
                  className={`${inputClass} ${fieldErrors.nameEn ? 'border-danger focus:ring-danger/20' : ''}`}
                />
                {fieldErrors.nameEn && (
                  <p role="alert" className="mt-1.5 text-[12px] text-danger font-display font-medium flex items-start gap-1.5">
                    <AlertCircle size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
                    <span>{fieldErrors.nameEn}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <label className={labelClass}>{t('productForm.basic.sku')}</label>
                <input
                  type="text"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="Ej: TLD-BAS-1KG"
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div>
                <label className={labelClass}>{t('productForm.basic.category')}</label>
                <Combobox
                  value={categoryId}
                  onChange={(v) => { setCategoryId(v); setSubcategoryId(''); setProductTypeId(''); }}
                  invalid={!!fieldErrors.categoryId}
                  placeholder="— Selecciona categoría —"
                  ariaLabel={t('productForm.basic.category')}
                  searchable
                  searchPlaceholder="Buscar categoría…"
                  options={(categories ?? []).map((cat): ComboboxOption => ({
                    value: cat.id, label: cat.name_es,
                  }))}
                />
                {fieldErrors.categoryId && (
                  <p role="alert" className="mt-1.5 text-[12px] text-danger font-display font-medium flex items-start gap-1.5">
                    <AlertCircle size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
                    <span>{fieldErrors.categoryId}</span>
                  </p>
                )}
              </div>
              <div>
                <label className={labelClass}>{t('productForm.basic.subcategory')}</label>
                <Combobox
                  value={subcategoryId}
                  onChange={(v) => { setSubcategoryId(v); setProductTypeId(''); }}
                  disabled={!categoryId || subcategories.length === 0}
                  placeholder={
                    !categoryId
                      ? '— Selecciona categoría primero —'
                      : subcategories.length === 0
                        ? '— Sin subcategorías —'
                        : '— Selecciona subcategoría —'
                  }
                  ariaLabel={t('productForm.basic.subcategory')}
                  options={subcategories.map((sub): ComboboxOption => ({
                    value: sub.id, label: sub.name_es,
                  }))}
                />
              </div>
            </div>

            {/* Product type — third-tier cascading picker */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className={labelClass}>Product type</label>
                <Combobox
                  value={productTypeId}
                  onChange={setProductTypeId}
                  disabled={!subcategoryId || productTypes.length === 0}
                  placeholder={
                    !subcategoryId
                      ? '— Selecciona subcategoría primero —'
                      : productTypes.length === 0
                        ? '— No hay tipos —'
                        : '— Opcional: elige tipo —'
                  }
                  ariaLabel="Product type"
                  options={[
                    { value: '', label: '— Sin tipo —' } as ComboboxOption,
                    ...productTypes.map((pt): ComboboxOption => ({
                      value: pt.id, label: pt.name_es,
                    })),
                  ]}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Brand — curated pick only (no "+ Add new"; that stays admin-only) */}
              <div>
                <label className={labelClass}>{t('productForm.basic.brand')}</label>
                <Combobox
                  value={brand}
                  onChange={setBrand}
                  placeholder="No brand"
                  ariaLabel="Brand"
                  options={[
                    { value: '', label: '— No brand —' },
                    ...brandOptions.map((name): ComboboxOption => ({ value: name, label: name })),
                  ]}
                />
                <p className="mt-1 text-[11px] text-muted font-display">
                  Pick from the Cesto brand list. Contact your admin to add a new brand.
                </p>
              </div>
              {/* Origin — same treatment */}
              <div>
                <label className={labelClass}>{t('productForm.basic.origin')}</label>
                <Combobox
                  value={origin}
                  onChange={setOrigin}
                  placeholder="No origin"
                  ariaLabel={t('productForm.basic.origin')}
                  options={[
                    { value: '', label: '— No origin —' },
                    ...originOptions.map((label): ComboboxOption => ({ value: label, label })),
                  ]}
                />
                <p className="mt-1 text-[11px] text-muted font-display">
                  Pick from the Cesto origin list. Contact your admin to add a new origin.
                </p>
              </div>
            </div>

            <div>
              <label className={labelClass}>{t('productForm.basic.descriptionEs')}</label>
              <textarea
                value={descEs}
                onChange={(e) => setDescEs(e.target.value)}
                placeholder="Descripción del producto en español"
                className={textareaClass}
              />
            </div>
            <div>
              <label className={labelClass}>{t('productForm.basic.descriptionEn')}</label>
              <textarea
                value={descEn}
                onChange={(e) => setDescEn(e.target.value)}
                placeholder="Product description in English"
                className={textareaClass}
              />
            </div>

            {/* Active toggle — only visibility flag partners control. Admin-only
                flags (verified / featured / sponsored / top_seller) intentionally
                omitted; those are Cesto marketing signals. */}
            <div className="flex flex-wrap gap-6 pt-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <button
                  type="button"
                  role="switch"
                  aria-checked={isActive}
                  onClick={() => setIsActive(!isActive)}
                  className={`relative w-11 h-6 rounded-full transition ${
                    isActive ? 'bg-brand' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      isActive ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
                <span className="text-sm font-display text-ink">{t('productForm.basic.active')}</span>
              </label>
            </div>
          </div>
        )}

        {/* ── Tab 2: Variants ─────────────────────────────── */}
        {activeTab === 'variants' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold font-display text-ink">
                {t('productForm.variants.title')}
              </h3>
              <button
                type="button"
                onClick={addVariant}
                className="inline-flex items-center gap-1.5 text-sm font-semibold font-display text-brand hover:text-brand-dark transition"
              >
                <Plus className="w-4 h-4" strokeWidth={1.75} />
                {t('productForm.variants.addVariant')}
              </button>
            </div>

            {/* Column headers */}
            <div className="hidden md:grid grid-cols-[1fr_100px_100px_100px_90px_90px_60px_40px] gap-3 px-1">
              <span className="text-xs font-semibold text-gray uppercase font-display">{t('productForm.variants.nameEs')}</span>
              <span className="text-xs font-semibold text-gray uppercase font-display">{t('productForm.variants.price')}</span>
              <span className="text-xs font-semibold text-gray uppercase font-display">{t('productForm.variants.comparePrice')}</span>
              <span className="text-xs font-semibold text-gray uppercase font-display" title={t('productForm.variants.b2bPriceHint')}>
                {t('productForm.variants.b2bPrice')}
              </span>
              <span className="text-xs font-semibold text-gray uppercase font-display">{t('productForm.variants.stock')}</span>
              <span className="text-xs font-semibold text-gray uppercase font-display">{t('productForm.variants.lowStockThreshold')}</span>
              <span className="text-xs font-semibold text-gray uppercase font-display">{t('productForm.variants.default')}</span>
              <span />
            </div>

            {variants.map((v) => {
              const rowErrs = variantErrors[v.id] ?? {};
              const errCls = (err?: string) => (err ? 'border-danger focus:ring-danger/20' : '');
              return (
                <div
                  key={v.id}
                  className={`grid grid-cols-1 md:grid-cols-[1fr_100px_100px_100px_90px_90px_60px_40px] gap-3 items-start bg-surface-cream border rounded-lg p-3 ${
                    Object.keys(rowErrs).length ? 'border-danger/40' : 'border-border'
                  }`}
                >
                  <div>
                    <input
                      type="text"
                      value={v.name_es}
                      onChange={(e) => updateVariant(v.id, 'name_es', e.target.value)}
                      placeholder="Ej: 1 kg"
                      aria-invalid={!!rowErrs.name_es}
                      className={`${inputClass} ${errCls(rowErrs.name_es)}`}
                    />
                    {rowErrs.name_es && (
                      <p role="alert" className="mt-1 text-[11.5px] text-danger font-display font-medium">{rowErrs.name_es}</p>
                    )}
                  </div>
                  <div>
                    <input
                      type="number"
                      step="0.01"
                      value={v.price}
                      onChange={(e) => updateVariant(v.id, 'price', e.target.value)}
                      placeholder="0.00"
                      aria-invalid={!!rowErrs.price}
                      className={`${inputClass} ${errCls(rowErrs.price)}`}
                    />
                    {rowErrs.price && (
                      <p role="alert" className="mt-1 text-[11.5px] text-danger font-display font-medium">{rowErrs.price}</p>
                    )}
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    value={v.compare_at_price}
                    onChange={(e) => updateVariant(v.id, 'compare_at_price', e.target.value)}
                    placeholder="0.00"
                    className={inputClass}
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={v.b2b_price}
                    onChange={(e) => updateVariant(v.id, 'b2b_price', e.target.value)}
                    placeholder="0.00"
                    title={t('productForm.variants.b2bPriceHint')}
                    className={inputClass}
                  />
                  <div>
                    <input
                      type="number"
                      value={v.stock_quantity}
                      onChange={(e) => updateVariant(v.id, 'stock_quantity', e.target.value)}
                      aria-invalid={!!rowErrs.stock_quantity}
                      className={`${inputClass} ${errCls(rowErrs.stock_quantity)}`}
                    />
                    {rowErrs.stock_quantity && (
                      <p role="alert" className="mt-1 text-[11.5px] text-danger font-display font-medium">{rowErrs.stock_quantity}</p>
                    )}
                  </div>
                  <input
                    type="number"
                    value={v.low_stock_threshold}
                    onChange={(e) => updateVariant(v.id, 'low_stock_threshold', e.target.value)}
                    className={inputClass}
                  />
                  <div className="flex items-center justify-center pt-3">
                    <input
                      type="radio"
                      name="default_variant"
                      checked={v.is_default}
                      onChange={() => updateVariant(v.id, 'is_default', true)}
                      className="w-4 h-4 text-brand accent-brand"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setVariantPendingDelete(v.id)}
                    disabled={variants.length <= 1}
                    className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-danger-bg transition disabled:opacity-30 mt-0.5"
                    title={t('productForm.variants.deleteVariant')}
                  >
                    <Trash2 className="w-4 h-4 text-danger" strokeWidth={1.75} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Tab 3: Images ───────────────────────────────── */}
        {activeTab === 'images' && (
          <div className="space-y-5">
            <div
              onClick={() => !uploading && fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              className={`border-2 border-dashed rounded-xl p-10 text-center transition cursor-pointer ${
                uploading ? 'border-brand bg-brand-mist/30 cursor-wait' : 'border-border hover:border-brand/50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                onChange={onPickFiles}
                className="hidden"
              />
              <div className="w-14 h-14 rounded-2xl bg-surface-cream flex items-center justify-center mx-auto mb-3">
                <Upload className={`w-7 h-7 ${uploading ? 'text-brand animate-pulse' : 'text-muted'}`} strokeWidth={1.75} />
              </div>
              <p className="text-sm font-display font-semibold text-ink mb-1">
                {uploading ? 'Uploading…' : t('productForm.images.dropzone')}
              </p>
              <p className="text-xs text-muted">
                {t('productForm.images.dropzoneHint')} (JPG/PNG/WebP/GIF, max 5 MB each)
              </p>
            </div>

            {uploadError && (
              <p className="text-sm text-danger font-body bg-danger-bg rounded-lg p-3">{uploadError}</p>
            )}

            {imageUrls.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold font-display text-ink mb-3">
                  {t('productForm.images.current')} ({imageUrls.length})
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {imageUrls.map((url, idx) => (
                    <div key={url} className="relative group">
                      <img
                        src={resolveImageUrl(url, 'thumb')}
                        alt={t('productForm.images.imageAlt')}
                        className="w-full aspect-square rounded-lg object-cover border border-border"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(idx)}
                        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-danger-bg"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-danger" strokeWidth={1.75} />
                      </button>
                      {idx === 0 && (
                        <span className="absolute bottom-2 left-2 text-[10px] font-semibold font-display bg-brand text-white px-2 py-0.5 rounded-full">
                          {t('productForm.images.primary')}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab 4: Nutrition ────────────────────────────── */}
        {activeTab === 'nutrition' && (
          <div className="space-y-5">
            <div>
              <label className={labelClass}>{t('productForm.nutrition.ingredients')}</label>
              <textarea
                value={ingredients}
                onChange={(e) => setIngredients(e.target.value)}
                placeholder="Lista de ingredientes del producto..."
                className={textareaClass}
              />
            </div>

            <div>
              <label className={labelClass}>{t('productForm.nutrition.allergens')}</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-1">
                {ALLERGEN_OPTIONS.map((a) => (
                  <label
                    key={a.key}
                    className="flex items-center gap-2.5 bg-surface-cream border border-border rounded-lg px-3 py-2.5 cursor-pointer hover:border-brand/40 transition"
                  >
                    <input
                      type="checkbox"
                      checked={allergens.includes(a.key)}
                      onChange={(e) => {
                        if (e.target.checked) setAllergens((prev) => [...prev, a.key]);
                        else setAllergens((prev) => prev.filter((k) => k !== a.key));
                      }}
                      className="w-4 h-4 rounded accent-brand"
                    />
                    <span className="text-sm font-display text-ink">{a.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className={labelClass}>{t('productForm.nutrition.storageInstructions')}</label>
              <textarea
                value={storageInstructions}
                onChange={(e) => setStorageInstructions(e.target.value)}
                placeholder="Ej: Conservar en lugar fresco y seco..."
                className={textareaClass}
              />
            </div>

            <div>
              <label className={labelClass}>{t('productForm.nutrition.countryOfOrigin')}</label>
              <input
                type="text"
                value={countryOfOrigin}
                onChange={(e) => setCountryOfOrigin(e.target.value)}
                placeholder="Ej: India, Pakistan, España..."
                className={inputClass}
              />
            </div>
          </div>
        )}
      </div>

      {/* Bottom actions */}
      <div className="flex items-center justify-end gap-3 mt-6">
        {submitError && (
          <p className="text-sm text-danger font-display mr-auto">{submitError}</p>
        )}
        <button
          type="button"
          onClick={() => navigate(returnTo)}
          className="h-[52px] px-6 rounded-xl border border-border text-sm font-semibold font-display text-ink hover:bg-surface-cream transition"
        >
          {t('productForm.cancel')}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="h-[52px] px-8 rounded-xl bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display transition disabled:opacity-50"
        >
          {isSaving ? '…' : isEdit ? t('productForm.save') : t('productForm.create')}
        </button>
      </div>

      <ConfirmModal
        open={pendingVariant != null}
        danger
        title={t('productForm.variants.deleteVariant')}
        // Names the row — the button sits in a table where every row's
        // controls look identical. usePartnerT has no interpolation, so the
        // sentence is assembled from two halves around the name.
        message={
          pendingVariant
            ? `${t('productForm.variants.deleteConfirmBefore')} "${
                pendingVariant.name_es || t('productForm.variants.untitled')
              }" ${t('productForm.variants.deleteConfirmAfter')}`
            : ''
        }
        confirmLabel={t('productForm.variants.deleteVariant')}
        cancelLabel={t('productForm.cancel')}
        onCancel={() => setVariantPendingDelete(null)}
        onConfirm={() => {
          if (pendingVariant) removeVariant(pendingVariant.id);
          setVariantPendingDelete(null);
        }}
      />
    </div>
  );
}
