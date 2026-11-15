import { useEffect, useState } from 'react';
import { Save, Eye, Loader2, Store as StoreIcon, EyeOff, CheckCircle2 } from 'lucide-react';
import {
  usePartnerStore,
  useUpdatePartnerStore,
  defaultShopHours,
  WEEKDAY_KEYS,
  weekdayLabel,
  type ShopHours,
  type ShopHoursDay,
  type WeekdayKey,
  type PartnerStorePayload,
} from '@grocery-app/shared';
import { TextField, Textarea, Checkbox } from './components/form';
import PartnerImageUploadField from './components/ImageUploadField';

/**
 * Full storefront editor for the partner dashboard. Structural mirror of
 * admin's StoreFormPage ([apps/admin/src/pages/StoreFormPage.tsx]) with
 * admin-only fields stripped:
 *   · slug          — global URL taxonomy, admin decides
 *   · is_active     — admin trust flag (customer visibility gate)
 *   · is_verified   — admin trust flag
 *   · status        — admin lifecycle (draft/live/suspended)
 *   · rating fields — customer-authored
 *   · sort_order    — admin ranking
 * Everything else — name, taglines, descriptions, logo + cover + logo_bg,
 * origin, contact info, website, shop hours grid, fast_delivery — is
 * partner-editable via /api/partner/store PATCH.
 *
 * Kept out of the tab layout: no "Products" tab here (partners already
 * have /partner/products for that). No preview overlay (admin's uses
 * StorePreviewOverlay which lives outside partner scope; a partner can
 * flip Customer mode in the top bar to see their real storefront).
 */

type Tab = 'identity' | 'branding' | 'hours' | 'contact';

interface StoreForm {
  name: string;
  tagline_es: string;
  tagline_en: string;
  description_es: string;
  description_en: string;
  logo_url: string | null;
  logo_bg: string;
  cover_url: string | null;
  fast_delivery: boolean;
  origin: string;
  contact_email: string;
  contact_phone: string;
  website_url: string;
  shop_hours: ShopHours;
}

const emptyForm: StoreForm = {
  name: '',
  tagline_es: '',
  tagline_en: '',
  description_es: '',
  description_en: '',
  logo_url: null,
  logo_bg: '#FFFFFF',
  cover_url: null,
  fast_delivery: false,
  origin: '',
  contact_email: '',
  contact_phone: '',
  website_url: '',
  shop_hours: defaultShopHours(),
};

