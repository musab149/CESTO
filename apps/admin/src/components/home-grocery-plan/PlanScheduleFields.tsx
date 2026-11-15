import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CalendarDays, Clock, MapPin, Repeat } from 'lucide-react';
import {
  PLAN_FREQUENCIES, DELIVERY_WINDOWS,
  type DeliveryWindow, type HomeGroceryPlan, type PlanAddress,
} from '@grocery-app/shared';
import { WEEKDAYS, WINDOW_HOURS, weekdayName } from './planFormat';

export interface ScheduleValue {
  frequency: HomeGroceryPlan['frequency'];
  preferred_weekday: number | null;
  preferred_window: DeliveryWindow | null;
  address_id: string | null;
}

/**
 * How often, which day, which part of it, and where.
 * The day and the window are a preference — the copy says so, because staff
 * reading it back to a household on the phone should not promise a slot.
 */
export default function PlanScheduleFields({
  value, onChange, addresses, userId,
}: {
  value: ScheduleValue;
  onChange: (v: ScheduleValue) => void;
  addresses: PlanAddress[];
  userId: string;
}) {
  const { t, i18n } = useTranslation();
  const set = <K extends keyof ScheduleValue>(k: K, v: ScheduleValue[K]) => onChange({ ...value, [k]: v });
  // A legacy plan can hold a cadence no longer offered; it stays selectable as itself.
  const frequencies = PLAN_FREQUENCIES.includes(value.frequency as (typeof PLAN_FREQUENCIES)[number])
    ? PLAN_FREQUENCIES
    : [...PLAN_FREQUENCIES, value.frequency];

  const chip = (on: boolean) => `h-9 px-3 rounded-lg text-[13px] font-semibold font-display border transition-colors ${
    on ? 'bg-brand text-white border-brand' : 'bg-card text-ink border-border hover:border-brand/50'
  }`;

  return (
    <div className="space-y-5">
      <Group icon={Repeat} label={t('hgPlan.schedule.frequency', 'How often')}>
        <div className="flex flex-wrap gap-2">
          {frequencies.map((f) => (
            <button key={f} type="button" onClick={() => set('frequency', f)} className={chip(value.frequency === f)}>
              {t(`homeGrocery.frequency.${f}`, f)}
            </button>
          ))}
        </div>
      </Group>

      <Group
        icon={CalendarDays}
        label={t('hgPlan.schedule.day', 'Preferred day')}
        hint={t('hgPlan.schedule.dayHint', 'Suggested as the day of each order; any order can have another.')}
      >
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <button key={d} type="button" onClick={() => set('preferred_weekday', d)} className={chip(value.preferred_weekday === d)}>
              {weekdayName(d, i18n.language, 'short')}
            </button>
          ))}
          <button type="button" onClick={() => set('preferred_weekday', null)} className={chip(value.preferred_weekday === null)}>
            {t('hgPlan.schedule.anyDay', 'Any day')}
          </button>
        </div>
      </Group>

      <Group icon={Clock} label={t('hgPlan.schedule.window', 'Time of day')}>
        <div className="flex flex-wrap gap-2">
          {DELIVERY_WINDOWS.map((w) => (
            <button key={w} type="button" onClick={() => set('preferred_window', w)} className={chip(value.preferred_window === w)}>
              {t(`hgPlan.window.${w}`, w)}
              <span className={`ml-1.5 text-[11px] font-normal ${value.preferred_window === w ? 'text-white/80' : 'text-muted'}`}>
                {WINDOW_HOURS[w]}
              </span>
            </button>
          ))}
          <button type="button" onClick={() => set('preferred_window', null)} className={chip(value.preferred_window === null)}>
            {t('hgPlan.schedule.anyTime', 'Any time')}
          </button>
        </div>
      </Group>

      <Group icon={MapPin} label={t('hgPlan.schedule.address', 'Delivery address')}>
        {addresses.length === 0 ? (
          <p className="text-sm font-display text-danger">
            {t('hgPlan.schedule.noAddress', 'This customer has no address. Add one on their customer page first.')}{' '}
            <Link to={`/customers/${userId}`} className="font-semibold underline">{t('hgPlan.schedule.openCustomer', 'Open customer')}</Link>
          </p>
        ) : (
          <div className="space-y-2">
            {addresses.map((a) => (
              <label
                key={a.id}
                className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                  value.address_id === a.id ? 'border-brand bg-brand-whisper' : 'border-border bg-card hover:border-brand/50'
                }`}
              >
                <input
                  type="radio"
                  name="plan-address"
                  checked={value.address_id === a.id}
                  onChange={() => set('address_id', a.id)}
                  className="mt-1 accent-brand"
                />
                <span className="min-w-0 text-sm font-body text-ink leading-snug">
                  <span className="font-semibold font-display">{a.contact_name}</span>
                  <span className="text-muted font-mono text-[12px]"> · {a.contact_phone}</span>
                  <br />
                  {a.street_line_1}{a.street_line_2 ? `, ${a.street_line_2}` : ''}, <span className="font-mono text-[12.5px]">{a.postcode}</span> {a.city}
                </span>
              </label>
            ))}
          </div>
        )}
      </Group>

    </div>
  );
}

function Group({ icon: Icon, label, hint, children }: {
  icon: typeof Repeat; label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[12px] font-semibold font-display text-gray uppercase tracking-wide mb-2">
        <Icon size={14} strokeWidth={1.75} className="text-brand" />
        {label}
      </p>
      {hint && <p className="text-[12px] font-display text-muted -mt-1 mb-2">{hint}</p>}
      {children}
    </div>
  );
}
