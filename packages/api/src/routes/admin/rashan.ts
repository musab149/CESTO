import { Router } from 'express';
import { z } from 'zod';
import { Prisma, SubDeliveryStatus } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { parsePage, paged } from '../../lib/pagination';
import { isValidItems, computeItemsTotal, type PackItem } from '../../lib/rashan';

const router = Router();

// ─── PACKS ──────────────────────────────────────────────

const itemSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid(),
  quantity: z.number().int().min(1),
});

const packSchema = z.object({
  slug: z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/, 'lowercase, digits, dash/underscore only'),
  name_es: z.string().min(1),
  name_en: z.string().min(1),
  tagline_es: z.string().nullish(),
  tagline_en: z.string().nullish(),
  description_es: z.string().nullish(),
  description_en: z.string().nullish(),
  badge_es: z.string().nullish(),
  badge_en: z.string().nullish(),
  cover_url: z.string().max(600).nullish(),
  emoji: z.string().nullish(),
  gradient: z.string().nullish(),
  accent: z.string().nullish(),
  base_price: z.number().nonnegative().default(0),
  estimated_savings_pct: z.number().int().min(0).max(50).default(0),
  household_default: z.number().int().min(1).max(20).default(2),
  highlights_es: z.array(z.string()).default([]),
  highlights_en: z.array(z.string()).default([]),
  items: z.array(itemSchema).default([]),
  is_custom: z.boolean().default(false),
  sort_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
});

/** Owning store, so admin can tell a partner pack from a Cesto one at a glance. */
const packInclude = {
  _count: { select: { subscriptions: true } },
  store: { select: { id: true, slug: true, name: true, logo_url: true, status: true } },
} as const;

router.get('/packs', asyncHandler(async (req, res) => {
  // ?owner=cesto | partner — the two are managed very differently (Cesto's are
  // editable here, partners' are only moderatable), so the UI splits them.
  const owner = req.query.owner;
  const where: Prisma.RashanPackWhereInput = {};
  if (owner === 'cesto')   where.store_id = null;
  if (owner === 'partner') where.store_id = { not: null };

  const packs = await prisma.rashanPack.findMany({
    where,
    // nulls first so Cesto's own packs head the list — Postgres would
    // otherwise sort NULL store_id last and bury them under partner rows.
    orderBy: [
      { store_id: { sort: 'asc', nulls: 'first' } },
      { sort_order: 'asc' },
      { name_es: 'asc' },
    ],
    include: packInclude,
  });
  return success(res, packs);
}));

router.get('/packs/:id', asyncHandler(async (req, res) => {
  const pack = await prisma.rashanPack.findUnique({
    where: { id: req.params.id },
    include: packInclude,
  });
  if (!pack) return error(res, 'Pack not found.', 404);
  return success(res, pack);
}));

router.post('/packs', validate(packSchema), asyncHandler(async (req, res) => {
  // Admin creates Cesto packs only. Building one on a partner's behalf would
  // put a pack in their storefront and their delivery queue without them
  // ever agreeing to fulfil it.
  const created = await prisma.rashanPack.create({
    data: { ...(req.body as object), store_id: null } as Prisma.RashanPackUncheckedCreateInput,
    include: packInclude,
  });
  return success(res, created, 201);
}));

router.put('/packs/:id', validate(packSchema), asyncHandler(async (req, res) => {
  const existing = await prisma.rashanPack.findUnique({
    where: { id: req.params.id },
    select: { id: true, store_id: true },
  });
  if (!existing) return error(res, 'Pack not found.', 404);
  // A partner's pack is theirs to word and price. Admin moderates it with
  // the block endpoints below rather than editing it from underneath them.
  if (existing.store_id) {
    return error(
      res,
      'This pack belongs to a partner store. Use block/unblock to moderate it — its contents are the partner\'s to edit.',
      403,
    );
  }
  const updated = await prisma.rashanPack.update({
    where: { id: existing.id },
    data: req.body,
    include: packInclude,
  });
  return success(res, updated);
}));

// ─── Moderation of partner packs ────────────────────────
// Partner packs publish instantly, so the lever is a takedown after the fact.
// Blocking hides the pack from every customer surface and freezes partner
// edits; only an admin can lift it.

const blockPackSchema = z.object({ reason: z.string().trim().min(1).max(500) });

