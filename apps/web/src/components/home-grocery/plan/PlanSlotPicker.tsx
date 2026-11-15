import { useState } from 'react';
import { DELIVERY_WINDOWS } from '@grocery-app/shared';
import { PLAN_COPY, WINDOWS, WINDOW_TITLES, type Lang } from '../planCopy';
import { SLOT_MAX_DAYS, addDays, isoWeekday, madridToday, type SlotValue } from './planSlot';

const FIRST_SHOWN = 14;

/**
 * A Home Grocery order's slot: the day — a row of the next two weeks, with
 * the rest of the month a press away — and the part of the day. The plan's
 * preferred weekday is marked on the days, so the usual one is easy to find.
 */
export default function PlanSlotPicker({
  value, onChange, lang, preferredWeekday, firstDay,
}: {
  value: SlotValue;
  onChange: (v: SlotValue) => void;
  lang: Lang;
  preferredWeekday: number | null;
  /** The first day on offer: tomorrow for a household, today for staff. */
  firstDay?: string;
}) {
  const c = PLAN_COPY[lang];
  const start = firstDay ?? addDays(madridToday(), 1);
  const chosenIndex = Math.round((new Date(`${value.scheduled_for}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / 86_400_000);
  const [all, setAll] = useState(chosenIndex >= FIRST_SHOWN);
  const count = all ? SLOT_MAX_DAYS : FIRST_SHOWN;
  const days = Array.from({ length: count }, (_, i) => addDays(start, i));
  const loc = lang === 'es' ? 'es-ES' : 'en-GB';
  const fmt = (iso: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(loc, { ...o, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)).replace('.', '');

  const card = (on: boolean) =>
    `relative rounded-xl border-2 text-left transition-colors ${on ? 'border-brand bg-brand-whisper' : 'border-border bg-card hover:border-brand/40'}`;

  return (
    <div className="space-y-6">
      <div>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2" role="radiogroup" aria-label={c.slotDayTitle}>
          {days.map((d) => {
            const on = d === value.scheduled_for;
            const usual = preferredWeekday != null && isoWeekday(d) === preferredWeekday;
            return (
              <button key={d} type="button" role="radio" aria-checked={on}
                onClick={() => onChange({ ...value, scheduled_for: d })}
                aria-label={fmt(d, { weekday: 'long', day: 'numeric', month: 'long' })}
                className={`${card(on)} px-2 py-2.5 text-center`}>
                <span className={`block text-[12px] font-semibold font-ui capitalize ${on ? 'text-brand' : 'text-gray'}`}>{fmt(d, { weekday: 'short' })}</span>
                <span className="block text-[20px] leading-tight font-extrabold font-display text-ink tabular-nums">{fmt(d, { day: 'numeric' })}</span>
                <span className="block text-[12px] font-semibold font-ui text-gray capitalize">{fmt(d, { month: 'short' })}</span>
                {usual && <span aria-hidden className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-brand" />}
              </button>
            );
          })}
        </div>
        {!all && (
          <button type="button" onClick={() => setAll(true)}
            className="mt-3 text-[13.5px] font-bold text-brand font-ui hover:text-brand-mid">
            {c.moreDays}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5" role="radiogroup" aria-label={c.windowTitle}>
        {DELIVERY_WINDOWS.map((w) => {
          const on = value.delivery_window === w;
          return (
            <button key={w} type="button" role="radio" aria-checked={on}
              onClick={() => onChange({ ...value, delivery_window: w })} className={`${card(on)} px-4 py-3`}>
              <span className="block text-[14px] font-bold text-ink font-ui">{WINDOW_TITLES[w][lang]}</span>
              <span className="block text-[12.5px] text-gray font-ui tabular-nums">{WINDOWS[w].hours}</span>
            </button>
          );
        })}
        <button type="button" role="radio" aria-checked={value.delivery_window === null}
          onClick={() => onChange({ ...value, delivery_window: null })} className={`${card(value.delivery_window === null)} px-4 py-3`}>
          <span className="block text-[14px] font-bold text-ink font-ui">{c.noWindow}</span>
        </button>
      </div>
    </div>
  );
}
