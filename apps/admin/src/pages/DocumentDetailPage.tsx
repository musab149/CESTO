import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { FileQuestion, Info } from 'lucide-react';
import {
  useAdminBillDocument, useAdminIssuedDocument, type ArchiveClient, type ArchivePerson,
} from '@grocery-app/shared';
import { billPdfFile, downloadPdfFile, type PdfFile } from '@grocery-app/shared/invoice';
import BackLink from '@/components/BackLink';
import EmptyState from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import StatusBadge from '@/components/StatusBadge';
import DocumentViewer from '@/components/documents/DocumentViewer';
import { pdfOfIssued } from '@/lib/archivePdf';
import { buildBillLabels } from '@/lib/billLabels';
import { formatCurrency } from '@/lib/format';
import { useGoBack } from '@/lib/useGoBack';
import { useAdminAuthStore } from '@/stores/authStore';

const money = (v: string | number | null | undefined) => formatCurrency(Number(v ?? 0));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-card rounded-xl border border-border">
      <h2 className="px-4 pt-4 pb-1 text-sm font-bold font-display text-ink">{title}</h2>
      <dl className="px-4 pb-3 divide-y divide-border">{children}</dl>
    </section>
  );
}

function Row({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-[13px] text-gray shrink-0">{label}</dt>
      <dd className={`text-[13px] font-semibold text-ink text-right min-w-0 break-words ${mono ? 'font-mono' : ''}`}>{children}</dd>
    </div>
  );
}

/** The address as one line, skipping whatever a document or order left blank. */
function addressLine(a: Record<string, unknown> | null | undefined): string {
  if (!a) return '';
  const pick = (...keys: string[]) => keys.map((k) => a[k]).filter((v) => typeof v === 'string' && v.trim() !== '') as string[];
  return [
    ...pick('address', 'street_line_1', 'street_line_2'),
    pick('postcode', 'city').join(' '),
    ...pick('province', 'country'),
  ].filter(Boolean).join(', ');
}

/**
 * One document: the PDF on the left, what the archive knows about it on the right.
 * `:source` is `issued` for a factura or albarán, whose PDF is the file kept for it,
 * and `bill` for a bill, which is made from its order each time.
 */
