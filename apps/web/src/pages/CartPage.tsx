import { useNavigate } from 'react-router-dom';
import { Trash2, Minus, Plus, ShoppingBag, ArrowRight, ChevronRight, Truck, Shield } from 'lucide-react';
import { useProductsByIds, MAX_LINE_QUANTITY } from '@grocery-app/shared';
import { useToast } from '@/components/Toast';
import QuantityField from '@/components/QuantityField';
import ProductThumb from '@/components/ProductThumb';
import { cappedMessage } from '@/lib/quantityMessages';
import { useCartStore } from '@/stores/cartStore';
import { Skeleton } from '@/components/Skeleton';
import { useLanguageStore } from '@/stores/languageStore';
import { useCartWords } from '@/lib/homeGroceryShopper';

export default function CartPage() {
  const navigate = useNavigate();
  const items = useCartStore((s) => s.items);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  // Fetch the cart's products by id. A paged catalogue listing can't be used
  // here — /api/products caps at 60 rows, so anything outside page 1 resolved
  // to undefined and rendered blank name / no image / €0.00 on a real
  // catalogue. Disabled on an empty cart, so isLoading stays false and the
  // empty state below still wins.
  const productIds = Array.from(new Set(items.map((i) => i.productId)));
  const { data: products, isLoading } = useProductsByIds(productIds);
  const { lang, t } = useLanguageStore();
  // A Home Grocery household's cart is its grocery list — see useCartWords.
  const words = useCartWords();
  const toast = useToast();

  if (isLoading) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
        <Skeleton className="h-10 w-52 mb-8" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-20 flex flex-col items-center">
        <div className="w-28 h-28 bg-surface-linen rounded-full flex items-center justify-center mb-6">
          <ShoppingBag size={48} strokeWidth={1.25} className="text-muted" />
        </div>
        <h2 className="text-2xl font-extrabold text-ink font-display text-center mb-2">{words.empty}</h2>
        <p className="text-sm text-gray font-body text-center mb-8 max-w-md">
          {words.emptyDesc}
        </p>
        <button
          onClick={() => navigate('/')}
          className="h-12 px-8 bg-brand text-white rounded-xl font-semibold font-display hover:bg-brand-mid transition-colors flex items-center gap-2 shadow-md"
        >
          {words.startShopping}
          <ArrowRight size={18} />
        </button>
      </div>
    );
  }

  // Enrich cart items
  const enriched = items.map((item) => {
    const product = products?.find((p) => p.id === item.productId);
    const variant = product?.variants?.find((v) => v.id === item.variantId);
    const image = product?.images?.find((img) => img.is_primary) ?? product?.images?.[0];
    return { ...item, product, variant, image };
  });

  const subtotal = enriched.reduce((sum, item) => sum + (item.variant?.price ?? 0) * item.quantity, 0);

  // NO DELIVERY FEE IS QUOTED HERE, for anyone (user decision 2026-10-23):
  // our team adds it to the order once it can see it, and tells the customer.
  // So the total is the products, and the delivery line says it comes later —
  // never "Free", see deliveryFeeIsPending().
  const total = subtotal;

  const itemWord = items.length === 1 ? t('cart.item') : t('cart.items');

  return (
    <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm font-body text-muted mb-6">
        <button onClick={() => navigate('/')} className="hover:text-brand transition-colors">{t('common.home')}</button>
        <ChevronRight size={14} />
        <span className="text-ink font-semibold">{words.title}</span>
      </div>

      <h1 className="text-3xl font-extrabold text-ink font-display mb-8">
        {words.title} <span className="text-muted font-normal text-xl">({items.length} {itemWord})</span>
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* ─── Left: Cart Items ─── */}
        <div className="lg:col-span-2">
          {/* Table header */}
          <div className="hidden md:grid grid-cols-[1fr_120px_120px_40px] gap-4 px-4 pb-3 text-xs font-semibold text-muted font-display uppercase tracking-wider border-b border-border">
            <span>{t('cart.product')}</span>
            <span className="text-center">{t('cart.quantity')}</span>
            <span className="text-right">{t('cart.total')}</span>
            <span></span>
          </div>

          {/* Items */}
          <div className="flex flex-col divide-y divide-border/60">
            {enriched.map((item) => {
              const prodName = item.product ? (lang === 'en' ? item.product.name_en : item.product.name_es) : '';
              const varName = item.variant ? (lang === 'en' ? item.variant.name_en : item.variant.name_es) : '';
              const outOfStock = item.variant?.stock_quantity === 0;
              // Out of stock is still orderable (draft order, ships once
              // restocked) — cap the stepper at a fixed default since
              // there's no live stock number to bound against.
              // Until the product loads there is no stock to bound against: the
              // line ceiling, and the server checks stock at checkout.
              const stepperMax = outOfStock ? 10 : (item.variant?.stock_quantity ?? MAX_LINE_QUANTITY);
              return (
                <div key={item.variantId} className="grid grid-cols-1 md:grid-cols-[1fr_120px_120px_40px] gap-4 items-center py-5 px-4">
                  {/* Product info */}
                  <div className="flex gap-4 items-center">
                    <div
                      onClick={() => navigate(`/products/${item.productId}`)}
                      className="photo-well w-20 h-20 rounded-xl bg-surface-linen overflow-hidden shrink-0 border border-border/40 cursor-pointer hover:border-brand-soft transition-colors"
                    >
                      <ProductThumb url={item.image?.url} iconSize={26} />
                    </div>
                    <div className="min-w-0">
                      <h3
                        onClick={() => navigate(`/products/${item.productId}`)}
                        className="text-sm font-semibold text-ink font-display line-clamp-2 cursor-pointer hover:text-brand transition-colors"
                      >
                        {prodName}
                      </h3>
                      {item.variant && (
                        <span className="text-xs text-muted font-body">{varName}</span>
                      )}
                      <p className="text-sm font-semibold text-charcoal font-display mt-1">€{item.variant?.price.toFixed(2)}</p>
                      {outOfStock && (
                        <p className="text-[11px] text-amber-deep font-body font-semibold mt-1">
                          {t('product.out_of_stock')} — {t('checkout.outOfStockNote')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Quantity stepper */}
                  <div className="flex items-center justify-center">
                    <div className="flex items-center bg-surface-linen rounded-xl border border-border/60 overflow-hidden">
                      <button
                        onClick={() => updateQuantity(item.variantId, item.quantity - 1)}
                        className="w-9 h-9 flex items-center justify-center text-charcoal hover:bg-brand hover:text-white transition-colors"
                      >
                        <Minus size={14} strokeWidth={2.5} />
                      </button>
                      <QuantityField
                        value={item.quantity}
                        max={stepperMax}
                        onChange={(n) => updateQuantity(item.variantId, n)}
                        onCapped={(n) => { const m = cappedMessage(lang, n); toast.warning(m.title, m.body); }}
                        label={lang === 'en' ? 'Quantity' : 'Cantidad'}
                        className="min-w-10 text-sm font-bold text-ink font-display"
                      />
                      <button
                        onClick={() => updateQuantity(item.variantId, item.quantity + 1)}
                        disabled={item.quantity >= stepperMax}
                        className="w-9 h-9 flex items-center justify-center text-charcoal hover:bg-brand hover:text-white transition-colors disabled:opacity-30"
                      >
                        <Plus size={14} strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>

                  {/* Line total */}
                  <span className="text-right text-base font-bold text-ink font-display">
                    €{((item.variant?.price ?? 0) * item.quantity).toFixed(2)}
                  </span>

                  {/* Delete */}
                  <button
                    onClick={() => removeItem(item.variantId)}
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-muted hover:text-danger hover:bg-danger-bg transition-all justify-self-center"
                  >
                    <Trash2 size={16} strokeWidth={1.75} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ─── Right: Order Summary ─── */}
        <div>
          <div className="sticky top-[120px] bg-surface-linen/50 rounded-lg border border-border/60 p-6">
            <h3 className="text-lg font-extrabold text-ink font-display mb-5">{t('cart.order_summary')}</h3>

            <div className="flex flex-col gap-3 mb-5">
              <div className="flex justify-between text-sm font-display">
                <span className="text-gray">{t('cart.subtotal')}</span>
                <span className="text-ink font-semibold">€{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm font-display">
                <span className="text-gray">{t('cart.shipping')}</span>
                {/* Never "Free": it is a fee nobody has set yet. */}
                <span className="text-gray font-semibold">{t('cart.feeComesLater')}</span>
              </div>
              <p className="text-xs text-muted font-body">{t('cart.feeComesLaterNote')}</p>
            </div>

            <div className="border-t border-border/60 pt-4 mb-6">
              <div className="flex justify-between">
                <span className="text-lg font-extrabold text-ink font-display">{t('cart.total')}</span>
                <span className="text-2xl font-extrabold text-ink font-display">€{total.toFixed(2)}</span>
              </div>
            </div>

            <button
              onClick={() => navigate('/checkout')}
              className="w-full h-12 bg-brand text-white rounded-xl text-base font-bold font-display hover:bg-brand-mid active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
            >
              {words.checkout}
              <ArrowRight size={18} />
            </button>
            {words.shopper && (
              <p className="mt-2.5 text-xs text-muted font-body text-center">
                {lang === 'en' ? 'You choose the day and time in the next step.' : 'En el siguiente paso eliges el día y la hora.'}
              </p>
            )}

            {/* Trust */}
            <div className="flex items-center justify-center gap-4 mt-5 pt-4 border-t border-border/60">
              <div className="flex items-center gap-1 text-xs text-muted font-body">
                <Shield size={12} /> {t('cart.secure')}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted font-body">
                <Truck size={12} /> {t('cart.fast')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
