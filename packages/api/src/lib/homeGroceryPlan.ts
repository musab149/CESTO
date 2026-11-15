import { Prisma, type DeliveryWindow, type OrderStatus, type RashanFrequency } from '@prisma/client';
import { z } from 'zod';
import prisma from './prisma';
import { rewriteDraftOrder } from './createOrder';
import { EDITABLE_STATUSES } from './editOrder';
import { MAX_LINE_QUANTITY } from './orderLimits';
import { createNotification } from './notifications';

/**
 * Home Grocery — a household's delivery information (reshaped 2026-10-22/23).
 * The code and the table still say "plan" (rashan_subscriptions); nothing the
 * household or staff read does any more.
 *
 * It is how an approved household likes its groceries delivered: how often,
 * which weekday, which part of the day, which address. It is made from the
 * request the household sent — the form's answers are it — and changed from
 * the household's profile or by staff on the customer's page. Nothing pauses
 * or ends it: an approved household is a Home Grocery customer for good.
 *
 * The plan makes NO orders. A household with a plan shops like anyone else —
 * its cart is its grocery list — and EVERY order it places, or staff or a rep
 * place for it, is a Home Grocery order (2026-10-23): an ordinary order tagged
 * with the plan (`rashan_subscription_id`), which takes stock, prices and
 * invoices like any other and is edited like any other, and which is always
 * Cesto's, one order whatever shops its products come from. Its slot — a day
 * (`scheduled_for`) and a part of the day (`delivery_window`) — is the one
 * thing it adds, chosen at checkout and prefilled from the plan
 * (homeGroceryFieldsFor).
 *
 * The frequency is information only (2026-10-23): nobody is reminded and
 * nothing shows who is "due". nextDue still answers for the legacy views and
 * app builds that read it.
 *
 * Before this the plan kept a standing list and made a draft order ahead of
 * each delivery (user decision 2026-10-21, reversed 2026-10-22). Plans and
 * drafts from those two days keep working: a draft can still be confirmed or
 * skipped, and the old list endpoints still answer for app builds that call
 * them, but nothing is made from a list any more.
 */

/** Weeks between orders. `monthly` is 4 weeks so an order keeps its weekday. */
export const PLAN_WEEKS: Record<RashanFrequency, number> = {
  weekly: 1,
  biweekly: 2,
  every_3_weeks: 3,
  monthly: 4,
  every_6_weeks: 6,
};

/** What a plan offers — the request form's four. `every_6_weeks` is legacy. */
export const PLAN_FREQUENCIES = ['weekly', 'biweekly', 'every_3_weeks', 'monthly'] as const;
export const DELIVERY_WINDOWS = ['morning', 'afternoon', 'evening'] as const;

/** How far ahead an order's day may be. A household cannot pick today; staff can. */
export const SLOT_MAX_DAYS = 30;

/** "Due" opens this many days before the due day — legacy views only; nothing reminds. */
export const REMIND_DAYS_AHEAD = 3;

/** A list, not a warehouse — for the legacy list endpoints. */
export const PLAN_MAX_ITEMS = 200;

/** A Home Grocery order is "upcoming" in any of these (draft: a legacy plan draft). */
export const OPEN_STATUSES: OrderStatus[] = ['draft', 'pending', 'confirmed', 'preparing', 'on_the_way'];

export class PlanError extends Error {
  constructor(message: string, public status = 400, public detail?: Record<string, unknown>) {
    super(message);
    this.name = 'PlanError';
  }
}

export type PlanItem = { product_id: string; variant_id: string; quantity: number };

// ─── Calendar days, in Spain ────────────────────────────────────────────────
//
// Plain 'YYYY-MM-DD' strings for the arithmetic, so no timezone can move an
// order by a day. Stored in a DATE column, written and read at UTC midnight.

export function madridToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}
/** The first day on or after `iso` that falls on `weekday` (no preference = that day). */
export function onOrAfterWeekday(iso: string, weekday: number | null): string {
  if (!weekday) return iso;
  return addDays(iso, (weekday - isoWeekday(iso) + 7) % 7);
}
export const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const toIso = (d: Date) => d.toISOString().slice(0, 10);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// ─── Reading ─────────────────────────────────────────────────────────────────

