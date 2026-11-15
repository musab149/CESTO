import { useEffect, useRef, useState } from 'react';
import { LayoutGrid, Loader2, Minus, Plus, Search, Store, X } from 'lucide-react';
import {
  resolveImageUrl, useBusinessCategories, useBusinessProductsInfinite,
  type BusinessProduct, type BusinessSize,
} from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { money } from '@/sales/lib/format';
import { nameOf } from '@/sales/components/catalogue/data';
import { useBizT } from '../lib/i18n';
import { pricesOf, stockOf } from '../lib/sizes';
import Photo from './Photo';

/**
 * The catalogue beside an order being edited (2026-10-30, user: "edit order
 * should be as we have edit order on rep side") — the rep's OrderProductPanel
 * (sales/components) for a buyer: the same search, category strip, grid of
 * cards and "Añadir" that turns into the quantity, docked beside the order
 * from xl and a drawer below it.
 *
 * Two differences, both the server's rules rather than taste:
 *   · Only the ORDER'S SHOP. A customer's edit may only add products sold by
 *     the shop the order is from (routes/orders.ts PUT /:id/items — an order
 *     is one shop's, so anything else is another order). Cesto's own orders,
 *     including the ones a rep built, take Cesto's own products.
 *   · The business catalogue: only sizes with a wholesale price, priced as
 *     the edit will charge them (agreed prices included).
 *
 * The quantities are the EDIT's, not the cart's — the add button here never
 * touches the cart (lib/sizes useLine does, which is why it is not used).
 */

const PAGE_SIZE = 30;

