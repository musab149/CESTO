import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DELIVERY_WINDOWS, type DeliveryWindow } from '@grocery-app/shared';
import { SLOT_MAX_DAYS, WINDOW_HOURS, addDays, isoWeekday, madridToday, planDate } from './planFormat';

export type SlotValue = { scheduled_for: string; delivery_window: DeliveryWindow | null };

const FIRST_SHOWN = 14;

/**
 * A Home Grocery order's slot, as staff set it: a day from today (staff may
 * book the same day; the household cannot) up to a month ahead, and the part
 * of the day. The household's preferred weekday is marked on the days.
 */
export default function PlanSlotFields({ value, onChange, preferredWeekday, compact = false }: {
  value: SlotValue;
  onChange: (v: SlotValue) => void;
  preferredWeekday: number | null;
  /** Inside a modal: a narrower grid. */
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const today = madridToday();
  const chosenIndex = Math.round((Date.parse(`${value.scheduled_for}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const [all, setAll] = useState(chosenIndex >= FIRST_SHOWN);
  const days = Array.from({ length: all ? SLOT_MAX_DAYS + 1 : FIRST_SHOWN }, (_, i) => addDays(today, i));
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) => planDate(d, i18n.language, o).replace('.', '');
  const chip = (on: boolean) =>
    `relative rounded-lg border text-center transition-colors ${on ? 'border-brand bg-brand-whisper text-brand' : 'border-border bg-card text-ink hover:border-brand/50'}`;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold font-display text-gray mb-1.5">{t('hgSlot.day', 'Day')}</p>
        <div className={`grid gap-1.5 ${compact ? 'grid-cols-7' : 'grid-cols-4 sm:grid-cols-7'}`} role="radiogroup" aria-label={t('hgSlot.day', 'Day')}>
          {days.map((d) => {
            const on = d === value.scheduled_for;
            return (
              <button key={d} type="button" role="radio" aria-checked={on}
                aria-label={fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}
                onClick={() => onChange({ ...value, scheduled_for: d })}
                className={`${chip(on)} py-1.5`}>
                <span className="block text-[11px] font-semibold font-display text-muted">
                  {d === today ? t('hgSlot.today', 'Today') : fmt(d, { weekday: 'short' })}
                </span>
                <span className="block text-[15px] font-bold font-display tabular-nums leading-tight">{fmt(d, { day: 'numeric' })}</span>
                <span className="block text-[11px] font-display text-muted">{fmt(d, { month: 'short' })}</span>
                {preferredWeekday != null && isoWeekday(d) === preferredWeekday && (
                  <span aria-hidden className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-brand" />
                )}
              </button>
            );
          })}
        </div>
        {!all && (
          <button type="button" onClick={() => setAll(true)} className="mt-1.5 text-[12.5px] font-semibold font-display text-brand hover:underline">
            {t('hgSlot.moreDays', 'More days')}
          </button>
        )}
      </div>

      <div>
        <p className="text-xs font-semibold font-display text-gray mb-1.5">{t('hgSlot.window', 'Time of day')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5" role="radiogroup" aria-label={t('hgSlot.window', 'Time of day')}>
          {DELIVERY_WINDOWS.map((w) => (
            <button key={w} type="button" role="radio" aria-checked={value.delivery_window === w}
              onClick={() => onChange({ ...value, delivery_window: w })}
              className={`${chip(value.delivery_window === w)} px-2 py-1.5`}>
              <span className="block text-[13px] font-semibold font-display">{t(`hgPlan.window.${w}`, w)}</span>
              <span className="block text-[11px] font-display text-muted tabular-nums">{WINDOW_HOURS[w]}</span>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={value.delivery_window === null}
            onClick={() => onChange({ ...value, delivery_window: null })}
            className={`${chip(value.delivery_window === null)} px-2 py-1.5`}>
            <span className="block text-[13px] font-semibold font-display">{t('hgPlan.schedule.anyTime', 'Any time')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
