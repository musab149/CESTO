import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Archive, ArrowDownWideNarrow, ArrowUpWideNarrow, Download, FileCheck2, FileText, Loader2, ReceiptText, Search, WifiOff, X,
  type LucideIcon,
} from 'lucide-react';
import { adminDocuments, useAdminDocuments, type ArchiveKind, type ArchiveRow } from '@grocery-app/shared';
import { downloadBill, downloadPdfFile } from '@grocery-app/shared/invoice';
import { TableSkeleton } from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import Pagination from '@/components/Pagination';
import StatusBadge from '@/components/StatusBadge';
import { useToast } from '@/components/Toast';
import BulkDownloadModal from '@/components/documents/BulkDownloadModal';
import { pdfOfIssuedById } from '@/lib/archivePdf';
import { buildBillLabels } from '@/lib/billLabels';
import { formatCurrency } from '@/lib/format';

const PAGE_SIZE = 25;

const TABS: Array<{ key: ArchiveKind; Icon: LucideIcon }> = [
  { key: 'invoice', Icon: FileCheck2 },
  { key: 'albaran', Icon: FileText },
  { key: 'bill', Icon: ReceiptText },
];

const dateOf = (iso: string, lang: string) => new Date(iso).toLocaleDateString(
  lang === 'en' ? 'en-GB' : 'es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: 'short', year: 'numeric' },
);
const timeOf = (iso: string, lang: string) => new Date(iso).toLocaleTimeString(
  lang === 'en' ? 'en-GB' : 'es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' },
);

/**
 * Every document we have issued, for whoever has to answer for them: the
 * lawyers, mainly. One tab per kind; sorted and narrowed by date; read one, take
 * one, or take everything the filters show as a ZIP.
 *
 * The filters live in the URL, as on the orders page, so Back from a document
 * lands on the same list and a filtered view can be sent to someone.
 */
