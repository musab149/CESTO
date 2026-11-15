import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { parsePage, paged } from '../../lib/pagination';
import { requireRole } from '../../middleware/adminAuth';
import { accessOf, ACCESS_SELECT } from '../../lib/clientCredentials';

const router = Router();

// ─── Soft-delete constants ──────────────────────────────
// Grace period between "schedule deletion" and "permanent delete." Set at
// 5 days per product decision — long enough to survive weekends, short
// enough that intended deletions don't linger indefinitely. Change requires
// updating the admin UI countdown copy in tandem.
export const STORE_DELETION_GRACE_DAYS = 5;
const STORE_DELETION_GRACE_MS = STORE_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000;

// ─── Zod schemas ────────────────────────────────────────

const imageUrlSchema = z
  .string()
  .min(1)
  .refine(
    (s) => /^(https?:\/\/|\/|data:|blob:)/.test(s),
    { message: 'Must be a URL or a server path starting with /' },
  );

const hexColorSchema = z
  .string()
  .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/, {
    message: 'Must be a hex color like #FEEFE3',
  });

const timeSchema = z.string().regex(/^\d{1,2}:\d{2}$/, { message: 'HH:MM' });

const shopHoursDaySchema = z.union([
  z.object({ closed: z.literal(true) }),
  z.object({ closed: z.literal(false), open: timeSchema, close: timeSchema }),
]);

const shopHoursSchema = z.object({
  mon: shopHoursDaySchema.optional(),
  tue: shopHoursDaySchema.optional(),
  wed: shopHoursDaySchema.optional(),
  thu: shopHoursDaySchema.optional(),
  fri: shopHoursDaySchema.optional(),
  sat: shopHoursDaySchema.optional(),
  sun: shopHoursDaySchema.optional(),
});

// Slug: lowercase alphanumerics + hyphen. Same rules the customer web relies
// on for /stores/:slug URL segments.
const slugSchema = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lowercase, hyphen-separated, no leading/trailing hyphens.',
  });

const baseStoreSchema = z.object({
  slug: slugSchema.optional(),
  name: z.string().min(1),
  tagline_es: z.string().nullable().optional(),
  tagline_en: z.string().nullable().optional(),
  description_es: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
  logo_url: imageUrlSchema.nullable().optional(),
  logo_bg: hexColorSchema.default('#FFFFFF'),
  cover_url: imageUrlSchema.nullable().optional(),
  rating: z.number().min(0).max(5).nullable().optional(),
  rating_count: z.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
  is_verified: z.boolean().default(false),
  fast_delivery: z.boolean().default(false),
  // Market the store trades in, ISO 3166-1 alpha-2. Drives the customer
  // country filter — a store shows only when its country is the one being
  // browsed. Uppercased on the way in so 'es' and 'ES' cannot become two
  // different markets. Nothing to do with `origin`, which is the cuisine.
  country: z.string().regex(/^[A-Za-z]{2}$/).transform((c) => c.toUpperCase()).optional(),
  // MV Slice 0/1 lifecycle state. Not in the payload = defer to DB default
  // ('live') on create; keep current on update. Draft stores are hidden from
  // customer surfaces via customerVisibleStoreFilter; suspended stores also
  // block partner login. Deliberately kept editable by admin — partner /me
  // route does NOT accept this field (see routes/partner/store.ts comment).
  //
  // This route is the ONLY way a store reaches `live` from `draft` — that
  // transition is Cesto's approval of a partner, and routes/partner/store.ts
  // rejects it (see lib/store-publish.ts). There is no gate here beyond
  // being an admin: admin IS the gate.
  status: z.enum(['draft', 'live', 'paused', 'suspended']).optional(),
  // MV test-data flag. Every mv-created row was written with is_test=true
  // during Slice 0/1/2/3 development so cleanup on cutover is a single
  // WHERE clause. customerVisibleStoreFilter also excludes is_test=true so
  // test rows stay off customer surfaces automatically. Legacy stores from
  // the pre-6cdba65 approval flow got stuck with is_test=true — admin needs
  // a UI path to un-flag them once verified as production data.
  is_test: z.boolean().optional(),
  origin: z.string().nullable().optional(),
  contact_email: z.string().email().nullable().optional().or(z.literal('').transform(() => null)),
  contact_phone: z.string().nullable().optional(),
  website_url: z.string().url().nullable().optional().or(z.literal('').transform(() => null)),
  shop_hours: shopHoursSchema.nullable().optional(),
  sort_order: z.number().int().default(0),
});

