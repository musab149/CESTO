import { Router } from 'express';
import prisma from '../../lib/prisma';
import { success } from '../../lib/response';
import { asyncHandler } from '../../lib/async';

const router = Router();

/**
 * Partner-scoped dashboard summary. Mirror of admin's
 * /api/admin/dashboard but every query is filtered by the partner's own
 * `store_id` (from req.partnerRole) — no cross-store leakage.
 *
 * Revenue is intentionally computed from item.line_total (not order.total)
 * so a multi-store checkout only attributes THIS store's items to this
 * store's revenue.
 */

type RangeKey = 'today' | '7d' | '30d' | 'month' | 'year';
const VALID_RANGES: ReadonlyArray<RangeKey> = ['today', '7d', '30d', 'month', 'year'];

function startOfDay(d: Date) {
  const n = new Date(d); n.setHours(0, 0, 0, 0); return n;
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
      const to   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { from, to };
    }
    case 'year': {
      const from = new Date(now.getFullYear(), 0, 1);
      const to   = new Date(now.getFullYear() + 1, 0, 1);
      return { from, to };
    }
    case '7d':
    default: {
      const from = new Date(today); from.setDate(from.getDate() - 6);
      return { from, to: tomorrow };
    }
  }
}

// ─── GET /api/partner/dashboard/stats ──────────────────

router.get('/stats', asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const requested = String(req.query.range ?? 'today') as RangeKey;
  const range: RangeKey = VALID_RANGES.includes(requested) ? requested : 'today';
  const { from, to } = windowFor(range);

  // Predicate: orders that have at least one item from the partner's store.
  const partnerOrderWhere = {
    items: { some: { product: { store_id: storeId } } },
  } as const;

  const [
    periodOrders,
    periodRevenueAgg,
    pendingCount,
    activeCount,
    unassignedActiveCount,
    totalCustomerIds,
    totalProducts,
    activeProducts,
    lowStockVariants,
    outOfStockVariants,
    activeRiders,
    store,
  ] = await Promise.all([
    // Orders count (period) — distinct orders that have any item from our
    // store, created in the window.
    prisma.order.count({
      where: { ...partnerOrderWhere, created_at: { gte: from, lt: to } },
    }),
    // Revenue — sum of line_total for OUR items only, on non-cancelled orders
    // in the window. Cross-store checkouts contribute only our slice.
    prisma.orderItem.aggregate({
      _sum: { line_total: true },
      where: {
        product: { store_id: storeId },
        order: {
          created_at: { gte: from, lt: to },
          status: { not: 'cancelled' },
        },
      },
    }),
    // Pending → needs your action to confirm.
    prisma.order.count({
      where: { ...partnerOrderWhere, status: 'pending' },
    }),
    // Active — orders you're actively fulfilling.
    prisma.order.count({
      where: { ...partnerOrderWhere, status: { in: ['confirmed', 'preparing', 'on_the_way'] } },
    }),
    // Confirmed / preparing / on_the_way without a rider — visible action item.
    prisma.order.count({
      where: {
        ...partnerOrderWhere,
        status: { in: ['confirmed', 'preparing', 'on_the_way'] },
        rider_id: null,
      },
    }),
    // Unique customers who've bought from this store — all-time.
    prisma.order.findMany({
      where: partnerOrderWhere,
      distinct: ['user_id'],
      select: { user_id: true },
    }),
    // Product counts.
    prisma.product.count({ where: { store_id: storeId } }),
    prisma.product.count({ where: { store_id: storeId, is_active: true } }),
    // Low stock — non-zero but at/below threshold.
    prisma.productVariant.count({
      where: {
        is_active: true,
        product: { store_id: storeId, is_active: true },
        stock_quantity: { gt: 0, lte: prisma.productVariant.fields.low_stock_threshold },
      },
    }),
    // Out of stock — zero on active variants of active products.
    prisma.productVariant.count({
      where: {
        is_active: true,
        product: { store_id: storeId, is_active: true },
        stock_quantity: { lte: 0 },
      },
    }),
    // Riders — active only, for the setup checklist.
    prisma.rider.count({ where: { store_id: storeId, is_active: true } }),
    // Store row — for the setup checklist. `address` and `status` joined the
    // select when delivery zones left it: a trading address is now the
    // geographic detail a partner fills in, and `status` drives the
    // waiting-for-approval banner.
    prisma.store.findUnique({
      where: { id: storeId },
      select: {
        logo_url: true, cover_url: true, contact_email: true, shop_hours: true,
        address: true, status: true,
      },
    }),
  ]);

  // Setup checklist — helps a fresh partner see what's still to do before
  // customers get a polished storefront. Booleans only; the frontend renders
  // the labels + deep-links.
  const hoursSetLocal = (() => {
    const h = store?.shop_hours as Record<string, unknown> | null | undefined;
    if (!h) return false;
    // "Set" = at least one weekday explicitly not marked closed.
    return Object.values(h).some((day) => {
      if (!day || typeof day !== 'object') return false;
      const d = day as { closed?: boolean };
      return d.closed === false;
    });
  })();
  const setup = {
    hasLogo:          !!store?.logo_url,
    hasCover:         !!store?.cover_url,
    hasContactEmail:  !!store?.contact_email,
    hasShopHours:     hoursSetLocal,
    hasProducts:      totalProducts > 0,
    // Replaced hasDeliveryZones. A partner no longer draws a service area —
    // they sell everywhere — so the geographic thing left to fill in is
    // where the shop actually is.
    hasAddress:       !!store?.address,
    hasRiders:        activeRiders > 0,
  };
  const setupDoneCount  = Object.values(setup).filter(Boolean).length;
  const setupTotalCount = Object.keys(setup).length;

  return success(res, {
    range,
    from: from.toISOString(),
    to:   to.toISOString(),
    period: {
      orders:  periodOrders,
      revenue: Number(periodRevenueAgg._sum.line_total ?? 0),
    },
    pendingOrders:      pendingCount,
    activeOrders:       activeCount,
    unassignedOrders:   unassignedActiveCount,
    totalCustomers:     totalCustomerIds.length,
    totalProducts,
    activeProducts,
    lowStockVariants,
    outOfStockVariants,
    activeRiders,
    // Publication state, so the dashboard can say "waiting for Cesto to
    // approve your store" instead of offering a publish button that 422s.
    // `draft` is pre-approval; only an admin can move it to `live`.
    storeStatus: store?.status ?? 'draft',
    awaitingApproval: store?.status === 'draft',
    setup,
    setupDoneCount,
    setupTotalCount,
  });
}));

// ─── GET /api/partner/dashboard/recent-orders ─────────

router.get('/recent-orders', asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const orders = await prisma.order.findMany({
    where: { items: { some: { product: { store_id: storeId } } } },
    select: {
      id: true, order_number: true, status: true, total: true, created_at: true,
      user:  { select: { name: true } },
      rider: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    },
    orderBy: { created_at: 'desc' },
    take: 8,
  });
  return success(res, orders);
}));

export default router;
