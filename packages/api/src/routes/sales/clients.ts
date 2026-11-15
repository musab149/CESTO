import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { parsePage, paged } from '../../lib/pagination';
import {
  createClient, ClientConflictError,
  clientCoreShape, requireCompanyForBusiness, clientAddressSchema, storefrontLoginUrl, repStandingOf,
} from '../../lib/createClient';
import { ACCESS_SELECT, accessOf, issueClientCredentials } from '../../lib/clientCredentials';
import { ensurePlan, nextDue, isDue, OPEN_STATUSES } from '../../lib/homeGroceryPlan';
import { listSavedDiscounts } from '../../lib/customerDiscounts';
import { findClientByEmail, linkFound, othersOf, ownedBy, ownerOf, reachOf } from '../../lib/repClients';
import { repFindClientLimiter } from '../../middleware/rateLimit';

/**
 * A rep's clients — their own, and the others they reach (lib/repClients).
 *
 * `requireSalesRep()` is applied at the mount, so reaching any handler here is
 * already proof of an active rep on a live account.
 *
 * WHAT A REP CAN SEE IS THE POINT OF THIS FILE. A rep works from a tablet in a
 * van, and an endpoint that searched every User would put the whole customer
 * base — names, emails, phone numbers — one request away from a device that
 * lives in a vehicle. So the scope is their book of business, which is also
 * exactly what a field rep needs:
 *
 *   · accounts they opened, and
 *   · accounts they have already built an order for.
 *
 * The second arm is what lets a rep keep serving a client who was opened by
 * staff or by a colleague and then handed over: the first order is placed by
 * whoever has the client in their book, and from then on it is in both.
 *
 * Since 2026-10-28 there is a third way in: a rep who knows a client's whole
 * email can find them (POST /find) and order for them — a colleague's round,
 * the office's account, a shop customer — without the client becoming
 * theirs. "Theirs" is now only the accounts they opened; the rest of their
 * reach is the list's "Otros clientes". A client in none of the three is
 * invisible to them, including by direct id.
 */

const router = Router();

const listSelect = (repId: string) => ({
  id: true,
  name: true,
  email: true,
  phone: true,
  is_business: true,
  status: true,
  created_at: true,
  created_by_sales_rep_id: true,
  created_by_admin_id: true,
  business_profile: { select: { company: true } },
  _count: { select: { orders: true } },
  found_by_sales_reps: { where: { sales_rep_id: repId }, select: { found_at: true, last_found_at: true } },
}) satisfies Prisma.UserSelect;

/** Their placed orders for each of these clients: how many, and the first and latest. */
async function servedBy(repId: string, userIds: string[]) {
  if (!userIds.length) return new Map<string, { count: number; first: Date | null; last: Date | null }>();
  const rows = await prisma.order.groupBy({
    by: ['user_id'],
    where: { user_id: { in: userIds }, created_by_sales_rep_id: repId, deleted_at: null, status: { not: 'draft' } },
    _count: { _all: true },
    _min: { created_at: true },
    _max: { created_at: true },
  });
  return new Map(rows.map((r) => [r.user_id, { count: r._count._all, first: r._min.created_at, last: r._max.created_at }]));
}

export type ClientRelation = 'own' | 'other';

