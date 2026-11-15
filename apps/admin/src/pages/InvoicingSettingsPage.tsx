import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  useInvoicingSettings, useUpdateInvoicingSettings, useAdminMe,
  type InvoicingSettings,
} from '@grocery-app/shared';
import { TableSkeleton } from '@/components/Skeleton';
import BackLink from '@/components/BackLink';
import { useToast } from '@/components/Toast';
import { TextField, Textarea } from '@/components/form';
import { useGoBack } from '@/lib/useGoBack';

/**
 * The company's own fiscal identity.
 *
 * Its own page rather than a card on Settings, for the same reason it is its
 * own AppSetting key: legal identity is not marketing config, and writing it
 * is super_admin-only while the rest of Settings is not.
 *
 * Until `legal_name`, `tax_id` and `address` are all filled, nothing can be
 * issued as a real factura — every document comes out as an albarán that
 * says on its face that it is not a fiscal document. So this page leads with
 * whether that is the case, rather than making someone deduce it from a
 * blocker on an invoice they are trying to issue.
 */

const EMPTY: InvoicingSettings = {
  legal_name: '', tax_id: '', address: '', postcode: '', city: '', province: '',
  country: 'España', email: '', phone: '',
  series_invoice: 'FA', series_albaran: 'ALB', payment_terms: '',
};

export default function InvoicingSettingsPage() {
  const { t } = useTranslation();
  const goBack = useGoBack();
  const toast = useToast();
  const { data, isLoading } = useInvoicingSettings();
  const { data: me } = useAdminMe();
  const update = useUpdateInvoicingSettings();

  const [form, setForm] = useState<InvoicingSettings>(EMPTY);

  useEffect(() => { if (data) setForm(data); }, [data]);

  const isSuperAdmin = me?.role === 'super_admin';
  const configured = form.legal_name.trim() !== ''
    && form.tax_id.trim() !== ''
    && form.address.trim() !== '';

  const set = (k: keyof InvoicingSettings) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = () => {
    update.mutate(form, {
      onSuccess: () => toast.success(t('invoicingSettings.saved', 'Saved')),
      onError: (err) => toast.error(
        t('invoicingSettings.saveFailed', 'Could not save'),
        err instanceof Error ? err.message : String(err),
      ),
    });
  };

  if (isLoading) return <TableSkeleton rows={6} cols={2} />;

  return (
    <div className="space-y-4 max-w-2xl">
      <BackLink
        label={t('common.backToSettings', 'Back to settings')}
        onClick={() => goBack('/settings')}
        className="mb-3"
      />
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-display text-ink leading-tight">
            {t('invoicingSettings.title', 'Invoicing')}
          </h1>
          <p className="text-sm text-muted mt-0.5">
            {t('invoicingSettings.subtitle', 'Who the invoices are issued by')}
          </p>
        </div>
      </div>

      {/* The thing a reader most needs to know about this page. */}
      <section className={`rounded-xl border p-4 flex items-start gap-3 ${
        configured ? 'border-success/30 bg-success-bg' : 'border-warning/30 bg-warning-bg'
      }`}>
        {configured
          ? <CheckCircle2 size={18} strokeWidth={2} className="text-success shrink-0 mt-0.5" />
          : <AlertTriangle size={18} strokeWidth={2} className="text-warning shrink-0 mt-0.5" />}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {configured
              ? t('invoicingSettings.ready', 'Full invoices can be issued')
              : t('invoicingSettings.notReady', 'Only albaranes can be issued')}
          </p>
          <p className="text-xs text-gray mt-0.5 leading-snug">
            {configured
              ? t('invoicingSettings.readyBody', 'A client also needs a CIF/NIF on their record, and every product on the order needs a reviewed IVA rate.')
              : t('invoicingSettings.notReadyBody', 'Legal name, CIF/NIF and address are all required before a document can be a fiscal invoice.')}
          </p>
        </div>
      </section>

      {!isSuperAdmin && (
        <p className="text-xs text-muted">
          {t('invoicingSettings.readOnly', 'Only a super admin can change these.')}
        </p>
      )}

      <fieldset disabled={!isSuperAdmin} className="space-y-4 disabled:opacity-60">
        <section className="bg-card rounded-xl border border-border p-4 sm:p-6 space-y-4">
          <h2 className="text-base font-semibold font-display text-ink">
            {t('invoicingSettings.identity', 'Legal identity')}
          </h2>
          <TextField
            label={t('invoicingSettings.legalName', 'Legal company name')}
            hint={t('invoicingSettings.legalNameHint', 'Not the storefront brand')}
            value={form.legal_name}
            onChange={set('legal_name')}
          />
          <TextField
            label={t('invoicingSettings.taxId', 'CIF / NIF')}
            value={form.tax_id}
            onChange={set('tax_id')}
          />
          <TextField
            label={t('invoicingSettings.address', 'Address')}
            value={form.address}
            onChange={set('address')}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={t('invoicingSettings.postcode', 'Postcode')}
              inputMode="numeric"
              value={form.postcode}
              onChange={set('postcode')}
            />
            <TextField
              label={t('invoicingSettings.city', 'City')}
              value={form.city}
              onChange={set('city')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={t('invoicingSettings.province', 'Province')}
              value={form.province}
              onChange={set('province')}
            />
            <TextField
              label={t('invoicingSettings.country', 'Country')}
              value={form.country}
              onChange={set('country')}
            />
          </div>
          {/* One column on a phone (2026-11-05): half of 390px showed about
              fifteen characters of an email address at 16px. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField
              label={t('invoicingSettings.email', 'Email')}
              type="email"
              value={form.email}
              onChange={set('email')}
            />
            <TextField
              label={t('invoicingSettings.phone', 'Phone')}
              type="tel"
              value={form.phone}
              onChange={set('phone')}
            />
          </div>
        </section>

        <section className="bg-card rounded-xl border border-border p-4 sm:p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold font-display text-ink">
              {t('invoicingSettings.series', 'Numbering')}
            </h2>
            <p className="text-xs text-muted mt-0.5 leading-snug">
              {/* Saying this here is cheaper than explaining a rejected save. */}
              {t('invoicingSettings.seriesHint', 'Uppercase letters only. A prefix cannot be changed once a document has been issued under it — that would split one legal series across two names.')}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={t('invoicingSettings.seriesInvoice', 'Invoice prefix')}
              value={form.series_invoice}
              onChange={(e) => setForm((f) => ({ ...f, series_invoice: e.target.value.toUpperCase() }))}
            />
            <TextField
              label={t('invoicingSettings.seriesAlbaran', 'Albarán prefix')}
              value={form.series_albaran}
              onChange={(e) => setForm((f) => ({ ...f, series_albaran: e.target.value.toUpperCase() }))}
            />
          </div>
          <Textarea
            label={t('invoicingSettings.paymentTerms', 'Payment terms')}
            hint={t('common.optional', 'Optional')}
            rows={2}
            value={form.payment_terms}
            onChange={set('payment_terms')}
          />
        </section>

        <button
          type="button"
          onClick={save}
          disabled={update.isPending || !isSuperAdmin}
          className="min-h-[52px] px-5 rounded-xl bg-brand hover:bg-brand-mid disabled:opacity-60 text-white text-sm font-semibold font-display inline-flex items-center gap-2"
        >
          {update.isPending
            ? <Loader2 size={16} strokeWidth={2.5} className="animate-spin" />
            : <Save size={16} strokeWidth={2} />}
          {t('common.save', 'Save')}
        </button>
      </fieldset>
    </div>
  );
}
