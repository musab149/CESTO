import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { success, error } from '../lib/response';
import { asyncHandler } from '../lib/async';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { MAX_LINE_QUANTITY } from '../lib/orderLimits';
import { createOrderForCustomer, CreateOrderError, orderItemsSchema } from '../lib/createOrder';
import { announceOrderBuiltForCustomer } from '../lib/notifications';
import {
  PLAN_FREQUENCIES, DELIVERY_WINDOWS, PLAN_MAX_ITEMS, PlanError,
  planView, findPlanForUser, createPlan, updatePlanItems, updatePlanSettings,
  skipNextDelivery, listPlanDeliveries, type HistoryFilter,
  homeGroceryOrderFields, afterPlanOrderChange, changeOrderSlot,
} from '../lib/homeGroceryPlan';

/**
 * A Home Grocery household's own plan — its delivery settings — and the
 * orders it places under it. See lib/homeGroceryPlan.
 *
 * Mounted at /api/home-grocery/plan. Everything here is about the signed-in
 * user's ONE plan, so no route takes a plan id: there is nobody else's plan to
 * name, and nothing to probe. The list and skip routes are the model before
 * 2026-10-22, kept answering for app builds that still call them.
 */
const router = Router();
router.use(requireAuth);

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
// `items`: sent by app builds from before 2026-10-22, and ignored.
const createSchema = z.object({ ...settingsShape, address_id: z.string().uuid(), items: itemsSchema.optional() });
const settingsSchema = z.object({ ...settingsShape, address_id: z.string().uuid().optional() });
const itemsBodySchema = z.object({ items: itemsSchema });

/** PlanError → its own status and words; anything else is a real fault. */
const handle = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  asyncHandler(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof PlanError) return error(res, err.message, err.status, err.detail ?? null);
      throw err;
    }
  });

async function myPlanId(userId: string): Promise<string> {
  const plan = await findPlanForUser(userId);
  if (!plan) throw new PlanError("We don't have your delivery information yet.", 404);
  return plan.id;
}

router.get('/', handle(async (req, res) => {
  success(res, await planView(req.user!.userId));
}));

router.post('/', validate(createSchema), handle(async (req, res) => {
  const userId = req.user!.userId;
  await createPlan(userId, req.body);
  success(res, await planView(userId), 201);
}));

router.put('/items', validate(itemsBodySchema), handle(async (req, res) => {
  const userId = req.user!.userId;
  const result = await updatePlanItems(await myPlanId(userId), req.body.items);
  success(res, { ...(await planView(userId)), applies_to: result.appliesTo, left_out: result.dropped });
}));

router.put('/settings', validate(settingsSchema), handle(async (req, res) => {
  const userId = req.user!.userId;
  const result = await updatePlanSettings(await myPlanId(userId), userId, req.body);
  success(res, { ...(await planView(userId)), applies_to: result.appliesTo, left_out: result.dropped });
}));

// Nothing pauses a household's Home Grocery any more (2026-10-23): it is
// only their delivery information. Said plainly to an older screen, rather
// than written and then undone by the next read (ensurePlan).
router.post('/pause', handle(async () => {
  throw new PlanError('Home Grocery can no longer be paused. Turn reminders off in your delivery information instead.', 410);
}));

// Kept for an older screen: there is nothing paused to resume, so it answers
// with the household's Home Grocery as it is.
router.post('/resume', handle(async (req, res) => {
  success(res, await planView(req.user!.userId));
}));

router.post('/skip', handle(async (req, res) => {
  const userId = req.user!.userId;
  await skipNextDelivery(await myPlanId(userId));
  success(res, await planView(userId));
}));

// ─── Placing a Home Grocery order ──────────────────────

const slotShape = {
  scheduled_for: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  delivery_window: z.enum(DELIVERY_WINDOWS).nullable().optional(),
};
const placeSchema = z.object({
  ...slotShape,
  items: orderItemsSchema,
  /** Another of their saved addresses for this one order; the plan's by default. */
  address_id: z.string().uuid().optional(),
  customer_notes: z.string().max(2000).optional(),
});

/**
 * POST /api/home-grocery/plan/orders — the household places an order for a
 * day and a part of the day. An ordinary order in every other way: priced for
 * them (wholesale for a business), stock taken, delivery fee as at checkout,
 * a receipt, and the office told. An Idempotency-Key header makes a retry
 * return the same order rather than a second one.
 */
router.post('/orders', validate(placeSchema), handle(async (req, res) => {
  const userId = req.user!.userId;
  const body = req.body as z.infer<typeof placeSchema>;
  const { plan, fields } = await homeGroceryOrderFields(userId, body);
  let result;
  try {
    result = await createOrderForCustomer(
      {
        user_id: userId,
        address_id: body.address_id ?? plan.address_id,
        payment_method: 'cod',
        items: body.items.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity })),
        customer_notes: body.customer_notes,
        ...fields,
      },
      { adminId: null, salesRepId: null },
      { idempotencyKey: req.header('Idempotency-Key') ?? null },
    );
  } catch (err) {
    if (err instanceof CreateOrderError) return error(res, err.message, err.status, err.detail);
    throw err;
  }
  const order = result.order;
  if (!result.replayed) {
    void announceOrderBuiltForCustomer({ orderId: order.id, byCustomer: true });
    void afterPlanOrderChange(order.id);
  }
  success(res, {
    order: {
      id: order.id, order_number: order.order_number, status: order.status, total: order.total,
      scheduled_for: order.scheduled_for, delivery_window: order.delivery_window,
    },
  }, result.replayed ? 200 : 201);
}));

/** PUT /api/home-grocery/plan/orders/:id/slot — move one of their orders to another day or part of the day. */
router.put('/orders/:id/slot', validate(z.object(slotShape)), handle(async (req, res) => {
  success(res, await changeOrderSlot(req.params.id, req.body, { userId: req.user!.userId }));
}));

const historyQuery = z.object({
  status: z.enum(['all', 'upcoming', 'delivered', 'cancelled']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

router.get('/deliveries', handle(async (req, res) => {
  const q = historyQuery.safeParse(req.query);
  if (!q.success) return error(res, 'Invalid filter.', 400);
  const userId = req.user!.userId;
  const plan = await findPlanForUser(userId);
  if (!plan) return success(res, { items: [], total: 0, page: 1, limit: q.data.limit, totalPages: 1 });
  success(res, await listPlanDeliveries(plan.id, q.data.status as HistoryFilter, q.data.page, q.data.limit));
}));

export default router;
