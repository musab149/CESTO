import type { BillLabels } from '@grocery-app/shared/invoice';
import type { usePortT } from './portT';

/**
 * The words printed on a Bill, in the rep's language.
 *
 * Unlike FACTURA_LABELS this is a translation, not a constant: the albarán and
 * the factura use wording fixed by Spanish law, the Bill is a plain priced
 * list for the client and has none — so it reads in whatever language the rep
 * has the app set to.
 */
export function billLabels(t: ReturnType<typeof usePortT>): BillLabels {
  return {
    title: t('bill.title', 'Bill'),
    billedTo: t('bill.billedTo', 'Billed to'),
    product: t('bill.product', 'Product'),
    qty: t('bill.qty', 'Qty.'),
    price: t('bill.price', 'Price'),
    total: t('bill.total', 'Total'),
    subtotal: t('bill.subtotal', 'Subtotal'),
    delivery: t('bill.delivery', 'Shipping'),
    deliveryPending: t('bill.deliveryPending', 'To be confirmed'),
    pendingNote: t('bill.pendingNote', 'The delivery fee is added once it is set.'),
    recargo: t('bill.recargo', 'Recargo de equivalencia'),
    continued: t('bill.continued', 'continued'),
    page: (current, total) => t('bill.page', 'Page {{current}} of {{total}}', { current, total }),
  };
}