const createStoreSchema = baseStoreSchema;
const updateStoreSchema = baseStoreSchema.partial();

const bulkProductsSchema = z.object({
  product_ids: z.array(z.string().uuid()).min(1).max(500),
});

// ─── Helpers ────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'store';
}

async function makeUniqueSlug(base: string, excludeId?: string): Promise<string> {
  let candidate = base;
  let n = 1;
  // Bounded — 100 collisions ought to be plenty even for popular names.
  while (n < 100) {
    const existing = await prisma.store.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing || existing.id === excludeId) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
  // Extremely unlikely fallback — timestamp guarantees uniqueness.
  return `${base}-${Date.now()}`;
}

// ─── Routes ─────────────────────────────────────────────

const listQuerySchema = z.object({
  q: z.string().max(200).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  source: z.enum(['manual', 'import']).optional(),
  /** Filter by soft-delete state.
   *  - `live` (default when omitted): store is normal, not scheduled, not tombstoned
   *  - `pending`: schedule_at set, deleted_at not set — in the 5-day grace window
   *  - `deleted`: deleted_at set — tombstoned, only visible via this filter
   *  Omitting this returns live + pending (i.e. everything except tombstones). */
  deletionState: z.enum(['live', 'pending', 'deleted']).optional(),
}).passthrough();

router.get('/', asyncHandler(async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return error(res, parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '), 422);
  }
  const params = parsePage(req.query, 20, 100);
  const { q, isActive, source, deletionState } = parsed.data;

  const where: Prisma.StoreWhereInput = {};
  if (isActive !== undefined) where.is_active = isActive === 'true';
  // `source` is a scalar column added in migration 20260714100000 — cast
  // the where clause through `unknown` because the local Prisma client
  // may not carry the field in its generated types yet on stale dev
  // servers. Runtime is safe: the column exists in the DB.
  if (source) (where as unknown as { source: string }).source = source;
  // Soft-delete filter — default hides tombstones, explicit modes select one
  // state. Cast through unknown for the same stale-Prisma-client reason as
  // `source` above (columns added in migration 20260716120000).
  const w = where as unknown as { deleted_at?: null | { not: null }; deletion_scheduled_at?: null | { not: null } };
  if (deletionState === 'deleted') {
    w.deleted_at = { not: null };
  } else if (deletionState === 'pending') {
    w.deletion_scheduled_at = { not: null };
    w.deleted_at = null;
  } else if (deletionState === 'live') {
    w.deletion_scheduled_at = null;
    w.deleted_at = null;
  } else {
    // Default: hide tombstones, show live + pending
    w.deleted_at = null;
  }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { slug: { contains: q, mode: 'insensitive' } },
      { origin: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.store.findMany({
      where,
      // Match the customer-facing count (`/api/stores`) so the admin list and
      // the /stores grid never show different numbers for the same store.
      // Active reps selling from it (lib/repStore): switching it off or deleting
      // it takes its products away from them — all they had, for a rep with
      // no other shop — which the screens warn about.
      include: {
        _count: { select: { products: { where: { is_active: true } }, sales_reps: { where: { sales_rep: { is_active: true } } } } },
        // Who manages each (2026-10-31, user: "on stores tab we do not have the
        // add partner buttons"): the list says who, or offers to add one.
        partner_roles: {
          select: { is_active: true, user: { select: { id: true, name: true, email: true } } },
          orderBy: { created_at: 'asc' },
        },
      },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      skip: params.skip,
      take: params.limit,
    }),
    prisma.store.count({ where }),
  ]);

  // Fetch `source` + soft-delete columns via raw SQL as a backstop — dev
  // servers whose Prisma client hasn't been regenerated since migrations
  // `20260714100000` (source) and `20260716120000` (soft-delete) may silently
  // omit the columns from findMany's SELECT. Mirrors the defensive pattern
  // used on /admin/brands and /admin/origins.
  const meta = await prisma.$queryRawUnsafe<Array<{
    id: string;
    source: string;
    deletion_scheduled_at: Date | null;
    deletion_scheduled_by_admin_id: string | null;
    deletion_reason: string | null;
    deleted_at: Date | null;
  }>>(
    `SELECT id, source, deletion_scheduled_at, deletion_scheduled_by_admin_id, deletion_reason, deleted_at FROM stores`,
  );
  const metaById = new Map(meta.map((m) => [m.id, m]));
  const withMeta = items.map(({ partner_roles: roles, ...it }) => {
    const m = metaById.get(it.id);
    return {
      ...it,
      partners: roles.map((r) => ({ user_id: r.user.id, name: r.user.name, email: r.user.email, is_active: r.is_active })),
      source: m?.source ?? 'manual',
      deletion_scheduled_at: m?.deletion_scheduled_at ?? null,
      deletion_scheduled_by_admin_id: m?.deletion_scheduled_by_admin_id ?? null,
      deletion_reason: m?.deletion_reason ?? null,
      deleted_at: m?.deleted_at ?? null,
    };
  });

  return success(res, paged(withMeta, total, params));
}));