router.post('/packs/:id/block', validate(blockPackSchema), asyncHandler(async (req, res) => {
  const { reason } = req.body as z.infer<typeof blockPackSchema>;
  const pack = await prisma.rashanPack.findUnique({
    where: { id: req.params.id },
    select: { id: true, store_id: true },
  });
  if (!pack) return error(res, 'Pack not found.', 404);
  if (!pack.store_id) {
    return error(res, 'This is a Cesto pack — deactivate it instead of blocking it.', 400);
  }
  const updated = await prisma.rashanPack.update({
    where: { id: pack.id },
    data: { admin_blocked_at: new Date(), admin_block_reason: reason },
    include: packInclude,
  });
  return success(res, updated);
}));

router.post('/packs/:id/unblock', asyncHandler(async (req, res) => {
  const pack = await prisma.rashanPack.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!pack) return error(res, 'Pack not found.', 404);
  const updated = await prisma.rashanPack.update({
    where: { id: pack.id },
    // Clearing the reason too — a stale reason on an unblocked pack reads as
    // if it were still blocked.
    data: { admin_blocked_at: null, admin_block_reason: null },
    include: packInclude,
  });
  return success(res, updated);
}));

router.delete('/packs/:id', asyncHandler(async (req, res) => {
  const pack = await prisma.rashanPack.findUnique({
    where: { id: req.params.id },
    select: { id: true, store_id: true },
  });
  if (!pack) return error(res, 'Pack not found.', 404);
  // Destroying a partner's own work from the admin panel is not moderation,
  // it's data loss they can't undo. Block hides it just as effectively and
  // leaves the pack in their dashboard with a reason attached.
  if (pack.store_id) {
    return error(res, 'This pack belongs to a partner store. Block it instead of deleting it.', 403);
  }

  const subCount = await prisma.rashanSubscription.count({ where: { pack_id: req.params.id } });
  if (subCount > 0) {
    // Disconnect rather than delete subscriptions (we keep the pack_slug snapshot on each sub).
    return error(
      res,
      `Cannot delete pack with ${subCount} subscriptions. Deactivate instead — existing subscriptions keep their item snapshot.`,
      409,
    );
  }
  await prisma.rashanPack.delete({ where: { id: req.params.id } });
  return success(res, { message: 'Pack deleted.' });
}));

// ─── SUBSCRIPTIONS ──────────────────────────────────────

router.get('/subscriptions', asyncHandler(async (req, res) => {
  const params = parsePage(req.query, 20, 100);
  const { status, q } = req.query as Record<string, string | undefined>;

  const where: Prisma.RashanSubscriptionWhereInput = {};
  if (status) where.status = status as Prisma.RashanSubscriptionWhereInput['status'];
  if (q) {
    where.OR = [
      { user: { name: { contains: q, mode: 'insensitive' } } },
      { user: { email: { contains: q, mode: 'insensitive' } } },
      { user: { phone: { contains: q } } },
    ];
  }

  const [subs, total] = await Promise.all([
    prisma.rashanSubscription.findMany({
      where,
      select: {
        id: true, status: true, frequency: true, household: true,
        next_delivery_date: true, needs_confirmation: true,
        total_per_cycle: true, cycles_completed: true, pack_slug: true,
        created_at: true, updated_at: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
        pack: { select: { id: true, slug: true, name_es: true, name_en: true } },
        _count: { select: { deliveries: true } },
      },
      orderBy: [{ status: 'asc' }, { next_delivery_date: 'asc' }],
      skip: params.skip,
      take: params.limit,
    }),
    prisma.rashanSubscription.count({ where }),
  ]);

  return success(res, paged(subs, total, params));
}));

router.get('/subscriptions/summary', asyncHandler(async (_req, res) => {
  // Quick stats for the admin dashboard / list header.
  const [total, active, paused, cancelled, awaiting] = await Promise.all([
    prisma.rashanSubscription.count(),
    prisma.rashanSubscription.count({ where: { status: 'active' } }),
    prisma.rashanSubscription.count({ where: { status: 'paused' } }),
    prisma.rashanSubscription.count({ where: { status: 'cancelled' } }),
    prisma.rashanSubscription.count({ where: { needs_confirmation: true } }),
  ]);

  // MRR: sum of (total_per_cycle * cycles per month)
  const activeRows = await prisma.rashanSubscription.findMany({
    where: { status: 'active' },
    select: { total_per_cycle: true, frequency: true },
  });
  const mrr = activeRows.reduce((acc, s) => {
    const perMonth = s.frequency === 'biweekly' ? 2 : s.frequency === 'monthly' ? 1 : 30 / 42;
    return acc + Number(s.total_per_cycle) * perMonth;
  }, 0);

  return success(res, {
    total, active, paused, cancelled,
    awaiting_confirmation: awaiting,
    mrr_eur: Math.round(mrr * 100) / 100,
  });
}));

