import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { parsePage, paged } from '../../lib/pagination';
import { pushDispatcher } from '../../lib/pushDispatcher';

const router = Router();

// ─── GET /api/admin/notifications ───────────────────────
// Activity feed for the admin bell dropdown. Admin rows are shared across
// all admins (user_id IS NULL); the read flag is therefore shared too —
// frontends that want per-admin read state should keep it client-side.

router.get('/', asyncHandler(async (req, res) => {
  const params = parsePage(req.query, 20, 100);
  const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';

  const where: Prisma.NotificationWhereInput = {
    audience: 'admin',
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

// ─── GET /api/admin/notifications/unread-count ──────────

router.get('/unread-count', asyncHandler(async (_req, res) => {
  const count = await prisma.notification.count({
    where: { audience: 'admin', read: false },
  });
  return success(res, { count });
}));

// ─── POST /api/admin/notifications/:id/read ─────────────

router.post('/:id/read', asyncHandler(async (req, res) => {
  const updated = await prisma.notification.updateMany({
    where: { id: req.params.id, audience: 'admin', read: false },
    data: { read: true, read_at: new Date() },
  });
  return success(res, { updated: updated.count });
}));

// ─── POST /api/admin/notifications/read-all ─────────────

router.post('/read-all', asyncHandler(async (_req, res) => {
  const updated = await prisma.notification.updateMany({
    where: { audience: 'admin', read: false },
    data: { read: true, read_at: new Date() },
  });
  return success(res, { updated: updated.count });
}));

// ─── POST /api/admin/notifications/broadcast ────────────
// Sends a customer-audience notification to a segment. One Notification row
// per recipient is persisted (so each user's inbox + read state works
// normally), and a best-effort push fan-out follows.

const broadcastSchema = z.object({
  title_es:    z.string().min(1).max(120),
  title_en:    z.string().min(1).max(120),
  body_es:     z.string().min(1).max(500),
  body_en:     z.string().min(1).max(500),
  deeplink:    z.string().max(500).optional().nullable(),
  /** "all" = every active user; "subscribers" = users with an active rashan
      subscription; "with_orders" = users who have placed ≥1 order. */
  segment:     z.enum(['all', 'subscribers', 'with_orders']).default('all'),
});

router.post('/broadcast', validate(broadcastSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof broadcastSchema>;

  const where: Prisma.UserWhereInput = { status: 'active' };
  if (body.segment === 'subscribers') {
    where.subscriptions = { some: { status: 'active' } };
  } else if (body.segment === 'with_orders') {
    where.orders = { some: {} };
  }

  const recipients = await prisma.user.findMany({
    where,
    select: { id: true, fcm_token: true, preferred_language: true },
  });

  if (recipients.length === 0) {
    return success(res, { recipients: 0, persisted: 0 });
  }

  // Bulk insert — one row per recipient. createMany skips the relation
  // back to User but we don't need it here.
  const rows: Prisma.NotificationCreateManyInput[] = recipients.map((u) => ({
    audience: 'customer',
    user_id: u.id,
    type: 'promo_banner',
    title_es: body.title_es,
    title_en: body.title_en,
    body_es: body.body_es,
    body_en: body.body_en,
    deeplink: body.deeplink ?? null,
    data: body.deeplink
      ? ({ deeplink: body.deeplink } as Prisma.InputJsonValue)
      : undefined,
  }));
  const persisted = await prisma.notification.createMany({ data: rows });

  // Best-effort push fan-out. Fire and forget so the HTTP response goes
  // back fast — pushDispatcher catches its own errors.
  for (const u of recipients) {
    const lang = u.preferred_language === 'en' ? 'en' : 'es';
    void pushDispatcher.send({
      token: u.fcm_token ?? null,
      title: lang === 'en' ? body.title_en : body.title_es,
      body:  lang === 'en' ? body.body_en  : body.body_es,
      data: {
        type: 'promo_banner',
        ...(body.deeplink ? { deeplink: body.deeplink } : {}),
      },
    });
  }

  return success(res, {
    recipients: recipients.length,
    persisted: persisted.count,
    segment: body.segment,
  });
}));

// ─── POST /api/admin/notifications/web-subscribe ────────
// Persist a browser Push subscription for the current admin. Idempotent
// on `endpoint`. If the same browser was previously subscribed as a
// customer, the row is re-linked to this admin so the OS push flows
// correctly on a shared browser (customer → admin handoff).

const adminWebSubscribeSchema = z.object({
  endpoint: z.string().url().min(20).max(2000),
  keys: z.object({
    p256dh: z.string().min(20).max(500),
    auth: z.string().min(8).max(500),
  }),
  userAgent: z.string().max(500).optional(),
});

router.post('/web-subscribe', validate(adminWebSubscribeSchema), asyncHandler(async (req, res) => {
  const { endpoint, keys, userAgent } = req.body as z.infer<typeof adminWebSubscribeSchema>;
  const adminId = req.admin!.adminId;
  await prisma.webPushSubscription.upsert({
    where: { endpoint },
    create: {
      user_id: null,
      admin_id: adminId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: userAgent ?? null,
    },
    update: {
      user_id: null,
      admin_id: adminId,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: userAgent ?? null,
    },
  });
  return success(res, { message: 'Subscribed.' });
}));

// ─── POST /api/admin/notifications/web-unsubscribe ──────

const adminWebUnsubscribeSchema = z.object({
  endpoint: z.string().url().min(20).max(2000),
});

router.post('/web-unsubscribe', validate(adminWebUnsubscribeSchema), asyncHandler(async (req, res) => {
  const { endpoint } = req.body as z.infer<typeof adminWebUnsubscribeSchema>;
  const deleted = await prisma.webPushSubscription.deleteMany({
    where: { endpoint, admin_id: req.admin!.adminId },
  });
  return success(res, { deleted: deleted.count });
}));

export default router;
