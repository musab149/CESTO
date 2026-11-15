import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Heart, Plus, Minus, BadgeCheck, Star, Flame, Check } from 'lucide-react';
import type { Product } from '@grocery-app/shared';
import { resolveImageUrl, imageSrcSet, useTopShops, defaultTopShops, resolveShop } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useCartStore } from '@/stores/cartStore';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { useAuthStore } from '@/stores/authStore';
import { useToast } from '@/components/Toast';
import QuantityField from '@/components/QuantityField';
import { cappedMessage } from '@/lib/quantityMessages';
import { usePreviewModeStore } from '@/stores/previewModeStore';
import { usePriceTone } from '@/lib/priceTone';
import QuotationRequestModal from '@/components/QuotationRequestModal';

interface ProductCardProps {
  product: Product;
  /**
   * Turns the card into a picker tile: same design, different job.
   *
   * Three things follow from it, all consequences of the one fact that the
   * card is being used to assemble a list rather than to browse:
   *
   *   · the add / stepper reads and writes this instead of the cart store
   *   · the card stops navigating to the product page — inside a drawer, a
   *     tap that leaves the page throws away the draft being built
   *   · the control is sized as the card's primary action (44px) and the
   *     rating row is dropped. Adding is the only thing to do here, and
   *     reviews are decision-support for browsing a catalogue, not for
   *     picking a line item you are already sure about.
   */
  picker?: {
    /** How many of this variant the list already holds (0 = none). */
    quantityOf: (variantId: string) => number;
    /** 0 removes. The card never calls this above `max`. */
    onQuantityChange: (variantId: string, next: number) => void;
    /**
     * The stepper's ceiling. Left out, it is the variant's stock, as in the
     * cart. A list for later deliveries is not bounded by today's shelf.
     */
    max?: number;
  };
}

function Price({ value, color }: { value: number; color: string }) {
  const [whole, cents] = value.toFixed(2).split('.');
  return (
    <span className={`${color} font-extrabold font-ui leading-none`}>
      <span className="text-[12px] align-top mr-0.5">€</span>
      <span className="text-[20px]">{whole}</span>
      <span className="text-[12px] align-top">.{cents}</span>
    </span>
  );
}

