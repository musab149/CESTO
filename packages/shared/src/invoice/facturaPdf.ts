import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';
import FacturaDocument, { type FacturaLabels } from './FacturaDocument';
import type { Invoice } from '../api/services/admin';

/**
 * Rasterise an invoice to a PDF and hand it to the browser.
 *
 * Mirrors invoicePdf.ts rather than sharing its body: that one renders a live
 * order and takes store settings, this one renders a frozen invoice snapshot.
 * The machinery is nearly identical and the duplication is small; merging
 * them would mean one function with two unrelated input shapes.
 *
 * `html2canvas-pro`, not plain html2canvas: Tailwind v4 emits
 * `color-mix(in oklab, ...)` which the original throws on.
 */

const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;
const CANVAS_SCALE = 2;

export interface DownloadFacturaOptions {
  invoice: Invoice;
  labels: FacturaLabels;
}

/** The filename is the document's own number, so a folder of them sorts. */
function fileNameFor(invoice: Invoice, labels: FacturaLabels): string {
  const stem = invoice.invoice_number
    ?? `${labels.albaranTitle}-${invoice.id.slice(0, 8)}`;
  return `${stem}.pdf`;
}

/** A finished PDF, for something other than downloading it straight away. */
export interface PdfFile {
  name: string;
  bytes: Uint8Array;
}

async function drawFactura(opts: DownloadFacturaOptions): Promise<jsPDF> {
  const { invoice, labels } = opts;

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '-10000px';
  host.style.zIndex = '-1';
  document.body.appendChild(host);

  const root = createRoot(host);

  try {
    // Committed now, not "probably by the next two frames": that guess lost under
    // load, leaving no pages to draw, and a hidden tab has no frames at all, so a ZIP
    // stopped dead the moment somebody looked at another tab. A tick first, because
    // this can be called from inside an effect, where flushSync is not allowed.
    await Promise.resolve();
    flushSync(() => root.render(createElement(FacturaDocument, { invoice, labels })));

    await document.fonts.ready;

    const pageNodes = Array.from(host.querySelectorAll<HTMLElement>('.invoice-page'));
    if (pageNodes.length === 0) throw new Error('Invoice has no pages to render.');

    const doc = new jsPDF({ unit: 'px', format: [A4_WIDTH_PX, A4_HEIGHT_PX], compress: true });

    for (let i = 0; i < pageNodes.length; i += 1) {
      const canvas = await html2canvas(pageNodes[i], {
        scale: CANVAS_SCALE,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) doc.addPage([A4_WIDTH_PX, A4_HEIGHT_PX]);
      doc.addImage(imgData, 'JPEG', 0, 0, A4_WIDTH_PX, A4_HEIGHT_PX);
    }

    return doc;
  } finally {
    root.unmount();
    host.remove();
  }
}

export async function downloadFactura(opts: DownloadFacturaOptions): Promise<void> {
  const doc = await drawFactura(opts);
  doc.save(fileNameFor(opts.invoice, opts.labels));
}

/** Hand a finished PDF to the browser as a download. */
export function downloadPdfFile(file: PdfFile): void {
  const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The same PDF as bytes, to keep it, or put it in a ZIP, as well as hand it over. */
export async function facturaPdfFile(opts: DownloadFacturaOptions): Promise<PdfFile> {
  const doc = await drawFactura(opts);
  return { name: fileNameFor(opts.invoice, opts.labels), bytes: new Uint8Array(doc.output('arraybuffer')) };
}
