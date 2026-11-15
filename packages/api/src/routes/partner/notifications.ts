import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { parsePage, paged } from '../../lib/pagination';

/**
 * A partner's inbox — the bell on their dashboard.
 *
 * Rows are written by lib/notifications.ts notifyPartnerOrder(), one per
 * login at the shop, with audience `partner`. Scoped to the signed-in login
 * AND the shop whose dashboard they are on (`data.store_id`), so somebody
 * with a role at two shops never reads one shop's orders on the other's.
 *
 * Mounted behind requirePartnerRole(), which is what puts both on the
 * request. Same shapes as /api/notifications, so the client renders a
 * partner row with the customer bell's types.
 */

const router = Router();

function mine(req: Express.Request): Prisma.NotificationWhereInput {
  const ctx = req.partnerRole!;
  return {
    audience: 'partner',
    user_id: ctx.user.id,
    data: { path: ['store_id'], equals: ctx.store.id },
  };
}

// ─── GET /api/partner/notifications ─────────────────────

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

// ─── GET /api/partner/notifications/unread-count ────────

router.get('/unread-count', asyncHandler(async (req, res) => {
  const count = await prisma.notification.count({ where: { ...mine(req), read: false } });
  return success(res, { count });
}));

// ─── POST /api/partner/notifications/:id/read ───────────
// A no-op success when it is already read or is not theirs — the same
// answer either way, so the id's existence is not given away.

router.post('/:id/read', asyncHandler(async (req, res) => {
  const updated = await prisma.notification.updateMany({
    where: { ...mine(req), id: req.params.id, read: false },
    data: { read: true, read_at: new Date() },
  });
  return success(res, { updated: updated.count });
}));

// ─── POST /api/partner/notifications/read-all ───────────

router.post('/read-all', asyncHandler(async (req, res) => {
  const updated = await prisma.notification.updateMany({
    where: { ...mine(req), read: false },
    data: { read: true, read_at: new Date() },
  });
  return success(res, { updated: updated.count });
}));

export default router;
