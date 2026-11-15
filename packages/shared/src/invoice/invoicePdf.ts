import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
// Tailwind v4 emits `color-mix(in oklab, ...)` for opacity-modifier
// utilities throughout a host app's global stylesheet. Plain html2canvas
// throws "unsupported color function oklab" when it walks that stylesheet
// while capturing anything else on the page — html2canvas-pro is a
// maintained fork that adds oklch/oklab/color-mix support and is
// otherwise a drop-in replacement. (InvoiceDocument itself uses only
// inline styles now, but html2canvas still parses the whole document's
// stylesheets, not just the captured node's, so this matters regardless.)
import html2canvas from 'html2canvas-pro';
import jsPDF from 'jspdf';
import InvoiceDocument, { type InvoiceOrder, type InvoiceSettings, type InvoiceLabels } from './InvoiceDocument';

const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;
const CANVAS_SCALE = 2; // crisper raster without ballooning file size

export interface DownloadInvoiceOptions {
  order: InvoiceOrder;
  settings: InvoiceSettings;
  labels: InvoiceLabels;
  lang: string;
  logoSrc?: string;
}

/**
 * Renders `InvoiceDocument` off-screen, rasterizes each `.invoice-page`
 * block to its own PDF page, and triggers a browser download. Client-side
 * on purpose — everything the invoice needs (order + store settings) is
 * already in memory by the time a user clicks "download". Shared between
 * the admin panel and the partner (vendor) panel so both produce an
 * identical branded document.
 */
export async function downloadOrderInvoice(opts: DownloadInvoiceOptions): Promise<void> {
  const { order, settings, labels, lang, logoSrc } = opts;
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '-10000px';
  host.style.zIndex = '-1';
  document.body.appendChild(host);

  const root = createRoot(host);

  try {
    await new Promise<void>((resolve) => {
      root.render(createElement(InvoiceDocument, { order, settings, labels, lang, logoSrc }));
      // Let React commit before we start measuring/capturing the DOM.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    await document.fonts.ready;
    await waitForImages(host);

    const pageNodes = Array.from(host.querySelectorAll<HTMLElement>('.invoice-page'));
    if (pageNodes.length === 0) throw new Error('Invoice has no pages to render.');

    const doc = new jsPDF({ unit: 'px', format: [A4_WIDTH_PX, A4_HEIGHT_PX], compress: true });

    for (let i = 0; i < pageNodes.length; i++) {
      const canvas = await html2canvas(pageNodes[i], {
        scale: CANVAS_SCALE,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) doc.addPage([A4_WIDTH_PX, A4_HEIGHT_PX]);
      doc.addImage(imgData, 'JPEG', 0, 0, A4_WIDTH_PX, A4_HEIGHT_PX);
    }

    // Albarán, not Factura. This document has no invoice number, no seller
    // or buyer tax ID and no IVA breakdown — it is a delivery note, and it
    // is handed to customers from admin and the partner pages. Calling the
    // file "Factura" made it claim to be a fiscal document it cannot be. The
    // real factura is FacturaDocument, raised through the invoices flow.
    doc.save(`Albaran-${order.order_number}.pdf`);
  } finally {
    root.unmount();
    host.remove();
  }
}

function waitForImages(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll('img'));
  return Promise.all(
    images.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      });
    }),
  ).then(() => undefined);
}
