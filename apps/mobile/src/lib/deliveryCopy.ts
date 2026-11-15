/**
 * What a shop card says about delivery.
 *
 * This held a pair of helpers. `useFreeDeliveryCopy` — which built the
 * "Envío gratis +€30" line from the admin setting — went on 2026-09-25 along
 * with the free-delivery feature itself: there is no threshold, and delivery
 * is charged on every order.
 *
 * What is left is the one label that describes something the system actually
 * knows about a shop.
 */

/** Shop-card pill. Was "30–45 min" / "45–60 min" — windows nothing measures. */
export function deliveryLabel(fast: boolean, lang: 'es' | 'en'): string {
  if (fast) return lang === 'es' ? 'Entrega rápida' : 'Fast delivery';
  return lang === 'es' ? 'A domicilio' : 'Home delivery';
}
