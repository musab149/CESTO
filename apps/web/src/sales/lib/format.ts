/**
 * Money and dates for the rep surface, in one place.
 *
 * The partner pages each declare their own `formatCurrency`, and they do not all
 * agree — one returns "12,50 €", another "12,50" with the symbol in the markup.
 * Four screens that show prices side by side should not be able to disagree
 * about how a price looks, so the rep surface has one.
 *
 * Spanish convention throughout: comma decimal, symbol after the number. That
 * is what a shopkeeper in Madrid reads, and it does not change with the app's
 * language — a price is a price.
 */
/**
 * Money, the way the ORDER SCREENS print it: `12,50 €`.
 *
 * Admin's own `formatCurrency`, copied so the ported screens keep calling it by
 * that name. It takes a plain number and is not null-safe; `money` below is the
 * forgiving one the rest of this surface uses. Admin keeps the two apart for
 * the same reason — folding different behaviours into one name changes what
 * unrelated screens render.
 */
export function formatCurrency(n: number): string {
  return n.toFixed(2).replace('.', ',') + ' €';
}

export function money(value: number | string): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

export function shortDate(iso: string, lang: 'es' | 'en'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  // Madrid's day, where the rep works — the same clock as shortTime.
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', {
    day: '2-digit', month: 'short', timeZone: 'Europe/Madrid',
  });
}

/** `14:05`, Madrid time — when in the day an order was built. */
export function shortTime(iso: string, lang: 'es' | 'en'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(lang === 'en' ? 'en-GB' : 'es-ES', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
  });
}

/** Pull a readable message out of whatever the API client threw. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback;
}