/** The household's plan: Cesto's (no store), not ended. One at most — a unique index sees to it. */
export function findPlanForUser(userId: string) {
  return prisma.rashanSubscription.findFirst({
    where: { user_id: userId, store_id: null, status: { not: 'cancelled' } },
    orderBy: { created_at: 'desc' },
  });
}

export async function isHomeGrocerySubscriber(userId: string): Promise<boolean> {
  return (await prisma.homeGroceryProfile.count({ where: { user_id: userId } })) > 0;
}

/** The household's Home Grocery order in progress, if any: the earliest open one. */
export function findUpcoming(planId: string) {
  return prisma.order.findFirst({
    where: { rashan_subscription_id: planId, deleted_at: null, status: { in: OPEN_STATUSES } },
    orderBy: [{ scheduled_for: { sort: 'asc', nulls: 'last' } }, { created_at: 'asc' }],
  });
}

const WINDOW_FROM_SLOT: Array<[RegExp, DeliveryWindow]> = [
  [/ma[ñn]ana|morning/i, 'morning'],
  [/tarde|afternoon/i, 'afternoon'],
  [/noche|evening|night/i, 'evening'],
];

/**
 * The household's delivery information (the "plan" row), made from the
 * approved request if there is none yet: the form's frequency, its household
 * size, the address it gave (or the account's default). Read on every visit,
 * so a household approved before this existed — or one that only now added an
 * address — gets it the first time it looks. Null when there is no approved
 * request, or no address to deliver to yet.
 *
 * Nothing pauses or ends it any more (2026-10-23): it is only information, and
 * an approved household is a Home Grocery customer for good. So a row left
 * paused, or ended, by the screens before is simply made active again — the
 * same row, so its orders stay with it. An old self-serve subscription (it has
 * a pack) does not count.
 */
export async function ensurePlan(userId: string) {
  const profile = await prisma.homeGroceryProfile.findUnique({ where: { user_id: userId } });
  const existing = await findPlanForUser(userId);
  if (existing) {
    if (existing.status === 'active' || !profile) return existing;
    return prisma.rashanSubscription.update({ where: { id: existing.id }, data: { status: 'active', paused_at: null } });
  }
  if (!profile) return null;
  const ended = await prisma.rashanSubscription.findFirst({
    where: { user_id: userId, store_id: null, pack_id: null, status: 'cancelled' },
    orderBy: { updated_at: 'desc' },
  });
  if (ended) {
    try {
      return await prisma.rashanSubscription.update({
        where: { id: ended.id },
        data: { status: 'active', paused_at: null, cancelled_at: null, cancellation_reason: null },
      });
    } catch (err) {
      // The one-live-row index: another visit brought one back first.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return findPlanForUser(userId);
      throw err;
    }
  }
  const address = await prisma.address.findFirst({
    where: { user_id: userId },
    orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
    select: { id: true },
  });
  if (!address) return null;
  const slot = profile.preferred_slot ?? '';
  try {
    return await prisma.rashanSubscription.create({
      data: {
        user_id: userId,
        items: [] as unknown as Prisma.InputJsonValue,
        household: profile.household_size,
        frequency: profile.frequency,
        preferred_weekday: null,
        preferred_window: WINDOW_FROM_SLOT.find(([re]) => re.test(slot))?.[1] ?? null,
        notify_before: true,
        address_id: address.id,
        payment_method: 'cod',
        status: 'active',
      },
    });
  } catch (err) {
    // The one-live-plan index: two first visits at once. The other one won.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return findPlanForUser(userId);
    throw err;
  }
}

/**
 * The day the household's next order is due: one interval after its last
 * order that was not cancelled, on the preferred weekday — and never before
 * tomorrow, the first day an order can be for. With no order yet it is due
 * straight away (the first preferred weekday from tomorrow).
 */
