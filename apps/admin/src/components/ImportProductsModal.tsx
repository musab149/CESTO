import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Upload, Download, FileSpreadsheet, X, CheckCircle2, AlertCircle, Loader2, Sparkles, Copy,
} from 'lucide-react';
import {
  adminProducts,
  ApiError,
  useImportProducts,
  useImportJob,
  type BulkImportResult,
  type ImportJob,
} from '@grocery-app/shared';
import { useToast } from './Toast';

/**
 * Seconds we lock out the Run Import button after any client-side enqueue
 * failure (network drop, 5xx, etc.). The server-side job model handles the
 * "did the actual import finish?" case on its own — we still want a small
 * cooldown so a panicky admin doesn't hammer the button before the polling
 * hook has a chance to surface the current state.
 */
const ERROR_COOLDOWN_SECONDS = 30;

interface Props {
  open: boolean;
  onClose: () => void;
}

const ACCEPT = '.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

function statusLabel(status: ImportJob['status']): string {
  switch (status) {
    case 'queued':      return 'Queued…';
    case 'running':     return 'Importing…';
    case 'done':        return 'Done';
    case 'failed':      return 'Failed';
    case 'interrupted': return 'Interrupted';
    default:            return status;
  }
}

export default function ImportProductsModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // The job id we're tracking. Set by the mutation, cleared by reset(). While
  // this is non-null the polling hook fetches job state every ~1s until the
  // job hits a terminal status.
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  // Guards against firing the "done" toasts twice — the poll can re-emit the
  // same terminal job on subsequent renders.
  const [terminalToastFired, setTerminalToastFired] = useState(false);
  // Cooldown for the Run Import button after an enqueue-time error.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [, setNowTick] = useState(0);

  useEffect(() => {
    if (!cooldownUntil) return;
    const id = window.setInterval(() => {
      setNowTick((n) => n + 1);
      if (Date.now() >= cooldownUntil) {
        setCooldownUntil(null);
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const cooldownSecondsLeft = cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
    : 0;
  const isCoolingDown = cooldownSecondsLeft > 0;

  const importMutation = useImportProducts();
  const jobQuery = useImportJob(activeJobId);
  const job = jobQuery.data ?? null;
  const jobActive = job?.status === 'queued' || job?.status === 'running';
  const jobFailed = job?.status === 'failed' || job?.status === 'interrupted';
  const report: BulkImportResult | null = job?.status === 'done' ? job.result ?? null : null;

  // Fire the outcome toasts once when a job reaches a terminal state. Guarded
  // by `terminalToastFired` so the ~1s poll doesn't retrigger them each tick.
  useEffect(() => {
    if (!job || terminalToastFired) return;
    if (job.status === 'done' && report) {
      if (report.created > 0) {
        toast.success(
          t('productImport.toastSuccessTitle'),
          t('productImport.toastSuccessBody', { count: report.created }),
        );
      }
      if (report.failed > 0) {
        toast.warning(
          t('productImport.toastPartialTitle'),
          t('productImport.toastPartialBody', { count: report.failed }),
        );
      }
      if ((report.pending ?? 0) > 0) {
        toast.warning(
          'Products queued for review',
          `${report.pending} product(s) referenced categories that don't exist yet. They'll appear for publishing once you create the matching category on the Categories page.`,
        );
      }
      if ((report.duplicates ?? 0) > 0) {
        toast.warning(
          `${report.duplicates} duplicate${report.duplicates === 1 ? '' : 's'} skipped`,
          'Rows with a name + brand that already exists (in the catalogue OR the pending queue) were skipped to avoid doubling up. See the report table below to review.',
        );
      }
      setTerminalToastFired(true);
    } else if (jobFailed) {
      toast.error(
        job.status === 'interrupted' ? 'Import was interrupted' : t('productImport.toastFailedTitle'),
        job.error_message ?? t('productImport.toastFailedBody'),
      );
      setTerminalToastFired(true);
    }
  }, [job, report, jobFailed, terminalToastFired, toast, t]);

  function reset() {
    setFile(null);
    setActiveJobId(null);
    setTerminalToastFired(false);
    setCooldownUntil(null);
    importMutation.reset();
    if (inputRef.current) inputRef.current.value = '';
  }

  function close() {
    // Don't wipe an in-flight job — the admin might want to reopen and check
    // it. We just clear the FILE picker so the next open starts clean, but
    // preserve the polled job state so the modal can resume showing it. If
    // the job is terminal we do a full reset.
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
    // New file picked — abandon the previous job context so the report/error
    // from the prior run doesn't confuse the new one.
    setFile(f);
    setActiveJobId(null);
    setTerminalToastFired(false);
    importMutation.reset();
  }

  async function downloadTemplate() {
    try {
      await adminProducts.downloadTemplate();
    } catch (err) {
      toast.error(
        t('productImport.toastDownloadFailedTitle'),
        err instanceof Error ? err.message : t('productImport.toastDownloadFailedBody'),
      );
    }
  }

  async function runImport() {
    if (!file) return;
    try {
      const res = await importMutation.mutateAsync(file);
      setActiveJobId(res.jobId);
      setTerminalToastFired(false);
      if (res.replay) {
        toast.info?.(
          'Showing the previous report for this file',
          "The same file was already imported successfully in the last hour — pulling that job's report instead of re-inserting rows.",
        );
      } else if (res.alreadyRunning) {
        toast.info?.(
          'An import is already running',
          'Your previous import is still finishing — switching to its live progress here.',
        );
      }
    } catch (err) {
      // Enqueue-time failures: network dropped, server 5xx, etc. The actual
      // long-running work never even started, so a cooldown here just prevents
      // a rapid-fire retry storm.
      const isTimeout = err instanceof ApiError && err.status === 408;
      if (isTimeout) {
        toast.warning(
          'Enqueue timed out — check recent imports',
          'The upload itself timed out before the server could enqueue the job. It may still have started — reopen this modal in a few seconds or check the Products list before retrying.',
        );
      } else {
        toast.error(
          t('productImport.toastFailedTitle'),
          err instanceof Error ? err.message : t('productImport.toastFailedBody'),
        );
      }
      setCooldownUntil(Date.now() + ERROR_COOLDOWN_SECONDS * 1000);
    }
  }

  if (!open) return null;

  // Progress percentage for the bar. `total` is null while the workbook is
  // still being parsed on the server — show an indeterminate state via 0%.
  const pct = job && job.total ? Math.min(100, Math.round((job.processed / job.total) * 100)) : 0;
  const isRunAgain = !!report || jobFailed;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={close}
    >
      <div
        className="bg-card rounded-2xl shadow-modal w-full max-w-2xl max-h-[90vh] flex flex-col"
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
                {t('productImport.title')}
              </h2>
              <p className="text-xs text-muted font-body">
                {t('productImport.subtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="w-9 h-9 rounded-lg hover:bg-surface-cream flex items-center justify-center transition"
            aria-label={t('productImport.close')}
          >
            <X className="w-5 h-5 text-ink" strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Step 1: Download template */}
          <section className="bg-surface-cream rounded-lg border border-border p-4">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center font-bold font-display text-xs flex-shrink-0">
                1
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold font-display text-ink">
                  {t('productImport.step1Title')}
                </h3>
                <p className="text-xs text-muted font-body mt-0.5">
                  {t('productImport.step1Body')}
                </p>
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="mt-3 inline-flex items-center gap-2 bg-card border border-border hover:bg-brand-mist text-ink font-semibold font-display text-sm px-4 h-10 rounded-lg transition"
                >
                  <Download className="w-4 h-4" strokeWidth={1.75} />
                  {t('productImport.downloadTemplate')}
                </button>
              </div>
            </div>
          </section>

          {/* Step 2: Drop zone */}
          <section className="bg-surface-cream rounded-lg border border-border p-4">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-brand text-white flex items-center justify-center font-bold font-display text-xs flex-shrink-0">
                2
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold font-display text-ink">
                  {t('productImport.step2Title')}
                </h3>
                <p className="text-xs text-muted font-body mt-0.5">
                  {t('productImport.step2Body')}
                </p>

                <label
                  htmlFor="import-file-input"
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
                        : 'border-border bg-card hover:border-brand hover:bg-brand-mist/30'}
                  `}
                >
                  <input
                    ref={inputRef}
                    id="import-file-input"
                    type="file"
                    accept={ACCEPT}
                    onChange={(e) => pick(e.target.files?.[0] ?? undefined)}
                    className="sr-only"
                  />
                  {file ? (
                    <div className="flex items-center justify-center gap-3">
                      <FileSpreadsheet className="w-6 h-6 text-success" strokeWidth={1.75} />
                      <div className="text-left">
                        <p className="text-sm font-semibold font-display text-ink">{file.name}</p>
                        <p className="text-xs text-muted font-body">
                          {(file.size / 1024).toFixed(1)} KB · {t('productImport.clickToReplace')}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Upload className="w-7 h-7 text-muted mx-auto" strokeWidth={1.75} />
                      <p className="text-sm font-semibold font-display text-ink mt-2">
                        {t('productImport.dropOrClick')}
                      </p>
                      <p className="text-xs text-muted font-body mt-0.5">
                        {t('productImport.acceptedTypes')}
                      </p>
                    </div>
                  )}
                </label>
              </div>
            </div>
          </section>

          {/* Live progress — visible while the job is queued or running. The
              backend polls sub-1s intervals so this feels responsive. */}
          {job && jobActive && (
            <section className="rounded-lg border border-border overflow-hidden bg-card">
              <div className="flex items-center gap-3 px-4 py-3 bg-brand-mist/40 border-b border-border">
                <Loader2 className="w-5 h-5 text-brand animate-spin flex-shrink-0" strokeWidth={1.75} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold font-display text-ink truncate">
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
                  <div
                    className="h-full bg-brand transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[11px] text-muted font-body mt-2">
                  Safe to close this modal — the import keeps running on the server. Reopen anytime to check progress or see the report.
                </p>
              </div>
            </section>
          )}

          {/* Job-level failure state (parse error, missing columns, server
              restart). Distinct from per-row errors, which live inside the
              results table below. */}
          {job && jobFailed && (
            <section className="rounded-lg border-2 border-danger bg-danger-bg/40 px-4 py-3 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" strokeWidth={1.75} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold font-display text-danger">
                  {job.status === 'interrupted'
                    ? 'This import was interrupted before finishing'
                    : 'Import failed'}
                </p>
                <p className="text-xs font-body text-danger mt-0.5 break-words">
                  {job.error_message ?? 'Unknown error.'}
                </p>
                {job.status === 'interrupted' && (
                  <p className="text-[11px] font-body text-danger/80 mt-1">
                    Some rows may already have landed — check the Products list before re-uploading the whole sheet.
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Cooldown banner — enqueue-side failures only. */}
          {isCoolingDown && (
            <section className="rounded-lg border-2 border-amber bg-amber-mist/40 px-4 py-3 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-deep flex-shrink-0 mt-0.5" strokeWidth={1.75} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold font-display text-amber-deep">
                  Hang on {cooldownSecondsLeft} more second{cooldownSecondsLeft === 1 ? '' : 's'} before retrying
                </p>
                <p className="text-xs font-body text-amber-deep/80 mt-0.5">
                  The last attempt errored out before the server could enqueue the job. Check the Products list in a new tab before you retry — some rows may still have landed.
                </p>
              </div>
            </section>
          )}

          {/* Step 3 — results report (only for done jobs) */}
          {report && (
            <section className="rounded-lg border border-border overflow-hidden">
              {/* Summary band */}
              <div className="flex items-center justify-between px-4 py-3 bg-surface-cream border-b border-border">
                <div>
                  <h3 className="text-sm font-semibold font-display text-ink">
                    {t('productImport.reportTitle')}
                  </h3>
                  <p className="text-xs text-muted font-body mt-0.5">
                    {t('productImport.reportSummary', {
                      created: report.created,
                      failed: report.failed,
                      total: report.total,
                    })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold font-display bg-success-bg text-success">
                    <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                    {report.created}
                  </span>
                  {(report.pending ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold font-display bg-amber-mist text-amber">
                      <Sparkles className="w-3.5 h-3.5" strokeWidth={1.75} />
                      {report.pending}
                    </span>
                  )}
                  {(report.duplicates ?? 0) > 0 && (
                    <span
                      title="Skipped as duplicate of an existing product / pending row"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold font-display bg-amber-mist text-amber-deep border border-amber/40"
                    >
                      <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
                      {report.duplicates}
                    </span>
                  )}
                  {report.failed > 0 && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold font-display bg-danger-bg text-danger">
                      <AlertCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
                      {report.failed}
                    </span>
                  )}
                </div>
              </div>

              {/* Per-row table */}
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-card sticky top-0">
                    <tr>
                      <th className="text-left text-xs font-semibold text-gray uppercase px-3 py-2 font-display">{t('productImport.col.row')}</th>
                      <th className="text-left text-xs font-semibold text-gray uppercase px-3 py-2 font-display">{t('productImport.col.product_key')}</th>
                      <th className="text-left text-xs font-semibold text-gray uppercase px-3 py-2 font-display">{t('productImport.col.status')}</th>
                      <th className="text-left text-xs font-semibold text-gray uppercase px-3 py-2 font-display">{t('productImport.col.detail')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.results.map((r) => (
                      <tr key={`${r.row}-${r.product_key}`} className="border-t border-border">
                        <td className="px-3 py-2 text-ink font-mono text-xs">{r.row}</td>
                        <td className="px-3 py-2 text-ink font-mono text-xs">{r.product_key || '—'}</td>
                        <td className="px-3 py-2">
                          {r.status === 'created' ? (
                            <span className="inline-flex items-center gap-1 text-success font-semibold font-display text-xs">
                              <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={1.75} />
                              {t('productImport.statusCreated')}
                            </span>
                          ) : r.status === 'pending_category' ? (
                            <span className="inline-flex items-center gap-1 text-amber font-semibold font-display text-xs">
                              <Sparkles className="w-3.5 h-3.5" strokeWidth={1.75} />
                              Queued
                            </span>
                          ) : r.status === 'duplicate' ? (
                            <span className="inline-flex items-center gap-1 text-amber-deep font-semibold font-display text-xs">
                              <Copy className="w-3.5 h-3.5" strokeWidth={1.75} />
                              Duplicate
                            </span>
                          ) : r.status === 'error' ? (
                            <span className="inline-flex items-center gap-1 text-danger font-semibold font-display text-xs">
                              <AlertCircle className="w-3.5 h-3.5" strokeWidth={1.75} />
                              {t('productImport.statusError')}
                            </span>
                          ) : (
                            <span className="text-muted text-xs">{t('productImport.statusSkipped')}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink">
                          {r.status === 'created'
                            ? `${r.productName} · ${r.variantCount} ${t('productImport.variants')}`
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

              {/* Unknown brands / origins nudge — shown when the sheet used
                  values that aren't in the curated Home Sections lists yet.
                  Purely advisory: imports still succeeded and products carry
                  the string as-is; adding them promotes them into the admin
                  product-form dropdowns and the customer marquees. */}
              {report.unknownBrands && report.unknownBrands.length > 0 && (
                <div className="border-t border-border bg-amber-mist/40 px-4 py-3">
                  <p className="text-xs font-semibold font-display text-amber-deep">
                    {report.unknownBrands.length} new brand{report.unknownBrands.length === 1 ? '' : 's'} auto-created as inactive
                  </p>
                  <p className="text-[11px] font-body text-amber-deep/80 mt-0.5">
                    Products imported fine. The importer added these to your <span className="font-semibold">Brands</span> page as inactive rows — review, add a logo, and toggle active to feature them on the customer rail.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {report.unknownBrands.map((b) => (
                      <span
                        key={b.name}
                        className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-card border border-border text-[11px] font-semibold font-display text-ink"
                      >
                        {b.name}
                        <span className="text-[11px] text-muted font-mono">{b.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {report.unknownOrigins && report.unknownOrigins.length > 0 && (
                <div className="border-t border-border bg-amber-mist/40 px-4 py-3">
                  <p className="text-xs font-semibold font-display text-amber-deep">
                    {report.unknownOrigins.length} new origin{report.unknownOrigins.length === 1 ? '' : 's'} auto-created as inactive
                  </p>
                  <p className="text-[11px] font-body text-amber-deep/80 mt-0.5">
                    Products imported fine. The importer added these to your <span className="font-semibold">Origins</span> page as inactive rows — review, add labels/colours, and toggle active to feature them on the customer rail.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {report.unknownOrigins.map((o) => (
                      <span
                        key={o.name}
                        className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-card border border-border text-[11px] font-semibold font-display text-ink"
                      >
                        {o.name}
                        <span className="text-[11px] text-muted font-mono">{o.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {report.unknownStores && report.unknownStores.length > 0 && (
                <div className="border-t border-border bg-amber-mist/40 px-4 py-3">
                  <p className="text-xs font-semibold font-display text-amber-deep">
                    {report.unknownStores.length} new store{report.unknownStores.length === 1 ? '' : 's'} auto-created as inactive
                  </p>
                  <p className="text-[11px] font-body text-amber-deep/80 mt-0.5">
                    Products were still imported and FK-linked. The importer added these to your <span className="font-semibold">Stores</span> page as inactive rows — click <span className="font-semibold">Review &amp; create</span> to add a logo, cover, hours, and toggle active to publish each storefront.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {report.unknownStores.map((s) => (
                      <span
                        key={s.slug}
                        className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-card border border-border text-[11px] font-semibold font-display text-ink"
                      >
                        {s.name}
                        <span className="text-[11px] text-muted font-mono">{s.slug}</span>
                        <span className="text-[11px] text-muted font-mono">×{s.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {report.unknownSubcategories && report.unknownSubcategories.length > 0 && (
                <div className="border-t border-border bg-amber-mist/40 px-4 py-3">
                  <p className="text-xs font-semibold font-display text-amber-deep">
                    {report.unknownSubcategories.length} new subcategor{report.unknownSubcategories.length === 1 ? 'y' : 'ies'} auto-created as inactive
                  </p>
                  <p className="text-[11px] font-body text-amber-deep/80 mt-0.5">
                    Products imported and FK-linked. The importer added these to your <span className="font-semibold">Categories</span> page under the parent category as inactive rows — activate them there to make them selectable on new products.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {report.unknownSubcategories.map((s) => (
                      <span
                        key={`${s.category_id}::${s.name}`}
                        className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-card border border-border text-[11px] font-semibold font-display text-ink"
                      >
                        {s.name}
                        <span className="text-[11px] text-muted font-mono">×{s.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {report.unknownProductTypes && report.unknownProductTypes.length > 0 && (
                <div className="border-t border-border bg-amber-mist/40 px-4 py-3">
                  <p className="text-xs font-semibold font-display text-amber-deep">
                    {report.unknownProductTypes.length} new product type{report.unknownProductTypes.length === 1 ? '' : 's'} auto-created as inactive
                  </p>
                  <p className="text-[11px] font-body text-amber-deep/80 mt-0.5">
                    Products imported and FK-linked. Product types sit under their parent subcategory on your <span className="font-semibold">Categories</span> page — activate each one there to make it selectable on new products.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {report.unknownProductTypes.map((pt) => (
                      <span
                        key={`${pt.subcategory_id}::${pt.name}`}
                        className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-card border border-border text-[11px] font-semibold font-display text-ink"
                      >
                        {pt.name}
                        <span className="text-[11px] text-muted font-mono">×{pt.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border">
          <p className="text-xs text-muted font-body">
            {t('productImport.footerNote')}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={close}
              className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors"
            >
              {report ? t('productImport.done') : t('productImport.cancel')}
            </button>
            <button
              type="button"
              onClick={runImport}
              disabled={!file || importMutation.isPending || jobActive || isCoolingDown}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl text-sm font-semibold font-display bg-brand text-white hover:bg-brand-mid disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {(importMutation.isPending || jobActive) && (
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
              )}
              {importMutation.isPending
                ? t('productImport.uploading')
                : jobActive
                  ? statusLabel(job!.status)
                  : isCoolingDown
                    ? `Wait ${cooldownSecondsLeft}s…`
                    : isRunAgain
                      ? t('productImport.runAgain')
                      : t('productImport.runImport')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