// ─── GET /api/sales/clients ─────────────────────────────
//
// `relation`: their own clients (the default, which is what a screen from
// before 2026-10-28 asks for), the OTHERS they reach — found by email or
// ordered for — or both, for the order screen's picker. `counts` carries the
// size of each, unsearched, for the list's two tabs.
router.get('/', asyncHandler(async (req, res) => {
  const repId = req.salesRep!.user.id;
  const params = parsePage(req.query, 20, 100);
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const relation = req.query.relation === 'other' || req.query.relation === 'all' ? req.query.relation : 'own';
  const scope = relation === 'own' ? ownedBy(repId) : relation === 'other' ? othersOf(repId) : reachOf(repId);

  // Pushed onto AND rather than assigned to `where.OR`: the scope is an OR and
  // so is the search, and two bare `OR` assignments silently erase each other
  // — the bug this codebase has now hit three times.
  const and: Prisma.UserWhereInput[] = [scope];
  if (q) {
    and.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { business_profile: { company: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }

  const where: Prisma.UserWhereInput = { AND: and };
  const select = listSelect(repId);

  let rows: Prisma.UserGetPayload<{ select: ReturnType<typeof listSelect> }>[];
  let total: number;
  if (relation === 'other') {
    // The ones they served or found most recently first — the order a rep
    // goes back to them in. A rep reaches a few dozen at most, so they are
    // sorted here rather than in SQL.
    const all = await prisma.user.findMany({
      where, take: 2000,
      select: { id: true, found_by_sales_reps: { where: { sales_rep_id: repId }, select: { last_found_at: true } } },
    });
    const served = await servedBy(repId, all.map((u) => u.id));
    const latest = (u: (typeof all)[number]) => Math.max(
      u.found_by_sales_reps[0]?.last_found_at.getTime() ?? 0,
      served.get(u.id)?.last?.getTime() ?? 0,
    );
    const page = all.sort((a, b) => latest(b) - latest(a)).slice(params.skip, params.skip + params.limit).map((u) => u.id);
    const found = await prisma.user.findMany({ where: { id: { in: page } }, select });
    rows = page.map((id) => found.find((u) => u.id === id)!).filter(Boolean);
    total = all.length;
  } else {
    [rows, total] = await Promise.all([
      prisma.user.findMany({ where, select, orderBy: { created_at: 'desc' }, skip: params.skip, take: params.limit }),
      prisma.user.count({ where }),
    ]);
  }

  const [served, own, other] = await Promise.all([
    servedBy(repId, rows.map((u) => u.id)),
    prisma.user.count({ where: ownedBy(repId) }),
    prisma.user.count({ where: othersOf(repId) }),
  ]);

  return success(res, {
    ...paged(rows.map((u) => {
      const mine = u.created_by_sales_rep_id === repId;
      const link = u.found_by_sales_reps[0];
      const s = served.get(u.id);
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        is_business: u.is_business,
        status: u.status,
        created_at: u.created_at,
        company: u.business_profile?.company ?? null,
        order_count: u._count.orders,
        relation: (mine ? 'own' : 'other') as ClientRelation,
        /** Whose they are, in a word, when not theirs. Never who. */
        owner: mine ? null : ownerOf(u),
        /** Their own placed orders for them. */
        my_order_count: s?.count ?? 0,
        /** Since when they serve this client: found by email, or first ordered for. */
        served_since: mine ? null : [link?.found_at, s?.first].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
        found_by_email: !!link,
      };
    }), total, params),
    counts: { own, other },
  });
}));

// ─── GET /api/sales/clients/lookup ──────────────────────
//
// Answers "is this email or phone already taken?" while the rep is still
// typing, instead of at submit — the same question
// GET /api/admin/users/lookup answers, and the rep form is a port of the admin
// one, so it asks at the same moments.
//
// WHAT IT WILL NOT SAY IS WHO. The admin version returns the id, the name and
// the account type, because an admin may see the whole customer base and wants
// a link to the person. A rep may not: this file exists to keep a tablet in a
// van from enumerating every name, email and phone we hold, and an endpoint
// that confirmed "yes, and that is María López" would be exactly that
// enumeration with extra steps. Booleans only.
//
// Both are returned separately because they mean different things, which is
// also why the admin version splits them:
//
//   email — usually NOT an error. POST /api/sales/clients resolves to the
//           existing account rather than refusing, so the honest thing to say
//           is "this person already exists, continuing adds them to your
//           clients" — unless it is the office's or another rep's client,
//           which the create refuses (`belongs_elsewhere`, since 2026-10-26).
//   phone — a hard stop. User.phone is UNIQUE and the create cannot reassign
//           somebody else's number, so a rep who only finds out at the end has
//           filled in three steps for nothing.
//
// Declared above GET /:id deliberately: Express matches in order, and ':id'
// would otherwise swallow "lookup".
const lookupSchema = z.object({
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(20).optional(),
});

router.get('/lookup', asyncHandler(async (req, res) => {
  const parsed = lookupSchema.safeParse(req.query);
  if (!parsed.success) return error(res, 'Invalid lookup.', 422);
  const { email, phone } = parsed.data;
  const repId = req.salesRep!.user.id;

  const [byEmail, byPhone] = await Promise.all([
    email
      ? prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        select: { id: true, created_by_sales_rep_id: true, created_by_admin_id: true },
      })
      : Promise.resolve(null),
    phone
      ? prisma.user.findUnique({
        where: { phone },
        select: { id: true },
      })
      : Promise.resolve(null),
  ]);

  /**
   * One id does leave: whether the account is already one THEY reach.
   *
   * Not a leak — they can already list it — and it is the difference between
   * "you are about to add a new client" and "this is someone you already
   * serve", which is worth saying before they fill in two more steps. Their
   * own client, or one of their others (found by email or ordered for),
   * which the form points to instead of opening it again.
   */
  const [mine, reachable] = byEmail
    ? await Promise.all([
      prisma.user.findFirst({ where: { AND: [{ id: byEmail.id }, ownedBy(repId)] }, select: { id: true, name: true } }),
      prisma.user.findFirst({ where: { AND: [{ id: byEmail.id }, reachOf(repId)] }, select: { id: true, name: true } }),
    ])
    : [null, null];

  return success(res, {
    email_taken: byEmail !== null,
    /** Somebody else's number. Their own client's is not a clash. */
    phone_taken: byPhone !== null && byPhone.id !== byEmail?.id,
    /** Set only when the match is already one of their own clients. */
    existing_client: mine,
    /** One of their others: somebody's client they found or ordered for. */
    reachable_client: mine ? null : reachable,
    /**
     * The email is the office's or another rep's client, so continuing will
     * be refused (lib/createClient repStandingOf). Said now rather than at the
     * end of three steps. A boolean like the rest: it says the account is
     * somebody's, never whose.
     */
    belongs_elsewhere: byEmail !== null && !mine && (await repStandingOf(prisma, byEmail, repId)) === 'elsewhere',
  });
}));

