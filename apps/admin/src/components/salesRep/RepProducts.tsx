import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, List, Package, PackagePlus, Plus, Settings2 } from 'lucide-react';
import {
  HOUSE_STORE_ID, resolveImageUrl, useAdminRepProducts, type AdminRepProduct,
} from '@grocery-app/shared';
import { Skeleton } from '@/components/Skeleton';
import { priceLabel } from '@/components/salesRep/repProductFormat';

/*
 * Products a sales rep sells beside their shops (2026-10-27, user request:
 * "we should also be able to assign any products to the rep and these
 * products can be from any store and they show up in catalogue of the rep and
 * when they are creating the orders or edit"). Picked one by one from any
 * shop; the rep sees every size, at each client's price, while the product is
 * active and its shop can be sold from (API lib/repStore). Changing them is a
 * super-admin act, like their shops. Adding happens on a page of its own,
 * /sales-reps/:userId/products, laid out like the order builder.
 */

/** Photos in the card's strip; the last one counts the rest. */
const STRIP = 6;
/** Shops listed before "N more shops". */
const SHOPS = 4;

/** A product photo over a parcel: a missing or broken image shows the parcel, never a broken-image glyph. */
function Photo({ url, iconSize, className = '' }: { url: string | null; iconSize: number; className?: string }) {
  return (
    <>
      <Package size={iconSize} strokeWidth={1.75} className="text-muted" />
      {/* Its own opaque layer, so the photo's multiply blends with the
          cream and not with the parcel underneath. */}
      {url && (
        <span className="absolute inset-0 bg-surface-cream isolate">
          <img
            src={resolveImageUrl(url, 'thumb')}
            alt=""
            loading="lazy"
            onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
            className={`w-full h-full object-contain mix-blend-multiply ${className}`}
          />
        </span>
      )}
    </>
  );
}

export function Thumb({ url }: { url: string | null }) {
  return (
    <span className="relative w-10 h-10 rounded-lg bg-surface-cream border border-border/70 overflow-hidden flex items-center justify-center shrink-0">
      <Photo url={url} iconSize={16} />
    </span>
  );
}

/** Its shop, its sizes and its price, as one quiet line. */
export function ProductMeta({ p }: { p: AdminRepProduct }) {
  const { t } = useTranslation();
  const price = priceLabel(p);
  return (
    <span className="block text-[12px] text-muted truncate">
      {p.store?.name ?? t('salesReps.products.cesto', 'Cesto Shop')}
      {p.sizes > 1 && <> · {t('salesReps.products.sizes', { count: p.sizes, defaultValue: '{{count}} sizes' })}</>}
      {price && <> · <span className="tabular-nums">{price}</span></>}
    </span>
  );
}

/** Why the rep cannot see it now, or nothing. */
export function HiddenTag({ p }: { p: AdminRepProduct }) {
  const { t } = useTranslation();
  if (p.is_active && !p.shop_unavailable) return null;
  return (
    <span className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-danger-bg text-danger">
      {!p.is_active ? t('salesReps.products.inactive', 'Inactive') : t('salesReps.products.shopOff', 'Shop unavailable')}
    </span>
  );
}

/**
 * The rep profile's card: what they have been given, at a glance — never the
 * whole list.
 *
 * It was the list, five rows and "Show all", with a remove button on each:
 * sixty look-alike rows in a 340px column, and a slip of the pointer took one
 * away for good. Now (user, 2026-10-27: "we need to think of some better
 * design and organization for this products section") it is a summary: a
 * strip of their newest products' photos, where they come from shop by shop,
 * and what the rep cannot see. A shop opens the products page filtered to it;
 * every change happens there, where it can be undone before it is saved.
 */
