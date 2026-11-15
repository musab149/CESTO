import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForm, type Resolver, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowRight, Building2, User as UserIcon, MapPin, Store as StoreIcon,
  Check, AlertCircle, Mail, Wand2, Wallet, Info, ExternalLink,
} from 'lucide-react';
import {
  useCreateAdminClient, useAdminUserLookup,
  provinceForPostcode, suggestEmailCorrection, PROVINCE_NAMES,
} from '@grocery-app/shared';
import { useToast } from '@/components/Toast';
import BackLink from '@/components/BackLink';
import { TextField, Textarea, Select, Checkbox } from '@/components/form';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';
import { useGoBack } from '@/lib/useGoBack';

/**
 * A rep opens an account for a client they are standing in front of.
 *
 * Three decisions shape this screen, and they are all consequences of WHERE it
 * is used — a phone, in a shop, with the client waiting.
 *
 * 1. THREE STEPS, NOT ONE FORM. Eighteen fields in one scroll means a rep
 *    presses Create, fails validation somewhere above the fold, and has to
 *    hunt. Each step validates before it will advance, so an error is always
 *    on the screen that caused it.
 *
 * 2. THE POSTCODE FILLS THE PROVINCE. Spanish postcodes encode it in the
 *    first two digits, so asking separately is asking for something we
 *    already know — and inviting a typo into a field that has to match a
 *    delivery zone later.
 *
 * 3. THE LAST STEP IS A REVIEW. Creating the account emails a password. If
 *    the address is wrong the credentials go to a stranger and the client
 *    gets nothing, so the email is repeated back at the size it deserves
 *    before anything is sent.
 *
 * The two switches in step 1 are independent, and the labels have to make
 * that obvious or a rep will read them as one identity.
 *
 *   BUYING  — is_business + pricing_mode. The ONLY thing it controls is
 *             whether effectiveUnitPrice() hands back b2b_price instead of
 *             price. It says nothing about who they are.
 *   SELLING — a PartnerStoreRole. Nothing in the partner routes or middleware
 *             consults is_business.
 *
 * So "standard prices + sells on Cesto" is a real client, not a mistake: a
 * small producer listing their own goods who buys nothing wholesale from us.
 * Marking them as a business to let them sell would quietly give them B2B
 * prices on their own shopping.
 */

interface FormState {
  client_type: 'retail' | 'business';
  is_vendor: boolean;
  name: string;
  email: string;
  phone: string;
  preferred_language: 'es' | 'en';
  company: string;
  business_type: string;
  registration_no: string;
  store_name: string;
  store_tagline: string;
  contact_name: string;
  contact_phone: string;
  street_line_1: string;
  street_line_2: string;
  postcode: string;
  city: string;
  province: string;
  delivery_notes: string;
  sales_manager_name: string;
  send_credentials: boolean;
}

const empty: FormState = {
  client_type: 'business', is_vendor: false,
  name: '', email: '', phone: '', preferred_language: 'es',
  company: '', business_type: '', registration_no: '',
  store_name: '', store_tagline: '',
  contact_name: '', contact_phone: '', street_line_1: '', street_line_2: '',
  postcode: '', city: '', province: '', delivery_notes: '',
  sales_manager_name: '', send_credentials: true,
};

/** Which fields each step owns — drives per-step validation. */
const STEP_FIELDS: FieldPath<FormState>[][] = [
  ['client_type', 'is_vendor', 'name', 'email', 'phone', 'preferred_language'],
  ['contact_name', 'contact_phone', 'street_line_1', 'street_line_2', 'postcode', 'city', 'province', 'delivery_notes'],
  ['company', 'business_type', 'registration_no', 'store_name', 'store_tagline', 'sales_manager_name', 'send_credentials'],
];

function Card({ icon, title, subtitle, children }: {
  icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <section className="bg-card rounded-xl border border-border p-4 sm:p-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-brand-whisper flex items-center justify-center shrink-0">{icon}</div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold font-display text-ink leading-tight">{title}</h2>
          {subtitle && <p className="text-xs text-muted mt-0.5 leading-snug">{subtitle}</p>}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function ReviewRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-border last:border-0">
      <span className="text-xs text-muted shrink-0">{label}</span>
      <span className={`text-sm text-right break-words ${strong ? 'font-semibold text-ink' : 'text-charcoal'}`}>
        {value || '—'}
      </span>
    </div>
  );
}