router.get('/subscriptions/:id', asyncHandler(async (req, res) => {
  const sub = await prisma.rashanSubscription.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
      address: true,
      pack: true,
      deliveries: {
        orderBy: { scheduled_date: 'asc' },
        include: {
          rider: { select: { id: true, name: true, phone: true, vehicle_type: true } },
          order: { select: { id: true, order_number: true, status: true } },
        },
      },
    },
  });
  if (!sub) return error(res, 'Subscription not found.', 404);

  // Resolve the items JSON into full product + variant + image objects so the
  // admin UI doesn't have to do a paginated client-side join (which was missing
  // products beyond the first 200 and dropping their thumbnails entirely).
  const items = (sub.items as unknown as PackItem[]) ?? [];
  const productIds = Array.from(new Set(items.map((i) => i.product_id)));
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true, name_es: true, name_en: true,
          variants: { select: { id: true, name_es: true, name_en: true, price: true } },
          images: {
            select: { url: true, is_primary: true },
            orderBy: [{ is_primary: 'desc' }, { sort_order: 'asc' }],
            take: 1,
          },
        },
      })
    : [];

  const itemsResolved = items.map((it) => {
    const p = products.find((x) => x.id === it.product_id);
    const v = p?.variants.find((x) => x.id === it.variant_id);
    return {
      product_id: it.product_id,
      variant_id: it.variant_id,
      quantity: it.quantity,
      product: p
        ? { id: p.id, name_es: p.name_es, name_en: p.name_en, image_url: p.images[0]?.url ?? null }
        : null,
      variant: v
        ? { id: v.id, name_es: v.name_es, name_en: v.name_en, price: v.price }
        : null,
    };
  });

  return success(res, { ...sub, items_resolved: itemsResolved });
}));

const adminUpdateSubSchema = z.object({
  items: z.array(itemSchema).optional(),
  household: z.number().int().min(1).max(20).optional(),
  frequency: z.enum(['biweekly', 'monthly', 'every_6_weeks']).optional(),
  status: z.enum(['active', 'paused', 'cancelled']).optional(),
  next_delivery_date: z.string().datetime().nullish(),
  slot_preference: z.string().max(64).nullish(),
  payment_method: z.enum(['cod', 'card', 'bizum']).optional(),
  needs_confirmation: z.boolean().optional(),
  admin_notes: z.string().max(2000).nullish(),
});

router.put('/subscriptions/:id', validate(adminUpdateSubSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof adminUpdateSubSchema>;
  const subId = req.params.id;
  const data: Prisma.RashanSubscriptionUpdateInput = {};

  if (body.items) {
    if (!isValidItems(body.items)) return error(res, 'Invalid items.', 400);
    const { total } = await computeItemsTotal(body.items as PackItem[]);
    data.items = body.items as Prisma.InputJsonValue;
    data.total_per_cycle = total;
  }
  if (body.household !== undefined) data.household = body.household;
  if (body.frequency) data.frequency = body.frequency;
  if (body.status) {
    data.status = body.status;
    if (body.status === 'paused') data.paused_at = new Date();
    if (body.status === 'cancelled') data.cancelled_at = new Date();
    if (body.status === 'active') { data.paused_at = null; data.cancelled_at = null; }
  }
  if (body.next_delivery_date !== undefined) {
    data.next_delivery_date = body.next_delivery_date ? new Date(body.next_delivery_date) : null;
  }
  if (body.slot_preference !== undefined) data.slot_preference = body.slot_preference;
  if (body.payment_method) data.payment_method = body.payment_method;
  if (body.needs_confirmation !== undefined) data.needs_confirmation = body.needs_confirmation;
  if (body.admin_notes !== undefined) data.admin_notes = body.admin_notes;

  // When admin toggles needs_confirmation, also flip the next pending delivery
  // so the customer's "Keep this pack" / "Skip" actions have something to act on.
  // - true  → push next scheduled/confirmed delivery to `awaiting_confirmation`
  // - false → roll any awaiting back to `confirmed` (admin marked it done)
  if (body.needs_confirmation !== undefined) {
    if (body.needs_confirmation) {
      const next = await prisma.subscriptionDelivery.findFirst({
        where: {
          subscription_id: subId,
          status: { in: ['scheduled', 'confirmed'] },
        },
        orderBy: { scheduled_date: 'asc' },
      });
      if (next) {
        await prisma.subscriptionDelivery.update({
          where: { id: next.id },
          data: { status: 'awaiting_confirmation' },
        });
      }
    } else {
      await prisma.subscriptionDelivery.updateMany({
        where: { subscription_id: subId, status: 'awaiting_confirmation' },
        data: { status: 'confirmed' },
      });
    }
  }

  const updated = await prisma.rashanSubscription.update({
    where: { id: subId },
    data,
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
      address: true, pack: true,
      deliveries: {
        orderBy: { scheduled_date: 'asc' },
        include: {
          rider: { select: { id: true, name: true, phone: true, vehicle_type: true } },
          order: { select: { id: true, order_number: true, status: true } },
        },
      },
    },
  });
  return success(res, updated);
}));

