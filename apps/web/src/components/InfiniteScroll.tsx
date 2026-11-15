import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * Auto-loading footer for paginated customer lists — categories, search,
 * storefronts, favourites, order history.
 *
 * Replaces the "Load more" button this file used to render. The next page now
 * arrives on scroll, matching the All-products grid on the home page, which
 * was the only list that already worked this way.
 *
 * The observer starts the fetch 600px before the sentinel reaches the
 * viewport, so a fast scroll meets rows that are already there instead of
 * stopping at a spinner on every page boundary.
 */
interface InfiniteScrollProps {
  hasMore: boolean;
  /** The infinite query's isFetchingNextPage. */
  isLoading: boolean;
  /** The infinite query's fetchNextPage. */
  onLoadMore: () => void;
  className?: string;
  /**
   * Rendered while the next page is in flight. Pass the same skeleton grid the
   * list uses so incoming rows appear where they will actually land — a
   * centred spinner shifts the layout when the row replaces it. Falls back to
   * a spinner when the caller has no grid to mirror.
   */
  skeleton?: ReactNode;
  /** Empty string hides the end-of-list line entirely. */
  endLabel?: string;
  /** How early to prefetch. Raise it for tall rows, lower it for dense grids. */
  rootMargin?: string;
}

export default function InfiniteScroll({
  hasMore,
  isLoading,
  onLoadMore,
  className = '',
  skeleton,
  endLabel,
  rootMargin = '600px 0px',
}: InfiniteScrollProps) {
  const { lang } = useLanguageStore();
  const sentinel = useRef<HTMLDivElement>(null);

  // Without IntersectionObserver there is no scroll trigger, and the list
  // would simply dead-end at page one with no way forward. Rare enough to be
  // a fallback rather than the main path, but silently losing the rest of the
  // catalogue is not an acceptable degradation.
  const [observerSupported, setObserverSupported] = useState(true);
  useEffect(() => {
    setObserverSupported(typeof IntersectionObserver !== 'undefined');
  }, []);

  // Held in a ref so the observer effect does not depend on the callback's
  // identity. Several callers pass an inline arrow, which is a new function
  // every render — as a dependency that would tear down and re-create the
  // observer on each one, and re-observing an already-intersecting sentinel
  // re-fires immediately.
  const loadMoreRef = useRef(onLoadMore);
  useEffect(() => { loadMoreRef.current = onLoadMore; }, [onLoadMore]);

  // Rebuilt when the flags change, because the callback closes over them —
  // a stale closure here is the classic infinite-scroll bug where the first
  // page loads and nothing ever follows it.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || isLoading || !observerSupported) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadMoreRef.current(); },
      { rootMargin },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasMore, isLoading, rootMargin, observerSupported]);

  return (
    <div className={className}>
      {isLoading && (
        <div role="status" aria-live="polite">
          <span className="sr-only">{lang === 'en' ? 'Loading more' : 'Cargando más'}</span>
          {skeleton ?? (
            <div className="flex justify-center py-6">
              <Loader2 size={20} strokeWidth={2.5} className="animate-spin text-brand" aria-hidden />
            </div>
          )}
        </div>
      )}

      {/* Zero-height and aria-hidden: it is a scroll tripwire, not content. */}
      <div ref={sentinel} aria-hidden className="h-px" />

      {/* Keyboard and no-observer escape hatch. Hidden while the observer is
          doing its job, so the normal experience stays button-free. */}
      {hasMore && !isLoading && !observerSupported && (
        <div className="flex justify-center py-6">
          <button
            type="button"
            onClick={onLoadMore}
            className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-card border-2 border-border hover:border-brand hover:bg-brand-mist/40 text-ink font-bold font-ui text-sm transition-colors"
          >
            {lang === 'en' ? 'Load more' : 'Cargar más'}
          </button>
        </div>
      )}

      {!hasMore && (() => {
        const text = endLabel ?? (lang === 'en' ? "You've reached the end" : 'Has llegado al final');
        return text ? (
          <p className="text-center text-sm text-muted font-body py-6">{text}</p>
        ) : null;
      })()}
    </div>
  );
}