// ─── GET /api/admin/stores/linkable ─────────────────────
//
// Stores a partner application may be linked to. Mounted BEFORE `/:id` or the
// id matcher swallows "linkable".
//
// Eligible means all three of:
//   1. created_via = 'admin' — Cesto set this store up itself. A store created
//      BY an approval already belongs to a partner; offering it here would
//      hand one partner's storefront to another.
//   2. No PartnerStoreRole rows at all — not merely no ACTIVE ones. A
//      deactivated role still means the store was somebody's, and silently
//      re-issuing it is the kind of thing nobody notices until two people are
//      editing the same catalogue.
//   3. Not deleted and not scheduled for deletion — linking a partner to a
//      store that disappears in five days is a trap.
//
// Product and order counts ride along so the admin sees what the partner is
// about to inherit. Linking a store with 800 products is a legitimate thing to
// do, but it should be a decision rather than a surprise.
router.get('/linkable', asyncHandler(async (_req, res) => {
  const stores = await prisma.store.findMany({
    where: {
      created_via: 'admin',
      deleted_at: null,
      deletion_scheduled_at: null,
      partner_roles: { none: {} },
    },
    select: {
      id: true, slug: true, name: true, status: true, is_active: true,
      logo_url: true, origin: true, created_at: true,
      _count: { select: { products: true, orders: true } },
    },
    orderBy: { name: 'asc' },
  });

  return success(res, { items: stores, total: stores.length });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  const store = await prisma.store.findUnique({
    where: { id },
    include: {
      _count: { select: { products: { where: { is_active: true } }, sales_reps: { where: { sales_rep: { is_active: true } } } } },
      products: { select: { id: true } },
      partner_roles: {
        select: {
          role: true, is_active: true, created_at: true,
          user: { select: { id: true, name: true, email: true, status: true, ...ACCESS_SELECT } },
        },
        orderBy: { created_at: 'asc' },
      },
    },
  });
  if (!store) return error(res, 'Store not found.', 404);

  // Soft-delete columns via raw SQL backstop — same rationale as the list
  // route (stale generated Prisma client may miss the migration
  // 20260716120000 columns).
  const [meta] = await prisma.$queryRawUnsafe<Array<{
    deletion_scheduled_at: Date | null;
    deletion_scheduled_by_admin_id: string | null;
    deletion_reason: string | null;
    deleted_at: Date | null;
    scheduler_name: string | null;
    scheduler_email: string | null;
  }>>(
    `SELECT s.deletion_scheduled_at, s.deletion_scheduled_by_admin_id,
            s.deletion_reason, s.deleted_at,
            a.name  AS scheduler_name,
            a.email AS scheduler_email
     FROM stores s
     LEFT JOIN admins a ON a.id = s.deletion_scheduled_by_admin_id
     WHERE s.id = $1::uuid`,
    id,
  );

  const { products, partner_roles: roles, ...rest } = store;
  return success(res, {
    ...rest,
    product_ids: products.map((p) => p.id),
    // Who manages it (2026-10-31: the store page's Partner tab). Built field
    // by field: the user row carries the password hash, which must not leave.
    // `access` is how they sign in — none, a temporary password not yet
    // replaced, or one of their own (lib/clientCredentials).
    partners: roles.map((r) => ({
      user_id: r.user.id,
      name: r.user.name,
      email: r.user.email,
      status: r.user.status,
      role: r.role,
      is_active: r.is_active,
      linked_at: r.created_at,
      access: accessOf(r.user),
    })),
    deletion_scheduled_at: meta?.deletion_scheduled_at ?? null,
    deletion_scheduled_by_admin_id: meta?.deletion_scheduled_by_admin_id ?? null,
    deletion_reason: meta?.deletion_reason ?? null,
    deleted_at: meta?.deleted_at ?? null,
    deletion_scheduled_by: meta?.scheduler_name
      ? { name: meta.scheduler_name, email: meta.scheduler_email }
      : null,
  });
}));

