import type { VatCategory } from '@grocery-app/shared';

/**
 * One variant, chosen from the catalogue.
 *
 * Lifted out of apps/admin/src/components/ProductPicker.tsx, which is the only
 * reason that type lives in a component file at all. The rep surface does not
 * use ProductPicker — the order panel is the one-shot's replacement — so the
 * type comes across on its own.
 */
export interface PickedVariant {
  id: string;
  name: string;
  price: number;
  storeId: string | null;
  storeName: string | null;
  /** Primary product image, for callers that show one. */
  imageUrl?: string | null;
  /** The product's IVA bucket as its price carries it (effectiveVatCategory),
   *  so a basket can show a VAT breakdown without re-fetching every product.
   *  Absent reads as 0 %. */
  vatCategory?: VatCategory;
}
