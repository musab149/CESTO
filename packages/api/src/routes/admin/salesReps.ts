import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { parsePage, paged } from '../../lib/pagination';
import { requireRole } from '../../middleware/adminAuth';
import bcrypt from 'bcryptjs';
import { generateTempPassword } from '../../lib/credentials';
import { sendSalesRepWelcomeEmail, resolveEmailLang, mailerDelivers } from '../../lib/mailer';
import earningsRouter from './salesRepEarnings';
import {
  HOUSE_STORE_ID, REP_STORE_SELECT, RepStoreAssignmentError, SELLABLE_STORE, assignedScope, assignmentFor, legacyStoreView,
  repStoreFrom, repStoresView, shopsCreate, shopsWrite, unavailableReason,
} from '../../lib/repStore';
import { productFilterSchema, buildProductWhere } from '../../lib/product-filters';

/** Where a rep logs in — their own screen, not the storefront. Landing a
 *  new rep on the shop front is a support call. */
function salesLoginUrl(): string {
  const base = (process.env.WEB_URL || 'http://localhost:5199').replace(/\/+$/, '');
  return base + '/sales';
}

/**
 * Sales reps, from the admin's side: who is one, and granting or revoking it.
 *
 * A rep is a User carrying a SalesRep row — not an Admin, and not a separate
 * login. See middleware/salesRepAuth.ts for why.
 *
 * The consequence is that the role and the account are separable, and POST
 * below serves both cases: it makes the account when there is none, and takes
 * the one that is already there when there is. An admin typing a name and an
 * email cannot know which, and should not have to.
 *
 * REVOKING IS `is_active = false`, NEVER A DELETE. Every order they built and
 * every account they opened points at them, and that history has to stay
 * readable after they leave. A deleted rep would also take their own customer
 * account with them, which is not what "they no longer sell for us" means.
 */

const router = Router();

// Earnings: the balance, its history, payments and adjustments (lib/repEarnings).
router.use('/:userId/earnings', earningsRouter);

/** Everything a list row needs, including the figures the table shows. */
const REP_SELECT = {
  // The shops they sell from, and how many products by hand (lib/repStore).
  // First, as it carries user_id too.
  ...REP_STORE_SELECT,
  user_id: true,
  code: true,
  is_active: true,
  granted_at: true,
  notes: true,
  commission_pct: true,
  user: {
    select: {
      id: true, name: true, email: true, phone: true, status: true,
      created_at: true,
      _count: { select: { orders_created: true, clients_opened: true } },
    },
  },
  granted_by: { select: { id: true, name: true } },
} as const;

/** Flatten the nesting away — a table row should not have to walk a tree. */
function toRow(r: Prisma.SalesRepGetPayload<{ select: typeof REP_SELECT }>) {
  return {
    user_id: r.user_id,
    code: r.code,
    is_active: r.is_active,
    granted_at: r.granted_at,
    notes: r.notes,
    name: r.user.name,
    email: r.user.email,
    phone: r.user.phone,
    /** The ACCOUNT's status. A blocked account cannot work whatever its role
     *  says, so the table has to show both. */
    account_status: r.user.status,
    member_since: r.user.created_at,
    orders_created: r.user._count.orders_created,
    clients_opened: r.user._count.clients_opened,
    granted_by: r.granted_by?.name ?? null,
    /** Their usual share of each order's profit, % (lib/repEarnings). */
    commission_pct: r.commission_pct?.toFixed(2) ?? null,
    /** The shops they sell from; empty = none, so they cannot build orders. */
    stores: repStoresView(repStoreFrom(r)),
    /** Before 2026-10-26 a rep had one shop; kept for a page loaded before then. */
    store: legacyStoreView(repStoreFrom(r)),
    /** Products assigned to them by hand, on top of the shops (2026-10-27). */
    assigned_products: r._count.products,
  };
}

