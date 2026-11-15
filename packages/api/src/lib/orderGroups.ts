import { Prisma, OrderStatus } from '@prisma/client';
import prisma from './prisma';
import { deriveParentOrderStatus } from './parentOrder';

/**
 * One customer purchase, however many Order rows it took to store it.
 *
 * Checkout buckets a cart by (store, availability) and writes a ParentOrder
 * with one sub-Order per bucket — and not only for multi-store carts: with
 * MV_DRAFT_ORDERS on, which is the default, a single shop holding one
 * out-of-stock item yields two subs. So any list of raw Order rows shows one
 * purchase as several unrelated lines.
 *
 * The admin orders list solves this by paging over groups in SQL
 * (routes/admin/orders.ts). This is the other shape of the same problem: the
 * N most recent purchases for ONE customer, where paging is not wanted and a
 * second query keyed on the chosen groups is exact and cheap.
 */

const SUB_SELECT = {
  id: true,
  order_number: true,
  status: true,
  total: true,
  created_at: true,
  parent_order_id: true,
  store: { select: { id: true, name: true } },
  _count: { select: { items: true } },
  rashan_subscription_id: true,
  scheduled_for: true,
  cancelled_reason: true,
} satisfies Prisma.OrderSelect;

type SubOrder = Prisma.OrderGetPayload<{ select: typeof SUB_SELECT }>;

export interface OrderGroup {
  /** Where to navigate: the parent's id for a split, else the order's own. */
  id: string;
  /** The parent's "…-P" number for a split purchase, else the order's own. */
  order_number: string;
  is_split: boolean;
  /** Derived across the parts for a split — including partially_completed. */
  status: OrderStatus;
  total: Prisma.Decimal;
  /** Items across every part, not just the first. */
  item_count: number;
  created_at: Date;
  /** How many Order rows this purchase is stored as. */
  part_count: number;
  /** Distinct shops in the purchase; `null` is the Cesto house store. */
  stores: Array<{ id: string; name: string } | null>;
  /** A Home Grocery plan's delivery: its planned day, and whether it was skipped. */
  plan: { scheduled_for: string | null; skipped: boolean } | null;
}

/** `COALESCE(parent_order_id, id)` — a plain order is a group of one. */
const groupKeyOf = (o: { id: string; parent_order_id: string | null }): string =>
  o.parent_order_id ?? o.id;

/**
 * The `limit` most recent purchases for one customer, newest first.
 *
 * Two queries. The first reads raw rows to find WHICH groups are the most
 * recent; the second reads every part of those groups, so a part count is
 * never truncated by where the first query happened to stop.
 */
export async function recentOrderGroupsForUser(userId: string, limit: number): Promise<OrderGroup[]> {
  // Over-fetch: a purchase split four ways is four rows but one group, so
  // reading `limit` rows would not yield `limit` groups.
  const recent = await prisma.order.findMany({
    where: { user_id: userId, deleted_at: null },
    select: { id: true, parent_order_id: true },
    orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
    take: limit * 6,
  });

  const groupIds: string[] = [];
  for (const row of recent) {
    const key = groupKeyOf(row);
    if (!groupIds.includes(key)) groupIds.push(key);
    if (groupIds.length >= limit) break;
  }
  if (groupIds.length === 0) return [];

  const [parts, parents] = await Promise.all([
    // Every part of the chosen groups, not just the ones the first query saw.
    // `id IN` picks up standalone orders, whose own id is the group key; a
    // sub-order's id is never a group key, so the arms cannot overlap.
    prisma.order.findMany({
      where: {
        deleted_at: null,
        OR: [{ parent_order_id: { in: groupIds } }, { id: { in: groupIds } }],
      },
      select: SUB_SELECT,
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    }),
    prisma.parentOrder.findMany({
      where: { id: { in: groupIds } },
      select: { id: true, order_number: true, total: true, created_at: true },
    }),
  ]);

  const byGroup = new Map<string, SubOrder[]>();
  for (const part of parts) {
    const key = groupKeyOf(part);
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(part);
    else byGroup.set(key, [part]);
  }
  const parentById = new Map(parents.map((p) => [p.id, p]));

  return groupIds.flatMap((id): OrderGroup[] => {
    const group = byGroup.get(id) ?? [];
    // A parent whose every part is soft-deleted matched nothing above. Drop
    // it rather than render a purchase with no contents.
    if (group.length === 0) return [];
    const parent = parentById.get(id) ?? null;
    const head = group[0];

    const stores: Array<{ id: string; name: string } | null> = [];
    for (const part of group) {
      if (!stores.some((s) => (s?.id ?? null) === (part.store?.id ?? null))) {
        stores.push(part.store ?? null);
      }
    }

    return [{
      id,
      order_number: parent?.order_number ?? head.order_number,
      is_split: parent !== null,
      // A ParentOrder has no status column: it is a pure function of its
      // parts (lib/parentOrder.ts).
      status: parent ? deriveParentOrderStatus(group.map((p) => p.status)) : head.status,
      total: parent?.total ?? head.total,
      item_count: group.reduce((n, p) => n + p._count.items, 0),
      created_at: parent?.created_at ?? head.created_at,
      part_count: group.length,
      stores,
      // A plan's order is never split, so the head speaks for the group.
      plan: head.rashan_subscription_id
        ? {
          scheduled_for: head.scheduled_for ? head.scheduled_for.toISOString().slice(0, 10) : null,
          skipped: head.status === 'cancelled' && head.cancelled_reason === 'Skipped',
        }
        : null,
    }];
  });
}