router.post('/', validate(createStoreSchema), asyncHandler(async (req, res) => {
  const payload = req.body as z.infer<typeof createStoreSchema>;
  const slug = await makeUniqueSlug(payload.slug || slugify(payload.name));
  // shop_hours is JSON in Postgres, so cast to Prisma.InputJsonValue.
  const { shop_hours, ...rest } = payload;
  const created = await prisma.store.create({
    data: {
      ...rest,
      slug,
      shop_hours: shop_hours === undefined ? undefined : (shop_hours as unknown as Prisma.InputJsonValue),
    },
  });
  return success(res, created, 201);
}));

router.patch('/:id', validate(updateStoreSchema), asyncHandler(async (req, res) => {
  const id = req.params.id;
  const payload = req.body as z.infer<typeof updateStoreSchema>;

  // Refuse edits to a tombstoned store. Scheduled-for-deletion stores are
  // still editable (admin may want to fix a typo before the grace period ends
  // or before restoring). Tombstones are immutable — restore first.
  const [state] = await prisma.$queryRawUnsafe<Array<{ deleted_at: Date | null }>>(
    `SELECT deleted_at FROM stores WHERE id = $1::uuid`,
    id,
  );
  if (!state) return error(res, 'Store not found.', 404);
  if (state.deleted_at) {
    return error(res, 'This store has been permanently deleted. Restore it before editing.', 409);
  }

  // Publishing is logged. `draft → live` is the approval of a partner's
  // storefront, and it is the one status change with an outside-facing
  // consequence, so it leaves a trace naming the admin who made it.
  if (payload.status === 'live') {
    console.log(`[admin:stores] publishing store=${id} by admin=${req.admin?.adminId ?? 'unknown'}`);
  }

  const { shop_hours, ...rest } = payload;
  const data: Prisma.StoreUpdateInput = {
    ...rest,
    ...(shop_hours !== undefined && {
      shop_hours: shop_hours === null
        ? Prisma.JsonNull
        : (shop_hours as unknown as Prisma.InputJsonValue),
    }),
  };
  if (payload.slug !== undefined) {
    data.slug = await makeUniqueSlug(payload.slug || slugify(payload.name ?? ''), id);
  }

  try {
    const updated = await prisma.store.update({ where: { id }, data });
    return success(res, updated);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return error(res, 'Store not found.', 404);
    }
    throw e;
  }
}));

