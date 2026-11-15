import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle, Check, Loader2, Mail, MapPin, Minus, Phone, Plus, User as UserIcon,
} from 'lucide-react';
import { ApiError, useSubmitRashanLead, type RashanLeadFrequency } from '@grocery-app/shared';
import { TextField, Textarea } from '@/components/form';
import { useAuthStore } from '@/stores/authStore';
import { FREQUENCIES, type HomeGroceryCopy, type Lang } from './copy';

/* ═══════════════════════════════════════════════════════
   THE REQUEST — three short steps, easiest first.

   Home first (how many, how often, what can't run out): questions
   anyone can answer without looking anything up, so the household is
   already invested by the time we ask for an address. Contact last.

   Beside it on wide screens, the same paper list as the hero fills in
   as they answer — the request reads as THEIR list, not a form.
   ═══════════════════════════════════════════════════════ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOTES_MAX = 2000; // the request's dietary_notes cap

type Errors = Partial<Record<'name' | 'phone' | 'email' | 'address' | 'postcode' | 'city', string>>;

function Chip({ selected, onClick, children }: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-11 px-4 rounded-xl border-2 text-[14px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
        selected
          ? 'border-brand bg-brand-whisper text-brand-ink'
          : 'border-border bg-surface-cream text-ink hover:border-brand-light'
      }`}
    >
      {selected && <Check size={14} strokeWidth={3} className="text-brand" />}
      {children}
    </button>
  );
}

/** Step 1 asks QUESTIONS, a size up from the field labels of steps 2–3. */
function Label({ children, hint, htmlFor }: { children: React.ReactNode; hint?: string; htmlFor?: string }) {
  return (
    <div className="mb-2.5">
      {htmlFor
        ? <label htmlFor={htmlFor} className="block text-[15px] font-semibold text-ink">{children}</label>
        : <p className="text-[15px] font-semibold text-ink">{children}</p>}
      {hint && <p className="text-[13px] text-gray mt-0.5">{hint}</p>}
    </div>
  );
}

/** What was sent, in words — the confirmation repeats it back. */
export interface SentRequest {
  email: string;
  household: number;
  frequency: string;
}

export interface RequestFormProps {
  c: HomeGroceryCopy;
  lang: Lang;
  household: number;
  onHouseholdChange: (n: number) => void;
  onSent: (sent: SentRequest) => void;
}