// ─── GET /api/admin/sales-reps ──────────────────────────
router.get('/', asyncHandler(async (req, res) => {
  const params = parsePage(req.query, 20, 100);
  const { q, status } = req.query as Record<string, string | undefined>;

  const where: Prisma.SalesRepWhereInput = {};
  if (status === 'active') where.is_active = true;
  if (status === 'revoked') where.is_active = false;
  if (q) {
    where.OR = [
      { code: { contains: q, mode: 'insensitive' } },
      { user: { name: { contains: q, mode: 'insensitive' } } },
      { user: { email: { contains: q, mode: 'insensitive' } } },
      { user: { phone: { contains: q } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.salesRep.findMany({
      where,
      select: REP_SELECT,
      // Active first, then most recently granted — a revoked rep is history
      // and should not sit above someone currently working.
      orderBy: [{ is_active: 'desc' }, { granted_at: 'desc' }],
      skip: params.skip,
      take: params.limit,
    }),
    prisma.salesRep.count({ where }),
  ]);

  return success(res, paged(rows.map(toRow), total, params));
}));

// ─── POST /api/admin/sales-reps ─────────────────────────
//
// Two ways in, because there are two situations and only one of them used to
// be served.
//
//   CREATE: `name` + `email`. Makes the account, grants the role and emails
//   the credentials, in one press. This is how a rep is actually hired —
//   somebody is told "you start Monday" and needs a login. Making an admin
//   create a client account first, then come back here and search for it, was
//   two screens and a search for one decision.
//
//   ASSIGN: `user_id`. Gives the role to an account that already exists — a
//   customer who applied, a B2B buyer who now sells for us. Kept because the
//   account genuinely is not always this screen's to make, and creating a
//   second one for someone who already has one is the worse failure.
//
// An email that ALREADY has an account resolves to the assign path rather than
// failing or duplicating. That is the case the old split could not express: an
// admin typing a name and an email has no way to know whether that person is
// already in the database, and should not have to.
/** A shop's id, or 'cesto' for Cesto's own catalogue. */
const shopPick = z.union([z.literal(HOUSE_STORE_ID), z.string().uuid()]);

/** What the admin picked, from either field; undefined = leave as it is. */
function picksOf(body: { store_ids?: string[]; store_id?: string | null }): string[] | undefined {
  if (body.store_ids !== undefined) return body.store_ids;
  if (body.store_id !== undefined) return body.store_id ? [body.store_id] : [];
  return undefined;
}

/** The shops a rep has now, which may stay while unavailable (lib/repStore). */
const currentShops = async (userId: string) =>
  (await prisma.salesRepStore.findMany({ where: { sales_rep_id: userId }, select: { store_id: true } })).map((r) => r.store_id);

const grantSchema = z.object({
  /** Assign: the account to give the role to. */
  user_id: z.string().uuid().optional(),
  /** Create: who they are. */
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().transform((v) => v.toLowerCase()).optional(),
  phone: z.string().trim().max(20).optional(),
  preferred_language: z.enum(['es', 'en']).default('es'),
  code: z.string().trim().max(32).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  send_credentials: z.boolean().default(true),
  /**
   * The shops they sell from (lib/repStore), all of them: shop ids, and
   * 'cesto' for Cesto's own catalogue. Empty for none — a rep with none
   * builds nothing.
   */
  store_ids: z.array(shopPick).max(100).optional(),
  /** One shop, or null for none — what an admin page from before 2026-10-26 sends. */
  store_id: shopPick.nullable().optional(),
}).superRefine((v, ctx) => {
  // Spelled out rather than left to a zod union, whose failure message for
  // this shape is a wall of alternatives naming neither thing the admin
  // actually got wrong.
  if (v.user_id) return;
  if (!v.name) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['name'], message: 'Required' });
  }
  if (!v.email) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Required' });
  }
});