// ─── Soft-delete flow ──────────────────────────────────
// The old DELETE /:id endpoint used to hard-delete in one call. That was
// dangerous even in single-vendor and becomes catastrophic under mv (see
// [[store-soft-delete-pattern]] memory). The flow is now three explicit
// steps, and only super_admin can pull the trigger on the last one.
//
//   1. schedule-deletion  (any admin) → 5-day grace period begins,
//                                       store hidden from customers
//   2. cancel-deletion    (any admin) → grace period aborted, store live again
//   3. permanent-delete   (super_admin ONLY, ONLY after grace elapsed)
//                                     → row tombstoned (deleted_at set),
//                                       kept forever for order history
//   4. restore            (super_admin) → un-tombstone a permanently-deleted
//                                         store; brings it back live

// Old DELETE returns 410 Gone with a pointer. Kept for a deploy window so
// stale admin bundles hitting the endpoint see a clear error instead of a
// silent 404 (per feedback_deploy-shape-skew). Safe to remove after Slice 7
// of the mv roadmap.
router.delete('/:id', asyncHandler(async (_req, res) => {
  return error(
    res,
    'Direct delete has been replaced by a 3-stage soft-delete flow. Refresh the admin and try again.',
    410,
  );
}));

const scheduleDeletionSchema = z.object({
  /** Must exactly match the store's `name` — typed by the admin as a
   *  human-brain sanity check that they picked the right row. */
  confirmation_name: z.string().min(1).max(200),
  /** Free-text audit trail. Required, min 10 chars — prevents "test" and
   *  other low-effort reasons that make the audit log useless. */
  reason: z.string().min(10).max(1000),
});

router.post(
  '/:id/schedule-deletion',
  validate(scheduleDeletionSchema),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const { confirmation_name, reason } = req.body as z.infer<typeof scheduleDeletionSchema>;
    const adminId = req.admin!.adminId;

    const [row] = await prisma.$queryRawUnsafe<Array<{
      id: string;
      name: string;
      deletion_scheduled_at: Date | null;
      deleted_at: Date | null;
    }>>(
      `SELECT id, name, deletion_scheduled_at, deleted_at FROM stores WHERE id = $1::uuid`,
      id,
    );
    if (!row) return error(res, 'Store not found.', 404);
    if (row.deleted_at) {
      return error(res, 'This store has already been permanently deleted.', 409);
    }
    if (row.deletion_scheduled_at) {
      return error(res, 'Deletion is already scheduled. Cancel it first if you want to change the reason.', 409);
    }
    if (confirmation_name !== row.name) {
      return error(res, `Confirmation name must match "${row.name}" exactly.`, 422);
    }

    await prisma.$executeRawUnsafe(
      `UPDATE stores
       SET deletion_scheduled_at = NOW(),
           deletion_scheduled_by_admin_id = $1::uuid,
           deletion_reason = $2,
           updated_at = NOW()
       WHERE id = $3::uuid`,
      adminId,
      reason,
      id,
    );

    return success(res, {
      message: `Deletion scheduled. Grace period ends in ${STORE_DELETION_GRACE_DAYS} days. Store hidden from customers immediately.`,
      grace_days: STORE_DELETION_GRACE_DAYS,
    });
  }),
);

