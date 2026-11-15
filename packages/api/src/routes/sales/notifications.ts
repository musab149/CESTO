import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { parsePage, paged } from '../../lib/pagination';

/**
 * A sales rep's inbox — the bell in the rep panel (2026-10-26).
 *
 * Rows are written by lib/notifications.ts notifyRepOrder() and
 * notifyRepStatement(), with audience `sales_rep`: their earnings published
 * or paid, and an order they built delivered or cancelled.
 *
 * Mounted behind requireSalesRep(). The partner inbox's shapes, so the client
 * renders a rep row with the same types.
 */

const router = Router();

function mine(req: Express.Request): Prisma.NotificationWhereInput {
  return { audience: 'sales_rep', user_id: req.salesRep!.user.id };
}

// ─── GET /api/sales/notifications ───────────────────────

router.get('/', asyncHandler(async (req, res) => {
  const params = parsePage(req.query, 20, 50);
  const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
  const where: Prisma.NotificationWhereInput = { ...mine(req), ...(unreadOnly && { read: false }) };

  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: params.skip,
      take: params.limit,
    }),
    prisma.notification.count({ where }),
  ]);
  return success(res, paged(items, total, params));
}));

// ─── GET /api/sales/notifications/unread-count ──────────
// What the bell's badge polls.

router.get('/unread-count', asyncHandler(async (req, res) => {
  const count = await prisma.notification.count({ where: { ...mine(req), read: false } });
  return success(res, { count });
}));

// ─── POST /api/sales/notifications/:id/read ─────────────
// A no-op success when it is already read or is not theirs — the same answer
// either way, so the id's existence is not given away.

router.post('/:id/read', asyncHandler(async (req, res) => {
  const updated = await prisma.notification.updateMany({
    where: { ...mine(req), id: req.params.id, read: false },
    data: { read: true, read_at: new Date() },
  });
  return success(res, { updated: updated.count });
}));

// ─── POST /api/sales/notifications/read-all ─────────────

router.post('/read-all', asyncHandler(async (req, res) => {
  const updated = await prisma.notification.updateMany({
    where: { ...mine(req), read: false },
    data: { read: true, read_at: new Date() },
  });
  return success(res, { updated: updated.count });
}));

export default router;
