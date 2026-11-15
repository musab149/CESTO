/**
 * Server-side cart, persisted in Postgres (`cart_items`).
 *
 * ── Why the server keeps a cart at all ──
 * `POST /api/orders` accepts no line items from the client — only address,
 * slot, payment method and notes (see checkoutSchema). The order is built
 * from this cart, so a client cannot dictate quantities, and cannot dictate
 * prices either since they're looked up per variant. `POST /api/orders/quote`
 * prices the same rows, so the preview and the charge agree by construction.
 *
 * ── Why it is no longer a Map ──
 * This used to be `const carts = new Map<string, CartItem[]>()` in process
 * memory. That meant:
 *   · every deploy, crash or dev-server reload silently emptied every
 *     shopper's cart — including anyone mid-checkout, who then saw a blank
 *     order summary with no explanation;
 *   · two API instances meant two divergent carts, so the API could never
 *     scale beyond one process;
 *   · nothing ever evicted entries, so the Map grew for the process lifetime.
 *
 * These functions are async now. The call sites (routes/cart.ts,
 * routes/orders.ts) await them; the shape of the interface is unchanged so
 * the swap stayed contained.
 */

import type { Prisma } from '@prisma/client';
import prisma from './prisma';

export interface CartItem {
  productId: string;
  variantId: string;
  quantity: number;
}

/**
 * Anything exposing the Prisma model methods we need — the real client or a
 * transaction handle. Lets checkout read and clear the cart inside the same
 * transaction that decrements stock, so a rolled-back order doesn't take the
 * customer's cart with it.
 */
export type CartDb = Prisma.TransactionClient | typeof prisma;

/** Oldest first, so the cart reads in the order items were added. */
export async function getCart(userId: string, db: CartDb = prisma): Promise<CartItem[]> {
  const rows = await db.cartItem.findMany({
    where: { user_id: userId },
    select: { product_id: true, variant_id: true, quantity: true },
    orderBy: { created_at: 'asc' },
  });
  return rows.map((r) => ({
    productId: r.product_id,
    variantId: r.variant_id,
    quantity: r.quantity,
  }));
}

/**
 * Replace the whole cart. Delete-then-insert inside a transaction so a
 * concurrent read never observes a half-written cart (the old Map assignment
 * was atomic by accident; this is atomic on purpose).
 *
 * Items whose variant no longer exists are dropped rather than throwing — a
 * client replaying a stale local cart shouldn't hit a hard failure at
 * checkout over one dead line.
 */
export async function setCart(userId: string, items: CartItem[], db?: CartDb): Promise<void> {
  const run = async (tx: CartDb) => {
    await tx.cartItem.deleteMany({ where: { user_id: userId } });
    if (items.length === 0) return;

    const live = await tx.productVariant.findMany({
      where: { id: { in: items.map((i) => i.variantId) } },
      select: { id: true, product_id: true },
    });
    const productByVariant = new Map(live.map((v) => [v.id, v.product_id]));

    const rows = items
      .filter((i) => productByVariant.has(i.variantId))
      .map((i) => ({
        user_id: userId,
        // Trust the variant's own product_id over whatever the client sent,
        // so a mismatched pair can't write an inconsistent row.
        product_id: productByVariant.get(i.variantId)!,
        variant_id: i.variantId,
        quantity: Math.max(1, i.quantity),
      }));

    // skipDuplicates absorbs a payload that repeats the same variant.
    if (rows.length > 0) await tx.cartItem.createMany({ data: rows, skipDuplicates: true });
  };

  if (db) return run(db);
  await prisma.$transaction(run);
}

export async function clearCart(userId: string, db: CartDb = prisma): Promise<void> {
  await db.cartItem.deleteMany({ where: { user_id: userId } });
}

/**
 * Add to an existing line rather than replacing it — the semantics
 * `POST /api/cart/items` needs. Upsert keeps it one round trip and is safe
 * against the unique (user, variant) constraint under concurrency.
 */
export async function addToCart(userId: string, item: CartItem, db: CartDb = prisma): Promise<void> {
  await db.cartItem.upsert({
    where: { user_id_variant_id: { user_id: userId, variant_id: item.variantId } },
    create: {
      user_id: userId,
      product_id: item.productId,
      variant_id: item.variantId,
      quantity: Math.max(1, item.quantity),
    },
    update: { quantity: { increment: Math.max(1, item.quantity) } },
  });
}

/** Set an exact quantity for one line; quantity <= 0 removes it. */
export async function setCartItemQuantity(
  userId: string,
  variantId: string,
  quantity: number,
  db: CartDb = prisma,
): Promise<void> {
  if (quantity <= 0) {
    await db.cartItem.deleteMany({ where: { user_id: userId, variant_id: variantId } });
    return;
  }
  await db.cartItem.updateMany({
    where: { user_id: userId, variant_id: variantId },
    data: { quantity },
  });
}

export async function removeCartItem(
  userId: string,
  variantId: string,
  db: CartDb = prisma,
): Promise<void> {
  await db.cartItem.deleteMany({ where: { user_id: userId, variant_id: variantId } });
}
