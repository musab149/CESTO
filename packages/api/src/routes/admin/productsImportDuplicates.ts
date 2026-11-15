import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';

// ─── /api/admin/products/import-duplicates ─────────────
// Pending rows the Excel importer flagged as duplicates of an existing
// product. Admin reviews on the Duplicates page ("From Excel import" tab)
// and either creates the product anyway (override the guard) or dismisses.
// Detection rule + payload shape are documented on the
// ProductImportDuplicate model in schema.prisma.

const router = Router();

// ─── Payload shape (mirrors what the importer stored) ──
// Keep in sync with productsImport.ts where the row is inserted; adding a
// new field there means bumping this schema OR the Create-anyway pass will
// silently drop it.

const variantPayloadSchema = z.object({
  name_es: z.string().min(1),
  name_en: z.string().min(1),
  price: z.number().positive(),
  compare_at_price: z.number().positive().nullable(),
  b2b_price: z.number().positive().nullable(),
  stock_quantity: z.number().int().min(0),
  low_stock_threshold: z.number().int().min(0),
  sku: z.string().nullable(),
  is_default: z.boolean(),
  is_active: z.boolean(),
}).passthrough(); // future importer additions don't blow up create-anyway

const payloadSchema = z.object({
  name_es: z.string().min(1),
  name_en: z.string().min(1),
  description_es: z.string().nullable(),
  description_en: z.string().nullable(),
  brand: z.string().nullable(),
  origin: z.string().nullable(),
  brand_id: z.string().uuid().nullable(),
  origin_id: z.string().uuid().nullable(),
  category_id: z.string().uuid().nullable(),
  subcategory_id: z.string().uuid().nullable(),
  product_type_id: z.string().uuid().nullable(),
  store_id: z.string().uuid().nullable(),
  is_active: z.boolean(),
  is_featured: z.boolean(),
  /** The sheet's `iva` (2026-11-01). Absent on rows staged before it; null = blank. */
  vat_category: z.enum(['zero', 'super_reduced', 'reduced', 'general']).nullable().optional(),
  variants: z.array(variantPayloadSchema).min(1),
  image_urls: z.array(z.string()),
}).passthrough();

type StoredPayload = z.infer<typeof payloadSchema>;

// ─── GET / ─────────────────────────────────────────────
// List pending import duplicates. Status filter defaults to 'pending' —
// pass ?status=all to include history (created + dismissed rows).

const listQuerySchema = z.object({
  status: z.enum(['pending', 'created', 'dismissed', 'all']).optional(),
}).passthrough();

