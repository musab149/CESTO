import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useGoBack } from '@/lib/useGoBack';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Upload, AlertCircle, AlertTriangle, Copy } from 'lucide-react';
import { z } from 'zod';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';
import Combobox, { type ComboboxOption } from '@/components/form/Combobox';
import BackLink from '@/components/BackLink';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';
import {
  useAdminProduct,
  useAdminProducts,
  useAdminCategories,
  useAdminSubcategories,
  useProductTypesForSubcategory,
  useCreateProduct,
  useUpdateProduct,
  useMarkProductReviewed,
  useAdminStores,
  useAdminBrandsTable,
  useAdminOriginsTable,
  CESTO_SHOP,
  adminUploads,
  resolveImageUrl,
  unpricedSizesOf,
  priceWithVat,
  VAT_RATES,
} from '@grocery-app/shared';
import type { ProductVariant, VatCategory } from '@grocery-app/shared';
import { formatCurrency } from '@/lib/format';
import { AudienceSegmented } from '@/components/product/AudienceControls';
import type { ProductAudience } from '@grocery-app/shared';

// ── Types ──────────────────────────────────────────────────

type Tab = 'basic' | 'variants' | 'images' | 'nutrition';

interface VariantRow {
  id: string;
  name_es: string;
  price: string;
  compare_at_price: string;
  b2b_price: string;
  /** The buying price; '' shows the placeholder for 0 (not entered). */
  cost_price: string;
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

// TABS are built inside the component so labels can use t()

// ── Helpers ────────────────────────────────────────────────

function variantToRow(v: ProductVariant): VariantRow {
  return {
    id: v.id,
    name_es: v.name_es,
    price: String(v.price),
    compare_at_price: v.compare_at_price ? String(v.compare_at_price) : '',
    b2b_price: v.b2b_price != null ? String(v.b2b_price) : '',
    cost_price: Number(v.cost_price ?? 0) > 0 ? String(v.cost_price) : '',
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
    cost_price: '',
    stock_quantity: '0',
    low_stock_threshold: '10',
    is_default: false,
  };
}

// ── Input Classes ──────────────────────────────────────────

const inputClass =
  'bg-surface-cream border border-border rounded-lg h-11 px-4 text-sm font-display text-ink placeholder:text-muted w-full focus:outline-none focus:ring-2 focus:ring-brand/30';
const labelClass = 'text-sm font-semibold text-ink mb-1.5 block font-display';
const textareaClass =
  'bg-surface-cream border border-border rounded-lg px-4 py-3 text-sm font-display text-ink placeholder:text-muted w-full focus:outline-none focus:ring-2 focus:ring-brand/30 min-h-[100px] resize-y';

// ── Component ──────────────────────────────────────────────

export default function ProductFormPage() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const location = useLocation();
  // Preserve the return URL the caller passed via location.state so a save
  // (or Cancel) returns the admin to the exact filter/page they were on,
  // not the bare /products list. Falls back to /products if the user
  // arrived here by direct URL / bookmark.
  const returnTo = (location.state as { from?: string } | null)?.from || '/products';
  const { t } = useTranslation();
  const isEdit = Boolean(productId);

  const TABS: { key: Tab; label: string }[] = [
    { key: 'basic', label: t('productForm.tabs.basic') },
    { key: 'variants', label: t('productForm.tabs.variants') },
    { key: 'images', label: t('productForm.tabs.images') },
    { key: 'nutrition', label: t('productForm.tabs.nutrition') },
  ];

