import { Router } from 'express';
import { z } from 'zod';
import { Prisma, SubDeliveryStatus } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { parsePage, paged } from '../../lib/pagination';
import { computeItemsTotal, type PackItem } from '../../lib/rashan';

/**
 * PARTNER RASHAN
 *
 * Partners build their own rashan packs, which appear on /rashan alongside
 * Cesto's and on their own storefront. They also own the fulfilment of
 * anything sold from those packs — subscriptions and the delivery schedule,
 * including rider assignment — because a partner who cannot see the
 * deliveries for a recurring pack they sold cannot actually run it.
 *
 * Every route here is store-scoped from `req.partnerRole.store.id`, never
 * from the request body. Mounted behind requirePartnerRole() in server.ts.
 *
 * Packs publish instantly (no review queue). Moderation is after the fact
 * via RashanPack.admin_blocked_at, which the partner cannot clear.
 */

const router = Router();

// ─── PACKS ──────────────────────────────────────────────

const itemSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
});

/**
 * The partner supplies a BARE slug; the store prefix is added server-side.
 * `store_id`, `admin_blocked_at` and `is_custom` are deliberately absent —
 * a partner must not be able to reassign a pack to another store, clear an
 * admin block, or create the "build your own" pack, which is a platform
 * concept tied to the Cesto catalogue.
 */
const packWriteSchema = z.object({
  slug: z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/, 'lowercase, digits, dash/underscore only'),
  name_es: z.string().min(1).max(120),
  name_en: z.string().min(1).max(120),
  tagline_es: z.string().max(200).nullish(),
  tagline_en: z.string().max(200).nullish(),
  description_es: z.string().max(4000).nullish(),
  description_en: z.string().max(4000).nullish(),
  badge_es: z.string().max(40).nullish(),
  badge_en: z.string().max(40).nullish(),
  /** Uploaded via /api/partner/uploads/image, or a pasted remote URL. Bounded
   *  because we store the URL, never a base64 blob. */
  cover_url: z.string().max(600).nullish(),
  emoji: z.string().max(8).nullish(),
  gradient: z.string().max(200).nullish(),
  accent: z.string().max(40).nullish(),
  base_price: z.number().nonnegative().max(100000).default(0),
  estimated_savings_pct: z.number().int().min(0).max(50).default(0),
  household_default: z.number().int().min(1).max(20).default(2),
  highlights_es: z.array(z.string().max(160)).max(10).default([]),
  highlights_en: z.array(z.string().max(160)).max(10).default([]),
  items: z.array(itemSchema).min(1).max(60),
  sort_order: z.number().int().min(0).max(9999).default(0),
  is_active: z.boolean().default(true),
});

/**
 * Prefix a partner slug with the store slug so two stores can both name a
 * pack "esencial". RashanPack.slug stays globally unique — it is the public
 * lookup key for /api/rashan/packs/:slug and for the pack_slug snapshot on
 * every subscription, neither of which knows about stores.
 */
function scopedSlug(storeSlug: string, bare: string): string {
  return `${storeSlug}-${bare}`.slice(0, 80);
}

/**
 * Every product in a partner's pack must belong to that partner's store and
 * be sellable. Without this a partner could bundle a rival's products — or
 * Cesto's — into a pack they get paid for and are expected to deliver.
 *
 * Returns a human-readable reason, or null when the items are all fine.
 */
async function validatePackItems(
  items: PackItem[],
  storeId: string,
): Promise<string | null> {
  const productIds = [...new Set(items.map((i) => i.product_id))];
  if (productIds.length !== items.length) {
    return 'The same product appears more than once. Combine them into one line with a higher quantity.';
  }

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true, store_id: true, is_active: true, name_en: true,
      variants: { select: { id: true, is_active: true } },
    },
  });

  for (const item of items) {
    const product = products.find((p) => p.id === item.product_id);
    if (!product) return 'One of the products no longer exists.';
    if (product.store_id !== storeId) {
      return `"${product.name_en}" is not one of your products. A pack can only contain products from your own store.`;
    }
    if (!product.is_active) {
      return `"${product.name_en}" is not active. Activate it, or remove it from the pack.`;
    }
    const variant = product.variants.find((v) => v.id === item.variant_id);
    if (!variant) return `The selected size for "${product.name_en}" no longer exists.`;
    if (!variant.is_active) {
      return `The selected size for "${product.name_en}" has been discontinued. Pick another one.`;
    }
  }
  return null;
}

