import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';
import BillDocument, { type BillLabels } from './BillDocument';
import type { OrderBill } from '../types';
import type { PdfFile } from './facturaPdf';

/**
 * Rasterise a Bill to a PDF and hand it to the browser.
 *
 * The same machinery as invoicePdf.ts and facturaPdf.ts — off-screen render,
 * one canvas per `.invoice-page`, one PDF page each — for the reason those
 * give: a different input shape, and a body small enough to keep beside it.
 * `html2canvas-pro` because Tailwind v4's `color-mix(in oklab, ...)` breaks
 * the original.
 */

const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;
const CANVAS_SCALE = 2;

export interface DownloadBillOptions {
  bill: OrderBill;
  labels: BillLabels;
  lang: string;
}

async function drawBill({ bill, labels, lang }: DownloadBillOptions): Promise<jsPDF> {
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
    flushSync(() => root.render(createElement(BillDocument, { bill, labels, lang })));
    // Ask for the faces by name. `fonts.ready` only waits for loads already
    // under way, so a weight nothing on the screen had used yet could be
    // captured in the fallback. (Where no DM Sans is declared at all — apps/web
    // today, see app.css — this is a no-op and the system font prints.)
    await Promise.all([
      "400 14px 'DM Sans'", "600 14px 'DM Sans'", "700 24px 'DM Sans'", "400 14px 'JetBrains Mono'",
    ].map((f) => document.fonts.load(f).catch(() => [])));
    await document.fonts.ready;

    const pageNodes = Array.from(host.querySelectorAll<HTMLElement>('.invoice-page'));
    if (pageNodes.length === 0) throw new Error('The bill has no pages to render.');

    const doc = new jsPDF({ unit: 'px', format: [A4_WIDTH_PX, A4_HEIGHT_PX], compress: true });
    for (let i = 0; i < pageNodes.length; i += 1) {
      const canvas = await html2canvas(pageNodes[i], { scale: CANVAS_SCALE, useCORS: true, backgroundColor: '#ffffff' });
      if (i > 0) doc.addPage([A4_WIDTH_PX, A4_HEIGHT_PX]);
      doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, A4_WIDTH_PX, A4_HEIGHT_PX);
    }
    return doc;
  } finally {
    root.unmount();
    host.remove();
  }
}

// "Bill-ORD-…" / "Nota-ORD-…": the document's name, then the order's.
const billFileName = ({ bill, labels }: DownloadBillOptions) => `${labels.title}-${bill.order_number}.pdf`;

export async function downloadBill(opts: DownloadBillOptions): Promise<void> {
  const doc = await drawBill(opts);
  doc.save(billFileName(opts));
}

/** The same PDF as bytes, for the archive's ZIP. */
export async function billPdfFile(opts: DownloadBillOptions): Promise<PdfFile> {
  const doc = await drawBill(opts);
  return { name: billFileName(opts), bytes: new Uint8Array(doc.output('arraybuffer')) };
}
