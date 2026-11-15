import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../lib/async';
import { notifyAdminSubscriptionPaused } from '../lib/notifications';
import { customerVisibleRashanPackFilter } from '../lib/store-scope';
import {
  isValidItems,
  computeItemsTotal,
  defaultFirstDelivery,
  addDays,
  FREQUENCY_DAYS,
  type PackItem,
} from '../lib/rashan';

const router = Router();

// ─── Public: browse packs ───────────────────────────────
//
// Since partners can build their own, this list is a mix of Cesto packs
// (store_id NULL) and partner packs. `customerVisibleRashanPackFilter`
// applies the two rules that decide what may be shown — the owning store's
// visibility, and Cesto's takedown flag. See its doc comment.

/** Store summary sent with every pack so the card can be attributed. */
const packStoreSelect = {
  select: {
    id: true, slug: true, name: true, logo_url: true, logo_bg: true,
    is_verified: true, rating: true,
  },
} as const;

router.get('/packs', asyncHandler(async (req, res) => {
  const packs = await prisma.rashanPack.findMany({
    where: { AND: [{ is_active: true }, customerVisibleRashanPackFilter] },
    // Cesto's own packs lead the rail; partner packs follow, each store's
    // sort_order respected within its own group.
    //
    // `nulls: 'first'` is load-bearing — a Cesto pack has store_id NULL, and
    // Postgres sorts NULLs LAST in an ASC order, which put every partner pack
    // ahead of Cesto's own.
    orderBy: [
      { store_id: { sort: 'asc', nulls: 'first' } },
      { sort_order: 'asc' },
      { name_es: 'asc' },
    ],
    include: { store: packStoreSelect },
  });
  return success(res, packs);
}));

router.get('/packs/:slug', asyncHandler(async (req, res) => {
  const pack = await prisma.rashanPack.findFirst({
    where: { AND: [{ slug: req.params.slug, is_active: true }, customerVisibleRashanPackFilter] },
    include: { store: packStoreSelect },
  });
  if (!pack) return error(res, 'Pack not found.', 404);
  return success(res, pack);
}));

// ─── Subscriptions (auth required for everything below) ─

router.use(requireAuth);

const itemSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid(),
  quantity: z.number().int().min(1),
});

const createSubscriptionSchema = z.object({
  packSlug: z.string().min(1).optional(),
  items: z.array(itemSchema).min(1),
  household: z.number().int().min(1).max(20).default(2),
  frequency: z.enum(['biweekly', 'monthly', 'every_6_weeks']).default('monthly'),
  addressId: z.string().uuid(),
  slotPreference: z.string().max(64).nullish(),
  paymentMethod: z.enum(['cod', 'card', 'bizum']).default('cod'),
  /** Optional first delivery override (ISO date). Default = today + frequency days. */
  firstDeliveryDate: z.string().datetime().optional(),
});

const updateSubscriptionSchema = z.object({
  items: z.array(itemSchema).min(1).optional(),
  household: z.number().int().min(1).max(20).optional(),
  frequency: z.enum(['biweekly', 'monthly', 'every_6_weeks']).optional(),
  addressId: z.string().uuid().optional(),
  slotPreference: z.string().max(64).nullish(),
  paymentMethod: z.enum(['cod', 'card', 'bizum']).optional(),
});

const subscriptionInclude = {
  pack: true,
  // Who fulfils it. Null on a Cesto subscription, which the UI renders as the
  // house brand rather than as a missing store.
  store: packStoreSelect,
  address: true,
  deliveries: {
    orderBy: { scheduled_date: 'asc' as const },
    include: {
      rider: { select: { id: true, name: true, phone: true, vehicle_type: true } },
    },
  },
} as const;

// ─── GET /api/rashan/subscriptions ──────────────────────

