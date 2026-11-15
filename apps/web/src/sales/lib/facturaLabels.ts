import { FACTURA_LABELS_ES, type FacturaLabels } from '@grocery-app/shared/invoice';

/**
 * The words printed on an albarán, a rep's only numbered document: Spanish,
 * whatever language the rep has the app in. The one set in
 * packages/shared (FACTURA_LABELS_ES), shared with admin, so the rep's copy
 * of a document is word for word the office's — including BORRADOR in the
 * number box of a document not issued yet (2026-11-04). Since 2026-11-05 an
 * albarán prints exactly like a factura (customer, prices, IVA, totals; only
 * the title differs), and the lines print WITH IVA so a rep's 2 € discount
 * reads 2,00 — both changes are in FacturaDocument, so reps get them as-is.
 *
 * NOTE: a change to that set (or to FacturaDocument) lives in packages/shared,
 * and Vercel does not rebuild this app for a shared-only push — it needs a
 * change under apps/web to reach reps (memory: vercel-skips-shared-only-pushes).
 */
export const FACTURA_LABELS: FacturaLabels = FACTURA_LABELS_ES;
