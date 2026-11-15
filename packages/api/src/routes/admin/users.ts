import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { parsePage, paged } from '../../lib/pagination';
import { requireRole } from '../../middleware/adminAuth';
import { eraseUser, UserErasureError } from '../../lib/eraseUser';
import { recentOrderGroupsForUser } from '../../lib/orderGroups';
import { listSavedDiscounts, forgetDiscount } from '../../lib/customerDiscounts';
import { OPENED_BY_US, SELF_REGISTERED } from '../../lib/orderSource';
import { OPEN_STATUSES, dueAfter, isDue, orderDay } from '../../lib/homeGroceryPlan';
import { issueClientCredentials, accessOf, ACCESS_SELECT } from '../../lib/clientCredentials';
import { slugifyStoreName, makeUniqueStoreSlug } from '../../lib/storeSlug';
import {
  createClient, ClientConflictError,
  clientCoreShape, clientVendorSchema, requireCompanyForBusiness,
  clientAddressSchema as addressSchema,
} from '../../lib/createClient';

import { applyRecargoToOpenOrders } from '../../lib/orderRecargo';
const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const params = parsePage(req.query, 20, 100);
  const { q, status, customerType, role, segment } = req.query as Record<string, string | undefined>;

  const where: Prisma.UserWhereInput = {};
  // Every clause that needs its own OR goes here; Prisma types `AND` as
  // `X | X[]`, so it is built as an array and assigned once at the end.
  const and: Prisma.UserWhereInput[] = [];
  if (status) where.status = status as Prisma.UserWhereInput['status'];
  /**
   * Somebody on the rashan side: a monthly-ration customer.
   *
   * Two ways in, and they are NOT gated the same way.
   *
   *   a rep opened the account at someone's door — rashan only if the account
   *   is B2C, because a rep opening a WHOLESALE account is a different trade;
   *
   *   they subscribed on the website themselves — rashan whatever kind of
   *   account they hold. The subscription IS the fact; a wholesale customer
   *   who also takes a monthly ration is still on the round.
   *
   * Gating both arms on B2C emptied this tab on production, where the only
   * rep-created account and the only subscriber are both business accounts.
   *
   * A third way in since the Home Grocery revamp: an approved request, which
   * leaves a HomeGroceryProfile. Like a subscription, it holds whatever kind
   * of account they are — and it is the only arm that catches a customer who
   * signed themselves up and was then approved, since neither of the other
   * two is true of them.
   */
  const RASHAN: Prisma.UserWhereInput = {
    OR: [
      // AND, not two keys in one object: OPENED_BY_US is itself an OR.
      { AND: [OPENED_BY_US, { is_business: false }] },
      { subscriptions: { some: {} } },
      { home_grocery_profile: { isNot: null } },
    ],
  };

  /**
   * One axis, four values, matching the tabs — rather than a `customerType`
   * and a `role` that have to be combined correctly at every call site.
   * `customerType` and `role` are still honoured as the names that shipped.
   *
   * `customers` EXCLUDES rashan: those have their own tab, and a customer
   * listed in two places is a customer you count twice. `partner` does not
   * exclude anything, because owning a store is independent of how you buy.
   */
  const seg = segment
    ?? (role === 'partner' ? 'partner' : undefined)
    ?? (customerType === 'b2b' ? 'b2b' : customerType === 'retail' ? 'customers' : undefined);

  if (seg === 'b2b') {
    where.is_business = true;
  } else if (seg === 'partner') {
    where.partner_roles = { some: {} };
  } else if (seg === 'rashan') {
    // Pushed onto AND, never assigned to where.OR — the search below also
    // wants OR, and whichever ran second used to silently erase the other.
    and.push(RASHAN);
  } else if (seg === 'customers') {
    /**
     * A regular shopper who signed themselves up on the website — stated
     * directly rather than as "retail minus rashan", because that phrasing
     * quietly let partners in: a shop owner's account is created by lead
     * approval, which sets neither creator column nor a subscription, so
     * eight of twelve rows here were vendors rather than customers.
     *
     * BOTH creator columns, via SELF_REGISTERED. Asking only about staff put
     * every rep-opened client in here as a self-signup.
     */
    where.is_business = false;
    and.push(SELF_REGISTERED);
    where.subscriptions = { none: {} };
    where.home_grocery_profile = { is: null };
    where.partner_roles = { none: {} };
  }
  if (q) {
    // Also on AND, for the same reason: a segment and a search have to BOTH
    // hold, and two bare `where.OR` assignments cannot express that.
    and.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
      ],
    });
  }

  if (and.length > 0) where.AND = and;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true, name: true, email: true, phone: true, status: true,
        created_at: true, is_business: true, pricing_mode: true,
        /**
         * Where a business customer's phone actually lives.
         *
         * Approving a B2B lead writes the number it collected to
         * BusinessProfile.contact_phone and never touches User.phone (see
         * approveBusinessSchema — its `user` block takes only a name and an
         * email). So every one of these accounts reads as having no phone
         * while the number sits one table over, which is why the B2B list
         * showed a dash for all 91 of them.
         *
         * Surfaced rather than copied across: User.phone is @unique and the
         * applications genuinely contain repeats — the same number appears on
         * more than one production lead — so a backfill would collide, and
         * picking a winner would be inventing an answer.
         */
        business_profile: { select: { contact_phone: true, company: true } },
        // The Home Grocery tab's own columns, and the number they gave on the
        // form — which, like a business contact number, never reaches
        // User.phone (see HomeGroceryProfile.contact_phone).
        home_grocery_profile: {
          select: { contact_phone: true, household_size: true, frequency: true, approved_at: true },
        },
        partner_roles: {
          select: { store_id: true, role: true, store: { select: { name: true, slug: true } } },
          take: 1,
        },
        /**
         * The last place a RETAIL customer's phone can be found.
         *
         * Signing up by email or Google asks for a name, an email and a
         * password — never a number — so User.phone is null for all 94
         * retail accounts on production. The one they actually gave is the
         * one they typed to receive a delivery, on the address.
         *
         * Only 29 of those 94 have one even so: the other 65 have no address
         * at all, having registered and never ordered. Those have no phone
         * anywhere and a dash is the honest answer for them.
         *
         * Address.contact_phone is NOT NULL, so having an address is the
         * same as having a number here. Default address first, so the one
         * picked is the one somebody would actually call.
         */
        addresses: {
          select: { contact_phone: true },
          orderBy: { is_default: 'desc' },
          take: 1,
        },
        _count: { select: { orders: true, addresses: true } },
        orders: {
          select: { created_at: true },
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
      orderBy: { created_at: 'desc' },
      skip: params.skip,
      take: params.limit,
    }),
    prisma.user.count({ where }),
  ]);

  /**
   * PURCHASES PER CUSTOMER, which is not the same number as order rows.
   *
   * A split checkout is several Order rows and ONE purchase, so `_count.orders`
   * — a plain relation count — reads 7 for somebody who has bought twice. The
   * customer DETAIL page has grouped correctly for a while; this list still
   * showed the rows, which is the number a human reads as "how many times has
   * this person ordered".
   *
   * One query for the whole page rather than one per row: the ids are already
   * in hand, so this is a single GROUP BY instead of twenty counts. Soft-
   * deleted orders are excluded here, which the relation count does not do
   * either.
   */
  const pageIds = users.map((u) => u.id);
  const purchaseRows = pageIds.length === 0 ? [] : await prisma.$queryRaw<
    { user_id: string; purchases: number }[]
  >`
    SELECT user_id, COUNT(*)::int AS purchases
      FROM (
        SELECT DISTINCT o.user_id, COALESCE(o.parent_order_id, o.id) AS g
          FROM "orders" o
         WHERE o.user_id IN (${Prisma.join(pageIds.map((id) => Prisma.sql`${id}::uuid`))})
           AND o.deleted_at IS NULL
      ) t
     GROUP BY user_id`;
  const purchasesByUser = new Map(purchaseRows.map((r) => [r.user_id, r.purchases]));

  /**
   * The Home Grocery tab's plan column: each household's plan (the live
   * Cesto one, as lib/homeGroceryPlan reads it) and its next open delivery.
   * One query for the page, and only on that tab.
   */
  const plans = seg === 'rashan' && pageIds.length > 0
    ? await prisma.rashanSubscription.findMany({
      where: { user_id: { in: pageIds }, store_id: null, status: { not: 'cancelled' } },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, user_id: true, status: true, frequency: true, preferred_weekday: true,
        orders: {
          where: { deleted_at: null, status: { in: OPEN_STATUSES } },
          orderBy: [{ scheduled_for: 'asc' }, { created_at: 'asc' }],
          take: 1,
          select: { id: true, order_number: true, status: true, scheduled_for: true, delivery_window: true },
        },
      },
    })
    : [];
  const planByUser = new Map<string, (typeof plans)[number]>();
  for (const p of plans) if (!planByUser.has(p.user_id)) planByUser.set(p.user_id, p);
  // When each plan's next order is due: from its last order that was not
  // cancelled — one query for the page, newest first, first per plan wins.
  const lastOrders = plans.length > 0
    ? await prisma.order.findMany({
      where: { rashan_subscription_id: { in: plans.map((p) => p.id) }, deleted_at: null, status: { not: 'cancelled' } },
      orderBy: [{ scheduled_for: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
      select: { rashan_subscription_id: true, scheduled_for: true, created_at: true },
    })
    : [];
  const lastDayByPlan = new Map<string, string>();
  for (const o of lastOrders) {
    if (o.rashan_subscription_id && !lastDayByPlan.has(o.rashan_subscription_id)) lastDayByPlan.set(o.rashan_subscription_id, orderDay(o));
  }

  // Flatten last order timestamp onto the row for an easier consumer shape
  const enriched = users.map(({ orders, business_profile, home_grocery_profile, addresses, ...u }) => ({
    ...u,
    /** Purchases, not rows — see purchasesByUser above. */
    purchase_count: purchasesByUser.get(u.id) ?? 0,
    last_order_at: orders[0]?.created_at ?? null,
    /** Trading name, off BusinessProfile. The B2B list's own column. */
    company: business_profile?.company ?? null,
    /** The number on their delivery address — a retail customer's only one. */
    address_phone: addresses[0]?.contact_phone ?? null,
    // The business contact number, kept as its OWN field rather than folded
    // into `phone`. A row that says `phone` should mean User.phone, or every
    // consumer that later writes one back would write the company's switchboard
    // onto the person. The screens decide which to show.
    contact_phone: business_profile?.contact_phone ?? null,
    /** Set for a Home Grocery subscriber. */
    home_grocery: home_grocery_profile ?? null,
    /** Their Home Grocery plan and its next delivery — on the Home Grocery tab only. */
    ...(seg === 'rashan' ? {
      home_grocery_plan: (() => {
        const p = planByUser.get(u.id);
        if (!p) return null;
        const next = p.orders[0];
        const due = dueAfter(lastDayByPlan.get(p.id) ?? null, p.frequency, p.preferred_weekday);
        return {
          id: p.id,
          status: p.status,
          frequency: p.frequency,
          next: next ? { ...next, scheduled_for: next.scheduled_for?.toISOString().slice(0, 10) ?? null } : null,
          /** When the next order is due by the plan's frequency, and whether that is now. */
          next_due: due,
          due: p.status === 'active' && isDue(due, !!next),
        };
      })(),
    } : {}),
  }));

  return success(res, paged(enriched, total, params));
}));