export default function ProductCard({ product, picker }: ProductCardProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isPreview = usePreviewModeStore((s) => s.isPartnerPreview);
  const priceTone = usePriceTone();
  const { lang } = useLanguageStore();
  const productName = lang === 'en' ? product.name_en : product.name_es;
  const defaultVariant = product.variants?.find((v) => v.is_default) ?? product.variants?.[0];
  // A picker chooses the size on the card; the shop card always sells the
  // default one. Starts on a size already on the list, if there is one.
  const [chosenId, setChosenId] = useState<string | undefined>(
    () => (picker && product.variants?.find((v) => picker.quantityOf(v.id) > 0)?.id) || defaultVariant?.id,
  );
  const variant = (picker && product.variants?.find((v) => v.id === chosenId)) || defaultVariant;
  const primaryImage = product.images?.find((i) => i.is_primary) ?? product.images?.[0];
  const allOutOfStock = product.variants?.every((v) => v.stock_quantity === 0);
  const hasDiscount = variant?.compare_at_price != null;

  const { data: shopsData } = useTopShops();
  const shops = (shopsData ?? defaultTopShops).shops;
  // Prefer the store relation on the product response (real Store table).
  // Fall back to the legacy TopShops JSON lookup by slug while any frontend
  // deploy that still emits shop_id-only responses is in flight.
  const shop = product.store
    ? {
        id: product.store.slug,
        name: product.store.name,
        logo_url: product.store.logo_url,
        logo_bg: product.store.logo_bg,
      }
    : resolveShop(product.shop_id ?? null, shops);

  // Subscribed to unconditionally — hooks cannot be skipped — then ignored
  // when a picker binding is supplied.
  const cartQuantity = useCartStore((s) => s.getQuantity(defaultVariant?.id ?? ''));
  const cartAdd = useCartStore((s) => s.addItem);
  const cartUpdateQty = useCartStore((s) => s.updateQuantity);
  const stock = variant?.stock_quantity ?? 0;
  // Out of stock is still orderable — it lands as a draft order until
  // restocked. There's no live stock number to cap against, so fall back
  // to a modest fixed default instead of leaving the stepper unbounded.
  const BACKORDER_QTY_CAP = 10;
  const stepperMax = picker?.max ?? (allOutOfStock ? BACKORDER_QTY_CAP : stock);

  const quantity = picker ? (variant ? picker.quantityOf(variant.id) : 0) : cartQuantity;
  const add = () => {
    if (!variant) return;
    if (picker) picker.onQuantityChange(variant.id, 1);
    else cartAdd(product.id, variant.id);
  };
  const setQuantity = (next: number) => {
    if (!variant) return;
    if (picker) picker.onQuantityChange(variant.id, next);
    else cartUpdateQty(variant.id, next);
  };

  const openProduct = () => {
    if (picker) return;
    navigate(`/products/${product.id}`);
  };

  // 44px — the minimum comfortable touch target, and enough to read as the
  // card's primary control rather than a corner affordance.
  const bigAction = !!picker;

  const isFavorite = useFavoritesStore((s) => s.productIds.includes(product.id));
  const toggleFavorite = useFavoritesStore((s) => s.toggle);

  const [imgFailed, setImgFailed] = useState(false);
  const showImage = primaryImage && !imgFailed;
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);

  // Single top-left chip — Sold takes priority, then Top Seller.
  // Verified is rendered inline next to the rating so it gets a row of its own
  // visual context (a trust mark next to a trust signal) without stealing
  // image real estate.
  const topChip = allOutOfStock
    ? { label: lang === 'en' ? 'Pre-order' : 'Bajo pedido', icon: null, bg: 'bg-amber-deep', fg: 'text-white' }
    : product.is_top_seller
      ? { label: lang === 'en' ? 'Top' : 'Top', icon: <Flame size={10} strokeWidth={2.5} />, bg: 'bg-warning', fg: 'text-white' }
      : null;

  return (
    <div
      onClick={openProduct}
      role={picker ? undefined : 'button'}
      tabIndex={picker ? undefined : 0}
      onKeyDown={(e) => { if (!picker && e.key === 'Enter') openProduct(); }}
      className={`group flex flex-col rounded-2xl border border-border/70 p-2.5 hover:border-border hover:shadow-card transition-all ${picker ? '' : 'cursor-pointer'}`}
    >
      {/* Image — holds badge, heart, and the floating add/stepper */}
      <div className="photo-well relative aspect-square rounded-xl overflow-hidden bg-surface-cream">
        {topChip && (
          <span
            className={`absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-1 ${topChip.bg} ${topChip.fg} text-[10px] font-bold font-ui uppercase tracking-wide px-1.5 py-0.5 rounded-md shadow-card`}
          >
            {topChip.icon}
            {topChip.label}
          </span>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!isAuthenticated) {
              toast.info(
                lang === 'en' ? 'Sign in required' : 'Inicia sesión',
                lang === 'en' ? 'Log in to save items to your favourites.' : 'Inicia sesión para guardar artículos en tus favoritos.',
              );
              navigate('/login', { state: { from: location.pathname } });
              return;
            }
            toggleFavorite(product.id);
          }}
          aria-pressed={isFavorite}
          className="absolute top-1.5 right-1.5 z-10 w-7 h-7 rounded-full bg-card shadow-[0_2px_6px_rgba(15,23,42,0.12)] border border-border/40 flex items-center justify-center hover:bg-surface-cream transition-colors"
          aria-label={
            isFavorite
              ? (lang === 'en' ? 'Remove from favourites' : 'Quitar de favoritos')
              : (lang === 'en' ? 'Add to favourites' : 'Añadir a favoritos')
          }
        >
          <Heart
            size={13}
            strokeWidth={1.75}
            className={`${isFavorite ? 'text-danger fill-danger' : 'text-ink/55 hover:text-danger'} transition-colors`}
          />
        </button>

        {showImage ? (
          <img
            src={resolveImageUrl(primaryImage!.url, 'card')}
            /* Grid is 2 / 3 / 5 columns inside a 1500px container, so the card
               paints ~180px on a phone and ~280px at xl. `sizes` has to say so
               or the browser assumes 100vw and picks the widest candidate,
               which throws away the whole saving. */
            srcSet={imageSrcSet(primaryImage!.url)}
            sizes="(min-width: 1280px) 280px, (min-width: 1024px) 20vw, (min-width: 768px) 33vw, 50vw"
            alt={productName}
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500 ease-out"
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
            onLoad={(e) => {
              // Treat zero-byte / empty responses (loremflickr 500 etc.) as failure.
              if (e.currentTarget.naturalWidth === 0) setImgFailed(true);
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[64px] opacity-25">🛒</span>
          </div>
        )}

        {/* Floating add / stepper — bottom-right of image, saves a whole row.
            Hidden in Partner Preview so a partner can't add items to a fake
            cart. Stays visible when out of stock — it's still orderable,
            just as a draft/backorder — capped at a fixed default instead of
            live stock since there isn't any. */}
        {!isPreview && (
          <div
            className="absolute bottom-1.5 right-1.5 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            {quantity === 0 ? (
              <button
                onClick={add}
                className={`rounded-full bg-brand text-white flex items-center justify-center shadow-brand hover:bg-brand-mid transition-colors ${
                  bigAction ? 'w-11 h-11' : 'w-8 h-8'
                }`}
                aria-label={
                  picker
                    ? (lang === 'en' ? `Add ${productName} to your list` : `Añadir ${productName} a tu lista`)
                    : (lang === 'en' ? 'Add to cart' : 'Añadir al carrito')
                }
              >
                <Plus size={bigAction ? 20 : 16} strokeWidth={2.75} />
              </button>
            ) : (
              <div className={`inline-flex items-center rounded-full bg-brand text-white shadow-brand overflow-hidden ${bigAction ? 'h-11' : 'h-8'}`}>
                <button
                  onClick={() => setQuantity(quantity - 1)}
                  className={`h-full flex items-center justify-center hover:bg-brand-mid transition-colors ${bigAction ? 'w-10' : 'w-7'}`}
                  aria-label="decrease"
                >
                  <Minus size={bigAction ? 16 : 13} strokeWidth={2.75} />
                </button>
                <QuantityField
                  value={quantity}
                  max={stepperMax}
                  onChange={setQuantity}
                  onCapped={(n) => { const m = cappedMessage(lang, n); toast.warning(m.title, m.body); }}
                  label={lang === 'en' ? 'Quantity' : 'Cantidad'}
                  className={`font-bold font-ui text-white ${bigAction ? 'px-1 text-[15px] min-w-[24px]' : 'px-0.5 text-[12px] min-w-[18px]'}`}
                />
                {/* Ceiling is stepperMax, not stock: an all-out-of-stock
                    product is backorderable up to BACKORDER_QTY_CAP. Goes
                    through setQuantity, which routes to the picker when the
                    card is rendered inside one. bigAction is the picker's
                    larger control. */}
                <button
                  onClick={() => quantity < stepperMax && setQuantity(quantity + 1)}
                  disabled={quantity >= stepperMax}
                  className={`h-full flex items-center justify-center transition-colors ${bigAction ? 'w-10' : 'w-7'} ${quantity >= stepperMax ? 'opacity-40 cursor-not-allowed' : 'hover:bg-brand-mid'}`}
                  aria-label="increase"
                >
                  <Plus size={bigAction ? 16 : 13} strokeWidth={2.75} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Price row — price anchors the left, brand tag sits right-aligned
          with maximum whitespace between them so the two read as balanced
          poles rather than a crowded pair. Brand is muted/tiny/uppercase so
          the price still owns the visual weight. Optional — layout collapses
          cleanly to price-only when the product has no brand.
          In Partner Preview the price side is replaced with a neutral "—"
          placeholder so the layout doesn't collapse and the brand still shows. */}
      <div className="mt-2 flex items-baseline gap-2">
        <div className="flex items-baseline gap-1.5 flex-wrap min-w-0">
          {isPreview ? (
            <span className="text-muted/60 font-ui font-bold text-[16px] leading-none">— — —</span>
          ) : (
            <>
              <Price value={variant?.price ?? 0} color={priceTone} />
              {hasDiscount && (
                <span className="text-[11.5px] text-muted line-through font-ui">
                  €{variant?.compare_at_price?.toFixed(2)}
                </span>
              )}
            </>
          )}
        </div>
        {product.brand && (
          <span className="ml-auto text-[9.5px] font-bold uppercase tracking-[0.12em] text-muted/85 font-ui leading-none truncate max-w-[50%] self-center text-right">
            {product.brand}
          </span>
        )}
      </div>

      {/* Get Quotation trigger — bulk/wholesale products only. Text link,
          same style/pattern as the "Sold by <shop>" link below. Stops the
          card's own onClick so it opens the modal instead of navigating to
          the product detail page. */}
      {product.is_quotation_enabled && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setQuoteModalOpen(true);
          }}
          className="mt-0.5 text-left text-[11px] text-brand font-semibold font-ui hover:underline underline-offset-2 transition-colors"
        >
          Get Quotation
        </button>
      )}

      {/* Name — no fixed min-height, single tight block */}
      <p className="mt-1 text-[13px] font-semibold text-ink font-ui leading-snug line-clamp-2">
        {productName}
      </p>

      {/* Sizes, in a picker only: about one product in eight comes in more
          than one, and the list needs the 10 kg bag, not whichever is the
          default. A tick marks a size already on the list. */}
      {picker && (product.variants?.length ?? 0) > 1 && (
        <div
          role="radiogroup"
          aria-label={lang === 'en' ? 'Size' : 'Tamaño'}
          className="mt-1.5 flex flex-wrap gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {product.variants!.map((v) => {
            const on = v.id === variant?.id;
            const listed = picker.quantityOf(v.id) > 0;
            return (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setChosenId(v.id)}
                className={`inline-flex items-center gap-1 h-7 px-2 rounded-lg border text-[11.5px] font-semibold font-ui transition-colors ${
                  on ? 'bg-brand text-white border-brand' : 'bg-card text-ink border-border hover:border-brand-light'
                }`}
              >
                {listed && <Check size={11} strokeWidth={3} className={on ? 'text-white' : 'text-success'} />}
                {lang === 'en' ? v.name_en : v.name_es}
              </button>
            );
          })}
        </div>
      )}

      {/* Sold-by line — always shown, defaults to Cesto Shop. The store name
          is clickable and routes to /stores/:slug for real partner stores;
          for the Cesto house shop we keep it as inert text. */}
      <p className="mt-0.5 text-[11px] text-muted font-ui leading-tight line-clamp-1">
        {lang === 'en' ? 'Sold by' : 'Vendido por'}{' '}
        {/* Not a link in a picker: leaving would abandon the list. */}
        {shop.id && shop.id !== 'cesto' && !picker ? (
          <button
            type="button"
            onClick={(e) => {
              // Stop the parent card's onClick from firing (which would
              // navigate to the product detail instead of the store).
              e.stopPropagation();
              navigate(`/stores/${shop.id}`);
            }}
            className="text-ink/80 font-semibold hover:text-brand hover:underline underline-offset-2 transition-colors"
          >
            {shop.name}
          </button>
        ) : (
          <span className="text-ink/80 font-semibold">{shop.name}</span>
        )}
      </p>

      {/* Rating + Verified.
          Normally always rendered, so every card has the same slot beneath
          the "Sold by" line, falling back to "No reviews yet".

          In picker mode the rating goes: reviews help you choose between
          products while browsing, and the picker is a list-assembly surface
          where the choice is already made. Verified stays — it is a trust
          mark, not a review — but the row then renders only when there is a
          badge to put in it, rather than leaving an empty line under every
          card. */}
      {(!picker || product.is_verified) && (
        <div className="mt-1 flex items-center gap-2 text-[11.5px] font-ui leading-none">
          {!picker && (
            product.rating != null ? (
              <span className="inline-flex items-center gap-0.5">
                <Star size={11} strokeWidth={2} className="text-warning fill-warning" />
                <span className="font-bold text-ink tabular-nums">{product.rating.toFixed(1)}</span>
                {product.rating_count != null && product.rating_count > 0 && (
                  <span className="text-muted">({product.rating_count})</span>
                )}
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 text-muted">
                <Star size={11} strokeWidth={2} className="text-border" />
                <span className="italic">{lang === 'en' ? 'No reviews yet' : 'Sin reseñas'}</span>
              </span>
            )
          )}
          {product.is_verified && (
            <span className="inline-flex items-center gap-0.5 text-brand-ink">
              <BadgeCheck size={12} strokeWidth={2} className="text-brand" />
              <span className="font-semibold">{lang === 'en' ? 'Verified' : 'Verificado'}</span>
            </span>
          )}
        </div>
      )}

      {product.is_quotation_enabled && (
        // Wrapper stops clicks inside the modal (fixed-position, but still a
        // DOM descendant of this clickable card) from bubbling up to the
        // card's own onClick and navigating away mid-form.
        <div onClick={(e) => e.stopPropagation()}>
          <QuotationRequestModal
            open={quoteModalOpen}
            onClose={() => setQuoteModalOpen(false)}
            product={{ id: product.id, name: productName }}
            initialQuantity={1}
          />
        </div>
      )}
    </div>
  );
}