export default function EditProductPanel({
  open, onClose, storeId, shopName, quantities, onAdd, onSetQuantity,
}: {
  open: boolean;
  onClose: () => void;
  /** The order's shop: its id, or 'cesto' for Cesto's own. */
  storeId: string;
  shopName: string;
  /** Units of each size already in the edited order. */
  quantities: Record<string, number>;
  onAdd: (product: BusinessProduct, size: BusinessSize) => void;
  onSetQuantity: (variantId: string, quantity: number) => void;
}) {
  const t = useBizT();
  const lang = useLanguageStore((s) => s.lang) as 'es' | 'en';
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  // Which size each card shows; the first until another is picked.
  const [chosen, setChosen] = useState<Record<string, string>>({});

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  // A drawer below xl: Escape closes it, as the rep's does.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const { data: categories } = useBusinessCategories();
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useBusinessProductsInfinite({
    sort: 'name_asc',
    storeId,
    ...(debouncedQ ? { q: debouncedQ } : {}),
    ...(categoryId ? { categoryId } : {}),
    limit: PAGE_SIZE,
  });
  const products = (data?.pages ?? []).flatMap((p) => p.items);
  const total = data?.pages?.[0]?.total ?? 0;

  // The next page as the end of the grid comes into view, a screen early.
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) fetchNextPage(); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, products.length]);

  return (
    <>
      {open && (
        <button
          type="button"
          onClick={onClose}
          aria-label={t('biz.closeMenu')}
          className="fixed inset-0 z-40 bg-veil/40 backdrop-blur-[2px] animate-fade-in xl:hidden"
        />
      )}

      <aside
        className={`bg-card border-border flex-col
          fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[440px] border-l sm:rounded-l-3xl sales-drawer shadow-modal
          xl:z-auto xl:w-auto xl:flex-1 xl:min-w-0 xl:border xl:rounded-2xl xl:shadow-card
          xl:sticky xl:top-[72px] xl:h-[calc(100vh-88px)] xl:overflow-hidden
          ${open ? 'flex' : 'hidden xl:flex'}`}
        aria-label={t('biz.edit.panel.title')}
      >
        <div className="shrink-0 px-4 py-3 flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted" strokeWidth={1.75} />
            <input
              autoFocus={open}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('biz.cat.searchIn', { name: shopName })}
              aria-label={t('biz.cat.searchIn', { name: shopName })}
              className="w-full bg-card border border-border rounded-xl h-11 pl-10 pr-9 text-sm font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 [&::-webkit-search-cancel-button]:hidden"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                aria-label={t('biz.closeMenu')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded hover:bg-border/60 flex items-center justify-center"
              >
                <X size={13} strokeWidth={2} className="text-muted" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('biz.closeMenu')}
            className="xl:hidden w-9 h-9 rounded-lg hover:bg-surface-cream flex items-center justify-center shrink-0"
          >
            <X size={17} strokeWidth={1.75} className="text-muted" />
          </button>
        </div>

        {/* Whose products these are, and why only theirs. */}
        <div className="shrink-0 px-4 py-2 border-y border-border bg-surface-cream/60 text-[12px] font-display">
          <p className="flex items-center gap-1.5 text-gray font-semibold min-w-0">
            <Store size={13} strokeWidth={1.75} className="text-brand shrink-0" />
            <span className="truncate">{t('biz.edit.panel.from', { shop: shopName })}</span>
          </p>
          <p className="mt-0.5 text-muted">{t('biz.edit.panel.sameShop')}</p>
        </div>

        {(categories ?? []).length > 0 && (
          <div className="shrink-0 border-b border-border overflow-x-auto">
            <div className="flex items-center gap-1.5 px-3 py-2 min-w-max">
              <button
                type="button"
                onClick={() => setCategoryId('')}
                aria-pressed={categoryId === ''}
                className={`h-9 px-3 shrink-0 rounded-lg inline-flex items-center gap-1.5 text-xs font-semibold font-display whitespace-nowrap transition-colors ${
                  categoryId === '' ? 'bg-brand text-white' : 'text-gray hover:bg-surface-cream'
                }`}
              >
                <LayoutGrid size={15} strokeWidth={1.75} className="shrink-0" />
                {t('biz.cat.all')}
              </button>
              {(categories ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(c.id)}
                  aria-pressed={categoryId === c.id}
                  className={`h-9 px-3 shrink-0 max-w-[170px] rounded-lg inline-flex items-center gap-1.5 text-xs font-semibold font-display transition-colors ${
                    categoryId === c.id ? 'bg-brand text-white' : 'text-gray hover:bg-surface-cream'
                  }`}
                >
                  {c.icon_url && (
                    <img
                      src={resolveImageUrl(c.icon_url)}
                      alt=""
                      className="w-[15px] h-[15px] object-contain shrink-0"
                      draggable={false}
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  )}
                  <span className="truncate">{nameOf(c, lang)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto bg-surface-linen/40">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted">
              <Loader2 className="w-5 h-5 animate-spin" strokeWidth={1.75} />
            </div>
          ) : products.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">{t('biz.edit.panel.none')}</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 2xl:grid-cols-4 gap-2 p-2.5">
              {products.map((p) => {
                const sizes = p.variants;
                const v = sizes.find((x) => x.id === chosen[p.id]) ?? sizes[0];
                if (!v) return null;
                const inOrder = quantities[v.id] ?? 0;
                const out = stockOf(v) === 'out';
                const { pay, agreed } = pricesOf(v);
                return (
                  <div key={p.id} className="flex flex-col rounded-2xl border border-border/70 bg-card p-2 hover:border-border hover:shadow-card transition-all">
                    <div className="sales-photo relative aspect-[3/2] rounded-xl overflow-hidden bg-surface-cream flex items-center justify-center">
                      {agreed && (
                        <span className="absolute top-1.5 left-1.5 z-10 inline-flex h-5 items-center px-1.5 rounded-md bg-success text-white text-[10px] font-bold font-display">
                          {t('biz.cat.agreed')}
                        </span>
                      )}
                      <Photo url={p.images?.[0]?.url} preset="thumb" icon={26} className={`absolute inset-0 w-full h-full object-contain p-1.5 ${out ? 'opacity-50' : ''}`} />
                    </div>

                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-[14.5px] font-bold font-display text-brand tabular-nums leading-none">{money(pay)}</span>
                      {p.brand && (
                        <span className="ml-auto text-[11px] font-semibold text-muted leading-none truncate max-w-[50%] text-right">{p.brand}</span>
                      )}
                    </div>
                    <p className="mt-1 text-[12px] font-medium text-ink leading-snug line-clamp-2">{nameOf(p, lang)}</p>
                    {sizes.length > 1 ? (
                      <select
                        value={v.id}
                        onChange={(e) => setChosen((m) => ({ ...m, [p.id]: e.target.value }))}
                        aria-label={t('biz.cat.pickSize')}
                        className="mt-1.5 w-full h-7 px-2 rounded-lg border border-border bg-card text-[11px] text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                      >
                        {sizes.map((x) => <option key={x.id} value={x.id}>{nameOf(x, lang)}</option>)}
                      </select>
                    ) : (
                      <p className="mt-0.5 text-[10.5px] text-muted truncate">{nameOf(v, lang)}</p>
                    )}

                    <div className="mt-auto pt-1.5">
                      {inOrder === 0 ? (
                        <button
                          type="button"
                          disabled={out}
                          onClick={() => onAdd(p, v)}
                          className="w-full h-9 rounded-xl bg-brand hover:bg-brand-mid disabled:bg-surface-cream disabled:text-muted disabled:cursor-not-allowed text-white text-[12px] font-semibold font-display inline-flex items-center justify-center gap-1.5 transition-colors"
                        >
                          {out ? t('biz.cat.outOfStock') : <><Plus size={15} strokeWidth={2.75} />{t('biz.cat.add')}</>}
                        </button>
                      ) : (
                        <div className="w-full h-9 rounded-xl border-2 border-brand flex items-center overflow-hidden" aria-label={t('biz.edit.panel.inOrder')}>
                          <button
                            type="button"
                            onClick={() => onSetQuantity(v.id, inOrder - 1)}
                            aria-label={t('biz.cat.less')}
                            className="h-full w-9 shrink-0 flex items-center justify-center text-brand hover:bg-brand-whisper transition-colors"
                          >
                            <Minus size={15} strokeWidth={2.75} />
                          </button>
                          <span className="flex-1 text-center text-[13px] font-bold text-brand tabular-nums">{inOrder}</span>
                          <button
                            type="button"
                            onClick={() => onSetQuantity(v.id, inOrder + 1)}
                            aria-label={t('biz.cat.more')}
                            className="h-full w-9 shrink-0 flex items-center justify-center text-brand hover:bg-brand-whisper transition-colors"
                          >
                            <Plus size={15} strokeWidth={2.75} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {hasNextPage && (
            <div ref={loadMoreRef} className="px-3 pb-4 pt-1 flex items-center justify-center">
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="h-9 px-4 rounded-lg border border-border text-xs font-semibold font-display text-gray hover:border-brand hover:text-brand disabled:opacity-60 inline-flex items-center gap-1.5 transition-colors"
              >
                {isFetchingNextPage && <Loader2 size={13} strokeWidth={2.5} className="animate-spin" />}
                {t('biz.cat.loadMore')}
              </button>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border px-4 py-2.5 text-[11px] text-muted truncate">
          {total > 0 && t('biz.edit.panel.count', { loaded: products.length, total })}
        </div>
      </aside>
    </>
  );
}
