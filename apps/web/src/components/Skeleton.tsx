interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`skeleton ${className}`} />;
}

export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border/70 p-3">
      <Skeleton className="aspect-square w-full !rounded-lg" />
      <Skeleton className="h-9 w-24 !rounded-full" />
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-3 w-1/3" />
    </div>
  );
}

export function CategoryCardSkeleton() {
  return (
    <Skeleton className="w-full h-[140px] !rounded-[24px]" />
  );
}

export function BannerSkeleton() {
  return <Skeleton className="w-full h-[480px] !rounded-[36px]" />;
}