router.post('/:id/cancel-deletion', asyncHandler(async (req, res) => {
  const id = req.params.id;

  const [row] = await prisma.$queryRawUnsafe<Array<{
    deletion_scheduled_at: Date | null;
    deleted_at: Date | null;
  }>>(
    `SELECT deletion_scheduled_at, deleted_at FROM stores WHERE id = $1::uuid`,
    id,
  );
  if (!row) return error(res, 'Store not found.', 404);
  if (row.deleted_at) {
    return error(res, 'This store has already been permanently deleted. Use restore instead.', 409);
  }
  if (!row.deletion_scheduled_at) {
    return error(res, 'Deletion was not scheduled for this store.', 409);
  }

  await prisma.$executeRawUnsafe(
    `UPDATE stores
     SET deletion_scheduled_at = NULL,
         deletion_scheduled_by_admin_id = NULL,
         deletion_reason = NULL,
         updated_at = NOW()
     WHERE id = $1::uuid`,
    id,
  );

  return success(res, { message: 'Deletion cancelled. Store is live again.' });
}));

const permanentDeleteSchema = z.object({
  confirmation_name: z.string().min(1).max(200),
});

router.post(
  '/:id/permanent-delete',
  requireRole('super_admin'),
  validate(permanentDeleteSchema),
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const { confirmation_name } = req.body as z.infer<typeof permanentDeleteSchema>;

    const [row] = await prisma.$queryRawUnsafe<Array<{
      name: string;
      deletion_scheduled_at: Date | null;
      deleted_at: Date | null;
    }>>(
      `SELECT name, deletion_scheduled_at, deleted_at FROM stores WHERE id = $1::uuid`,
      id,
    );
    if (!row) return error(res, 'Store not found.', 404);
    if (row.deleted_at) {
      return error(res, 'This store is already permanently deleted.', 409);
    }
    if (!row.deletion_scheduled_at) {
      return error(res, 'Deletion must be scheduled first. Use POST /schedule-deletion.', 409);
    }
    const elapsedMs = Date.now() - row.deletion_scheduled_at.getTime();
    if (elapsedMs < STORE_DELETION_GRACE_MS) {
      const remainingMs = STORE_DELETION_GRACE_MS - elapsedMs;
      const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
      return error(
        res,
        `Grace period has not elapsed. ${remainingDays} day(s) remaining before permanent deletion is allowed.`,
        409,
      );
    }
    if (confirmation_name !== row.name) {
      return error(res, `Confirmation name must match "${row.name}" exactly.`, 422);
    }

    // Tombstone — do NOT hard-delete the row. Order history, followers, and
    // audit trail all reference this id; losing the row loses that context.
    // A real DROP is a manual SQL operation reserved for legal/GDPR requests.
    await prisma.$executeRawUnsafe(
      `UPDATE stores
       SET deleted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1::uuid`,
      id,
    );

    return success(res, {
      message: 'Store permanently deleted. Row preserved as tombstone for history; hidden from all surfaces.',
    });
  }),
);

router.post('/:id/restore', requireRole('super_admin'), asyncHandler(async (req, res) => {
  const id = req.params.id;

  const [row] = await prisma.$queryRawUnsafe<Array<{ deleted_at: Date | null }>>(
    `SELECT deleted_at FROM stores WHERE id = $1::uuid`,
    id,
  );
  if (!row) return error(res, 'Store not found.', 404);
  if (!row.deleted_at) {
    return error(res, 'This store is not deleted — nothing to restore.', 409);
  }

  await prisma.$executeRawUnsafe(
    `UPDATE stores
     SET deleted_at = NULL,
         deletion_scheduled_at = NULL,
         deletion_scheduled_by_admin_id = NULL,
         deletion_reason = NULL,
         updated_at = NOW()
     WHERE id = $1::uuid`,
    id,
  );

  return success(res, { message: 'Store restored. Live again with all previous data intact.' });
}));

// ─── Product assignment ─────────────────────────────────

