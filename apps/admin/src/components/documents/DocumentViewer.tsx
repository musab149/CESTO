import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Download, Minus, Plus } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Skeleton } from '@/components/Skeleton';

/** The width a document is drawn at, which 100% means (shared/invoice). */
const A4_WIDTH = 794;
/** An A4 sheet's height for its width. */
const A4_RATIO = 1123 / 794;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;
const STEP = 0.1;
const GUTTER = 32;

/**
 * pdf.js, only when a document is opened: it is far larger than the page around it.
 * Given a copy, because it takes the buffer away to its worker and the same bytes
 * are still needed for the download.
 */
async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs.getDocument({ data: bytes.slice() }).promise;
}

/** One page, redrawn sharply a moment after the zoom settles; CSS scales it until then. */
function PdfPage({ doc, number, width }: { doc: PDFDocumentProxy; number: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [aspect, setAspect] = useState(1123 / 794);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    const timer = setTimeout(() => {
      void doc.getPage(number).then((page) => {
        const node = canvas.current;
        if (cancelled || !node) return undefined;
        const base = page.getViewport({ scale: 1 });
        setAspect(base.height / base.width);
        const density = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: (width / base.width) * density });
        node.width = Math.floor(viewport.width);
        node.height = Math.floor(viewport.height);
        const context = node.getContext('2d');
        if (!context) return undefined;
        task = page.render({ canvasContext: context, viewport });
        return task.promise;
      }).catch(() => undefined); // A cancelled render rejects; the next one replaces it.
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [doc, number, width]);

  return (
    <canvas
      ref={canvas}
      data-pdf-page={number}
      className="block bg-white shadow-md"
      style={{ width, height: width * aspect }}
    />
  );
}

/**
 * Reads a PDF: the file itself, page by page, the same on a phone as on a desk.
 * A browser's own viewer does not embed on most phones, so pdf.js draws it. The
 * paper stays white in the dark theme, because it is the document's own.
 */
export default function DocumentViewer({
  bytes, failed, onRetry, onDownload,
}: {
  /** Null while the file is being fetched or drawn. */
  bytes: Uint8Array | null;
  failed: boolean;
  onRetry: () => void;
  onDownload: () => void;
}) {
  const { t } = useTranslation();
  const desk = useRef<HTMLDivElement>(null);
  const [deskWidth, setDeskWidth] = useState(0);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  /** Null is "fit to the width": it follows the window until somebody zooms. */
  const [zoom, setZoom] = useState<number | null>(null);

  useEffect(() => {
    const node = desk.current;
    if (!node) return undefined;
    const measure = () => setDeskWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!bytes) return undefined;
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    setUnreadable(false);
    openPdf(bytes)
      .then((d) => {
        if (cancelled) { void d.destroy(); return; }
        opened = d;
        setDoc(d);
      })
      .catch(() => { if (!cancelled) setUnreadable(true); });
    return () => {
      cancelled = true;
      setDoc(null);
      if (opened) void opened.destroy();
    };
  }, [bytes]);

  const fit = deskWidth > 0 ? Math.min(1, (deskWidth - GUTTER) / A4_WIDTH) : 1;
  /**
   * One whole A4 page tall at the width it fits (user, 2026-11-07: "the height of
   * pdf viewer should be that of a4 size"): a page is read whole, and the next one
   * scrolls into the same frame. Zooming in scrolls inside it rather than growing it.
   * From lg only: below that the pages simply stack down the screen at full height.
   */
  const pageFrame = Math.round(A4_WIDTH * fit * A4_RATIO) + GUTTER;
  const scale = zoom ?? fit;
  const stepped = (dir: 1 | -1) => setZoom(
    Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((scale + dir * STEP) * 10) / 10)),
  );

  const control = 'w-9 h-9 rounded-lg border border-border text-ink inline-flex items-center justify-center hover:bg-surface-linen transition-colors disabled:opacity-40';
  const broken = failed || unreadable;

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold font-display text-gray mr-auto">
          {doc ? t('documents.viewer.pages', { count: doc.numPages }) : ' '}
        </span>
        <button type="button" onClick={() => stepped(-1)} disabled={scale <= MIN_ZOOM} aria-label={t('documents.viewer.zoomOut')} className={control}>
          <Minus size={16} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => setZoom(null)}
          title={t('documents.viewer.fit')}
          aria-label={t('documents.viewer.fit')}
          className="h-9 min-w-[3.5rem] px-2 rounded-lg border border-border text-xs font-semibold font-display text-ink tabular-nums hover:bg-surface-linen transition-colors"
        >
          {Math.round(scale * 100)}%
        </button>
        <button type="button" onClick={() => stepped(1)} disabled={scale >= MAX_ZOOM} aria-label={t('documents.viewer.zoomIn')} className={control}>
          <Plus size={16} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={!bytes}
          className="h-9 px-3 rounded-lg bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display inline-flex items-center gap-2 transition-colors disabled:opacity-60"
        >
          <Download size={15} strokeWidth={2} />
          {t('documents.download')}
        </button>
      </div>

      <div
        ref={desk}
        className="bg-surface-linen overflow-auto p-4 lg:h-[var(--page-frame)]"
        style={{ '--page-frame': `${pageFrame}px` } as React.CSSProperties}
      >
        {broken ? (
          <div className="py-16 text-center">
            <AlertTriangle size={28} strokeWidth={1.5} className="mx-auto text-warning" />
            <p className="mt-3 text-sm font-semibold font-display text-ink">{t('documents.viewer.failed')}</p>
            <p className="mt-1 text-[13px] text-gray">{t('documents.viewer.failedBody')}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 h-10 px-4 rounded-xl border-2 border-border text-sm font-semibold font-display text-ink hover:bg-card transition-colors"
            >
              {t('documents.retry')}
            </button>
          </div>
        ) : doc ? (
          <div className="mx-auto flex flex-col gap-4" style={{ width: A4_WIDTH * scale }}>
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage key={i} doc={doc} number={i + 1} width={A4_WIDTH * scale} />
            ))}
          </div>
        ) : (
          <Skeleton className="mx-auto h-[70vh] max-w-full rounded-sm" />
        )}
      </div>
    </div>
  );
}
