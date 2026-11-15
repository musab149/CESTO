import { adminDocuments, type Invoice } from '@grocery-app/shared';
import { facturaPdfFile, type PdfFile } from '@grocery-app/shared/invoice';
import { facturaLabels } from './facturaLabels';

/**
 * An issued document's PDF: the file kept for it, or, when none has been kept yet,
 * the one drawn now and kept from here on (lib/invoicePdf on the API).
 *
 * If saving fails the document is still shown, `saved` says so, and the next
 * opening tries again. If someone else's file got there first, theirs is the one
 * that counts, so that is the one handed back.
 */
export async function pdfOfIssued(invoice: Invoice, hasSavedFile: boolean): Promise<{ file: PdfFile; saved: boolean }> {
  const name = `${invoice.invoice_number ?? invoice.id}.pdf`;
  if (hasSavedFile) return { file: { name, bytes: await adminDocuments.pdfBytes(invoice.id) }, saved: true };

  const file = await facturaPdfFile({ invoice, labels: facturaLabels() });
  try {
    const result = await adminDocuments.savePdf(invoice.id, file);
    if (result.status === 'already') {
      return { file: { name, bytes: await adminDocuments.pdfBytes(invoice.id) }, saved: true };
    }
    return { file, saved: true };
  } catch {
    return { file, saved: false };
  }
}

/** The same, starting from only the document's id. */
export async function pdfOfIssuedById(id: string): Promise<{ file: PdfFile; saved: boolean }> {
  const { invoice, pdf } = await adminDocuments.issued(id);
  return pdfOfIssued(invoice, pdf !== null);
}