// ─── POST /api/sales/clients/find ───────────────────────
//
// Any client of Cesto, by their WHOLE email (2026-10-28, user: "the rep
// should be able to search any client or user by using their email address...
// Only if they search via email then they should be able to lookup for that
// client and perform stuff for them"). Found, they are in the rep's reach —
// the profile, their prices, an order — and listed among their others, but
// stay whoever's they were (lib/repClients).
//
// Exact or nothing: the whole address, in any case, never a part of one, and
// per rep at most a few dozen tries a quarter of an hour. A POST so an email
// never sits in a URL or an access log.
//
// Who cannot be ordered for is said, not hidden: their own account, another
// rep's, and a blocked one (createOrder refuses it) — found, but no way in.
const findSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200) }).strict();

router.post('/find', repFindClientLimiter, validate(findSchema), asyncHandler(async (req, res) => {
  const repId = req.salesRep!.user.id;
  const { email } = req.body as z.infer<typeof findSchema>;
  const u = await findClientByEmail(email);
  if (!u) return success(res, { found: false });
  if (u.id === repId) return success(res, { found: true, unavailable: 'self' });
  if (u.sales_rep_profile?.is_active) return success(res, { found: true, unavailable: 'sales_rep' });

  const mine = u.created_by_sales_rep_id === repId;
  const blocked = u.status === 'blocked';
  // A blocked account is found but not reached: nothing could be done there.
  if (!mine && !blocked) await linkFound(repId, u.id);
  const myOrders = await prisma.order.count({
    where: { user_id: u.id, created_by_sales_rep_id: repId, deleted_at: null, status: { not: 'draft' } },
  });

  return success(res, {
    found: true,
    unavailable: blocked ? 'blocked' : null,
    client: {
      id: u.id,
      name: u.name,
      company: u.business_profile?.company ?? null,
      email: u.email,
      phone: u.phone,
      is_business: u.is_business,
      pricing_mode: u.pricing_mode,
      status: u.status,
      relation: (mine ? 'own' : 'other') as ClientRelation,
      owner: mine ? null : ownerOf(u),
      address_count: u._count.addresses,
      my_order_count: myOrders,
    },
  });
}));

