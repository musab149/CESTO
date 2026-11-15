/**
 * Unsaved changes to a form, kept in this browser so a reload does not throw
 * them away — first for the admin's factura / albarán editor (2026-11-04:
 * "does this page survive the refresh when the user has not clicked the save
 * line changes" → "do it").
 *
 * The sibling of savedBasket.ts, which keeps ORDER LINES and recognises
 * nothing else: its sweep clears anything under its prefix that is not a
 * basket. A form lives under its own prefix (`cesto-<panel>-form:v1:`) so the
 * two never clear each other.
 *
 * The same rules as a basket:
 *   · one per panel, person and thing being edited;
 *   · a working day and no longer;
 *   · put back ONLY while the thing is still the one the changes were made
 *     against (`baseline`, a fingerprint — savedBasket.baselineOf); otherwise
 *     they describe something that no longer exists, and are dropped;
 *   · every read and write guarded — private windows, full or blocked
 *     storage, an older shape, no storage at all all read as "nothing saved".
 */
import type { BasketPanel } from './savedBasket';

const prefixOf = (panel: BasketPanel) => `cesto-${panel}-form:v1:`;
/** A working day, and a little — as a basket. */
export const SAVED_FORM_TTL_MS = 24 * 60 * 60 * 1000;

export interface SavedForm<F> {
  savedAt: number;
  /** The thing as the changes were made against it, fingerprinted. */
  baseline: string;
  form: F;
}

/** Whose unsaved changes to what: the panel, the signed-in person, the thing (e.g. `invoice:<id>`). */
export function formKey(panel: BasketPanel, ownerId: string, what: string): string {
  return `${prefixOf(panel)}${ownerId}:${what}`;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * The form saved under `key`, or null — missing, expired, or not a shape
 * `accept` recognises (which is then cleared, so it is not read again).
 */
export function readSavedForm<F>(
  key: string,
  accept: (form: unknown) => form is F,
  now: number = Date.now(),
): SavedForm<F> | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null = null;
  try { raw = store.getItem(key); } catch { return null; }
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<SavedForm<unknown>>;
    const fresh = typeof s.savedAt === 'number' && now - s.savedAt <= SAVED_FORM_TTL_MS && s.savedAt <= now + 60_000;
    if (!fresh || typeof s.baseline !== 'string' || !accept(s.form)) {
      clearSavedForm(key);
      return null;
    }
    return { savedAt: s.savedAt!, baseline: s.baseline, form: s.form as F };
  } catch {
    clearSavedForm(key);
    return null;
  }
}

export function writeSavedForm<F>(key: string, form: F, baseline: string, now: number = Date.now()): void {
  try {
    storage()?.setItem(key, JSON.stringify({ savedAt: now, baseline, form }));
  } catch {
    // Full or blocked: the form still works, it just will not survive a reload.
  }
}

export function clearSavedForm(key: string): void {
  try { storage()?.removeItem(key); } catch { /* nothing to clear */ }
}

/** Drops this panel's saved forms past their day (or unreadable), so storage does not collect them. */
export function sweepSavedForms(panel: BasketPanel, now: number = Date.now()): void {
  const store = storage();
  if (!store) return;
  try {
    const prefix = prefixOf(panel);
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) {
      let keep = false;
      try {
        const s = JSON.parse(store.getItem(k) ?? '') as Partial<SavedForm<unknown>>;
        keep = typeof s.savedAt === 'number' && now - s.savedAt <= SAVED_FORM_TTL_MS;
      } catch { keep = false; }
      if (!keep) clearSavedForm(k);
    }
  } catch { /* storage unavailable */ }
}
