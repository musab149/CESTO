import { useMemo, useState } from 'react';
import { useInfiniteSearch, useCategories, useFeaturedProducts, resolveImageUrl } from '@grocery-app/shared';
import { emojiForCategory } from '@/lib/categoryIcon';
import ProductCard from '@/components/ProductCard';
import { ProductCardSkeleton } from '@/components/Skeleton';
import InfiniteScroll from '@/components/InfiniteScroll';
import { ListLoadFailed } from '@/components/LoadFailed';
import { Search, Clock, X, ArrowRight, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguageStore } from '@/stores/languageStore';

const PAGE_SIZE = 24;

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>(['basmati rice', 'garam masala', 'ghee']);
  const navigate = useNavigate();
  const { lang, t } = useLanguageStore();

  const showResults = query.length >= 2;
  const {
    data: searchData,
    isLoading: searchLoading,
    error: searchError,
    refetch: refetchSearch,
    isFetching: searchFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteSearch(showResults ? query : '', { limit: PAGE_SIZE });
  const { data: categories, isLoading: catsLoading } = useCategories();
  // 6, to fill the row below. The grid is 6-up at lg, so a smaller fetch
  // leaves the row short however many columns it declares.
  const { data: featured } = useFeaturedProducts(6);

  const isLoading = (showResults && searchLoading) || catsLoading;
  const results = useMemo(
    () => searchData?.pages.flatMap((p) => p.products) ?? [],
    [searchData],
  );
  const totalResults = searchData?.pages[0]?.total ?? 0;
  const trendingProducts = featured ?? [];

  return (
    <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
      {/* Search bar — large, prominent */}
      <div className="max-w-2xl mx-auto mb-10">
        <h1 className="text-3xl font-extrabold text-ink font-display text-center mb-6">
          {t('search.title')}
        </h1>
        <div className="relative">
          <Search size={20} strokeWidth={1.75} className="absolute left-5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            autoFocus
            className="w-full h-14 pl-13 pr-12 bg-surface-white border-2 border-border rounded-lg text-base text-ink font-display focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand-mist transition-all shadow-card placeholder:text-muted"
            style={{ paddingLeft: '3.25rem' }}
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-surface-linen flex items-center justify-center text-muted hover:text-ink hover:bg-border transition-colors">
              <X size={16} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-5">
          {Array.from({ length: 5 }).map((_, i) => <ProductCardSkeleton key={i} />)}
        </div>
      ) : !showResults ? (
        /* Empty state — recent + categories + trending */
        <div className="flex flex-col gap-12">
          {/* Recent searches */}
          {recentSearches.length > 0 && (
            <div className="max-w-2xl mx-auto w-full">
              <h2 className="text-lg font-bold text-ink font-display mb-4 flex items-center gap-2">
                <Clock size={18} strokeWidth={1.75} className="text-muted" />
                {t('search.recent')}
              </h2>
              <div className="flex flex-col">
                {recentSearches.map((term) => (
                  <button
                    key={term}
                    onClick={() => setQuery(term)}
                    className="flex items-center gap-3 py-3 px-4 hover:bg-surface-linen rounded-xl text-left transition-colors group"
                  >
                    <Clock size={14} strokeWidth={1.75} className="text-muted shrink-0" />
                    <span className="text-sm text-charcoal font-display flex-1">{term}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setRecentSearches((s) => s.filter((t) => t !== term)); }}
                      className="text-muted hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={14} strokeWidth={2} />
                    </button>
                    <ArrowRight size={14} className="text-muted" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Browse categories */}
          {categories && (
            <div>
              <h2 className="text-lg font-bold text-ink font-display mb-5">{t('search.explore')}</h2>
              {/* The tile IS the image. The old card boxed a 48px glyph
                  inside a 160px pale-blue panel, which spent the space on
                  chrome and left the admin's artwork too small to read.
                  Ground comes from the category's own bg_color so the
                  colour the admin picked is what the shopper sees, and the
                  emoji fallback lands on that tint rather than on one blue
                  shared by every category. Same treatment the categories
                  page already gives its rail tiles and hero. */}
              <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-8 gap-3 lg:gap-4">
                {categories.map((cat) => {
                  const name = lang === 'en' ? cat.name_en : cat.name_es;
                  const iconUrl = cat.icon_url ? resolveImageUrl(cat.icon_url, 'tile') : null;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => navigate(`/categories?cat=${cat.id}`)}
                      className="group flex flex-col gap-2 text-center focus-visible:outline-none"
                    >
                      <span
                        className="photo-well block aspect-square rounded-xl overflow-hidden ring-1 ring-border/50 group-hover:ring-brand/50 group-focus-visible:ring-2 group-focus-visible:ring-brand transition-all"
                        style={{ background: cat.bg_color || '#EFEAE1' }}
                      >
                        {iconUrl ? (
                          <img
                            src={iconUrl}
                            alt=""
                            className="w-full h-full object-cover group-hover:scale-[1.06] transition-transform duration-200 motion-reduce:transition-none"
                            draggable={false}
                          />
                        ) : (
                          <span className="w-full h-full flex items-center justify-center text-[30px] leading-none">
                            {emojiForCategory(name)}
                          </span>
                        )}
                      </span>
                      <span className="text-[12px] font-ui font-semibold text-ink leading-snug line-clamp-2 group-hover:text-brand-ink transition-colors">
                        {name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Trending products */}
          {trendingProducts.length > 0 && (
            <div>
              <h2 className="text-lg font-bold text-ink font-display mb-5 flex items-center gap-2">
                <TrendingUp size={18} strokeWidth={1.75} className="text-brand" />
                {t('search.trending')}
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 lg:gap-4">
                {trendingProducts.map((p) => <ProductCard key={p.id} product={p} />)}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Search Results */
        <div>
          {/* A failed search is not "0 results for …" — say what happened. */}
          {!(searchError && results.length === 0) && (
            <p className="text-sm text-muted font-body mb-6">
              {totalResults} {totalResults === 1 ? t('search.result') : t('search.results')} "<span className="font-semibold text-ink">{query}</span>"
            </p>
          )}
          {searchError && results.length === 0 ? (
            <ListLoadFailed lang={lang} onRetry={() => { void refetchSearch(); }} retrying={searchFetching} />
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center py-20">
              <span className="text-6xl mb-6">🔍</span>
              <h2 className="text-2xl font-extrabold text-ink font-display text-center mb-2">{t('search.no_results')}</h2>
              <p className="text-sm text-gray font-body text-center max-w-md">
                {t('search.no_results_desc').replace('{query}', query)}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-5">
                {results.map((product) => <ProductCard key={product.id} product={product} />)}
              </div>
              <InfiniteScroll
                hasMore={!!hasNextPage}
                isLoading={isFetchingNextPage}
                onLoadMore={() => fetchNextPage()}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
