import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { paged, type PageParams } from './pagination';
import { deriveParentOrderStatus } from './parentOrder';
import { BUILT_BY_US_SQL, BUILT_BY_REP_SQL, PLACED_BY_CUSTOMER_SQL } from './orderSource';

/**
 * One row per customer PURCHASE, not per Order row.
 *
 * A checkout can be stored as several Orders — split by store, and also by
 * availability, since an out-of-stock item is routed into its own `draft`
 * sub-order even when the cart never left one shop. Rendering the raw rows
 * showed a single purchase two or three times with different numbers and
 * part-totals.
 *
 * Extracted from routes/admin/orders.ts so the sales-rep order list is the
 * same list. Grouping is not a feature, it is what the data means — and a rep
 * looking at a split purchase has exactly the admin's problem, so they get
 * exactly the admin's answer rather than a second implementation that rounds
 * the parts up differently.
 *
 * `extraConds` is how a caller narrows it. The rep list passes
 * `created_by_sales_rep_id = <them>`, which lands inside the same WHERE as
 * every other condition — so the grouping, the counting and the paging all see
 * the narrowed set, rather than a full page being fetched and then filtered
 * down to three rows.
 */

export interface OrderGroupFilters {
  status?: string;
  q?: string;
  from?: string;
  to?: string;
  riderId?: string;
  userId?: string;
  /** One sales rep's orders (the rep profile's "view all"). */
  salesRepId?: string;
  source?: string;
  customerType?: 'retail' | 'b2b';
  /** Newest first unless asked otherwise. */
  sort?: 'asc' | 'desc';
}

const GROUP_SUB_SELECT = {
  id: true, order_number: true, status: true, total: true, subtotal: true,
  delivery_fee: true, payment_method: true, created_at: true, parent_order_id: true,
  user: { select: { id: true, name: true, phone: true, business_profile: { select: { company: true } } } },
  rider: { select: { id: true, name: true } },
  store: { select: { id: true, slug: true, name: true } },
  _count: { select: { items: true } },
  // Who built it. The ids alone could only answer "somebody here did", which
  // the books already say by existing — what ops wants off a list of
  // rep-built orders is which rep.
  created_by_admin: { select: { id: true, name: true } },
  created_by_sales_rep: { select: { id: true, name: true } },
  // A Home Grocery plan's delivery, and the day it is planned for.
  rashan_subscription_id: true,
  scheduled_for: true,
  cancelled_reason: true,
} satisfies Prisma.OrderSelect;

