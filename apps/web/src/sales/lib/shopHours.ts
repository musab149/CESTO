import type { ShopHours } from '@grocery-app/shared';

/*
 * A shop's hours today, for the Catálogo's shop cards (2026-10-28, from the
 * user's mockup: "Open from 9 am"). Read in Madrid, where the shops trade,
 * whatever the rep's device is set to.
 */

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export type TodayHours =
  | { state: 'before'; open: string; close: string }
  | { state: 'open'; open: string; close: string }
  | { state: 'after'; open: string; close: string }
  | { state: 'closed' };

/** Today's day and the time, in Madrid, as `mon` and "14:05". */
function madridNow(now: Date): { day: (typeof DAYS)[number]; time: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = get('weekday').slice(0, 3).toLowerCase() as (typeof DAYS)[number];
  return { day: DAYS.includes(day) ? day : DAYS[now.getDay()], time: `${get('hour')}:${get('minute')}` };
}

/** Null when the shop has not said its hours, or not for today. */
export function todayHours(hours: ShopHours | null | undefined, now = new Date()): TodayHours | null {
  if (!hours) return null;
  const { day, time } = madridNow(now);
  const d = hours[day];
  if (!d) return null;
  if (d.closed) return { state: 'closed' };
  if (!d.open || !d.close) return null;
  if (time < d.open) return { state: 'before', open: d.open, close: d.close };
  if (time < d.close) return { state: 'open', open: d.open, close: d.close };
  return { state: 'after', open: d.open, close: d.close };
}

/** "09:00" as Spain writes it: 9:00. */
export function clock(hhmm: string): string {
  return hhmm.replace(/^0(\d)/, '$1');
}