router.post('/:id/products', validate(bulkProductsSchema), asyncHandler(async (req, res) => {
  const id = req.params.id;
  const { product_ids } = req.body as z.infer<typeof bulkProductsSchema>;
  // Refuse assigning products to a store that's on the deletion path — the
  // admin should be moving products OFF it, not onto it. Unassign
  // (DELETE /:id/products) stays open so cleanup remains possible.
  const [state] = await prisma.$queryRawUnsafe<Array<{
    id: string;
    deletion_scheduled_at: Date | null;
    deleted_at: Date | null;
  }>>(
    `SELECT id, deletion_scheduled_at, deleted_at FROM stores WHERE id = $1::uuid`,
    id,
  );
  if (!state) return error(res, 'Store not found.', 404);
  if (state.deleted_at) {
    return error(res, 'This store has been permanently deleted. Restore it before assigning products.', 409);
  }
  if (state.deletion_scheduled_at) {
    return error(res, 'This store is scheduled for deletion. Cancel the deletion first or move products elsewhere.', 409);
  }

  const result = await prisma.product.updateMany({
    where: { id: { in: product_ids } },
    data: { store_id: id },
  });
  return success(res, { assigned: result.count });
}));

router.delete('/:id/products', asyncHandler(async (req, res) => {
  const id = req.params.id;
  const idsQuery = typeof req.query.ids === 'string' ? req.query.ids : '';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const productIds = idsQuery.split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s));
  if (productIds.length === 0) return error(res, 'Provide ?ids=<uuid,uuid,...> of products to unassign.', 400);

  const result = await prisma.product.updateMany({
    where: { id: { in: productIds }, store_id: id },
    data: { store_id: null },
  });
  return success(res, { unassigned: result.count });
}));

// ─── POST /api/admin/stores/:id/unlink-partner ──────────
//
// Detach every partner from a store and return it to the link pool.
//
// Exists because linking is otherwise a one-way door: pick the wrong store in
// the approval modal and the only remedy is editing the database. Support
// needs a way back.
//
// What it does NOT do is equally deliberate:
//   · The partner's User account survives. They may be a customer too, and
//     deleting an account to undo a link would be wildly disproportionate.
//   · Their PartnerProfile survives, with linked_store_id going NULL via the
//     FK. It is the record of who applied and when; that history should not
//     vanish because a link was corrected.
//   · Products and orders stay with the STORE. They belong to the storefront,
//     not the person who was managing it.
//
// super_admin only. A partner losing access to their storefront mid-trading is
// not something a regular admin should be able to do by misclicking.
router.post('/:id/unlink-partner', requireRole('super_admin'), asyncHandler(async (req, res) => {
  const storeId = req.params.id;

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      id: true, name: true, status: true, created_via: true,
      partner_roles: {
        select: { user_id: true, user: { select: { name: true, email: true } } },
      },
    },
  });
  if (!store) return error(res, 'Store not found.', 404);
  if (store.partner_roles.length === 0) {
    return error(res, 'No partner is linked to this store.', 409);
  }

  const removed = store.partner_roles.map((r) => ({
    user_id: r.user_id,
    name: r.user?.name ?? null,
    email: r.user?.email ?? null,
  }));

  await prisma.$transaction(async (tx) => {
    await tx.partnerStoreRole.deleteMany({ where: { store_id: storeId } });

    // Return it to the pool only if Cesto created it. A store created BY an
    // approval is not unclaimed inventory just because its partner was
    // removed — re-offering it would misrepresent where it came from.
    if (store.created_via === 'admin') {
      // Already 'admin'; nothing to change. Left explicit so the intent is
      // legible next to the branch that must NOT flip.
    }

    // Detach the profile pointer so the partner's dashboard stops resolving
    // to a store they no longer manage. The profile row itself stays.
    await tx.partnerProfile.updateMany({
      where: { linked_store_id: storeId },
      data: { linked_store_id: null },
    });
  });

  return success(res, {
    store_id: storeId,
    store_name: store.name,
    unlinked: removed,
    // Only an admin-created store returns to the picker. Say so rather than
    // letting the admin infer it from the list refreshing (or not).
    returned_to_link_pool: store.created_via === 'admin',
  });
}));

export default router;