// ─── DELIVERIES (ops dashboard) ─────────────────────────

router.get('/deliveries', asyncHandler(async (req, res) => {
  const { status, from, to, q } = req.query as Record<string, string | undefined>;
  const params = parsePage(req.query, 20, 100);

  const where: Prisma.SubscriptionDeliveryWhereInput = {};
  if (status) where.status = status as SubDeliveryStatus;
  if (from || to) {
    where.scheduled_date = {};
    if (from) where.scheduled_date.gte = new Date(from);
    if (to) where.scheduled_date.lte = new Date(to);
  }
  if (q) {
    where.subscription = {
      OR: [
        { user: { name: { contains: q, mode: 'insensitive' } } },
        { user: { phone: { contains: q } } },
      ],
    };
  }

  const [deliveries, total] = await Promise.all([
    prisma.subscriptionDelivery.findMany({
      where,
      include: {
        subscription: {
          select: {
            id: true, frequency: true, household: true, total_per_cycle: true,
            user: { select: { id: true, name: true, phone: true, email: true } },
            address: { select: { id: true, street_line_1: true, postcode: true, city: true } },
            pack: { select: { id: true, slug: true, name_es: true, name_en: true } },
          },
        },
        order: { select: { id: true, order_number: true, status: true } },
        rider: { select: { id: true, name: true, phone: true, vehicle_type: true } },
      },
      orderBy: { scheduled_date: 'asc' },
      skip: params.skip,
      take: params.limit,
    }),
    prisma.subscriptionDelivery.count({ where }),
  ]);

  return success(res, paged(deliveries, total, params));
}));

const assignRiderSchema = z.object({
  riderId: z.string().uuid().nullable(),
});

router.put('/deliveries/:id/rider', validate(assignRiderSchema), asyncHandler(async (req, res) => {
  const { riderId } = req.body as z.infer<typeof assignRiderSchema>;
  if (riderId) {
    const rider = await prisma.rider.findUnique({ where: { id: riderId } });
    if (!rider) return error(res, 'Rider not found.', 404);
    if (!rider.is_active) return error(res, 'Rider is inactive.', 400);
  }
  const updated = await prisma.subscriptionDelivery.update({
    where: { id: req.params.id },
    data: { rider_id: riderId },
    include: { rider: { select: { id: true, name: true, phone: true, vehicle_type: true } } },
  });
  return success(res, updated);
}));

const deliveryStatusSchema = z.object({
  status: z.enum(['scheduled', 'awaiting_confirmation', 'confirmed', 'preparing', 'on_the_way', 'delivered', 'skipped', 'failed']),
  failure_reason: z.string().max(500).nullish(),
});

router.put('/deliveries/:id/status', validate(deliveryStatusSchema), asyncHandler(async (req, res) => {
  const { status, failure_reason } = req.body as z.infer<typeof deliveryStatusSchema>;
  const data: Prisma.SubscriptionDeliveryUpdateInput = { status };
  if (status === 'delivered') data.delivered_at = new Date();
  if (status === 'failed') data.failure_reason = failure_reason ?? 'Failed';

  const updated = await prisma.subscriptionDelivery.update({
    where: { id: req.params.id },
    data,
    include: { subscription: { select: { id: true } } },
  });

  // When a delivery completes (delivered/skipped/failed), bump the parent
  // subscription's cycle counter and roll a new scheduled delivery if active.
  if (['delivered', 'skipped'].includes(status)) {
    const sub = await prisma.rashanSubscription.findUnique({
      where: { id: updated.subscription_id },
      include: { deliveries: { where: { status: { in: ['scheduled', 'awaiting_confirmation', 'confirmed', 'preparing', 'on_the_way'] } } } },
    });
    if (sub) {
      const next = sub.deliveries[0];
      const updateData: Prisma.RashanSubscriptionUpdateInput = {};
      if (status === 'delivered') updateData.cycles_completed = { increment: 1 };
      if (next) updateData.next_delivery_date = next.scheduled_date;
      if (Object.keys(updateData).length) {
        await prisma.rashanSubscription.update({ where: { id: sub.id }, data: updateData });
      }
    }
  }

  return success(res, updated);
}));

export default router;
