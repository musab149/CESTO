import type { DeliveryWindow } from '@grocery-app/shared';

/** How far ahead a household may pick — the API's SLOT_MAX_DAYS. */
export const SLOT_MAX_DAYS = 30;

export type SlotValue = { scheduled_for: string; delivery_window: DeliveryWindow | null };

/** Today in Spain, as YYYY-MM-DD — the calendar the API counts in. */
export function madridToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * The day to suggest for a new order: their preferred weekday from tomorrow
 * (tomorrow with no preference) — the API's defaultSlot for a household.
 */
export function suggestedDay(weekday: number | null): string {
  const tomorrow = addDays(madridToday(), 1);
  if (!weekday) return tomorrow;
  return addDays(tomorrow, (weekday - isoWeekday(tomorrow) + 7) % 7);
}