export async function nextDue(plan: { id: string; frequency: RashanFrequency; preferred_weekday: number | null }): Promise<string> {
  const last = await prisma.order.findFirst({
    where: { rashan_subscription_id: plan.id, deleted_at: null, status: { not: 'cancelled' } },
    orderBy: [{ scheduled_for: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
    select: { scheduled_for: true, created_at: true },
  });
  return dueAfter(last ? orderDay(last) : null, plan.frequency, plan.preferred_weekday);
}

/** The day an order counts as: its slot, or the day it was placed when it has none. */
export const orderDay = (o: { scheduled_for: Date | null; created_at: Date }) =>
  (o.scheduled_for ? toIso(o.scheduled_for) : madridToday(o.created_at));

/** nextDue's rule on its own, for a caller that already holds the last order's day. */
export function dueAfter(last: string | null, frequency: RashanFrequency, weekday: number | null): string {
  const earliest = onOrAfterWeekday(addDays(madridToday(), 1), weekday);
  if (!last) return earliest;
  const due = onOrAfterWeekday(addDays(last, PLAN_WEEKS[frequency] * 7), weekday);
  return due > earliest ? due : earliest;
}

/** Due = the reminder window has opened and nothing is on its way already. */
export function isDue(dueIso: string, hasOpenOrder: boolean): boolean {
  return !hasOpenOrder && madridToday() >= addDays(dueIso, -REMIND_DAYS_AHEAD);
}

// ─── A Home Grocery order's slot ────────────────────────────────────────────

export type Slot = { scheduled_for: string; delivery_window?: DeliveryWindow | null };

/** A slot as a request sends it — shared by the household's, the admin's and the rep's routes. */
export const slotSchema = z.object({
  scheduled_for: z.string().regex(ISO_DAY),
  delivery_window: z.enum(DELIVERY_WINDOWS).nullable().optional(),
});

/** A day from tomorrow (today, for staff) to SLOT_MAX_DAYS ahead, and morning / afternoon / evening or any time. */
export function checkSlot(slot: Slot, opts: { staff?: boolean } = {}): void {
  if (!ISO_DAY.test(slot.scheduled_for) || Number.isNaN(toDate(slot.scheduled_for).getTime())) {
    throw new PlanError('Choose the delivery day.', 422);
  }
  const today = madridToday();
  const first = opts.staff ? today : addDays(today, 1);
  if (slot.scheduled_for < first) {
    throw new PlanError(opts.staff ? 'The delivery day cannot be in the past.' : 'Choose a day from tomorrow on.', 422);
  }
  if (slot.scheduled_for > addDays(today, SLOT_MAX_DAYS)) {
    throw new PlanError(`Choose a day within the next ${SLOT_MAX_DAYS} days.`, 422);
  }
  if (slot.delivery_window != null && !(DELIVERY_WINDOWS as readonly string[]).includes(slot.delivery_window)) {
    throw new PlanError('Choose morning, afternoon or evening.', 422);
  }
}

/**
 * The fields that make an order a Home Grocery order, for a household and a
 * slot: its plan (made now if it was not yet) and the checked slot. Every
 * route that places one — the household's, the admin's, the rep's — goes
 * through here, so the rules cannot differ between them.
 */
export async function homeGroceryOrderFields(userId: string, slot: Slot, opts: { staff?: boolean } = {}) {
  const plan = await ensurePlan(userId);
  if (!plan) {
    throw new PlanError(
      (await isHomeGrocerySubscriber(userId))
        ? 'Add a delivery address first: Home Grocery delivers to one of your saved addresses.'
        : 'Home Grocery orders are for approved households.',
      422,
    );
  }
  checkSlot(slot, opts);
  return {
    plan,
    fields: {
      rashan_subscription_id: plan.id,
      scheduled_for: toDate(slot.scheduled_for),
      delivery_window: slot.delivery_window ?? null,
    },
  };
}

/**
 * The slot an order gets when nobody chose one — an app build with no slot
 * screen, or a staff screen that sent none: their preferred weekday from the
 * first day on offer (tomorrow for the household, today for staff), or that
 * first day with no preference, at their preferred part of the day. The first
 * delivery that suits them, which is what someone ordering now wants.
 */
export function defaultSlot(
  plan: { preferred_weekday: number | null; preferred_window: DeliveryWindow | null },
  opts: { staff?: boolean } = {},
): Slot {
  const first = opts.staff ? madridToday() : addDays(madridToday(), 1);
  return { scheduled_for: onOrAfterWeekday(first, plan.preferred_weekday), delivery_window: plan.preferred_window };
}

/**
 * The Home Grocery fields for ANY order placed by or for this customer: every
 * order of a household with a plan is one of theirs (2026-10-23). Null when
 * they have no plan — not approved, plan ended, or no address yet — and the
 * order is an ordinary one. With no slot, defaultSlot's.
 *
 * A slot sent for a customer with no plan is refused for staff and reps, who
 * chose it on purpose. The household's own checkout passes `lenient`: a page
 * that still thought them a household (their plan ended a minute ago) places
 * an ordinary order instead of failing.
 */
export async function homeGroceryFieldsFor(
  userId: string,
  slot: Slot | null | undefined,
  opts: { staff?: boolean; lenient?: boolean } = {},
) {
  const plan = await ensurePlan(userId);
  if (!plan) {
    if (slot && !opts.lenient) return homeGroceryOrderFields(userId, slot, opts); // throws, with the reason
    return null;
  }
  const s = slot ?? defaultSlot(plan, opts);
  checkSlot(s, opts);
  return {
    plan,
    fields: { rashan_subscription_id: plan.id, scheduled_for: toDate(s.scheduled_for), delivery_window: s.delivery_window ?? null },
  };
}

/**
 * After a Home Grocery order is placed, delivered or cancelled: bring the
 * plan's count and its next due day up to date, and let the reminder go
 * again for the new due day. Fire-and-forget: it logs, never throws.
 */
export async function afterPlanOrderChange(orderId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { rashan_subscription_id: true } });
    if (!order?.rashan_subscription_id) return;
    await refreshPlan(order.rashan_subscription_id);
  } catch (err) {
    console.error('[homeGroceryPlan] plan refresh after', orderId, 'failed', err);
  }
}

