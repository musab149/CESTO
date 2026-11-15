import { FACTURA_LABELS_ES, type FacturaLabels } from '@grocery-app/shared/invoice';

/**
 * The words printed on a factura or albarán: Spanish, always — it is a
 * Spanish fiscal document, and "Base", "IVA", "N.I.F" and "Documento no
 * fiscal…" are the terms it is required to use whatever language the admin
 * has the screen in. One set in packages/shared (FACTURA_LABELS_ES), shared
 * with the rep panel, so the two copies of the same document cannot drift.
 */
export function facturaLabels(): FacturaLabels {
  return FACTURA_LABELS_ES;
}