/** Shape returned to the partner UI. Includes the live subscriber count so
 *  the partner can see what deleting a pack would affect. */
const packInclude = {
  _count: { select: { subscriptions: true } },
} as const;

router.get('/packs', asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const packs = await prisma.rashanPack.findMany({
    where: { store_id: storeId },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
    include: packInclude,
  });
  return success(res, packs);
}));

router.get('/packs/:id', asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const pack = await prisma.rashanPack.findFirst({
    where: { id: req.params.id, store_id: storeId },
    include: packInclude,
  });
  // 404 rather than 403 on someone else's pack — a partner shouldn't be able
  // to probe for the existence of another store's pack ids.
  if (!pack) return error(res, 'Pack not found.', 404);
  return success(res, pack);
}));

router.post('/packs', validate(packWriteSchema), asyncHandler(async (req, res) => {
  const { id: storeId, slug: storeSlug } = req.partnerRole!.store;
  const body = req.body as z.infer<typeof packWriteSchema>;

  const itemError = await validatePackItems(body.items as PackItem[], storeId);
  if (itemError) return error(res, itemError, 422);

  const slug = scopedSlug(storeSlug, body.slug);
  const clash = await prisma.rashanPack.findUnique({ where: { slug }, select: { id: true } });
  if (clash) return error(res, 'You already have a pack with that web address. Pick a different one.', 409);

  const { total } = await computeItemsTotal(body.items as PackItem[]);
  const { slug: _bare, ...rest } = body;

  const created = await prisma.rashanPack.create({
    data: {
      ...rest,
      slug,
      store_id: storeId,
      is_custom: false,
      // Snapshot of what the items cost right now, so a pack whose products
      // are later deactivated still renders a sane "from" price on the card.
      base_price: body.base_price > 0 ? body.base_price : total,
      items: body.items as Prisma.InputJsonValue,
    },
    include: packInclude,
  });
  return success(res, created, 201);
}));

router.put('/packs/:id', validate(packWriteSchema), asyncHandler(async (req, res) => {
  const { id: storeId, slug: storeSlug } = req.partnerRole!.store;
  const body = req.body as z.infer<typeof packWriteSchema>;

  const existing = await prisma.rashanPack.findFirst({
    where: { id: req.params.id, store_id: storeId },
  });
  if (!existing) return error(res, 'Pack not found.', 404);

  // An admin-blocked pack is frozen. Letting the partner edit it would mean
  // they could quietly rewrite the thing that got taken down and flip Active
  // back on, which is the whole point of the block.
  if (existing.admin_blocked_at) {
    return error(
      res,
      'This pack has been taken down by Cesto and cannot be edited. Contact support.',
      423,
    );
  }

  const itemError = await validatePackItems(body.items as PackItem[], storeId);
  if (itemError) return error(res, itemError, 422);

  const slug = scopedSlug(storeSlug, body.slug);
  if (slug !== existing.slug) {
    const clash = await prisma.rashanPack.findUnique({ where: { slug }, select: { id: true } });
    if (clash) return error(res, 'You already have a pack with that web address. Pick a different one.', 409);
  }

  const { total } = await computeItemsTotal(body.items as PackItem[]);
  const { slug: _bare, ...rest } = body;

  const updated = await prisma.rashanPack.update({
    where: { id: existing.id },
    data: {
      ...rest,
      slug,
      base_price: body.base_price > 0 ? body.base_price : total,
      items: body.items as Prisma.InputJsonValue,
    },
    include: packInclude,
  });
  return success(res, updated);
}));

