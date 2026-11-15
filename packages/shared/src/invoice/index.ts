/**
 * Invoice rendering + PDF export, deliberately kept OUT of the package root
 * barrel (`@grocery-app/shared`).
 *
 * This module is browser-only: it pulls in `react-dom/client`, `jspdf` and
 * `html2canvas-pro`, all of which need a real DOM. The root barrel is imported
 * by apps/mobile (Metro/React Native) and packages/api (ts-node), and
 * re-exporting from here poisoned both of those bundles with code they can
 * never run — html2canvas-pro also ships static class blocks that Metro's
 * Babel preset does not transform, which failed the RN bundle outright.
 *
 * Import it explicitly from the surfaces that have a DOM:
 *
 *     import { downloadOrderInvoice } from '@grocery-app/shared/invoice';
 *
 * Only apps/web (partner pages) and apps/admin should ever reach for this.
 */
export { default as InvoiceDocument } from './InvoiceDocument';
export type {
  InvoiceOrder,
  InvoiceSettings,
  InvoiceLabels,
  InvoiceDocumentProps,
} from './InvoiceDocument';
export { downloadOrderInvoice } from './invoicePdf';
export type { DownloadInvoiceOptions } from './invoicePdf';
export { default as FacturaDocument, FACTURA_LABELS_ES, facturaLineBases } from './FacturaDocument';
export type { FacturaLabels } from './FacturaDocument';
export { downloadFactura, downloadPdfFile, facturaPdfFile } from './facturaPdf';
export type { DownloadFacturaOptions, PdfFile } from './facturaPdf';
export { default as BillDocument } from './BillDocument';
export type { BillLabels, BillDocumentProps } from './BillDocument';
export { downloadBill, billPdfFile } from './billPdf';
export type { DownloadBillOptions } from './billPdf';
