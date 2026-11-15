import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { validate } from '../../middleware/validate';
import { MAX_LINE_QUANTITY } from '../../lib/orderLimits';
import { effectiveUnitPrice, pricingForAccount, VAT_FIELDS } from '../../lib/pricing';
import {
  PLAN_FREQUENCIES, DELIVERY_WINDOWS, PLAN_MAX_ITEMS, OPEN_STATUSES, PlanError,
  planView, findPlanForUser, createPlan, updatePlanItems, updatePlanSettings,
  skipNextDelivery, listPlanDeliveries, changeOrderSlot,
  madridToday, addDays, toDate, type HistoryFilter,
} from '../../lib/homeGroceryPlan';

/**
 * Staff's side of Home Grocery plans — see lib/homeGroceryPlan.
 *
 * Mounted at /api/admin/home-grocery. A household has at most one plan, so
 * every plan route is keyed by the SUBSCRIBER (the user id the Home Grocery
 * tab already holds). Staff change the plan's delivery settings, pause,
 * resume or end it, and move an order's slot; they place a household's
 * Home Grocery orders through the ordinary order builder (POST
 * /api/admin/orders with `home_grocery`). The list and skip routes are the
 * model before 2026-10-22, kept answering for an admin build still in flight.
 */
const router = Router();

const itemSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid(),
  quantity: z.number().int().positive().max(MAX_LINE_QUANTITY),
});
const itemsSchema = z.array(itemSchema).min(1).max(PLAN_MAX_ITEMS);
const settingsShape = {
  frequency: z.enum(PLAN_FREQUENCIES).optional(),
  preferred_weekday: z.number().int().min(1).max(7).nullable().optional(),
  preferred_window: z.enum(DELIVERY_WINDOWS).nullable().optional(),
  notify_before: z.boolean().optional(),
};
const createSchema = z.object({ ...settingsShape, address_id: z.string().uuid(), items: itemsSchema.optional() });
const slotSchema = z.object({
  scheduled_for: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  delivery_window: z.enum(DELIVERY_WINDOWS).nullable().optional(),
});
const settingsSchema = z.object({ ...settingsShape, address_id: z.string().uuid().optional() });
const itemsBodySchema = z.object({ items: itemsSchema });

const handle = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  asyncHandler(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof PlanError) return error(res, err.message, err.status, err.detail ?? null);
      throw err;
    }
  });

async function planIdOf(userId: string): Promise<string> {
  const plan = await findPlanForUser(userId);
  if (!plan) throw new PlanError('This household has no delivery information yet.', 404);
  return plan.id;
}

/**
 * What staff need beside each line of the list: what it is, what this
 * household pays for it today, how many we hold, and whether it is still on
 * sale. Read from the catalogue itself, so a product taken off sale still has
 * a name here — the storefront's answer leaves those out.
 */
async function catalogueFor(variantIds: string[], account: { is_business: boolean }) {
  if (variantIds.length === 0) return [];
  const pricing = pricingForAccount(account);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true, name_es: true, name_en: true, price: true, b2b_price: true, stock_quantity: true, is_active: true, sku: true,
      product: {
        select: {
          id: true, name_es: true, name_en: true, brand: true, is_active: true,
          ...VAT_FIELDS,
          category: { select: { name_es: true, name_en: true } },
          images: { select: { url: true }, orderBy: [{ is_primary: 'desc' }, { sort_order: 'asc' }], take: 1 },
        },
      },
    },
  });
  return variants.map((v) => ({
    variant_id: v.id,
    product_id: v.product.id,
    name_es: v.product.name_es,
    name_en: v.product.name_en,
    variant_es: v.name_es,
    variant_en: v.name_en,
    brand: v.product.brand,
    sku: v.sku,
    category_es: v.product.category?.name_es ?? null,
    category_en: v.product.category?.name_en ?? null,
    image_url: v.product.images[0]?.url ?? null,
    unit_price: effectiveUnitPrice(v, pricing, v.product).toFixed(2),
    stock: v.stock_quantity,
    on_sale: v.is_active && v.product.is_active,
  }));
}

/**
 * The plan as staff see it: the household's view plus its profile and
 * addresses. `catalogue` describes the list a plan kept before 2026-10-22,
 * for the plans that still carry one.
 */