router.get('/subscriptions', asyncHandler(async (req, res) => {
  const subs = await prisma.rashanSubscription.findMany({
    where: { user_id: req.user!.userId },
    include: subscriptionInclude,
    orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
  });
  return success(res, subs);
}));

// ─── GET /api/rashan/subscriptions/:id ──────────────────

router.get('/subscriptions/:id', asyncHandler(async (req, res) => {
  const sub = await prisma.rashanSubscription.findFirst({
    where: { id: req.params.id, user_id: req.user!.userId },
    include: subscriptionInclude,
  });
  if (!sub) return error(res, 'Subscription not found.', 404);
  return success(res, sub);
}));

// ─── POST /api/rashan/subscriptions ─────────────────────

router.post('/subscriptions', validate(createSubscriptionSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const body = req.body as z.infer<typeof createSubscriptionSchema>;

  // Ownership only. There is no serviceability check — every live store
  // delivers everywhere, so any address the customer saved is a valid
  // destination for a recurring pack.
  const address = await prisma.address.findFirst({
    where: { id: body.addressId, user_id: userId },
  });
  if (!address) return error(res, 'Address not found.', 404);

  // Optional pack lookup (snapshot the slug + id). Filtered through the same
  // visibility rules as the browse endpoints, so a customer can't subscribe to
  // a pack belonging to a paused store, or one Cesto has taken down, by
  // posting its slug directly.
  const pack = body.packSlug
    ? await prisma.rashanPack.findFirst({
        where: { AND: [{ slug: body.packSlug, is_active: true }, customerVisibleRashanPackFilter] },
      })
    : null;
  if (body.packSlug && !pack) return error(res, 'That pack is no longer available.', 404);

  if (!isValidItems(body.items)) return error(res, 'Invalid items.', 400);

  /**
   * Who fulfils this? A subscription produces one delivery per cycle to one
   * address, so it can only belong to one store.
   *
   * Partner pack  → that store, and every item must be theirs.
   * Cesto pack or a custom build → NULL (Cesto fulfils), which is exactly
   *   what every subscription did before partners existed. Deliberately not
   *   inferring a store from the items here: Cesto's own packs already mix in
   *   products that carry a store_id, and re-attributing those to a partner
   *   would hand them deliveries they never agreed to.
   */
  const storeId = pack?.store_id ?? null;
  if (storeId) {
    const foreign = await prisma.product.count({
      where: { id: { in: body.items.map((i) => i.product_id) }, store_id: { not: storeId } },
    });
    if (foreign > 0) {
      return error(res, 'This pack contains items that store no longer sells. Refresh and try again.', 409);
    }
  }

  // One live subscription per customer per store. A partial unique index
  // enforces this in the database too — this check exists to return something
  // legible instead of a 409 from a constraint name.
  const existing = await prisma.rashanSubscription.findFirst({
    where: { user_id: userId, store_id: storeId, status: { not: 'cancelled' } },
    select: { id: true, status: true },
  });
  if (existing) {
    return error(
      res,
      storeId
        ? 'You already have a rashan with this store. Edit that one instead of starting a second.'
        : 'You already have a Cesto rashan. Edit that one instead of starting a second.',
      409,
    );
  }

  const { total, itemCount } = await computeItemsTotal(body.items as PackItem[]);

  const firstDate = body.firstDeliveryDate
    ? new Date(body.firstDeliveryDate)
    : defaultFirstDelivery(body.frequency);

  const sub = await prisma.rashanSubscription.create({
    data: {
      user_id: userId,
      pack_id: pack?.id ?? null,
      pack_slug: pack?.slug ?? null,
      store_id: storeId,
      items: body.items as Prisma.InputJsonValue,
      household: body.household,
      frequency: body.frequency,
      address_id: address.id,
      slot_preference: body.slotPreference ?? null,
      payment_method: body.paymentMethod,
      next_delivery_date: firstDate,
      total_per_cycle: total,
      deliveries: {
        create: {
          scheduled_date: firstDate,
          status: 'scheduled',
          item_count: itemCount,
          total,
        },
      },
    },
    include: subscriptionInclude,
  });

  return success(res, sub, 201);
}));

