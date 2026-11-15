import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { madridDayStart, madridToday } from '../../lib/repEarnings';
import { businessProductScope } from '../../lib/businessCatalogue';

/**
 * GET /api/business/me — the business panel's dashboard in one call
 * (2026-10-29): who the business is, what it has spent and ordered, what is
 * on its way, and how much of the catalogue it can buy at wholesale.
 *
 * Counted the way the customer order list shows them (routes/orders GET /):
 * a purchase split across shops is ONE order (its ParentOrder), a standalone
 * order is one, and an order an admin hid (deleted_at) is not there at all.
 * Money is the sum of the orders themselves — a split purchase's parts add up
 * to it — leaving cancelled ones out. Orders a rep built for them are theirs
 * too: they are the buyer either way.
 */

const router = Router();

const IN_PROGRESS = ['pending', 'confirmed', 'preparing', 'on_the_way'] as const;

router.get('/', asyncHandler(async (req, res) => {
  const userId = req.business!.user.id;
  const monthStart = madridDayStart(`${madridToday().slice(0, 7)}-01`);

  const live: Prisma.OrderWhereInput = { user_id: userId, deleted_at: null };
  const counted: Prisma.OrderWhereInput = { ...live, status: { not: 'cancelled' } };
  // A purchase: a standalone order, or a split one counted once by its parent.
  const purchase = (extra: Prisma.OrderWhereInput = {}): Promise<number> =>
    Promise.all([
      prisma.order.count({ where: { ...counted, parent_order_id: null, ...extra } }),
      prisma.parentOrder.count({ where: { user_id: userId, sub_orders: { some: { ...counted, ...extra } } } }),
    ]).then(([solo, split]) => solo + split);

  const [user, monthSpent, allSpent, monthOrders, allOrders, active, delivered, catalogue] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true, email: true, phone: true, tax_id: true, created_at: true,
        business_profile: {
          select: {
            company: true, business_type: true, location: true, website: true,
            registration_no: true, contact_phone: true, approved_at: true,
          },
        },
      },
    }),
    prisma.order.aggregate({ where: { ...counted, created_at: { gte: monthStart } }, _sum: { total: true } }),
    prisma.order.aggregate({ where: counted, _sum: { total: true } }),
    purchase({ created_at: { gte: monthStart } }),
    purchase(),
    purchase({ status: { in: [...IN_PROGRESS] } }),
    purchase({ status: 'delivered' }),
    prisma.product.count({ where: businessProductScope }),
  ]);

  return success(res, {
    user: {
      name: user?.name ?? '',
      email: user?.email ?? null,
      phone: user?.phone ?? null,
      tax_id: user?.tax_id ?? null,
      created_at: user?.created_at ?? null,
    },
    business: user?.business_profile ?? null,
    stats: {
      this_month: { orders: monthOrders, spent: monthSpent._sum.total ?? new Prisma.Decimal(0) },
      all_time: { orders: allOrders, spent: allSpent._sum.total ?? new Prisma.Decimal(0) },
      in_progress: active,
      delivered,
    },
    catalogue: { products: catalogue },
  });
}));

export default router;
