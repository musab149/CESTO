import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, CheckCircle2, X } from 'lucide-react';
import type { ArchiveFilters } from '@grocery-app/shared';
import { buildBillLabels } from '@/lib/billLabels';
import { downloadDocumentsZip, type ZipProgress, type ZipResult } from '@/lib/documentZip';

const dayLabel = (iso: string, lang: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(
  lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' },
);

/**
 * Everything the filters show, as one ZIP. Says first what it is about to fetch,
 * then how far it has got; a long range takes minutes and can be stopped.
 */
export default function BulkDownloadModal({
  filters, count, onClose,
}: {
  filters: ArchiveFilters;
  count: number;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [phase, setPhase] = useState<'ready' | 'working' | 'done' | 'failed'>('ready');
  const [progress, setProgress] = useState<ZipProgress>({ done: 0, total: count });
  const [result, setResult] = useState<ZipResult | null>(null);
  const [failure, setFailure] = useState('');
  const stop = useRef(false);

  // Leaving the page mid-way stops the work rather than leaving it running blind.
  useEffect(() => () => { stop.current = true; }, []);

  const start = async () => {
    stop.current = false;
    setPhase('working');
    try {
      const outcome = await downloadDocumentsZip({
        filters,
        billLabels: buildBillLabels(t),
        lang: i18n.language,
        onProgress: setProgress,
        shouldStop: () => stop.current,
      });
      if (outcome.stopped) { onClose(); return; }
      setResult(outcome);
      setPhase('done');
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
      setPhase('failed');
    }
  };

  const { from, to, q } = filters;
  const range = from && to
    ? t('documents.bulk.range', { from: dayLabel(from, i18n.language), to: dayLabel(to, i18n.language) })
    : from
      ? t('documents.bulk.rangeFrom', { from: dayLabel(from, i18n.language) })
      : to
        ? t('documents.bulk.rangeTo', { to: dayLabel(to, i18n.language) })
        : t('documents.bulk.rangeAll');

  const working = phase === 'working';
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const button = 'h-11 sm:h-10 w-full sm:w-auto px-5 rounded-xl text-sm font-semibold font-display transition-colors';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
      onClick={working ? undefined : onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-title"
        className="bg-card rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] w-full sm:max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 id="bulk-title" className="text-lg font-bold font-display text-ink">
            {phase === 'done' ? t('documents.bulk.doneTitle') : t('documents.bulk.title', { count })}
          </h2>
          {!working && (
            <button type="button" onClick={onClose} aria-label={t('documents.bulk.close')} className="w-9 h-9 -mr-1.5 shrink-0 rounded-lg inline-flex items-center justify-center text-muted hover:text-ink transition-colors">
              <X size={18} strokeWidth={1.75} />
            </button>
          )}
        </div>

        {phase === 'ready' && (
          <div className="space-y-3 mb-6 text-sm text-gray">
            <p className="text-ink">{t('documents.bulk.body')}</p>
            <div className="rounded-lg bg-surface-linen px-3 py-2.5 text-[13px] text-ink">
              <p className="font-semibold">{range}</p>
              {q && <p className="text-gray mt-0.5">{t('documents.bulk.search', { q })}</p>}
            </div>
            <p className="text-[13px]">{t('documents.bulk.keepOpen')}</p>
          </div>
        )}

        {working && (
          <div className="mb-6">
            <p className="text-sm text-ink mb-2 tabular-nums">
              {t('documents.bulk.working', { done: Math.min(progress.done + 1, progress.total), total: progress.total })}
            </p>
            <div
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2 rounded-full bg-surface-linen overflow-hidden"
            >
              <div className="h-full bg-brand transition-[width] duration-200" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-[13px] text-gray mt-3">{t('documents.bulk.keepOpen')}</p>
          </div>
        )}

        {phase === 'done' && result && (
          <div className="mb-6 space-y-2 text-sm">
            <p className="flex items-center gap-2 text-ink">
              <CheckCircle2 size={18} strokeWidth={1.75} className="text-success shrink-0" />
              {t('documents.bulk.doneBody', { done: result.done, total: result.total })}
            </p>
            {result.parts > 1 && <p className="text-gray text-[13px]">{t('documents.bulk.doneParts', { parts: result.parts })}</p>}
            {result.skipped.length > 0 && (
              <div className="rounded-lg bg-warning-bg px-3 py-2.5 text-[13px] text-ink">
                <p className="font-semibold">{t('documents.bulk.skipped')}</p>
                <p className="font-mono mt-1 break-words">{result.skipped.join(', ')}</p>
              </div>
            )}
          </div>
        )}

        {phase === 'failed' && (
          <p className="mb-6 rounded-lg bg-danger-bg px-3 py-2.5 text-sm text-danger break-words">
            {t('documents.bulk.failed', { message: failure })}
          </p>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          {working ? (
            <button type="button" onClick={() => { stop.current = true; }} className={`${button} border-2 border-border text-ink hover:bg-surface-linen`}>
              {t('documents.bulk.stop')}
            </button>
          ) : (
            <button type="button" onClick={onClose} className={`${button} border-2 border-border text-ink hover:bg-surface-linen`}>
              {phase === 'ready' ? t('documents.bulk.cancel') : t('documents.bulk.close')}
            </button>
          )}
          {(phase === 'ready' || phase === 'failed') && (
            <button type="button" onClick={() => { void start(); }} className={`${button} bg-brand hover:bg-brand-mid text-white inline-flex items-center justify-center gap-2`}>
              <Archive size={16} strokeWidth={1.75} />
              {t('documents.bulk.start')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
