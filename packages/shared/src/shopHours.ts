import type { ShopHours } from './types';

export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const WEEKDAY_KEYS: WeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const WEEKDAY_LABELS_ES: Record<WeekdayKey, string> = {
  mon: 'Lunes', tue: 'Martes', wed: 'Miércoles', thu: 'Jueves',
  fri: 'Viernes', sat: 'Sábado', sun: 'Domingo',
};
const WEEKDAY_LABELS_EN: Record<WeekdayKey, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

export function weekdayLabel(key: WeekdayKey, lang: 'es' | 'en' = 'es') {
  return (lang === 'en' ? WEEKDAY_LABELS_EN : WEEKDAY_LABELS_ES)[key];
}

/** Convert JS Date.getDay() (0=Sunday…6=Saturday) → our Monday-first key. */
export function jsDayToWeekdayKey(jsDay: number): WeekdayKey {
  // 0 Sun 1 Mon 2 Tue 3 Wed 4 Thu 5 Fri 6 Sat
  const map: Record<number, WeekdayKey> = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' };
  return map[jsDay] ?? 'mon';
}

function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
  if (h < 0 || h > 24 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function isOpenNow(hours: ShopHours | null | undefined, now: Date = new Date()): boolean {
  if (!hours) return false;
  const key = jsDayToWeekdayKey(now.getDay());
  const day = hours[key];
  if (!day || day.closed) return false;
  const open = parseHHMM(day.open);
  const close = parseHHMM(day.close);
  if (open === null || close === null) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  // Allow overnight closes (e.g. 22:00 → 02:00) by wrapping.
  if (close > open) return minutes >= open && minutes < close;
  return minutes >= open || minutes < close;
}

/**
 * Human-readable status: "Open now · closes 20:00" / "Closed · opens Mon 09:00".
 * Falls back to a generic "Closed" if the store has no hours configured.
 */
export function formatHoursStatus(hours: ShopHours | null | undefined, lang: 'es' | 'en' = 'es', now: Date = new Date()): string {
  if (!hours) return lang === 'en' ? 'Hours not set' : 'Horario no disponible';
  const todayKey = jsDayToWeekdayKey(now.getDay());
  const today = hours[todayKey];
  if (today && !today.closed) {
    const open = parseHHMM(today.open);
    const close = parseHHMM(today.close);
    if (open !== null && close !== null) {
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const openNow = close > open ? (nowMin >= open && nowMin < close) : (nowMin >= open || nowMin < close);
      if (openNow) {
        return lang === 'en'
          ? `Open now · closes at ${today.close}`
          : `Abierto · cierra a las ${today.close}`;
      }
      if (nowMin < open) {
        return lang === 'en'
          ? `Closed · opens at ${today.open}`
          : `Cerrado · abre a las ${today.open}`;
      }
    }
  }
  // Look ahead up to 7 days for the next open day.
  const currentIndex = WEEKDAY_KEYS.indexOf(todayKey);
  for (let i = 1; i <= 7; i++) {
    const nextKey = WEEKDAY_KEYS[(currentIndex + i) % 7];
    const next = hours[nextKey];
    if (next && !next.closed && next.open) {
      return lang === 'en'
        ? `Closed · opens ${weekdayLabel(nextKey, 'en')} ${next.open}`
        : `Cerrado · abre ${weekdayLabel(nextKey, 'es')} ${next.open}`;
    }
  }
  return lang === 'en' ? 'Closed' : 'Cerrado';
}

/** Empty template used by the admin form when a store has no hours yet. */
export function defaultShopHours(): ShopHours {
  const out: ShopHours = {};
  for (const k of WEEKDAY_KEYS) {
    out[k] = k === 'sun'
      ? { closed: true }
      : { closed: false, open: '09:00', close: '20:00' };
  }
  return out;
}
