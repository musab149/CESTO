import { useHomeGroceryPlan, useMyHomeGrocery } from '@grocery-app/shared';
import { useAuthStore } from '@/stores/authStore';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * Whether the signed-in customer shops as a Home Grocery household
 * (2026-10-23): an approved household with a plan. Their cart is their
 * grocery list, and every order they place is one of their Home Grocery
 * orders — the server makes it so at checkout; this only lets the site say
 * it and ask for the slot.
 *
 * A household whose plan ended shops as anyone else. Asked of the plan only
 * for an approved household, so nobody else pays for the request.
 */
export function useHomeGroceryShopper() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: mine, isLoading: mineLoading } = useMyHomeGrocery({ enabled: isAuthenticated });
  const subscriber = isAuthenticated && !!mine?.subscriber;
  const q = useHomeGroceryPlan({ enabled: subscriber, staleTime: 60_000 });
  const plan = subscriber ? q.data?.plan ?? null : null;
  return {
    shopper: !!plan,
    plan,
    view: subscriber ? q.data ?? null : null,
    /** Still finding out — a checkout waits for this before it decides what to ask. */
    loading: isAuthenticated && (mineLoading || (subscriber && q.isLoading)),
  };
}

/**
 * The cart's words: "my grocery list" for a Home Grocery household, the
 * ordinary cart for everyone else. One place, so the header, the drawer, the
 * floating bar and the cart page never disagree about what it is called.
 */
export function useCartWords() {
  const { shopper } = useHomeGroceryShopper();
  const { lang, t } = useLanguageStore();
  const en = lang === 'en';
  if (shopper) {
    return {
      shopper,
      title: en ? 'My grocery list' : 'Mi lista de la compra',
      name: en ? 'Grocery list' : 'Lista de la compra',
      empty: en ? 'Your grocery list is empty' : 'Tu lista de la compra está vacía',
      emptyDesc: en
        ? 'Add what you need as you shop. When you are ready, it becomes your next Home Grocery order.'
        : 'Añade lo que necesitas mientras compras. Cuando quieras, será tu próximo pedido de la compra del hogar.',
      startShopping: en ? 'Start shopping' : 'Empezar a comprar',
      checkout: en ? 'Place my order' : 'Hacer mi pedido',
      view: en ? 'View my list' : 'Ver mi lista',
      close: en ? 'Close list' : 'Cerrar lista',
      complete: en ? 'Complete your list' : 'Completa tu lista',
      basedOn: en ? 'Based on your list' : 'Basado en tu lista',
      add: en ? 'Add to list' : 'Añadir a la lista',
    };
  }
  return {
    shopper,
    title: t('cart.title'),
    name: en ? 'Cart' : 'Carrito',
    empty: t('cart.empty'),
    emptyDesc: t('cart.empty_desc'),
    startShopping: t('cart.start_shopping'),
    checkout: t('cart.checkout'),
    view: en ? 'View cart' : 'Ver carrito',
    close: en ? 'Close cart' : 'Cerrar carrito',
    complete: en ? 'Complete your cart' : 'Completa tu carrito',
    basedOn: en ? 'Based on items in your cart' : 'Basado en tu carrito',
    add: en ? 'Add to cart' : 'Añadir al carrito',
  };
}
