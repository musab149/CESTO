import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, CheckCircle2, XCircle, Info, AlertTriangle, UserCheck, UserPlus } from 'lucide-react';
import { provinceForPostcode } from '@grocery-app/shared';
import type {
  RashanLead, RashanLeadFrequency, ApproveRashanLeadPayload,
} from '@grocery-app/shared';
import { EMAIL_INPUT_PROPS } from '@/lib/emailField';

export type HomeGroceryDecision = 'approve' | 'reject';

type Submit =
  | { mode: 'approve'; payload: ApproveRashanLeadPayload }
  | { mode: 'reject'; reason: string };

interface Props {
  mode: HomeGroceryDecision;
  lead: RashanLead;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onSubmit: (s: Submit) => void;
}

const FREQUENCIES: RashanLeadFrequency[] = ['weekly', 'biweekly', 'every_3_weeks', 'monthly'];

const inputCls = 'mt-1 w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30';
const labelCls = 'text-[11px] font-medium text-muted uppercase tracking-wide font-display';

/**
 * Approve or reject a Home Grocery request.
 *
 * Approve has two shapes, and the dialog says which one before anybody
 * presses anything, because they are very different acts:
 *
 *   LINK — the request maps to an account they already have. Approving gives
 *   it a Home Grocery profile and leaves everything else alone, password
 *   included. Name and email are shown, not edited: they are the account's.
 *
 *   OPEN — no account. Approving opens one, staff-created, and emails the
 *   login. Name and email are editable here, because a typo now is a login
 *   that never arrives.
 *
 * An address is asked for only when the account will not have one, since an
 * order cannot be built without it — prefilled from what they typed on the
 * form. The form never asks for the province, so it is read off the postcode
 * (its first two digits ARE the province); left blank, it held the approve
 * button disabled with nothing on screen saying why.
 *
 * Reject asks for the reason the HOUSEHOLD will read, and says through which
 * channels it will reach them.
 */
