import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { BUILT_BY_US, BUILT_BY_REP, PLACED_BY_CUSTOMER } from '../../lib/orderSource';
import { success } from '../../lib/response';
import { asyncHandler } from '../../lib/async';

const router = Router();

// ─── Range helpers ──────────────────────────────────────

type RangeKey = 'today' | '7d' | '30d' | 'month' | 'year';

const VALID_RANGES: ReadonlyArray<RangeKey> = ['today', '7d', '30d', 'month', 'year'];

function startOfDay(d: Date) {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

function windowFor(range: RangeKey): { from: Date; to: Date } {
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

  switch (range) {
    case 'today':
      return { from: today, to: tomorrow };
    case '30d': {
      const from = new Date(today); from.setDate(from.getDate() - 29);
      return { from, to: tomorrow };
    }
    case 'month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { from, to };
    }
    case 'year': {
      const from = new Date(now.getFullYear(), 0, 1);
      const to = new Date(now.getFullYear() + 1, 0, 1);
      return { from, to };
    }
    case '7d':
    default: {
      const from = new Date(today); from.setDate(from.getDate() - 6);
      return { from, to: tomorrow };
    }
  }
}

// ─── GET /api/admin/dashboard/stats ─────────────────────

router.get('/stats', asyncHandler(async (req, res) => {
  const requested = String(req.query.range ?? 'today') as RangeKey;
  const range: RangeKey = VALID_RANGES.includes(requested) ? requested : 'today';
  const { from, to } = windowFor(range);

  /**
   * A rep-built order, which is the rashan book — see the `source` filter on
   * GET /api/admin/orders. Every rashan figure below is counted directly and
   * the customer one is the remainder, so the two halves always add up to the
   * total shown beside them. Counting both independently would let rounding,
   * a race, or a later change to one WHERE clause produce a split that does
   * not reconcile, which on a revenue tile is worse than useless.
   */
  // Both creator columns — a rep is a User, not an Admin, so a book that
  // only asked about staff stopped counting their orders. See lib/orderSource.
  // A function, not a constant to spread: BUILT_BY_US is an OR, and spreading
  // it beside anything else that carries an OR drops one of the two silently.
  const rashan = (extra: Prisma.OrderWhereInput): Prisma.OrderWhereInput => ({
    AND: [BUILT_BY_US, extra],
  });

  /**
   * The same four books the orders page shows as tabs, each counted EXACTLY as
   * its tab lists it — a card that disagrees with the page it links to is
   * worse than no card.
   *
   * Not a partition any more, because the tabs are not one: Cesto Wholesale
   * is every wholesale order, however it was placed, and Cesto Salesman is
   * every order a rep built, retail or wholesale, so it overlaps the others.
   * The cards had stayed on the old four quadrants, and Salesman — "built by
   * a rep" — was counting every wholesale order WE built: the office's, and
   * since Home Grocery, a business household's plan deliveries, none of which
   * a rep touched. On staging it read 6 while its tab listed 18.
   */
  // Same snapshot-with-fallback the order list uses — a card that disagreed
  // with the tab it links to is exactly what this split exists to avoid.
  const buyer = (wanted: boolean): Prisma.OrderWhereInput => ({
    OR: [
      { buyer_is_business: wanted },
      { buyer_is_business: null, user: { is_business: wanted } },
    ],
  });

  // AND, not a spread. `buyer()` is an OR and so is BUILT_BY_US; spread into
  // one object the second silently replaces the first and every figure here
  // is wrong without anything failing.
  const BOOKS: Record<string, Prisma.OrderWhereInput> = {
    customer:  { AND: [PLACED_BY_CUSTOMER, buyer(false)] },
    rashan:    { AND: [BUILT_BY_US,        buyer(false)] },
    b2bOnline: buyer(true),
    b2bRep:    BUILT_BY_REP,
  };

  const bookStats = async (scope: Prisma.OrderWhereInput) => {
    const [orders, revenueAgg, pendingOrders, activeOrders, draftOrders] = await Promise.all([
      prisma.order.count({ where: { created_at: { gte: from, lt: to }, deleted_at: null, ...scope } }),
      prisma.order.aggregate({
        _sum: { total: true },
        where: { created_at: { gte: from, lt: to }, status: { not: 'cancelled' }, deleted_at: null, ...scope },
      }),
      prisma.order.count({ where: { status: 'pending', deleted_at: null, ...scope } }),
      prisma.order.count({
        where: { status: { in: ['confirmed', 'preparing', 'on_the_way'] }, deleted_at: null, ...scope },
      }),
      prisma.order.count({ where: { status: 'draft', deleted_at: null, ...scope } }),
    ]);
    return {
      orders,
      revenue: Number(revenueAgg._sum.total ?? 0),
      pendingOrders, activeOrders, draftOrders,
    };
  };

  const [
    periodOrders,
    periodRevenueAgg,
    pendingCount,
    activeOrders,
    totalUsers,
    totalProducts,
    lowStockCount,
    draftCount,
    rashanPeriodOrders,
    rashanPeriodRevenueAgg,
    rashanPending,
    rashanActive,
    rashanDraft,
  ] = await Promise.all([
    // deleted_at: null everywhere below — a soft-deleted (admin-hidden
    // test/mistake) order must never count toward revenue or any other
    // stat, which is the entire point of the delete feature.
    prisma.order.count({ where: { created_at: { gte: from, lt: to }, deleted_at: null } }),
    prisma.order.aggregate({
      _sum: { total: true },
      where: {
        created_at: { gte: from, lt: to },
        status: { not: 'cancelled' },
        deleted_at: null,
      },
    }),
    prisma.order.count({ where: { status: 'pending', deleted_at: null } }),
    prisma.order.count({ where: { status: { in: ['confirmed', 'preparing', 'on_the_way'] }, deleted_at: null } }),
    prisma.user.count({ where: { status: 'active' } }),
    prisma.product.count({ where: { is_active: true } }),
    prisma.productVariant.count({
      where: { is_active: true, stock_quantity: { lte: 10 } },
    }),
    // Draft orders don't count as pending/active — they aren't fulfillable
    // yet, so they get their own KPI rather than silently inflating (or
    // vanishing from) the existing tiles.
    prisma.order.count({ where: { status: 'draft', deleted_at: null } }),

    // The same five windows again, narrowed to the rashan book.
    prisma.order.count({
      where: rashan({ created_at: { gte: from, lt: to }, deleted_at: null }),
    }),
    prisma.order.aggregate({
      _sum: { total: true },
      where: rashan({
        created_at: { gte: from, lt: to },
        status: { not: 'cancelled' },
        deleted_at: null,
      }),
    }),
    prisma.order.count({ where: rashan({ status: 'pending', deleted_at: null }) }),
    prisma.order.count({
      where: rashan({ status: { in: ['confirmed', 'preparing', 'on_the_way'] }, deleted_at: null }),
    }),
    prisma.order.count({ where: rashan({ status: 'draft', deleted_at: null }) }),
  ]);

  const periodRevenue = Number(periodRevenueAgg._sum.total ?? 0);
  const rashanRevenue = Number(rashanPeriodRevenueAgg._sum.total ?? 0);

  const [bCustomer, bRashan, bB2bOnline, bB2bRep] = await Promise.all([
    bookStats(BOOKS.customer), bookStats(BOOKS.rashan),
    bookStats(BOOKS.b2bOnline), bookStats(BOOKS.b2bRep),
  ]);

  return success(res, {
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    period: {
      orders: periodOrders,
      revenue: periodRevenue,
    },
    pendingOrders: pendingCount,
    activeOrders,
    totalUsers,
    totalProducts,
    lowStockVariants: lowStockCount,
    draftOrders: draftCount,
    /** The four books of the orders page, one per tab, as each tab counts. Salesman overlaps the rest. */
    byBook: {
      customer: bCustomer,
      rashan: bRashan,
      b2bOnline: bB2bOnline,
      b2bRep: bB2bRep,
    },
    /** Deprecated: the coarser two-way split. Kept for one release. */
    bySource: {
      // `admin` is the name; `rashan` is the same object under the old key,
      // kept for one release so an admin deployed before this still renders
      // its by-book cards instead of showing nothing.
      admin: {
        orders: rashanPeriodOrders,
        revenue: rashanRevenue,
        pendingOrders: rashanPending,
        activeOrders: rashanActive,
        draftOrders: rashanDraft,
      },
      rashan: {
        orders: rashanPeriodOrders,
        revenue: rashanRevenue,
        pendingOrders: rashanPending,
        activeOrders: rashanActive,
        draftOrders: rashanDraft,
      },
      customer: {
        orders: periodOrders - rashanPeriodOrders,
        revenue: periodRevenue - rashanRevenue,
        pendingOrders: pendingCount - rashanPending,
        activeOrders: activeOrders - rashanActive,
        draftOrders: draftCount - rashanDraft,
      },
    },
  });
}));

// ─── GET /api/admin/dashboard/recent-orders ─────────────

router.get('/recent-orders', asyncHandler(async (_req, res) => {
  const orders = await prisma.order.findMany({
    where: { deleted_at: null },
    select: {
      id: true, order_number: true, status: true, total: true, created_at: true,
      user: { select: { name: true } },
    },
    orderBy: { created_at: 'desc' },
    take: 10,
  });
  return success(res, orders);
}));

export default router;