async function refreshPlan(planId: string) {
  const plan = await prisma.rashanSubscription.findUnique({ where: { id: planId } });
  if (!plan) return;
  // Counted, not incremented, so a status set twice cannot count twice.
  const delivered = await prisma.order.count({ where: { rashan_subscription_id: planId, status: 'delivered', deleted_at: null } });
  const due = await nextDue(plan);
  await prisma.rashanSubscription.update({
    where: { id: planId },
    data: {
      cycles_completed: delivered,
      next_delivery_date: toDate(due),
    },
  });
}

/**
 * Move an order's slot — the household's own, or any for staff. Only while
 * nobody has started preparing it: after that the rider's round is set.
 */
export async function changeOrderSlot(orderId: string, slot: Slot, scope: { userId?: string; staff?: boolean }) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, deleted_at: null, ...(scope.userId ? { user_id: scope.userId } : {}) },
    select: { id: true, status: true, rashan_subscription_id: true },
  });
  if (!order) throw new PlanError('Order not found.', 404);
  if (!order.rashan_subscription_id) throw new PlanError('Only a Home Grocery order has a delivery slot to change.', 422);
  if (!['draft', 'pending', 'confirmed'].includes(order.status)) {
    throw new PlanError('We have already started preparing this order, so its day can no longer change.', 409);
  }
  checkSlot(slot, { staff: scope.staff });
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { scheduled_for: toDate(slot.scheduled_for), delivery_window: slot.delivery_window ?? null },
    select: { id: true, scheduled_for: true, delivery_window: true },
  });
  void afterPlanOrderChange(order.id);
  return updated;
}

// ─── Changing the plan ──────────────────────────────────────────────────────

export type PlanSettings = {
  frequency?: RashanFrequency;
  preferred_weekday?: number | null;
  preferred_window?: DeliveryWindow | null;
  address_id?: string;
  notify_before?: boolean;
};

async function assertAddress(userId: string, addressId: string) {
  const address = await prisma.address.findFirst({ where: { id: addressId, user_id: userId }, select: { id: true } });
  if (!address) throw new PlanError('Choose one of your saved addresses.', 422);
}