// ─── GET /api/sales/clients/:id ─────────────────────────
//
// What the order screen needs before it can price anything: the addresses to
// deliver to, and whether this account buys at retail or wholesale. Pricing is
// resolved server-side on create regardless (lib/createOrder prices from the
// customer, never from the request) — this is so the rep sees the same figures
// the order will be written with, rather than retail prices for a wholesale
// client and a total that changes when they press Create.
router.get('/:id', asyncHandler(async (req, res) => {
  const repId = req.salesRep!.user.id;

  const found = await prisma.user.findFirst({
    where: { AND: [{ id: req.params.id }, reachOf(repId)] },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      is_business: true,
      pricing_mode: true,
      status: true,
      preferred_language: true,
      /** The CIF a factura has to carry. One of the three conditions that
       *  decide factura vs albarán, so the order screen states it. */
      tax_id: true,
      /** Under recargo de equivalencia (2026-11-04): the rep's builder adds
       *  it to the total it previews. Read-only here — the office sets it. */
      recargo_equivalencia: true,
      business_profile: {
        select: { company: true, contact_phone: true, registration_no: true },
      },
      addresses: {
        orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
      },
      // The profile's (2026-10-26): the number's country (its WhatsApp link),
      // since when, who opened it, and how they get into the shop — the last
      // read from the hash, never sent.
      phone_country_code: true,
      created_at: true,
      created_by_sales_rep_id: true,
      created_by_admin_id: true,
      found_by_sales_reps: { where: { sales_rep_id: repId }, select: { found_at: true } },
      ...ACCESS_SELECT,
    },
  });

  // 404, not 403. A rep has no way to tell whether an id they cannot see
  // exists, and confirming that it does is itself the leak this scope exists
  // to prevent.
  if (!found) return error(res, 'Client not found.', 404);
  const {
    password_hash: _hash, password_is_temp: _temp, google_id: _google, apple_id: _apple,
    created_by_sales_rep_id: openedBy, created_by_admin_id: _office, found_by_sales_reps: links, ...client
  } = found;
  const mine = openedBy === repId;

  /**
   * THEIR orders for this client, which is all the profile lists: an order
   * somebody else built, or the client placed in the shop, is not one a rep
   * can open (routes/sales/orders.ts), so counting it would point at rows
   * they cannot reach. Drafts are not orders yet; a cancelled one counts as
   * an order but not as money.
   */
  const theirs: Prisma.OrderWhereInput = {
    user_id: client.id, created_by_sales_rep_id: repId, deleted_at: null, status: { not: 'draft' },
  };
  const [orders, spent, last] = await Promise.all([
    prisma.order.count({ where: theirs }),
    prisma.order.aggregate({ where: { ...theirs, status: { notIn: ['draft', 'cancelled'] } }, _sum: { total: true } }),
    prisma.order.findFirst({ where: theirs, orderBy: { created_at: 'desc' }, select: { created_at: true } }),
  ]);

  // A Home Grocery household: what the slot of an order built for them is
  // suggested from, and whether one is due. Null for everyone else.
  const plan = await ensurePlan(client.id);
  let home_grocery = null;
  if (plan) {
    const [due, open] = await Promise.all([
      nextDue(plan),
      prisma.order.count({ where: { rashan_subscription_id: plan.id, deleted_at: null, status: { in: OPEN_STATUSES } } }),
    ]);
    home_grocery = {
      status: plan.status,
      frequency: plan.frequency,
      preferred_weekday: plan.preferred_weekday,
      preferred_window: plan.preferred_window,
      address_id: plan.address_id,
      next_due: due,
      due: plan.status === 'active' && isDue(due, open > 0),
    };
  }

  return success(res, {
    ...client,
    home_grocery,
    opened_by_me: mine,
    relation: (mine ? 'own' : 'other') as ClientRelation,
    /** Whose they are, in a word, when not theirs. Never who. */
    owner: mine ? null : ownerOf(found),
    found_at: links[0]?.found_at ?? null,
    // How they get into the shop is their own client's business only: a rep
    // can give a login to nobody else (POST /:id/credentials).
    access: mine ? accessOf(found) : undefined,
    stats: { orders, spent: spent._sum.total ?? 0, last_order_at: last?.created_at ?? null },
  });
}));

