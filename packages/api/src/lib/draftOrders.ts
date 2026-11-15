// ─── Draft order resolution ─────────────────────────────────
// Shared by admin and partner "confirm stock" endpoints. Confirming a
// `draft` order is NOT a plain status flip like every other transition —
// it has to re-check current stock and decrement it, since draft items
// were deliberately never reserved at checkout. Kept here (rather than
// duplicated in both route files) so admin and partner can never drift on
// what "confirm" actually means.

import { Prisma, OrderStatus } from '@prisma/client';
import prisma from './prisma';

export interface DraftShortfall {
  productName: string;
  needed: number;
  available: number;
}

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

export type ResolveDraftResult =
  | { status: 'not_found' }
  | { status: 'not_draft'; currentStatus: OrderStatus }
  | { status: 'insufficient_stock'; shortfalls: DraftShortfall[] }
  | { status: 'resolved'; order: OrderWithItems };

/**
 * Re-validates stock for every item on a `draft` order. If every item now
 * has enough, decrements stock and moves the order to `pending` — NOT
 * `confirmed` — in one transaction. That's deliberate: resolving stock and
 * accepting the order into fulfilment are two different decisions. Landing
 * on `pending` makes a resolved draft indistinguishable from an order that
 * had stock all along, so it re-enters the normal pending → confirmed
 * acceptance step every other order goes through instead of skipping it.
 * Stays silent — no customer notification fires here, same as every other
 * path that lands an order on `pending` (see notifyOrderStatusChange's
 * "skip 'pending', it's never a target" convention). The customer hears
 * about it when the vendor/admin actually confirms it, same as normal.
 *
 * If any item is still short, returns the shortfall detail without
 * mutating anything — the order stays `draft`.
 *
 * `scopeWhere` lets a caller restrict which orders it's allowed to touch
 * (e.g. a partner passing their own `ownOrderWhere(storeId)`); admin passes
 * none.
 */
export async function resolveDraftOrder(
  orderId: string,
  scopeWhere: Prisma.OrderWhereInput = {},
): Promise<ResolveDraftResult> {
  return prisma.$transaction(async (tx) => {
    // Lock the row first. A Home Grocery draft can be rewritten from its plan
    // (createOrder.ts rewriteDraftOrder, which takes the same lock); without
    // this, a confirm could read one list and decrement it while the rewrite
    // commits another underneath.
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    const order = await tx.order.findFirst({
      where: { id: orderId, deleted_at: null, ...scopeWhere },
      include: { items: true },
    });
    if (!order) return { status: 'not_found' };
    if (order.status !== 'draft') return { status: 'not_draft', currentStatus: order.status };

    const variants = await tx.productVariant.findMany({
      where: { id: { in: order.items.map((i) => i.variant_id) } },
      select: { id: true, stock_quantity: true },
    });

    // NETTED PER VARIANT before anything is compared or taken. The same
    // variant can sit on two lines of one order — the admin create route
    // writes a line per basket entry, so a rep adding a product twice makes
    // two of them. Checked line by line, 3 and 3 both pass against a stock of
    // 5 and the order oversells by one; taken line by line, the same row is
    // visited twice to remove what one statement could.
    const wanted = new Map<string, number>();
    const nameFor = new Map<string, string>();
    for (const item of order.items) {
      wanted.set(item.variant_id, (wanted.get(item.variant_id) ?? 0) + item.quantity);
      const snap = item.product_snapshot as Prisma.JsonObject | null;
      if (typeof snap?.name_es === 'string') nameFor.set(item.variant_id, snap.name_es);
    }

    const shortfalls: DraftShortfall[] = [];
    for (const [variantId, needed] of wanted) {
      const available = variants.find((x) => x.id === variantId)?.stock_quantity ?? 0;
      if (available < needed) {
        shortfalls.push({
          productName: nameFor.get(variantId) ?? 'Producto',
          needed,
          available,
        });
      }
    }
    if (shortfalls.length > 0) return { status: 'insufficient_stock', shortfalls };

    // One statement, whatever the size — the shape create, delete and cancel
    // all use. A round-trip per line is what put a big order's confirm on the
    // wrong side of the transaction budget.
    const rows = [...wanted.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    await tx.$executeRaw`
      UPDATE product_variants AS v
         SET stock_quantity = v.stock_quantity - d.qty
        FROM (VALUES ${Prisma.join(
          rows.map(([id, qty]) => Prisma.sql`(${id}::uuid, ${qty}::int)`),
        )}) AS d(id, qty)
       WHERE v.id = d.id
    `;

    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status: 'pending' },
      include: { items: true },
    });
    return { status: 'resolved', order: updated };
  }, {
    // The budget create, edit, delete and cancel all carry, for the reason
    // editOrder.ts spells out: Neon suspends an idle compute and the wake-up
    // lands INSIDE the transaction, which can eat the whole of Prisma's
    // default 5s before any work starts.
    //
    // This one is not a status flip. It re-reads every line's stock, compares
    // it, and takes it — proportional to the order — so a big draft on a cold
    // database was the likeliest thing in the system to run out of time, and
    // it would then confirm fine on the retry against a warm one.
    maxWait: 5_000,
    timeout: 8_000,
  });
}
