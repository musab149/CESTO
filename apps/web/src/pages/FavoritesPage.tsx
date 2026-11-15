import { useNavigate } from 'react-router-dom';
import { ChevronRight, Heart, Trash2 } from 'lucide-react';
import { useProductsByIds } from '@grocery-app/shared';
import ProductCard from '@/components/ProductCard';
import { Skeleton } from '@/components/Skeleton';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { useLanguageStore } from '@/stores/languageStore';
import { useToast } from '@/components/Toast';

export default function FavoritesPage() {
  const navigate = useNavigate();
  const { lang, t } = useLanguageStore();
  const toast = useToast();

  const favoriteIds = useFavoritesStore((s) => s.productIds);
  const clear = useFavoritesStore((s) => s.clear);

  // Fetch exactly the favorited products by id — server preserves the id
  // order we send, so the render order matches the user's "recently
  // favorited" order without a client-side sort.
  const { data: favorites = [], isLoading } = useProductsByIds(favoriteIds);

  const missingCount = favoriteIds.length - favorites.length;

  function handleClear() {
    clear();
    toast.success(
      lang === 'en' ? 'Favourites cleared' : 'Favoritos eliminados',
      lang === 'en' ? 'Your saved items have been removed.' : 'Tus artículos guardados se han eliminado.',
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm font-body text-muted mb-6">
        <button onClick={() => navigate('/')} className="hover:text-brand transition-colors">
          {t('common.home')}
        </button>
        <ChevronRight size={14} />
        <span className="text-ink font-semibold">
          {lang === 'en' ? 'My favourites' : 'Mis favoritos'}
        </span>
      </div>

      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="font-display text-[26px] md:text-[32px] text-ink tracking-tight" style={{ fontWeight: 600 }}>
            {lang === 'en' ? 'My favourites' : 'Mis favoritos'}
          </h1>
          <p className="text-[13px] text-muted font-ui mt-1">
            {favoriteIds.length === 0
              ? (lang === 'en' ? 'Save products you love to find them faster.' : 'Guarda los productos que te gustan para encontrarlos más rápido.')
              : `${favoriteIds.length} ${
                  favoriteIds.length === 1
                    ? (lang === 'en' ? 'product saved' : 'producto guardado')
                    : (lang === 'en' ? 'products saved' : 'productos guardados')
                }`}
          </p>
        </div>
        {favoriteIds.length > 0 && (
          <button
            onClick={handleClear}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-card border border-border text-ink text-[12.5px] font-bold font-ui hover:border-danger hover:text-danger transition-colors"
          >
            <Trash2 size={14} strokeWidth={1.75} />
            {lang === 'en' ? 'Clear all' : 'Vaciar todo'}
          </button>
        )}
      </div>

      {/* Loading */}
      {isLoading && favoriteIds.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: Math.min(favoriteIds.length, 8) }).map((_, i) => (
            <Skeleton key={i} className="aspect-[3/4] !rounded-lg" />
          ))}
        </div>
      ) : favoriteIds.length === 0 ? (
        /* Empty state */
        <div className="bg-card border border-border/60 rounded-lg p-10 lg:p-16 flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-full bg-danger-bg flex items-center justify-center mb-5">
            <Heart size={32} strokeWidth={1.75} className="text-danger" />
          </div>
          <h2 className="font-display text-[20px] md:text-[22px] text-ink tracking-tight mb-2" style={{ fontWeight: 600 }}>
            {lang === 'en' ? 'No favourites yet' : 'Aún no tienes favoritos'}
          </h2>
          <p className="text-[13.5px] text-muted font-body max-w-sm mb-6 leading-relaxed">
            {lang === 'en'
              ? 'Tap the heart on any product to save it here for later.'
              : 'Toca el corazón en cualquier producto para guardarlo aquí.'}
          </p>
          <button
            onClick={() => navigate('/categories')}
            className="inline-flex items-center gap-2 h-11 px-6 rounded-full bg-brand text-white text-[13px] font-bold font-ui hover:bg-brand-deepest transition-colors"
          >
            {lang === 'en' ? 'Browse products' : 'Explorar productos'}
            <ChevronRight size={14} strokeWidth={2.5} />
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {favorites.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
          {missingCount > 0 && (
            <p className="text-[12px] text-muted font-ui mt-6 text-center">
              {lang === 'en'
                ? `${missingCount} saved item${missingCount === 1 ? '' : 's'} could not be loaded.`
                : `No se pudieron cargar ${missingCount} artículo${missingCount === 1 ? '' : 's'} guardado${missingCount === 1 ? '' : 's'}.`}
            </p>
          )}
        </>
      )}
    </div>
  );
}