// ─── POST /api/sales/clients/:id/credentials ────────────
//
// The rep gives a client their shop login (user, 2026-10-26: "They can create
// credentials and copy with one click … and send them to client"): a new
// temporary password, shown once to be copied or sent on WhatsApp, and mailed
// too if they ask. The same act as staff's resend-credentials, through the
// same lib/clientCredentials.
//
// ONLY WHILE THE CLIENT HAS NOT CHOSEN THEIR OWN. Issuing replaces whatever
// they log in with, signs them out and leaves the rep holding a password to
// their account. For a client who set their own — or signs in with Google or
// Apple — that is a lock-out and a takeover, not help: they recover it with
// "forgot password" in the shop, or the office resets it. 409 with a code, so
// the screen says that instead of a generic failure.
const issueCredentialsSchema = z.object({
  send_email: z.boolean().default(false),
}).strict();

export const CLIENT_HAS_OWN_LOGIN = 'client_has_own_login';
/** A client they reach but did not open: ordering yes, a shop login no. */
export const NOT_YOUR_CLIENT = 'not_your_client';

router.post('/:id/credentials', validate(issueCredentialsSchema), asyncHandler(async (req, res) => {
  const repId = req.salesRep!.user.id;
  const { send_email: sendEmail } = req.body as z.infer<typeof issueCredentialsSchema>;
  const user = await prisma.user.findFirst({
    where: { AND: [{ id: req.params.id }, reachOf(repId)] },
    select: {
      id: true, name: true, email: true, status: true, sales_manager_name: true, preferred_language: true,
      created_by_sales_rep_id: true,
      business_profile: { select: { company: true } },
      ...ACCESS_SELECT,
    },
  });
  if (!user) return error(res, 'Client not found.', 404);
  // Somebody else's client, found by email or ordered for: their login is for
  // whoever's client they are, or the office (2026-10-28).
  if (user.created_by_sales_rep_id !== repId) {
    return error(res, 'Only the rep whose client this is, or the office, can give them a shop login.', 403, { code: NOT_YOUR_CLIENT });
  }
  // The email IS the username, so an account without one has nothing to hand over.
  if (!user.email) return error(res, 'This client has no email address, which is what they log in with.', 422);
  if (user.status === 'blocked') return error(res, 'This account is blocked.', 422);
  if (accessOf(user) === 'own') {
    return error(res, 'This client already logs in with their own password. They can reset it in the shop, or the office can.', 409, { code: CLIENT_HAS_OWN_LOGIN });
  }

  const { created_by_sales_rep_id: _openedBy, ...account } = user;
  const issued = await issueClientCredentials({ ...account, email: user.email }, sendEmail);

  // The password comes back once, as staff's route returns it: the rotation
  // already happened, and the screen is how it reaches the client.
  return success(res, {
    rotated: true,
    login_email: user.email,
    temp_password: issued.tempPassword,
    login_url: storefrontLoginUrl(),
    email_sent: issued.emailSent,
    reason: issued.reason,
  });
}));

