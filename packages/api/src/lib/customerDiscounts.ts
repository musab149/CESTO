import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { effectiveUnitPrice, pricingForAccount, VAT_FIELDS } from './pricing';

/**
 * Per-customer product discounts (2026-10-25, user request).
 *
 * A price agreed with one customer for one product size: euros off ONE unit,
 * set by staff or a rep on an order line and remembered. The product's own
 * price never changes. This customer sees and pays it less the discount in
 * the shop (lib/pricing.ts), and the next order built for them starts with
 * it on the line.
 *
 * THE LATEST ORDER WINS (user decision): a line that says a discount replaces
 * the saved one; a line cleared to zero deletes it. Only staff and reps write
 * here — a customer's own checkout and edits only read.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** Variant id → euros off one unit, for this customer. Empty for most. */
export async function savedDiscountsFor(
  userId: string,
  variantIds?: string[],
  db: Db = prisma,
): Promise<Map<string, Prisma.Decimal>> {
  if (variantIds && variantIds.length === 0) return new Map();
  const rows = await db.customerProductDiscount.findMany({
    where: { user_id: userId, ...(variantIds ? { variant_id: { in: variantIds } } : {}) },
    select: { variant_id: true, amount: true },
  });
  return new Map(rows.map((r) => [r.variant_id, r.amount]));
}

/** A line's say about one product size: euros off one unit, or null to forget it. */
export interface DiscountDecision {
  variantId: string;
  productId: string;
  amount: Prisma.Decimal | null;
}

/** Who said so, and on which order. Exactly one of the two ids. */
export interface DiscountSetter {
  orderId: string;
  adminId?: string | null;
  salesRepId?: string | null;
}

/**
 * Remember what these lines say for this customer, in two statements whatever
 * their number — a rep's 200-line order must not mean 200 round trips inside
 * the order's transaction.
 *
 * One product size appearing twice: the LAST line wins, like the order as a
 * whole. Callers pass only lines whose discount was actually stated — a
 * client from before per-unit discounts states nothing and changes nothing.
 */
export async function rememberDiscounts(
  db: Db,
  userId: string,
  decisions: DiscountDecision[],
  setter: DiscountSetter,
): Promise<void> {
  if (decisions.length === 0) return;
  const last = new Map<string, DiscountDecision>();
  for (const d of decisions) last.set(d.variantId, d);

  const forget = [...last.values()].filter((d) => !d.amount || d.amount.lte(0)).map((d) => d.variantId);
  const keep = [...last.values()].filter((d) => d.amount && d.amount.gt(0));

  if (forget.length > 0) {
    await db.customerProductDiscount.deleteMany({ where: { user_id: userId, variant_id: { in: forget } } });
  }
  if (keep.length > 0) {
    const adminId = setter.adminId ?? null;
    const salesRepId = setter.salesRepId ?? null;
    // Sorted by variant so two saves for one customer take the row locks in
    // the same order, as the stock updates do.
    keep.sort((a, b) => (a.variantId < b.variantId ? -1 : 1));
    await db.$executeRaw`
      INSERT INTO customer_product_discounts
        (id, user_id, product_id, variant_id, amount, order_id, set_by_admin_id, set_by_sales_rep_id, created_at, updated_at)
      VALUES ${Prisma.join(keep.map((d) => Prisma.sql`(
        ${randomUUID()}::uuid, ${userId}::uuid, ${d.productId}::uuid, ${d.variantId}::uuid,
        ${d.amount!.toFixed(2)}::numeric, ${setter.orderId}::uuid,
        ${adminId}::uuid, ${salesRepId}::uuid, NOW(), NOW()
      )`))}
      ON CONFLICT (user_id, variant_id) DO UPDATE
         SET amount              = EXCLUDED.amount,
             product_id          = EXCLUDED.product_id,
             order_id            = EXCLUDED.order_id,
             set_by_admin_id     = EXCLUDED.set_by_admin_id,
             set_by_sales_rep_id = EXCLUDED.set_by_sales_rep_id,
             updated_at          = NOW()
    `;
  }
}

/**
 * A customer's saved discounts as the customer page and the order builders
 * show them: the product and size, what the size normally costs THIS customer
 * (wholesale for a business, IVA included — the price the discount comes
 * off), the discount, and the order it was last set on. Newest first.
 */
export async function listSavedDiscounts(userId: string) {
  const [customer, rows] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { is_business: true } }),
    prisma.customerProductDiscount.findMany({
      where: { user_id: userId },
      orderBy: { updated_at: 'desc' },
      include: {
        product: {
          select: {
            id: true, name_es: true, name_en: true, brand: true, is_active: true,
            ...VAT_FIELDS,
            images: { orderBy: { sort_order: 'asc' }, take: 1, select: { url: true } },
          },
        },
        variant: { select: { id: true, name_es: true, name_en: true, price: true, b2b_price: true, is_active: true } },
        order: { select: { id: true, order_number: true } },
      },
    }),
  ]);
  const ctx = pricingForAccount(customer);
  return rows.map((r) => {
    const price = effectiveUnitPrice(r.variant, ctx, r.product);
    return {
      variant_id: r.variant_id,
      product_id: r.product_id,
      amount: r.amount,
      updated_at: r.updated_at,
      product: {
        name_es: r.product.name_es,
        name_en: r.product.name_en,
        brand: r.product.brand,
        image_url: r.product.images[0]?.url ?? null,
        is_active: r.product.is_active,
      },
      variant: { name_es: r.variant.name_es, name_en: r.variant.name_en, is_active: r.variant.is_active },
      /** What one unit costs them without the discount, and with it. */
      price,
      customer_price: r.amount.gte(price) ? new Prisma.Decimal(0) : price.minus(r.amount),
      order: r.order,
    };
  });
}

/** Forget one product size's discount for this customer. True when there was one. */
export async function forgetDiscount(userId: string, variantId: string): Promise<boolean> {
  const { count } = await prisma.customerProductDiscount.deleteMany({ where: { user_id: userId, variant_id: variantId } });
  return count > 0;
}

/**
 * A stated per-unit discount from a request, in money: a positive number to
 * the cent, or null for "none". `undefined` means the client said nothing.
 */
export function statedUnitDiscount(value: number | undefined): Prisma.Decimal | null | undefined {
  if (value === undefined) return undefined;
  return value > 0 ? new Prisma.Decimal(value.toFixed(2)) : null;
}
