/**
 * The order somebody is building, kept in this browser so a reload does not
 * empty it — the rep panel's new-order screen (2026-11-04, "when we are
 * creating order and refresh the page then those added items vanish") and
 * the admin panel's (same day, "fix the admin one too").
 *
 * WHAT IT IS FOR: surviving a refresh, a closed tab, a phone that reloaded the
 * page in the background. Parking a basket for later is what "Save draft" is
 * for — that one is on the server, where the office can see it — so this
 * keeps a basket for a working day and no longer. Prices on a line are what
 * the screen showed when it was added; the server prices the order afresh
 * when it is created, so a day is also as long as those are worth showing.
 *
 * ONE PER PANEL, PERSON AND CLIENT. Two reps sharing a tablet do not see each
 * other's baskets, a rep switching between two clients keeps both, and an
 * admin who is also signed in to the rep panel in the same browser keeps the
 * two apart.
 *
 * Every read and write is guarded: private windows, full or blocked storage,
 * a shape from an older build, and a platform with no localStorage at all
 * (the app) all read as "nothing saved". Nothing here knows what a line
 * holds beyond its key, size and quantity — each screen keeps its own.
 */

/**
 * Which screen family it belongs to: the rep panel, the admin panel, the
 * shop (a customer's own order editors) and the business panel.
 */
export type BasketPanel = 'sales' | 'admin' | 'shop' | 'business';

const prefixOf = (panel: BasketPanel) => `cesto-${panel}-basket:v1:`;
/** A working day, and a little. */
export const SAVED_BASKET_TTL_MS = 24 * 60 * 60 * 1000;

export interface SavedBasket<L> {
  savedAt: number;
  lines: L[];
  addressId: string;
  feeInput: string | null;
  /** The client's note, where the screen has one (the rep's does; admin's does not). */
  notes: string;
  /** The Home Grocery slot chosen, if the suggested one was changed. */
  hgSlot: { scheduled_for: string; delivery_window: string | null } | null;
  /**
   * The create attempt's idempotency key, once Create has been pressed.
   * Kept so pressing it again after a reload — when the first press got no
   * answer — hands back the order it may already have made, not a second one.
   */
  attemptKey: string | null;
  /**
   * EDITING ONLY: the order as the screen opened it, fingerprinted
   * (`baselineOf`). Unsaved changes are a diff against that; if the order has
   * changed since — somebody else edited it, the office confirmed it — they
   * describe an order that no longer exists, and are dropped rather than put
   * back. Null for a basket being built.
   */
  baseline: string | null;
}

/** Whose basket for whom: the panel, the signed-in person, the client. */
export function basketKey(panel: BasketPanel, ownerId: string, clientId: string): string {
  return `${prefixOf(panel)}${ownerId}:${clientId}`;
}

/** Unsaved changes to one existing order, by this person on this panel. */
export function editBasketKey(panel: BasketPanel, ownerId: string, orderId: string): string {
  return basketKey(panel, ownerId, `order:${orderId}`);
}

/**
 * A short, stable fingerprint of whatever a screen diffs its edits against —
 * the order's lines, fee and note as it opened. Equal in, equal out; any
 * difference, a different string. Not a security measure, only "is this the
 * same order I left?".
 */
export function baselineOf(value: unknown): string {
  const text = JSON.stringify(value) ?? '';
  let h1 = 0x811c9dc5;
  let h2 = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = (Math.imul(h2, 33) + c) >>> 0;
  }
  return `${text.length.toString(36)}-${h1.toString(36)}-${h2.toString(36)}`;
}

/**
 * The fingerprint of an order as an edit screen opened it: each line's row,
 * size, quantity, price and discount (and buying price, on admin's), plus
 * whatever else the screen diffs — its fee, its note. NAMES AND PHOTOS ARE
 * LEFT OUT on purpose: they follow the screen's language, and switching it
 * between visits is no change to the order.
 */
