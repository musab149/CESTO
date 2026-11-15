import type { InvoiceLabels } from '@grocery-app/shared/invoice';

/**
 * Builds the label set the shared `InvoiceDocument` needs from the
 * partner panel's lightweight `usePartnerT()` dictionary. Mirrors
 * apps/admin/src/lib/invoiceLabels.ts — kept as a separate copy rather
 * than shared code because the two host apps use unrelated translation
 * mechanisms (react-i18next vs. this key/value lookup), and the shared
 * `InvoiceDocument` deliberately has no opinion on either.
 */
export function buildPartnerInvoiceLabels(t: (key: string) => string): InvoiceLabels {
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
    // usePartnerT has no interpolation — build the "Page X of Y" string by
    // hand instead of via a translation key.
    continued: t('invoice.continued'),
    page: (current, total) => `${current} / ${total}`,
  };
}
