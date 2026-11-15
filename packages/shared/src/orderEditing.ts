// ─── May staff or a rep still change this order? ────────────────
//
// The admin and rep screens ask this before offering "Edit order" and the
// delivery fee's Edit. The server decides for real (packages/api
// lib/editOrder.ts `isEditableDraft` + EDITABLE_STATUSES, the same rule); this
// only stops the screens offering an edit that would come back refused.
//
// An ISSUED FACTURA freezes an order whatever this says. That is a separate
// question with its own helper (invoiceLock.ts), checked beside this one.
//
// Which orders a rep may open at all — the ones they built — is the server's
// to decide; a rep screen only ever holds those.

/** In the shop's hands: nobody has taken it out yet. */
export const EDITABLE_ORDER_STATUSES = ['pending', 'confirmed', 'preparing'] as const;

export interface StaffEditSubject {
  status: string;
  created_by_admin_id?: string | null;
  created_by_sales_rep_id?: string | null;
  rashan_subscription_id?: string | null;
}

/**
 * A draft our team built — staff, a rep, or a Home Grocery order (2026-11-04).
 *
 * A draft holds no stock — confirming its stock is what takes it — so
 * changing one moves nothing and tells the customer nothing; they have not
 * been told about it yet.
 *
 * NOT a draft from a customer's own checkout (no creator, not Home Grocery):
 * that is a part of their purchase, split by shop, and its rules have not
 * been decided.
 */
export function isEditableDraft(order: StaffEditSubject): boolean {
  return order.status === 'draft'
    && !!(order.created_by_admin_id || order.created_by_sales_rep_id || order.rashan_subscription_id);
}

/** Whether staff — or the rep who built it — may change this order's lines and delivery fee (the invoice lock aside). */
export function staffCanEditOrder(order: StaffEditSubject): boolean {
  return (EDITABLE_ORDER_STATUSES as readonly string[]).includes(order.status)
    || isEditableDraft(order);
}

/**
 * A draft the customer made themselves (2026-11-04) — what their checkout
 * parked when stock was short. Nobody on our team built it. The API states
 * the same rule (lib/editOrder.ts `isCustomersOwnDraft`).
 */
export function isCustomersOwnDraft(order: StaffEditSubject): boolean {
  return order.status === 'draft' && !order.created_by_admin_id && !order.created_by_sales_rep_id;
}

/** Whether the customer may change their own order's lines (the invoice lock aside). */
export function customerCanEditOrder(order: StaffEditSubject): boolean {
  return (EDITABLE_ORDER_STATUSES as readonly string[]).includes(order.status)
    || isCustomersOwnDraft(order);
}

/**
 * What a draft cancelled by being emptied says (the API writes it as the
 * order's cancelled_reason). Exported so a screen can recognise it.
 */
export const EMPTIED_DRAFT_REASON = 'Se quitaron todos los artículos del borrador';
