import type { TFunction } from 'i18next';
import type { InvoiceLabels } from '@grocery-app/shared/invoice';

/**
 * Builds the label set the shared `InvoiceDocument` needs from admin's
 * own i18next instance. The component itself has no i18n dependency (the
 * partner panel that also renders it has no i18n setup at all), so each
 * host app is responsible for translating its own copy of these strings.
 */
export function buildInvoiceLabels(t: TFunction): InvoiceLabels {
  return {
    title: t('invoice.title'),
    from: t('invoice.from'),
    to: t('invoice.to'),
    product: t('invoice.product'),
    qty: t('invoice.qty'),
    price: t('invoice.price'),
    total: t('invoice.total'),
    subtotal: t('invoice.subtotal'),
    shipping: t('invoice.shipping'),
    free: t('invoice.free'),
    payment: t('invoice.payment'),
    paymentMethods: {
      cod: t('invoice.paymentMethods.cod'),
      card: t('invoice.paymentMethods.card'),
      bizum: t('invoice.paymentMethods.bizum'),
    },
    continued: t('invoice.continued'),
    page: (current, total) => t('invoice.page', { current, total }),
  };
}
