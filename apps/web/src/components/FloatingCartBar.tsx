import { useLocation } from 'react-router-dom';
import { useMemo } from 'react';
import { ClipboardList, ShoppingCart } from 'lucide-react';
import { useProductsByIds } from '@grocery-app/shared';
import { useCartStore } from '@/stores/cartStore';
import { useCartUiStore } from '@/stores/cartUiStore';
import { useCartWords } from '@/lib/homeGroceryShopper';


// Routes where the floating bar would compete with the page's own cart UI.
const HIDDEN_PATHS = ['/cart', '/checkout', '/login', '/register', '/verify-otp'];

/**
 * The cart pill. Placed by FloatingActions, which stacks it under the
 * WhatsApp button and keeps both clear of the tab bar and the cookie bar.
 */
export default function FloatingCartBar() {
  const location = useLocation();
  const openCart = useCartUiStore((s) => s.open);
  const words = useCartWords();
  const items = useCartStore((s) => s.items);

  // Same by-ids fetch the cart page and drawer use, so React Query dedupes
  // across all three. A paged catalogue listing can't be used — /api/products
  // caps at 60 rows, which left the bar showing €0.00 on a real catalogue.
  const productIds = useMemo(
    () => Array.from(new Set(items.map((i) => i.productId))),
    [items],
  );
  const { data: cartProducts } = useProductsByIds(productIds);
  const products = cartProducts ?? [];

  const { subtotal, itemCount } = useMemo(() => {
    let subtotal = 0;
    let itemCount = 0;
    for (const item of items) {
      itemCount += item.quantity;
      const product = products.find((p) => p.id === item.productId);
      const variant = product?.variants?.find((v) => v.id === item.variantId);
      if (variant) subtotal += variant.price * item.quantity;
    }
    return { subtotal, itemCount };
  }, [items, products]);

  if (itemCount === 0) return null;
  if (HIDDEN_PATHS.some((p) => location.pathname.startsWith(p))) return null;


  return (
      <button
        onClick={openCart}
        className="pointer-events-auto group relative flex items-stretch rounded-full bg-brand text-white shadow-[0_12px_32px_rgba(5,78,232,0.35)] hover:bg-brand-mid active:scale-[0.99] overflow-hidden transition-shadow duration-300 hover:shadow-[0_16px_40px_rgba(5,78,232,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-mid focus-visible:ring-offset-2"
        aria-label={words.view}
      >
        {/* Expanding panel — hidden by default, slides out to the left on hover/focus */}
        <span
          aria-hidden="true"
          className="relative overflow-hidden max-w-0 group-hover:max-w-[280px] group-focus-visible:max-w-[280px] group-focus-within:max-w-[280px] transition-[max-width] duration-300 ease-out"
        >
          {/* This panel counted up to a €30 free-delivery threshold written
              into this file, which never matched the admin setting. Free
              delivery was removed on 2026-09-25; the pill now just opens the
              cart and shows what is in it. */}
          <span className="relative flex flex-col justify-center h-full pl-5 pr-3 whitespace-nowrap">
            <span className="text-[14px] font-bold font-ui leading-tight">
              {words.view}
            </span>
            <span className="mt-1 text-[11px] font-semibold font-ui text-white/80 leading-none tabular-nums">
              €{subtotal.toFixed(2)}
            </span>
          </span>
        </span>

        {/* Anchor — always visible cart icon + count, keeps the pill perfectly round when collapsed */}
        <span className="relative flex items-center gap-1.5 shrink-0 pl-4 pr-4 py-3.5">
          {words.shopper ? <ClipboardList size={22} strokeWidth={2.25} /> : <ShoppingCart size={22} strokeWidth={2.25} />}
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-card text-brand-ink text-[12px] font-extrabold font-ui tabular-nums">
            {itemCount}
          </span>
        </span>
      </button>
  );
}
