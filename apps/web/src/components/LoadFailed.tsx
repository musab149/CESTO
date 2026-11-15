import type { ReactNode } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';

/**
 * In place of a product list that could not be LOADED. The lists used to
 * fall through to their empty state — "No products found", "No results for
 * …" — when the request failed, which reads as a fact about the shop.
 */
export function ListLoadFailed({ lang, onRetry, retrying }: {
  lang: 'es' | 'en';
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="rounded-lg bg-surface-cream shadow-card flex flex-col items-center text-center py-12 px-6">
      <CloudOff size={28} strokeWidth={1.75} className="text-muted mb-3" />
      <p className="font-display font-semibold text-ink mb-1">
        {lang === 'en' ? "We couldn't load the products" : 'No hemos podido cargar los productos'}
      </p>
      <p className="text-sm font-body text-muted max-w-sm mb-5">
        {lang === 'en'
          ? "The connection or our server didn't answer in time."
          : 'La conexión o nuestro servidor no respondieron a tiempo.'}
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="min-h-[52px] px-6 rounded-xl bg-brand text-white font-display font-semibold text-sm inline-flex items-center gap-2 hover:bg-brand-mid disabled:opacity-60 transition-colors"
      >
        <RefreshCw size={16} strokeWidth={1.75} className={retrying ? 'animate-spin' : ''} />
        {lang === 'en' ? 'Try again' : 'Reintentar'}
      </button>
    </div>
  );
}

/**
 * The page for a record that could not be LOADED — what happened, and the
 * retry, instead of a "not found" that may not be true. Pair it with
 * isNotFound() from @grocery-app/shared.
 */
export default function LoadFailed({ lang, title, onRetry, retrying, secondary }: {
  lang: 'es' | 'en';
  /** What could not be loaded, as a sentence: "We couldn't load this store". */
  title: string;
  onRetry: () => void;
  retrying?: boolean;
  /** A way out, e.g. a link back to the list. */
  secondary?: ReactNode;
}) {
  return (
    <div className="min-h-[60vh] bg-surface-linen flex flex-col items-center justify-center px-4 py-16 text-center">
      <span className="w-20 h-20 rounded-2xl bg-surface-cream shadow-card flex items-center justify-center text-muted mb-5">
        <CloudOff size={34} strokeWidth={1.75} />
      </span>
      <h1 className="text-xl font-bold text-ink font-display mb-2">{title}</h1>
      <p className="text-sm text-gray font-body mb-6 max-w-sm">
        {lang === 'en'
          ? "The connection or our server didn't answer in time. Check your connection and try again."
          : 'La conexión o nuestro servidor no respondieron a tiempo. Comprueba tu conexión y vuelve a intentarlo.'}
      </p>
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="min-h-[52px] px-6 rounded-xl bg-brand text-white font-display font-semibold text-sm inline-flex items-center gap-2 hover:bg-brand-mid disabled:opacity-60 transition-colors"
        >
          <RefreshCw size={16} strokeWidth={1.75} className={retrying ? 'animate-spin' : ''} />
          {lang === 'en' ? 'Try again' : 'Reintentar'}
        </button>
        {secondary}
      </div>
    </div>
  );
}