router.get('/', asyncHandler(async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return error(res, parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '), 422);
  }
  const status = parsed.data.status ?? 'pending';

  const where: Prisma.ProductImportDuplicateWhereInput = {};
  if (status !== 'all') where.status = status;

  const rows = await prisma.productImportDuplicate.findMany({
    where,
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      job_id: true,
      source_row_number: true,
      payload: true,
      matched_product_id: true,
      matched_product_name: true,
      status: true,
      created_at: true,
      resolved_at: true,
      // Live snapshot of the matched product so the review card can show
      // the current name/brand/image alongside the incoming payload. Null
      // when the match was later deleted (matched_product_id → SET NULL).
      matched_product: {
        select: {
          id: true, name_es: true, name_en: true, brand: true, origin: true,
          is_active: true,
          store: { select: { id: true, slug: true, name: true } },
          images: {
            where: { is_primary: true },
            select: { url: true },
            take: 1,
          },
          _count: { select: { variants: true } },
        },
      },
      // Original import job for provenance in the UI.
      job: {
        select: {
          id: true, filename: true, created_at: true,
          admin: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  return success(res, {
    items: rows,
    total: rows.length,
  });
}));

// ─── POST /:id/create ──────────────────────────────────
// Admin explicitly overrides the duplicate guard. Insert the product
// exactly as the importer would have (matching the create logic in
// productsImport.ts). Marks the queue row `created` on success.
router.post('/:id/create', asyncHandler(async (req, res) => {
  const id = req.params.id;
  const row = await prisma.productImportDuplicate.findUnique({ where: { id } });
  if (!row) return error(res, 'Import duplicate not found.', 404);
  if (row.status !== 'pending') {
    return error(res, `Row already ${row.status}. Nothing to create.`, 409);
  }

  const parsed = payloadSchema.safeParse(row.payload);
  if (!parsed.success) {
    return error(
      res,
      `Stored payload failed validation: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}. ` +
      'This row was queued by an older importer whose payload shape has since changed — dismiss it and re-import.',
      422,
    );
  }
  const payload: StoredPayload = parsed.data;

  // Category is required at the DB level. If the importer queued a row
  // whose category couldn't be resolved (rare — only happens when the
  // duplicate detection fired before category resolution), refuse the
  // create instead of silently failing on the FK.
  if (!payload.category_id) {
    return error(
      res,
      'This row was queued before its category could be resolved. Dismiss and re-import once the category exists.',
      422,
    );
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name_es: payload.name_es,
          name_en: payload.name_en,
          description_es: payload.description_es,
          description_en: payload.description_en,
          brand: payload.brand,
          origin: payload.origin,
          brand_id: payload.brand_id,
          origin_id: payload.origin_id,
          category_id: payload.category_id!,
          subcategory_id: payload.subcategory_id,
          product_type_id: payload.product_type_id,
          store_id: payload.store_id,
          is_active: payload.is_active,
          is_featured: payload.is_featured,
          // The rate the sheet gave, as a direct import would apply it.
          ...(payload.vat_category ? { vat_category: payload.vat_category, vat_category_reviewed: true } : {}),
          variants: {
            create: payload.variants.map((v) => ({
              name_es: v.name_es,
              name_en: v.name_en,
              price: v.price,
              compare_at_price: v.compare_at_price,
              b2b_price: v.b2b_price,
              stock_quantity: v.stock_quantity,
              low_stock_threshold: v.low_stock_threshold,
              sku: v.sku,
              is_default: v.is_default,
              is_active: v.is_active,
            })),
          },
          images: {
            create: payload.image_urls.map((url, idx) => ({
              url,
              sort_order: idx,
              is_primary: idx === 0,
            })),
          },
        },
      });
      await tx.productImportDuplicate.update({
        where: { id },
        data: { status: 'created', resolved_at: new Date() },
      });
      return product;
    });
    return success(res, { id: created.id, name_es: created.name_es, created: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error(res, `Create failed: ${message}`, 500);
  }
}));

// ─── POST /:id/dismiss ─────────────────────────────────
// Soft-delete — keep the row for audit but exclude from future 'pending'
// listings. Admin can still see it via ?status=all or ?status=dismissed.
const dismissSchema = z.object({}).passthrough();
router.post('/:id/dismiss', validate(dismissSchema), asyncHandler(async (req, res) => {
  const id = req.params.id;
  const row = await prisma.productImportDuplicate.findUnique({ where: { id } });
  if (!row) return error(res, 'Import duplicate not found.', 404);
  if (row.status !== 'pending') {
    return error(res, `Row already ${row.status}. Nothing to dismiss.`, 409);
  }
  await prisma.productImportDuplicate.update({
    where: { id },
    data: { status: 'dismissed', resolved_at: new Date() },
  });
  return success(res, { id, dismissed: true });
}));

// ─── POST /dismiss-all ─────────────────────────────────
// Bulk soft-delete. Optional body `{ ids?: string[] }` targets a specific
// subset (still enforcing status='pending'); omitted → dismiss every
// pending row. Handy after a re-upload where 100+ verbatim rows queued.
const dismissAllSchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
});
router.post('/dismiss-all', validate(dismissAllSchema), asyncHandler(async (req, res) => {
  const { ids } = req.body as z.infer<typeof dismissAllSchema>;
  const where: Prisma.ProductImportDuplicateWhereInput = { status: 'pending' };
  if (ids && ids.length > 0) where.id = { in: ids };

  const result = await prisma.productImportDuplicate.updateMany({
    where,
    data: { status: 'dismissed', resolved_at: new Date() },
  });
  return success(res, { dismissed: result.count });
}));

export default router;
