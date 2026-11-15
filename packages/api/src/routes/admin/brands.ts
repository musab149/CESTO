import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';

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

const slugSchema = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Slug must be lowercase, hyphen-separated, no leading/trailing hyphens.',
  });

const baseBrandSchema = z.object({
  name:       z.string().min(1).max(80),
  slug:       slugSchema.optional(),
  logo_url:   imageUrlSchema.nullable().optional(),
  logo_bg:    hexColorSchema.nullable().optional(),
  link:       z.string().max(500).nullable().optional(),
  is_active:  z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

const createBrandSchema = baseBrandSchema;
const updateBrandSchema = baseBrandSchema.partial();

const reorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

// ─── Helpers ────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'brand';
}

async function makeUniqueSlug(base: string, excludeId?: string): Promise<string> {
  let candidate = base;
  let n = 1;
  while (n < 100) {
    const clash = await prisma.brand.findFirst({
      where: { slug: candidate, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
  throw new Error('Could not derive a unique slug — please pass one explicitly.');
}

// ─── Routes ─────────────────────────────────────────────

router.get('/', asyncHandler(async (_req, res) => {
  const brands = await prisma.brand.findMany({
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { products: true } } },
  });
  // Fetch `source` via raw SQL as a defensive backstop: a dev server whose
  // Prisma client hasn't been regenerated since the source column was added
  // in migration `20260713160000` will silently omit it from findMany's
  // SELECT list, and the frontend Suggestions filter will show nothing.
  // Raw SQL bypasses the client's schema and always returns it.
  const sources = await prisma.$queryRawUnsafe<Array<{ id: string; source: string }>>(
    `SELECT id, source FROM brands`,
  );
  const sourceById = new Map(sources.map((s) => [s.id, s.source]));
  return success(res, brands.map((b) => ({ ...b, source: sourceById.get(b.id) ?? 'manual' })));
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const brand = await prisma.brand.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { products: true } } },
  });
  if (!brand) return error(res, 'Brand not found.', 404);
  return success(res, brand);
}));

router.post('/', validate(createBrandSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof createBrandSchema>;
  const slug = await makeUniqueSlug(body.slug ?? slugify(body.name));
  try {
    const brand = await prisma.brand.create({
      data: {
        name:       body.name.trim(),
        slug,
        logo_url:   body.logo_url ?? null,
        logo_bg:    body.logo_bg ?? null,
        link:       body.link ?? null,
        is_active:  body.is_active,
        sort_order: body.sort_order,
      },
    });
    return success(res, brand, 201);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return error(res, 'A brand with this name already exists.', 409);
    }
    throw e;
  }
}));

router.put('/:id', validate(updateBrandSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof updateBrandSchema>;
  const existing = await prisma.brand.findUnique({ where: { id: req.params.id } });
  if (!existing) return error(res, 'Brand not found.', 404);

  // Recompute slug ONLY if the admin explicitly passed one (or the name
  // changed AND they didn't fix the slug) — silently churning it would
  // break any /brands/:slug links they've published elsewhere.
  let nextSlug = existing.slug;
  if (body.slug && body.slug !== existing.slug) {
    nextSlug = await makeUniqueSlug(body.slug, existing.id);
  }

  try {
    const brand = await prisma.brand.update({
      where: { id: existing.id },
      data: {
        ...(body.name       !== undefined ? { name: body.name.trim() } : {}),
        slug:       nextSlug,
        ...(body.logo_url   !== undefined ? { logo_url: body.logo_url } : {}),
        ...(body.logo_bg    !== undefined ? { logo_bg: body.logo_bg } : {}),
        ...(body.link       !== undefined ? { link: body.link } : {}),
        ...(body.is_active  !== undefined ? { is_active: body.is_active } : {}),
        ...(body.sort_order !== undefined ? { sort_order: body.sort_order } : {}),
      },
    });

    // Keep the denormalised `Product.brand` string in sync when the display
    // name changes. Product responses that already read `brand_ref.name`
    // won't care, but older API deploys still hydrating from the string
    // will see the fresh casing on their next refresh.
    if (body.name !== undefined && body.name.trim() !== existing.name) {
      await prisma.product.updateMany({
        where: { brand_id: brand.id },
        data:  { brand: brand.name },
      });
    }

    return success(res, brand);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return error(res, 'Another brand already uses that name or slug.', 409);
    }
    throw e;
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.brand.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { products: true } } },
  });
  if (!existing) return error(res, 'Brand not found.', 404);

  // Delete cascade rule is ON DELETE SET NULL — products keep existing but
  // lose their brand_id. Also clear the denormalised string so an admin
  // deleting Carbonell doesn't leave "Carbonell" ghosted on every product.
  await prisma.$transaction([
    prisma.product.updateMany({
      where: { brand_id: existing.id },
      data:  { brand: null },
    }),
    prisma.brand.delete({ where: { id: existing.id } }),
  ]);

  return success(res, { deleted: true, product_count: existing._count.products });
}));

// Bulk-reorder: accepts an ordered list of ids. Row at position i gets
// sort_order = i. Used by the drag-to-reorder UI on the brand editor.
router.post('/reorder', validate(reorderSchema), asyncHandler(async (req, res) => {
  const { ids } = req.body as z.infer<typeof reorderSchema>;
  await prisma.$transaction(
    ids.map((id, i) =>
      prisma.brand.update({ where: { id }, data: { sort_order: i } }),
    ),
  );
  return success(res, { reordered: ids.length });
}));

export default router;