export default function PartnerStorePage() {
  const { data: existing, isLoading } = usePartnerStore();
  const updateStore = useUpdatePartnerStore();

  const [form, setForm] = useState<StoreForm>(emptyForm);
  const [activeTab, setActiveTab] = useState<Tab>('identity');
  const [errors, setErrors] = useState<Partial<Record<keyof StoreForm, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!existing) return;
    setForm({
      name: existing.name,
      tagline_es: existing.tagline_es ?? '',
      tagline_en: existing.tagline_en ?? '',
      description_es: existing.description_es ?? '',
      description_en: existing.description_en ?? '',
      logo_url: existing.logo_url,
      logo_bg: existing.logo_bg ?? '#FFFFFF',
      cover_url: existing.cover_url,
      fast_delivery: existing.fast_delivery ?? false,
      origin: existing.origin ?? '',
      contact_email: existing.contact_email ?? '',
      contact_phone: existing.contact_phone ?? '',
      website_url: existing.website_url ?? '',
      shop_hours: (existing.shop_hours as ShopHours) ?? defaultShopHours(),
    });
  }, [existing]);

  function setField<K extends keyof StoreForm>(key: K, value: StoreForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear error for this field as soon as the partner starts editing it.
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function setDay(key: WeekdayKey, next: ShopHoursDay) {
    setForm((prev) => ({ ...prev, shop_hours: { ...prev.shop_hours, [key]: next } }));
  }

  function toPayload(): PartnerStorePayload | null {
    const nextErrors: Partial<Record<keyof StoreForm, string>> = {};
    if (!form.name.trim())                        nextErrors.name = 'Store name is required.';
    else if (form.name.trim().length < 2)         nextErrors.name = 'At least 2 characters.';
    if (form.contact_email && !/^\S+@\S+\.\S+$/.test(form.contact_email.trim())) {
      nextErrors.contact_email = 'Not a valid email address.';
    }
    if (form.website_url) {
      try { new URL(form.website_url.trim()); }
      catch { nextErrors.website_url = 'Not a valid URL (start with https://…).'; }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      // Jump to the tab that owns the first offending field.
      if (nextErrors.name) setActiveTab('identity');
      else if (nextErrors.contact_email || nextErrors.website_url) setActiveTab('contact');
      return null;
    }
    return {
      name: form.name.trim(),
      tagline_es: form.tagline_es.trim() || null,
      tagline_en: form.tagline_en.trim() || null,
      description_es: form.description_es.trim() || null,
      description_en: form.description_en.trim() || null,
      logo_url: form.logo_url,
      logo_bg: form.logo_bg,
      cover_url: form.cover_url,
      fast_delivery: form.fast_delivery,
      origin: form.origin.trim() || null,
      contact_email: form.contact_email.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      website_url: form.website_url.trim() || null,
      shop_hours: form.shop_hours,
    };
  }

  async function handleSave() {
    setSubmitError(null);
    setSubmitSuccess(null);
    const payload = toPayload();
    if (!payload) return;
    try {
      await updateStore.mutateAsync(payload);
      setSubmitSuccess('Storefront saved.');
      // Clear success ping after a few seconds so it doesn't linger.
      window.setTimeout(() => setSubmitSuccess(null), 4000);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Save failed.');
    }
  }

  const saving = updateStore.isPending;
  const storefrontUrl = existing?.slug ? `/stores/${existing.slug}` : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted">
        <Loader2 size={20} className="animate-spin mr-2" />
        Loading your storefront…
      </div>
    );
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: 'identity', label: 'Identity' },
    { key: 'branding', label: 'Branding' },
    { key: 'hours',    label: 'Shop hours' },
    { key: 'contact',  label: 'Contact' },
  ];

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center gap-4 mb-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold font-display text-ink truncate inline-flex items-center gap-2">
            <StoreIcon size={22} strokeWidth={1.75} />
            Store
          </h1>
          <p className="text-sm text-muted font-body mt-0.5">
            The public storefront customers see at{' '}
            {storefrontUrl
              ? <a href={storefrontUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-brand hover:underline">{storefrontUrl}</a>
              : <span className="font-mono">/stores/…</span>}
            . Only Cesto admins can toggle active or verified status; everything else is yours to edit.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {storefrontUrl && (
            <a
              href={storefrontUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 md:flex-none inline-flex items-center justify-center gap-2 bg-white border-2 border-border hover:border-brand hover:bg-brand-mist/40 text-ink font-semibold font-display text-sm px-5 rounded-xl h-[52px] transition"
              title="Open the customer-facing storefront in a new tab"
            >
              <Eye className="w-5 h-5" strokeWidth={1.75} />
              View storefront
            </a>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 md:flex-none inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-mid disabled:opacity-50 text-white font-semibold font-display text-sm px-6 md:px-8 rounded-xl h-[52px] transition"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" strokeWidth={1.75} /> : <Save className="w-5 h-5" strokeWidth={1.75} />}
            {saving ? '…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Status banners */}
      {submitSuccess && (
        <div className="mb-4 bg-success-bg border border-success/30 rounded-lg px-4 py-3 text-sm font-semibold text-success font-display">
          {submitSuccess}
        </div>
      )}
      {submitError && (
        <div className="mb-4 bg-danger-bg border border-danger/30 rounded-lg px-4 py-3 text-sm font-semibold text-danger font-display">
          {submitError}
        </div>
      )}

      {/* Visibility card — self-serve pause/publish. Kept OUT of the Save
          flow because pausing is a discrete action, not a form field — the
          partner shouldn't have to Save-the-whole-form to un-pause. Admin
          states ('draft' / 'suspended') don't render the toggle; partner
          sees a read-only note explaining why. */}
      {existing && (
        <VisibilityCard
          status={existing.status ?? 'live'}
          saving={updateStore.isPending}
          onToggle={async (next) => {
            setSubmitError(null);
            try {
              await updateStore.mutateAsync({ status: next });
              setSubmitSuccess(next === 'paused'
                ? 'Store paused. Customers will see a "temporarily unavailable" page.'
                : 'Store published. Customers can shop again.');
              window.setTimeout(() => setSubmitSuccess(null), 4000);
            } catch (err) {
              setSubmitError(err instanceof Error ? err.message : 'Failed to update visibility.');
            }
          }}
        />
      )}

      {/* Tabs */}
      <div className="border-b border-border mb-6">
        <div className="flex gap-0 overflow-x-auto">
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
      <div className="bg-white rounded-xl border border-border p-6">
        {/* ── Identity ─────────────────────────────────── */}
        {activeTab === 'identity' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <TextField
                label="Store name"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                error={errors.name}
                required
              />
              <TextField
                label="Origin"
                value={form.origin}
                onChange={(e) => setField('origin', e.target.value)}
                placeholder="e.g. Pakistan"
                hint="Country your store's products come from — shown as a badge on cards."
              />
              <TextField
                label="Tagline (ES)"
                value={form.tagline_es}
                onChange={(e) => setField('tagline_es', e.target.value)}
                placeholder="Especias auténticas del sur de Asia"
              />
              <TextField
                label="Tagline (EN)"
                value={form.tagline_en}
                onChange={(e) => setField('tagline_en', e.target.value)}
                placeholder="Authentic South Asian spices"
              />
              <div className="md:col-span-2">
                <Textarea
                  label="Description (ES)"
                  value={form.description_es}
                  onChange={(e) => setField('description_es', e.target.value)}
                  rows={3}
                  placeholder="Cuenta a tus clientes qué te hace distinto."
                />
              </div>
              <div className="md:col-span-2">
                <Textarea
                  label="Description (EN)"
                  value={form.description_en}
                  onChange={(e) => setField('description_en', e.target.value)}
                  rows={3}
                  placeholder="Tell customers what makes your store different."
                />
              </div>
            </div>

            <div className="pt-2 border-t border-border">
              <Checkbox
                label={
                  <span>
                    <span className="font-semibold">Fast delivery</span>
                    <span className="block text-[12px] text-muted font-body">
                      Enable if your store dispatches noticeably faster than usual. Shown as a “Fast delivery” badge on storefront cards — no specific time is promised to the customer.
                    </span>
                  </span>
                }
                checked={form.fast_delivery}
                onChange={(e) => setField('fast_delivery', e.target.checked)}
              />
            </div>
          </div>
        )}

        {/* ── Branding ─────────────────────────────────── */}
        {activeTab === 'branding' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <PartnerImageUploadField
                label="Logo"
                value={form.logo_url}
                onChange={(next) => setField('logo_url', next)}
                helperText="Square PNG or SVG. Shown on storefront cards and the store header."
              />
              <PartnerImageUploadField
                label="Cover image"
                value={form.cover_url}
                onChange={(next) => setField('cover_url', next)}
                helperText="Wide banner at the top of your storefront (min. 1200×400)."
              />
              <TextField
                label="Logo background"
                value={form.logo_bg}
                onChange={(e) => setField('logo_bg', e.target.value)}
                placeholder="#FFFFFF"
                hint="Hex colour behind the logo tile — helps a transparent-PNG logo pop."
              />
            </div>
          </div>
        )}

        {/* ── Shop hours ───────────────────────────────── */}
        {activeTab === 'hours' && (
          <div className="space-y-3">
            <p className="text-sm text-muted font-body">
              Set daily open/close windows. Customers see an "Open now" pill on your storefront based on these.
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
                      <label className="inline-flex items-center gap-2 text-sm text-ink cursor-pointer">
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
                        Closed
                      </label>
                      {!day.closed && (
                        <>
                          <input
                            type="time"
                            value={day.open}
                            onChange={(e) => setDay(k, { closed: false, open: e.target.value, close: day.close })}
                            className="bg-white border border-border rounded-lg h-11 px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                          />
                          <span className="text-muted text-sm">–</span>
                          <input
                            type="time"
                            value={day.close}
                            onChange={(e) => setDay(k, { closed: false, open: day.open, close: e.target.value })}
                            className="bg-white border border-border rounded-lg h-11 px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
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
              label="Contact email"
              type="email"
              value={form.contact_email}
              onChange={(e) => setField('contact_email', e.target.value)}
              error={errors.contact_email}
              placeholder="hello@yourstore.com"
              hint="Where customers reach you with questions."
            />
            <TextField
              label="Contact phone"
              type="tel"
              value={form.contact_phone}
              onChange={(e) => setField('contact_phone', e.target.value)}
              placeholder="+34 600 000 000"
            />
            <div className="md:col-span-2">
              <TextField
                label="Website"
                type="url"
                value={form.website_url}
                onChange={(e) => setField('website_url', e.target.value)}
                error={errors.website_url}
                placeholder="https://…"
                hint="Optional. Linked from your storefront header."
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Visibility card ───────────────────────────────────────
// Self-serve pause/publish for the partner. Renders differently per state:
//   · live      — green pill + Pause button (with confirm)
//   · paused    — amber pill + prominent Publish button + "customers see …"
//   · draft     — admin state; read-only note, no toggle
//   · suspended — admin state; read-only note, no toggle
// Pause is dangerous-ish (hides from customers) so we require a confirm;
// Publish is safe (restores) so it's one-click.
type VisibilityStatus = 'draft' | 'live' | 'paused' | 'suspended';
interface VisibilityCardProps {
  status: VisibilityStatus;
  saving: boolean;
  onToggle: (next: 'live' | 'paused') => void | Promise<void>;
}
function VisibilityCard({ status, saving, onToggle }: VisibilityCardProps) {
  const isLive     = status === 'live';
  const isPaused   = status === 'paused';
  const isAdminSet = status === 'draft' || status === 'suspended';

  const pillClass = isLive
    ? 'bg-success-bg text-success'
    : isPaused
      ? 'bg-warning-bg text-warning'
      : status === 'suspended'
        ? 'bg-danger-bg text-danger'
        : 'bg-surface-cream text-ink';
  const pillLabel = status.charAt(0).toUpperCase() + status.slice(1);

  const handlePause = () => {
    if (!window.confirm(
      'Pause your store?\n\nCustomers will no longer see it on Cesto. Existing orders keep working. You can publish again anytime from this page.',
    )) return;
    void onToggle('paused');
  };

  return (
    <div className={`mb-6 rounded-xl border p-5 flex flex-col md:flex-row md:items-center gap-4 ${
      isPaused ? 'border-warning/40 bg-warning-bg/40'
      : status === 'suspended' ? 'border-danger/30 bg-danger-bg/30'
      : status === 'draft' ? 'border-border bg-surface-cream'
      : 'border-border bg-white'
    }`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
        isLive ? 'bg-success-bg text-success'
        : isPaused ? 'bg-warning-bg text-warning'
        : 'bg-surface-cream text-ink/60'
      }`}>
        {isLive ? <CheckCircle2 size={20} strokeWidth={1.75} />
         : isPaused ? <EyeOff size={20} strokeWidth={1.75} />
         : <Eye size={20} strokeWidth={1.75} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-bold font-display text-ink">Store visibility</h2>
          <span className={`inline-flex items-center h-5 px-2 rounded-full text-[10px] font-bold uppercase tracking-wider ${pillClass}`}>
            {pillLabel}
          </span>
        </div>
        <p className="text-xs text-muted font-body mt-1 leading-snug">
          {isLive   && 'Your store is live. Customers can browse products and place orders.'}
          {isPaused && 'Your store is hidden. Customers see a "temporarily unavailable" page and cannot place new orders. Existing orders remain unaffected.'}
          {status === 'draft'     && 'Your store is in draft — only a Cesto admin can publish it. Once live you can pause/publish on your own from here.'}
          {status === 'suspended' && 'Your store has been suspended by Cesto. Contact support to resolve.'}
        </p>
      </div>
      {!isAdminSet && (
        <div className="shrink-0">
          {isLive ? (
            <button
              type="button"
              onClick={handlePause}
              disabled={saving}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-white border-2 border-warning/50 text-warning hover:bg-warning-bg font-semibold font-display text-sm disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={16} className="animate-spin" strokeWidth={2} /> : <EyeOff size={16} strokeWidth={2} />}
              Pause store
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onToggle('live')}
              disabled={saving}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={16} className="animate-spin" strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}
              Publish store
            </button>
          )}
        </div>
      )}
    </div>
  );
}