function checkSettings(s: PlanSettings) {
  if (s.frequency && !(PLAN_FREQUENCIES as readonly string[]).includes(s.frequency)) {
    throw new PlanError('Choose every 1, 2, 3 or 4 weeks.', 422);
  }
  if (s.preferred_weekday != null && !(Number.isInteger(s.preferred_weekday) && s.preferred_weekday >= 1 && s.preferred_weekday <= 7)) {
    throw new PlanError('Choose a day of the week.', 422);
  }
  if (s.preferred_window != null && !(DELIVERY_WINDOWS as readonly string[]).includes(s.preferred_window)) {
    throw new PlanError('Choose morning, afternoon or evening.', 422);
  }
}

/**
 * Set a plan up by hand — for a household the request could not give one to
 * (no address then). The settings only: `items` is still accepted from app
 * builds that send a list, and ignored.
 */
export async function createPlan(userId: string, input: PlanSettings & { address_id: string; items?: unknown }) {
  if (!(await isHomeGrocerySubscriber(userId))) {
    throw new PlanError('Home Grocery is for approved households. Send us a request first.', 403);
  }
  if (await findPlanForUser(userId)) throw new PlanError('Your delivery information is already there. Change it instead.', 409);
  checkSettings(input);
  await assertAddress(userId, input.address_id);
  const profile = await prisma.homeGroceryProfile.findUnique({ where: { user_id: userId } });
  let plan;
  try {
    plan = await prisma.rashanSubscription.create({
      data: {
        user_id: userId,
        items: [] as unknown as Prisma.InputJsonValue,
        household: profile?.household_size ?? 2,
        frequency: input.frequency ?? profile?.frequency ?? 'biweekly',
        preferred_weekday: input.preferred_weekday ?? null,
        preferred_window: input.preferred_window ?? null,
        notify_before: input.notify_before ?? true,
        address_id: input.address_id,
        payment_method: 'cod',
        status: 'active',
      },
    });
  } catch (err) {
    // The one-live-plan index: a double press, or two tabs.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new PlanError('Your delivery information is already there. Change it instead.', 409);
    }
    throw err;
  }
  await refreshPlan(plan.id);
  return { plan };
}

export async function updatePlanSettings(planId: string, userId: string, s: PlanSettings) {
  checkSettings(s);
  if (s.address_id) await assertAddress(userId, s.address_id);
  await prisma.rashanSubscription.update({
    where: { id: planId },
    data: {
      ...(s.frequency ? { frequency: s.frequency } : {}),
      ...(s.preferred_weekday !== undefined ? { preferred_weekday: s.preferred_weekday } : {}),
      ...(s.preferred_window !== undefined ? { preferred_window: s.preferred_window } : {}),
      ...(s.address_id ? { address_id: s.address_id } : {}),
      ...(s.notify_before !== undefined ? { notify_before: s.notify_before } : {}),
    },
  });
  // A new rhythm or weekday moves the due day. Orders already placed keep
  // their own slots — those are changed on the order.
  await refreshPlan(planId);
  return { appliesTo: 'none' as const, dropped: [] as string[] };
}

/**
 * Skip a delivery the plan made ahead (the model before 2026-10-22). Only a
 * plan's own draft can be skipped; an order the household placed is cancelled
 * from the order instead, like any order.
 */
export async function skipNextDelivery(planId: string) {
  const open = await findUpcoming(planId);
  if (!open || open.status !== 'draft') {
    throw new PlanError('There is no planned delivery to skip. To stop an order you placed, cancel it from the order.', 409);
  }
  await prisma.order.updateMany({
    where: { id: open.id, status: 'draft' },
    data: { status: 'cancelled', cancelled_reason: 'Skipped' },
  });
  await refreshPlan(planId);
}

// ─── The old list, kept answering ───────────────────────────────────────────

/**
 * A list as an older app build sends it, checked and tidied: one line per
 * variant, the variant really is that product's, both on sale today.
 */
