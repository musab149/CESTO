import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { getDeliveryPricing } from '../../lib/delivery-pricing';
import { assignedScope, legacyStoreView, repStoresView } from '../../lib/repStore';
import { madridDayStart, madridToday } from '../../lib/repEarnings';

/**
 * Who the rep is, and how they are doing.
 *
 * The first endpoint of `/api/sales/*` — the surface the rep tablet app will
 * talk to. It carries the same figures the admin profile shows, because they
 * are the same question asked by two people, and computing them twice from
 * different columns is how two screens start disagreeing.
 *
 * `requireSalesRep()` is applied at the mount, so reaching this handler is
 * already proof of an active rep on a live account.
 */

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const me = req.salesRep!;

  // Today, in the rep's own terms: a day's work is what they have built since
  // midnight, not a rolling 24 hours — MADRID's midnight, where they work.
  // This was the server's, which runs on UTC: an order built at 00:30 in
  // Madrid counted as the day before for two hours of every summer night.
  const today = madridToday();
  const since = madridDayStart(today);
  // This month the same way, for the dashboard's sales card (2026-10-26).
  const monthStart = madridDayStart(`${today.slice(0, 7)}-01`);

  const orderWhere: Prisma.OrderWhereInput = {
    created_by_sales_rep_id: me.user.id,
    deleted_at: null,
  };

  const [todayRows, monthRows, allRows, clients, pricing, assigned] = await Promise.all([
    prisma.order.groupBy({
      by: ['status'],
      where: { ...orderWhere, created_at: { gte: since } },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.order.groupBy({
      by: ['status'],
      where: { ...orderWhere, created_at: { gte: monthStart } },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.order.groupBy({
      by: ['status'],
      where: orderWhere,
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.user.count({ where: { created_by_sales_rep_id: me.user.id } }),
    /**
     * The standard delivery fee, so the order screen can show what it would
     * charge before a rep decides to waive it.
     *
     * Here rather than behind its own endpoint: the layout already fetches
     * /sales/me on every rep screen, and a second request for one number that
     * changes about never is a round trip for nothing. It is the same figure
     * the storefront quotes any shopper — nothing here is privileged.
     */
    getDeliveryPricing(),
    // The products assigned to them by hand that they can sell now (lib/repStore).
    me.rep.store.products > 0
      ? prisma.product.count({ where: { is_active: true, ...assignedScope(me.user.id) } })
      : Promise.resolve(0),
  ]);

  // A cancelled order is work done but not money taken — see the admin
  // profile route, which splits them the same way for the same reason. A
  // draft is not money either: it is parked, not placed, and reserves nothing.
  const summarise = (rows: typeof allRows) => ({
    orders: rows.reduce((n, g) => n + g._count._all, 0),
    revenue: rows
      .filter((g) => g.status !== 'cancelled' && g.status !== 'draft')
      .reduce((sum, g) => sum.plus(g._sum.total ?? 0), new Prisma.Decimal(0))
      .toFixed(2),
  });

  return success(res, {
    user: me.user,
    rep: { code: me.rep.code, granted_at: me.rep.granted_at },
    /**
     * The shops they sell from (lib/repStore): empty when none is assigned,
     * `sellable: false` on one that cannot be sold from. With none to sell
     * from, the order screen says so instead of offering an empty catalogue.
     */
    stores: repStoresView(me.rep.store),
    /** Before 2026-10-26 a rep had one shop; kept for a page loaded before then. */
    store: legacyStoreView(me.rep.store),
    /**
     * Products assigned to them by hand, from any shop, that they can sell
     * now (2026-10-27). With some, a rep without a shop still builds orders.
     */
    assigned_products: assigned,
    stats: {
      today: summarise(todayRows),
      this_month: summarise(monthRows),
      all_time: summarise(allRows),
      clients_opened: clients,
    },
    settings: { delivery_fee: pricing.fee.toFixed(2) },
  });
}));

export default router;
