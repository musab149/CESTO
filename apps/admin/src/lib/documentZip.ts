import { Zip, ZipPassThrough } from 'fflate';
import { adminDocuments, type ArchiveFilters } from '@grocery-app/shared';
import { billPdfFile, type BillLabels } from '@grocery-app/shared/invoice';
import { pdfOfIssued } from './archivePdf';

/**
 * A date range of documents as a ZIP, built here in the browser.
 *
 * In the browser because that is where a PDF is drawn (shared/invoice). A factura
 * or albarán goes in as the file kept for it; one with no file yet is drawn, and
 * kept from then on. One document at a time, so the page stays usable and it can be
 * stopped. PDFs are already compressed, so they are stored rather than squeezed again.
 *
 * A very large range is split rather than risked: past PART_LIMIT the file so far
 * is downloaded and the next one begun, because a browser holds all of it until
 * the end and the tab would otherwise die with nothing to show for it.
 */

const PAGE_SIZE = 20;
const PART_LIMIT = 400 * 1024 * 1024;

const FOLDER_NAME: Record<ArchiveFilters['kind'], string> = {
  invoice: 'facturas',
  albaran: 'albaranes',
  bill: 'notas',
};

export interface ZipProgress {
  done: number;
  total: number;
}

export interface ZipResult {
  /** Documents that went into a file. */
  done: number;
  total: number;
  /** ZIP files downloaded. */
  parts: number;
  /** Names of documents that could not be drawn. Listed in the ZIP too. */
  skipped: string[];
  stopped: boolean;
}

/** One ZIP being written: chunks accumulate as a Blob's parts, not one huge array. */
class ZipFile {
  private chunks: Uint8Array[] = [];
  private zip: Zip;
  private finished: Promise<void>;
  size = 0;

  constructor() {
    let resolve: () => void;
    let reject: (e: unknown) => void;
    this.finished = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
    this.zip = new Zip((err, chunk, final) => {
      if (err) { reject(err); return; }
      this.chunks.push(chunk);
      this.size += chunk.length;
      if (final) resolve();
    });
  }

  add(name: string, bytes: Uint8Array) {
    const entry = new ZipPassThrough(name);
    this.zip.add(entry);
    entry.push(bytes, true);
  }

  async end(): Promise<Blob> {
    this.zip.end();
    await this.finished;
    return new Blob(this.chunks as BlobPart[], { type: 'application/zip' });
  }
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Long enough for the browser to have taken the file.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadDocumentsZip(args: {
  filters: ArchiveFilters;
  billLabels: BillLabels;
  lang: string;
  onProgress: (p: ZipProgress) => void;
  shouldStop: () => boolean;
}): Promise<ZipResult> {
  const { filters, billLabels, lang, onProgress, shouldStop } = args;
  const stem = `${FOLDER_NAME[filters.kind]}_${filters.from ?? 'inicio'}_${filters.to ?? 'hoy'}`;

  let zip = new ZipFile();
  let inZip = 0;
  const blobs: Blob[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  let done = 0;
  let total = 0;

  for (let page = 1; ; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const batch = await adminDocuments.exportPage({ ...filters, page, limit: PAGE_SIZE });
    total = batch.total;
    onProgress({ done, total });

    for (const item of batch.items) {
      if (shouldStop()) return { done, total, parts: 0, skipped, stopped: true };
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      try {
        // eslint-disable-next-line no-await-in-loop
        const file = item.invoice
          ? (await pdfOfIssued(item.invoice, !!item.pdf_saved)).file
          : await billPdfFile({ bill: item.bill!, labels: billLabels, lang });
        zip.add(file.name, file.bytes);
        inZip += 1;
      } catch (err) {
        const name = item.invoice?.invoice_number ?? item.bill?.order_number ?? item.id;
        console.error(`Could not draw ${name} for the ZIP`, err);
        skipped.push(name);
      }
      done += 1;
      onProgress({ done, total });

      if (zip.size >= PART_LIMIT) {
        // eslint-disable-next-line no-await-in-loop
        blobs.push(await zip.end());
        save(blobs[blobs.length - 1], `${stem}_parte${blobs.length}.zip`);
        zip = new ZipFile();
        inZip = 0;
      }
      // Let the page breathe between documents: drawing one holds the main thread.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => { setTimeout(r); });
    }

    if (batch.items.length === 0 || page >= batch.totalPages) break;
  }

  // Nothing is silently missing from a legal archive: what failed is named in it.
  if (skipped.length > 0) {
    zip.add('NO_INCLUIDOS.txt', new TextEncoder().encode(`No se pudieron generar:\n${skipped.join('\n')}\n`));
  }
  if (inZip > 0 || skipped.length > 0 || blobs.length === 0) {
    const last = await zip.end();
    const parts = blobs.length + 1;
    save(last, parts > 1 ? `${stem}_parte${parts}.zip` : `${stem}.zip`);
    return { done: done - skipped.length, total, parts, skipped, stopped: false };
  }
  return { done: done - skipped.length, total, parts: blobs.length, skipped, stopped: false };
}
