import { Prisma } from '@prisma/client';

/**
 * Put an order's goods back on the shelf.
 *
 * The subtle part of cancelling, and the part worth having exactly once: the
 * quantities are NETTED PER VARIANT before anything is written, because the
 * same variant can sit on two lines and a loop would cost two round trips to
 * put one row back. One statement whatever the size, with the ids sorted so
 * concurrent transactions touching overlapping baskets take the row locks in
 * the same order — which is what keeps two simultaneous cancels from
 * deadlocking each other.
 *
 * A round-trip per line put a 48-line order's restock on the wrong side of the
 * transaction budget. That is the shape this exists to prevent happening again
 * in a second copy.
 *
 * WHAT IT DOES NOT DECIDE is whether to restock at all. A draft reserved
 * nothing, so giving its items back would invent stock; an already-cancelled
 * order has been given back once. Both rules belong to the caller, which knows
 * the transition it is making — this only knows how to add.
 */
export async function restockItems(
  tx: Prisma.TransactionClient,
  items: Array<{ variant_id: string; quantity: number }>,
): Promise<void> {
  const giveBack = new Map<string, number>();
  for (const item of items) {
    giveBack.set(item.variant_id, (giveBack.get(item.variant_id) ?? 0) + item.quantity);
  }
  if (giveBack.size === 0) return;

  const rows = [...giveBack.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  await tx.$executeRaw`
    UPDATE product_variants AS v
       SET stock_quantity = v.stock_quantity + d.qty
      FROM (VALUES ${Prisma.join(
        rows.map(([id, qty]) => Prisma.sql`(${id}::uuid, ${qty}::int)`),
      )}) AS d(id, qty)
     WHERE v.id = d.id
  `;
}