export default function ClientCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Only for leaving the page. Stepping backwards inside the form is state,
  // not history, so it must not touch the history stack.
  const goBack = useGoBack();
  const toast = useToast();
  const messages = useValidationMessages();
  const createClient = useCreateAdminClient();

  const [step, setStep] = useState(0);
  const [serverError, setServerError] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      client_type: z.enum(['retail', 'business']),
      is_vendor: z.boolean(),
      name: r.name({ min: 2, max: 120 }),
      email: r.email(),
      phone: r.phoneIntlOptional(),
      preferred_language: z.enum(['es', 'en']),
      company: r.optionalShortText(200),
      business_type: r.optionalShortText(120),
      registration_no: r.optionalShortText(60),
      store_name: r.optionalShortText(120),
      store_tagline: r.optionalShortText(160),
      contact_name: r.name({ min: 2, max: 120 }),
      contact_phone: r.phoneIntl(),
      street_line_1: r.shortText(200),
      street_line_2: r.optionalShortText(200),
      postcode: r.postcode(),
      city: r.shortText(100),
      province: r.shortText(100),
      delivery_notes: r.optionalShortText(200),
      sales_manager_name: r.name({ min: 2, max: 120 }),
      send_credentials: z.boolean(),
    })
      .refine((v) => v.client_type !== 'business' || v.company.trim().length > 0, {
        message: t('clients.errors.companyRequired', 'Company name is required for a business client'),
        path: ['company'],
      })
      .refine((v) => !v.is_vendor || v.store_name.trim().length >= 2, {
        message: t('clients.errors.storeRequired', 'Shop name is required for a vendor'),
        path: ['store_name'],
      });
  }, [messages, t]);

  const {
    register, handleSubmit, watch, setValue, trigger, getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormState>({
    resolver: zodResolver(schema) as unknown as Resolver<FormState>,
    mode: 'onBlur',
    defaultValues: empty,
  });

  const v = watch();
  const isBusiness = v.client_type === 'business';

  /**
   * Asked while they type, not at submit.
   *
   * The old behaviour let a rep fill in three steps and only then learn the
   * phone was taken — and the 409 blamed "email or phone", when an email can
   * never actually collide here: the server upgrades that account rather
   * than inserting a second one.
   *
   * Gated on the field looking complete so it does not fire per keystroke.
   */
  const emailReady = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim());
  const phoneReady = v.phone.replace(/\D/g, '').length >= 9;
  const lookupParams = {
    email: emailReady ? v.email.trim().toLowerCase() : undefined,
    phone: phoneReady ? v.phone.replace(/[\s-]/g, '').replace(/^\+34/, '') : undefined,
  };
  const { data: lookup } = useAdminUserLookup(lookupParams, emailReady || phoneReady);

  const existingByEmail = emailReady ? lookup?.email ?? null : null;
  const takenPhone = phoneReady ? lookup?.phone ?? null : null;
  // A phone already on the SAME account we are about to upgrade is fine;
  // only somebody else's is a blocker.
  const phoneClash = takenPhone && takenPhone.id !== existingByEmail?.id ? takenPhone : null;

  const emailSuggestion = useMemo(
    () => (v.email.includes('@') ? suggestEmailCorrection(v.email) : null),
    [v.email],
  );

  // The postcode already says which province it is. Fill it rather than ask,
  // and leave it editable for the handful of edge cases.
  useEffect(() => {
    const province = provinceForPostcode(v.postcode);
    if (province && province !== getValues('province')) {
      setValue('province', province, { shouldValidate: true });
    }
  }, [v.postcode, setValue, getValues]);

  useEffect(() => { topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [step]);

  const copyFromContact = () => {
    if (v.name) setValue('contact_name', v.name, { shouldValidate: true });
    if (v.phone) setValue('contact_phone', v.phone, { shouldValidate: true });
  };

  /**
   * The address arrives already naming the person the account is for.
   *
   * Almost every client takes delivery under their own name and number, so
   * asking for them again is asking a rep to retype what they typed on the
   * previous screen. The button below still exists for re-syncing after a
   * change, and both fields stay editable — plenty of businesses deliver to a
   * warehouse manager rather than the account holder.
   *
   * ONLY WHEN EMPTY. Stepping back and forward must not overwrite a different
   * contact somebody deliberately entered, and neither must editing the
   * client's own name afterwards.
   */
  useEffect(() => {
    if (step !== 1) return;
    if (!getValues('contact_name') && v.name) {
      setValue('contact_name', v.name, { shouldValidate: false });
    }
    if (!getValues('contact_phone') && v.phone) {
      setValue('contact_phone', v.phone, { shouldValidate: false });
    }
    // Deliberately keyed on the step alone: this fills on arrival, not on
    // every keystroke in the name field once the rep is already here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const goNext = async () => {
    const ok = await trigger(STEP_FIELDS[step]);
    // The server cannot reassign someone else's number, so letting them past
    // step 1 only defers a failure they would hit at the end.
    if (step === 0 && phoneClash) return;
    if (ok) setStep((s) => Math.min(s + 1, 2));
  };

  const onSubmit = async (form: FormState) => {
    // Creating a client is not something a stray keystroke gets to do.
    //
    // A <form> submits implicitly on Enter, and by step 3 every field
    // validates, so any Enter would have gone straight through to the server.
    // Worse: pressing Enter on "Next" at step 2 advances to step 3, which
    // renders a type="submit" button in the same position and keeps focus —
    // so a held or repeated Enter created the client the instant the step
    // appeared, before the rep had typed anything into it.
    //
    // handleSubmit still runs validation; this only refuses to act on it
    // anywhere but the last step.
    if (step !== 2) return;

    setServerError(null);
    try {
      const res = await createClient.mutateAsync({
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        preferred_language: form.preferred_language,
        client_type: form.client_type,
        sales_manager_name: form.sales_manager_name,
        business: form.client_type === 'business' ? {
          company: form.company,
          business_type: form.business_type || undefined,
          registration_no: form.registration_no || undefined,
          contact_phone: form.contact_phone || undefined,
        } : undefined,
        vendor: form.is_vendor ? {
          store_name: form.store_name,
          tagline_es: form.store_tagline || undefined,
          contact_email: form.email,
          contact_phone: form.contact_phone || undefined,
        } : undefined,
        address: {
          contact_name: form.contact_name,
          contact_phone: form.contact_phone,
          street_line_1: form.street_line_1,
          street_line_2: form.street_line_2 || undefined,
          postcode: form.postcode,
          city: form.city,
          province: form.province,
          delivery_notes: form.delivery_notes || undefined,
        },
        send_credentials: form.send_credentials,
      });

      // The account exists either way. An existing customer who kept their
      // own password was sent nothing by design (lib/createClient) — that is
      // not a failed email, and saying so would send staff to resend
      // credentials and lock them out.
      if (res.kept_password) {
        toast.success(
          t('clients.created', 'Client created'),
          t('clients.existingKept', 'That email already had an account, so we used it. They keep their own password — no credentials were sent.'),
        );
      } else if (form.send_credentials && !res.email_sent) {
        // A failed email is a follow-up action, not a failed creation.
        toast.warning(
          t('clients.created', 'Client created'),
          t('clients.emailFailed', 'The welcome email could not be sent. Use “Resend credentials” on their page.'),
        );
      } else {
        const emailed = form.send_credentials
          ? t('clients.emailSent', 'Credentials were emailed to {{email}}', { email: form.email })
          : undefined;
        toast.success(
          t('clients.created', 'Client created'),
          res.store
            ? t('clients.createdWithShop', 'Draft shop “{{shop}}” created too', { shop: res.store.name })
            : res.was_existing
              ? [t('clients.existingReset', 'That email already had an account with no password of its own, so we used it and gave it new credentials.'), emailed].filter(Boolean).join(' ')
              : emailed,
        );
      }
      // Replace, not push. The client exists now, so back should return to
      // wherever they came from — not to a filled-in form that would create
      // a second one.
      navigate(`/customers/${res.user.id}`, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setServerError(msg);
      toast.error(t('clients.createFailed', 'Could not create the client'), msg);
    }
  };

  const stepTitles = [
    t('clients.step1', 'Who'),
    t('clients.step2', 'Where'),
    t('clients.step3', 'Details'),
  ];

  return (
    <div className="pb-32 lg:pb-8">
      <div ref={topRef} />

      <BackLink
        label={step === 0 ? t('common.backToCustomers', 'Back to customers') : t('common.back', 'Back')}
        onClick={() => (step === 0 ? goBack('/customers') : setStep((s) => s - 1))}
        className="mb-3"
      />
      <div className="flex items-center gap-3 mb-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold font-display text-ink leading-tight">
            {t('clients.newTitle', 'New client')}
          </h1>
          <p className="text-sm text-muted mt-0.5">
            {t('clients.stepOf', 'Step {{n}} of 3', { n: step + 1 })} · {stepTitles[step]}
          </p>
        </div>
      </div>

      {/* Progress. Segments rather than a bar so each one can be a target. */}
      {/* Each segment's button is 24px tall around a 6px bar: the bar alone
          was a 6px tap target on a phone (2026-11-05). */}
      <div className="flex gap-1.5 mb-4 max-w-2xl" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={3}>
        {[0, 1, 2].map((i) => (
          <button
            key={i}
            type="button"
            disabled={i > step}
            onClick={() => setStep(i)}
            aria-label={stepTitles[i]}
            className={`h-6 flex-1 flex items-center ${i < step ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <span className={`block h-1.5 w-full rounded-full transition-colors ${i <= step ? 'bg-brand' : 'bg-border'}`} />
          </button>
        ))}
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="space-y-4 max-w-2xl"
        // Enter should move the rep forward, not finish the job. On the first
        // two steps it advances a step, which is what pressing it in a form
        // field is expected to do; on the last step it does nothing, so
        // creating the client stays a deliberate press of the button.
        //
        // Textareas are left alone — Enter there is a newline, and swallowing
        // it would make the notes fields single-line without saying so.
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          const el = e.target as HTMLElement;
          // Only fields. A TEXTAREA needs Enter for newlines, and a focused
          // BUTTON needs it to activate — swallowing either would break
          // something people rely on to fix something they do not do.
          if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT') return;
          e.preventDefault();
          if (step < 2) void goNext();
        }}
      >
        {/* ─── Step 1 · Who ─────────────────────────────── */}
        {step === 0 && (
          <>
            {/* Two separate questions, deliberately in two cards. Buying
                prices and selling rights are unrelated in the data model, and
                one card made them read as a single "what kind of client is
                this" choice. */}
            <Card
              icon={<Wallet size={18} strokeWidth={1.75} className="text-brand" />}
              title={t('clients.buyingTitle', 'What do they pay when they buy?')}
              subtitle={t('clients.buyingSubtitle', 'Sets the prices they see in the shop. Nothing else.')}
            >
              <div role="radiogroup" aria-label={t('clients.buyingTitle', 'What do they pay when they buy?')} className="grid grid-cols-2 gap-2">
                {(['business', 'retail'] as const).map((type) => {
                  const active = v.client_type === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setValue('client_type', type, { shouldValidate: true })}
                      className={`min-h-[64px] rounded-xl border-2 px-3 py-2 text-left transition-colors ${
                        active ? 'border-brand bg-brand-whisper' : 'border-border bg-card hover:border-brand/40'
                      }`}
                    >
                      <span className={`block text-sm font-semibold font-display ${active ? 'text-brand' : 'text-ink'}`}>
                        {type === 'business' ? t('clients.typeBusiness', 'B2B (Wholesale)') : t('clients.typeRetail', 'Home Grocery')}
                      </span>
                      <span className="block text-[11px] text-muted leading-snug mt-0.5">
                        {type === 'business'
                          ? t('clients.typeBusinessHint', 'Trade prices')
                          : t('clients.typeRetailHint', 'Same as any shopper')}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>

            <Card
              icon={<StoreIcon size={18} strokeWidth={1.75} className="text-brand" />}
              title={t('clients.sellingTitle', 'Do they sell on Cesto?')}
              subtitle={t('clients.sellingSubtitle', 'Independent of the prices above — a producer can sell here and still shop at standard prices')}
            >
              <button
                type="button"
                onClick={() => setValue('is_vendor', !v.is_vendor)}
                aria-pressed={v.is_vendor}
                className={`w-full text-left rounded-xl border-2 p-3 flex items-start gap-3 transition-colors ${
                  v.is_vendor ? 'border-brand bg-brand-whisper' : 'border-border bg-card hover:border-brand/40'
                }`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${v.is_vendor ? 'bg-brand text-white' : 'bg-surface-linen text-muted'}`}>
                  <StoreIcon size={17} strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold font-display text-ink leading-tight">
                    {t('clients.alsoVendor', 'Yes — give them a shop')}
                  </p>
                  <p className="text-xs text-muted mt-0.5 leading-snug">
                    {t('clients.alsoVendorHint', 'Creates a draft shop they set up and publish themselves')}
                  </p>
                </div>
                <div className={`w-5 h-5 rounded-md border-2 shrink-0 ml-auto flex items-center justify-center ${v.is_vendor ? 'bg-brand border-brand' : 'border-border'}`}>
                  {v.is_vendor && <Check size={13} strokeWidth={3} className="text-white" />}
                </div>
              </button>

              {/* Spells the combination out, because this is exactly the pair
                  that reads as a contradiction until you see it written. */}
              <p className="text-xs text-muted leading-snug">
                {v.is_vendor
                  ? (isBusiness
                    ? t('clients.comboBuysSells', 'Buys at trade prices and sells their own goods.')
                    : t('clients.comboSellsOnly', 'Sells their own goods and shops at standard prices.'))
                  : (isBusiness
                    ? t('clients.comboBuysOnly', 'Buys at trade prices. Does not sell on Cesto.')
                    : t('clients.comboPlain', 'An ordinary customer.'))}
              </p>
            </Card>

            <Card icon={<UserIcon size={18} strokeWidth={1.75} className="text-brand" />} title={t('clients.contactTitle', 'Contact')}>
              <TextField
                label={t('clients.name', 'Full name')}
                autoComplete="name" autoFocus
                error={errors.name?.message}
                {...register('name')}
              />
              <div>
                <TextField
                  label={t('clients.email', 'Email')}
                  type="email" inputMode="email" autoComplete="email"
                  hint={t('clients.emailHint', 'The login credentials are sent here')}
                  error={errors.email?.message}
                  {...register('email')}
                />
                {emailSuggestion && (
                  <button
                    type="button"
                    onClick={() => setValue('email', emailSuggestion, { shouldValidate: true })}
                    className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline"
                  >
                    <Wand2 size={12} strokeWidth={2} />
                    {t('clients.didYouMean', 'Did you mean {{email}}?', { email: emailSuggestion })}
                  </button>
                )}
                {/* Not an error. The server upgrades this account rather than
                    refusing, so the useful thing to say is who it is. */}
                {existingByEmail && (
                  <div className="mt-2 rounded-lg bg-brand-whisper border border-brand-mist p-2.5 flex items-start gap-2">
                    <Info size={14} strokeWidth={2} className="text-brand shrink-0 mt-0.5" />
                    <div className="min-w-0 text-xs">
                      <p className="text-ink font-medium">
                        {t('clients.emailExists', '{{name}} already has an account with this email', { name: existingByEmail.name })}
                      </p>
                      <p className="text-muted mt-0.5 leading-snug">
                        {t('clients.emailExistsHint', 'Continuing updates their account and sends them new credentials.')}
                      </p>
                      <a
                        href={`/customers/${existingByEmail.id}`}
                        className="mt-1 inline-flex items-center gap-1 font-semibold text-brand hover:underline"
                      >
                        {t('clients.emailExistsOpen', 'Open their page')}
                        <ExternalLink size={11} strokeWidth={2} />
                      </a>
                    </div>
                  </div>
                )}
              </div>
              <div>
                <TextField
                  label={t('clients.phone', 'Phone')}
                  type="tel" inputMode="tel" autoComplete="tel"
                  error={errors.phone?.message
                    ?? (phoneClash
                      ? t('clients.phoneTaken', 'Already used by {{name}}', { name: phoneClash.name })
                      : undefined)}
                  {...register('phone')}
                />
                {phoneClash && (
                  <p className="mt-1 text-xs text-muted leading-snug">
                    {t('clients.phoneTakenHint', 'A phone number can only belong to one account. Use a different one, or leave it blank.')}
                  </p>
                )}
              </div>
              <Select label={t('clients.language', 'Language')} {...register('preferred_language')}>
                <option value="es">Español</option>
                <option value="en">English</option>
              </Select>
            </Card>
          </>
        )}

        {/* ─── Step 2 · Where ───────────────────────────── */}
        {step === 1 && (
          <Card
            icon={<MapPin size={18} strokeWidth={1.75} className="text-brand" />}
            title={t('clients.addressTitle', 'Delivery address')}
            subtitle={t('clients.addressSubtitle', 'Required — orders cannot be placed without one')}
          >
            <button type="button" onClick={copyFromContact} className="text-xs font-semibold text-brand hover:underline">
              {t('clients.copyContact', "Use the client's own name and phone")}
            </button>
            <TextField label={t('clients.contactName', 'Contact name')} autoComplete="name" error={errors.contact_name?.message} {...register('contact_name')} />
            <TextField label={t('clients.contactPhone', 'Contact phone')} type="tel" inputMode="tel" autoComplete="tel" error={errors.contact_phone?.message} {...register('contact_phone')} />
            <TextField label={t('clients.street1', 'Street address')} autoComplete="address-line1" error={errors.street_line_1?.message} {...register('street_line_1')} />
            <TextField label={t('clients.street2', 'Flat, floor, door')} autoComplete="address-line2" hint={t('common.optional', 'Optional')} error={errors.street_line_2?.message} {...register('street_line_2')} />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label={t('clients.postcode', 'Postcode')}
                inputMode="numeric" maxLength={5} autoComplete="postal-code"
                error={errors.postcode?.message}
                {...register('postcode')}
              />
              <TextField label={t('clients.city', 'City')} autoComplete="address-level2" error={errors.city?.message} {...register('city')} />
            </div>
            <Select
              label={t('clients.province', 'Province')}
              hint={provinceForPostcode(v.postcode) ? t('clients.provinceAuto', 'Filled from the postcode') : undefined}
              error={errors.province?.message}
              {...register('province')}
            >
              <option value="">{t('clients.provinceSelect', 'Select a province…')}</option>
              {PROVINCE_NAMES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
            <Textarea label={t('clients.deliveryNotes', 'Delivery instructions')} rows={2} hint={t('common.optional', 'Optional')} error={errors.delivery_notes?.message} {...register('delivery_notes')} />
          </Card>
        )}

        {/* ─── Step 3 · Details + review ────────────────── */}
        {step === 2 && (
          <>
            {isBusiness && (
              <Card icon={<Building2 size={18} strokeWidth={1.75} className="text-brand" />} title={t('clients.businessTitle', 'Business details')}>
                <TextField label={t('clients.company', 'Company name')} error={errors.company?.message} {...register('company')} />
                <TextField label={t('clients.businessType', 'Business type')} hint={t('clients.businessTypeHint', 'Grocery, restaurant, bakery…')} error={errors.business_type?.message} {...register('business_type')} />
                <TextField label={t('clients.registrationNo', 'CIF / NIF')} hint={t('clients.registrationNoHint', 'Not validated yet — kept for the record')} error={errors.registration_no?.message} {...register('registration_no')} />
              </Card>
            )}

            {v.is_vendor && (
              <Card
                icon={<StoreIcon size={18} strokeWidth={1.75} className="text-brand" />}
                title={t('clients.vendorTitle', 'Their shop')}
                subtitle={t('clients.vendorSubtitle', 'Created as a draft — they add products and a delivery area, then publish')}
              >
                <TextField label={t('clients.storeName', 'Shop name')} error={errors.store_name?.message} {...register('store_name')} />
                <TextField label={t('clients.storeTagline', 'Tagline')} hint={t('common.optional', 'Optional')} error={errors.store_tagline?.message} {...register('store_tagline')} />
              </Card>
            )}

            <Card icon={<UserIcon size={18} strokeWidth={1.75} className="text-brand" />} title={t('clients.repTitle', 'Sales rep')} subtitle={t('clients.repSubtitle', 'Who signed this client up')}>
              <TextField label={t('clients.salesManager', 'Your name')} autoComplete="off" error={errors.sales_manager_name?.message} {...register('sales_manager_name')} />
            </Card>

            {/* The review. The email is the one field where a typo is
                expensive — the password goes there and the client never
                learns they have an account — so it is repeated at a size that
                gets read. */}
            <Card icon={<Mail size={18} strokeWidth={1.75} className="text-brand" />} title={t('clients.reviewTitle', 'Check before creating')}>
              <div className="rounded-xl bg-brand-whisper border border-brand-mist p-3">
                <p className="text-xs text-muted mb-1">{t('clients.credentialsGoTo', 'Login details will be emailed to')}</p>
                <p className="text-base font-semibold text-ink break-all">{v.email || '—'}</p>
              </div>
              <div>
                <ReviewRow label={t('clients.name', 'Full name')} value={v.name} strong />
                <ReviewRow
                  label={t('clients.buysAt', 'Buys at')}
                  value={isBusiness ? t('clients.typeBusiness', 'B2B (Wholesale)') : t('clients.typeRetail', 'Home Grocery')}
                />
                <ReviewRow
                  label={t('clients.sellsOnCesto', 'Sells on Cesto')}
                  value={v.is_vendor ? t('common.yes', 'Yes') : t('common.no', 'No')}
                />
                {isBusiness && <ReviewRow label={t('clients.company', 'Company name')} value={v.company} />}
                {v.is_vendor && <ReviewRow label={t('clients.storeName', 'Shop name')} value={v.store_name} />}
                <ReviewRow
                  label={t('clients.addressTitle', 'Delivery address')}
                  value={[v.street_line_1, v.postcode, v.city].filter(Boolean).join(', ')}
                />
                <ReviewRow label={t('clients.salesManagerLabel', 'Sales rep')} value={v.sales_manager_name} />
              </div>
              <Checkbox label={t('clients.sendCredentials', 'Email the login details now')} {...register('send_credentials')} />
            </Card>
          </>
        )}

        {/* Any error the step check missed, summarised where the eye already is. */}
        {(serverError || (step === 2 && Object.keys(errors).length > 0)) && (
          <div className="bg-danger-bg border border-danger/20 rounded-lg p-4 flex items-start gap-2" role="alert">
            <AlertCircle size={16} strokeWidth={2} className="text-danger shrink-0 mt-0.5" />
            <p className="text-sm text-danger font-medium">
              {serverError ?? t('clients.fixErrors', 'Some details still need fixing — check the steps above.')}
            </p>
          </div>
        )}

        {/* On a phone this floats over the scrolling form, so it needs its own
            background and a blur to stay readable over whatever is under it.
            At lg it is an ordinary block in a white column — the backdrop then
            paints a cream band across the page for no reason, so everything
            that exists to support floating is switched off. */}
        <div className="fixed lg:static bottom-0 left-0 right-0 z-30 bg-surface-linen/95 lg:bg-transparent backdrop-blur lg:backdrop-blur-none border-t lg:border-t-0 border-border p-4 lg:p-0 lg:pt-2 flex gap-3 lg:gap-4 lg:justify-end">
          <button
            type="button"
            onClick={() => (step === 0 ? goBack('/customers') : setStep((s) => s - 1))}
            className="flex-1 lg:flex-none min-h-[52px] px-5 rounded-xl bg-card border-2 border-border hover:border-brand font-semibold font-display text-sm text-ink"
          >
            {step === 0 ? t('common.cancel', 'Cancel') : t('common.back', 'Back')}
          </button>
          {/* Distinct keys so React REPLACES the node instead of reusing it.
              Without them, Next and Create are both a <button> in the same
              position, so React keeps the same DOM element and it stays
              focused across the step change — an Enter still held from
              pressing Next then landed on a submit button that had appeared
              underneath the cursor. */}
          {step < 2 ? (
            <button
              key="next"
              type="button"
              onClick={goNext}
              className="flex-[2] lg:flex-none min-h-[52px] px-5 rounded-xl bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm inline-flex items-center justify-center gap-2"
            >
              {t('common.next', 'Next')}
              <ArrowRight size={16} strokeWidth={2.5} />
            </button>
          ) : (
            <button
              key="create"
              type="submit"
              disabled={isSubmitting}
              className="flex-[2] lg:flex-none min-h-[52px] px-5 rounded-xl bg-brand hover:bg-brand-mid disabled:opacity-60 text-white font-semibold font-display text-sm inline-flex items-center justify-center gap-2"
            >
              <Check size={16} strokeWidth={2.5} />
              {isSubmitting ? t('clients.creating', 'Creating…') : t('clients.create', 'Create client')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
