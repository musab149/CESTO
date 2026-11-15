import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ShoppingBag, Plus, Minus, Trash2, Zap, ArrowRight } from 'lucide-react';
import { useProductsByIds, useFeaturedProducts, MAX_LINE_QUANTITY } from '@grocery-app/shared';
import { useToast } from '@/components/Toast';
import QuantityField from '@/components/QuantityField';
import ProductThumb from '@/components/ProductThumb';
import { cappedMessage } from '@/lib/quantityMessages';
import type { Product } from '@grocery-app/shared';
import { useCartStore } from '@/stores/cartStore';
import { useCartUiStore } from '@/stores/cartUiStore';
import { useAuthStore } from '@/stores/authStore';
import { useLanguageStore } from '@/stores/languageStore';
import { useCartWords } from '@/lib/homeGroceryShopper';


export default function CartDrawer() {
  const navigate = useNavigate();
  const isOpen = useCartUiStore((s) => s.isOpen);
  const close = useCartUiStore((s) => s.close);
  const items = useCartStore((s) => s.items);
  const addItem = useCartStore((s) => s.addItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { lang } = useLanguageStore();
  // "My grocery list" for a Home Grocery household — see useCartWords.
  const words = useCartWords();
  const toast = useToast();

  // Resolve exactly the products sitting in the cart. Do NOT go back to a
  // paged catalogue listing here — /api/products caps at 60 rows, so on a real
  // catalogue most cart items fall outside page 1 and render as blank name /
  // no image / €0.00. by-ids is order-preserving; the service batches past
  // its 100-id limit, so a basket of any size resolves in full.
  const productIds = useMemo(
    () => Array.from(new Set(items.map((i) => i.productId))),
    [items],
  );
  const { data: cartProducts } = useProductsByIds(productIds);
  const { data: featured } = useFeaturedProducts(12);
  const products = cartProducts ?? [];

  // Close on Escape and lock body scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, close]);

  const enriched = useMemo(() => items.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    const variant = product?.variants?.find((v) => v.id === item.variantId);
    const image = product?.images?.find((img) => img.is_primary) ?? product?.images?.[0];
    return { ...item, product, variant, image };
  }), [items, products]);

  const subtotal = enriched.reduce(
    (sum, item) => sum + (item.variant?.price ?? 0) * item.quantity,
    0,
  );
  const compareSubtotal = enriched.reduce(
    (sum, item) => sum + ((item.variant?.compare_at_price ?? item.variant?.price) ?? 0) * item.quantity,
    0,
  );
  const hasDiscount = compareSubtotal > subtotal + 0.005;


  const cartProductIds = new Set(items.map((i) => i.productId));
  const recommendations = (featured ?? [])
    .filter((p) => !cartProductIds.has(p.id))
    .slice(0, 8);

  const handleCheckout = () => {
    close();
    if (!isAuthenticated) {
      navigate('/login', { state: { from: '/checkout' } });
      return;
    }
    navigate('/checkout');
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={close}
        aria-hidden={!isOpen}
        className={`fixed inset-0 z-50 bg-veil/40 backdrop-blur-[1px] transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={words.name}
        className={`fixed top-0 right-0 z-50 h-dvh w-full sm:w-[440px] bg-surface-cream shadow-modal flex flex-col transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* ── Header ─────────────────────────────────── */}
        <header className="grid grid-cols-[40px_1fr_40px] items-center px-3 h-14 border-b border-border shrink-0">
          <button
            onClick={close}
            aria-label={words.close}
            className="w-9 h-9 rounded-full flex items-center justify-center text-ink/70 hover:bg-surface-linen hover:text-ink transition-colors"
          >
            <X size={20} strokeWidth={2} />
          </button>
          <div className="text-center leading-tight">
            <h2 className="text-[15px] font-bold font-ui text-ink">
              {words.shopper ? words.title : lang === 'en' ? 'My Cesto cart' : 'Mi carrito Cesto'}
            </h2>
            <p className="text-[11.5px] font-ui text-muted">
              {lang === 'en' ? 'Shopping in' : 'Comprando en'} 28004
            </p>
          </div>
          <span />
        </header>

        {items.length === 0 ? (
          /* ── Empty state ───────────────────────────── */
          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
            <div className="w-20 h-20 rounded-full bg-surface-linen flex items-center justify-center mb-4">
              <ShoppingBag size={32} strokeWidth={1.5} className="text-muted" />
            </div>
            <h3 className="text-[17px] font-bold font-ui text-ink mb-1">
              {words.empty}
            </h3>
            <p className="text-[13px] font-ui text-muted mb-6 max-w-[260px]">
              {words.emptyDesc}
            </p>
            <button
              onClick={() => { close(); navigate('/'); }}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-brand text-white text-[13.5px] font-bold font-ui hover:bg-brand-mid transition-colors"
            >
              {words.startShopping}
              <ArrowRight size={15} strokeWidth={2.25} />
            </button>
          </div>
        ) : (
          <>
            {/* ── Scroll area: store header, items, subtotal, recommendations ── */}
            <div className="flex-1 overflow-y-auto">
              {/* Store strip */}
              <div className="px-5 pt-4 pb-3">
                <p className="text-[14px] font-bold font-ui text-ink">Cesto</p>
                <p className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-semibold font-ui text-success">
                  <Zap size={12} strokeWidth={2.5} className="fill-success" />
                  {lang === 'en' ? 'Today, by 10pm' : 'Hoy, antes de las 22:00'}
                </p>
              </div>

              {/* Items */}
              <ul className="divide-y divide-border/60 border-y border-border/60">
                {enriched.map((item) => {
                  const prodName = item.product
                    ? (lang === 'en' ? item.product.name_en : item.product.name_es)
                    : '';
                  const varName = item.variant
                    ? (lang === 'en' ? item.variant.name_en : item.variant.name_es)
                    : '';
                  // No product loaded yet: the line ceiling; checkout checks stock.
                  const maxStock = item.variant?.stock_quantity ?? MAX_LINE_QUANTITY;
                  const linePrice = (item.variant?.price ?? 0) * item.quantity;
                  const lineCompare = item.variant?.compare_at_price
                    ? item.variant.compare_at_price * item.quantity
                    : null;

                  return (
                    <li key={item.variantId} className="flex gap-3 px-5 py-3">
                      <button
                        onClick={() => { close(); navigate(`/products/${item.productId}`); }}
                        className="photo-well w-14 h-14 rounded-lg bg-surface-linen border border-border/40 overflow-hidden shrink-0 hover:border-brand-soft transition-colors"
                        aria-label={prodName}
                      >
                        <ProductThumb url={item.image?.url} fit="contain" iconSize={20} />
                      </button>

                      <div className="flex-1 min-w-0">
                        <h4
                          onClick={() => { close(); navigate(`/products/${item.productId}`); }}
                          className="text-[12.5px] font-semibold font-ui text-ink leading-snug line-clamp-2 cursor-pointer hover:text-brand transition-colors"
                        >
                          {prodName}{varName && <span className="text-muted font-normal"> ({varName})</span>}
                        </h4>
                        <div className="mt-1 flex items-baseline gap-1.5">
                          {lineCompare != null ? (
                            <>
                              <span className="bg-warning-bg text-warning text-[12.5px] font-extrabold font-ui px-1 rounded tabular-nums">
                                €{linePrice.toFixed(2)}
                              </span>
                              <span className="text-[11.5px] text-muted line-through font-ui tabular-nums">
                                €{lineCompare.toFixed(2)}
                              </span>
                            </>
                          ) : (
                            <span className="text-[13px] font-extrabold font-ui text-ink tabular-nums">
                              €{linePrice.toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Inline stepper — trash on min qty (like the reference) */}
                      <div className="inline-flex items-center h-8 rounded-full border border-border bg-card overflow-hidden self-center shrink-0">
                        <button
                          onClick={() =>
                            item.quantity === 1
                              ? removeItem(item.variantId)
                              : updateQuantity(item.variantId, item.quantity - 1)
                          }
                          className="w-8 h-full flex items-center justify-center text-ink/70 hover:bg-surface-linen transition-colors"
                          aria-label={item.quantity === 1 ? (lang === 'en' ? 'Remove' : 'Eliminar') : 'decrease'}
                        >
                          {item.quantity === 1 ? (
                            <Trash2 size={13} strokeWidth={1.75} className="text-danger" />
                          ) : (
                            <Minus size={13} strokeWidth={2.25} />
                          )}
                        </button>
                        <span className="px-1 inline-flex items-baseline gap-0.5 text-[11.5px] font-bold font-ui text-ink">
                          <QuantityField
                            value={item.quantity}
                            max={maxStock}
                            onChange={(n) => updateQuantity(item.variantId, n)}
                            onCapped={(n) => { const m = cappedMessage(lang, n); toast.warning(m.title, m.body); }}
                            label={lang === 'en' ? 'Quantity' : 'Cantidad'}
                            className="min-w-[22px]"
                          />
                          <span className="text-muted font-normal">ct</span>
                        </span>
                        <button
                          onClick={() => updateQuantity(item.variantId, item.quantity + 1)}
                          disabled={item.quantity >= maxStock}
                          className={`w-8 h-full flex items-center justify-center text-ink/70 transition-colors ${
                            item.quantity >= maxStock ? 'opacity-30 cursor-not-allowed' : 'hover:bg-surface-linen'
                          }`}
                          aria-label="increase"
                        >
                          <Plus size={13} strokeWidth={2.25} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Item subtotal row */}
              <div className="flex items-baseline justify-between px-5 py-4 border-b border-border/60">
                <span className="text-[14px] font-bold font-ui text-ink">
                  {lang === 'en' ? 'Item subtotal' : 'Subtotal'}
                </span>
                <span className="flex items-baseline gap-2">
                  {hasDiscount && (
                    <span className="text-[12.5px] text-muted line-through font-ui tabular-nums">
                      €{compareSubtotal.toFixed(2)}
                    </span>
                  )}
                  <span className="text-[18px] font-extrabold font-ui text-ink tabular-nums">
                    €{subtotal.toFixed(2)}
                  </span>
                </span>
              </div>

              {/* Complete your cart — recommendations rail */}
              {recommendations.length > 0 && (
                <section className="px-5 py-4">
                  <h3 className="text-[14px] font-bold font-ui text-ink">
                    {words.complete}
                  </h3>
                  <p className="text-[11.5px] font-ui text-muted mt-0.5">
                    {words.basedOn}
                  </p>
                  <ul className="mt-3 flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1 hide-scrollbar">
                    {recommendations.map((p) => (
                      <RecommendationCard
                        key={p.id}
                        product={p}
                        lang={lang}
                        addLabel={words.add}
                        onAdd={(productId, variantId) => addItem(productId, variantId)}
                        onOpen={(productId) => { close(); navigate(`/products/${productId}`); }}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </div>

            {/* ── Sticky footer: progress pill + checkout ── */}
            <footer
              className="border-t border-border bg-surface-cream px-4 pt-3 pb-3 shrink-0 space-y-2.5"
              style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
            >
              {/* A free-delivery progress pill sat here, counting up to a
                  €30 threshold hardcoded in this file — it never read the
                  admin setting at all. Free delivery was removed on
                  2026-09-25. */}

              <button
                onClick={handleCheckout}
                className="w-full h-12 inline-flex items-center justify-between gap-2 rounded-xl bg-brand text-white px-4 hover:bg-brand-mid active:scale-[0.99] transition-all shadow-brand"
              >
                <span className="text-[14px] font-bold font-ui">
                  {words.shopper ? words.checkout : lang === 'en' ? 'Complete checkout' : 'Finalizar compra'}
                </span>
                <span className="text-[14px] font-extrabold font-ui tabular-nums">
                  €{subtotal.toFixed(2)}
                </span>
              </button>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}

/* ─── Recommendation card ──────────────────────────────────
   Compact tile for the "Complete your cart" rail. Mirrors the
   shape of the reference (image + name + price + floating green
   "+ Add" button), tuned to Cesto's brand colors. */
function RecommendationCard({
  product,
  lang,
  addLabel,
  onAdd,
  onOpen,
}: {
  product: Product;
  lang: 'en' | 'es';
  /** "Add to cart", or "Add to list" for a Home Grocery household. */
  addLabel: string;
  onAdd: (productId: string, variantId: string) => void;
  onOpen: (productId: string) => void;
}) {
  const variant = product.variants?.find((v) => v.is_default) ?? product.variants?.[0];
  const image = product.images?.find((i) => i.is_primary) ?? product.images?.[0];
  const name = lang === 'en' ? product.name_en : product.name_es;

  if (!variant) return null;

  return (
    <li className="w-[124px] shrink-0">
      <div className="relative">
        <button
          onClick={() => onOpen(product.id)}
          className="photo-well w-full aspect-square rounded-xl bg-surface-linen border border-border/40 overflow-hidden hover:border-brand-soft transition-colors"
          aria-label={name}
        >
          <ProductThumb url={image?.url} fit="contain" iconSize={20} />
        </button>
        <button
          onClick={() => onAdd(product.id, variant.id)}
          className="absolute -bottom-2 right-1.5 inline-flex items-center gap-1 h-7 pl-2 pr-2.5 rounded-full bg-brand text-white text-[11.5px] font-bold font-ui shadow-brand hover:bg-brand-mid active:scale-[0.97] transition-all"
          aria-label={addLabel}
        >
          <Plus size={11} strokeWidth={3} />
          {lang === 'en' ? 'Add' : 'Añadir'}
        </button>
      </div>
      <p
        onClick={() => onOpen(product.id)}
        className="mt-3 text-[11.5px] font-semibold font-ui text-ink leading-tight line-clamp-2 cursor-pointer hover:text-brand transition-colors"
      >
        {name}
      </p>
      <p className="mt-0.5 text-[12px] font-extrabold font-ui text-ink tabular-nums">
        €{variant.price.toFixed(2)}
      </p>
    </li>
  );
}
