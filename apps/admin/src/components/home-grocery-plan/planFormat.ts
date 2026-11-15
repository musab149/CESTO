import type { DeliveryWindow } from '@grocery-app/shared';

/**
 * Dates, days and windows for the Home Grocery plan screens.
 *
 * A plan's dates are calendar days in Madrid ('YYYY-MM-DD', or an ISO
 * timestamp at UTC midnight from a DATE column). They are formatted at UTC so
 * a day never slides into the one before on a browser west of Greenwich.
 */

const localeOf = (lang: string) => (lang.startsWith('es') ? 'es-ES' : 'en-GB');
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const dayOf = (iso: string | null | undefined): string | null => (iso ? iso.slice(0, 10) : null);

export function planDate(
  iso: string | null | undefined,
  lang: string,
  opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' },
): string {
  const day = dayOf(iso);
  if (!day) return '—';
  return capital(new Date(`${day}T00:00:00Z`).toLocaleDateString(localeOf(lang), { ...opts, timeZone: 'UTC' }));
}

/** ISO weekday, 1 = Monday. 1 January 2024 was a Monday. */
export function weekdayName(n: number, lang: string, style: 'long' | 'short' = 'long'): string {
  return capital(new Date(Date.UTC(2024, 0, n)).toLocaleDateString(localeOf(lang), { weekday: style, timeZone: 'UTC' }));
}

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

/** The hours each window stands for — the same as the household sees. */
export const WINDOW_HOURS: Record<DeliveryWindow, string> = {
  morning: '9:00–12:00',
  afternoon: '12:00–17:00',
  evening: '17:00–21:00',
};

/** Today in Madrid, as the API counts days. */
export const madridToday = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());

export const money = (v: string | number | null | undefined): string =>
  `${Number(v ?? 0).toFixed(2).replace('.', ',')} €`;

/** How far ahead an order's day may be — the API's SLOT_MAX_DAYS. */
export const SLOT_MAX_DAYS = 30;

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday of a 'YYYY-MM-DD' day: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay() || 7;

/**
 * The day to offer for a new Home Grocery order: their preferred weekday from
 * `from` (staff may book today), or `from` itself with no preference — the
 * API's defaultSlot for staff.
 */
export function suggestedDay(weekday: number | null, from: string): string {
  if (!weekday) return from;
  return addDays(from, (weekday - isoWeekday(from) + 7) % 7);
}