export async function validatePlanItems(raw: unknown): Promise<PlanItem[]> {
  if (!Array.isArray(raw)) throw new PlanError('The list is not valid.', 422);
  const merged = new Map<string, PlanItem>();
  for (const r of raw) {
    const item = r as Partial<PlanItem>;
    if (typeof item?.product_id !== 'string' || typeof item?.variant_id !== 'string'
      || !Number.isInteger(item.quantity) || (item.quantity as number) < 1) {
      throw new PlanError('The list is not valid.', 422);
    }
    const prev = merged.get(item.variant_id);
    merged.set(item.variant_id, {
      product_id: item.product_id,
      variant_id: item.variant_id,
      quantity: (prev?.quantity ?? 0) + (item.quantity as number),
    });
  }
  const items = [...merged.values()];
  if (items.length > PLAN_MAX_ITEMS) throw new PlanError(`A list can hold up to ${PLAN_MAX_ITEMS} products.`, 422);
  if (items.some((i) => i.quantity > MAX_LINE_QUANTITY)) {
    throw new PlanError(`Up to ${MAX_LINE_QUANTITY.toLocaleString('en')} of one product.`, 422);
  }
  return items;
}

/** Store a list an older app build sends. Nothing is made from it any more. */
export async function updatePlanItems(planId: string, raw: unknown) {
  const items = await validatePlanItems(raw);
  await prisma.rashanSubscription.update({
    where: { id: planId },
    data: { items: items as unknown as Prisma.InputJsonValue },
  });
  return { appliesTo: 'none' as const, dropped: [] as string[] };
}

// ─── History ─────────────────────────────────────────────────────────────────

export type HistoryFilter = 'all' | 'upcoming' | 'delivered' | 'cancelled';

