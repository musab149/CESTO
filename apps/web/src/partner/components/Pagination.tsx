import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';

/**
 * Numbered page nav for admin list views. Shows first + last + a sliding
 * window around the current page + ellipses when the range is too wide to
 * render every page. Prev/next arrows disable at the boundaries.
 *
 * Callers own the `page` state (typically kept in URL search params so
 * links + browser back work). This component is stateless.
 *
 * Behaviour:
 *   - Renders the "Showing X–Y of Z" summary whenever totalItems + pageSize
 *     are provided, even when everything fits on one page. Callers get a
 *     visible signal that the list is paginated, not a blank space.
 *   - Skips the number buttons when totalPages <= 1 (nothing to click).
 *   - Returns null entirely when there is no summary AND only one page.
 */
interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
  /** Include the "N of M" summary on the left. Defaults to true. */
  showSummary?: boolean;
  /** Total row count for the "Showing X–Y of Z" line. If undefined, hides the summary. */
  totalItems?: number;
  /** Per-page size, used to compute the visible range in the summary. */
  pageSize?: number;
}

export default function Pagination({
  page,
  totalPages,
  onPageChange,
  className = '',
  showSummary = true,
  totalItems,
  pageSize,
}: PaginationProps) {
  const hasSummary = showSummary && totalItems != null && pageSize != null;
  const showButtons = totalPages > 1;
  if (!hasSummary && !showButtons) return null;

  const numbers = showButtons ? buildPageList(page, totalPages) : [];
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <nav
      className={`flex flex-col sm:flex-row items-center justify-between gap-3 ${className}`}
      aria-label="Pagination"
    >
      {showSummary && totalItems != null && pageSize != null && (
        <p className="text-xs text-muted font-body">
          Showing{' '}
          <span className="font-semibold text-ink">
            {Math.min((page - 1) * pageSize + 1, totalItems)}–{Math.min(page * pageSize, totalItems)}
          </span>{' '}
          of <span className="font-semibold text-ink">{totalItems}</span>
        </p>
      )}
      <div className="flex items-center gap-1">
        <PageButton
          onClick={() => canPrev && onPageChange(page - 1)}
          disabled={!canPrev}
          ariaLabel="Previous page"
        >
          <ChevronLeft size={14} strokeWidth={2} />
        </PageButton>

        {numbers.map((n, i) =>
          n === '…' ? (
            <span
              key={`ellipsis-${i}`}
              className="w-9 h-9 flex items-center justify-center text-muted"
              aria-hidden
            >
              <MoreHorizontal size={14} strokeWidth={2} />
            </span>
          ) : (
            <PageButton
              key={n}
              onClick={() => onPageChange(n)}
              active={n === page}
              ariaLabel={`Page ${n}`}
              ariaCurrent={n === page ? 'page' : undefined}
            >
              {n}
            </PageButton>
          ),
        )}

        <PageButton
          onClick={() => canNext && onPageChange(page + 1)}
          disabled={!canNext}
          ariaLabel="Next page"
        >
          <ChevronRight size={14} strokeWidth={2} />
        </PageButton>
      </div>
    </nav>
  );
}

function PageButton({
  children,
  onClick,
  active = false,
  disabled = false,
  ariaLabel,
  ariaCurrent,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  ariaCurrent?: 'page' | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-current={ariaCurrent}
      className={`w-9 h-9 rounded-lg text-sm font-display font-semibold transition-colors flex items-center justify-center
        ${active
          ? 'bg-brand text-white cursor-default'
          : disabled
            ? 'text-muted/50 cursor-not-allowed'
            : 'text-ink hover:bg-surface-cream'
        }`}
    >
      {children}
    </button>
  );
}

/**
 * Compact the full range of pages into a display list with ellipses.
 *   1..totalPages when short (<=7)
 *   1 … [current-1] current [current+1] … totalPages when wide
 * Always includes 1 and totalPages so the user can jump to either end.
 */
function buildPageList(current: number, totalPages: number): Array<number | '…'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const result: Array<number | '…'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(totalPages - 1, current + 1);
  if (start > 2) result.push('…');
  for (let i = start; i <= end; i++) result.push(i);
  if (end < totalPages - 1) result.push('…');
  result.push(totalPages);
  return result;
}