// ─── PUT /api/rashan/subscriptions/:id ──────────────────

router.put('/subscriptions/:id', validate(updateSubscriptionSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const body = req.body as z.infer<typeof updateSubscriptionSchema>;

  const sub = await prisma.rashanSubscription.findFirst({
    where: { id: req.params.id, user_id: userId },
  });
  if (!sub) return error(res, 'Subscription not found.', 404);
  if (sub.status === 'cancelled') return error(res, 'Cannot edit a cancelled subscription.', 400);

  const data: Prisma.RashanSubscriptionUpdateInput = {};

  if (body.addressId) {
    const a = await prisma.address.findFirst({
      where: { id: body.addressId, user_id: userId },
    });
    if (!a) return error(res, 'Address not found.', 404);
    data.address = { connect: { id: a.id } };
  }
  if (body.household !== undefined) data.household = body.household;
  if (body.frequency) data.frequency = body.frequency;
  if (body.slotPreference !== undefined) data.slot_preference = body.slotPreference;
  if (body.paymentMethod) data.payment_method = body.paymentMethod;

  if (body.items) {
    if (!isValidItems(body.items)) return error(res, 'Invalid items.', 400);
    const { total } = await computeItemsTotal(body.items as PackItem[]);
    data.items = body.items as Prisma.InputJsonValue;
    data.total_per_cycle = total;
  }

  const updated = await prisma.rashanSubscription.update({
    where: { id: sub.id },
    data,
    include: subscriptionInclude,
  });
  return success(res, updated);
}));

// ─── POST /api/rashan/subscriptions/:id/pause ───────────

router.post('/subscriptions/:id/pause', asyncHandler(async (req, res) => {
  const sub = await prisma.rashanSubscription.findFirst({
    where: { id: req.params.id, user_id: req.user!.userId },
  });
  if (!sub) return error(res, 'Subscription not found.', 404);
  if (sub.status !== 'active') return error(res, `Cannot pause a ${sub.status} subscription.`, 400);

  const updated = await prisma.rashanSubscription.update({
    where: { id: sub.id },
    data: {
      status: 'paused',
      paused_at: new Date(),
      next_delivery_date: null,
    },
    include: { ...subscriptionInclude, user: { select: { name: true } } },
  });

  void notifyAdminSubscriptionPaused({
    subscriptionId: updated.id,
    customerName: updated.user?.name?.trim() || 'Cliente',
    packName: updated.pack?.name_es ?? updated.pack_slug ?? 'Rashan',
  });

  return success(res, updated);
}));

// ─── POST /api/rashan/subscriptions/:id/resume ──────────

router.post('/subscriptions/:id/resume', asyncHandler(async (req, res) => {
  const sub = await prisma.rashanSubscription.findFirst({
    where: { id: req.params.id, user_id: req.user!.userId },
  });
  if (!sub) return error(res, 'Subscription not found.', 404);
  if (sub.status !== 'paused') return error(res, `Cannot resume a ${sub.status} subscription.`, 400);

  const next = defaultFirstDelivery(sub.frequency);
  const items = sub.items as unknown as PackItem[];
  const { total, itemCount } = await computeItemsTotal(items);

  const updated = await prisma.rashanSubscription.update({
    where: { id: sub.id },
    data: {
      status: 'active',
      paused_at: null,
      next_delivery_date: next,
      total_per_cycle: total,
      deliveries: {
        create: { scheduled_date: next, status: 'scheduled', item_count: itemCount, total },
      },
    },
    include: subscriptionInclude,
  });
  return success(res, updated);
}));

// ─── POST /api/rashan/subscriptions/:id/cancel ──────────

const cancelSchema = z.object({ reason: z.string().max(500).optional() });

