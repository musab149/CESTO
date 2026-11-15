import { useEffect, useRef, useState } from 'react';
import {
  Upload, Download, FileSpreadsheet, X, CheckCircle2, AlertCircle, Loader2, Copy,
} from 'lucide-react';
import {
  partnerProducts,
  useImportPartnerProducts,
  usePartnerImportJob,
  type PartnerBulkImportResult,
  type PartnerImportJob,
} from '@grocery-app/shared';

/**
 * Partner-scoped bulk import modal. Structural mirror of admin's
 * ImportProductsModal.tsx — same 3-step flow (download template → drop
 * xlsx → run) and same enqueue → poll → report contract. Every hook
 * hits `/api/partner/*` which forces store_id from the JWT on every row.
 */

const ERROR_COOLDOWN_SECONDS = 30;

interface Props {
  open: boolean;
  onClose: () => void;
}

const ACCEPT = '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

function statusLabel(status: PartnerImportJob['status']): string {
  switch (status) {
    case 'queued':      return 'Queued…';
    case 'running':     return 'Importing…';
    case 'done':        return 'Done';
    case 'failed':      return 'Failed';
    case 'interrupted': return 'Interrupted';
    default:            return status;
  }
}

export default function PartnerImportProductsModal({ open, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [, setNowTick] = useState(0);

  useEffect(() => {
    if (!cooldownUntil) return;
    const id = window.setInterval(() => {
      setNowTick((n) => n + 1);
      if (Date.now() >= cooldownUntil) setCooldownUntil(null);
    }, 500);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const cooldownSecondsLeft = cooldownUntil ? Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)) : 0;
  const isCoolingDown = cooldownSecondsLeft > 0;

  const importMutation = useImportPartnerProducts();
  const jobQuery = usePartnerImportJob(activeJobId);
  const job = jobQuery.data ?? null;
  const jobActive = job?.status === 'queued' || job?.status === 'running';
  const jobFailed = job?.status === 'failed' || job?.status === 'interrupted';
  const report: PartnerBulkImportResult | null = job?.status === 'done' ? job.result ?? null : null;

  function reset() {
    setFile(null);
    setActiveJobId(null);
    setCooldownUntil(null);
    importMutation.reset();
    if (inputRef.current) inputRef.current.value = '';
  }

  function close() {
    // Preserve an in-flight job so the partner can reopen the modal and
    // watch progress. Terminal jobs get a full reset.
    if (jobActive) {
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    } else {
      reset();
    }
    onClose();
  }

  function pick(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setActiveJobId(null);
    importMutation.reset();
  }

  async function downloadTemplate() {
    try {
      await partnerProducts.downloadTemplate();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Template download failed.');
    }
  }

  async function runImport() {
    if (!file) return;
    try {
      const res = await importMutation.mutateAsync(file);
      setActiveJobId(res.jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      window.alert(`Import failed: ${message}`);
      setCooldownUntil(Date.now() + ERROR_COOLDOWN_SECONDS * 1000);
    }
  }

  if (!open) return null;

  const pct = job && job.total ? Math.min(100, Math.round((job.processed / job.total) * 100)) : 0;
  const isRunAgain = !!report || jobFailed;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={close}
    >
      <div
        className="bg-white rounded-2xl shadow-modal w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-brand-mist flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-brand" strokeWidth={1.75} />
            </div>
            <div>
              <h2 className="text-lg font-bold font-display text-ink">
                Bulk import products
              </h2>
              <p className="text-xs text-muted font-body">
                Upload an Excel sheet of products for your store.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="w-9 h-9 rounded-lg hover:bg-surface-cream flex items-center justify-center transition"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-ink" strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Step 1: Download template */}
          <section className="bg-surface-cream rounded-lg border border-border p-4">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center font-semibold text-xs flex-shrink-0">
                1
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-ink">Start from the template</h3>
                <p className="text-xs text-muted font-body mt-0.5">
                  Download the .xlsx template — it has the required columns, example rows, and an Instructions sheet.
                </p>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="mt-3 inline-flex items-center gap-2 bg-white border border-border hover:bg-brand-mist text-ink font-semibold text-sm px-4 h-10 rounded-lg transition"
                >
                  <Download className="w-4 h-4" strokeWidth={1.75} />
                  Download template
                </button>
              </div>
            </div>
          </section>

          {/* Step 2: Drop zone */}
          <section className="bg-surface-cream rounded-lg border border-border p-4">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center font-semibold text-xs flex-shrink-0">
                2
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-ink">Upload your file</h3>
                <p className="text-xs text-muted font-body mt-0.5">
                  Products land in your own store — the server ignores any store column in the sheet.
                </p>

                <label
                  htmlFor="partner-import-file-input"
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    pick(e.dataTransfer.files?.[0]);
                  }}
                  className={`
                    mt-3 block w-full rounded-lg border-2 border-dashed cursor-pointer
                    px-4 py-6 text-center transition
                    ${dragOver
                      ? 'border-brand bg-brand-mist/40'
                      : file
                        ? 'border-success bg-success-bg/40'
                        : 'border-border bg-white hover:border-brand hover:bg-brand-mist/30'}
                  `}
                >
                  <input
                    ref={inputRef}
                    id="partner-import-file-input"
                    type="file"
                    accept={ACCEPT}
                    onChange={(e) => pick(e.target.files?.[0] ?? undefined)}
                    className="sr-only"
                  />
                  {file ? (
                    <div className="flex items-center justify-center gap-3">
                      <FileSpreadsheet className="w-6 h-6 text-success" strokeWidth={1.75} />
                      <div className="text-left">
                        <p className="text-sm font-semibold text-ink">{file.name}</p>
                        <p className="text-xs text-muted font-body">
                          {(file.size / 1024).toFixed(1)} KB · click to replace
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Upload className="w-7 h-7 text-muted mx-auto" strokeWidth={1.75} />
                      <p className="text-sm font-semibold text-ink mt-2">
                        Drop your .xlsx here or click to browse
                      </p>
                      <p className="text-xs text-muted font-body mt-0.5">
                        .xlsx or .xls, up to 10 MB
                      </p>
                    </div>
                  )}
                </label>
              </div>
            </div>
          </section>

          {/* Live progress */}
          {job && jobActive && (
            <section className="rounded-lg border border-border overflow-hidden bg-white">
              <div className="flex items-center gap-3 px-4 py-3 bg-brand-mist/40 border-b border-border">
                <Loader2 className="w-5 h-5 text-brand animate-spin flex-shrink-0" strokeWidth={1.75} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">
                    {statusLabel(job.status)} · {job.filename}
                  </p>
                  <p className="text-[11px] text-muted font-body">
                    {job.total == null
                      ? 'Parsing spreadsheet…'
                      : `${job.processed} / ${job.total} rows`}
                  </p>
                </div>
                <span className="text-xs font-semibold font-mono text-ink">{pct}%</span>
              </div>
              <div className="px-4 py-3">
                <div className="w-full h-2 rounded-full bg-surface-linen overflow-hidden">
                  <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[11px] text-muted font-body mt-2">
                  Safe to close this modal — the import keeps running on the server. Reopen to check progress.
                </p>
              </div>
            </section>
          )}

          {/* Job failure */}
          {job && jobFailed && (
            <section className="rounded-lg border-2 border-danger bg-danger-bg/40 px-4 py-3 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" strokeWidth={1.75} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-danger">
                  {job.status === 'interrupted' ? 'This import was interrupted before finishing' : 'Import failed'}
                </p>
                <p className="text-xs font-body text-danger mt-0.5 break-words">
                  {job.error_message ?? 'Unknown error.'}
                </p>
                {job.status === 'interrupted' && (
                  <p className="text-[11px] font-body text-danger/80 mt-1">
                    Some rows may already have landed — check your product list before re-uploading.
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Cooldown */}
          {isCoolingDown && (
            <section className="rounded-lg border-2 border-amber bg-amber-mist/40 px-4 py-3 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-deep flex-shrink-0 mt-0.5" strokeWidth={1.75} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-deep">
                  Hang on {cooldownSecondsLeft} more second{cooldownSecondsLeft === 1 ? '' : 's'} before retrying
                </p>
                <p className="text-xs font-body text-amber-deep/80 mt-0.5">
                  The last attempt errored out before the server could enqueue the job.
                </p>
              </div>
            </section>
          )}

          {/* Report */}
          {report && (
            <section className="rounded-lg border border-border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-surface-cream border-b border-border">
                <div>
                  <h3 className="text-sm font-semibold text-ink">Import complete</h3>
                  <p className="text-xs text-muted font-body mt-0.5">
                    {report.created} created · {report.failed} failed · {report.total} total rows.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-success-bg text-success">
                    <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                    {report.created}
                  </span>
                  {(report.duplicates ?? 0) > 0 && (
                    <span
                      title="Skipped as duplicate of an existing product in your store"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-mist text-amber-deep border border-amber/40"
                    >
                      <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
                      {report.duplicates}
                    </span>
                  )}
                  {report.failed > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-danger-bg text-danger">
                      <AlertCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
                      {report.failed}
                    </span>
                  )}
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white sticky top-0">
                    <tr>
                      <th className="text-left text-xs font-semibold text-gray uppercase px-3 py-2">Row</th>
                      <th className="text-left text-xs font-semibold text-gray uppercase px-3 py-2">Key</th>
                      <th className="text-left text-xs font-semibold text-gray uppercase px-3 py-2">Status</th>
                      <th className="text-left text-xs font-semibold text-gray uppercase px-3 py-2">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.results.map((r) => (
                      <tr key={`${r.row}-${r.product_key}`} className="border-t border-border">
                        <td className="px-3 py-2 text-ink font-mono text-xs">{r.row}</td>
                        <td className="px-3 py-2 text-ink font-mono text-xs">{r.product_key || '—'}</td>
                        <td className="px-3 py-2">
                          {r.status === 'created' ? (
                            <span className="inline-flex items-center gap-1 text-success font-semibold text-xs">
                              <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                              Created
                            </span>
                          ) : r.status === 'duplicate' ? (
                            <span className="inline-flex items-center gap-1 text-amber-deep font-semibold text-xs">
                              <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
                              Duplicate
                            </span>
                          ) : r.status === 'error' ? (
                            <span className="inline-flex items-center gap-1 text-danger font-semibold text-xs">
                              <AlertCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
                              Error
                            </span>
                          ) : (
                            <span className="text-muted text-xs">Skipped</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink">
                          {r.status === 'created'
                            ? `${r.productName} · ${r.variantCount} variants`
                            : r.error ?? ''}
                          {r.warnings && r.warnings.length > 0 && (
                            <div className="mt-1 text-[11px] text-amber font-body">
                              {r.warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {(report.pending ?? 0) > 0 && (
                <div className="border-t border-border bg-amber-mist/40 px-4 py-3">
                  <p className="text-xs font-semibold text-amber-deep">
                    {report.pending} row{report.pending === 1 ? '' : 's'} queued for review
                  </p>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border">
          <p className="text-xs text-muted font-body flex-1 min-w-0">
            Categories, subcategories and product types must already exist in Cesto — ask your admin if you need one added.
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={close}
              className="h-11 px-5 rounded-xl text-sm font-semibold border-2 border-border text-gray hover:bg-surface-linen transition-colors whitespace-nowrap"
            >
              {report ? 'Done' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={runImport}
              disabled={!file || importMutation.isPending || jobActive || isCoolingDown}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl text-sm font-semibold bg-brand text-white hover:bg-brand-mid disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              {(importMutation.isPending || jobActive) && (
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
              )}
              {importMutation.isPending
                ? 'Uploading…'
                : jobActive
                  ? statusLabel(job!.status)
                  : isCoolingDown
                    ? `Wait ${cooldownSecondsLeft}s…`
                    : isRunAgain
                      ? 'Run again'
                      : 'Run import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