export default function DocumentDetailPage() {
  const { source, id } = useParams<{ source: string; id: string }>();
  const { t, i18n } = useTranslation();
  const goBack = useGoBack();
  const queryClient = useQueryClient();
  // A lawyer reaches nothing but the archive, so a link out would go nowhere.
  const linksOut = useAdminAuthStore((s) => s.user?.role !== 'lawyer');

  const isBill = source === 'bill';
  const issued = useAdminIssuedDocument(id, !isBill);
  const billed = useAdminBillDocument(id, isBill);
  const query = isBill ? billed : issued;

  const [file, setFile] = useState<PdfFile | null>(null);
  const [pdfFailed, setPdfFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Refreshing the details once a file has been kept must not make it again.
  const loadedFor = useRef<string | null>(null);

  const issuedData = !isBill ? issued.data : undefined;
  const billData = isBill ? billed.data : undefined;

  useEffect(() => {
    const ready = isBill ? !!billData : !!issuedData;
    const key = `${source}/${id}/${attempt}`;
    if (!ready || loadedFor.current === key) return undefined;
    loadedFor.current = key;
    let cancelled = false;
    setFile(null);
    setPdfFailed(false);
    const load = async () => {
      if (billData) return { file: await billPdfFile({ bill: billData.bill, labels: buildBillLabels(t), lang: i18n.language }), saved: true };
      const result = await pdfOfIssued(issuedData!.invoice, issuedData!.pdf !== null);
      if (result.saved && issuedData!.pdf === null) void queryClient.invalidateQueries({ queryKey: ['admin-document', id] });
      return result;
    };
    load()
      .then((result) => { if (!cancelled) setFile(result.file); })
      .catch(() => { if (!cancelled) setPdfFailed(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, id, attempt, billData, issuedData]);

  const retry = useCallback(() => { loadedFor.current = null; setAttempt((n) => n + 1); }, []);
  const download = useCallback(() => { if (file) downloadPdfFile(file); }, [file]);

  const lang = i18n.language === 'en' ? 'en-GB' : 'es-ES';
  const stamp = (iso: string | null | undefined) => (iso
    ? new Date(iso).toLocaleString(lang, {
      timeZone: 'Europe/Madrid', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    : null);

  const person = (p: ArchivePerson | null) => {
    if (!p) return t('documents.detail.unknownPerson');
    return p.is_rep ? `${p.name} · ${t('documents.detail.rep')}${p.code ? ` ${p.code}` : ''}` : p.name;
  };

  const out = (to: string, label: string) => (linksOut
    ? <Link to={to} className="text-brand hover:underline">{label}</Link>
    : label);

  const back = (
    <BackLink
      label={t('documents.detail.back')}
      onClick={() => goBack(isBill ? '/documents?tab=bill' : '/documents')}
      className="mb-3"
    />
  );

  if (query.isLoading) {
    return (
      <div>
        {back}
        <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-4">
          <Skeleton className="h-[70vh] rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div>
        {back}
        <div className="bg-card rounded-xl border border-border">
          <EmptyState
            icon={<FileQuestion size={32} strokeWidth={1.5} className="text-muted" />}
            title={t('documents.detail.notFound')}
            description={t('documents.detail.notFoundBody')}
            action={{ label: t('documents.detail.back'), onClick: () => goBack('/documents') }}
          />
        </div>
      </div>
    );
  }

  const clientRows = (client: ArchiveClient, shownName: string | null, taxId: string | null, address: string) => (
    <>
      <Row label={t('documents.detail.client')}>{out(`/customers/${client.id}`, shownName ?? client.name)}</Row>
      <Row label={t('documents.detail.taxId')} mono>{taxId ?? client.tax_id}</Row>
      <Row label={t('documents.detail.email')}>{client.email}</Row>
      <Row label={t('documents.detail.phone')}>{client.phone}</Row>
      <Row label={t('documents.detail.address')}>{address}</Row>
    </>
  );

  const viewer = <DocumentViewer bytes={file?.bytes ?? null} failed={pdfFailed} onRetry={retry} onDownload={download} />;

  // ── A bill ────────────────────────────────────────────────
  if (billData) {
    const { bill, client, address, order } = billData;
    return (
      <div>
        {back}
        <Header kindLabel={t('documents.kind.bill')} number={order.order_number} />
        <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
          {viewer}
          <div className="space-y-4">
            <p className="flex items-start gap-2 rounded-xl bg-brand-whisper border border-border px-3 py-2.5 text-[13px] text-ink">
              <Info size={15} strokeWidth={1.75} className="text-brand shrink-0 mt-0.5" />
              {t('documents.detail.billNote')}
            </p>
            <Section title={t('documents.detail.orderSection')}>
              <Row label={order.is_purchase ? t('documents.detail.purchase') : t('documents.detail.order')} mono>
                {out(`/orders/${order.id}`, order.order_number)}
              </Row>
              <Row label={t('documents.detail.orderDate')}>{stamp(order.created_at)}</Row>
              <Row label={t('documents.detail.status')}><StatusBadge status={order.status} /></Row>
            </Section>
            <Section title={t('documents.detail.clientSection')}>
              {clientRows(client, null, null, addressLine(address))}
            </Section>
            <Section title={t('documents.detail.amounts')}>
              <Row label={t('documents.detail.subtotal')}>{money(bill.subtotal)}</Row>
              <Row label={t('documents.detail.delivery')}>
                {bill.delivery_pending ? t('documents.detail.deliveryPending') : money(bill.delivery_fee)}
              </Row>
              {Number(bill.recargo) > 0 && <Row label={t('documents.detail.recargo')}>{money(bill.recargo)}</Row>}
              <Row label={t('documents.detail.total')}>{money(bill.total)}</Row>
            </Section>
          </div>
        </div>
      </div>
    );
  }

  if (!issuedData) return null;

  // ── A factura or albarán ──────────────────────────────────
  const { invoice, issued_by: issuedBy, drafted_by: draftedBy, client, order, pdf } = issuedData;
  const buyer = invoice.buyer_snapshot as unknown as Record<string, unknown>;
  const buyerName = typeof buyer.name === 'string' && buyer.name.trim() ? buyer.name : null;
  const buyerTaxId = typeof buyer.tax_id === 'string' && buyer.tax_id.trim() ? buyer.tax_id : null;

  return (
    <div>
      {back}
      <Header kindLabel={t(`documents.kind.${invoice.kind}`)} number={invoice.invoice_number ?? ''} />
      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
        {viewer}
        <div className="space-y-4">
          <Section title={t('documents.detail.details')}>
            <Row label={t('documents.detail.type')}>{t(`documents.kind.${invoice.kind}`)}</Row>
            <Row label={t('documents.detail.number')} mono>{invoice.invoice_number}</Row>
            <Row label={t('documents.detail.issued')}>{stamp(invoice.issue_date)}</Row>
            <Row label={t('documents.detail.issuedBy')}>{person(issuedBy)}</Row>
            <Row label={t('documents.detail.drafted')}>{stamp(invoice.created_at)}</Row>
            <Row label={t('documents.detail.draftedBy')}>{person(draftedBy)}</Row>
          </Section>
          <Section title={t('documents.detail.pdfSection')}>
            {pdf ? (
              <>
                <Row label={t('documents.detail.pdfSaved')}>{stamp(pdf.saved_at)}</Row>
                <Row label={t('documents.detail.pdfSize')}>{`${Math.max(1, Math.round(pdf.size_bytes / 1024))} KB`}</Row>
                <Row label={t('documents.detail.pdfFingerprint')} mono>
                  <span title={pdf.sha256}>{`${pdf.sha256.slice(0, 12)}…`}</span>
                </Row>
              </>
            ) : (
              <Row label={t('documents.detail.pdfSaved')}>{t('documents.detail.pdfPending')}</Row>
            )}
          </Section>
          {order && (
            <Section title={t('documents.detail.orderSection')}>
              <Row label={order.is_purchase ? t('documents.detail.purchase') : t('documents.detail.order')} mono>
                {order.deleted ? order.order_number : out(`/orders/${order.id}`, order.order_number)}
              </Row>
              <Row label={t('documents.detail.status')}>
                {order.deleted ? t('documents.detail.orderDeleted') : <StatusBadge status={order.status} />}
              </Row>
            </Section>
          )}
          <Section title={t('documents.detail.clientSection')}>
            {clientRows(client, buyerName, buyerTaxId, addressLine(buyer))}
          </Section>
          <Section title={t('documents.detail.amounts')}>
            <Row label={t('documents.detail.base')}>{money(invoice.taxable_base)}</Row>
            <Row label={t('documents.detail.iva')}>{money(invoice.vat_total)}</Row>
            {Number(invoice.recargo_total ?? 0) > 0 && <Row label={t('documents.detail.recargo')}>{money(invoice.recargo_total)}</Row>}
            <Row label={t('documents.detail.total')}>{money(invoice.total)}</Row>
            <Row label={t('documents.detail.terms')}>{invoice.payment_terms}</Row>
            <Row label={t('documents.detail.notes')}>{invoice.notes}</Row>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Header({ kindLabel, number }: { kindLabel: string; number: string }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold font-display text-gray">{kindLabel}</p>
      <h1 className="text-xl sm:text-2xl font-bold font-mono text-ink break-all">{number}</h1>
    </div>
  );
}