router.post('/subscriptions/:id/cancel', validate(cancelSchema), asyncHandler(async (req, res) => {
  const sub = await prisma.rashanSubscription.findFirst({
    where: { id: req.params.id, user_id: req.user!.userId },
  });
  if (!sub) return error(res, 'Subscription not found.', 404);
  if (sub.status === 'cancelled') return error(res, 'Already cancelled.', 400);

  const updated = await prisma.$transaction(async (tx) => {
    // Cancel any open future deliveries.
    await tx.subscriptionDelivery.updateMany({
      where: {
        subscription_id: sub.id,
        status: { in: ['scheduled', 'awaiting_confirmation', 'confirmed'] },
      },
      data: { status: 'skipped' },
    });
    return tx.rashanSubscription.update({
      where: { id: sub.id },
      data: {
        status: 'cancelled',
        cancelled_at: new Date(),
        cancellation_reason: req.body.reason ?? null,
        next_delivery_date: null,
      },
      include: subscriptionInclude,
    });
  });

  return success(res, updated);
}));

// ─── POST /api/rashan/subscriptions/:id/skip-next ───────
// Skip the next pending delivery; reschedule next_delivery_date forward.

router.post('/subscriptions/:id/skip-next', asyncHandler(async (req, res) => {
  const sub = await prisma.rashanSubscription.findFirst({
    where: { id: req.params.id, user_id: req.user!.userId },
    include: { deliveries: { orderBy: { scheduled_date: 'asc' } } },
  });
  if (!sub) return error(res, 'Subscription not found.', 404);
  if (sub.status !== 'active') return error(res, `Only active subscriptions can skip.`, 400);

  const upcoming = sub.deliveries.find((d) => ['scheduled', 'awaiting_confirmation'].includes(d.status));
  if (!upcoming) return error(res, 'No upcoming delivery to skip.', 400);

  const newNext = addDays(upcoming.scheduled_date, FREQUENCY_DAYS[sub.frequency]);
  const items = sub.items as unknown as PackItem[];
  const { total, itemCount } = await computeItemsTotal(items);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.subscriptionDelivery.update({
      where: { id: upcoming.id },
      data: { status: 'skipped' },
    });
    await tx.subscriptionDelivery.create({
      data: {
        subscription_id: sub.id,
        scheduled_date: newNext,
        status: 'scheduled',
        item_count: itemCount,
        total,
      },
    });
    return tx.rashanSubscription.update({
      where: { id: sub.id },
      data: { next_delivery_date: newNext },
      include: subscriptionInclude,
    });
  });

  return success(res, updated);
}));

// ─── POST /api/rashan/subscriptions/:id/confirm-next ────
// User confirms the awaiting-confirmation delivery — flips to "confirmed".

router.post('/subscriptions/:id/confirm-next', asyncHandler(async (req, res) => {
  const sub = await prisma.rashanSubscription.findFirst({
    where: { id: req.params.id, user_id: req.user!.userId },
    include: { deliveries: { orderBy: { scheduled_date: 'asc' } } },
  });
  if (!sub) return error(res, 'Subscription not found.', 404);

  // Accept either an awaiting_confirmation or a still-scheduled delivery —
  // the user is "locking in" the next cycle either way.
  const upcoming = sub.deliveries.find(
    (d) => d.status === 'awaiting_confirmation' || d.status === 'scheduled',
  );
  if (!upcoming) return error(res, 'No upcoming delivery to confirm.', 400);

  await prisma.subscriptionDelivery.update({
    where: { id: upcoming.id },
    data: { status: 'confirmed' },
  });
  await prisma.rashanSubscription.update({
    where: { id: sub.id },
    data: { needs_confirmation: false },
  });

  const refreshed = await prisma.rashanSubscription.findUnique({
    where: { id: sub.id },
    include: subscriptionInclude,
  });
  return success(res, refreshed);
}));

export default router;