router.delete('/packs/:id', asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const pack = await prisma.rashanPack.findFirst({
    where: { id: req.params.id, store_id: storeId },
    select: { id: true },
  });
  if (!pack) return error(res, 'Pack not found.', 404);

  // Same rule as admin: a pack with subscriptions is deactivated, never
  // deleted. Subscriptions snapshot their own items, so deleting wouldn't
  // break them — but the customer's subscription page resolves the pack for
  // its name and artwork, and they'd be left staring at an unnamed box.
  const subCount = await prisma.rashanSubscription.count({
    where: { pack_id: pack.id, status: { not: 'cancelled' } },
  });
  if (subCount > 0) {
    return error(
      res,
      `${subCount} customer${subCount === 1 ? ' is' : 's are'} subscribed to this pack. Turn it off instead — they keep their deliveries, and it stops appearing to new customers.`,
      409,
    );
  }

  await prisma.rashanPack.delete({ where: { id: pack.id } });
  return success(res, { message: 'Pack deleted.' });
}));

// ─── SUBSCRIPTIONS (read-only for the partner) ──────────
// The partner can see who subscribed and what they get, but cannot edit
// someone else's subscription — pausing, re-scheduling and cancelling stay
// with the customer and with Cesto support.

router.get('/subscriptions', asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const params = parsePage(req.query, 20, 100);
  const { status, packId, q } = req.query as Record<string, string | undefined>;

  const where: Prisma.RashanSubscriptionWhereInput = { store_id: storeId };
  if (status === 'active' || status === 'paused' || status === 'cancelled') {
    where.status = status;
  }
  if (packId) where.pack_id = packId;
  if (q) {
    where.user = {
      OR: [
        { name:  { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { email: { contains: q, mode: 'insensitive' } },
      ],
    };
  }

  const [items, total] = await Promise.all([
    prisma.rashanSubscription.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
        pack: { select: { id: true, slug: true, name_es: true, name_en: true, emoji: true } },
        address: { select: { id: true, street_line_1: true, postcode: true, city: true } },
        _count: { select: { deliveries: true } },
      },
      orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
      skip: params.skip,
      take: params.limit,
    }),
    prisma.rashanSubscription.count({ where }),
  ]);

  return success(res, paged(items, total, params));
}));

router.get('/subscriptions/:id', asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const sub = await prisma.rashanSubscription.findFirst({
    where: { id: req.params.id, store_id: storeId },
    include: {
      user: { select: { id: true, name: true, phone: true, email: true } },
      pack: true,
      address: true,
      deliveries: {
        orderBy: { scheduled_date: 'asc' },
        include: { rider: { select: { id: true, name: true, phone: true, vehicle_type: true } } },
      },
    },
  });
  if (!sub) return error(res, 'Subscription not found.', 404);
  return success(res, sub);
}));

// ─── DELIVERIES (the partner's own ops queue) ───────────

router.get('/deliveries', asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const params = parsePage(req.query, 20, 100);
  const { status, from, to, q } = req.query as Record<string, string | undefined>;

  const where: Prisma.SubscriptionDeliveryWhereInput = {
    subscription: { store_id: storeId },
  };
  if (status) where.status = status as SubDeliveryStatus;
  if (from || to) {
    where.scheduled_date = {};
    if (from) where.scheduled_date.gte = new Date(from);
    if (to)   where.scheduled_date.lte = new Date(to);
  }
  if (q) {
    where.subscription = {
      store_id: storeId,
      OR: [
        { user: { name: { contains: q, mode: 'insensitive' } } },
        { user: { phone: { contains: q } } },
      ],
    };
  }

  const [items, total] = await Promise.all([
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
        rider: { select: { id: true, name: true, phone: true, vehicle_type: true } },
      },
      orderBy: { scheduled_date: 'asc' },
      skip: params.skip,
      take: params.limit,
    }),
    prisma.subscriptionDelivery.count({ where }),
  ]);

  return success(res, paged(items, total, params));
}));

