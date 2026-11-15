import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { computeOriginProductCounts } from '../../lib/origin-counts';

const router = Router();

// ─── Zod ────────────────────────────────────────────────

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

// Origin `key` doubles as both the URL slug and the string the Excel
// importer resolves against. Same rules as store slugs but reserved for
// alphanumerics (no hyphens in typical country slugs like "pakistan").
const keySchema = z
  .string()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Key must be lowercase, hyphen-separated, no leading/trailing hyphens.',
  });

const baseOriginSchema = z.object({
  key:          keySchema.optional(),
  label_es:     z.string().min(1).max(60),
  label_en:     z.string().min(1).max(60),
  bg_color:     hexColorSchema.nullable().optional(),
  accent_color: hexColorSchema.nullable().optional(),
  image_url:    imageUrlSchema.nullable().optional(),
  link:         z.string().max(500).nullable().optional(),
  is_active:    z.boolean().default(true),
  sort_order:   z.number().int().default(0),
});

const createOriginSchema = baseOriginSchema;
const updateOriginSchema = baseOriginSchema.partial();

const reorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

// ─── Helpers ────────────────────────────────────────────

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'origin';
}

async function makeUniqueKey(base: string, excludeId?: string): Promise<string> {
  let candidate = base;
  let n = 1;
  while (n < 100) {
    const clash = await prisma.origin.findFirst({
      where: { key: candidate, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
  throw new Error('Could not derive a unique key — please pass one explicitly.');
}

// ─── Routes ─────────────────────────────────────────────

router.get('/', asyncHandler(async (_req, res) => {
  // Admin counts include ALL products (active + inactive, every store) so
  // admins see the true blast radius before editing/deleting an origin.
  const [origins, countsById] = await Promise.all([
    prisma.origin.findMany({
      orderBy: [{ sort_order: 'asc' }, { label_es: 'asc' }],
    }),
    computeOriginProductCounts(),
  ]);
  // Fetch `source` via raw SQL as a defensive backstop — see the identical
  // note on the /admin/brands GET handler. Dev servers running a stale
  // Prisma client silently omit unknown columns from findMany's SELECT.
  const sources = await prisma.$queryRawUnsafe<Array<{ id: string; source: string }>>(
    `SELECT id, source FROM origins`,
  );
  const sourceById = new Map(sources.map((s) => [s.id, s.source]));
  return success(res, origins.map((o) => ({
    ...o,
    // Preserve the `_count.products` shape the admin frontend already reads
    // — just swap the source under it so the count reflects FK ∪ string.
    _count: { products: countsById.get(o.id) ?? 0 },
    source: sourceById.get(o.id) ?? 'manual',
  })));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const [origin, countsById] = await Promise.all([
    prisma.origin.findUnique({ where: { id: req.params.id } }),
    computeOriginProductCounts(),
  ]);
  if (!origin) return error(res, 'Origin not found.', 404);
  return success(res, {
    ...origin,
    _count: { products: countsById.get(origin.id) ?? 0 },
  });
}));

router.post('/', validate(createOriginSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof createOriginSchema>;
  const key = await makeUniqueKey(body.key ?? slugify(body.label_es || body.label_en));
  try {
    const origin = await prisma.origin.create({
      data: {
        key,
        label_es:     body.label_es.trim(),
        label_en:     body.label_en.trim(),
        bg_color:     body.bg_color ?? null,
        accent_color: body.accent_color ?? null,
        image_url:    body.image_url ?? null,
        link:         body.link ?? null,
        is_active:    body.is_active,
        sort_order:   body.sort_order,
      },
    });
    return success(res, origin, 201);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return error(res, 'An origin with this key already exists.', 409);
    }
    throw e;
  }
}));

router.put('/:id', validate(updateOriginSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof updateOriginSchema>;
  const existing = await prisma.origin.findUnique({ where: { id: req.params.id } });
  if (!existing) return error(res, 'Origin not found.', 404);

  let nextKey = existing.key;
  if (body.key && body.key !== existing.key) {
    nextKey = await makeUniqueKey(body.key, existing.id);
  }

  try {
    const origin = await prisma.origin.update({
      where: { id: existing.id },
      data: {
        key: nextKey,
        ...(body.label_es     !== undefined ? { label_es: body.label_es.trim() } : {}),
        ...(body.label_en     !== undefined ? { label_en: body.label_en.trim() } : {}),
        ...(body.bg_color     !== undefined ? { bg_color: body.bg_color } : {}),
        ...(body.accent_color !== undefined ? { accent_color: body.accent_color } : {}),
        ...(body.image_url    !== undefined ? { image_url: body.image_url } : {}),
        ...(body.link         !== undefined ? { link: body.link } : {}),
        ...(body.is_active    !== undefined ? { is_active: body.is_active } : {}),
        ...(body.sort_order   !== undefined ? { sort_order: body.sort_order } : {}),
      },
    });

    // Keep the denormalised `Product.origin` string in sync with the
    // canonical `label_es` on the FK'd rows. Older API deploys hydrating
    // from the string will pick up the new casing on their next request.
    if (body.label_es !== undefined && body.label_es.trim() !== existing.label_es) {
      await prisma.product.updateMany({
        where: { origin_id: origin.id },
        data:  { origin: origin.label_es },
      });
    }

    return success(res, origin);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return error(res, 'Another origin already uses that key.', 409);
    }
    throw e;
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.origin.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) return error(res, 'Origin not found.', 404);

  // FK is ON DELETE SET NULL. Also clear the denormalised string on every
  // product whose `origin` matches this row's aliases (case-insensitive) —
  // otherwise legacy rows without an origin_id keep the ghost string
  // pointing at a nonexistent origin.
  const aliases = Array.from(new Set([
    existing.key,
    existing.label_es,
    ...(existing.label_en ? [existing.label_en] : []),
  ]));
  const [fkUpdate, strUpdate] = await prisma.$transaction([
    prisma.product.updateMany({
      where: { origin_id: existing.id },
      data:  { origin: null, origin_id: null },
    }),
    prisma.product.updateMany({
      where: {
        origin_id: null,
        origin: { in: aliases, mode: 'insensitive' },
      },
      data: { origin: null },
    }),
    prisma.origin.delete({ where: { id: existing.id } }),
  ]);

  return success(res, {
    deleted: true,
    product_count: fkUpdate.count + strUpdate.count,
  });
}));

router.post('/reorder', validate(reorderSchema), asyncHandler(async (req, res) => {
  const { ids } = req.body as z.infer<typeof reorderSchema>;
  await prisma.$transaction(
    ids.map((id, i) =>
      prisma.origin.update({ where: { id }, data: { sort_order: i } }),
    ),
  );
  return success(res, { reordered: ids.length });
}));

export default router;