export default function DocumentsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const tabParam = params.get('tab');
  const kind: ArchiveKind = tabParam === 'albaran' || tabParam === 'bill' ? tabParam : 'invoice';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const sort = params.get('sort') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const urlQuery = params.get('q') ?? '';

  // Typed here at once, sent a moment later: not a request per keystroke.
  const [search, setSearch] = useState(urlQuery);
  useEffect(() => { setSearch(urlQuery); }, [urlQuery]);

  /** Changes the filters. Anything but the page itself goes back to page one. */
  const change = (next: Record<string, string>) => {
    setParams((prev) => {
      const merged = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(next)) {
        if (v) merged.set(k, v);
        else merged.delete(k);
      }
      if (!('page' in next)) merged.delete('page');
      return merged;
    }, { replace: true });
  };

  useEffect(() => {
    if (search.trim() === urlQuery) return undefined;
    const timer = setTimeout(() => change({ q: search.trim() }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, urlQuery]);

  const filters = {
    kind,
    from: from || undefined,
    to: to || undefined,
    q: urlQuery || undefined,
  };
  const { data, isLoading, isError, refetch } = useAdminDocuments({ ...filters, sort, page, limit: PAGE_SIZE });
  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const filtered = !!(from || to || urlQuery);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const open = (row: ArchiveRow) => navigate(`/documents/${row.kind === 'bill' ? 'bill' : 'issued'}/${row.id}`);

  const downloadOne = async (row: ArchiveRow) => {
    setBusyId(row.id);
    try {
      if (row.kind === 'bill') {
        const { bill } = await adminDocuments.bill(row.id);
        await downloadBill({ bill, labels: buildBillLabels(t), lang: i18n.language });
      } else {
        downloadPdfFile((await pdfOfIssuedById(row.id)).file);
      }
    } catch (err) {
      toast.error(t('documents.downloadFailed'), err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const downloadButton = (row: ArchiveRow) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); void downloadOne(row); }}
      disabled={busyId !== null}
      aria-label={`${t('documents.download')} ${row.number}`}
      title={t('documents.download')}
      className="w-9 h-9 rounded-lg border border-border text-gray hover:text-ink hover:bg-surface-linen inline-flex items-center justify-center transition-colors disabled:opacity-50 shrink-0"
    >
      {busyId === row.id
        ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" />
        : <Download size={16} strokeWidth={1.75} />}
    </button>
  );

  const field = 'w-full h-10 bg-surface-cream border border-border rounded-lg px-3 text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30';
  const SortIcon = sort === 'desc' ? ArrowDownWideNarrow : ArrowUpWideNarrow;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold font-display text-ink">{t('documents.title')}</h1>
          <p className="text-sm text-gray mt-1">{t('documents.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => setBulkOpen(true)}
          disabled={total === 0}
          className="h-10 w-full sm:w-auto px-4 rounded-xl bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
        >
          <Archive size={16} strokeWidth={1.75} />
          {t('documents.bulk.button', { count: total })}
        </button>
      </div>

      <div className="tab-strip flex flex-wrap items-center gap-1 mb-5 border-b border-border">
        {TABS.map(({ key, Icon }) => (
          <button
            key={key}
            type="button"
            data-active={kind === key}
            onClick={() => change({ tab: key === 'invoice' ? '' : key })}
            className={`relative -mb-px px-4 h-10 text-sm font-semibold font-display inline-flex items-center gap-2 transition ${
              kind === key
                ? 'text-brand border-b-2 border-brand'
                : 'text-muted hover:text-ink border-b-2 border-transparent'
            }`}
          >
            <Icon size={16} strokeWidth={1.75} />
            {t(`documents.tabs.${key}`)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-end gap-3 mb-4">
        <label className="block sm:w-40">
          <span className="block text-xs font-semibold font-display text-gray mb-1">{t('documents.filters.from')}</span>
          <input type="date" value={from} max={to || undefined} onChange={(e) => change({ from: e.target.value })} className={field} />
        </label>
        <label className="block sm:w-40">
          <span className="block text-xs font-semibold font-display text-gray mb-1">{t('documents.filters.to')}</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => change({ to: e.target.value })} className={field} />
        </label>
        <div className="relative col-span-2 sm:flex-1 sm:min-w-[240px] sm:max-w-sm">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('documents.filters.search')}
            aria-label={t('documents.filters.search')}
            className={`${field} pl-9 placeholder:text-muted`}
          />
        </div>
        <button
          type="button"
          onClick={() => change({ sort: sort === 'desc' ? 'asc' : '' })}
          className="col-span-2 sm:col-span-1 h-10 px-3 rounded-lg border border-border text-sm font-semibold font-display text-ink hover:bg-surface-linen inline-flex items-center justify-center gap-2 transition-colors"
        >
          <SortIcon size={16} strokeWidth={1.75} />
          {sort === 'desc' ? t('documents.filters.newest') : t('documents.filters.oldest')}
        </button>
        {filtered && (
          <button
            type="button"
            onClick={() => { setSearch(''); change({ from: '', to: '', q: '' }); }}
            className="col-span-2 sm:col-span-1 h-10 px-3 rounded-lg text-sm font-semibold font-display text-gray hover:text-ink inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            <X size={15} strokeWidth={1.75} />
            {t('documents.filters.clear')}
          </button>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : isError ? (
        <div className="bg-card rounded-xl border border-border">
          <EmptyState
            icon={<WifiOff size={32} strokeWidth={1.5} className="text-muted" />}
            title={t('documents.loadFailed')}
            description={t('documents.loadFailedBody')}
            action={{ label: t('documents.retry'), onClick: () => { void refetch(); } }}
          />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-card rounded-xl border border-border">
          <EmptyState
            icon={<Archive size={32} strokeWidth={1.5} className="text-muted" />}
            title={filtered ? t('documents.empty.filtered') : t(`documents.empty.${kind}`)}
            description={filtered ? t('documents.empty.filteredBody') : t(`documents.empty.${kind}Body`)}
            action={filtered
              ? { label: t('documents.filters.clear'), onClick: () => { setSearch(''); change({ from: '', to: '', q: '' }); } }
              : undefined}
          />
        </div>
      ) : (
        <>
          {/* On a phone, a list; from sm, the table. */}
          <ul className="sm:hidden bg-card rounded-xl border border-border divide-y divide-border overflow-hidden">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-2 pr-3">
                <button type="button" onClick={() => open(row)} className="flex-1 min-w-0 text-left pl-4 py-3 hover:bg-brand-mist/30 transition-colors">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-sm text-ink truncate">{row.number}</span>
                    <span className="ml-auto text-sm font-semibold text-ink tabular-nums shrink-0">{formatCurrency(Number(row.total))}</span>
                  </div>
                  <p className="text-[13px] text-gray truncate mt-0.5">{row.client?.name ?? '—'}</p>
                  <p className="text-xs text-muted mt-0.5 tabular-nums">
                    {dateOf(row.date, i18n.language)} · {timeOf(row.date, i18n.language)}
                  </p>
                </button>
                {downloadButton(row)}
              </li>
            ))}
          </ul>

          <div className="hidden sm:block bg-card rounded-xl border border-border overflow-hidden overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="bg-surface-cream">
                  {[
                    { label: t('documents.table.number') },
                    { label: t('documents.table.date') },
                    { label: t('documents.table.client') },
                    { label: kind === 'bill' ? t('documents.table.status') : t('documents.table.order') },
                    { label: t('documents.table.total'), right: true },
                    { label: t('documents.table.actions'), right: true },
                  ].map((h) => (
                    <th key={h.label} className={`px-4 py-3 text-xs font-semibold font-display text-gray uppercase tracking-wider ${h.right ? 'text-right' : 'text-left'}`}>
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} onClick={() => open(row)} className="border-t border-border cursor-pointer hover:bg-brand-mist/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-sm text-ink whitespace-nowrap">
                      {row.number}
                      {row.kind === 'credit_note' && (
                        <span className="ml-2 font-display text-[11px] font-semibold text-warning">{t('documents.kind.credit_note')}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink whitespace-nowrap tabular-nums">
                      {dateOf(row.date, i18n.language)}
                      <span className="block text-xs text-muted">{timeOf(row.date, i18n.language)}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink max-w-[260px]">
                      <span className="block truncate">{row.client?.name ?? '—'}</span>
                      {row.client?.tax_id && <span className="block font-mono text-xs text-muted truncate">{row.client.tax_id}</span>}
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {kind === 'bill'
                        ? (row.order?.status ? <StatusBadge status={row.order.status} /> : '—')
                        : <span className="font-mono text-gray">{row.order?.order_number ?? '—'}</span>}
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-ink text-right tabular-nums whitespace-nowrap">
                      {formatCurrency(Number(row.total))}
                    </td>
                    <td className="px-4 py-3 text-right">{downloadButton(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            totalPages={data?.totalPages ?? 1}
            onPageChange={(p) => change({ page: p > 1 ? String(p) : '' })}
            totalItems={total}
            pageSize={PAGE_SIZE}
            className="mt-4"
          />
        </>
      )}

      {bulkOpen && <BulkDownloadModal filters={filters} count={total} onClose={() => setBulkOpen(false)} />}
    </div>
  );
}
