// ─── Is this order frozen by an issued invoice? ─────────────────
//
// TWO QUESTIONS, ONE PROJECTION. The order endpoints return the issued
// document on an order (credit notes aside), and the screens ask it two
// different things:
//
//   issuedInvoiceOf()  — is there a document at all? Decides whether the
//                        admin button offers to create one or links to what
//                        exists. A partial unique index allows exactly one
//                        issued non-credit-note per order, so offering a
//                        second is always an error, albaran or not.
//
//   lockingInvoiceOf() — is the order frozen? ONLY A FACTURA FREEZES IT.
//                        A albaran is a quote, and a quote is the thing you
//                        revise when the order changes.
//
// A DRAFT invoice appears in neither: it re-reads its order on load, so it
// follows an edit rather than contradicting it.
//
// The server is the real guard — editOrder() and the two delivery-fee routes
// refuse a locked order with a 409. This exists so the screens stop OFFERING
// edits that would come back as one.

/** An issued document against an order, as the order endpoints project it. */
export interface IssuedInvoiceRef {
  id: string;
  /** A CHECK constraint guarantees an issued invoice has one, but the column
   *  is nullable for drafts, so the type has to allow it. */
  invoice_number: string | null;
  issue_date: string;
  /** Which kind of document. Only `invoice` — a real factura — locks the
   *  order. Absent on an API deployed before this field existed, which is
   *  why the lock check treats undefined as "does not lock". */
  kind?: 'albaran' | 'invoice' | 'credit_note';
  /**
   * Whether it has actually been issued.
   *
   * Absent on the projections that pre-filter to issued rows, which is most
   * of them — hence optional, and hence "absent means issued" below. Present
   * on the rep's order payload, which sends drafts as well so the screen can
   * tell "the office is working on it" from "here is the document".
   */
  status?: 'draft' | 'issued';
}

/**
 * The issued invoice on an order, or null if it is still editable.
 *
 * DELIBERATELY PERMISSIVE WHEN THE FIELD IS ABSENT. Frontends and the API
 * deploy independently, so during the in-flight window a new frontend can be
 * talking to an API that does not send `invoices` yet. Treating "missing" as
 * "not locked" degrades to the previous behaviour — the button is offered and
 * the server refuses it — which is the right way round. Treating it as
 * "locked" would hide editing from every order on every screen until the API
 * caught up.
 */
export function issuedInvoiceOf(
  order: { invoices?: IssuedInvoiceRef[] | null } | null | undefined,
): IssuedInvoiceRef | null {
  const rows = order?.invoices;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  /**
   * A DRAFT IS NOT AN ISSUED DOCUMENT, and this used to take rows[0] on faith.
   *
   * Every admin projection pre-filters to `status: 'issued'`, so the faith was
   * repaid — but the rep's order payload sends drafts too, newest first. An
   * admin drafting a factura on a rep's order therefore put `kind: 'invoice'`
   * at the head of the list, lockingInvoiceOf said the order was frozen, and
   * the rep lost the ability to edit an order that nothing had been issued for.
   *
   * `status` absent still counts as issued, for the same deploy-skew reason
   * the rest of this file is permissive: an API that predates the field only
   * ever sent issued rows.
   */
  return rows.find((r) => r.status !== 'draft') ?? null;
}

/**
 * The issued FACTURA freezing this order, or null if it is still editable.
 *
 * ONLY A FACTURA LOCKS. A albaran is not a fiscal document — it is a quote,
 * and revising a quote is what a quote is for. An order carrying an albarán
 * stays fully editable; the albaran is superseded and reissued instead.
 *
 * Undefined `kind` does not lock, for the same deploy-skew reason
 * issuedInvoiceOf is permissive: an API that predates the field would
 * otherwise freeze every order carrying any document.
 */
export function lockingInvoiceOf(
  order: { invoices?: IssuedInvoiceRef[] | null } | null | undefined,
): IssuedInvoiceRef | null {
  const inv = issuedInvoiceOf(order);
  return inv && inv.kind === 'invoice' ? inv : null;
}

/** Convenience for the common `canEdit && !locked` gate. */
export function isInvoiceLocked(
  order: { invoices?: IssuedInvoiceRef[] | null } | null | undefined,
): boolean {
  return lockingInvoiceOf(order) !== null;
}
