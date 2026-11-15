import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useGoBack } from '@/lib/useGoBack';
import { useTranslation } from 'react-i18next';
import { Eye, Loader2, Save } from 'lucide-react';
import {
  useAdminStore,
  useCreateStore,
  useUpdateStore,
  useAssignStoreProducts,
  useUnassignStoreProducts,
  defaultShopHours,
  WEEKDAY_KEYS,
  weekdayLabel,
  type ShopHours,
  type ShopHoursDay,
  type WeekdayKey,
  type StoreWritePayload,
} from '@grocery-app/shared';
import { TextField, Textarea, Checkbox } from '@/components/form';
import BackLink from '@/components/BackLink';
import ImageUploadField from '@/components/home-preview/ImageUploadField';
import { useToast } from '@/components/Toast';
import ManageStoreProductsModal from '@/components/ManageStoreProductsModal';
import StorePreviewOverlay, { type PreviewState, type StorePreviewDraft } from '@/components/StorePreview';
import StorePartnerPanel from '@/components/partner/StorePartnerPanel';
import StoreProductsList from '@/components/StoreProductsList';

interface StoreForm {
  slug: string;
  name: string;
  tagline_es: string;
  tagline_en: string;
  description_es: string;
  description_en: string;
  logo_url: string | null;
  logo_bg: string;
  cover_url: string | null;
  rating: string;
  rating_count: string;
  is_active: boolean;
  is_verified: boolean;
  fast_delivery: boolean;
  /** Lifecycle. Only 'live' surfaces on customer web (customerVisibleStoreFilter). */
  status: 'draft' | 'live' | 'paused' | 'suspended';
  /** MV test-data flag. Legacy partner approvals landed with is_test=true and
   *  customerVisibleStoreFilter excludes those; admin flips this off to
   *  publish the store to real customers. */
  is_test: boolean;
  /** ISO 3166-1 alpha-2 market the store trades in. */
  country: string;
  address: string;
  origin: string;
  contact_email: string;
  contact_phone: string;
  website_url: string;
  shop_hours: ShopHours;
  sort_order: string;
}

const emptyForm: StoreForm = {
  slug: '',
  name: '',
  tagline_es: '',
  tagline_en: '',
  description_es: '',
  description_en: '',
  logo_url: null,
  logo_bg: '#FFFFFF',
  cover_url: null,
  rating: '',
  rating_count: '0',
  is_active: true,
  is_verified: false,
  fast_delivery: false,
  status: 'live',
  is_test: false,
  country: 'ES',
  address: '',
  origin: '',
  contact_email: '',
  contact_phone: '',
  website_url: '',
  shop_hours: defaultShopHours(),
  sort_order: '0',
};

type Tab = 'identity' | 'branding' | 'hours' | 'contact' | 'products' | 'partner';

