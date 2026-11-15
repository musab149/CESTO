// Words for QuantityField's onCapped, shared by the customer screens.
// Its own file so QuantityField.tsx exports only the component (fast refresh).

/** What a customer screen says when a typed number was lowered. */
export function cappedMessage(lang: 'es' | 'en', limit: number): { title: string; body: string } {
  return lang === 'en'
    ? { title: `At most ${limit}`, body: "That's the most available for this product." }
    : { title: `Máximo ${limit}`, body: 'Es la cantidad máxima disponible para este producto.' };
}
