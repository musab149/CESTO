import {
  unitDiscountText, lineVatCategory, effectiveVatCategory,
  type BusinessProduct, type BusinessSize, type CustomerOrderEditOperation, type OrderItem,
  type PreviewLine, type VatCategory,
} from '@grocery-app/shared';
import { nameOf } from '@/sales/components/catalogue/data';
import { pricesOf } from './sizes';

/*
 * The edit screen's basket (2026-10-30) — the rep builder's (sales
 * SalesNewOrderPage) rules for a buyer's own order: the order read as rows
 * once, rows changed on screen, and the save a DIFF of operations against
 * how it opened. Kept out of the page so the page exports only components.
 */

/** One row of the order being edited. */
export interface EditLine {
  /**
   * The ROW, not the product: the order line's id, or `new:n` for one added
   * here. An order can carry one size on two lines (the rep builder's note on
   * BasketLine.key), so a size is not identity enough.
   */
  key: string;
  /** Set on the lines the order already had: what makes a row an update, not an add. */
  orderItemId?: string;
  variantId: string;
  name: string;
  sizeName: string;
  /** Before any price agreed with them. */
  unitPrice: number;
  quantity: number;
  /** Euros off one unit agreed with them, as text ('' when none). */
  discount: string;
  /**
   * A line discounted before discounts were per unit: its flat figure, so it
   * previews at what it costs until its quantity moves (then the server reads
   * it per unit, as the rep builder does).
   */
  flatDiscount?: string;
  imageUrl: string | null;
  vatCategory: VatCategory;
}

type ItemRow = OrderItem & {
  vat_category?: VatCategory;
  product?: { vat_category?: VatCategory | null; vat_category_reviewed?: boolean | null } | null;
};

/** The order's lines, as rows. */
export function seedLines(items: OrderItem[], lang: 'es' | 'en'): EditLine[] {
  return (items as ItemRow[]).map((i) => {
    const s = i.product_snapshot;
    return {
      key: i.id,
      orderItemId: i.id,
      variantId: i.variant_id,
      name: (lang === 'en' && s?.name_en) || s?.name_es || '—',
      sizeName: (lang === 'en' && s?.variant_name_en) || s?.variant_name_es || '',
      unitPrice: Number(i.unit_price),
      quantity: i.quantity,
      discount: unitDiscountText(i),
      ...(Number(i.unit_discount ?? 0) <= 0 && Number(i.discount_amount ?? 0) > 0
        ? { flatDiscount: String(Number(i.discount_amount)) }
        : {}),
      imageUrl: s?.image_url ?? null,
      vatCategory: lineVatCategory(i),
    };
  });
}

/**
 * A size from the catalogue panel, as a new row. Its price is the wholesale
 * one and any price agreed with them rides as the discount — exactly what the
 * server writes when it adds the line (lib/editOrder: the saved discount for
 * an add that states none), so the preview is the charge.
 */
export function lineFromCatalogue(p: BusinessProduct, v: BusinessSize, lang: 'es' | 'en', key: string): EditLine {
  const { pay, agreed } = pricesOf(v);
  return {
    key,
    variantId: v.id,
    name: nameOf(p, lang),
    sizeName: nameOf(v, lang),
    unitPrice: agreed && v.compare_at_price != null ? Number(v.compare_at_price) : pay,
    quantity: 1,
    discount: agreed ? String(Number(v.customer_discount)) : '',
    imageUrl: p.images?.[0]?.url ?? null,
    vatCategory: effectiveVatCategory(p),
  };
}

/** What the shared preview prices a row at: per unit, or an older line's flat figure. */
export function previewOf(l: EditLine): PreviewLine {
  return l.flatDiscount !== undefined
    ? { unitPrice: l.unitPrice, quantity: l.quantity, discount: l.flatDiscount }
    : { unitPrice: l.unitPrice, quantity: l.quantity, unitDiscount: l.discount };
}

/**
 * The edit, as operations: one per changed row (the server refuses two that
 * touch one line), removals and quantity changes against the rows as the
 * screen opened, then every new row as an add. A customer states no
 * discount — the server applies the one agreed with them.
 */
export function operationsOf(baseline: EditLine[], lines: EditLine[]): CustomerOrderEditOperation[] {
  const ops: CustomerOrderEditOperation[] = [];
  const live = new Map(lines.map((l) => [l.key, l]));
  for (const was of baseline) {
    const now = live.get(was.key);
    if (!now) ops.push({ action: 'remove', order_item_id: was.orderItemId! });
    else if (now.quantity !== was.quantity) {
      ops.push({ action: 'update_qty', order_item_id: was.orderItemId!, new_quantity: now.quantity });
    }
  }
  for (const l of lines) {
    if (!l.orderItemId) ops.push({ action: 'add', new_variant_id: l.variantId, new_quantity: l.quantity });
  }
  return ops;
}