/**
 * Everything the admin customer page shows, in one request.
 *
 * It used to return the profile, the addresses and the ten most recent
 * orders, which is why the page read as an order list with a sidebar rather
 * than a view of a customer. The pieces below are the ones an admin actually
 * asks for when a customer is on the phone: what they are worth, what they
 * have open right now, and what they have said in public.
 *
 * Orders come back GROUPED, ten purchases rather than ten rows: a split
 * checkout is several Order rows and showing them separately makes one
 * purchase look like three. `stats.orders.total` stays a count of rows, so
 * the page says "10 of N purchases" from `orders.length` and links to the
 * rest rather than paginating a list it does not have.
 */
const RECENT_ORDERS = 10;

// ─── GET /api/admin/users/lookup ────────────────────────
//
// Answers "is this email or phone already taken?" while the rep is still
// typing, instead of at submit.
//
// Both matter, for different reasons, and the difference is the whole point
// of returning them separately:
//
//   email — NOT an error. POST /api/admin/users upgrades an existing account
//           rather than refusing, so the honest thing to say is "this person
//           already exists, you are about to give them credentials", not
//           "that email is taken".
//   phone — a hard stop. User.phone is UNIQUE and the create cannot reassign
//           someone else's number, so a rep who only finds out at the end has
//           filled in three steps for nothing.
//
// Declared above GET /:id deliberately: Express matches in order, and ':id'
// would otherwise swallow "lookup" and 404 on a bad uuid.