  const { data: existingProduct } = useAdminProduct(isEdit ? productId : undefined);
  const markReviewed = useMarkProductReviewed();
  const toast = useToast();
  const { data: categories } = useAdminCategories();
  const { data: subcategories } = useAdminSubcategories();
  // NOTE: useProductTypesForSubcategory needs `subcategoryId` state, which is
  // declared much further down. Placing it here caused a TDZ crash on
  // first render ("Cannot access 'subcategoryId' before initialization").
  // Moved down next to `filteredSubcategories`.
  // Store dropdown options come from the real Store table now. Fetch ALL
  // stores (not just active) so we can detect + warn when a product is
  // linked to an inactive one — same orphan pattern as brands + origins.
  const { data: adminStoresData } = useAdminStores({ page: 1, limit: 200 });
  // Curated Top Brands list — powers the brand dropdown below. Same source as
  // the Home Sections editor. A product's `brand` column can still hold a
  // value that isn't in the curated list (legacy rows, imports from sheets);
  // we handle that as a "not-in-Top-Brands" case with an explicit warning +
  // one-click promotion instead of silently trusting it.
  const { data: brandsData, isLoading: brandsLoading } = useAdminBrandsTable();
  const brandOptions = useMemo(() => {
    const list = brandsData ?? [];
    return list
      .filter((b) => b.is_active && b.name.trim().length > 0)
      .map((b) => b.name)
      .sort((a, b) => a.localeCompare(b));
  }, [brandsData]);
  // Case-insensitive lookup: sheet imports and legacy rows use different
  // casings (`ALI BABA` vs `Ali Baba` vs `ali baba`), so we always compare
  // via lowercased key. `.get(key)` returns the canonical curated casing so
  // the `<select>` `value` can match the option `value` exactly.
  const brandLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const name of brandOptions) m.set(name.toLowerCase(), name);
    return m;
  }, [brandOptions]);

  // Curated Shop-by-Origin cards — powers the origin dropdown below with the
  // same UX contract as brands (see [[brand-names-case-insensitive]]).
  // Product.origin is stored as the Spanish label (matches most current data
  // and the excel template's example rows). The lookup accepts key /
  // label_en / label_es case-insensitively and returns the canonical
  // label_es for whichever variant matches.
  const { data: originsData, isLoading: originsLoading } = useAdminOriginsTable();
  const originCards = useMemo(() => {
    const list = originsData ?? [];
    return list
      .filter((c) => c.is_active && c.label_es.trim().length > 0)
      .slice()
      .sort((a, b) => a.label_es.localeCompare(b.label_es));
  }, [originsData]);
  const originOptions = useMemo(() => originCards.map((c) => c.label_es), [originCards]);
  const originLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of originCards) {
      const canonical = c.label_es;
      m.set(c.key.toLowerCase(), canonical);
      m.set(c.label_en.toLowerCase(), canonical);
      m.set(c.label_es.toLowerCase(), canonical);
    }
    return m;
  }, [originCards]);
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const messages = useValidationMessages();

  // Per-field validation errors keyed by the same names the inputs use.
  // Variant errors live separately, keyed by row id, so a variants table with
  // multiple rows can highlight only the offending one.
  const [fieldErrors, setFieldErrors] = useState<{
    nameEs?: string;
    nameEn?: string;
    categoryId?: string;
    descEs?: string;
    descEn?: string;
    rating?: string;
    ratingCount?: string;
  }>({});
  const [variantErrors, setVariantErrors] = useState<Record<string, { name_es?: string; price?: string; stock_quantity?: string; b2b_price?: string }>>({});

  const productSchema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      nameEs:      r.name({ min: 2, max: 200 }),
      nameEn:      r.name({ min: 2, max: 200 }),
      categoryId:  z.string().min(1, messages.required),
      descEs:      r.optionalLongText(4000),
      descEn:      r.optionalLongText(4000),
      rating:      z.string().refine(
        (v) => v.trim() === '' || (Number(v) >= 0 && Number(v) <= 5),
        { message: '0 – 5' },
      ),
      ratingCount: z.string().refine(
        (v) => v.trim() === '' || (Number.isInteger(Number(v)) && Number(v) >= 0),
        { message: messages.positive },
      ),
    });
  }, [messages]);

  const variantRowSchema = useMemo(() => z.object({
    name_es: z.string().trim().min(1, messages.required),
    price:   z.string().refine((v) => v.trim() !== '' && Number(v) > 0, { message: messages.positive }),
    stock_quantity: z.string().refine(
      (v) => v.trim() === '' || (Number.isInteger(Number(v)) && Number(v) >= 0),
      { message: messages.positive },
    ),
  }), [messages]);

  // Active Stores drive the Store dropdown options. Cesto is always the
  // first/default choice and represents the null store_id case. Inactive
  // stores (including import-suggestion rows) are excluded from the dropdown
  // — if a product is currently linked to one, we surface it as an orphan
  // with a warning banner below, matching the brand/origin pattern.
  const shopOptions = useMemo(() => {
    const items = (adminStoresData?.items ?? []).filter((s) => s.is_active);
    const sorted = [...items].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    return [{ id: '', name: `${CESTO_SHOP.name} (default)` }, ...sorted.map((s) => ({ id: s.id, name: s.name }))];
  }, [adminStoresData]);
  // Lookup by id for orphan detection — the full store list (active +
  // inactive) so a product linked to a suggestion can surface it.
  const storeById = useMemo(() => {
    const m = new Map<string, { id: string; name: string; is_active: boolean }>();
    for (const s of adminStoresData?.items ?? []) m.set(s.id, { id: s.id, name: s.name, is_active: s.is_active });
    return m;
  }, [adminStoresData]);

  // ── Form State ─────────────────────────────────────────

  const [activeTab, setActiveTab] = useState<Tab>('basic');

  // Basic info
  const [nameEs, setNameEs] = useState('');
  // Debounced version of nameEs used to hit /admin/products?q= for the
  // "similar product exists" warning — otherwise we'd query on every keystroke.
  const [debouncedNameEs, setDebouncedNameEs] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedNameEs(nameEs.trim()), 400);
    return () => clearTimeout(t);
  }, [nameEs]);
  const { data: dupCandidates } = useAdminProducts({
    q: debouncedNameEs.length >= 3 ? debouncedNameEs : undefined,
    limit: 5,
  });
  const normalizeName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const normalizedTyped = normalizeName(nameEs);
  // Show only if we have 3+ chars AND find another product with the
  // same normalised name (excluding the one being edited).
  const similarProducts = useMemo(() => {
    if (!normalizedTyped || normalizedTyped.length < 3) return [];
    const items = (dupCandidates?.items ?? []) as Array<{ id: string; name_es: string; name_en: string; is_active: boolean }>;
    return items.filter((p) => p.id !== productId && normalizeName(p.name_es) === normalizedTyped);
  }, [dupCandidates, normalizedTyped, productId]);

  const [nameEn, setNameEn] = useState('');
  const [sku, setSku] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [productTypeId, setProductTypeId] = useState('');
  const [brand, setBrand] = useState('');
  const [descEs, setDescEs] = useState('');
  const [descEn, setDescEn] = useState('');
  const [origin, setOrigin] = useState('');
  const [shopId, setShopId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isFeatured, setIsFeatured] = useState(false);
  const [isSponsored, setIsSponsored] = useState(false);
  // Opt-in, so a newly created product never lands on the home page by itself.
  const [isNewArrival, setIsNewArrival] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [isTopSeller, setIsTopSeller] = useState(false);
  const [isQuotationEnabled, setIsQuotationEnabled] = useState(false);
  // Who the shop shows it to — both kinds of customer by default (lib/audience on the API).
  const [audience, setAudience] = useState<ProductAudience>('all');
  const [rating, setRating] = useState<string>('');
  const [ratingCount, setRatingCount] = useState<string>('');

  // Variants & images
  /**
   * Empty means "nobody has said", and such a product is sold at 0 % (the
   * user's default, 2026-11-01; effectiveVatCategory). It is NOT the same as
   * picking "0 %": that is an answer, sent and marked reviewed, while empty
   * sends nothing — so saving a price never turns into confirming a tax rate
   * nobody read, and the undecided products stay findable.
   */
  const [vatCategory, setVatCategory] = useState<VatCategory | ''>('');
  /** The band the prices on this form will carry once saved. */
  const formBand: VatCategory = vatCategory || 'zero';
  /** Under a typed base price: what a customer pays for it. Nothing at 0 %. */
  const withVatNote = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n) || n <= 0 || VAT_RATES[formBand] === 0) return null;
    return (
      <p className="mt-1 text-[11px] text-muted font-body tabular-nums">
        {t('productForm.variants.withVat', 'With IVA: {{price}}', { price: formatCurrency(priceWithVat(n, formBand)) })}
      </p>
    );
  };
  const [variants, setVariants] = useState<VariantRow[]>([emptyVariantRow()]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Hydrate when existing product loads
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
    setShopId(existingProduct.store_id ?? '');
    setIsActive(existingProduct.is_active ?? true);
    setIsFeatured(existingProduct.is_featured ?? false);
    setIsSponsored(existingProduct.is_sponsored ?? false);
    setIsNewArrival(existingProduct.is_new_arrival ?? false);
    setIsVerified(existingProduct.is_verified ?? false);
    setIsTopSeller(existingProduct.is_top_seller ?? false);
    setIsQuotationEnabled(existingProduct.is_quotation_enabled ?? false);
    setAudience(existingProduct.audience ?? 'all');
    // Only a reviewed band is worth showing back. An unreviewed one is the
    // default nobody confirmed, and pre-selecting it would turn "save the
    // price" into "confirm the tax rate" without anyone reading it.
    setVatCategory(existingProduct.vat_category_reviewed ? (existingProduct.vat_category ?? '') : '');
    setRating(existingProduct.rating != null ? String(existingProduct.rating) : '');
    setRatingCount(
      existingProduct.rating_count != null ? String(existingProduct.rating_count) : '',
    );
    setVariants(existingProduct.variants?.length ? existingProduct.variants.map(variantToRow) : [emptyVariantRow()]);
    setImageUrls(existingProduct.images?.map((i) => i.url) ?? []);
  }, [existingProduct]);

  // Case-normalise brand once Top Brands finish loading — if the DB row has
  // `ali baba` but the curated list has `ALI BABA`, snap to the canonical
  // casing so the <select> shows it selected instead of dropping to "custom".
  useEffect(() => {
    if (!brand) return;
    if (brandLookup.size === 0) return;
    const canonical = brandLookup.get(brand.toLowerCase());
    if (canonical && canonical !== brand) setBrand(canonical);
  }, [brand, brandLookup]);

  // Same case-normalisation for origin: whichever variant (`pakistan`,
  // `Pakistan`, `Pakistán`) is on the row snaps to the canonical `label_es`
  // when Shop-by-Origin loads. See [[brand-names-case-insensitive]].
  useEffect(() => {
    if (!origin) return;
    if (originLookup.size === 0) return;
    const canonical = originLookup.get(origin.toLowerCase());
    if (canonical && canonical !== origin) setOrigin(canonical);
  }, [origin, originLookup]);

  // Nutrition
  const [ingredients, setIngredients] = useState('');
  const [allergens, setAllergens] = useState<string[]>([]);
  const [storageInstructions, setStorageInstructions] = useState('');
  const [countryOfOrigin, setCountryOfOrigin] = useState(existingProduct?.origin ?? '');

  // Filtered subcategories
  const filteredSubcategories = useMemo(
    () => subcategories?.filter((s) => s.category_id === categoryId) ?? [],
    [subcategories, categoryId],
  );

  // Product types scoped to the currently-selected subcategory. Cascading
  // picker: only fires when a subcategory is picked; auto-clears via the
  // picker's onChange when subcategoryId changes. Placed AFTER the state
  // declaration on purpose — placing this near the other useAdmin* hooks
  // above would hit a TDZ crash on first render.
  const { data: productTypes } = useProductTypesForSubcategory(subcategoryId || undefined);

  // ── Variant Handlers ───────────────────────────────────

  function updateVariant(id: string, field: keyof VariantRow, value: string | boolean) {
    setVariants((prev) =>
      prev.map((v) => {
        if (v.id !== id) {
          // If setting a new default, unset others
          if (field === 'is_default' && value === true) {
            return { ...v, is_default: false };
          }
          return v;
        }
        return { ...v, [field]: value };
      }),
    );
  }

  function addVariant() {
    setVariants((prev) => [...prev, emptyVariantRow()]);
  }

  function removeVariant(id: string) {
    setVariants((prev) => prev.filter((v) => v.id !== id));
  }

  // Confirmed rather than immediate: the row carries price, stock and SKU,
  // there is no undo, and it sits one icon away from the default-variant
  // radio. Saved variants also disappear from the storefront the moment the
  // product is saved, which the dialog says out loud.
  const [variantPendingDelete, setVariantPendingDelete] = useState<string | null>(null);
  const pendingVariant = variants.find((v) => v.id === variantPendingDelete) ?? null;

  // ── Image Handlers ─────────────────────────────────────

  function removeImage(index: number) {
    setImageUrls((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const results = await Promise.all(list.map((f) => adminUploads.uploadImage('products', f)));
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

  // Sizes a business would pay the shop price for while B2B only is chosen.
  const b2bGaps = audience === 'b2b' ? variants.filter((v) => !(Number(v.b2b_price) > 0)) : [];

  // ── Submit ─────────────────────────────────────────────

  async function handleSave() {
    setSubmitError(null);

    // Validate top-level fields.
    const topParsed = productSchema.safeParse({
      nameEs, nameEn, categoryId, descEs, descEn, rating, ratingCount,
    });
    const nextTopErrors: typeof fieldErrors = {};
    if (!topParsed.success) {
      for (const issue of topParsed.error.issues) {
        const k = issue.path[0] as keyof typeof fieldErrors;
        if (k && !nextTopErrors[k]) nextTopErrors[k] = issue.message;
      }
    }

    // Validate each variant row independently so errors land on the right card.
    const nextVariantErrors: typeof variantErrors = {};
    if (variants.length === 0) {
      setSubmitError('At least one variant is required.');
    }
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

    // B2B only needs a B2B price on every size, or a business would pay the
    // shop price (lib/audience on the API, which refuses it too).
    for (const v of b2bGaps) {
      nextVariantErrors[v.id] = { ...nextVariantErrors[v.id], b2b_price: t('audience.needsB2bPrice', 'Needed for B2B only') };
    }

    setFieldErrors(nextTopErrors);
    setVariantErrors(nextVariantErrors);

    const hasTopErrors = Object.keys(nextTopErrors).length > 0;
    const hasVariantErrors = Object.keys(nextVariantErrors).length > 0;
    if (hasTopErrors || hasVariantErrors || variants.length === 0) {
      if (hasTopErrors) setActiveTab('basic');
      else if (hasVariantErrors) setActiveTab('variants');
      // Say what is wrong when the only thing wrong is a missing B2B price.
      const onlyB2bGaps = !hasTopErrors && variants.length > 0
        && Object.values(nextVariantErrors).every((e) => Object.keys(e).length === 1 && !!e.b2b_price);
      setSubmitError(onlyB2bGaps
        ? t('audience.needsB2bPriceSave', 'Give every size a B2B price to show it to B2B only.')
        : 'Please fix the highlighted fields.');
      return;
    }

    // Ensure exactly one default
    const hasDefault = variants.some((v) => v.is_default);
    const variantsPayload = variants.map((v, idx) => ({
      // Only send id if it looks like a real UUID (not a "new-..." placeholder)
      ...(v.id && !v.id.startsWith('new-') ? { id: v.id } : {}),
      name_es: v.name_es,
      name_en: v.name_es, // mirror — UI doesn't expose name_en for variants
      price: parseFloat(v.price) || 0,
      compare_at_price: v.compare_at_price ? parseFloat(v.compare_at_price) : null,
      b2b_price: v.b2b_price ? parseFloat(v.b2b_price) : null,
      // Blank is 0, "not entered" — the same as a size that never had one.
      cost_price: Math.max(0, parseFloat(v.cost_price) || 0),
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

    // Brand names are treated case-insensitively — if the typed value matches
    // an existing Top Brand (regardless of case), persist the canonical casing
    // so the DB doesn't accumulate look-alikes like "Shan"/"SHAN"/"shan".
    // Anything not in the curated list is kept as typed (trimmed).
    const trimmedBrand = brand.trim();
    const canonicalBrand = trimmedBrand
      ? (brandOptions.find((n) => n.toLowerCase() === trimmedBrand.toLowerCase()) ?? trimmedBrand)
      : null;
    // Same rule for origin — resolve to the canonical Spanish label if the
    // curated list has any case-variant match (accepts key/label_en/label_es).
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
      store_id: shopId || null,
      category_id: categoryId,
      subcategory_id: subcategoryId || null,
      product_type_id: productTypeId || null,
      is_active: isActive,
      is_featured: isFeatured,
      is_sponsored: isSponsored,
      is_new_arrival: isNewArrival,
      is_verified: isVerified,
      is_top_seller: isTopSeller,
      is_quotation_enabled: isQuotationEnabled,
      audience,
      // Sent only when chosen. The API treats its presence as a human
      // answering, and marks the product reviewed on the strength of it.
      ...(vatCategory ? { vat_category: vatCategory } : {}),
      rating: rating.trim() === '' ? null : Math.min(5, Math.max(0, parseFloat(rating))),
      rating_count: ratingCount.trim() === '' ? 0 : Math.max(0, parseInt(ratingCount, 10) || 0),
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
      if (unpricedSizesOf(err)) {
        setActiveTab('variants');
        setSubmitError(t('audience.needsB2bPriceSave', 'Give every size a B2B price to show it to B2B only.'));
        return;
      }
      setSubmitError(err instanceof Error ? err.message : 'Save failed');
    }
  }
  const isSaving = createProduct.isPending || updateProduct.isPending;

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="space-y-0">
      {/* Header */}
      <BackLink
        label={t('common.backToProducts', 'Back to products')}
        onClick={() => goBack(returnTo)}
        className="mb-3"
      />
      <div className="flex items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">
            {isEdit ? t('productForm.titleEdit') : t('productForm.titleNew')}
          </h1>
          <p className="text-sm text-muted mt-0.5">
            {isEdit
              ? `${t('productForm.basic.editingLabel')} ${existingProduct?.name_es ?? ''}`
              : t('productForm.newProductSubtitle')}
          </p>
        </div>
      </div>

      {/* Quick-create leaves a row sellable but half-described. Clearing the
          flag is its own button rather than something Save does, so an admin
          fixing a price does not silently empty the queue. */}
      {existingProduct?.review_needed && (
        <div className="mb-6 rounded-xl border border-warning/30 bg-warning-bg px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">
              {t('productForm.reviewNeededTitle', 'Added in a hurry — needs review')}
            </p>
            <p className="text-xs text-gray mt-0.5 leading-snug">
              {t('productForm.reviewNeededBody', 'Created from the quick-add form, so images, descriptions and taxonomy are probably missing.')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!productId) return;
              markReviewed.mutate(productId, {
                onSuccess: () => toast.success(t('productForm.reviewCleared', 'Marked as reviewed')),
                onError: (err) => toast.error(
                  t('productForm.reviewClearFailed', 'Could not mark it as reviewed'),
                  err instanceof Error ? err.message : String(err),
                ),
              });
            }}
            disabled={markReviewed.isPending}
            className="shrink-0 h-9 px-3 rounded-lg bg-card border-2 border-border hover:border-brand text-xs font-semibold font-display text-ink disabled:opacity-60"
          >
            {t('productForm.markReviewed', 'Mark as reviewed')}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-border mb-6">
        {/* One sideways-scrolling line on a phone (.tab-strip): "Variants &
            Pricing" wrapped onto three lines (2026-11-05). */}
        <div className="tab-strip flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 sm:px-5 py-3 text-sm font-semibold font-display border-b-2 transition ${
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

      {/* Tab Content */}
      <div className="bg-card rounded-xl border border-border p-6">
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
                {/* Similar-product warning: fires when the typed name matches
                    an existing product's normalised name. Non-blocking — the
                    admin can still submit if they know what they're doing. */}
                {similarProducts.length > 0 && !fieldErrors.nameEs && (
                  <div className="mt-1.5 bg-amber-mist/50 border border-amber/40 rounded-lg p-2.5 text-[12px] text-ink font-body">
                    <p className="font-semibold text-warning inline-flex items-center gap-1.5 mb-1">
                      <Copy size={12} strokeWidth={2.5} />
                      A product with this name already exists
                    </p>
                    <ul>
                      {similarProducts.map((p) => (
                        <li key={p.id}>
                          <Link
                            to={`/products/${p.id}/edit`}
                            target="_blank"
                            className="inline-block py-1.5 sm:py-0.5 text-brand hover:text-brand-mid underline underline-offset-2"
                          >
                            {p.name_es}
                          </Link>
                          {!p.is_active && <span className="ml-1.5 text-muted italic">(inactive)</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
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
                  onChange={(v) => { setCategoryId(v); setSubcategoryId(''); }}
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
                  onChange={(v) => {
                    setSubcategoryId(v);
                    // Cascading picker — always clear the product type when
                    // the parent subcategory changes so we can't accidentally
                    // save a type-from-another-subcategory FK.
                    setProductTypeId('');
                  }}
                  disabled={!categoryId || filteredSubcategories.length === 0}
                  placeholder={
                    !categoryId
                      ? '— Selecciona categoría primero —'
                      : filteredSubcategories.length === 0
                        ? '— Sin subcategorías —'
                        : '— Selecciona subcategoría —'
                  }
                  ariaLabel={t('productForm.basic.subcategory')}
                  options={filteredSubcategories.map((sub): ComboboxOption => ({
                    value: sub.id, label: sub.name_es,
                  }))}
                />
              </div>
            </div>

            {/* Product type — third-tier taxonomy. Cascading from subcategory.
                Optional field: many products fit fine at just the subcategory
                level (backend FK is nullable). Types are managed on the
                Categories page under each subcategory. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className={labelClass}>Product type</label>
                <Combobox
                  value={productTypeId}
                  onChange={setProductTypeId}
                  disabled={!subcategoryId || !productTypes || productTypes.length === 0}
                  placeholder={
                    !subcategoryId
                      ? '— Selecciona subcategoría primero —'
                      : !productTypes || productTypes.length === 0
                        ? '— No hay tipos —'
                        : '— Opcional: elige tipo —'
                  }
                  ariaLabel="Product type"
                  options={[
                    { value: '', label: '— Sin tipo —' } as ComboboxOption,
                    ...((productTypes ?? []).map((t): ComboboxOption => ({
                      value: t.id, label: t.name_es,
                    }))),
                  ]}
                />
              </div>

              <div>
                <label className={labelClass}>{t('productForm.basic.vat', 'IVA')}</label>
                <Combobox
                  value={vatCategory}
                  onChange={(v) => setVatCategory(v as VatCategory | '')}
                  ariaLabel={t('productForm.basic.vat', 'IVA')}
                  placeholder={t('productForm.basic.vatUnset', '\u2014 0 % por defecto \u2014')}
                  options={[
                    { value: '', label: t('productForm.basic.vatUnset', '\u2014 0 % por defecto \u2014') } as ComboboxOption,
                    { value: 'zero', label: t('productForm.basic.vatZero', '0 % \u2014 Sin IVA') },
                    { value: 'super_reduced', label: t('productForm.basic.vatSuperReduced', '4 % \u2014 Superreducido (pan, leche, huevos, fruta, verdura)') },
                    { value: 'reduced', label: t('productForm.basic.vatReduced', '10 % \u2014 Reducido (resto de alimentaci\u00f3n)') },
                    { value: 'general', label: t('productForm.basic.vatGeneral', '21 % \u2014 General (no alimentario)') },
                  ]}
                />
                <p className={`mt-1.5 text-xs font-body ${vatCategory ? 'text-muted' : 'text-warning'}`}>
                  {vatCategory
                    ? t('productForm.basic.vatAdded', 'Los precios se guardan sin IVA; el cliente paga el precio m\u00e1s este {{rate}} %.', { rate: VAT_RATES[formBand] })
                    : t('productForm.basic.vatHint', 'Se vende al 0 % hasta que elijas un tipo de IVA.')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {(() => {
                // Case-insensitive membership check against the curated list.
                // Trim + lowercase both sides so `ALI BABA`, `Ali Baba`, and
                // `ali baba ` all count as the same curated brand.
                const trimmedBrand = brand.trim();
                const brandInList = trimmedBrand !== '' && brandLookup.has(trimmedBrand.toLowerCase());
                // Guard the orphan warning behind loaded Top Brands so we don't
                // flash "not in Top Brands" while the query is still in flight.
                const showOrphan = !brandsLoading && !!trimmedBrand && !brandInList;
                return (
                  <div>
                    <label className={labelClass}>{t('productForm.basic.brand')}</label>
                    <Combobox
                      value={brand}
                      onChange={(v) => {
                        if (v === '__ADD_NEW__') {
                          // Sentinel — don't commit to state. Send the admin
                          // to the Top Brands editor instead so they can add
                          // the new brand with a logo + background properly.
                          navigate('/brands');
                          return;
                        }
                        setBrand(v);
                      }}
                      disabled={brandsLoading}
                      placeholder={brandsLoading ? 'Loading brands…' : 'No brand'}
                      ariaLabel="Brand"
                      options={[
                        { value: '', label: '— No brand —' },
                        // Orphan row: show the current brand at the top with a
                        // warning treatment so admins can see what's stored
                        // even if it isn't in the curated list.
                        ...(showOrphan
                          ? [{ kind: 'warning' as const, value: brand, label: `${brand} (not in Top Brands)` }]
                          : []),
                        ...brandOptions.map((name): ComboboxOption => ({ value: name, label: name })),
                        ...(brandOptions.length > 0 ? [{ kind: 'separator' as const } as ComboboxOption] : []),
                        { kind: 'action' as const, value: '__ADD_NEW__', label: '+ Add new brand…' },
                      ]}
                    />

                    {showOrphan ? (
                      <div className="mt-2 flex items-start gap-2 rounded-lg border border-warning/40 bg-amber-mist/60 px-3 py-2">
                        <AlertTriangle size={14} strokeWidth={2} className="text-warning shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0 text-[12px] font-body text-warning">
                          "<span className="font-semibold">{brand}</span>" isn't in your Top Brands list. It will still save on the product, but the customer brand rail won't feature it until you add it there.
                          <div className="mt-1.5 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => navigate('/brands')}
                              className="inline-flex items-center gap-1 h-9 sm:h-7 px-3 sm:px-2.5 rounded-full bg-brand text-white text-[11px] font-semibold font-display hover:bg-brand-mid transition-colors"
                            >
                              <Plus size={12} strokeWidth={2.5} />
                              Open Top Brands editor
                            </button>
                            <button
                              type="button"
                              onClick={() => setBrand('')}
                              className="inline-flex items-center gap-1 h-9 sm:h-7 px-3 sm:px-2.5 rounded-full bg-card border border-border text-[11px] font-semibold font-display text-ink hover:border-danger hover:text-danger transition-colors"
                            >
                              Clear
                            </button>
                          </div>
                          <p className="mt-1 text-[11px] text-amber-deep/80 font-display">
                            Any unsaved product edits on this page will be lost — save the product first if you want to keep them.
                          </p>
                        </div>
                      </div>
                    ) : brandOptions.length === 0 && !brandsLoading ? (
                      <p className="mt-1 text-[11px] text-muted font-display">
                        No Top Brands yet. Choose "+ Add new brand" above to open the Top Brands editor.
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-muted font-display">
                        Curated in Home Sections → Top Brands ({brandOptions.length}). Choose "+ Add new brand" above to create a new one there.
                      </p>
                    )}
                  </div>
                );
              })()}
              {(() => {
                // Same UX as the brand dropdown: curated options + orphan
                // banner + "+ Add new origin…" that jumps to Shop by Origin.
                const trimmedOriginVal = origin.trim();
                const originInList =
                  trimmedOriginVal !== '' && originLookup.has(trimmedOriginVal.toLowerCase());
                const showOriginOrphan = !originsLoading && !!trimmedOriginVal && !originInList;
                return (
                  <div>
                    <label className={labelClass}>{t('productForm.basic.origin')}</label>
                    <Combobox
                      value={origin}
                      onChange={(v) => {
                        if (v === '__ADD_NEW__') {
                          navigate('/origins');
                          return;
                        }
                        setOrigin(v);
                      }}
                      disabled={originsLoading}
                      placeholder={originsLoading ? 'Loading origins…' : 'No origin'}
                      ariaLabel={t('productForm.basic.origin')}
                      options={[
                        { value: '', label: '— No origin —' },
                        ...(showOriginOrphan
                          ? [{ kind: 'warning' as const, value: origin, label: `${origin} (not in Shop by Origin)` }]
                          : []),
                        ...originOptions.map((label): ComboboxOption => ({ value: label, label })),
                        ...(originOptions.length > 0 ? [{ kind: 'separator' as const } as ComboboxOption] : []),
                        { kind: 'action' as const, value: '__ADD_NEW__', label: '+ Add new origin…' },
                      ]}
                    />

                    {showOriginOrphan ? (
                      <div className="mt-2 flex items-start gap-2 rounded-lg border border-warning/40 bg-amber-mist/60 px-3 py-2">
                        <AlertTriangle size={14} strokeWidth={2} className="text-amber-deep shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0 text-[12px] font-body text-amber-deep">
                          "<span className="font-semibold">{origin}</span>" isn't in your Shop by Origin cards. It will still save on the product, but the customer origin rail won't feature it until you add it there.
                          <div className="mt-1.5 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => navigate('/origins')}
                              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-brand text-white text-[11px] font-semibold font-display hover:bg-brand-mid transition-colors"
                            >
                              <Plus size={12} strokeWidth={2.5} />
                              Open Shop by Origin editor
                            </button>
                            <button
                              type="button"
                              onClick={() => setOrigin('')}
                              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-card border border-border text-[11px] font-semibold font-display text-ink hover:border-danger hover:text-danger transition-colors"
                            >
                              Clear
                            </button>
                          </div>
                          <p className="mt-1 text-[11px] text-amber-deep/80 font-display">
                            Any unsaved product edits on this page will be lost — save the product first if you want to keep them.
                          </p>
                        </div>
                      </div>
                    ) : originOptions.length === 0 && !originsLoading ? (
                      <p className="mt-1 text-[11px] text-muted font-display">
                        No Shop by Origin cards yet. Choose "+ Add new origin" above to open the editor.
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-muted font-display">
                        Curated in Home Sections → Shop by Origin ({originOptions.length}). Choose "+ Add new origin" above to add a new one there.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
            <div>
              <label className={labelClass}>Shop</label>
              {(() => {
                // Orphan = product linked to a Store row that's not active
                // (typically an Excel-importer suggestion awaiting review).
                // Same UX pattern as brand + origin: keep the current value
                // visible as a warning pill and add a banner nudging the
                // admin to the /stores editor.
                const storeRow = shopId ? storeById.get(shopId) : null;
                const showOrphan = !!storeRow && !storeRow.is_active;
                const orphanName = storeRow?.name ?? '';
                return (
                  <>
                    <Combobox
                      value={shopId}
                      onChange={(v) => {
                        if (v === '__ADD_NEW_STORE__') {
                          navigate('/stores/new');
                          return;
                        }
                        setShopId(v);
                      }}
                      ariaLabel="Shop"
                      options={[
                        ...(showOrphan
                          ? [{ kind: 'warning' as const, value: shopId, label: `${orphanName} (not active)` }]
                          : []),
                        ...shopOptions.map((opt): ComboboxOption => ({ value: opt.id, label: opt.name })),
                        { kind: 'separator' as const },
                        { kind: 'action' as const, value: '__ADD_NEW_STORE__', label: '+ Add new store…' },
                      ]}
                    />
                    {showOrphan ? (
                      <div className="mt-2 flex items-start gap-2 rounded-lg border border-warning/40 bg-amber-mist/60 px-3 py-2">
                        <AlertTriangle size={14} strokeWidth={2} className="text-amber-deep shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0 text-[12px] font-body text-amber-deep">
                          "<span className="font-semibold">{orphanName}</span>" is inactive — likely an Excel-importer suggestion awaiting review. Products linked to inactive stores fall back to the Cesto default on the storefront until you review the store.
                          <div className="mt-1.5 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => navigate(`/stores/${shopId}/edit?promote=1`)}
                              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-brand text-white text-[11px] font-semibold font-display hover:bg-brand-mid transition-colors"
                            >
                              <Plus size={12} strokeWidth={2.5} />
                              Review &amp; create the store
                            </button>
                            <button
                              type="button"
                              onClick={() => setShopId('')}
                              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-card border border-border text-[11px] font-semibold font-display text-ink hover:border-danger hover:text-danger transition-colors"
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted font-display mt-1">
                        Leave as Cesto Shop unless this product is sold by a partner shop on the home page.
                      </p>
                    )}
                  </>
                );
              })()}
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

            {/* Who sees it: both kinds of customer, B2C only or B2B only. */}
            <div className="pt-2">
              <p className="text-sm font-semibold font-display text-ink mb-1.5">{t('audience.label', 'Shown to')}</p>
              <AudienceSegmented value={audience} onChange={setAudience} />
              {b2bGaps.length > 0 && (
                <div className="mt-3 rounded-xl border border-warning/30 bg-warning-bg px-4 py-3 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" strokeWidth={1.75} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{t('audience.priceFirstTitle', 'Set a B2B price first')}</p>
                    <p className="text-xs text-gray mt-0.5 leading-snug">
                      {t('audience.formGapBody', {
                        sizes: b2bGaps.map((v) => v.name_es.trim() || t('audience.newSize', 'new size')).join(', '),
                        defaultValue: 'A business would pay the shop price for: {{sizes}}.',
                      })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('variants')}
                    className="shrink-0 h-9 px-3 rounded-lg bg-card border-2 border-border hover:border-brand text-xs font-semibold font-display text-ink"
                  >
                    {t('audience.formGapAction', 'Add B2B prices')}
                  </button>
                </div>
              )}
            </div>

            {/* Toggles */}
            <div className="flex flex-wrap gap-6 pt-2">
              <label className="flex items-center gap-3 cursor-pointer">
                <button
                  type="button"
                  role="switch"
                  aria-checked={isActive}
                  onClick={() => setIsActive(!isActive)}
                  className={`relative w-11 h-6 shrink-0 rounded-full transition ${
                    isActive ? 'bg-brand' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-card shadow transition-transform ${
                      isActive ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
                <span className="text-sm font-display text-ink">{t('productForm.basic.active')}</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <button
                  type="button"
                  role="switch"
                  aria-checked={isFeatured}
                  onClick={() => setIsFeatured(!isFeatured)}
                  className={`relative w-11 h-6 shrink-0 rounded-full transition ${
                    isFeatured ? 'bg-brand' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-card shadow transition-transform ${
                      isFeatured ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
                <span className="text-sm font-display text-ink">{t('productForm.basic.featured')}</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <button
                  type="button"
                  role="switch"
                  aria-checked={isSponsored}
                  onClick={() => setIsSponsored(!isSponsored)}
                  className={`relative w-11 h-6 shrink-0 rounded-full transition ${
                    isSponsored ? 'bg-brand' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-card shadow transition-transform ${
                      isSponsored ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
                <span className="text-sm font-display text-ink">Sponsored</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <button
                  type="button"
                  role="switch"
                  aria-checked={isNewArrival}
                  onClick={() => setIsNewArrival(!isNewArrival)}
                  className={`relative w-11 h-6 shrink-0 rounded-full transition ${
                    isNewArrival ? 'bg-brand' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-card shadow transition-transform ${
                      isNewArrival ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
                <span className="text-sm font-display text-ink">
                  New product
                  {/* The row is never empty now — it tops itself up. Saying so
                      here stops the toggle reading as "switch this on or the
                      section disappears", which is what it used to mean. */}
                  <span className="block text-[11px] text-muted font-body">
                    Pins this product to the top of the home “New products” row.
                    Anything not pinned is filled in automatically with recent
                    products that are in stock.
                  </span>
                </span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <button
                  type="button"
                  role="switch"
                  aria-checked={isVerified}
                  onClick={() => setIsVerified(!isVerified)}
                  className={`relative w-11 h-6 shrink-0 rounded-full transition ${
                    isVerified ? 'bg-brand' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-card shadow transition-transform ${
                      isVerified ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
                <span className="text-sm font-display text-ink">Verified</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <button
                  type="button"
                  role="switch"
                  aria-checked={isTopSeller}
                  onClick={() => setIsTopSeller(!isTopSeller)}
                  className={`relative w-11 h-6 shrink-0 rounded-full transition ${
                    isTopSeller ? 'bg-brand' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-card shadow transition-transform ${
                      isTopSeller ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
                <span className="text-sm font-display text-ink">Top seller</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <button
                  type="button"
                  role="switch"
                  aria-checked={isQuotationEnabled}
                  onClick={() => setIsQuotationEnabled(!isQuotationEnabled)}
                  className={`relative w-11 h-6 shrink-0 rounded-full transition ${
                    isQuotationEnabled ? 'bg-brand' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-card shadow transition-transform ${
                      isQuotationEnabled ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
                <span className="text-sm font-display text-ink">
                  Quotation enabled
                  <span className="block text-[11px] text-muted font-body">
                    Shows a "Request quotation" button on the product page
                  </span>
                </span>
              </label>
            </div>

            {/* Rating inputs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-sm font-semibold font-display text-ink mb-1.5">
                  Rating <span className="font-normal text-gray">(0–5)</span>
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="5"
                  value={rating}
                  onChange={(e) => setRating(e.target.value)}
                  placeholder="e.g. 4.5"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold font-display text-ink mb-1.5">
                  Rating count
                </label>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={ratingCount}
                  onChange={(e) => setRatingCount(e.target.value)}
                  placeholder="e.g. 124"
                  className={inputClass}
                />
              </div>
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
            {/* What these prices ARE (user, 2026-11-01): bases, without IVA.
                The rate is picked on the first tab; each price shows below
                what a customer will pay with it. */}
            <p className="-mt-2 text-xs font-body text-muted">
              {t('productForm.variants.pricesExclVat', 'Prices are without IVA. Customers pay them plus this product’s IVA: {{rate}} %.', { rate: VAT_RATES[formBand] })}
            </p>

            {/* Column headers — one line per size from xl only. With the
                buying price that is nine columns, and below 1280px the size
                name was squeezed to nothing and the delete button pushed out
                of the card; there each size is a small labelled grid instead
                (captions below), which also gives the fields the labels they
                never had on a narrow screen. */}
            <div className="hidden xl:grid grid-cols-[1fr_92px_92px_92px_92px_80px_80px_56px_36px] gap-3 px-1">
              <span className="text-xs font-semibold text-gray uppercase font-display">{t('productForm.variants.nameEs')}</span>
              <span className="text-xs font-semibold text-gray uppercase font-display">{t('productForm.variants.price')}</span>
              <span className="text-xs font-semibold text-gray uppercase font-display">{t('productForm.variants.comparePrice')}</span>
              <span className="text-xs font-semibold text-gray uppercase font-display" title={t('productForm.variants.b2bPriceHint', 'Wholesale price shown only to B2B customers')}>
                {t('productForm.variants.b2bPrice', 'B2B Price')}
              </span>
              <span className="text-xs font-semibold text-gray uppercase font-display" title={t('productForm.variants.costPriceHint', 'What we pay for one. Only admins see it — never the shop or the sales reps.')}>
                {t('productForm.variants.costPrice', 'Buying price')}
              </span>
              <span className="text-xs font-semibold text-gray uppercase font-display">{t('productForm.variants.stock')}</span>
              <span className="text-xs font-semibold text-gray uppercase font-display">{t('productForm.variants.lowStockThreshold')}</span>
              <span className="text-xs font-semibold text-gray uppercase font-display">{t('productForm.variants.default')}</span>
              <span />
            </div>

            {variants.map((v) => {
              const rowErrs = variantErrors[v.id] ?? {};
              const errCls = (err?: string) =>
                err ? 'border-danger focus:ring-danger/20' : '';
              // The header's words, over each field until the header shows.
              const cap = (text: string) => (
                <span className="xl:hidden block mb-1 text-[11px] font-semibold text-gray uppercase font-display">{text}</span>
              );
              return (
              <div
                key={v.id}
                className={`grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-[1fr_92px_92px_92px_92px_80px_80px_56px_36px] gap-3 items-start bg-surface-cream border rounded-lg p-3 ${
                  Object.keys(rowErrs).length ? 'border-danger/40' : 'border-border'
                }`}
              >
                <div className="col-span-2 sm:col-span-4 xl:col-span-1">
                  {cap(t('productForm.variants.nameEs'))}
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
                  {cap(t('productForm.variants.price'))}
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
                  {withVatNote(v.price)}
                </div>
                <div>
                  {cap(t('productForm.variants.comparePrice'))}
                  <input
                    type="number"
                    step="0.01"
                    value={v.compare_at_price}
                    onChange={(e) => updateVariant(v.id, 'compare_at_price', e.target.value)}
                    placeholder="0.00"
                    className={inputClass}
                  />
                </div>
                <div>
                  {cap(t('productForm.variants.b2bPrice', 'B2B Price'))}
                  <input
                    type="number"
                    step="0.01"
                    value={v.b2b_price}
                    onChange={(e) => updateVariant(v.id, 'b2b_price', e.target.value)}
                    placeholder="0.00"
                    title={t('productForm.variants.b2bPriceHint', 'Wholesale price shown only to B2B customers')}
                    aria-label={t('audience.b2bPriceFor', 'B2B price for {{size}}', { size: v.name_es })}
                    aria-invalid={!!rowErrs.b2b_price}
                    className={`${inputClass} ${errCls(rowErrs.b2b_price)}`}
                  />
                  {rowErrs.b2b_price && (
                    <p role="alert" className="mt-1 text-[11.5px] text-danger font-display font-medium">{rowErrs.b2b_price}</p>
                  )}
                  {withVatNote(v.b2b_price)}
                </div>
                <div>
                  {cap(t('productForm.variants.costPrice', 'Buying price'))}
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={v.cost_price}
                    onChange={(e) => updateVariant(v.id, 'cost_price', e.target.value)}
                    placeholder="0.00"
                    title={t('productForm.variants.costPriceHint', 'What we pay for one. Only admins see it — never the shop or the sales reps.')}
                    aria-label={t('productForm.variants.costPriceFor', 'Buying price for {{size}}', { size: v.name_es })}
                    className={inputClass}
                  />
                </div>
                <div>
                  {cap(t('productForm.variants.stock'))}
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
                <div>
                  {cap(t('productForm.variants.lowStockThreshold'))}
                  <input
                    type="number"
                    value={v.low_stock_threshold}
                    onChange={(e) => updateVariant(v.id, 'low_stock_threshold', e.target.value)}
                    className={inputClass}
                  />
                </div>
                <label className="flex items-center gap-2 xl:justify-center h-11 xl:h-auto xl:pt-3 cursor-pointer">
                  <input
                    type="radio"
                    name="default_variant"
                    checked={v.is_default}
                    onChange={() => updateVariant(v.id, 'is_default', true)}
                    className="w-4 h-4 text-brand accent-brand"
                  />
                  <span className="xl:hidden text-[13px] font-semibold text-ink font-display">{t('productForm.variants.default')}</span>
                </label>
                <button
                  type="button"
                  onClick={() => setVariantPendingDelete(v.id)}
                  disabled={variants.length <= 1}
                  className="w-9 h-9 justify-self-end xl:justify-self-auto rounded-lg flex items-center justify-center hover:bg-danger-bg transition disabled:opacity-30 mt-1 xl:mt-0.5"
                  title={t('productForm.variants.deleteVariant')}
                  aria-label={t('productForm.variants.deleteVariant')}
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
            {/* Drop zone */}
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

            {/* Existing images */}
            {imageUrls.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold font-display text-ink mb-3">
                  {t('productForm.images.current', { count: imageUrls.length })}
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {imageUrls.map((url, idx) => (
                    <div key={url} className="relative group">
                      <img
                        src={resolveImageUrl(url, 'thumb')}
                        alt={t('productForm.images.imageAlt', { index: idx + 1 })}
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
                        <span className="absolute bottom-2 left-2 text-[11px] font-semibold font-display bg-brand text-white px-2 py-0.5 rounded-full">
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
                        if (e.target.checked) {
                          setAllergens((prev) => [...prev, a.key]);
                        } else {
                          setAllergens((prev) => prev.filter((k) => k !== a.key));
                        }
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
        message={
          pendingVariant
            ? t(
                'productForm.variants.deleteConfirm',
                // Interpolated in the default too, so adding the locale key
                // later needs no change here. Names the row because the
                // button sits in a table where every row looks identical.
                '"{{name}}" will be removed when you save. Past orders that include it are not affected.',
                { name: pendingVariant.name_es || t('productForm.variants.untitled', 'Untitled variant') },
              )
            : ''
        }
        confirmLabel={t('productForm.variants.deleteConfirmAction', 'Delete variant')}
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