export function editBaselineOf<L extends { variantId: string; quantity: number }>(
  lines: ReadonlyArray<L>,
  extra: Record<string, unknown> = {},
): string {
  const pick = (l: Record<string, unknown>) => [
    l.orderItemId ?? '', l.variantId, l.quantity, l.unitPrice ?? null,
    l.discount ?? '', l.unitDiscount ?? '', l.flatDiscount ?? '', l.unitCost ?? '',
  ];
  return baselineOf({ lines: lines.map((l) => pick(l as unknown as Record<string, unknown>)), ...extra });
}

/**
 * The next free number for a screen's `new:n` row keys once a basket has been
 * put back: rows added after must not reuse a number a restored row has, or
 * two rows share a key and a tap meant for one changes the other.
 */
export function nextNewKey(lines: Array<{ key: string }>, current: number): number {
  let next = current;
  for (const l of lines) {
    const m = /^new:(\d+)$/.exec(l.key);
    if (m) next = Math.max(next, Number(m[1]) + 1);
  }
  return next;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** A line worth putting back: it names a size and asks for at least one. */
function plausibleLine(l: unknown): boolean {
  const x = l as { variantId?: unknown; quantity?: unknown; key?: unknown } | null;
  return !!x && typeof x.variantId === 'string' && typeof x.key === 'string'
    && typeof x.quantity === 'number' && Number.isInteger(x.quantity) && x.quantity > 0;
}

/** The basket saved under `key`, or null — missing, expired, or not one we recognise. */
export function readBasket<L>(key: string, now: number = Date.now()): SavedBasket<L> | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null = null;
  try { raw = store.getItem(key); } catch { return null; }
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as Partial<SavedBasket<L>>;
    const fresh = typeof b.savedAt === 'number' && now - b.savedAt <= SAVED_BASKET_TTL_MS && b.savedAt <= now + 60_000;
    if (!fresh || !Array.isArray(b.lines) || b.lines.length === 0 || !b.lines.every(plausibleLine)) {
      clearBasket(key);
      return null;
    }
    return {
      savedAt: b.savedAt!,
      lines: b.lines,
      addressId: typeof b.addressId === 'string' ? b.addressId : '',
      feeInput: typeof b.feeInput === 'string' ? b.feeInput : null,
      notes: typeof b.notes === 'string' ? b.notes : '',
      hgSlot: b.hgSlot && typeof b.hgSlot.scheduled_for === 'string' ? b.hgSlot : null,
      attemptKey: typeof b.attemptKey === 'string' ? b.attemptKey : null,
      baseline: typeof b.baseline === 'string' ? b.baseline : null,
    };
  } catch {
    clearBasket(key);
    return null;
  }
}

export function writeBasket<L>(key: string, basket: Omit<SavedBasket<L>, 'savedAt'>, now: number = Date.now()): void {
  try {
    storage()?.setItem(key, JSON.stringify({ ...basket, savedAt: now }));
  } catch {
    // Full or blocked: the basket still works, it just will not survive a reload.
  }
}

export function clearBasket(key: string): void {
  try { storage()?.removeItem(key); } catch { /* nothing to clear */ }
}

/** Drops every saved basket of this panel past its day, so storage does not collect them. */
export function sweepBaskets(panel: BasketPanel, now: number = Date.now()): void {
  const store = storage();
  if (!store) return;
  try {
    const prefix = prefixOf(panel);
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) readBasket(k, now);
  } catch { /* storage unavailable */ }
}

/**
 * Put a saved basket's lines back alongside any already on the screen — a
 * size added from a link may land before the basket is read. The same size
 * twice means "one more", as adding it does.
 */
export function mergeSavedLines<L extends { variantId: string; quantity: number }>(saved: L[], current: L[]): L[] {
  if (current.length === 0) return saved;
  const extra = new Map(current.map((l) => [l.variantId, l]));
  const merged = saved.map((l) => {
    const more = extra.get(l.variantId);
    if (!more) return l;
    extra.delete(l.variantId);
    return { ...l, quantity: l.quantity + more.quantity };
  });
  return [...merged, ...extra.values()];
}