export function RepProductsCard({ userId, canEdit }: { userId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading } = useAdminRepProducts(userId, { limit: STRIP });
  const open = (shop?: string) => navigate(`/sales-reps/${userId}/products${shop ? `?shop=${shop}` : ''}`);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hidden = data ? total - data.sellable : 0;
  const shops = data?.by_shop ?? [];
  const biggest = Math.max(1, ...shops.map((s) => s.count));
  const rest = total - (STRIP - 1);

  return (
    <section className="bg-card rounded-xl border border-border/60 shadow-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold font-display text-ink">
          <Package size={16} strokeWidth={1.75} className="text-brand" />
          {t('salesReps.products.title', 'Products')}
        </h2>
        {total > 0 && (
          <span className="min-w-6 h-6 px-1.5 rounded-full bg-surface-cream text-xs font-bold font-display text-gray inline-flex items-center justify-center tabular-nums">
            {total}
          </span>
        )}
      </div>
      <p className="text-[12px] text-muted mt-1">
        {t('salesReps.products.hint', 'Single products from any shop, on top of their shops. They see and sell every size, at each client\'s price.')}
      </p>

      {isLoading && !data ? (
        <div className="mt-3" aria-busy="true">
          <div className="grid grid-cols-6 gap-1.5">
            {Array.from({ length: STRIP }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}
          </div>
          <div className="mt-4 space-y-3"><Skeleton className="h-3.5 w-3/4" /><Skeleton className="h-3.5 w-1/2" /></div>
        </div>
      ) : total === 0 ? (
        /* Nothing yet: what it is for, and the way in. */
        <div className="mt-3 rounded-xl border-2 border-dashed border-border px-4 py-5 text-center">
          <span className="mx-auto w-11 h-11 rounded-xl bg-brand-mist/40 text-brand flex items-center justify-center">
            <PackagePlus size={20} strokeWidth={1.75} />
          </span>
          <p className="mt-2.5 text-sm font-bold font-display text-ink">{t('salesReps.products.emptyTitle', 'No products assigned')}</p>
          <p className="mt-1 text-[12.5px] text-muted leading-snug">
            {t('salesReps.products.emptyBody', 'Pick products from any shop. They show up in the rep\'s catalogue and when they build or edit an order.')}
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={() => open()}
              className="mt-3.5 h-10 px-4 rounded-xl bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display inline-flex items-center gap-1.5 transition-colors"
            >
              <Plus size={15} strokeWidth={2.25} />
              {t('salesReps.products.add', 'Add products')}
            </button>
          )}
        </div>
      ) : (
        <>
          {/* The newest, as photos: packaging is how a product is recognised,
              and six pictures say what kind of things these are faster than
              six names. The last tile counts the rest. */}
          <button
            type="button"
            onClick={() => open()}
            aria-label={t('salesReps.products.seeAll', { count: total, defaultValue: 'See all {{count}}' })}
            className="mt-3 w-full grid grid-cols-6 gap-1.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {items.slice(0, STRIP).map((p, i) => {
              const more = i === STRIP - 1 && rest > 1;
              return (
                <span key={p.id} title={more ? undefined : p.name_es} className="relative aspect-square rounded-lg bg-surface-cream border border-border/70 overflow-hidden flex items-center justify-center">
                  <Photo url={p.image_url} iconSize={15} className={`p-1 ${p.is_active && !p.shop_unavailable ? '' : 'opacity-40 grayscale'}`} />
                  {more && (
                    <span className="absolute inset-0 bg-veil/60 text-white text-[13px] font-bold font-display tabular-nums flex items-center justify-center">
                      +{rest}
                    </span>
                  )}
                </span>
              );
            })}
          </button>

          {/* Where they come from. Each bar is the shop's share against the
              biggest, so the shop most of them are from reads first. */}
          {shops.length > 0 && (
            <div className="mt-4">
              <p className="text-[11.5px] font-semibold text-muted">{t('salesReps.products.byShop', 'By shop')}</p>
              <ul className="mt-1 -mx-2">
                {shops.slice(0, SHOPS).map((g) => {
                  const id = g.store?.id ?? HOUSE_STORE_ID;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => open(id)}
                        className="group w-full text-left rounded-lg px-2 py-1.5 hover:bg-surface-cream transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 text-[13px] font-semibold font-display text-ink truncate">
                            {g.store?.name ?? t('salesReps.products.cesto', 'Cesto Shop')}
                          </span>
                          {g.hidden > 0 && (
                            <span className="shrink-0 text-[11px] font-semibold text-warning tabular-nums">
                              {t('salesReps.products.shopHidden', { count: g.hidden, defaultValue: '{{count}} hidden' })}
                            </span>
                          )}
                          <span className="shrink-0 text-[13px] font-bold font-display text-ink tabular-nums">{g.count}</span>
                          <ChevronRight size={14} strokeWidth={2} className="shrink-0 text-muted group-hover:text-brand transition-colors" />
                        </span>
                        <span className="mt-1 block h-1 rounded-full bg-surface-cream overflow-hidden">
                          <span className="block h-full rounded-full bg-brand/60" style={{ width: `${Math.max(4, (g.count / biggest) * 100)}%` }} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {shops.length > SHOPS && (
                <button
                  type="button"
                  onClick={() => open()}
                  className="mt-0.5 text-xs font-semibold font-display text-brand hover:underline"
                >
                  {t('salesReps.products.moreShops', { count: shops.length - SHOPS, defaultValue: '{{count}} more shops' })}
                </button>
              )}
            </div>
          )}

          {hidden > 0 && (
            <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-warning-bg px-2.5 py-2 text-[12.5px] font-semibold text-warning">
              <AlertTriangle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
              {t('salesReps.products.hiddenHint', { count: hidden, defaultValue: '{{count}} are not shown to them: inactive, or their shop is switched off.' })}
            </p>
          )}

          <button
            type="button"
            onClick={() => open()}
            className="mt-4 w-full h-11 rounded-xl border-2 border-border hover:border-brand bg-card text-sm font-semibold font-display text-brand inline-flex items-center justify-center gap-2 transition-colors"
          >
            {canEdit ? <Settings2 size={16} strokeWidth={1.75} /> : <List size={16} strokeWidth={1.75} />}
            {canEdit
              ? t('salesReps.products.manage', 'Manage products')
              : t('salesReps.products.seeAll', { count: total, defaultValue: 'See all {{count}}' })}
          </button>
        </>
      )}
    </section>
  );
}
