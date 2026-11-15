/*
 * Dates as the earnings screens print them (API lib/repEarnings). Apart from
 * lib/earnings.tsx, which holds the components, so fast refresh keeps working
 * on both.
 */

/** A calendar date ('2026-09-30') as "30 sept 2026". */
export function dayLabel(iso: string, lang: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A moment (an order delivered) as its day in Madrid, where the rep works. */
export function momentDay(iso: string, lang: string): string {
  return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' });
}
