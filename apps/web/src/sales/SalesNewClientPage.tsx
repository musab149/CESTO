import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm, type Resolver, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowRight, Building2, User as UserIcon, UserCheck, UserPlus, MapPin, Phone,
  Check, AlertCircle, Mail, Wand2, Wallet, Info, ShoppingBasket, ClipboardCheck,
  Pencil, AtSign, ShoppingCart,
} from 'lucide-react';
import {
  useCreateSalesClient, useSalesClientLookup, useSalesMe,
  provinceForPostcode, suggestEmailCorrection, PROVINCE_NAMES,
  apiErrorCode, CLIENT_BELONGS_ELSEWHERE,
} from '@grocery-app/shared';
import { useToast } from './components/Toast';
import BackLink from './components/BackLink';
import { TextField, Textarea, Select } from './components/form';
import { Card, CardHeader, PageHeader, Avatar } from './components/ui';
import { useValidationMessages } from './lib/validation/messages';
import { rules } from './lib/validation/rules';
import { useGoBack } from './lib/useGoBack';
import { pendingAddOf, pendingAddQuery } from './lib/pendingAdd';
import { usePortT } from './lib/portT';
import { useSalesT } from './lib/i18n';
import { useAuthStore } from '@/stores/authStore';

/**
 * A rep opens an account for a client they are standing in front of.
 *
 * PORTED FROM apps/admin/src/pages/ClientCreatePage.tsx. The same task, so a
 * rep and an admin are not looking at two products — same three steps, same
 * fields, same words (the strings are copied value-for-value into the sales
 * dictionary; see lib/portT.ts for why the t() calls are unchanged). The look
 * is the rep panel's own (2026-10-27): the form beside a panel of the steps,
 * which on a phone folds into a row over the form and a bar under it.
 *
 * THREE DELIBERATE DIFFERENCES, all of them capabilities a rep does not have
 * rather than design choices:
 *
 *   · No "Do they sell on Cesto?" card and no shop step. Creating a vendor is
 *     staff work, and POST /api/sales/clients refuses a `vendor` block
 *     outright — offering the switch would be offering a button that 422s.
 *   · No "Your name" field. The server sets sales_manager_name to the rep's
 *     own name and refuses the field, because the one human-readable record of
 *     who owns a client should not be free text typed by the person claiming
 *     it. The review still shows it, read from /api/sales/me.
 *   · The duplicate-email notice does not NAME the existing account or link to
 *     its page. /api/sales/clients/lookup answers in booleans: a rep's device
 *     must not be able to enumerate the customer base, and "yes, and that is
 *     María López" is that enumeration with extra steps. When the match is
 *     already one of their own clients — which they can list anyway — it does
 *     name them.
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
 * BUYING is the only switch left here, and it is narrower than it looks:
 * is_business + pricing_mode control whether effectiveUnitPrice() hands back
 * b2b_price instead of price. Nothing else. It says nothing about who they are.
 */

interface FormState {
  client_type: 'retail' | 'business';
  name: string;
  email: string;
  phone: string;
  preferred_language: 'es' | 'en';
  company: string;
  business_type: string;
  registration_no: string;
  contact_name: string;
  contact_phone: string;
  street_line_1: string;
  street_line_2: string;
  postcode: string;
  city: string;
  province: string;
  delivery_notes: string;
  send_credentials: boolean;
}

const empty: FormState = {
  client_type: 'business',
  name: '', email: '', phone: '', preferred_language: 'es',
  company: '', business_type: '', registration_no: '',
  contact_name: '', contact_phone: '', street_line_1: '', street_line_2: '',
  postcode: '', city: '', province: '', delivery_notes: '',
  send_credentials: true,
};

/** Which fields each step owns — drives per-step validation. */
const STEP_FIELDS: FieldPath<FormState>[][] = [
  ['client_type', 'name', 'email', 'phone', 'preferred_language'],
  ['contact_name', 'contact_phone', 'street_line_1', 'street_line_2', 'postcode', 'city', 'province', 'delivery_notes'],
  ['company', 'business_type', 'registration_no', 'send_credentials'],
];

type StepState = 'done' | 'current' | 'next';