export default function StoreFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const { storeId } = useParams<{ storeId: string }>();
  const [searchParams] = useSearchParams();
  const isEdit = !!storeId;
  const toast = useToast();

  const { data: existing, isLoading: loadingExisting } = useAdminStore(storeId);
  // `promoteMode` is on when the admin arrived here by clicking "Review &
  // create" on a store suggestion (an Excel-importer auto-create sitting
  // at is_active=false + source='import'). The URL carries ?promote=1;
  // we also double-check the loaded store actually matches that shape so
  // a stale bookmark doesn't accidentally reframe an already-published
  // store's edit page.
  const promoteMode =
    isEdit
    && searchParams.get('promote') === '1'
    && existing?.source === 'import'
    && existing?.is_active === false;
  const createStore = useCreateStore();
  const updateStore = useUpdateStore();
  const assignProducts = useAssignStoreProducts();
  const unassignProducts = useUnassignStoreProducts();

  const [form, setForm] = useState<StoreForm>(emptyForm);
  const [productsModalOpen, setProductsModalOpen] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof StoreForm, string>>>({});
  // ?tab=partner opens on who manages it (the stores list links there).
  const [activeTab, setActiveTab] = useState<Tab>(() => (searchParams.get('tab') === 'partner' && storeId ? 'partner' : 'identity'));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>('closed');
  const [previewLang, setPreviewLang] = useState<'en' | 'es'>('es');

  // Distilled snapshot of the fields the preview needs. Recomputed on every
  // form change so the overlay stays in sync as the admin types.
  const previewDraft: StorePreviewDraft = {
    name: form.name,
    slug: form.slug,
    tagline_es: form.tagline_es,
    tagline_en: form.tagline_en,
    description_es: form.description_es,
    description_en: form.description_en,
    logo_url: form.logo_url,
    logo_bg: form.logo_bg,
    cover_url: form.cover_url,
    rating: form.rating,
    rating_count: form.rating_count,
    is_verified: form.is_verified,
    fast_delivery: form.fast_delivery,
    shop_hours: form.shop_hours,
  };

  useEffect(() => {
    if (!existing) return;
    setForm({
      slug: existing.slug,
      name: existing.name,
      tagline_es: existing.tagline_es ?? '',
      tagline_en: existing.tagline_en ?? '',
      description_es: existing.description_es ?? '',
      description_en: existing.description_en ?? '',
      logo_url: existing.logo_url,
      logo_bg: existing.logo_bg,
      cover_url: existing.cover_url,
      rating: existing.rating != null ? String(existing.rating) : '',
      rating_count: String(existing.rating_count),
      // In promote-mode (came from clicking "Review & create" on a
      // suggestion) default is_active to true so hitting Save publishes
      // the storefront. Otherwise trust whatever the row currently holds.
      is_active: promoteMode ? true : existing.is_active,
      is_verified: existing.is_verified,
      fast_delivery: existing.fast_delivery,
      // Same promoteMode rationale — a suggestion being reviewed should
      // publish to 'live' on save unless admin flips it back to draft.
      status: promoteMode ? 'live' : (existing.status ?? 'live'),
      // promoteMode = reviewing a suggestion. Suggestions are Excel-importer
      // auto-creates with is_test=false already, so no override needed.
      is_test: existing.is_test ?? false,
      country: existing.country ?? 'ES',
      address: existing.address ?? '',
      origin: existing.origin ?? '',
      contact_email: existing.contact_email ?? '',
      contact_phone: existing.contact_phone ?? '',
      website_url: existing.website_url ?? '',
      shop_hours: (existing.shop_hours as ShopHours) ?? defaultShopHours(),
      sort_order: String(existing.sort_order),
    });
  }, [existing]);

  const assignedIds = useMemo(() => existing?.product_ids ?? [], [existing]);

  function setField<K extends keyof StoreForm>(key: K, value: StoreForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function setDay(key: WeekdayKey, next: ShopHoursDay) {
    setForm((prev) => ({ ...prev, shop_hours: { ...prev.shop_hours, [key]: next } }));
  }

  function toPayload(): StoreWritePayload | null {
    const nextErrors: Partial<Record<keyof StoreForm, string>> = {};
    if (!form.name.trim()) nextErrors.name = t('common.required', 'Required.');
    if (form.rating && Number.isNaN(parseFloat(form.rating))) nextErrors.rating = t('common.invalidNumber', 'Must be a number.');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      // Jump to the tab that owns the first error so the user sees it.
      if (nextErrors.name) setActiveTab('identity');
      else if (nextErrors.rating) setActiveTab('identity');
      return null;
    }
    return {
      slug: form.slug.trim() || undefined,
      name: form.name.trim(),
      tagline_es: form.tagline_es.trim() || null,
      tagline_en: form.tagline_en.trim() || null,
      description_es: form.description_es.trim() || null,
      description_en: form.description_en.trim() || null,
      logo_url: form.logo_url,
      logo_bg: form.logo_bg,
      cover_url: form.cover_url,
      rating: form.rating ? parseFloat(form.rating) : null,
      rating_count: parseInt(form.rating_count || '0', 10) || 0,
      is_active: form.is_active,
      is_verified: form.is_verified,
      fast_delivery: form.fast_delivery,
      status: form.status,
      is_test: form.is_test,
      // Falls back to ES rather than sending a blank: country is NOT NULL in
      // the database, and an empty market would drop the store out of every
      // country filter at once.
      country: form.country.trim().toUpperCase() || 'ES',
      address: form.address.trim() || null,
      origin: form.origin.trim() || null,
      contact_email: form.contact_email.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      website_url: form.website_url.trim() || null,
      shop_hours: form.shop_hours,
      sort_order: parseInt(form.sort_order || '0', 10) || 0,
    };
  }

  async function handleSave() {
    setSubmitError(null);
    const payload = toPayload();
    if (!payload) return;
    try {
      if (isEdit && storeId) {
        await updateStore.mutateAsync({ id: storeId, payload });
        toast.success(t('stores.saved', 'Store saved.'));
      } else {
        const created = await createStore.mutateAsync(payload);
        toast.success(t('stores.created', 'Store created.'));
        navigate(`/stores/${created.id}/edit`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Save failed';
      setSubmitError(message);
      toast.error(message);
    }
  }

  const saving = createStore.isPending || updateStore.isPending;

  if (isEdit && loadingExisting) {
    return (
      <div className="flex items-center justify-center h-64 text-muted">
        <Loader2 size={20} className="animate-spin mr-2" />
        {t('common.loading', 'Loading…')}
      </div>
    );
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'identity',  label: t('stores.tab.identity',  'Identity') },
    { key: 'branding',  label: t('stores.tab.branding',  'Branding') },
    { key: 'hours',     label: t('stores.tab.hours',     'Shop hours') },
    { key: 'contact',   label: t('stores.tab.contact',   'Contact') },
    // Products needs a persisted store id, so it only appears once the
    // store exists.
    ...(isEdit ? [{ key: 'products' as const, label: t('stores.tab.products', 'Products') }] : []),
    // Who manages it (2026-10-31): link, send their login again, unlink.
    ...(isEdit ? [{ key: 'partner' as const, label: t('stores.tab.partner', 'Partner') }] : []),
  ];

  return (
    <div className="space-y-0">
      {/* Header — action cluster stacks onto its own row below the title
          on mobile so Preview + Save don't have to fight for horizontal
          space with the back-tile + h1 at 375px. */}
      <BackLink
        label={t('common.backToStores', 'Back to stores')}
        onClick={() => goBack('/stores')}
        className="mb-3"
      />
      <div className="flex flex-col md:flex-row md:items-center gap-4 mb-6">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold font-display text-ink truncate">
              {promoteMode
                ? 'Create store from suggestion'
                : isEdit
                  ? t('stores.editTitle', 'Edit store')
                  : t('stores.newTitle', 'New store')}
            </h1>
            <p className="text-sm text-muted mt-0.5 truncate">
              {promoteMode
                ? 'Auto-created by the Excel importer. Fill in the storefront and toggle active to publish.'
                : isEdit && form.name
                  ? `${t('stores.editingLabel', 'Editing')} ${form.name}`
                  : t('stores.newSubtitle', 'Create a new partner storefront.')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setPreviewState('open')}
            className="flex-1 md:flex-none inline-flex items-center justify-center gap-2 bg-card border-2 border-border hover:border-brand hover:bg-brand-mist/40 text-ink font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition"
            title={t('stores.previewTitle', 'Preview how customers see this store')}
          >
            <Eye className="w-5 h-5" strokeWidth={1.75} />
            {t('stores.preview', 'Preview')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 md:flex-none inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-mid disabled:opacity-50 text-white font-semibold font-display text-sm px-6 md:px-8 rounded-xl h-[52px] transition"
          >
            <Save className="w-5 h-5" strokeWidth={1.75} />
            {saving
              ? '…'
              : promoteMode
                ? 'Create store'
                : isEdit
                  ? t('common.save', 'Save')
                  : t('stores.create', 'Create store')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border mb-6">
        <div className="tab-strip flex gap-0 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`shrink-0 px-5 py-3 text-sm font-semibold font-display border-b-2 transition ${
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
      <div className="bg-card rounded-xl border border-border p-6">
        {/* ── Identity ─────────────────────────────────── */}
        {activeTab === 'identity' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <TextField
                label={t('stores.field.name', 'Store name')}
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                error={errors.name}
                required
              />
              <TextField
                label={t('stores.field.slug', 'Slug')}
                value={form.slug}
                onChange={(e) => setField('slug', e.target.value.toLowerCase())}
                hint={t('stores.field.slugHint', 'Leave empty to auto-generate from the name.')}
                placeholder="shan"
              />
              <TextField
                label={t('stores.field.taglineEs', 'Tagline (ES)')}
                value={form.tagline_es}
                onChange={(e) => setField('tagline_es', e.target.value)}
              />
              <TextField
                label={t('stores.field.taglineEn', 'Tagline (EN)')}
                value={form.tagline_en}
                onChange={(e) => setField('tagline_en', e.target.value)}
              />
              <div className="md:col-span-2">
                <Textarea
                  label={t('stores.field.descriptionEs', 'Description (ES)')}
                  value={form.description_es}
                  onChange={(e) => setField('description_es', e.target.value)}
                  rows={3}
                />
              </div>
              <div className="md:col-span-2">
                <Textarea
                  label={t('stores.field.descriptionEn', 'Description (EN)')}
                  value={form.description_en}
                  onChange={(e) => setField('description_en', e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-2 border-t border-border">
              <div className="md:col-span-2 space-y-4">
                {/* Lifecycle state. Radio cluster instead of a select because
                    all three options need a one-line rationale visible at
                    once — an inline select hides the "suspended blocks
                    partner login" caveat behind a click. */}
                <fieldset>
                  <legend className="text-sm font-semibold text-ink font-display mb-2">
                    {t('stores.field.status', 'Visibility')}
                  </legend>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    {(
                      [
                        { value: 'live',      label: 'Live',      hint: 'Shown on customer /stores' },
                        { value: 'paused',    label: 'Paused',    hint: 'Partner self-pause — soft "temporarily unavailable"' },
                        { value: 'draft',     label: 'Draft',     hint: 'Admin-only, hidden from customers' },
                        { value: 'suspended', label: 'Suspended', hint: 'Hidden + blocks partner login' },
                      ] as const
                    ).map((opt) => {
                      const selected = form.status === opt.value;
                      return (
                        <label
                          key={opt.value}
                          className={`cursor-pointer rounded-lg border-2 px-3 py-2.5 transition-colors ${
                            selected
                              ? 'border-brand bg-brand-mist/40'
                              : 'border-border hover:border-brand/40 hover:bg-surface-cream'
                          }`}
                        >
                          <input
                            type="radio"
                            name="store-status"
                            value={opt.value}
                            checked={selected}
                            onChange={() => setField('status', opt.value)}
                            className="sr-only"
                          />
                          <div className={`text-sm font-semibold font-display ${selected ? 'text-brand' : 'text-ink'}`}>
                            {opt.label}
                          </div>
                          <div className="text-[11px] text-muted font-body mt-0.5 leading-tight">
                            {opt.hint}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <Checkbox
                  label={t('stores.field.isActive', 'Active — must also be true for customer visibility')}
                  checked={form.is_active}
                  onChange={(e) => setField('is_active', e.target.checked)}
                />
                {/* Reps sell from one shop (lib/repStore on the API). Switched
                    off or suspended, theirs leaves them nothing to sell. */}
                {(existing?._count?.sales_reps ?? 0) > 0 && (!form.is_active || form.status === 'suspended') && (
                  <p role="status" className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-[12.5px] font-semibold text-warning">
                    {t('stores.repsWarning', {
                      count: existing?._count?.sales_reps ?? 0,
                      defaultValue: '{{count}} sales rep(s) sell from this shop. Switched off or suspended, they cannot build orders until you assign them another.',
                    })}
                  </p>
                )}
                {/* is_test — legacy mv rows landed with this flag on. It
                    excludes the store from customerVisibleStoreFilter even
                    when status=live + is_active=true. Uncheck to publish
                    a legacy row to real customers. */}
                <Checkbox
                  label={t('stores.field.isTest', 'Test data — hides from customers regardless of other flags')}
                  checked={form.is_test}
                  onChange={(e) => setField('is_test', e.target.checked)}
                />
                <Checkbox
                  label={t('stores.field.isVerified', 'Verified badge')}
                  checked={form.is_verified}
                  onChange={(e) => setField('is_verified', e.target.checked)}
                />
                <Checkbox
                  label={t('stores.field.fastDelivery', 'Fast delivery')}
                  checked={form.fast_delivery}
                  onChange={(e) => setField('fast_delivery', e.target.checked)}
                />
              </div>
              <TextField
                label={t('stores.field.sortOrder', 'Sort order')}
                type="number"
                value={form.sort_order}
                onChange={(e) => setField('sort_order', e.target.value)}
              />
              <TextField
                label={t('stores.field.rating', 'Rating (0–5)')}
                type="number"
                step="0.1"
                value={form.rating}
                onChange={(e) => setField('rating', e.target.value)}
                error={errors.rating}
              />
              <TextField
                label={t('stores.field.ratingCount', 'Rating count')}
                type="number"
                value={form.rating_count}
                onChange={(e) => setField('rating_count', e.target.value)}
              />
            </div>
          </div>
        )}

        {/* ── Branding ─────────────────────────────────── */}
        {activeTab === 'branding' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <ImageUploadField
                label={t('stores.field.logo', 'Logo')}
                value={form.logo_url}
                onChange={(next) => setField('logo_url', next)}
                helperText={t('stores.field.logoHint', 'Square PNG or SVG. Shown on cards and the storefront header.')}
              />
              <ImageUploadField
                label={t('stores.field.cover', 'Cover image')}
                value={form.cover_url}
                onChange={(next) => setField('cover_url', next)}
                helperText={t('stores.field.coverHint', 'Wide banner shown at the top of the storefront (min. 1200×400).')}
              />
              <TextField
                label={t('stores.field.logoBg', 'Logo background')}
                value={form.logo_bg}
                onChange={(e) => setField('logo_bg', e.target.value)}
                placeholder="#FFFFFF"
                hint={t('stores.field.logoBgHint', 'Hex color behind the logo tile.')}
              />
              <TextField
                label={t('stores.field.origin', 'Origin')}
                value={form.origin}
                onChange={(e) => setField('origin', e.target.value)}
                placeholder="Pakistan"
                hint={t('stores.field.originHint', 'Cuisine this store sells — not where the business is.')}
              />
              <TextField
                label={t('stores.field.country', 'Country')}
                value={form.country}
                onChange={(e) => setField('country', e.target.value.toUpperCase().slice(0, 2))}
                placeholder="ES"
                hint={t(
                  'stores.field.countryHint',
                  'Two-letter country code the store trades in (ES, FR, PT). Shown on the storefront; it does not filter what customers see.',
                )}
              />
              <TextField
                label={t('stores.field.address', 'Address')}
                value={form.address}
                onChange={(e) => setField('address', e.target.value)}
                placeholder="Calle Mayor 12, 28013 Madrid"
                hint={t(
                  'stores.field.addressHint',
                  'Where the shop physically trades. Shown to customers on the storefront. Does not affect where the store can deliver — every live store delivers everywhere.',
                )}
              />
            </div>
          </div>
        )}

        {/* ── Shop hours ───────────────────────────────── */}
        {activeTab === 'hours' && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              {t('stores.section.hoursHint', 'Set daily open/close windows. Customers see "Open now" status on the storefront based on this.')}
            </p>
            <div className="space-y-2">
              {WEEKDAY_KEYS.map((k) => {
                const day = form.shop_hours[k] ?? { closed: true };
                return (
                  <div
                    key={k}
                    className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-2 md:items-center rounded-lg border border-border bg-surface-cream px-4 py-3"
                  >
                    <div className="font-display font-semibold text-sm text-ink">
                      {weekdayLabel(k, 'es')}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-2 text-sm font-display text-ink">
                        <input
                          type="checkbox"
                          checked={day.closed}
                          onChange={(e) =>
                            setDay(k, e.target.checked
                              ? { closed: true }
                              : { closed: false, open: '09:00', close: '20:00' })
                          }
                          className="w-4 h-4 accent-brand"
                        />
                        {t('stores.field.closed', 'Closed')}
                      </label>
                      {!day.closed && (
                        <>
                          <input
                            type="time"
                            value={day.open}
                            onChange={(e) => setDay(k, { closed: false, open: e.target.value, close: day.close })}
                            className="bg-card border border-border rounded-lg h-11 px-3 text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                          />
                          <span className="text-muted text-sm">–</span>
                          <input
                            type="time"
                            value={day.close}
                            onChange={(e) => setDay(k, { closed: false, open: day.open, close: e.target.value })}
                            className="bg-card border border-border rounded-lg h-11 px-3 text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                          />
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Contact ──────────────────────────────────── */}
        {activeTab === 'contact' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <TextField
              label={t('stores.field.email', 'Email')}
              type="email"
              value={form.contact_email}
              onChange={(e) => setField('contact_email', e.target.value)}
            />
            <TextField
              label={t('stores.field.phone', 'Phone')}
              type="tel"
              value={form.contact_phone}
              onChange={(e) => setField('contact_phone', e.target.value)}
            />
            <div className="md:col-span-2">
              <TextField
                label={t('stores.field.website', 'Website')}
                type="url"
                value={form.website_url}
                onChange={(e) => setField('website_url', e.target.value)}
                placeholder="https://…"
              />
            </div>
          </div>
        )}

        {/* ── Products ─────────────────────────────────── */}
        {activeTab === 'products' && isEdit && storeId && (
          <StoreProductsList
            storeId={storeId}
            storeName={form.name}
            onAdd={() => setProductsModalOpen(true)}
          />
        )}

        {/* ── Partner ──────────────────────────────────── */}
        {activeTab === 'partner' && isEdit && storeId && (
          <StorePartnerPanel
            storeId={storeId}
            storeName={existing?.name ?? form.name}
            partners={existing?.partners}
            unavailable={existing?.deleted_at
              ? t('partners.panel.deleted', 'This store is deleted. Restore it before giving it a partner.')
              : existing?.deletion_scheduled_at
                ? t('partners.panel.scheduled', 'This store is scheduled for deletion. Cancel the deletion before giving it a partner.')
                : null}
          />
        )}
      </div>

      {submitError && (
        <p className="mt-4 text-sm text-danger font-semibold font-display">
          {submitError}
        </p>
      )}

      {isEdit && storeId && productsModalOpen && (
        <ManageStoreProductsModal
          storeId={storeId}
          storeName={form.name}
          assignedIds={assignedIds}
          onAssign={(ids) => assignProducts.mutateAsync({ id: storeId, productIds: ids })}
          onUnassign={(ids) => unassignProducts.mutateAsync({ id: storeId, productIds: ids })}
          onClose={() => setProductsModalOpen(false)}
        />
      )}

      {/* Full-screen storefront preview overlay. Three-state so admins can
          Minimize the overlay while still tweaking the form. */}
      <StorePreviewOverlay
        state={previewState}
        lang={previewLang}
        onLangChange={setPreviewLang}
        onClose={() => setPreviewState('closed')}
        onMinimize={() => setPreviewState('minimized')}
        onRestore={() => setPreviewState('open')}
        draft={previewDraft}
      />
    </div>
  );
}
