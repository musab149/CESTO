export * from './types';
export * from './invoiceLock';
export * from './orderEditing';
export * from './savedBasket';
export * from './invoiceLinePrice';
export * from './savedForm';
export * from './recargo';
export * from './routeAccess';
export * from './cartLimits';
export * from './deliveryFee';
export { useMockQuery } from './useMockQuery';
export * from './api';
export * from './homeSections';
export * from './appContent';
export * from './businessHome';
export * from './originArt';
export * from './geolocation';
export * from './shopHours';
export * from './spain';
export * from './orderLinePreview';
export * from './tax';
export * from './orderProgress';
export * from './repLedger';

// NOTE: ./invoice is deliberately NOT re-exported here. It is browser-only
// (react-dom/client + jspdf + html2canvas-pro) and this barrel is consumed by
// apps/mobile via Metro and packages/api via ts-node, neither of which has a
// DOM. Import it directly instead:
//   import { downloadOrderInvoice } from '@grocery-app/shared/invoice';

// Partner dashboard translations — shared by web's /partner/* surface and
// mobile's partner mode. The usePartnerT hook stays in each app, since it
// reads that app's own language store.
export { partnerT, partnerDictionaries } from './i18n/partner';
export type { PartnerLang } from './i18n/partner';
// Sales-rep translations — shared by web's /sales/* surface and the rep
// tablet app to come, for the same reason the partner ones are shared.
export { salesT, salesDictionaries } from './i18n/sales';
export type { SalesLang } from './i18n/sales';
export { businessT, businessDictionaries } from './i18n/business';
export type { BusinessLang } from './i18n/business';