// ─── POST /api/sales/clients ────────────────────────────
//
// The same flow staff use, through lib/createClient. Two differences, both in
// the SCHEMA rather than in a check inside the shared function, because
// validation is where a permission like this belongs — unreachable input
// cannot be smuggled in:
//
//   · no `vendor` block. Opening a shop is staff work.
//   · no `sales_manager_name`. It is set below to the rep's own name: the
//     person who opened the account is who the client should be told to ask
//     for, and letting a rep type someone else's name in that field would
//     make the one human-readable record of ownership unreliable.
const createClientSchema = z.object({
  ...clientCoreShape,
  // Declared as `undefined` rather than left out. Zod strips an unknown key
  // silently, so omitting these would make a rep app that sends them appear to
  // work while quietly doing something else. A field that encodes a permission
  // should refuse loudly: if the request carries one, the caller is wrong and
  // should hear so.
  sales_manager_name: z.undefined(),
  vendor: z.undefined(),
  address: clientAddressSchema,
}).refine(requireCompanyForBusiness.check, {
  message: requireCompanyForBusiness.message,
  path: [...requireCompanyForBusiness.path],
});

router.post('/', validate(createClientSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof createClientSchema>;
  const me = req.salesRep!;

  let created;
  try {
    created = await createClient(
      { ...body, sales_manager_name: me.user.name },
      { salesRepId: me.user.id },
    );
  } catch (err) {
    if (err instanceof ClientConflictError) return error(res, err.message, 409, err.code ? { code: err.code } : null);
    throw err;
  }

  const client = await prisma.user.findUnique({
    where: { id: created.userId },
    select: {
      id: true, name: true, email: true, phone: true, is_business: true,
      pricing_mode: true, status: true,
      business_profile: { select: { company: true } },
      addresses: { orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }] },
    },
  });

  return success(res, {
    client,
    email_sent: created.emailSent,
    // An existing customer is upgraded rather than duplicated, and the rep
    // needs to know that is what happened: "created" would be a lie, and they
    // would go looking for a second account that does not exist.
    was_existing: created.wasExisting,
    // ...and whether it kept its own login, in which case no credentials went
    // out — the screen must not say they did, nor that the email failed.
    kept_password: created.keptPassword,
  }, 201);
}));

// ─── POST /api/sales/clients/:id/addresses ──────────────
//
// A second delivery address for a client they reach — their own, or one they
// order for. Needed because
// a shop that takes deliveries at a warehouse is ordinary, and the alternative
// is a rep typing the wrong address into the one slot they have.
router.post('/:id/addresses', validate(clientAddressSchema), asyncHandler(async (req, res) => {
  const repId = req.salesRep!.user.id;
  const body = req.body as z.infer<typeof clientAddressSchema>;

  const client = await prisma.user.findFirst({
    where: { AND: [{ id: req.params.id }, reachOf(repId)] },
    select: { id: true, _count: { select: { addresses: true } } },
  });
  if (!client) return error(res, 'Client not found.', 404);

  const address = await prisma.address.create({
    data: {
      user_id: client.id,
      ...body,
      street_line_2: body.street_line_2 ?? null,
      delivery_notes: body.delivery_notes ?? null,
      // Same rule as createClient: only the first one becomes the default, so
      // adding a warehouse does not silently re-point the shop's deliveries.
      is_default: client._count.addresses === 0,
    },
  });

  return success(res, address, 201);
}));

// ─── GET /api/sales/clients/:id/product-discounts ───────
// The prices agreed with this client (lib/customerDiscounts), so the order
// screen starts a line with its discount. Their reach only, like every read here.
router.get('/:id/product-discounts', asyncHandler(async (req, res) => {
  const repId = req.salesRep!.user.id;
  const client = await prisma.user.findFirst({
    where: { AND: [{ id: req.params.id }, reachOf(repId)] },
    select: { id: true },
  });
  if (!client) return error(res, 'Client not found.', 404);
  return success(res, await listSavedDiscounts(client.id));
}));

export default router;
