import { useEffect, useState } from 'react';
import type { AdminRepProduct } from '@grocery-app/shared';
import { formatCurrency } from '@/lib/format';

/** Helpers the rep profile's Products card and the rep products page share. */

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** "3,20 €", or "3,20 – 4,10 €" across its sizes. */
export function priceLabel(p: AdminRepProduct): string | null {
  if (p.price_from === null) return null;
  const from = Number(p.price_from);
  const to = Number(p.price_to ?? p.price_from);
  return from === to ? formatCurrency(from) : `${formatCurrency(from).replace(' €', '')} – ${formatCurrency(to)}`;
}