/**
 * HIRING AND REVOKING ARE SUPER-ADMIN ONLY.
 *
 * Granting the role mints a login, emails a temporary password, and hands
 * somebody the client book, the order book and the ability to issue numbered
 * albaranes. That is the same kind of act as creating an admin account, which
 * /api/admin/staff has always gated this way — it was an oversight that this
 * did not.
 *
 * Revoking is gated too, as the other half of the same power: it cuts a
 * working rep off mid-round. The two READS below are deliberately left to any
 * admin, because "which of our reps sold what" is ops work and locking it
 * would take the Sales reps tab away from the people who use it.
 */
router.post('/', requireRole('super_admin'), validate(grantSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof grantSchema>;
  const adminId = req.admin?.adminId ?? null;

  /**
   * Resolve to one account, however the admin got here.
   *
   * `tempPassword` being set is what says a password was ISSUED, and it drives
   * the only thing that differs afterwards. An account that already exists
   * keeps the password it has — resetting a live customer's password because
   * an admin made them a rep would lock them out of the account they were
   * already using.
   */
  let userId: string;
  let created = false;
  let tempPassword: string | null = null;

  if (body.user_id) {
    userId = body.user_id;
  } else {
    const existing = await prisma.user.findUnique({
      where: { email: body.email! },
      select: { id: true, password_hash: true },
    });

    if (existing) {
      userId = existing.id;
      // No password on the row at all — an account that exists but has never
      // been usable. Issuing one is the only way they can work, and there is
      // no session to disturb.
      if (!existing.password_hash) {
        tempPassword = generateTempPassword(12);
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            password_hash: await bcrypt.hash(tempPassword, 12),
            password_is_temp: true,
          },
        });
      }
    } else {
      tempPassword = generateTempPassword(12);
      try {
        const fresh = await prisma.user.create({
          data: {
            name: body.name!,
            email: body.email!,
            ...(body.phone ? { phone: body.phone } : {}),
            password_hash: await bcrypt.hash(tempPassword, 12),
            password_is_temp: true,
            preferred_language: body.preferred_language,
            created_by_admin_id: adminId,
          },
          select: { id: true },
        });
        userId = fresh.id;
        created = true;
      } catch (err) {
        // The email was looked up above, so in practice this is the phone.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const target = err.meta?.target;
          const hit = (Array.isArray(target) ? target.map(String) : [String(target ?? '')]).join(',');
          if (hit.includes('phone')) {
            return error(res, 'That phone number already belongs to another account.', 409);
          }
          return error(res, 'Those details are already in use by another account.', 409);
        }
        throw err;
      }
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, name: true, email: true, status: true, preferred_language: true,
      sales_rep_profile: { select: { is_active: true } },
    },
  });
  if (!user) return error(res, 'That account does not exist.', 404);
  if (user.status === 'blocked') {
    return error(res, 'That account is blocked. Unblock it before making them a rep.', 422);
  }
  if (user.sales_rep_profile?.is_active) {
    return error(res, 'That account is already a sales rep.', 409);
  }

  let shop: { house_store: boolean; store_ids: string[] } | undefined;
  const picks = picksOf(body);
  if (picks !== undefined) {
    try {
      shop = await assignmentFor(picks, await currentShops(userId));
    } catch (err) {
      if (err instanceof RepStoreAssignmentError) return error(res, err.message, 422);
      throw err;
    }
  }

  let rep;
  try {
    // Upsert, not create: re-granting someone who was revoked should bring
    // their row back with its history, not collide with it.
    rep = await prisma.salesRep.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        code: body.code ?? null,
        notes: body.notes ?? null,
        granted_by_admin_id: adminId,
        ...(shop ? shopsCreate(shop) : {}),
      },
      update: {
        is_active: true,
        granted_at: new Date(),
        granted_by_admin_id: adminId,
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        // Re-granted, they keep the shops they had unless others are picked.
        ...(shop ? shopsWrite(shop) : {}),
      },
      select: REP_SELECT,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return error(res, 'That staff number is already in use.', 409);
    }
    throw err;
  }

  /**
   * The mail goes out AFTER the row is committed, and a failure is reported
   * rather than thrown. The rep exists either way and an admin at a desk can
   * resend; throwing would say the rep was not created, which is false, and
   * they would create a second one.
   */
  let emailSent = false;
  if (tempPassword && body.send_credentials && user.email) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[salesrep-created] email=${user.email} tempPassword=${tempPassword}`);
    }
    try {
      await sendSalesRepWelcomeEmail({
        to: user.email,
        name: user.name,
        loginUrl: salesLoginUrl(),
        loginEmail: user.email,
        tempPassword,
        code: body.code ?? null,
        lang: resolveEmailLang(user.preferred_language),
      });
      // Only a real provider counts — see mailerDelivers. Saying "credentials
      // sent" for an email the console mailer merely logged is what sent an
      // admin looking for a message that never left the process.
      emailSent = mailerDelivers;
    } catch (mailErr) {
      console.error('[salesrep-created] welcome email failed; the rep exists, resend manually', mailErr);
    }
  }

  return success(res, {
    ...toRow(rep),
    /** False when the account was already there — they keep their own password. */
    account_created: created,
    /** False when no mail was due, as well as when one was due and failed. */
    credentials_sent: emailSent,
  }, 201);
}));

// ─── PUT /api/admin/sales-reps/:userId ──────────────────
const updateSchema = z.object({
  code: z.string().trim().max(32).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  /** false revokes, true reinstates. The row survives either way. */
  is_active: z.boolean().optional(),
  /** Their usual share of the profit, % (lib/repEarnings); null clears it. */
  commission_pct: z.number().min(0).max(100).nullable().optional(),
  /**
   * The shops they sell from (lib/repStore), all of them: shop ids, and
   * 'cesto' for Cesto's own catalogue. Empty for none — a rep with none
   * builds nothing.
   */
  store_ids: z.array(shopPick).max(100).optional(),
  /** One shop, or null for none — what an admin page from before 2026-10-26 sends. */
  store_id: shopPick.nullable().optional(),
});

router.put('/:userId', requireRole('super_admin'), validate(updateSchema), asyncHandler(async (req, res) => {
  const { store_id, store_ids, ...body } = req.body as z.infer<typeof updateSchema>;
  const picks = picksOf({ store_id, store_ids });
  try {
    // Changed shops apply from the rep's next request: what they see, and
    // what they may add. Orders already built keep their lines.
    const shop = picks !== undefined ? shopsWrite(await assignmentFor(picks, await currentShops(req.params.userId))) : {};
    const rep = await prisma.salesRep.update({
      where: { user_id: req.params.userId },
      data: { ...body, ...shop },
      select: REP_SELECT,
    });
    return success(res, toRow(rep));
  } catch (err) {
    if (err instanceof RepStoreAssignmentError) return error(res, err.message, 422);
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return error(res, 'That account is not a sales rep.', 404);
      if (err.code === 'P2002') return error(res, 'That staff number is already in use.', 409);
    }
    throw err;
  }
}));

// ─── GET /api/admin/sales-reps/:userId ──────────────────
//
// The profile: who they are, and what they have actually done. Every figure
// comes from a column that already existed before this feature — nothing here
// is tracked specially, which is why it works from the day the role is
// granted and covers work done before it was.
router.get('/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { from, to } = req.query as Record<string, string | undefined>;

  const rep = await prisma.salesRep.findUnique({
    where: { user_id: userId },
    select: REP_SELECT,
  });
  if (!rep) return error(res, 'That account is not a sales rep.', 404);

  // The window the figures cover. Absent means everything.
  const createdAt: Prisma.DateTimeFilter = {};
  if (from) createdAt.gte = new Date(from);
  if (to) createdAt.lte = new Date(`${to}T23:59:59.999Z`);
  const inWindow = (from || to) ? { created_at: createdAt } : {};

  // Deleted orders are excluded from every figure. They were taken back, and
  // counting them would credit a rep for work that was undone.
  const orderWhere: Prisma.OrderWhereInput = {
    created_by_sales_rep_id: userId,
    deleted_at: null,
    ...inWindow,
  };

  const [byStatus, clientsOpened, recentOrders] = await Promise.all([
    prisma.order.groupBy({
      by: ['status'],
      where: orderWhere,
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.user.count({ where: { created_by_sales_rep_id: userId, ...inWindow } }),
    prisma.order.findMany({
      where: orderWhere,
      select: {
        id: true, order_number: true, status: true, total: true, created_at: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 10,
    }),
  ]);

  // CANCELLED ORDERS COUNT AS WORK DONE BUT NOT AS REVENUE. A rep who builds
  // an order the customer later cancels did the work; the money did not
  // arrive. Reporting one number for both is how a sales figure stops meaning
  // anything.
  const orders = byStatus.reduce((n, g) => n + g._count._all, 0);
  const revenue = byStatus
    .filter((g) => g.status !== 'cancelled')
    .reduce((sum, g) => sum.plus(g._sum.total ?? 0), new Prisma.Decimal(0));
  const cancelled = byStatus.find((g) => g.status === 'cancelled')?._count._all ?? 0;

  return success(res, {
    ...toRow(rep),
    window: { from: from ?? null, to: to ?? null },
    stats: {
      orders,
      cancelled,
      revenue: revenue.toFixed(2),
      clients_opened: clientsOpened,
      by_status: byStatus.map((g) => ({
        status: g.status,
        count: g._count._all,
        total: (g._sum.total ?? new Prisma.Decimal(0)).toFixed(2),
      })),
    },
    recent_orders: recentOrders,
  });
}));

// ─── A rep's products, assigned by hand ─────────────────
//
// 2026-10-27, the user: "we should also be able to assign any products to the
// rep and these products can be from any store and they show up in catalogue
// of the rep and when they are creating the orders or edit". On top of their
// shops; the rule is lib/repStore's. Reading is for any admin, changing for a
// super admin — the same split as their shops.

/** What the profile's card and the picker show of a product. */
const ASSIGNABLE_SELECT = {
  id: true, name_es: true, name_en: true, brand: true, is_active: true, audience: true,
  store: { select: { id: true, name: true, is_active: true, status: true, deletion_scheduled_at: true, deleted_at: true } },
  images: { where: { is_primary: true }, select: { url: true }, take: 1 },
  variants: { where: { is_active: true }, select: { price: true, stock_quantity: true } },
} as const;

function assignableRow(p: Prisma.ProductGetPayload<{ select: typeof ASSIGNABLE_SELECT }>) {
  const prices = p.variants.map((v) => Number(v.price));
  return {
    id: p.id,
    name_es: p.name_es,
    name_en: p.name_en,
    brand: p.brand,
    image_url: p.images[0]?.url ?? null,
    /** Null = Cesto's own catalogue. */
    store: p.store ? { id: p.store.id, name: p.store.name } : null,
    sizes: p.variants.length,
    price_from: prices.length ? Math.min(...prices).toFixed(2) : null,
    price_to: prices.length ? Math.max(...prices).toFixed(2) : null,
    is_active: p.is_active,
    /** Who it is shown to — a B2B-only one reaches only the rep's business clients. */
    audience: p.audience,
    in_stock: p.variants.some((v) => v.stock_quantity > 0),
    /** Why its shop cannot be sold from, or null — then the rep does not see it. */
    shop_unavailable: p.store ? unavailableReason(p.store) : null,
  };
}

const isRep = async (userId: string) =>
  !!(await prisma.salesRep.findUnique({ where: { user_id: userId }, select: { user_id: true } }));

/**
 * Their assigned products counted by shop — over all of them, whatever the
 * list is filtered to — so the profile can say where they come from and the
 * page can filter by it. `hidden` = the rep cannot see them now: inactive,
 * or the shop is switched off. Cesto's own is `store: null`.
 */
async function assignedByShop(userId: string) {
  const groups = await prisma.product.groupBy({
    by: ['store_id', 'is_active'],
    where: { rep_assignments: { some: { sales_rep_id: userId } } },
    _count: { _all: true },
  });
  const ids = [...new Set(groups.map((g) => g.store_id).filter((id): id is string => id !== null))];
  const stores = new Map((await prisma.store.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, is_active: true, status: true, deletion_scheduled_at: true, deleted_at: true },
  })).map((st) => [st.id, st]));
  const byShop = new Map<string | null, { store: { id: string; name: string } | null; count: number; hidden: number }>();
  for (const g of groups) {
    const st = g.store_id ? stores.get(g.store_id) : null;
    const row = byShop.get(g.store_id) ?? { store: st ? { id: st.id, name: st.name } : null, count: 0, hidden: 0 };
    row.count += g._count._all;
    if (!g.is_active || (st && unavailableReason(st))) row.hidden += g._count._all;
    byShop.set(g.store_id, row);
  }
  return [...byShop.values()].sort((a, b) => b.count - a.count || (a.store?.name ?? '').localeCompare(b.store?.name ?? ''));
}

const repProductsQuery = z.object({
  q: z.string().max(200).optional(),
  // A shop's id, or 'cesto' for Cesto's own.
  storeId: z.union([z.literal(HOUSE_STORE_ID), z.string().uuid()]).optional(),
});

// GET /api/admin/sales-reps/:userId/products — what is assigned, newest first.
router.get('/:userId/products', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!(await isRep(userId))) return error(res, 'That account is not a sales rep.', 404);
  const parsed = repProductsQuery.safeParse({ q: req.query.q, storeId: req.query.storeId || undefined });
  if (!parsed.success) return error(res, parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '), 422);
  const params = parsePage(req.query, 50, 200);
  const q = parsed.data.q?.trim() ?? '';
  const { storeId } = parsed.data;
  const where: Prisma.SalesRepProductWhereInput = {
    sales_rep_id: userId,
    ...(q || storeId ? { product: buildProductWhere({ q: q || undefined, storeId }) } : {}),
  };
  const [rows, total, sellable, byShop] = await Promise.all([
    prisma.salesRepProduct.findMany({
      where,
      select: { created_at: true, product: { select: ASSIGNABLE_SELECT } },
      orderBy: [{ created_at: 'desc' }, { product_id: 'asc' }],
      skip: params.skip,
      take: params.limit,
    }),
    prisma.salesRepProduct.count({ where }),
    // How many of all of them the rep can actually sell now.
    prisma.product.count({ where: { is_active: true, ...assignedScope(userId) } }),
    assignedByShop(userId),
  ]);
  return success(res, {
    ...paged(rows.map((r) => ({ ...assignableRow(r.product), assigned_at: r.created_at })), total, params),
    sellable,
    by_shop: byShop,
  });
}));

// GET /api/admin/sales-reps/:userId/products/search — the picker: active
// products of any shop that can be sold from, each saying if already theirs.
// The order builder's filters (category, brand, origin, shop, stock, sort),
// plus whether they are theirs already.
const productSearchSchema = productFilterSchema.pick({
  q: true, storeId: true, categoryId: true, subcategoryId: true, brandId: true, originId: true, stock: true,
}).extend({
  sort: z.enum(['name_asc', 'name_desc', 'newest', 'oldest']).optional(),
  assigned: z.enum(['true', 'false']).optional(),
});

const SEARCH_ORDER: Record<NonNullable<z.infer<typeof productSearchSchema>['sort']>, Prisma.ProductOrderByWithRelationInput[]> = {
  name_asc: [{ name_es: 'asc' }, { id: 'asc' }],
  name_desc: [{ name_es: 'desc' }, { id: 'asc' }],
  newest: [{ created_at: 'desc' }, { id: 'asc' }],
  oldest: [{ created_at: 'asc' }, { id: 'asc' }],
};

router.get('/:userId/products/search', asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!(await isRep(userId))) return error(res, 'That account is not a sales rep.', 404);
  const parsed = productSearchSchema.safeParse(req.query);
  if (!parsed.success) return error(res, parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '), 422);
  const params = parsePage(req.query, 30, 100);
  const { sort, assigned, ...filters } = parsed.data;
  const where = buildProductWhere(filters);
  where.is_active = true;
  where.AND = [
    ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
    // Offering one whose shop is suspended would assign the rep nothing.
    { OR: [{ store_id: null }, { store: SELLABLE_STORE }] },
    ...(assigned ? [{ rep_assignments: assigned === 'true' ? { some: { sales_rep_id: userId } } : { none: { sales_rep_id: userId } } }] : []),
  ];
  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: { ...ASSIGNABLE_SELECT, rep_assignments: { where: { sales_rep_id: userId }, select: { product_id: true }, take: 1 } },
      orderBy: SEARCH_ORDER[sort ?? 'name_asc'],
      skip: params.skip,
      take: params.limit,
    }),
    prisma.product.count({ where }),
  ]);
  return success(res, paged(rows.map(({ rep_assignments: mine, ...p }) => ({ ...assignableRow(p), assigned: mine.length > 0 })), total, params));
}));

const productIdsSchema = z.object({
  product_ids: z.array(z.string().uuid()).min(1).max(500),
}).strict();

// POST /api/admin/sales-reps/:userId/products — assign; already theirs is fine.
router.post('/:userId/products', requireRole('super_admin'), validate(productIdsSchema), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const ids = [...new Set((req.body as z.infer<typeof productIdsSchema>).product_ids)];
  if (!(await isRep(userId))) return error(res, 'That account is not a sales rep.', 404);
  const found = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true } });
  if (found.length !== ids.length) return error(res, 'Some of those products no longer exist.', 422);
  // Applies from the rep's next request: their catalogue and what they may add.
  const made = await prisma.salesRepProduct.createMany({
    data: ids.map((product_id) => ({ sales_rep_id: userId, product_id })),
    skipDuplicates: true,
  });
  const total = await prisma.salesRepProduct.count({ where: { sales_rep_id: userId } });
  return success(res, { added: made.count, total }, 201);
}));

// POST /api/admin/sales-reps/:userId/products/remove — unassign. Orders
// already built keep their lines; the rep can no longer add them.
router.post('/:userId/products/remove', requireRole('super_admin'), validate(productIdsSchema), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!(await isRep(userId))) return error(res, 'That account is not a sales rep.', 404);
  const gone = await prisma.salesRepProduct.deleteMany({
    where: { sales_rep_id: userId, product_id: { in: (req.body as z.infer<typeof productIdsSchema>).product_ids } },
  });
  const total = await prisma.salesRepProduct.count({ where: { sales_rep_id: userId } });
  return success(res, { removed: gone.count, total });
}));

// ─── POST /api/admin/sales-reps/:userId/resend-credentials ───
//
// A typo'd address, a mail eaten by a spam filter, a rep who never got round
// to signing in and has lost the message. Without this the only route back is
// the customer forgot-password flow, which lands them on the STOREFRONT and
// does not mention /sales — a poor thing to talk somebody through.
//
// Super-admin, like hiring and revoking: this mints a working password for an
// account. The same reasoning that gated those gates this.
//
// `send_email: false` issues the password and does NOT mail it, for an admin
// who is going to read it out or paste it into a message. The password comes
// back either way — see the note on the response below.
const resendSchema = z.object({
  send_email: z.boolean().default(true),
}).strict();

router.post('/:userId/resend-credentials', requireRole('super_admin'), validate(resendSchema), asyncHandler(async (req, res) => {
  const { send_email: sendEmail } = req.body as z.infer<typeof resendSchema>;
  const rep = await prisma.salesRep.findUnique({
    where: { user_id: req.params.userId },
    select: {
      is_active: true,
      code: true,
      user: { select: { id: true, name: true, email: true, status: true, preferred_language: true } },
    },
  });
  if (!rep) return error(res, 'That account is not a sales rep.', 404);
  // Still required when nothing is being mailed: the email IS the username,
  // so an account without one has no credentials to hand over.
  if (!rep.user.email) return error(res, 'This rep has no email address on file.', 422);
  if (rep.user.status === 'blocked') {
    return error(res, 'This account is blocked. Unblock it first.', 422);
  }
  /**
   * A revoked rep is refused, because the mail this sends is the rep welcome:
   * it points at /sales, which the route guard will turn them away from, and
   * names a staff number they no longer hold. Reinstate them, or send them
   * through the ordinary customer reset if what they need is their shopping
   * account back.
   */
  if (!rep.is_active) {
    return error(res, 'Their rep access is revoked. Reinstate them first.', 409);
  }

  const tempPassword = generateTempPassword(12);
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  /**
   * ROTATE FIRST, then send. If the mail fails the old password is already
   * dead, which is the safe direction to fail in — nobody is left holding a
   * credential we have told an admin was replaced. The customer resend route
   * makes the same trade for the same reason.
   *
   * It rotates the password on the USER, which is the whole account: a rep who
   * also shops here signs in to the storefront with this too. That is what
   * one identity means, and it is why this is worth a confirmation on the way
   * in rather than a button that fires.
   */
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: rep.user.id },
      data: { password_hash: passwordHash, password_is_temp: true },
    });
    // A live refresh token would otherwise outlive the rotation.
    await tx.userRefreshToken.deleteMany({ where: { user_id: rep.user.id } });
  });

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[salesrep-resend] email=${rep.user.email} tempPassword=${tempPassword}`);
  }

  /**
   * ROTATED, AND THEN SEPARATELY EITHER SENT OR NOT.
   *
   * Reported as a 200 with `email_sent`, not an error, because the rotation is
   * the part that committed and the caller has to know it did: their old
   * password is dead either way. A 4xx/5xx here would read as "nothing
   * happened" and invite a retry that rotates a second time.
   *
   * Both ways of not delivering collapse into the same answer, because the
   * admin's next move is the same for both — find another way to give them
   * the password. `reason` says which it was.
   */
  let emailSent = false;
  let reason: string | null = null;
  if (!sendEmail) {
    reason = 'Not sent — the password was issued to be handed over directly.';
  } else if (!mailerDelivers) {
    reason = 'No email provider is configured in this environment.';
  } else {
    try {
      await sendSalesRepWelcomeEmail({
        to: rep.user.email,
        name: rep.user.name,
        loginUrl: salesLoginUrl(),
        loginEmail: rep.user.email,
        tempPassword,
        code: rep.code,
        lang: resolveEmailLang(rep.user.preferred_language),
      });
      emailSent = true;
    } catch (mailErr) {
      console.error('[salesrep-resend] email failed after password rotation', mailErr);
      reason = mailErr instanceof Error ? mailErr.message : String(mailErr);
    }
  }

  /**
   * THE PASSWORD COMES BACK, and that is a deliberate choice rather than a
   * convenience.
   *
   * It follows /api/admin/staff and /api/admin/staff/:id/reset-password, which
   * have always answered with `temp_password` for the same reason: the rotation
   * already happened, so withholding the one string that makes it useful just
   * strands the account. That is not hypothetical here — this whole route
   * exists because the email is the unreliable part.
   *
   * What makes it acceptable is what the password is: single-use by
   * construction. `password_is_temp` is set above, so the first thing it does
   * is force the rotate screen. And the caller is a super-admin who could
   * reset this account at will anyway — the response tells them nothing the
   * button did not already give them.
   */
  return success(res, {
    rotated: true,
    email_sent: emailSent,
    reason,
    login_email: rep.user.email,
    temp_password: tempPassword,
    message: emailSent
      ? 'New credentials sent.'
      : 'Their password was reset. Hand the new one over directly.',
  });
}));

export default router;
