import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../lib/async';
import { parsePage, paged } from '../lib/pagination';

const router = Router();

// ─── GET /api/notifications/vapid-public-key ────────────
// PUBLIC — the browser needs this before it can subscribe, and the flow
// happens before signup on some pages. Returns 503 if VAPID isn't wired.

router.get('/vapid-public-key', (_req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY?.trim();
  if (!key) return error(res, 'Web push is not configured on the server.', 503);
  return success(res, { publicKey: key });
});

router.use(requireAuth);

// ─── GET /api/notifications ─────────────────────────────
// Paged list, newest first. `unread=1` filters to unread only — used by
// the bell dropdown so it doesn't pull the whole archive.

router.get('/', asyncHandler(async (req, res) => {
  const params = parsePage(req.query, 20, 50);
  const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';

  const where: Prisma.NotificationWhereInput = {
    audience: 'customer',
    user_id: req.user!.userId,
    ...(unreadOnly && { read: false }),
  };

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

// ─── GET /api/notifications/unread-count ────────────────
// Cheap polling endpoint for the bell badge.

router.get('/unread-count', asyncHandler(async (req, res) => {
  const count = await prisma.notification.count({
    where: {
      audience: 'customer',
      user_id: req.user!.userId,
      read: false,
    },
  });
  return success(res, { count });
}));

// ─── POST /api/notifications/:id/read ───────────────────

router.post('/:id/read', asyncHandler(async (req, res) => {
  const updated = await prisma.notification.updateMany({
    where: {
      id: req.params.id,
      audience: 'customer',
      user_id: req.user!.userId,
      read: false,
    },
    data: { read: true, read_at: new Date() },
  });
  if (updated.count === 0) {
    // Either it's already read, or it doesn't belong to this user — treat
    // both as a no-op success so the client can mark optimistically and we
    // don't leak existence information.
    return success(res, { updated: 0 });
  }
  return success(res, { updated: updated.count });
}));

// ─── POST /api/notifications/read-all ───────────────────

router.post('/read-all', asyncHandler(async (req, res) => {
  const updated = await prisma.notification.updateMany({
    where: {
      audience: 'customer',
      user_id: req.user!.userId,
      read: false,
    },
    data: { read: true, read_at: new Date() },
  });
  return success(res, { updated: updated.count });
}));

// ─── DELETE /api/notifications/:id ──────────────────────
// Lets the user swipe-dismiss from the inbox.

router.delete('/:id', asyncHandler(async (req, res) => {
  const deleted = await prisma.notification.deleteMany({
    where: {
      id: req.params.id,
      audience: 'customer',
      user_id: req.user!.userId,
    },
  });
  if (deleted.count === 0) return error(res, 'Notification not found.', 404);
  return success(res, { deleted: deleted.count });
}));

// ─── POST /api/notifications/web-subscribe ──────────────
// Save a browser Push subscription. Idempotent on `endpoint` — the same
// browser calling this twice just refreshes the keys and links to the
// current user (handles account switching on a shared browser).

const webSubscribeSchema = z.object({
  endpoint: z.string().url().min(20).max(2000),
  keys: z.object({
    p256dh: z.string().min(20).max(500),
    auth: z.string().min(8).max(500),
  }),
  userAgent: z.string().max(500).optional(),
});

router.post('/web-subscribe', validate(webSubscribeSchema), asyncHandler(async (req, res) => {
  const { endpoint, keys, userAgent } = req.body as z.infer<typeof webSubscribeSchema>;
  await prisma.webPushSubscription.upsert({
    where: { endpoint },
    create: {
      user_id: req.user!.userId,
      admin_id: null,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: userAgent ?? null,
    },
    // If this endpoint was previously an admin's, flip it back to the
    // current customer and null out admin_id (shared-browser handoff).
    update: {
      user_id: req.user!.userId,
      admin_id: null,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: userAgent ?? null,
    },
  });
  return success(res, { message: 'Subscribed.' });
}));

// ─── POST /api/notifications/web-unsubscribe ────────────
// Called from the browser when the user disables notifications, and
// from logout so the next user on the same browser doesn't get pushes
// meant for the previous account.

const webUnsubscribeSchema = z.object({
  endpoint: z.string().url().min(20).max(2000),
});

router.post('/web-unsubscribe', validate(webUnsubscribeSchema), asyncHandler(async (req, res) => {
  const { endpoint } = req.body as z.infer<typeof webUnsubscribeSchema>;
  const deleted = await prisma.webPushSubscription.deleteMany({
    where: { endpoint, user_id: req.user!.userId },
  });
  return success(res, { deleted: deleted.count });
}));

export default router;
