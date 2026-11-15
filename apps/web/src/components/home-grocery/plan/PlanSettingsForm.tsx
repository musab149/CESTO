import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Info } from 'lucide-react';
import {
  PLAN_FREQUENCIES, DELIVERY_WINDOWS,
  type DeliveryWindow, type PlanAddress, type PlanFrequency, type PlanSettingsPayload,
} from '@grocery-app/shared';
import { FREQ_LABELS, PLAN_COPY, WEEKDAYS, WINDOWS, WINDOW_TITLES, type Lang } from '../planCopy';

export type PlanSettingsValue = {
  frequency: PlanFrequency;
  preferred_weekday: number | null;
  preferred_window: DeliveryWindow | null;
  address_id: string;
};

/** A settings row: what it is on the left, the choice on the right — on a phone, one above the other. */
function Section({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section className="py-6 first:pt-0 last:pb-0 border-b border-border/50 last:border-b-0 md:grid md:grid-cols-[minmax(0,220px)_minmax(0,1fr)] md:gap-8">
      <div className="mb-3 md:mb-0">
        <h3 className="text-[16px] font-bold text-ink font-display">{title}</h3>
        {lead && <p className="mt-1 text-[13px] text-gray font-body leading-relaxed">{lead}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/**
 * How often, which day, which part of the day, and where.
 * The day and the part of the day are worded as preferences throughout: they
 * steer how staff plan deliveries, they are not slots anybody promises.
 *
 * The choices fill the wide column; what they add up to sits beside them
 * with the button that saves it, so the answer and the action stay in view
 * however far down the form you are.
 */
export default function PlanSettingsForm({
  initial, addresses, lang, saving, submitLabel, onSubmit, onBack, backLabel, aside, error,
}: {
  initial: PlanSettingsValue;
  addresses: PlanAddress[];
  lang: Lang;
  saving: boolean;
  submitLabel: string;
  onSubmit: (value: PlanSettingsPayload & PlanSettingsValue) => void;
  onBack?: () => void;
  /** The back button's words — "Volver" in the setup, "Cancelar" in settings. */
  backLabel?: string;
  /** Shown at the top of the summary (the setup puts the list there). */
  aside?: React.ReactNode;
  error?: string | null;
}) {
  const c = PLAN_COPY[lang];
  const [v, setV] = useState<PlanSettingsValue>(initial);
  const set = <K extends keyof PlanSettingsValue>(k: K, val: PlanSettingsValue[K]) => setV((s) => ({ ...s, [k]: val }));

  const chip = (selected: boolean) =>
    `h-11 rounded-xl text-[14px] font-semibold font-ui transition-colors border ${
      selected ? 'bg-brand text-white border-brand' : 'bg-card text-ink border-border hover:border-brand/50'
    }`;
  const card = (selected: boolean) =>
    `relative rounded-xl border-2 text-left transition-colors ${
      selected ? 'border-brand bg-brand-whisper' : 'border-border bg-card hover:border-brand/40'
    }`;

  const address = addresses.find((a) => a.id === v.address_id);
  const day = v.preferred_weekday ? WEEKDAYS.find((d) => d.id === v.preferred_weekday)?.long[lang] : null;
  const summary: Array<[string, React.ReactNode]> = [
    [c.freqTitle, FREQ_LABELS[v.frequency][lang]],
    [c.dayTitle, day ? <span className="capitalize">{day}</span> : c.noDay],
    [c.windowTitle, v.preferred_window ? `${WINDOW_TITLES[v.preferred_window][lang]}, ${WINDOWS[v.preferred_window].hours}` : c.noWindow],
    [c.addressTitle, address ? `${address.street_line_1}, ${address.postcode} ${address.city}` : c.noAddressSet],
  ];

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}
      className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 items-start"
    >
      <div className="lg:col-span-2 min-w-0 rounded-lg bg-card border border-border/60 p-5 sm:p-7">
        <Section title={c.freqTitle} lead={c.freqLead}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {PLAN_FREQUENCIES.map((f) => {
              const selected = v.frequency === f;
              return (
                <button key={f} type="button" onClick={() => set('frequency', f)} aria-pressed={selected} className={`${card(selected)} p-3.5 pr-8`}>
                  {selected && (
                    <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-brand text-white flex items-center justify-center">
                      <Check size={12} strokeWidth={3} />
                    </span>
                  )}
                  <span className="block text-[15px] font-bold text-ink font-ui">{FREQ_LABELS[f][lang]}</span>
                  <span className="block mt-0.5 text-[12.5px] text-gray font-ui tabular-nums">
                    {FREQ_LABELS[f].weeks * 7} {lang === 'en' ? 'days' : 'días'}
                  </span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title={c.dayTitle} lead={c.dayLead}>
          <div className="grid grid-cols-4 sm:grid-cols-[repeat(7,minmax(0,1fr))_auto] gap-2">
            {WEEKDAYS.map((d) => (
              <button key={d.id} type="button" onClick={() => set('preferred_weekday', d.id)}
                aria-pressed={v.preferred_weekday === d.id} aria-label={d.long[lang]} className={chip(v.preferred_weekday === d.id)}>
                {d.short[lang]}
              </button>
            ))}
            <button type="button" onClick={() => set('preferred_weekday', null)}
              aria-pressed={v.preferred_weekday === null} className={`${chip(v.preferred_weekday === null)} col-span-4 sm:col-span-1 px-3.5 text-[13px]`}>
              {c.noDay}
            </button>
          </div>
        </Section>

        <Section title={c.windowTitle} lead={c.windowLead}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {DELIVERY_WINDOWS.map((w) => {
              const selected = v.preferred_window === w;
              return (
                <button key={w} type="button" onClick={() => set('preferred_window', w)} aria-pressed={selected} className={`${card(selected)} px-4 py-3`}>
                  <span className="block text-[14px] font-bold text-ink font-ui">{WINDOW_TITLES[w][lang]}</span>
                  <span className="block text-[12.5px] text-gray font-ui tabular-nums">{WINDOWS[w].hours}</span>
                </button>
              );
            })}
            <button type="button" onClick={() => set('preferred_window', null)} aria-pressed={v.preferred_window === null}
              className={`${card(v.preferred_window === null)} px-4 py-3`}>
              <span className="block text-[14px] font-bold text-ink font-ui">{c.noWindow}</span>
            </button>
          </div>
        </Section>

        <Section title={c.addressTitle}>
          {addresses.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-surface-cream p-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[14px] text-gray font-body">{c.noAddress}</p>
              <Link to="/addresses" className="min-h-[44px] px-4 rounded-xl bg-brand text-white text-[14px] font-bold font-display inline-flex items-center hover:bg-brand-mid">
                {c.addAddress}
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {addresses.map((a) => {
                  const selected = v.address_id === a.id;
                  return (
                    <label key={a.id} className={`${card(selected)} flex items-start gap-3 p-3.5 cursor-pointer`}>
                      <input type="radio" name="plan-address" className="mt-1 accent-brand" checked={selected}
                        onChange={() => set('address_id', a.id)} />
                      <span className="min-w-0">
                        <span className="block text-[14px] font-semibold text-ink font-ui">{a.contact_name}</span>
                        <span className="block text-[13px] text-gray font-body">
                          {a.street_line_1}{a.street_line_2 ? `, ${a.street_line_2}` : ''}, {a.postcode} {a.city}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              <Link to="/addresses" className="inline-block mt-3 text-[13.5px] font-bold text-brand hover:text-brand-mid font-ui">
                {c.manageAddresses}
              </Link>
            </>
          )}
        </Section>
      </div>

      {/* ── What it adds up to, and the button that saves it ── */}
      <aside className="lg:sticky lg:top-[172px] min-w-0 rounded-lg bg-surface-cream shadow-card border border-border/40 p-5 sm:p-6">
        {aside}
        <h3 className="text-[17px] font-bold text-ink font-display">{c.summaryTitle}</h3>
        <dl className="mt-2 divide-y divide-border/50">
          {summary.map(([k, val]) => (
            <div key={k} className="py-2.5">
              <dt className="text-[12.5px] text-gray font-ui">{k}</dt>
              <dd className="text-[14px] font-semibold text-ink font-ui">{val}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex items-start gap-2.5 rounded-lg bg-brand-mist/50 px-3.5 py-3">
          <Info size={16} strokeWidth={1.75} className="text-brand shrink-0 mt-0.5" />
          <p className="text-[12.5px] text-charcoal font-body leading-relaxed">{c.settingsInfo}</p>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-danger-bg border border-danger/25 px-4 py-3 text-[13px] text-danger font-body">{error}</p>
        )}

        <div className="mt-5 grid gap-2.5">
          <button type="submit" disabled={saving || !v.address_id}
            className="min-h-[52px] rounded-xl bg-brand text-white text-[15px] font-bold font-display hover:bg-brand-mid transition-colors disabled:opacity-50">
            {saving ? c.saving : submitLabel}
          </button>
          {onBack && (
            <button type="button" onClick={onBack}
              className="min-h-[48px] rounded-xl border border-border bg-card text-ink text-[14px] font-bold font-display hover:border-brand/40 transition-colors">
              {backLabel ?? c.setupBack}
            </button>
          )}
        </div>
      </aside>
    </form>
  );
}