/** Escapes LIKE wildcards, so searching for "50%" doesn't match every order. */
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listGroupedOrders(
  filters: OrderGroupFilters,
  params: PageParams,
  /** Extra WHERE conditions, ANDed with the rest. The rep list scopes
   *  itself to its own orders through this. */
  extraConds: Prisma.Sql[] = [],
) {
  const { status, q, from, to, riderId, userId, salesRepId, source, customerType, sort } = filters;

  // Every condition matches against SUB-orders: a group qualifies when any
  // one of its subs does. Filtering to "preparing" and then hiding that
  // group's already-delivered sibling would recreate the split this endpoint
  // exists to undo — the admin wants the whole purchase, found by any part.
  const conds: Prisma.Sql[] = [Prisma.sql`o.deleted_at IS NULL`, ...extraConds];
  if (status) conds.push(Prisma.sql`o.status = ${status}::"OrderStatus"`);
  if (riderId) conds.push(Prisma.sql`o.rider_id = ${riderId}::uuid`);
  if (userId) conds.push(Prisma.sql`o.user_id = ${userId}::uuid`);
  if (salesRepId) conds.push(Prisma.sql`o.created_by_sales_rep_id = ${salesRepId}::uuid`);
  // Both creator columns, via lib/orderSource — a rep is not an admin, and a
  // book that only asked about staff stopped counting their orders.
  if (source === 'customer') conds.push(PLACED_BY_CUSTOMER_SQL);
  if (source === 'admin' || source === 'rashan') conds.push(BUILT_BY_US_SQL);
  // The Cesto Salesman tab. Crosses the other books rather than sitting
  // beside them, so it arrives with no customerType.
  if (source === 'sales_rep') conds.push(BUILT_BY_REP_SQL);
  // `u` is already joined below for the name search.
  // COALESCE so a pre-column order still lands somewhere sensible.
  if (customerType === 'b2b') {
    conds.push(Prisma.sql`COALESCE(o.buyer_is_business, u.is_business) = true`);
  }
  if (customerType === 'retail') {
    conds.push(Prisma.sql`COALESCE(o.buyer_is_business, u.is_business) = false`);
  }
  // AT TIME ZONE 'UTC': the column holds UTC, but against a Date parameter
  // Postgres reads it in the session's zone, and not every database runs in UTC.
  if (from) conds.push(Prisma.sql`o.created_at >= (${new Date(from)}::timestamptz AT TIME ZONE 'UTC')`);
  if (to) conds.push(Prisma.sql`o.created_at <= (${new Date(to)}::timestamptz AT TIME ZONE 'UTC')`);
  if (q) {
    const term = likeTerm(q);
    // p.order_number is searched because the parent's "…-P" number is what
    // the customer sees on a split receipt, yet it exists on no Order row —
    // pasting it into admin search used to return nothing at all.
    conds.push(Prisma.sql`(
      o.order_number ILIKE ${term}
      OR p.order_number ILIKE ${term}
      OR u.name ILIKE ${term}
      OR u.phone ILIKE ${term}
      OR bp.company ILIKE ${term}
    )`);
  }

  const scope = Prisma.sql`
    FROM "orders" o
    LEFT JOIN "parent_orders" p ON p.id = o.parent_order_id
    LEFT JOIN "users" u ON u.id = o.user_id
    LEFT JOIN "business_profiles" bp ON bp.user_id = u.id
    WHERE ${Prisma.join(conds, ' AND ')}`;

  const [keys, counted] = await Promise.all([
    prisma.$queryRaw<{ group_id: string; sort_at: Date }[]>`
      SELECT COALESCE(o.parent_order_id, o.id)::text AS group_id,
             MAX(o.created_at) AS sort_at
      ${scope}
      GROUP BY 1
      ORDER BY sort_at ${Prisma.raw(sort === 'asc' ? 'ASC' : 'DESC')}, group_id
      LIMIT ${params.limit} OFFSET ${params.skip}`,
    prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
        FROM (SELECT COALESCE(o.parent_order_id, o.id) ${scope} GROUP BY 1) g`,
  ]);

  const total = counted[0]?.count ?? 0;
  const ids = keys.map((k) => k.group_id);
  if (ids.length === 0) return paged([], total, params);

  const [subs, parents] = await Promise.all([
    // `id IN ids` picks up standalone orders, whose own id is the group key;
    // a sub-order's id is never a group key, so the two arms can't overlap.
    prisma.order.findMany({
      where: { deleted_at: null, OR: [{ parent_order_id: { in: ids } }, { id: { in: ids } }] },
      select: GROUP_SUB_SELECT,
      orderBy: { created_at: 'asc' },
    }),
    prisma.parentOrder.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, order_number: true, subtotal: true, delivery_fee_total: true,
        total: true, payment_method: true, created_at: true,
        user: { select: { id: true, name: true, phone: true, business_profile: { select: { company: true } } } },
      },
    }),
  ]);

  const byGroup = new Map<string, typeof subs>();
  for (const o of subs) {
    const key = o.parent_order_id ?? o.id;
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(o);
    else byGroup.set(key, [o]);
  }
  const parentById = new Map(parents.map((p) => [p.id, p]));

  const items = ids.flatMap((id) => {
    const group = byGroup.get(id) ?? [];
    // A parent whose every sub is soft-deleted matched nothing above, so an
    // empty group means the row was concurrently hidden. Drop it rather than
    // render a purchase with no contents.
    if (group.length === 0) return [];
    const parent = parentById.get(id) ?? null;
    const head = group[0];
    const buyer = parent?.user ?? head.user;

    // Distinct stores, keeping null for the Cesto house store — the same
    // convention as Product.store_id, resolved to a display name by the UI.
    const stores: Array<{ id: string; slug: string; name: string } | null> = [];
    for (const o of group) {
      if (!stores.some((s) => (s?.id ?? null) === (o.store?.id ?? null))) stores.push(o.store ?? null);
    }

    const riders = [...new Map(group.filter((o) => o.rider).map((o) => [o.rider!.id, o.rider!])).values()];

    const madeBy = group.find((o) => o.created_by_sales_rep || o.created_by_admin);
    const builtBy = madeBy?.created_by_sales_rep
      ? { ...madeBy.created_by_sales_rep, is_rep: true }
      : madeBy?.created_by_admin
        ? { ...madeBy.created_by_admin, is_rep: false }
        : null;

    return [{
      id,
      order_number: parent?.order_number ?? head.order_number,
      /** True when the group is a real ParentOrder, however many subs survive. */
      is_split: parent !== null,
      // A ParentOrder has no status column: it is a pure function of its subs
      // (lib/parentOrder.ts), including the mixed-terminal partially_completed.
      status: parent ? deriveParentOrderStatus(group.map((o) => o.status)) : head.status,
      total: parent?.total ?? head.total,
      subtotal: parent?.subtotal ?? head.subtotal,
      delivery_fee: parent?.delivery_fee_total ?? head.delivery_fee,
      payment_method: parent?.payment_method ?? head.payment_method,
      created_at: parent?.created_at ?? head.created_at,
      // `company` flattened beside the name: a business account is known by
      // its trading name, and the rep's lists lead with it.
      user: buyer
        ? { id: buyer.id, name: buyer.name, phone: buyer.phone, company: buyer.business_profile?.company ?? null }
        : null,
      item_count: group.reduce((n, o) => n + o._count.items, 0),
      stores,
      /**
       * Who built the purchase, when it was not the customer.
       *
       * Derived here rather than left to each screen to dig out of
       * `sub_orders`: a split is built ONCE and then stored as several Orders,
       * so every part names the same person and a caller picking the first
       * part would look like it was making an arbitrary choice.
       *
       * `is_rep` rather than two nullable fields, because the label is the
       * same question either way and the screens only branch on whether there
       * is a page to link to.
       */
      built_by: builtBy,
      /**
       * Set when this is a Home Grocery plan's delivery: the day it is
       * planned for ('YYYY-MM-DD'). A plan's order is never split, so the
       * head speaks for the group.
       */
      plan: head.rashan_subscription_id
        ? {
          scheduled_for: head.scheduled_for ? head.scheduled_for.toISOString().slice(0, 10) : null,
          skipped: head.status === 'cancelled' && head.cancelled_reason === 'Skipped',
        }
        : null,
      /** The one rider, when the whole purchase has exactly one; else null. */
      rider: riders.length === 1 ? riders[0] : null,
      rider_count: riders.length,
      sub_orders: group,
    }];
  });

  return paged(items, total, params);
}