/** Confirms a delivery belongs to a subscription fulfilled by this store. */
async function findOwnDelivery(deliveryId: string, storeId: string) {
  return prisma.subscriptionDelivery.findFirst({
    where: { id: deliveryId, subscription: { store_id: storeId } },
    select: { id: true, subscription_id: true, status: true },
  });
}

const assignRiderSchema = z.object({ riderId: z.string().uuid().nullable() });

router.put('/deliveries/:id/rider', validate(assignRiderSchema), asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const { riderId } = req.body as z.infer<typeof assignRiderSchema>;

  const delivery = await findOwnDelivery(req.params.id, storeId);
  if (!delivery) return error(res, 'Delivery not found.', 404);

  if (riderId) {
    // The rider must be the partner's OWN. Cesto's riders and other stores'
    // riders are not theirs to dispatch.
    const rider = await prisma.rider.findFirst({
      where: { id: riderId, store_id: storeId },
      select: { id: true, is_active: true },
    });
    if (!rider) return error(res, 'Rider not found.', 404);
    if (!rider.is_active) return error(res, 'That rider is inactive.', 400);
  }

  const updated = await prisma.subscriptionDelivery.update({
    where: { id: delivery.id },
    data: { rider_id: riderId },
    include: { rider: { select: { id: true, name: true, phone: true, vehicle_type: true } } },
  });
  return success(res, updated);
}));

/**
 * Allowed transitions, mirroring the admin ops pipeline. Enforced here rather
 * than only in the UI because the partner dashboard is a browser app and the
 * endpoint is reachable directly.
 */
const ALLOWED_TRANSITIONS: Record<SubDeliveryStatus, SubDeliveryStatus[]> = {
  scheduled:             ['awaiting_confirmation', 'confirmed', 'skipped'],
  awaiting_confirmation: ['confirmed', 'skipped'],
  confirmed:             ['preparing', 'skipped'],
  preparing:             ['on_the_way', 'failed'],
  on_the_way:            ['delivered', 'failed'],
  delivered:             [],
  skipped:               [],
  failed:                [],
};

const deliveryStatusSchema = z.object({
  status: z.enum([
    'scheduled', 'awaiting_confirmation', 'confirmed', 'preparing',
    'on_the_way', 'delivered', 'skipped', 'failed',
  ]),
  failure_reason: z.string().max(500).nullish(),
});

router.put('/deliveries/:id/status', validate(deliveryStatusSchema), asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const { status, failure_reason } = req.body as z.infer<typeof deliveryStatusSchema>;

  const delivery = await findOwnDelivery(req.params.id, storeId);
  if (!delivery) return error(res, 'Delivery not found.', 404);

  if (!ALLOWED_TRANSITIONS[delivery.status].includes(status)) {
    return error(
      res,
      `A delivery that is "${delivery.status.replace(/_/g, ' ')}" cannot be moved to "${status.replace(/_/g, ' ')}".`,
      409,
    );
  }

  const data: Prisma.SubscriptionDeliveryUpdateInput = { status };
  if (status === 'delivered') data.delivered_at = new Date();
  if (status === 'failed')    data.failure_reason = failure_reason ?? 'Failed';

  const updated = await prisma.subscriptionDelivery.update({
    where: { id: delivery.id },
    data,
    include: { rider: { select: { id: true, name: true, phone: true, vehicle_type: true } } },
  });

  // Closing a cycle rolls the subscription forward — same bookkeeping the
  // admin pipeline does, so a partner-fulfilled subscription doesn't stall
  // with a stale next_delivery_date.
  if (status === 'delivered' || status === 'skipped') {
    const sub = await prisma.rashanSubscription.findUnique({
      where: { id: delivery.subscription_id },
      include: {
        deliveries: {
          where: {
            status: { in: ['scheduled', 'awaiting_confirmation', 'confirmed', 'preparing', 'on_the_way'] },
          },
          orderBy: { scheduled_date: 'asc' },
        },
      },
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