const lookupSchema = z.object({
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(20).optional(),
});

router.get('/lookup', asyncHandler(async (req, res) => {
  const parsed = lookupSchema.safeParse(req.query);
  if (!parsed.success) return error(res, 'Invalid lookup.', 422);
  const { email, phone } = parsed.data;

  const [found, byPhone] = await Promise.all([
    email
      ? prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        select: {
          id: true, name: true, status: true, is_business: true,
          // For giving somebody a store (2026-10-31): whether a password of
          // their own will stand, and what they already manage. The hash is
          // read only to say which — it never goes out.
          ...ACCESS_SELECT,
          partner_roles: { where: { is_active: true }, select: { store: { select: { id: true, name: true } } } },
        },
      })
      : Promise.resolve(null),
    phone
      ? prisma.user.findUnique({
        where: { phone },
        select: { id: true, name: true },
      })
      : Promise.resolve(null),
  ]);

  const byEmail = found && {
    id: found.id,
    name: found.name,
    status: found.status,
    is_business: found.is_business,
    access: accessOf(found),
    partner_stores: found.partner_roles.map((r) => r.store),
  };
  return success(res, { email: byEmail, phone: byPhone });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      addresses: { orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }] },
      business_profile: true,
      // Household details ops build the month's order from, plus the request
      // it came from so the page can link back to what they wrote.
      home_grocery_profile: {
        include: { source_lead: { select: { id: true, created_at: true } } },
      },
      // Who opened the account, for a rep-created client. Distinct from
      // sales_manager_name, which is who MANAGES it — the same person today,
      // but they diverge as soon as a client is reassigned.
      created_by_admin: { select: { id: true, name: true } },
      created_by_sales_rep: { select: { id: true, name: true } },
      // The shops this person SELLS through — a different relationship from
      // the one every other field here describes. Without it the page cannot
      // tell a shopper from a vendor. Flattened below into the
      // PartnerRoleSummary shape the User type already defines.
      partner_roles: {
        where: { is_active: true },
        select: { role: true, store: { select: { id: true, name: true, slug: true } } },
      },
      _count: { select: { orders: true, addresses: true, product_reviews: true } },
    },
  });
  if (!user) return error(res, 'User not found.', 404);

  const visibleOrders: Prisma.OrderWhereInput = { user_id: id, deleted_at: null };

  const [orderGroups, purchaseCount, byStatus, spend, firstOrder, subscriptions, reviews, cartItems] = await Promise.all([
    recentOrderGroupsForUser(id, RECENT_ORDERS),
    // Purchases, not rows: a split checkout is several Order rows and one
    // purchase, and the page lists purchases. Counting rows here would put
    // "7 orders" above a table showing five.
    prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
        FROM (
          SELECT DISTINCT COALESCE(o.parent_order_id, o.id)
            FROM "orders" o
           WHERE o.user_id = ${id}::uuid AND o.deleted_at IS NULL
        ) g`,
    // Counts per status in one pass, rather than a query each.
    prisma.order.groupBy({ by: ['status'], where: visibleOrders, _count: { _all: true } }),
    // Cancelled orders are excluded from lifetime value: they were never paid,
    // and counting them makes a customer who cancels a lot look valuable.
    prisma.order.aggregate({
      where: { ...visibleOrders, status: { not: 'cancelled' } },
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.order.findFirst({
      where: visibleOrders,
      orderBy: { created_at: 'asc' },
      select: { created_at: true },
    }),
    prisma.rashanSubscription.findMany({
      where: { user_id: id },
      select: {
        id: true, status: true, frequency: true, next_delivery_date: true,
        pack_slug: true, created_at: true, cancelled_at: true,
        store: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    }),
    prisma.productReview.findMany({
      where: { user_id: id },
      select: {
        id: true, rating: true, title: true, created_at: true, is_hidden: true,
        product: { select: { id: true, name_es: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 5,
    }),
    // What is sitting in their basket right now. The single most useful thing
    // to know when a customer rings up mid-shop, and invisible until now.
    prisma.cartItem.findMany({
      where: { user_id: id },
      select: { quantity: true, variant: { select: { price: true } } },
    }),
  ]);

  const counts = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));
  const paidOrders = spend._count._all;
  const lifetimeSpend = spend._sum.total ?? new Prisma.Decimal(0);

  return success(res, {
    ...user,
    // Flattened to PartnerRoleSummary, the shape User already declares and the
    // storefront already reads. Prisma nests the store; everything consuming
    // this expects it alongside.
    partner_roles: user.partner_roles
      .filter((r) => !!r.store)
      .map((r) => ({
        store_id: r.store!.id,
        store_slug: r.store!.slug,
        store_name: r.store!.name,
        role: r.role,
      })),
    orders: orderGroups,
    subscriptions,
    reviews,
    stats: {
      orders: {
        /** Order ROWS, split parts counted separately. */
        total: user._count.orders,
        /** Distinct purchases — what the page's order list shows. */
        purchases: purchaseCount[0]?.count ?? 0,
        byStatus: counts,
        /** Orders that were not cancelled — the denominator for spend. */
        paid: paidOrders,
      },
      lifetimeSpend,
      /** Null rather than 0 for a customer who has never ordered: an average
       *  of nothing is not zero, and rendering "€0.00" implies it is. */
      averageOrderValue: paidOrders > 0 ? lifetimeSpend.dividedBy(paidOrders) : null,
      firstOrderAt: firstOrder?.created_at ?? null,
      lastOrderAt: orderGroups[0]?.created_at ?? null,
      cart: {
        items: cartItems.reduce((n, i) => n + i.quantity, 0),
        value: cartItems.reduce(
          (sum, i) => sum.plus(i.variant.price.times(i.quantity)),
          new Prisma.Decimal(0),
        ),
      },
    },
  });
}));

/**
 * Block or unblock a customer.
 *
 * Blocking takes a reason, and the reason is written FOR THE CUSTOMER: it is
 * shown on the login screen and in the dialog that ends their session. An
 * internal shorthand ("dupe acct, see ticket 44") is worse than nothing there,
 * so the admin form says as much and this enforces a usable length.
 */
const statusSchema = z.object({
  status: z.enum(['active', 'blocked']),
  reason: z.string().trim().max(500).optional(),
});

router.put('/:id/status', validate(statusSchema), asyncHandler(async (req, res) => {
  const { status, reason } = req.body as z.infer<typeof statusSchema>;

  if (status === 'blocked' && (!reason || reason.length < 5)) {
    return error(res, 'Give a reason for blocking — the customer is shown it.', 422);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: req.params.id },
      data: status === 'blocked'
        ? { status, blocked_reason: reason!, blocked_at: new Date() }
        // Cleared on unblock rather than kept as history: a stale reason
        // shown to someone who has been let back in is worse than none.
        : { status, blocked_reason: null, blocked_at: null },
    });

    // End every session they have. requireAuth stops the current access
    // token within seconds, but a live refresh token would mint a new one
    // the moment that expired.
    if (status === 'blocked') {
      await tx.userRefreshToken.deleteMany({ where: { user_id: req.params.id } });
    }

    return user;
  });

  return success(res, updated);
}));

// ─── DELETE /api/admin/users/:id ─────────────────────────
//
// Honours an account-deletion request that arrives by email — the route the
// public /delete-account page offers to anyone without the app. Same rules as
// the customer's own delete, via lib/eraseUser. super_admin only, like the
// other irreversible destroys (store permanent-delete).
router.delete('/:id', requireRole('super_admin'), asyncHandler(async (req, res) => {
  try {
    const outcome = await eraseUser(req.params.id, 'admin');
    return success(res, { message: 'Customer deleted.', ...outcome });
  } catch (err) {
    if (err instanceof UserErasureError) return error(res, err.message, err.status);
    throw err;
  }
}));


// ─── Rep-led client onboarding ───────────────────────────
//
// A sales rep visits a business, signs them up on the spot, and the client
// gets working credentials by email. Modelled closely on
// POST /api/admin/leads/:id/approve-business, which is the only other place
// an admin causes a User row to exist. Same posture throughout:
//
//   - reserve the temp password BEFORE the transaction, so the identical
//     value reaches both the hash and the email;
//   - every row write in one transaction;
//   - send the email OUTSIDE it, because a mail provider hiccup must not
//     roll back an account that is otherwise fine;
//   - log the credential to the console in non-production only.

/**
 * The create-client flow lives in lib/createClient, shared with the sales-rep
 * route — same situation, same hard parts, and a second copy would drift from
 * the first bug fixed in only one. Staff keep the `vendor` block: a rep cannot
 * open a shop, and the field is absent from their schema rather than guarded
 * inside the shared function.
 */
const createClientSchema = z.object({
  ...clientCoreShape,
  vendor: clientVendorSchema.optional(),
}).refine(requireCompanyForBusiness.check, {
  message: requireCompanyForBusiness.message,
  path: [...requireCompanyForBusiness.path],
});

router.post('/', validate(createClientSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof createClientSchema>;

  let created;
  try {
    created = await createClient(body, { adminId: req.admin?.adminId ?? null });
  } catch (err) {
    if (err instanceof ClientConflictError) return error(res, err.message, 409);
    throw err;
  }

  const user = await prisma.user.findUnique({
    where: { id: created.userId },
    include: { business_profile: true, addresses: true },
  });

  return success(res, {
    user,
    email_sent: created.emailSent,
    store: created.store,
    // An existing account, and whether it kept the login it had (then no
    // credentials went out, by design — lib/createClient).
    was_existing: created.wasExisting,
    kept_password: created.keptPassword,
    message: created.keptPassword
      ? 'Existing customer upgraded to a rep-managed client. They keep their own password; no credentials were sent.'
      : created.wasExisting
        ? 'Existing customer upgraded to a rep-managed client, with new credentials.'
        : 'Client created.',
  }, 201);
}));

// ─── POST /api/admin/users/:id/addresses ─────────────────
router.post('/:id/addresses', validate(addressSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof addressSchema>;

  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!user) return error(res, 'Customer not found.', 404);

  const count = await prisma.address.count({ where: { user_id: user.id } });
  const address = await prisma.address.create({
    data: {
      user_id: user.id,
      ...body,
      street_line_2: body.street_line_2 ?? null,
      delivery_notes: body.delivery_notes ?? null,
      is_default: count === 0,
    },
  });

  return success(res, address, 201);
}));

// ─── POST /api/admin/users/:id/resend-credentials ────────
//
// Reps need this on day one: a typo'd address, a client who deleted the mail,
// a shop with an aggressive spam filter. Without it the only recovery is the
// customer's own forgot-password flow, which is a poor thing to explain while
// standing in front of them.
//
// `send_email: false` issues the password and does NOT mail it, for an admin
// who is going to read it out over the phone or paste it into a message. The
// password comes back either way — see the note on the response below. Same
// shape as the sales-rep route, deliberately: it is the same act on the same
// column, and two dialogs that behave differently would be a worse answer
// than one that behaves the same everywhere.
const clientResendSchema = z.object({
  send_email: z.boolean().default(true),
}).strict();

router.post('/:id/resend-credentials', validate(clientResendSchema), asyncHandler(async (req, res) => {
  const { send_email: sendEmail } = req.body as z.infer<typeof clientResendSchema>;
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { business_profile: { select: { company: true } } },
  });
  if (!user) return error(res, 'Customer not found.', 404);
  // Still required when nothing is being mailed: the email IS the username,
  // so an account without one has no credentials to hand over.
  if (!user.email) return error(res, 'This customer has no email address on file.', 422);
  if (user.status === 'blocked') return error(res, 'This account is blocked. Unblock it first.', 422);

  // Rotate, sign them out everywhere, and mail it or not — lib/clientCredentials,
  // shared with the rep route so the two cannot drift.
  const { tempPassword, emailSent, reason } = await issueClientCredentials({ ...user, email: user.email }, sendEmail);

  /**
   * THE PASSWORD COMES BACK, deliberately — the same choice the sales-rep and
   * staff routes make, for the same reason: the rotation already happened, so
   * withholding the one string that makes it useful just strands the account.
   * This route exists precisely because the email is the unreliable part.
   *
   * What makes it acceptable is what the password is: single-use by
   * construction. `password_is_temp` is set above, so the first thing it does
   * is force a change.
   */
  return success(res, {
    // Always true on a 200 — the rotation is what committed. Named rather
    // than implied so the shape matches the sales-rep route exactly and one
    // dialog can render either.
    rotated: true,
    login_email: user.email,
    temp_password: tempPassword,
    email_sent: emailSent,
    reason,
    message: emailSent ? 'New credentials sent.' : 'New credentials issued.',
  });
}));

// ─── PUT /api/admin/users/:id ────────────────────────────
//
// Deliberately narrow. Status goes through /:id/status, which has its own
// reason and session-revocation rules, and everything else about a customer
// is theirs to change.
const updateUserSchema = z.object({
  sales_manager_name: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  phone_country_code: z.string().trim().max(6).optional(),
  preferred_language: z.enum(['es', 'en']).optional(),
  is_business: z.boolean().optional(),
  pricing_mode: z.enum(['retail', 'b2b']).optional(),
  /**
   * The buyer's CIF/NIF and the name it belongs to.
   *
   * These were unwritable anywhere in the API, which made one of the three
   * factura blockers permanently unclearable: `buyer_tax_id_missing` reads
   * `User.tax_id` (lib/invoicing.ts) and nothing ever set it, so no order
   * could ever become a factura however much else was in place.
   * BusinessProfile.registration_no is NOT the same thing — a company
   * registry number is not the tax identity a factura has to carry — so the
   * blocker is left reading the right column and the column is given a way
   * to be filled.
   *
   * Blank is meaningful: a customer who turns out not to have one is
   * recorded as not having one, so `null` is accepted and not coerced.
   */
  tax_id: z.string().trim().max(32).nullable().optional(),
  fiscal_name: z.string().trim().max(200).nullable().optional(),
  /**
   * Under RECARGO DE EQUIVALENCIA (2026-11-04). The office's decision alone —
   * this is the admin API; a rep's client routes do not accept it — and never
   * inferred from anything else on the account. It applies to orders placed
   * from now on; each order copies it when placed, so earlier ones keep what
   * they were charged.
   */
  recargo_equivalencia: z.boolean().optional(),
  /**
   * With `recargo_equivalencia`: carry the new regime onto the customer's
   * OPEN orders too (still changeable, no factura issued) — the order placed
   * just before the switch was turned on is the case this is for. Not a
   * column; read here and dropped before the update.
   */
  apply_to_open_orders: z.boolean().optional(),
});

router.put('/:id', validate(updateUserSchema), asyncHandler(async (req, res) => {
  const { apply_to_open_orders: applyToOpen, ...body } = req.body as z.infer<typeof updateUserSchema>;

  // Mirrors the customer-facing toggle's rule: b2b pricing is only meaningful
  // on a business account, and a stale `b2b` on a retail user is treated as
  // retail everywhere else anyway.
  if (body.pricing_mode === 'b2b' && body.is_business === false) {
    return error(res, 'B2B pricing requires a business account.', 422);
  }

  try {
    const updated = await prisma.user.update({ where: { id: req.params.id }, data: body });
    // Their open orders follow the switch, when the office asked for that.
    const appliedToOpenOrders = applyToOpen && body.recargo_equivalencia !== undefined
      ? await applyRecargoToOpenOrders(updated.id, body.recargo_equivalencia)
      : undefined;
    return success(res, appliedToOpenOrders ? { ...updated, applied_to_open_orders: appliedToOpenOrders } : updated);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return error(res, 'Customer not found.', 404);
      if (err.code === 'P2002') return error(res, 'That phone number is already in use.', 409);
    }
    throw err;
  }
}));

// ─── Agreed prices (2026-10-25) ─────────────────────────
// Euros off one unit of a product size, set on an order by staff or a rep and
// remembered for this customer — see lib/customerDiscounts. Listed on the
// customer page and read by the order builder to start a line with it.

router.get('/:id/product-discounts', asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!user) return error(res, 'Customer not found.', 404);
  return success(res, await listSavedDiscounts(user.id));
}));

/** Forget one. The next order starts that product at its normal price. */
router.delete('/:id/product-discounts/:variantId', asyncHandler(async (req, res) => {
  const removed = await forgetDiscount(req.params.id, req.params.variantId);
  if (!removed) return error(res, 'No saved discount for that product.', 404);
  return success(res, { removed: true });
}));

export default router;
