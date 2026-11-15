import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Store,
  Mail,
  Phone,
  MapPin,
  CreditCard,
  Bell,
  FileText,
  AlertTriangle,
  Shield,
  Check,
  Image as ImageIcon,
  ReceiptText,
  ChevronRight,
} from 'lucide-react';
import { TextField, Textarea } from '@/components/form';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';
import {
  useAdminSettings,
  useUpdateAdminSettings,
  type StoreSettings,
  type DeliveryPricingMode,
} from '@grocery-app/shared';
import DeliveryPricingEditor, {
  bandToDraft,
  draftsToBands,
  type BandDraft,
} from '@/components/DeliveryPricingEditor';

type TabId = 'general' | 'orders' | 'notifications' | 'legal' | 'maintenance';

interface SettingsForm {
  storeName: string;
  logoUrl: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  minOrderValue: string;
  deliveryFee: string;
  notificationEmails: string;
  privacyPolicy: string;
  termsConditions: string;
  maintenanceMode: boolean;
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const messages = useValidationMessages();
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [showSaved, setShowSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Delivery pricing is held outside react-hook-form — see the note at the
  // top of DeliveryPricingEditor. Hydrated from the API in the same effect
  // that resets the form, so both halves of the page load together.
  const [pricingMode, setPricingMode] = useState<DeliveryPricingMode>('flat');
  const [originAddress, setOriginAddress] = useState('');
  const [originLat, setOriginLat] = useState<number | null>(null);
  const [originLng, setOriginLng] = useState<number | null>(null);
  const [bands, setBands] = useState<BandDraft[]>([]);

  // Load current settings from the API (lazy-creates a defaults row on the
  // server side the first time). We hydrate the form via reset() below.
  const { data: settingsData, isLoading: settingsLoading } = useAdminSettings();
  const updateSettings = useUpdateAdminSettings();

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      storeName:           r.name({ min: 2, max: 80 }),
      logoUrl:             r.optionalUrl(),
      contactEmail:        r.email(),
      contactPhone:        r.phoneIntl(),
      address:             r.shortText(300),
      minOrderValue:       z.coerce.number().nonnegative(messages.positive),
      deliveryFee:         z.coerce.number().nonnegative(messages.positive),
      notificationEmails:  z.string().trim().min(1, messages.required).refine(
        (v) => v.split(',').every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())),
        { message: messages.email },
      ),
      privacyPolicy:       r.optionalLongText(20000),
      termsConditions:     r.optionalLongText(20000),
      maintenanceMode:     z.boolean(),
    });
  }, [messages]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SettingsForm>({
    resolver: zodResolver(schema) as unknown as Resolver<SettingsForm>,
    mode: 'onBlur',
    defaultValues: {
      storeName: 'Cesto Grocery',
      logoUrl: 'https://cdn.cesto.es/logo.png',
      contactEmail: 'hola@cesto.es',
      contactPhone: '+34910000000',
      address: 'Calle Gran Vía 1, 28013 Madrid, España',
      minOrderValue: '15',
      deliveryFee: '3.5',
      notificationEmails: 'admin@cesto.es, ops@cesto.es',
      privacyPolicy: '',
      termsConditions: '',
      maintenanceMode: false,
    },
  });

  const logoUrl = watch('logoUrl');
  const maintenanceMode = watch('maintenanceMode');

  useEffect(() => {
    if (!showSaved) return;
    const id = window.setTimeout(() => setShowSaved(false), 2200);
    return () => window.clearTimeout(id);
  }, [showSaved]);

  // Hydrate the form the moment settings land from the API. Runs on
  // navigation back to the page too, so any external change is reflected.
  useEffect(() => {
    if (!settingsData) return;
    reset({
      storeName:          settingsData.storeName,
      logoUrl:            settingsData.logoUrl ?? '',
      contactEmail:       settingsData.contactEmail,
      contactPhone:       settingsData.contactPhone,
      address:            settingsData.address,
      minOrderValue:      String(settingsData.minOrderValue ?? 0),
      deliveryFee:        String(settingsData.deliveryFee ?? 0),
      notificationEmails: settingsData.notificationEmails,
      privacyPolicy:      settingsData.privacyPolicy ?? '',
      termsConditions:    settingsData.termsConditions ?? '',
      maintenanceMode:    !!settingsData.maintenanceMode,
    });

    // Null-coalesced across the board: an API that predates distance pricing
    // returns none of these, and the page must still render rather than blank
    // out the Orders tab during the window where admin is deployed first.
    setPricingMode(settingsData.deliveryPricingMode === 'distance' ? 'distance' : 'flat');
    setOriginAddress(settingsData.deliveryOriginAddress ?? '');
    setOriginLat(settingsData.deliveryOriginLat ?? null);
    setOriginLng(settingsData.deliveryOriginLng ?? null);
    setBands((settingsData.deliveryBands ?? []).map(bandToDraft));
    // Intentionally NOT depending on `reset` — RHF gives us a stable ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsData]);

  /**
   * Which tab each field is on, so a validation failure can be shown where the
   * offending field actually is.
   *
   * react-hook-form's handleSubmit refuses to run onSubmit while ANY
   * registered field is invalid — including fields on tabs that are not
   * mounted. With a blank shop address (the state of a fresh environment),
   * pressing Save on the Legal tab did nothing at all: no request, and the
   * "required" message rendered beside a field on another tab. The button
   * looked broken. Now the form says what is wrong and moves you to it.
   */
  const FIELD_TAB: Record<keyof SettingsForm, TabId> = {
    storeName: 'general', logoUrl: 'general', contactEmail: 'general',
    contactPhone: 'general', address: 'general',
    minOrderValue: 'orders', deliveryFee: 'orders',
    notificationEmails: 'notifications',
    privacyPolicy: 'legal', termsConditions: 'legal',
    maintenanceMode: 'maintenance',
  };

  const onInvalid = (formErrors: Record<string, unknown>) => {
    setShowSaved(false);
    const first = Object.keys(formErrors)[0] as keyof SettingsForm | undefined;
    const tab = first ? FIELD_TAB[first] : undefined;
    if (tab) setActiveTab(tab);
    setSaveError(
      tab
        ? t('settings.fixOnTab', { tab: t(`settings.tabs.${tab}`) })
        : t('settings.fixFields'),
    );
  };

  const onSubmit = async (values: SettingsForm) => {
    setSaveError(null);
    try {
      const payload: StoreSettings = {
        storeName:          values.storeName,
        logoUrl:            values.logoUrl,
        contactEmail:       values.contactEmail,
        contactPhone:       values.contactPhone,
        address:            values.address,
        minOrderValue:      Number(values.minOrderValue) || 0,
        deliveryFee:        Number(values.deliveryFee) || 0,
        deliveryPricingMode:   pricingMode,
        deliveryOriginAddress: originAddress,
        deliveryOriginLat:     originLat,
        deliveryOriginLng:     originLng,
        deliveryBands:         draftsToBands(bands),
        notificationEmails: values.notificationEmails,
        privacyPolicy:      values.privacyPolicy,
        termsConditions:    values.termsConditions,
        maintenanceMode:    values.maintenanceMode,
      };
      await updateSettings.mutateAsync(payload);
      setShowSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
    }
  };

  const tabs: Array<{ id: TabId; label: string; icon: typeof Store; danger?: boolean }> = [
    { id: 'general',       label: t('settings.tabs.general'),       icon: Store },
    { id: 'orders',        label: t('settings.tabs.orders'),        icon: CreditCard },
    { id: 'notifications', label: t('settings.tabs.notifications'), icon: Bell },
    { id: 'legal',         label: t('settings.tabs.legal'),         icon: FileText },
    { id: 'maintenance',   label: t('settings.tabs.maintenance'),   icon: AlertTriangle, danger: true },
  ];

  const activeMeta = (() => {
    switch (activeTab) {
      case 'general':
        return { icon: Store, title: t('settings.business.title'), desc: t('settings.business.description') };
      case 'orders':
        return { icon: CreditCard, title: t('settings.orders.title'), desc: t('settings.orders.description') };
      case 'notifications':
        return { icon: Bell, title: t('settings.notifications.title'), desc: t('settings.notifications.description') };
      case 'legal':
        return { icon: FileText, title: t('settings.legal.title'), desc: t('settings.legal.description') };
      case 'maintenance':
        return {
          icon: AlertTriangle,
          title: t('settings.maintenance.title'),
          desc: t('settings.maintenance.description'),
          danger: true,
        };
    }
  })();

  const ActiveIcon = activeMeta.icon;
  const isDanger = 'danger' in activeMeta && activeMeta.danger;

  return (
    <form className="space-y-6" onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate>
      {/* Header. Wraps on a phone (2026-11-05): a save error is a sentence,
          and in one row it squeezed the title to a word a line. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink leading-tight">
            {t('settings.title')}
          </h1>
          <p className="text-sm text-ink/60 font-display mt-0.5">{t('settings.subtitle')}</p>
        </div>

        {settingsLoading && (
          <div className="inline-flex items-center gap-2 bg-surface-linen text-muted border border-border rounded-full px-4 h-10 text-sm font-display">
            Loading…
          </div>
        )}
        {showSaved && (
          <div className="inline-flex items-center gap-2 bg-brand/10 text-brand border border-brand/20 rounded-full px-4 h-10 text-sm font-display font-semibold animate-in fade-in slide-in-from-top-2 duration-200">
            <Check size={16} strokeWidth={2} />
            {t('settings.saved')}
          </div>
        )}
        {saveError && (
          <div className="inline-flex items-center gap-2 bg-danger-bg text-danger border border-danger/30 rounded-full px-4 min-h-10 py-2 max-w-full text-sm font-display font-semibold">
            {saveError}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[224px_1fr] gap-6 items-start">
        {/* Sidebar tabs */}
        <nav className="bg-card rounded-xl border border-border p-2 lg:sticky lg:top-4">
          <ul className="tab-strip flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <li key={tab.id} className="flex-shrink-0 lg:w-full">
                  <button
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-2.5 h-11 px-3 rounded-lg text-sm font-display transition-colors whitespace-nowrap ${
                      isActive
                        ? tab.danger
                          ? 'bg-danger/10 text-danger font-semibold'
                          : 'bg-brand-mist text-brand font-semibold'
                        : 'text-ink/70 hover:bg-surface-cream hover:text-ink font-medium'
                    }`}
                  >
                    <Icon size={18} strokeWidth={1.75} />
                    <span>{tab.label}</span>
                  </button>
                </li>
              );
            })}

            {/* A link, not a tab. Invoicing is its own page because it writes
                a different settings key, is super_admin-only, and has its own
                save — but it is configuration, so it belongs in this list
                rather than in the main sidebar among banners and brands. */}
            <li className="flex-shrink-0 lg:w-full lg:pt-1 lg:mt-1 lg:border-t lg:border-border">
              <button
                type="button"
                onClick={() => navigate('/settings/invoicing')}
                className="w-full flex items-center gap-2.5 h-11 px-3 rounded-lg text-sm font-display font-medium text-ink/70 hover:bg-surface-cream hover:text-ink transition-colors whitespace-nowrap"
              >
                <ReceiptText size={18} strokeWidth={1.75} />
                <span>{t('settings.tabs.invoicing', 'Invoicing')}</span>
                <ChevronRight size={15} strokeWidth={2} className="ml-auto text-muted" />
              </button>
            </li>
          </ul>
        </nav>

        <section
          className={`bg-card rounded-xl border overflow-hidden ${
            isDanger ? 'border-danger/30' : 'border-border'
          }`}
        >
          <header
            className={`flex items-start gap-3 px-4 sm:px-6 py-5 border-b ${
              isDanger ? 'bg-danger/5 border-danger/20' : 'bg-surface-cream/40 border-border'
            }`}
          >
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                isDanger ? 'bg-danger/10' : 'bg-brand-mist'
              }`}
            >
              <ActiveIcon
                size={20}
                strokeWidth={1.75}
                className={isDanger ? 'text-danger' : 'text-brand'}
              />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold font-display text-ink leading-tight">
                {activeMeta.title}
              </h2>
              <p className="text-xs text-ink/60 font-display mt-1 leading-relaxed">
                {activeMeta.desc}
              </p>
            </div>
          </header>

          {/* Body. 16px sides on a phone (2026-11-05), 24 from sm. */}
          <div className="px-4 sm:px-6 py-6">
            {activeTab === 'general' && (
              <div className="space-y-5 max-w-2xl">
                <TextField
                  label={t('settings.business.storeName')}
                  hint={t('settings.business.storeNameHint')}
                  error={errors.storeName?.message}
                  {...register('storeName')}
                />

                <div>
                  <label className="block text-sm font-semibold text-ink mb-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      <ImageIcon size={14} strokeWidth={1.75} className="text-ink/40" />
                      {t('settings.business.logoUrl')}
                    </span>
                  </label>
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-lg border border-border bg-surface-cream flex items-center justify-center overflow-hidden flex-shrink-0">
                      {logoUrl ? (
                        <img
                          src={logoUrl}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <ImageIcon size={18} strokeWidth={1.75} className="text-ink/30" />
                      )}
                    </div>
                    <TextField
                      type="url"
                      className="flex-1"
                      hint={t('settings.business.logoUrlHint')}
                      error={errors.logoUrl?.message}
                      {...register('logoUrl')}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <TextField
                    label={t('settings.business.contactEmail')}
                    type="email"
                    leadingIcon={<Mail size={16} strokeWidth={1.75} />}
                    error={errors.contactEmail?.message}
                    {...register('contactEmail')}
                  />
                  <TextField
                    label={t('settings.business.contactPhone')}
                    type="tel"
                    leadingIcon={<Phone size={16} strokeWidth={1.75} />}
                    error={errors.contactPhone?.message}
                    {...register('contactPhone')}
                  />
                </div>

                <Textarea
                  label={t('settings.business.address')}
                  rows={3}
                  hint={t('settings.business.addressHint')}
                  error={errors.address?.message}
                  labelTrailing={
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink/40">
                      <MapPin size={11} strokeWidth={1.75} />
                    </span>
                  }
                  {...register('address')}
                />
              </div>
            )}

            {activeTab === 'orders' && (
              <div className="space-y-7 max-w-2xl">
                <div className="max-w-md">
                  <TextField
                    label={t('settings.orders.minOrder')}
                    type="number"
                    min="0"
                    step="0.01"
                    hint={t('settings.orders.minOrderHint')}
                    leadingIcon={<span className="text-sm font-display font-semibold text-ink/50">€</span>}
                    error={errors.minOrderValue?.message}
                    {...register('minOrderValue')}
                  />
                </div>

                <div className="border-t border-border pt-6">
                  <DeliveryPricingEditor
                    mode={pricingMode}
                    onModeChange={setPricingMode}
                    originAddress={originAddress}
                    onOriginAddressChange={setOriginAddress}
                    originLat={originLat}
                    originLng={originLng}
                    onOriginLocated={(lat, lng) => { setOriginLat(lat); setOriginLng(lng); }}
                    bands={bands}
                    onBandsChange={setBands}
                  />
                </div>

                {/* The flat pair. Still the whole of pricing in flat mode, and
                    still the fallback in distance mode — an address the
                    geocoder cannot place is charged this rather than nothing.
                    Labelled to say so, because a fee that only appears on some
                    orders is otherwise very hard to account for. */}
                <div className="border-t border-border pt-6 space-y-5 max-w-md">
                  <div>
                    <h3 className="text-sm font-display font-semibold text-ink">
                      {pricingMode === 'distance' ? 'Fallback flat fee' : 'Flat fee'}
                    </h3>
                    {pricingMode === 'distance' && (
                      <p className="text-xs text-ink/60 font-body mt-0.5">
                        Charged when a distance cannot be worked out — an address the map could not
                        find, or a customer who saved theirs before distance pricing was set up.
                      </p>
                    )}
                  </div>
                  <TextField
                    label={t('settings.orders.deliveryFee', 'Delivery fee')}
                    type="number"
                    min="0"
                    step="0.01"
                    hint={t('settings.orders.deliveryFeeHint', 'Charged on every order.')}
                    leadingIcon={<span className="text-sm font-display font-semibold text-ink/50">EUR</span>}
                    error={errors.deliveryFee?.message}
                    {...register('deliveryFee')}
                  />
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className="space-y-5 max-w-2xl">
                <Textarea
                  label={t('settings.notifications.adminEmails')}
                  rows={3}
                  placeholder="admin@cesto.es, ops@cesto.es"
                  hint={t('settings.notifications.emailsHint')}
                  error={errors.notificationEmails?.message}
                  {...register('notificationEmails')}
                />
              </div>
            )}

            {activeTab === 'legal' && (
              <div className="space-y-6 max-w-3xl">
                <Textarea
                  label={t('settings.legal.privacyPolicy')}
                  rows={8}
                  placeholder={t('settings.legal.privacyPlaceholder')}
                  error={errors.privacyPolicy?.message}
                  labelTrailing={<Shield size={14} strokeWidth={1.75} className="text-ink/40" />}
                  {...register('privacyPolicy')}
                />
                <Textarea
                  label={t('settings.legal.terms')}
                  rows={8}
                  placeholder={t('settings.legal.termsPlaceholder')}
                  error={errors.termsConditions?.message}
                  labelTrailing={<FileText size={14} strokeWidth={1.75} className="text-ink/40" />}
                  {...register('termsConditions')}
                />
              </div>
            )}

            {activeTab === 'maintenance' && (
              <div className="space-y-5 max-w-2xl">
                <div className="rounded-xl border border-danger/30 bg-danger/5 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle
                      size={18}
                      strokeWidth={2}
                      className="text-danger flex-shrink-0 mt-0.5"
                    />
                    <div>
                      <p className="text-sm font-semibold text-danger font-display">
                        {t('settings.maintenance.dangerZone')}
                      </p>
                      <p className="text-xs text-danger/80 font-display mt-1 leading-relaxed">
                        {t('settings.maintenance.warning')}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-start justify-between gap-4 border border-border rounded-xl p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-ink font-display">
                        {t('settings.maintenance.mode')}
                      </p>
                      <span
                        className={`inline-flex items-center text-[11px] font-semibold font-display px-2 h-5 rounded-full ${
                          maintenanceMode
                            ? 'bg-danger/10 text-danger'
                            : 'bg-ink/5 text-ink/60'
                        }`}
                      >
                        {maintenanceMode
                          ? t('settings.maintenance.enabled')
                          : t('settings.maintenance.disabled')}
                      </span>
                    </div>
                    <p className="text-xs text-ink/60 mt-1.5 leading-relaxed">
                      {t('settings.maintenance.modeDesc')}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={maintenanceMode}
                    onClick={() => setValue('maintenanceMode', !maintenanceMode, { shouldDirty: true })}
                    // Below sm an invisible ::before makes the tap area 36px
                    // tall without changing the look (2026-11-05).
                    className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors before:absolute before:-inset-1 sm:before:hidden ${
                      maintenanceMode ? 'bg-danger' : 'bg-ink/20'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-card shadow transition-transform ${
                        maintenanceMode ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <footer className="flex items-center justify-end gap-3 px-4 sm:px-6 py-4 border-t border-border bg-surface-cream/30">
            <button
              type="button"
              onClick={() => reset()}
              className="flex-1 sm:flex-none inline-flex items-center justify-center h-11 px-5 rounded-xl border border-border bg-card hover:bg-surface-cream text-sm font-display font-semibold text-ink/70 transition-colors"
            >
              {t('settings.discard')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || updateSettings.isPending || settingsLoading}
              className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 text-white font-display font-semibold text-sm px-6 h-11 rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                isDanger ? 'bg-danger hover:bg-danger/90' : 'bg-brand hover:bg-brand-mid'
              }`}
            >
              {(isSubmitting || updateSettings.isPending) ? '…' : t('settings.save')}
            </button>
          </footer>
        </section>
      </div>
    </form>
  );
}
