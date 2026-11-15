import type { TFunction } from 'i18next';
import type { BillLabels } from '@grocery-app/shared/invoice';

/**
 * The Bill's printed words, from admin's i18next — the shared document has no
 * i18n of its own, like InvoiceDocument (see invoiceLabels.ts). Defaults are
 * inline so a missing key still prints English rather than a key path.
 */
export function buildBillLabels(t: TFunction): BillLabels {
  return {
    title: t('bill.title', 'Bill'),
    billedTo: t('bill.billedTo', 'Billed to'),
    product: t('invoice.product'),
    qty: t('invoice.qty'),
    price: t('invoice.price'),
    total: t('invoice.total'),
    subtotal: t('invoice.subtotal'),
    delivery: t('invoice.shipping'),
    deliveryPending: t('bill.deliveryPending', 'To be confirmed'),
    pendingNote: t('bill.pendingNote', 'The delivery fee is added once it is set.'),
    recargo: t('bill.recargo', 'Recargo de equivalencia'),
    continued: t('invoice.continued'),
    page: (current, total) => t('invoice.page', { current, total }),
  };
}
