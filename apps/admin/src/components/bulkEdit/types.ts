/** Row shapes the grid works with — the `full=1` list response. */

export interface BulkVariant {
  id: string;
  name_es?: string;
  sku?: string | null;
  price: string | number;
  compare_at_price?: string | number | null;
  b2b_price?: string | number | null;
  /** The buying price (admin only). */
  cost_price?: string | number;
  stock_quantity: number;
  low_stock_threshold: number;
  is_default: boolean;
  [key: string]: unknown;
}

export interface BulkProduct {
  id: string;
  name_es: string;
  name_en: string;
  variants?: BulkVariant[];
  [key: string]: unknown;
}

/** Flattened row model — product rows with their variants as child rows. */
export type GridRow =
  | { kind: 'product'; key: string; productId: string; product: BulkProduct }
  | { kind: 'variant'; key: string; productId: string; variant: BulkVariant; index: number };

export function buildRows(products: BulkProduct[]): GridRow[] {
  const rows: GridRow[] = [];
  for (const p of products) {
    rows.push({ kind: 'product', key: `p:${p.id}`, productId: p.id, product: p });
    (p.variants ?? []).forEach((v, i) => {
      rows.push({ kind: 'variant', key: `v:${v.id}`, productId: p.id, variant: v, index: i + 1 });
    });
  }
  return rows;
}