export default function HomeGroceryDecisionModal({
  mode, lead, isSubmitting = false, errorMessage, onCancel, onSubmit,
}: Props) {
  const { t } = useTranslation();
  const account = lead.account ?? null;
  const needsAddress = !account || !account.has_address;

  // Account (OPEN only)
  const [name, setName] = useState(lead.name);
  const [email, setEmail] = useState(lead.email ?? '');
  const [phone, setPhone] = useState(lead.phone);
  const [lang, setLang] = useState<'es' | 'en'>(lead.language === 'en' ? 'en' : 'es');

  // Household — every field is the household's own answer, editable so a
  // detail settled on the phone call lands on the profile.
  const [household, setHousehold] = useState(String(lead.household_size));
  const [adults, setAdults] = useState(lead.adults != null ? String(lead.adults) : '');
  const [children, setChildren] = useState(lead.children != null ? String(lead.children) : '');
  const [frequency, setFrequency] = useState<RashanLeadFrequency>(lead.frequency);
  const [slot, setSlot] = useState(lead.preferred_slot ?? '');
  const [notes, setNotes] = useState(lead.dietary_notes ?? '');
  const [budget, setBudget] = useState(lead.budget_per_cycle ? String(Number(lead.budget_per_cycle)) : '');
  const [contactPhone, setContactPhone] = useState(lead.phone);

  // Address
  const [street1, setStreet1] = useState(lead.address_line ?? '');
  const [street2, setStreet2] = useState('');
  const [postcode, setPostcode] = useState(lead.postcode ?? '');
  const [city, setCity] = useState(lead.city ?? '');
  const [province, setProvince] = useState(() => provinceForPostcode(lead.postcode ?? '') ?? '');
  const [addrName, setAddrName] = useState(lead.name);
  const [addrPhone, setAddrPhone] = useState(lead.phone);

  const [reason, setReason] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !isSubmitting) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, isSubmitting]);

  const n = (s: string) => (s.trim() === '' ? null : Number(s));
  const orNull = (s: string) => (s.trim() ? s.trim() : null);

  const householdN = Number(household);
  const addressOk = !needsAddress || [street1, postcode, city, province, addrName, addrPhone].every((v) => v.trim());
  const canApprove = !isSubmitting
    && !account?.blocked
    && Number.isInteger(householdN) && householdN >= 1 && householdN <= 30
    && (account ? true : (name.trim().length > 0 && /\S+@\S+\.\S+/.test(email.trim())))
    && addressOk;
  const canReject = !isSubmitting && reason.trim().length >= 10;

  // What is holding Approve back, said out loud. A greyed-out button on its
  // own read as "approving does not work".
  const missing = [
    !account && !name.trim() && t('homeGrocery.modal.name', 'Name'),
    !account && !/\S+@\S+\.\S+/.test(email.trim()) && t('homeGrocery.modal.email', 'Email'),
    !(Number.isInteger(householdN) && householdN >= 1 && householdN <= 30) && t('homeGrocery.modal.householdSize', 'People'),
    ...(needsAddress ? [
      !street1.trim() && t('homeGrocery.modal.street1', 'Street and number'),
      !postcode.trim() && t('homeGrocery.modal.postcode', 'Postcode'),
      !city.trim() && t('homeGrocery.modal.city', 'City'),
      !province.trim() && t('homeGrocery.modal.province', 'Province'),
      !addrName.trim() && t('homeGrocery.modal.addrName', 'Recipient'),
      !addrPhone.trim() && t('homeGrocery.modal.addrPhone', 'Recipient phone'),
    ] : []),
  ].filter((x): x is string => !!x);

  /** A new postcode names its province; take it, unless it names none. */
  const changePostcode = (v: string) => {
    setPostcode(v);
    const p = provinceForPostcode(v);
    if (p) setProvince(p);
  };

  function submit() {
    if (mode === 'reject') {
      if (canReject) onSubmit({ mode: 'reject', reason: reason.trim() });
      return;
    }
    if (!canApprove) return;
    onSubmit({
      mode: 'approve',
      payload: {
        // For a linked account these are ITS name and email — the server
        // finds the account by them and changes neither.
        user: account
          ? { name: account.name, email: account.email ?? email.trim(), preferred_language: lang }
          : { name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim() || undefined, preferred_language: lang },
        ...(needsAddress ? {
          address: {
            contact_name: addrName.trim(),
            contact_phone: addrPhone.trim(),
            street_line_1: street1.trim(),
            ...(street2.trim() ? { street_line_2: street2.trim() } : {}),
            postcode: postcode.trim(),
            city: city.trim(),
            province: province.trim(),
          },
        } : {}),
        profile: {
          household_size: householdN,
          adults: n(adults),
          children: n(children),
          frequency,
          preferred_slot: orNull(slot),
          dietary_notes: orNull(notes),
          budget_per_cycle: n(budget),
          contact_phone: orNull(contactPhone),
        },
      },
    });
  }

  const approve = mode === 'approve';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => { if (!isSubmitting) onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="hg-decision-title"
    >
      <div
        className="bg-card rounded-2xl shadow-modal w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-start gap-3 p-5 border-b border-border ${approve ? 'bg-brand-mist/50 text-brand-deep' : 'bg-danger-bg text-danger'}`}>
          {approve
            ? <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0 text-brand" strokeWidth={1.75} />
            : <XCircle className="w-5 h-5 mt-0.5 shrink-0 text-danger" strokeWidth={1.75} />}
          <div className="flex-1 min-w-0">
            <h3 id="hg-decision-title" className="text-base font-bold font-display text-ink">
              {approve
                ? t('homeGrocery.modal.approveTitle', 'Approve Home Grocery request')
                : t('homeGrocery.modal.rejectTitle', 'Reject Home Grocery request')}
            </h3>
            <p className="text-[13px] mt-0.5 font-body opacity-90">
              {approve
                ? t('homeGrocery.modal.approveSubtitle', '{{name}} becomes a Home Grocery subscriber. Orders you build for them land in the Home Grocery book.', { name: lead.name })
                : t('homeGrocery.modal.rejectSubtitle', '{{name}} will be told, with your reason, word for word.', { name: lead.name })}
            </p>
          </div>
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg hover:bg-black/10 transition-colors shrink-0"
            aria-label={t('common.close', 'Close')}
            type="button"
          >
            <X size={18} strokeWidth={1.75} className="text-muted" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {approve ? (
            <>
              {/* What approving will do to an account — said first. */}
              {account ? (
                <div className={`rounded-lg border px-3 py-2.5 text-[13px] font-body flex items-start gap-2 ${account.blocked ? 'bg-danger-bg border-danger/40 text-danger' : 'bg-surface-cream border-border text-ink'}`}>
                  {account.blocked
                    ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={1.75} />
                    : <UserCheck className="w-4 h-4 mt-0.5 shrink-0 text-brand" strokeWidth={1.75} />}
                  <div className="min-w-0">
                    <p className="font-semibold font-display">
                      {t('homeGrocery.modal.linkTitle', 'Links their existing account')}
                      {account.is_business && (
                        <span className="ml-2 inline-flex items-center h-5 px-1.5 rounded text-[11px] font-bold uppercase tracking-wide bg-cool-mist text-cool-deep align-middle">B2B</span>
                      )}
                    </p>
                    <p className="mt-0.5 break-words">
                      {account.name} · <span className="font-mono">{account.email ?? '—'}</span>
                    </p>
                    <p className="mt-1 text-muted">
                      {account.blocked
                        ? t('homeGrocery.modal.blocked', 'This account is blocked. Unblock it before approving.')
                        : t('homeGrocery.modal.linkBody', 'Nothing about the account changes — not the name, not the password. They get a notification and an email saying they are approved.')}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-surface-cream px-3 py-2.5 text-[13px] font-body text-ink flex items-start gap-2">
                  <UserPlus className="w-4 h-4 mt-0.5 shrink-0 text-brand" strokeWidth={1.75} />
                  <div>
                    <p className="font-semibold font-display">{t('homeGrocery.modal.openTitle', 'Opens a new account')}</p>
                    <p className="mt-0.5 text-muted">
                      {t('homeGrocery.modal.openBody', 'No account matches this request. One is created and the login emailed to the address below — check it carefully.')}
                    </p>
                  </div>
                </div>
              )}

              {!account && (
                <section>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-ink font-display mb-2">
                    {t('homeGrocery.modal.accountSection', 'Account')}
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block">
                      <span className={labelCls}>{t('homeGrocery.modal.name', 'Name')} *</span>
                      <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t('homeGrocery.modal.email', 'Email (login)')} *</span>
                      <input type="email" {...EMAIL_INPUT_PROPS} value={email} onChange={(e) => setEmail(e.target.value.toLowerCase())} className={`${inputCls} font-mono`} />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t('homeGrocery.modal.phone', 'Account phone')}</span>
                      <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={`${inputCls} font-mono`} />
                      <span className="mt-1 block text-[11px] text-muted font-body">
                        {t('homeGrocery.modal.phoneHint', 'Leave blank if another account already uses this number.')}
                      </span>
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t('homeGrocery.modal.language', 'Language')}</span>
                      <select value={lang} onChange={(e) => setLang(e.target.value as 'es' | 'en')} className={inputCls}>
                        <option value="es">Español</option>
                        <option value="en">English</option>
                      </select>
                    </label>
                  </div>
                </section>
              )}

              <section>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-ink font-display mb-2">
                  {t('homeGrocery.modal.householdSection', 'Household')}
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  <label className="block">
                    <span className={labelCls}>{t('homeGrocery.modal.householdSize', 'People')} *</span>
                    <input type="number" min={1} max={30} value={household} onChange={(e) => setHousehold(e.target.value)} className={inputCls} />
                  </label>
                  <label className="block">
                    <span className={labelCls}>{t('homeGrocery.modal.adults', 'Adults')}</span>
                    <input type="number" min={0} max={30} value={adults} onChange={(e) => setAdults(e.target.value)} className={inputCls} />
                  </label>
                  <label className="block">
                    <span className={labelCls}>{t('homeGrocery.modal.children', 'Children')}</span>
                    <input type="number" min={0} max={30} value={children} onChange={(e) => setChildren(e.target.value)} className={inputCls} />
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <label className="block">
                    <span className={labelCls}>{t('homeGrocery.modal.frequency', 'How often')}</span>
                    <select value={frequency} onChange={(e) => setFrequency(e.target.value as RashanLeadFrequency)} className={inputCls}>
                      {FREQUENCIES.map((f) => (
                        <option key={f} value={f}>{t(`homeGrocery.frequency.${f}`, f)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className={labelCls}>{t('homeGrocery.modal.slot', 'Preferred time')}</span>
                    <input value={slot} onChange={(e) => setSlot(e.target.value)} className={inputCls} />
                  </label>
                  <label className="block">
                    <span className={labelCls}>{t('homeGrocery.modal.contactPhone', 'Contact phone')}</span>
                    <input type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className={`${inputCls} font-mono`} />
                  </label>
                  <label className="block">
                    <span className={labelCls}>{t('homeGrocery.modal.budget', 'Budget per delivery (€)')}</span>
                    <input type="number" min={0} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} className={inputCls} />
                  </label>
                </div>
                <label className="block mt-3">
                  <span className={labelCls}>{t('homeGrocery.modal.notes', 'What they need')}</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    className="mt-1 w-full bg-surface-cream border border-border rounded-lg px-3 py-2 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 resize-none"
                  />
                </label>
              </section>

              {needsAddress && (
                <section>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-ink font-display mb-1">
                    {t('homeGrocery.modal.addressSection', 'Delivery address')}
                  </h4>
                  <p className="text-[12px] text-muted font-body mb-2">
                    {account
                      ? t('homeGrocery.modal.addressWhyLinked', 'Their account has no address yet, and an order cannot be built without one.')
                      : t('homeGrocery.modal.addressWhyNew', 'Needed to open the account — prefilled from the form. The form never asked for the province.')}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="block sm:col-span-2">
                      <span className={labelCls}>{t('homeGrocery.modal.street1', 'Street and number')} *</span>
                      <input value={street1} onChange={(e) => setStreet1(e.target.value)} className={inputCls} />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className={labelCls}>{t('homeGrocery.modal.street2', 'Floor, door (optional)')}</span>
                      <input value={street2} onChange={(e) => setStreet2(e.target.value)} className={inputCls} />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t('homeGrocery.modal.postcode', 'Postcode')} *</span>
                      <input value={postcode} onChange={(e) => changePostcode(e.target.value)} className={`${inputCls} font-mono`} />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t('homeGrocery.modal.city', 'City')} *</span>
                      <input value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t('homeGrocery.modal.province', 'Province')} *</span>
                      <input value={province} onChange={(e) => setProvince(e.target.value)} placeholder="Madrid" className={inputCls} />
                      {province && provinceForPostcode(postcode) === province && (
                        <span className="mt-1 block text-[11px] text-muted font-body">
                          {t('homeGrocery.modal.provinceAuto', 'Filled from the postcode')}
                        </span>
                      )}
                    </label>
                    <label className="block">
                      <span className={labelCls}>{t('homeGrocery.modal.addrName', 'Recipient')} *</span>
                      <input value={addrName} onChange={(e) => setAddrName(e.target.value)} className={inputCls} />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className={labelCls}>{t('homeGrocery.modal.addrPhone', 'Recipient phone')} *</span>
                      <input type="tel" value={addrPhone} onChange={(e) => setAddrPhone(e.target.value)} className={`${inputCls} font-mono`} />
                    </label>
                  </div>
                </section>
              )}
            </>
          ) : (
            <>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted font-display">
                  {t('homeGrocery.modal.reason', 'Reason')}
                  <span className="text-muted font-normal normal-case ml-1">· {t('homeGrocery.modal.reasonMin', 'min 10 characters')}</span>
                </span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={5}
                  autoFocus
                  maxLength={2000}
                  placeholder={t('homeGrocery.modal.reasonPlaceholder', 'e.g. We do not deliver to your postcode yet — we will let you know as soon as we do.')}
                  className="mt-1.5 w-full bg-surface-cream border border-border rounded-lg px-3 py-2 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 resize-none"
                />
                <span className="mt-1 block text-[11px] font-mono text-muted">
                  {reason.trim().length}/10
                </span>
              </label>
              {/* Where the reason goes — so nobody assumes a household heard
                  a "no" that had no way to reach them. */}
              <div className="bg-surface-cream border border-border rounded-lg px-3 py-2 text-[12px] font-body text-muted flex items-start gap-2">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" strokeWidth={1.75} />
                <span>
                  {account && lead.email
                    ? t('homeGrocery.modal.reachBoth', 'They will see it in their notifications and get it by email.')
                    : account
                      ? t('homeGrocery.modal.reachInApp', 'They will see it in their notifications.')
                      : lead.email
                        ? t('homeGrocery.modal.reachEmail', 'They have no account — the reason goes by email only.')
                        : t('homeGrocery.modal.reachNone', 'No account and no email — call them on {{phone}} to tell them.', { phone: lead.phone })}
                </span>
              </div>
            </>
          )}

          {approve && !isSubmitting && !account?.blocked && missing.length > 0 && (
            <div className="bg-warning-bg border border-warning/40 rounded-lg px-3 py-2 text-[13px] font-body text-ink flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-warning" strokeWidth={1.75} />
              <span>{t('homeGrocery.modal.missing', 'To approve, fill in: {{fields}}', { fields: missing.join(', ') })}</span>
            </div>
          )}

          {errorMessage && (
            <div className="bg-danger-bg border border-danger/40 rounded-lg px-3 py-2 text-[13px] font-body text-danger">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end px-5 pb-5 pt-0">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors disabled:opacity-50"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={approve ? !canApprove : !canReject}
            className={`h-11 px-5 rounded-xl text-sm font-semibold font-display text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${approve ? 'bg-brand hover:bg-brand-mid' : 'bg-danger hover:bg-danger/90'}`}
          >
            {isSubmitting
              ? t('homeGrocery.modal.working', 'Working…')
              : approve
                ? (account
                  ? t('homeGrocery.modal.approveLink', 'Approve & link account')
                  : t('homeGrocery.modal.approveOpen', 'Approve & email login'))
                : t('homeGrocery.modal.rejectSubmit', 'Reject request')}
          </button>
        </div>
      </div>
    </div>
  );
}
