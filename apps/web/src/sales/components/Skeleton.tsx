/**
 * Admin's shimmer primitives, ported.
 *
 * Verbatim from apps/admin/src/components/Skeleton.tsx. A third copy of this
 * file now exists in the repo — admin's, partner's, and this one — because
 * apps/admin and apps/web are separate Vite apps and a cross-app import is not
 * a plain import. If a fourth role surface appears, lift these into
 * @grocery-app/shared instead of copying again.
 *
 * The `.skeleton` class itself is scoped to `.sales-app` in app.css so it
 * shimmers in admin's warm grey at admin's radius, rather than the customer
 * app's green-tinted, heavily rounded version.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-card rounded-2xl border border-border/80 shadow-card overflow-hidden">
      <div className="grid gap-px bg-border" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: cols }).map((_, i) => (
          <div key={`h-${i}`} className="bg-surface-cream px-4 py-3">
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
        {Array.from({ length: rows * cols }).map((_, i) => (
          <div key={`c-${i}`} className="bg-card px-4 py-3">
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function MetricCardSkeleton() {
  return (
    <div className="bg-card rounded-2xl border border-border/80 shadow-card p-6">
      <Skeleton className="h-4 w-24 mb-3" />
      <Skeleton className="h-8 w-16 mb-2" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}