export async function listPlanDeliveries(planId: string, filter: HistoryFilter, page: number, limit: number) {
  const where: Prisma.OrderWhereInput = { rashan_subscription_id: planId, deleted_at: null };
  if (filter === 'upcoming') where.status = { in: OPEN_STATUSES };
  if (filter === 'delivered') where.status = 'delivered';
  if (filter === 'cancelled') where.status = 'cancelled';
  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: [{ scheduled_for: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, order_number: true, status: true, scheduled_for: true, delivery_window: true, total: true,
        cancelled_reason: true, created_at: true,
        _count: { select: { items: true } },
        rider: { select: { name: true, phone: true, vehicle_type: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);
  return {
    items: rows.map(({ _count, ...r }) => ({ ...r, item_count: _count.items })),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

// ─── Notifications ──────────────────────────────────────────────────────────

const DAY_NAMES = {
  es: ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};
function sayDate(iso: string, lang: 'es' | 'en'): string {
  const d = toDate(iso);
  const day = DAY_NAMES[lang][isoWeekday(iso) - 1];
  const month = new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : 'en-GB', { month: 'long', timeZone: 'UTC' }).format(d);
  return lang === 'es' ? `el ${day} ${d.getUTCDate()} de ${month}` : `${day} ${d.getUTCDate()} ${month}`;
}

// ─── The view both sides read ───────────────────────────────────────────────

const addressSelect = {
  id: true, contact_name: true, contact_phone: true, street_line_1: true, street_line_2: true,
  postcode: true, city: true, province: true, is_default: true,
} as const;

const orderRowSelect = {
  id: true, order_number: true, status: true, scheduled_for: true, delivery_window: true,
  subtotal: true, delivery_fee: true, total: true, cancelled_reason: true,
  _count: { select: { items: true } },
  rider: { select: { name: true, phone: true, vehicle_type: true } },
} satisfies Prisma.OrderSelect;

type OrderRow = Prisma.OrderGetPayload<{ select: typeof orderRowSelect }>;

function asOpen({ _count, ...o }: OrderRow) {
  return {
    ...o,
    item_count: _count.items,
    // The household can still change it — its products and its slot.
    editable: o.status === 'draft' || EDITABLE_STATUSES.includes(o.status),
  };
}

/**
 * Everything the plan screens show, for one household: whether they may have
 * a plan, the plan (made from their request on first read), the orders under
 * way, the last few that settled, and when the next one is due.
 */
export async function planView(userId: string) {
  const subscriber = await isHomeGrocerySubscriber(userId);
  const plan = await ensurePlan(userId);
  const empty = {
    subscriber, plan: null, upcoming: null, open: [], recent: [], next_due: null, due: false,
    problem: null, dropped: [] as string[],
  };
  if (!plan) return empty;

  const [address, open, recent, due] = await Promise.all([
    prisma.address.findUnique({ where: { id: plan.address_id }, select: addressSelect }),
    prisma.order.findMany({
      where: { rashan_subscription_id: plan.id, deleted_at: null, status: { in: OPEN_STATUSES } },
      orderBy: [{ scheduled_for: { sort: 'asc', nulls: 'last' } }, { created_at: 'asc' }],
      take: 10,
      select: orderRowSelect,
    }),
    prisma.order.findMany({
      where: { rashan_subscription_id: plan.id, deleted_at: null, status: { in: ['delivered', 'cancelled'] } },
      orderBy: [{ scheduled_for: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
      take: 3,
      select: orderRowSelect,
    }),
    nextDue(plan),
  ]);
  const openRows = open.map(asOpen);
  return {
    subscriber,
    plan: {
      id: plan.id,
      status: plan.status,
      frequency: plan.frequency,
      preferred_weekday: plan.preferred_weekday,
      preferred_window: plan.preferred_window,
      notify_before: plan.notify_before,
      // The list an older app build kept; nothing reads it here any more.
      items: Array.isArray(plan.items) ? (plan.items as unknown as PlanItem[]) : [],
      household: plan.household,
      cycles_completed: plan.cycles_completed,
      next_delivery_date: plan.next_delivery_date,
      paused_at: plan.paused_at,
      created_at: plan.created_at,
      address,
    },
    /** The earliest order under way — what "next delivery" shows. */
    upcoming: openRows[0] ?? null,
    /** Every order under way, earliest first. */
    open: openRows,
    recent: recent.map(({ _count, rider: _r, subtotal: _s, delivery_fee: _f, delivery_window: _w, ...r }) => ({ ...r, item_count: _count.items })),
    /** The day the next order is due, by the plan's frequency. */
    next_due: due,
    due: plan.status === 'active' && isDue(due, openRows.length > 0),
    problem: null,
    dropped: [] as string[],
  };
}

// ─── Around staff confirming a legacy plan draft ────────────────────────────

/**
 * Before staff confirm a draft the old plan made: price it again at today's
 * prices, keeping its lines. A non-plan order, or one no longer a draft, is
 * left alone — so this is a no-op for every order placed since 2026-10-22.
 *
 * ONLY ONE THE PLAN MADE AND NOBODY TOUCHED (2026-11-04). A Home Grocery
 * draft staff or a rep saved is theirs, priced when they built it, like any
 * draft they save; and a draft somebody edited holds what they chose. The
 * rewrite replaces every line, so it would put back today's price, the
 * customer's saved discount and the size's buying price over theirs.
 */
export async function repricePlanDraft(orderId: string): Promise<void> {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId, status: 'draft', deleted_at: null, rashan_subscription_id: { not: null },
      created_by_admin_id: null, created_by_sales_rep_id: null,
      edit_logs: { none: {} },
    },
    select: { id: true, items: { select: { variant_id: true, quantity: true } } },
  });
  if (!order) return;
  const qty = new Map<string, number>();
  for (const i of order.items) qty.set(i.variant_id, (qty.get(i.variant_id) ?? 0) + i.quantity);
  await rewriteDraftOrder(order.id, { items: [...qty].map(([variant_id, quantity]) => ({ variant_id, quantity })) });
}

/** Staff confirmed a legacy plan draft: tell the household it is being prepared. */
export async function afterPlanDraftConfirmed(orderId: string): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, order_number: true, user_id: true, scheduled_for: true,
        rashan_subscription: { select: { notify_before: true } },
      },
    });
    if (!order?.rashan_subscription?.notify_before) return;
    const when = order.scheduled_for ? toIso(order.scheduled_for) : null;
    await createNotification({
      audience: 'customer',
      user_id: order.user_id,
      type: 'home_grocery_delivery_planned',
      title_es: 'Estamos preparando tu compra del hogar',
      title_en: "We're preparing your Home Grocery delivery",
      body_es: when ? `Para ${sayDate(when, 'es')}.` : 'Ya la estamos preparando.',
      body_en: when ? `For ${sayDate(when, 'en')}.` : "We're preparing it now.",
      deeplink: `/orders/${order.id}`,
      data: { order_id: order.id, order_number: order.order_number },
    });
  } catch (err) {
    console.error('[homeGroceryPlan] confirm notice failed', orderId, err);
  }
}
