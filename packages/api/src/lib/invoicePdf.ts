import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { bunnyConfig, randomObjectName, uploadObjectToBunny } from './bunny';

/**
 * The exact PDF of an issued factura or albarán (user, 2026-11-07: "the exact pdf
 * should be saved"), so that a later change to the template cannot change how an
 * old document looks.
 *
 * THE BROWSER DRAWS IT, as it does every PDF here (shared/invoice), and sends it
 * straight after issuing. The server cannot draw one: that takes a real DOM. So
 * if the file never arrives (a closed tab, a dropped connection), the first person
 * to open the document in the archive draws and saves it, in the layout of that
 * day. Its sha256 is kept beside it, so a file altered in storage is noticed.
 *
 * ONCE SAVED, NEVER REPLACED: the first file stays and a second is answered with
 * "already". There is no route to change or remove one.
 *
 * NOT IN THE PUBLIC IMAGE FOLDERS, and the path never leaves the server: every
 * read goes through the API, which is what enforces who may have it. A pull zone
 * serves a whole storage zone, so the unguessable name is what protects a file
 * from anyone trying to reach it past the API.
 */

/** A very long order is about thirty pages, at under 300 KB each. */
export const MAX_PDF_BYTES = 40 * 1024 * 1024;

export const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: 1 },
});

/** Local development only: a deployed server's disk does not survive a redeploy. */
const DISK_ROOT = path.join(process.cwd(), 'private-documents');

const isPdf = (bytes: Buffer) => bytes.subarray(0, 5).toString('latin1') === '%PDF-';
const sha256 = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');

async function putBytes(bytes: Buffer): Promise<string> {
  const key = `documents/${randomObjectName('.pdf')}`;
  if (bunnyConfig()) {
    await uploadObjectToBunny(key, bytes, 'application/pdf');
    return key;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Document storage is not configured.');
  }
  const file = path.join(DISK_ROOT, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
  return key;
}

async function getBytes(key: string): Promise<Buffer> {
  const cfg = bunnyConfig();
  if (cfg) {
    const res = await fetch(`https://${cfg.storageHost}/${cfg.zone}/${key}`, {
      headers: { AccessKey: cfg.accessKey },
    });
    if (!res.ok) throw new Error(`Document storage answered ${res.status}.`);
    return Buffer.from(await res.arrayBuffer());
  }
  return fs.readFile(path.join(DISK_ROOT, key));
}

export interface PdfActor {
  adminId?: string | null;
  salesRepId?: string | null;
}

export type SavePdfResult =
  | { status: 'not_pdf' }
  | { status: 'saved' | 'already'; saved_at: Date; sha256: string; size_bytes: number };

/** Keep this document's PDF, unless it already has one. Prove the document is issued first. */
export async function saveInvoicePdf(invoiceId: string, bytes: Buffer, actor: PdfActor): Promise<SavePdfResult> {
  const describe = (row: { created_at: Date; sha256: string; size_bytes: number }, status: 'saved' | 'already') => ({
    status, saved_at: row.created_at, sha256: row.sha256, size_bytes: row.size_bytes,
  });

  const existing = await prisma.invoicePdf.findUnique({ where: { invoice_id: invoiceId } });
  if (existing) return describe(existing, 'already');
  if (!isPdf(bytes)) return { status: 'not_pdf' };

  const storageKey = await putBytes(bytes);
  try {
    const row = await prisma.invoicePdf.create({
      data: {
        invoice_id: invoiceId,
        storage_key: storageKey,
        sha256: sha256(bytes),
        size_bytes: bytes.length,
        saved_by_admin_id: actor.adminId ?? null,
        saved_by_sales_rep_id: actor.salesRepId ?? null,
      },
    });
    return describe(row, 'saved');
  } catch (err) {
    // Two browsers at once: the first stays. The loser's file is left unreferenced.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await prisma.invoicePdf.findUniqueOrThrow({ where: { invoice_id: invoiceId } });
      return describe(winner, 'already');
    }
    throw err;
  }
}

export type ReadPdfResult =
  | { status: 'none' }
  | { status: 'altered' }
  | { status: 'ok'; bytes: Buffer };

/** The saved file, checked against the fingerprint taken when it was saved. */
export async function readInvoicePdf(invoiceId: string): Promise<ReadPdfResult> {
  const row = await prisma.invoicePdf.findUnique({ where: { invoice_id: invoiceId } });
  if (!row) return { status: 'none' };
  const bytes = await getBytes(row.storage_key);
  if (sha256(bytes) !== row.sha256) return { status: 'altered' };
  return { status: 'ok', bytes };
}