async function staffView(userId: string) {
  const [view, profile, addresses, user] = await Promise.all([
    planView(userId),
    prisma.homeGroceryProfile.findUnique({ where: { user_id: userId } }),
    prisma.address.findMany({
      where: { user_id: userId },
      orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
      select: {
        id: true, contact_name: true, contact_phone: true, street_line_1: true, street_line_2: true,
        postcode: true, city: true, province: true, is_default: true,
      },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, phone: true, is_business: true } }),
  ]);
  if (!user) throw new PlanError('Customer not found.', 404);
  const catalogue = await catalogueFor((view.plan?.items ?? []).map((i) => i.variant_id), user);
  return { ...view, profile, addresses, user, catalogue };
}

router.get('/plans/user/:userId', handle(async (req, res) => {
  success(res, await staffView(req.params.userId));
}));

router.post('/plans/user/:userId', validate(createSchema), handle(async (req, res) => {
  await createPlan(req.params.userId, req.body);
  success(res, await staffView(req.params.userId), 201);
}));

router.put('/plans/user/:userId/items', validate(itemsBodySchema), handle(async (req, res) => {
  const result = await updatePlanItems(await planIdOf(req.params.userId), req.body.items);
  success(res, { ...(await staffView(req.params.userId)), applies_to: result.appliesTo, left_out: result.dropped });
}));

router.put('/plans/user/:userId/settings', validate(settingsSchema), handle(async (req, res) => {
  const userId = req.params.userId;
  const result = await updatePlanSettings(await planIdOf(userId), userId, req.body);
  success(res, { ...(await staffView(userId)), applies_to: result.appliesTo, left_out: result.dropped });
}));

// Nothing pauses or ends a household's Home Grocery any more (2026-10-23):
// it is only their delivery information, and an approved household stays a
// Home Grocery customer. An older admin screen is told so.
router.post('/plans/user/:userId/pause', handle(async () => {
  throw new PlanError('Home Grocery can no longer be paused. Turn their reminders off in the delivery information instead.', 410);
}));

router.post('/plans/user/:userId/resume', handle(async (req, res) => {
  success(res, await staffView(req.params.userId));
}));

router.post('/plans/user/:userId/skip', handle(async (req, res) => {
  await skipNextDelivery(await planIdOf(req.params.userId));
  success(res, await staffView(req.params.userId));
}));

router.post('/plans/user/:userId/end', handle(async () => {
  throw new PlanError('Home Grocery can no longer be ended: an approved household stays a Home Grocery customer.', 410);
}));

/** Move a Home Grocery order to another day or part of the day — today included, for staff. */
router.put('/orders/:orderId/slot', validate(slotSchema), handle(async (req, res) => {
  success(res, await changeOrderSlot(req.params.orderId, req.body, { staff: true }));
}));

const historyQuery = z.object({
  status: z.enum(['all', 'upcoming', 'delivered', 'cancelled']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

router.get('/plans/user/:userId/deliveries', handle(async (req, res) => {
  const q = historyQuery.safeParse(req.query);
  if (!q.success) return error(res, 'Invalid filter.', 400);
  const plan = await findPlanForUser(req.params.userId);
  if (!plan) return success(res, { items: [], total: 0, page: 1, limit: q.data.limit, totalPages: 1 });
  success(res, await listPlanDeliveries(plan.id, q.data.status as HistoryFilter, q.data.page, q.data.limit));
}));

/**
 * What is coming up across every household: open Home Grocery orders for up
 * to `days` from today, overdue ones included (one whose day has passed is
 * the one most needing attention). The day staff plan their week from.
 */
router.get('/upcoming', handle(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 60);
  const until = toDate(addDays(madridToday(), days));
  const rows = await prisma.order.findMany({
    where: {
      rashan_subscription_id: { not: null },
      deleted_at: null,
      status: { in: OPEN_STATUSES },
      scheduled_for: { lte: until },
    },
    orderBy: [{ scheduled_for: 'asc' }, { created_at: 'asc' }],
    take: 300,
    select: {
      id: true, order_number: true, status: true, scheduled_for: true, delivery_window: true, total: true,
      _count: { select: { items: true } },
      rider: { select: { id: true, name: true } },
      user: { select: { id: true, name: true, phone: true } },
      rashan_subscription: { select: { preferred_window: true, preferred_weekday: true, frequency: true } },
      address_snapshot: true,
    },
  });
  success(res, {
    today: madridToday(),
    items: rows.map(({ _count, ...r }) => ({ ...r, item_count: _count.items })),
  });
}));

export default router;