/** A step's number in a circle: filled with a tick once done, ringed while current. */
function StepDot({ n, state }: { n: number; state: StepState }) {
  return (
    <span
      aria-hidden="true"
      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[13px] font-bold font-display tabular-nums transition-colors ${
        state === 'done'
          ? 'bg-brand text-white'
          : state === 'current'
            ? 'bg-card text-brand ring-2 ring-brand'
            : 'bg-surface-cream text-muted ring-1 ring-inset ring-border'
      }`}
    >
      {state === 'done' ? <Check size={15} strokeWidth={2.75} /> : n}
    </span>
  );
}

/** One of a step's cards: the panel's card, its heading inside, a body sized to the card. */
function StepCard({ icon, title, subtitle, action, children }: {
  icon: React.ElementType; title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader icon={icon} title={title} subtitle={subtitle} action={action} wrap />
      {/* Container queries, not screen ones: beside the steps panel this
          column is a good deal narrower than the window it sits in. */}
      <div className="@container px-4 sm:px-5 py-4 sm:py-5">{children}</div>
    </Card>
  );
}

/** A choice drawn as a tile: its icon, its name and line, a radio dot. */
function ChoiceTile({ active, icon: Icon, title, hint, onClick }: {
  active: boolean; icon: React.ElementType; title: string; hint: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-xl border p-3.5 text-left transition-colors ${
        active ? 'border-brand ring-1 ring-brand bg-brand-whisper/60' : 'border-border bg-card hover:border-brand/40'
      }`}
    >
      <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
        active ? 'bg-brand text-white' : 'bg-surface-cream text-gray'
      }`}>
        <Icon size={19} strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[14.5px] font-semibold font-display leading-tight ${active ? 'text-brand' : 'text-ink'}`}>{title}</span>
        <span className="block mt-0.5 text-[12.5px] text-gray leading-snug">{hint}</span>
      </span>
      <span
        aria-hidden="true"
        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors ${
          active ? 'bg-brand text-white' : 'ring-2 ring-inset ring-border'
        }`}
      >
        {active && <Check size={12} strokeWidth={3} />}
      </span>
    </button>
  );
}

/** A part of the review — what one step said — with the way back to change it. */
function ReviewGroup({ icon: Icon, title, edit, children }: {
  icon: React.ElementType; title: string; edit?: { label: string; onClick: () => void }; children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={15} strokeWidth={1.75} className="text-muted shrink-0" />
        <p className="flex-1 min-w-0 text-[12.5px] font-semibold font-display text-gray">{title}</p>
        {edit && (
          <button
            type="button"
            onClick={edit.onClick}
            className="h-7 px-2 -mr-2 rounded-lg inline-flex items-center gap-1 text-[12.5px] font-semibold font-display text-brand hover:bg-brand-whisper transition-colors"
          >
            <Pencil size={12} strokeWidth={2} />
            {edit.label}
          </button>
        )}
      </div>
      <dl className="space-y-1.5">{children}</dl>
    </div>
  );
}

function ReviewRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[13px] text-muted shrink-0">{label}</dt>
      <dd className={`min-w-0 text-[13.5px] text-right break-words ${strong ? 'font-semibold text-ink' : 'text-charcoal'}`}>
        {value || '—'}
      </dd>
    </div>
  );
}

export default function SalesNewClientPage() {
  const t = usePortT();
  const st = useSalesT();
  const navigate = useNavigate();
  // Only for leaving the page. Stepping backwards inside the form is state,
  // not history, so it must not touch the history stack.
  const goBack = useGoBack();
  const toast = useToast();
  const messages = useValidationMessages();
  const createClient = useCreateSalesClient();
  // A product from the Catálogo waiting for this client's first order
  // (lib/pendingAdd) — handed on to the order screen below.
  const [params] = useSearchParams();
  const carry = pendingAddQuery(pendingAddOf(params));
  /**
   * Whose name goes on the account. The server sets it; this is only so the
   * screen can show what it will be.
   *
   * The AUTH STORE first, and /sales/me only as a fallback. The rep's own name
   * is already on the User this app authenticated with — the route guard read
   * `is_sales_rep` off the very same object to let them in here — so a field
   * whose entire job is to state a fact we already hold should not wait on a
   * request, let alone fail with it. It was rendering an em-dash whenever
   * /sales/me was slow or refused.
   */
  const { data: me } = useSalesMe();
  const signedInName = useAuthStore((st) => st.user?.name);
  const repName = signedInName || me?.user.name || '';

  const [step, setStep] = useState(0);
  const [serverError, setServerError] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      client_type: z.enum(['retail', 'business']),
      name: r.name({ min: 2, max: 120 }),
      email: r.email(),
      phone: r.phoneIntlOptional(),
      preferred_language: z.enum(['es', 'en']),
      company: r.optionalShortText(200),
      business_type: r.optionalShortText(120),
      registration_no: r.optionalShortText(60),
      contact_name: r.name({ min: 2, max: 120 }),
      contact_phone: r.phoneIntl(),
      street_line_1: r.shortText(200),
      street_line_2: r.optionalShortText(200),
      postcode: r.postcode(),
      city: r.shortText(100),
      province: r.shortText(100),
      delivery_notes: r.optionalShortText(200),
      send_credentials: z.boolean(),
    })
      .refine((v) => v.client_type !== 'business' || v.company.trim().length > 0, {
        message: t('clients.errors.companyRequired', 'Company name is required for a business client'),
        path: ['company'],
      });
  }, [messages, t]);

  const {
    register, handleSubmit, watch, setValue, trigger, getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormState>({
    resolver: zodResolver(schema) as unknown as Resolver<FormState>,
    mode: 'onBlur',
    // An email to start from: "Nuevo cliente con este email", from a search
    // that found nobody (2026-10-28).
    defaultValues: { ...empty, email: params.get('email')?.trim().toLowerCase() ?? '' },
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
  const { data: lookup } = useSalesClientLookup(lookupParams, emailReady || phoneReady);

  // Booleans, not rows. The server will not name an account outside this rep's
  // book, and it already excludes a phone sitting on the same account we are
  // about to resolve to — see the route for why.
  const emailExists = emailReady ? lookup?.email_taken ?? false : false;
  const existingClient = emailReady ? lookup?.existing_client ?? null : null;
  const emailElsewhere = emailReady ? lookup?.belongs_elsewhere ?? false : false;
  // Somebody else's client they already reach — found by email, or ordered for.
  const reachableClient = emailReady ? lookup?.reachable_client ?? null : null;
  const phoneClash = phoneReady ? lookup?.phone_taken ?? false : false;

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
    // Likewise an email that is the office's or another rep's client: the
    // create refuses it, so the steps after this would be for nothing.
    if (step === 0 && emailElsewhere) return;
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
        business: form.client_type === 'business' ? {
          company: form.company,
          business_type: form.business_type || undefined,
          registration_no: form.registration_no || undefined,
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

      // The account exists either way. What the rep is told follows what
      // happened to its login (lib/createClient on the API): an existing
      // customer with their own password keeps it and is sent nothing — not a
      // failed email — and one without is given credentials like anyone new.
      // An account that already existed was resolved to, not created, and the
      // rep has to be told, or they go looking for a second one.
      if (res.kept_password) {
        toast.success(
          t('clients.created', 'Client created'),
          t('clients.existingKept', 'That email already had an account, so we used it. They keep their own password — no credentials were sent.'),
        );
      } else if (form.send_credentials && !res.email_sent) {
        // A failed email is a follow-up action, not a failed creation.
        toast.warning(
          t('clients.created', 'Client created'),
          t('clients.emailFailed', 'The welcome email could not be sent. Create new credentials from their profile and send them on.'),
        );
      } else {
        const emailed = form.send_credentials
          ? t('clients.emailSent', 'Credentials were emailed to {{email}}', { email: form.email })
          : undefined;
        toast.success(
          t('clients.created', 'Client created'),
          res.was_existing
            ? [t('clients.existingReset', 'That email already had an account with no password of its own, so we used it and gave it new credentials.'), emailed].filter(Boolean).join(' ')
            : emailed,
        );
      }
      // Replace, not push. The client exists now, so back should return to
      // wherever they came from — not to a filled-in form that would create
      // a second one.
      //
      // A rep has no customer detail page to land on, so the next useful screen
      // is the order they almost certainly came here to build.
      navigate(`/sales/orders/new?client=${res.client.id}${carry ? `&${carry}` : ''}`, { replace: true });
    } catch (err) {
      // The one refusal with a code is said in the rep's language; the rest
      // come back as the API wrote them.
      const msg = apiErrorCode(err) === CLIENT_BELONGS_ELSEWHERE
        ? t('clients.belongsElsewhere', 'This email belongs to a client of the office or another rep. You cannot add them yourself: ask the office to pass them to you.')
        : err instanceof Error ? err.message : String(err);
      setServerError(msg);
      toast.error(t('clients.createFailed', 'Could not create the client'), msg);
    }
  };

  const steps = [
    { title: t('clients.step1', 'Who'), hint: t('clients.step1Hint', 'Prices and contact') },
    { title: t('clients.step2', 'Where'), hint: t('clients.step2Hint', 'Where it is delivered') },
    { title: t('clients.step3', 'Details'), hint: t('clients.step3Hint', 'Review and create') },
  ];
  const stateOf = (i: number): StepState => (i < step ? 'done' : i === step ? 'current' : 'next');
  // What a finished step said, in the steps panel under its name.
  const said = [
    v.email || v.name,
    [v.street_line_1, v.city].filter(Boolean).join(', '),
    '',
  ];
  const typeLabel = isBusiness ? t('clients.typeBusiness', 'B2B (Wholesale)') : t('clients.typeRetail', 'Home Grocery');
  const shownName = (isBusiness && v.company.trim()) || v.name.trim();
  const back = () => (step === 0 ? goBack('/sales/clients') : setStep((s) => s - 1));

  return (
    <div className="max-w-[1120px] mx-auto pb-32 md:pb-8">
      <div ref={topRef} />

      <BackLink
        label={step === 0 ? t('common.backToCustomers', 'Back to customers') : t('common.back', 'Back')}
        title={t('clients.newTitle', 'New client')}
        onClick={back}
      />
      {/* On a phone the top bar already carries the title, and the steps
          card below says which step this is. */}
      <div className="hidden md:block">
        <PageHeader
          title={t('clients.newTitle', 'New client')}
          subtitle={`${t('clients.stepOf', 'Step {{n}} of 3', { n: step + 1 })} · ${steps[step].hint}`}
        />
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="grid gap-3 md:gap-3.5 2xl:gap-4 md:items-start md:grid-cols-[minmax(0,1fr)_260px] lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_320px]"
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
        <div className="min-w-0 space-y-3 md:space-y-3.5 2xl:space-y-4">
          {/* The steps on a phone: one row over the form. From md they are
              the panel beside it. */}
          <Card className="md:hidden px-3.5 py-3">
            <ol aria-label={t('clients.stepOf', 'Step {{n}} of 3', { n: step + 1 })} className="flex items-center">
              {steps.map((s, i) => (
                <li key={s.title} className={`flex items-center min-w-0 ${i < 2 ? 'flex-1' : ''}`}>
                  <button
                    type="button"
                    disabled={i > step}
                    onClick={() => setStep(i)}
                    aria-current={i === step ? 'step' : undefined}
                    className="flex items-center gap-2 min-w-0 disabled:cursor-default"
                  >
                    <StepDot n={i + 1} state={stateOf(i)} />
                    <span className={`text-[13.5px] font-semibold font-display truncate ${
                      i === step ? 'text-ink' : i < step ? 'text-brand' : 'text-muted'
                    }`}>
                      {s.title}
                    </span>
                  </button>
                  {i < 2 && <span aria-hidden="true" className={`flex-1 h-0.5 mx-2.5 rounded-full ${i < step ? 'bg-brand' : 'bg-border'}`} />}
                </li>
              ))}
            </ol>
          </Card>

          {/* ─── Step 1 · Who ─────────────────────────────── */}
          {step === 0 && (
            <>
              {/* Two separate questions, deliberately in two cards. Buying
                  prices and selling rights are unrelated in the data model, and
                  one card made them read as a single "what kind of client is
                  this" choice. */}
              <StepCard
                icon={Wallet}
                title={t('clients.buyingTitle', 'What do they pay when they buy?')}
                subtitle={t('clients.buyingSubtitle', 'Sets the prices they see in the shop. Nothing else.')}
              >
                <div role="radiogroup" aria-label={t('clients.buyingTitle', 'What do they pay when they buy?')} className="grid gap-2.5 @md:grid-cols-2">
                  <ChoiceTile
                    active={isBusiness}
                    icon={Building2}
                    title={t('clients.typeBusiness', 'B2B (Wholesale)')}
                    hint={t('clients.typeBusinessHint', 'Trade prices')}
                    onClick={() => setValue('client_type', 'business', { shouldValidate: true })}
                  />
                  <ChoiceTile
                    active={!isBusiness}
                    icon={ShoppingBasket}
                    title={t('clients.typeRetail', 'Home Grocery')}
                    hint={t('clients.typeRetailHint', 'Same as any shopper')}
                    onClick={() => setValue('client_type', 'retail', { shouldValidate: true })}
                  />
                </div>
              </StepCard>

              <StepCard icon={UserIcon} title={t('clients.contactTitle', 'Contact')}>
                <div className="grid gap-4 @lg:grid-cols-2">
                  {/* Not autofocused. The first thing on this step is the
                      price question above it, and a name field holding focus
                      was blurred empty by that very tap — greeting the rep
                      with "at least 2 characters" before they had typed. */}
                  <TextField
                    className="@lg:col-span-2"
                    label={t('clients.name', 'Full name')}
                    autoComplete="name"
                    leadingIcon={<UserIcon size={17} strokeWidth={1.75} />}
                    error={errors.name?.message}
                    {...register('name')}
                  />
                  <div className="@lg:col-span-2">
                    <TextField
                      label={t('clients.email', 'Email')}
                      type="email" inputMode="email" autoComplete="email"
                      leadingIcon={<Mail size={17} strokeWidth={1.75} />}
                      hint={t('clients.emailHint', 'The login credentials are sent here')}
                      error={errors.email?.message}
                      {...register('email')}
                    />
                    {emailSuggestion && (
                      <button
                        type="button"
                        onClick={() => setValue('email', emailSuggestion, { shouldValidate: true })}
                        className="mt-2 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-brand-whisper text-brand text-[12.5px] font-semibold font-display hover:bg-brand-mist/60 transition-colors"
                      >
                        <Wand2 size={13} strokeWidth={2} />
                        {t('clients.didYouMean', 'Did you mean {{email}}?', { email: emailSuggestion })}
                      </button>
                    )}
                    {/* Somebody else's client: a stop, said here rather than as
                        a refusal at the end of three steps. It says the account
                        is somebody's, never whose. */}
                    {emailElsewhere && (
                      <div role="alert" className="mt-2.5 rounded-xl bg-warning-bg ring-1 ring-inset ring-warning/25 p-3 flex items-start gap-2.5">
                        <AlertCircle size={16} strokeWidth={2} className="text-warning shrink-0 mt-px" />
                        <div className="min-w-0 text-[13px] leading-snug">
                          <p className="text-ink font-medium">
                            {t('clients.belongsElsewhere', 'This email belongs to a client of the office or another rep. You cannot add them yourself: ask the office to pass them to you.')}
                          </p>
                          {/* Not a dead end since 2026-10-28: they can still be
                              ordered for — through the finder, or straight
                              away when they are already among the rep's others. */}
                          <p className="text-gray mt-1">{reachableClient ? st('sales.find.elsewhereReachable') : st('sales.find.elsewhereFind')}</p>
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            {reachableClient ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => navigate(`/sales/orders/new?client=${reachableClient.id}${carry ? `&${carry}` : ''}`)}
                                  className="h-9 px-3 rounded-lg bg-brand hover:bg-brand-mid text-white text-[13px] font-semibold font-display inline-flex items-center gap-1.5 transition-colors"
                                >
                                  <ShoppingCart size={15} strokeWidth={1.75} />
                                  {st('sales.clients.startOrder')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => navigate(`/sales/clients/${reachableClient.id}`)}
                                  className="h-9 px-3 rounded-lg bg-card border border-border hover:border-brand/40 text-ink text-[13px] font-semibold font-display inline-flex items-center gap-1.5 transition-colors"
                                >
                                  {st('sales.find.open')}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => navigate(`/sales/clients?find=${encodeURIComponent(v.email.trim().toLowerCase())}`)}
                                className="h-9 px-3 rounded-lg bg-card border border-border hover:border-brand/40 text-ink text-[13px] font-semibold font-display inline-flex items-center gap-1.5 transition-colors"
                              >
                                <AtSign size={15} strokeWidth={1.75} />
                                {st('sales.find.title')}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Not an error. The server upgrades this account rather
                        than refusing. It names the account only when it is
                        already one of this rep's clients — anything else, and
                        the lookup would be a way to put a name to an email. */}
                    {emailExists && !emailElsewhere && (
                      <div className="mt-2.5 rounded-xl bg-brand-whisper/70 ring-1 ring-inset ring-brand/15 p-3 flex items-start gap-2.5">
                        <Info size={16} strokeWidth={2} className="text-brand shrink-0 mt-px" />
                        <div className="min-w-0 text-[13px] leading-snug">
                          <p className="text-ink font-semibold font-display">
                            {existingClient
                              ? t('clients.emailExists', '{{name}} already has an account with this email', { name: existingClient.name })
                              : t('clients.emailExistsAnon', 'This email already has a Cesto account')}
                          </p>
                          <p className="text-gray mt-0.5">
                            {t('clients.emailExistsRepHint', 'Continuing adds them to your clients. If they already have their own password, they keep it.')}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <TextField
                      label={t('clients.phone', 'Phone')}
                      type="tel" inputMode="tel" autoComplete="tel"
                      leadingIcon={<Phone size={17} strokeWidth={1.75} />}
                      error={errors.phone?.message
                        ?? (phoneClash
                          ? t('clients.phoneTakenAnon', 'Already used by another account')
                          : undefined)}
                      {...register('phone')}
                    />
                    {phoneClash && (
                      <p className="mt-1 text-[12px] text-muted leading-snug">
                        {t('clients.phoneTakenHint', 'A phone number can only belong to one account. Use a different one, or leave it blank.')}
                      </p>
                    )}
                  </div>
                  {/* Two answers, so both on the screen at once rather than
                      behind a dropdown — at the field's own height. */}
                  <div>
                    <p className="text-sm font-semibold text-ink font-display mb-1.5">{t('clients.language', 'Language')}</p>
                    <div role="radiogroup" aria-label={t('clients.language', 'Language')} className="grid grid-cols-2 gap-1 p-1 h-12 rounded-lg bg-surface-sand">
                      {(['es', 'en'] as const).map((l) => {
                        const on = v.preferred_language === l;
                        return (
                          <button
                            key={l}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => setValue('preferred_language', l, { shouldDirty: true })}
                            className={`rounded-md text-[14px] font-semibold font-display transition-colors ${
                              on ? 'bg-card text-ink shadow-card' : 'text-gray hover:text-ink'
                            }`}
                          >
                            {l === 'es' ? 'Español' : 'English'}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </StepCard>
            </>
          )}

          {/* ─── Step 2 · Where ───────────────────────────── */}
          {step === 1 && (
            <>
              {/* Arrives filled with the client's own name and phone (the
                  effect above); the button re-syncs after a change. */}
              <StepCard
                icon={UserCheck}
                title={t('clients.receiverTitle', 'Who takes delivery')}
                subtitle={t('clients.receiverSubtitle', 'The person and phone number the driver calls')}
                action={(
                  <button
                    type="button"
                    onClick={copyFromContact}
                    title={t('clients.copyContact', "Use the client's own name and phone")}
                    className="shrink-0 h-8 px-3 rounded-lg bg-brand-whisper text-brand text-[12.5px] font-semibold font-display hover:bg-brand-mist/60 transition-colors"
                  >
                    {t('clients.useOwnDetails', 'Use theirs')}
                  </button>
                )}
              >
                <div className="grid gap-4 @lg:grid-cols-2">
                  <TextField label={t('clients.contactName', 'Contact name')} autoComplete="name" leadingIcon={<UserIcon size={17} strokeWidth={1.75} />} error={errors.contact_name?.message} {...register('contact_name')} />
                  <TextField label={t('clients.contactPhone', 'Contact phone')} type="tel" inputMode="tel" autoComplete="tel" leadingIcon={<Phone size={17} strokeWidth={1.75} />} error={errors.contact_phone?.message} {...register('contact_phone')} />
                </div>
              </StepCard>

              <StepCard
                icon={MapPin}
                title={t('clients.addressTitle', 'Delivery address')}
                subtitle={t('clients.addressSubtitle', 'Required — orders cannot be placed without one')}
              >
                <div className="grid grid-cols-2 gap-4 @lg:grid-cols-6">
                  <TextField className="col-span-2 @lg:col-span-4" label={t('clients.street1', 'Street address')} autoComplete="address-line1" leadingIcon={<MapPin size={17} strokeWidth={1.75} />} error={errors.street_line_1?.message} {...register('street_line_1')} />
                  {/* Its label already says it is optional. */}
                  <TextField className="col-span-2" label={t('clients.street2', 'Flat, floor, door')} autoComplete="address-line2" error={errors.street_line_2?.message} {...register('street_line_2')} />
                  <TextField
                    className="@lg:col-span-2"
                    label={t('clients.postcode', 'Postcode')}
                    inputMode="numeric" maxLength={5} autoComplete="postal-code"
                    error={errors.postcode?.message}
                    {...register('postcode')}
                  />
                  <TextField className="@lg:col-span-2" label={t('clients.city', 'City')} autoComplete="address-level2" error={errors.city?.message} {...register('city')} />
                  <Select
                    className="col-span-2"
                    label={t('clients.province', 'Province')}
                    hint={provinceForPostcode(v.postcode) ? t('clients.provinceAuto', 'Filled from the postcode') : undefined}
                    error={errors.province?.message}
                    {...register('province')}
                  >
                    <option value="">{t('clients.provinceSelect', 'Select a province…')}</option>
                    {PROVINCE_NAMES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </Select>
                  <Textarea className="col-span-2 @lg:col-span-6" label={t('clients.deliveryNotes', 'Delivery instructions')} rows={2} hint={t('common.optional', 'Optional')} error={errors.delivery_notes?.message} {...register('delivery_notes')} />
                </div>
              </StepCard>
            </>
          )}

          {/* ─── Step 3 · Details + review ────────────────── */}
          {step === 2 && (
            <>
              {isBusiness && (
                <StepCard icon={Building2} title={t('clients.businessTitle', 'Business details')}>
                  <div className="grid gap-4 @lg:grid-cols-2">
                    <TextField className="@lg:col-span-2" label={t('clients.company', 'Company name')} leadingIcon={<Building2 size={17} strokeWidth={1.75} />} error={errors.company?.message} {...register('company')} />
                    <TextField label={t('clients.businessType', 'Business type')} hint={t('clients.businessTypeHint', 'Grocery, restaurant, bakery…')} error={errors.business_type?.message} {...register('business_type')} />
                    <TextField label={t('clients.registrationNo', 'CIF / NIF')} hint={t('clients.registrationNoHint', 'Not validated yet — kept for the record')} error={errors.registration_no?.message} {...register('registration_no')} />
                  </div>
                </StepCard>
              )}

              {/* The review. The email is the one field where a typo is
                  expensive — the password goes there and the client never
                  learns they have an account — so it is repeated at a size
                  that gets read. */}
              <StepCard icon={ClipboardCheck} title={t('clients.reviewTitle', 'Check before creating')}>
                <div className="rounded-xl bg-brand-whisper/70 ring-1 ring-inset ring-brand/15 p-4 flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-card text-brand shadow-card flex items-center justify-center shrink-0">
                    <Mail size={19} strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12.5px] text-gray">
                      {v.send_credentials ? t('clients.credentialsGoTo', 'Login details will be emailed to') : t('clients.email', 'Email')}
                    </p>
                    <p className="text-[17px] font-semibold font-display text-ink break-all leading-snug">{v.email || '—'}</p>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-border divide-y divide-border">
                  <ReviewGroup icon={UserIcon} title={steps[0].title} edit={{ label: t('common.edit', 'Edit'), onClick: () => setStep(0) }}>
                    <ReviewRow label={t('clients.name', 'Full name')} value={v.name} strong />
                    <ReviewRow label={t('clients.buysAt', 'Buys at')} value={typeLabel} />
                    <ReviewRow label={t('clients.phone', 'Phone')} value={v.phone} />
                    <ReviewRow label={t('clients.language', 'Language')} value={v.preferred_language === 'en' ? 'English' : 'Español'} />
                  </ReviewGroup>
                  <ReviewGroup icon={MapPin} title={steps[1].title} edit={{ label: t('common.edit', 'Edit'), onClick: () => setStep(1) }}>
                    <ReviewRow
                      label={t('clients.addressTitle', 'Delivery address')}
                      value={[[v.street_line_1, v.street_line_2].filter(Boolean).join(', '), [v.postcode, v.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
                    />
                    <ReviewRow label={t('clients.receiverTitle', 'Who takes delivery')} value={[v.contact_name, v.contact_phone].filter(Boolean).join(', ')} />
                  </ReviewGroup>
                  {/* Stated, not asked. The server records the rep who is
                      signed in and refuses the field, because the one
                      human-readable record of who owns a client should not be
                      free text typed by whoever is claiming it. */}
                  <div className="px-4 py-3.5">
                    <dl>
                      <ReviewRow label={t('clients.salesManagerLabel', 'Sales rep')} value={repName} />
                    </dl>
                  </div>
                </div>

                {/* A switch, since it is a setting on what happens next rather
                    than a box to tick on a form. */}
                <label className="mt-4 flex items-center gap-3 rounded-xl border border-border p-3.5 cursor-pointer hover:border-brand/40 transition-colors">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-semibold font-display text-ink">{t('clients.sendCredentials', 'Email the login details now')}</span>
                    <span className="block mt-0.5 text-[12.5px] text-gray leading-snug">
                      {v.send_credentials
                        ? t('clients.sendCredentialsOn', 'They get an email with their username and a temporary password.')
                        : t('clients.sendCredentialsOff', 'Nothing is sent. You can create their login later, from their profile.')}
                    </span>
                  </span>
                  <input type="checkbox" className="peer sr-only" {...register('send_credentials')} />
                  <span
                    aria-hidden="true"
                    className="relative w-11 h-6 rounded-full shrink-0 bg-surface-sand ring-1 ring-inset ring-border transition-colors peer-checked:bg-brand peer-checked:ring-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:rounded-full after:bg-white after:shadow-card after:transition-transform peer-checked:after:translate-x-5"
                  />
                </label>
              </StepCard>
            </>
          )}

          {/* Any error the step check missed, summarised where the eye already is. */}
          {(serverError || (step === 2 && Object.keys(errors).length > 0)) && (
            <div className="rounded-xl bg-danger-bg ring-1 ring-inset ring-danger/20 p-4 flex items-start gap-2.5" role="alert">
              <AlertCircle size={17} strokeWidth={2} className="text-danger shrink-0 mt-px" />
              <p className="text-[13.5px] text-danger font-semibold font-display">
                {serverError ?? t('clients.fixErrors', 'Some details still need fixing — check the steps above.')}
              </p>
            </div>
          )}
        </div>

        {/* The steps beside the form from md: who this will be as it fills in,
            where the rep is, and the buttons — pinned while the form scrolls.
            On a phone only the buttons are left, fixed to the bottom; the
            wrapper draws its card from md, so its buttons can still show. */}
        <div className="md:sticky md:top-[72px] md:bg-card md:rounded-2xl md:border md:border-border md:shadow-card">
          <div className="hidden md:block">
            <div className="px-5 pt-5 pb-4 flex items-center gap-3 border-b border-border">
              {isBusiness || shownName ? (
                <Avatar name={shownName} business={isBusiness} />
              ) : (
                <span className="w-11 h-11 rounded-full bg-surface-sand text-muted flex items-center justify-center shrink-0">
                  <UserPlus size={19} strokeWidth={1.75} />
                </span>
              )}
              <div className="min-w-0">
                <p className="text-[15.5px] font-semibold font-display text-ink leading-tight truncate">
                  {shownName || t('clients.newTitle', 'New client')}
                </p>
                <p className="mt-0.5 text-[12.5px] text-muted truncate">{typeLabel}</p>
              </div>
            </div>
            <ol aria-label={t('clients.stepOf', 'Step {{n}} of 3', { n: step + 1 })} className="px-5 py-5">
              {steps.map((s, i) => (
                <li key={s.title} className="relative pb-5 last:pb-0">
                  {i < 2 && (
                    <span aria-hidden="true" className={`absolute left-4 -translate-x-1/2 top-10 bottom-1 w-0.5 rounded-full ${i < step ? 'bg-brand' : 'bg-border'}`} />
                  )}
                  <button
                    type="button"
                    disabled={i > step}
                    onClick={() => setStep(i)}
                    aria-current={i === step ? 'step' : undefined}
                    className="w-full flex items-start gap-3 text-left disabled:cursor-default"
                  >
                    <StepDot n={i + 1} state={stateOf(i)} />
                    <span className="min-w-0 flex-1 pt-1">
                      <span className={`block text-[14.5px] font-semibold font-display leading-tight ${i > step ? 'text-muted' : 'text-ink'}`}>
                        {s.title}
                      </span>
                      <span className="block mt-0.5 text-[12.5px] text-muted truncate">
                        {i < step && said[i] ? said[i] : s.hint}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <div className="fixed md:static inset-x-0 bottom-0 z-30 flex md:flex-col-reverse gap-3 md:gap-2 bg-card/95 md:bg-transparent backdrop-blur md:backdrop-blur-none border-t border-border px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-5 md:pt-4 md:pb-5">
            <button
              type="button"
              onClick={back}
              className="flex-1 md:flex-none md:w-full min-h-[52px] px-5 rounded-xl bg-card border border-border hover:border-brand/50 font-semibold font-display text-[15px] text-ink transition-colors"
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
                className="flex-[2] md:flex-none md:w-full min-h-[52px] px-5 rounded-xl bg-brand hover:bg-brand-mid text-white font-semibold font-display text-[15px] inline-flex items-center justify-center gap-2 shadow-[0_10px_22px_-10px_rgba(5,78,232,0.7)] transition-colors"
              >
                {t('common.next', 'Next')}
                <ArrowRight size={17} strokeWidth={2.25} />
              </button>
            ) : (
              <button
                key="create"
                type="submit"
                disabled={isSubmitting}
                className="flex-[2] md:flex-none md:w-full min-h-[52px] px-5 rounded-xl bg-brand hover:bg-brand-mid disabled:opacity-60 text-white font-semibold font-display text-[15px] inline-flex items-center justify-center gap-2 shadow-[0_10px_22px_-10px_rgba(5,78,232,0.7)] transition-colors"
              >
                <Check size={17} strokeWidth={2.5} />
                {isSubmitting ? t('clients.creating', 'Creating…') : t('clients.create', 'Create client')}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