export default function RequestForm({ c, lang, household, onHouseholdChange, onSent }: RequestFormProps) {
  const user = useAuthStore((s) => s.user);
  const submit = useSubmitRashanLead();
  const qc = useQueryClient();

  const [step, setStep] = useState(0);
  const [frequency, setFrequency] = useState<RashanLeadFrequency>('monthly');
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [postcode, setPostcode] = useState('');
  const [city, setCity] = useState('');
  // Untouched fields show the signed-in account's details — which arrive
  // after the first render while the session restores — and anything typed
  // takes over from there. Derived rather than copied in an effect, so a late
  // session can never overwrite what someone has typed.
  const [nameTyped, setName] = useState<string | null>(null);
  const [phoneTyped, setPhone] = useState<string | null>(null);
  const [emailTyped, setEmail] = useState<string | null>(null);
  const name = nameTyped ?? user?.name ?? '';
  const phone = phoneTyped ?? user?.phone ?? '';
  const email = emailTyped ?? user?.email ?? '';
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  // Moving between steps: bring the card back into view on a phone, where
  // "Continuar" sits below the fold. Focus goes to the step's first field
  // (autoFocus below), and the live heading announces which step it is.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    // Under the sticky header counts as out of view, not just above the screen.
    const top = cardRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 160) cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [step]);

  function validate(s: number): boolean {
    const next: Errors = {};
    if (s === 1) {
      if (!address.trim()) next.address = c.errAddress;
      if (!postcode.trim()) next.postcode = c.errPostcode;
      if (!city.trim()) next.city = c.errCity;
    }
    if (s === 2) {
      if (!name.trim()) next.name = c.errName;
      if (!phone.trim()) next.phone = c.errPhone;
      if (!EMAIL_RE.test(email.trim())) next.email = c.errEmail;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function send() {
    setFormError(null);
    if (!validate(2)) return;
    const to = email.trim().toLowerCase();
    try {
      await submit.mutateAsync({
        name: name.trim(),
        phone: phone.trim(),
        email: to,
        household_size: household,
        frequency,
        address_line: address.trim(),
        postcode: postcode.trim(),
        city: city.trim(),
        dietary_notes: notes.trim() || null,
        language: lang,
        source: 'home_grocery_form',
      });
      const f = FREQUENCIES.find((x) => x.id === frequency)!;
      onSent({
        email: to,
        household,
        frequency: lang === 'en' ? f.en : f.es,
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Signed in and already waiting, or already a subscriber: the page
        // swaps to their status as soon as it re-reads it.
        setFormError(c.errAlready);
        void qc.invalidateQueries({ queryKey: ['my-home-grocery'] });
      } else if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408) {
        setFormError(err.message);
      } else {
        setFormError(c.errSubmit);
      }
    }
  }

  function next() {
    if (!validate(step)) return;
    setStep((s) => Math.min(2, s + 1));
  }

  return (
    <div ref={cardRef} className="scroll-mt-[172px]">
      {/* Progress as a bar, not numbers: the card beside the form already
          numbers the three steps of the PROCESS, and two numbered sequences
          side by side read as one. Done steps can be revisited. */}
      <div>
        <p className="text-[13px] text-gray tabular-nums">{c.stepOf(step + 1, 3)}</p>
        <ol className="mt-2 grid grid-cols-3 gap-2">
          {c.steps.map((label, i) => {
            const done = i < step;
            const current = i === step;
            return (
              <li key={label}>
                <button
                  type="button"
                  disabled={!done}
                  onClick={() => done && setStep(i)}
                  aria-current={current ? 'step' : undefined}
                  className="w-full text-left disabled:cursor-default rounded-md"
                >
                  <span className={`block h-1.5 rounded-full transition-colors ${i <= step ? 'bg-brand' : 'bg-border'}`} />
                  <span
                    className={`mt-2 flex items-center gap-1 text-[13px] truncate ${
                      current ? 'text-ink font-semibold' : done ? 'text-brand font-semibold' : 'text-gray font-medium'
                    }`}
                  >
                    {done && <Check size={13} strokeWidth={3} className="shrink-0" />}
                    {label}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <form
        noValidate
        onSubmit={(e) => { e.preventDefault(); if (step < 2) next(); else void send(); }}
        className="pt-7"
      >
        <h3 aria-live="polite" className="sr-only">
          {c.stepOf(step + 1, 3)}: {c.steps[step]}
        </h3>

        {step === 0 && (
          <div className="space-y-7">
            <div>
              <Label>{c.household}</Label>
              <div className="inline-flex items-center gap-1 bg-surface-cream border-2 border-border rounded-xl h-[52px] px-1.5">
                <button
                  type="button"
                  aria-label={c.fewer}
                  onClick={() => onHouseholdChange(Math.max(1, household - 1))}
                  disabled={household <= 1}
                  className="w-10 h-10 rounded-lg bg-surface-sand text-ink flex items-center justify-center hover:bg-brand-mist hover:text-brand transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Minus size={16} strokeWidth={2.25} />
                </button>
                <output aria-live="polite" className="w-14 text-center text-[22px] font-bold text-ink tabular-nums">
                  {household}
                </output>
                <button
                  type="button"
                  aria-label={c.more}
                  onClick={() => onHouseholdChange(Math.min(20, household + 1))}
                  disabled={household >= 20}
                  className="w-10 h-10 rounded-lg bg-surface-sand text-ink flex items-center justify-center hover:bg-brand-mist hover:text-brand transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={16} strokeWidth={2.25} />
                </button>
              </div>
            </div>

            <div>
              <Label>{c.frequency}</Label>
              <div className="flex flex-wrap gap-2">
                {FREQUENCIES.map((f) => (
                  <Chip key={f.id} selected={frequency === f.id} onClick={() => setFrequency(f.id)}>
                    {lang === 'en' ? f.en : f.es}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="hg-notes">{c.notes}</Label>
              <Textarea
              id="hg-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={c.notesPlaceholder}
              maxLength={NOTES_MAX}
              rows={3}
            />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-[14px] text-gray">{c.addressIntro}</p>
            <TextField
              label={c.address}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={c.addressPlaceholder}
              autoComplete="street-address"
              maxLength={300}
              error={errors.address}
              leadingIcon={<MapPin size={16} strokeWidth={1.75} />}
              autoFocus
            />
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
              <TextField
                label={c.postcode}
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
                placeholder={c.postcodePlaceholder}
                autoComplete="postal-code"
                inputMode="numeric"
                maxLength={10}
                error={errors.postcode}
                className="font-mono"
              />
              <TextField
                label={c.city}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder={c.cityPlaceholder}
                autoComplete="address-level2"
                maxLength={120}
                error={errors.city}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-[14px] text-gray">{c.contactIntro}</p>
            <TextField
              label={c.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={c.namePlaceholder}
              autoComplete="name"
              maxLength={120}
              error={errors.name}
              leadingIcon={<UserIcon size={16} strokeWidth={1.75} />}
              autoFocus={!name}
            />
            <TextField
              label={c.phone}
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={c.phonePlaceholder}
              autoComplete="tel"
              maxLength={32}
              error={errors.phone}
              leadingIcon={<Phone size={16} strokeWidth={1.75} />}
            />
            <TextField
              label={c.email}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={c.emailPlaceholder}
              autoComplete="email"
              autoCapitalize="none"
              maxLength={160}
              error={errors.email}
              hint={c.emailHint}
              leadingIcon={<Mail size={16} strokeWidth={1.75} />}
            />
          </div>
        )}

        {formError && (
          <p role="alert" className="mt-5 flex items-start gap-2 bg-danger-bg text-danger rounded-xl px-4 py-3 text-[14px] font-medium">
            <AlertCircle size={16} strokeWidth={2} className="shrink-0 mt-0.5" />
            {formError}
          </p>
        )}

        <div className="mt-7 flex items-center gap-3">
          {step > 0 && (
            <button
              type="button"
              onClick={() => { setErrors({}); setStep((s) => s - 1); }}
              className="min-h-[52px] px-5 rounded-xl text-[15px] font-semibold text-ink hover:bg-surface-sand transition-colors"
            >
              {c.back}
            </button>
          )}
          <button
            type="submit"
            disabled={submit.isPending}
            className="flex-1 sm:flex-none sm:ml-auto min-h-[52px] px-7 rounded-xl bg-brand text-white text-[15px] font-bold hover:bg-brand-mid transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-wait"
          >
            {submit.isPending && <Loader2 size={17} strokeWidth={2.25} className="animate-spin" />}
            {step < 2 ? c.next : c.submit}
          </button>
        </div>
      </form>
    </div>
  );
}
