// ─── Partner import-duplicate review queue ─────────────────
//
// Mirrors /api/admin/products/import-duplicates, scoped to the partner's own
// store. Rows land here when the partner importer finds a spreadsheet row that
// duplicates a product already in their catalogue; the partner then decides
// per row: create it anyway, or dismiss it.
//
// Store scoping is structural rather than filtered-in: partner rows live in
// `partner_product_import_duplicates`, a different table from admin's, so a
// query here cannot reach an admin row at all. On top of that every read and
// write carries `store_id = req.partnerRole.store.id`, so one partner cannot
// reach another's queue even though they share the table.
//
// Two rules that differ from admin's version:
//   · `store_id` on create comes from the JWT, never the stored payload — a
//     tampered payload cannot plant a product in someone else's store.
//   · `is_featured` is not accepted. It is a marketing signal Cesto controls,
//     and the partner importer never sets it.

import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';

const router = Router();

// Kept in step with what the partner importer stores. `.passthrough()` on both
// so a future importer field does not make every queued row un-creatable —
// but note that anything not named here is DROPPED on create, so adding a
// field to the importer means adding it here too.
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
}).passthrough();

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
  is_active: z.boolean(),
  variants: z.array(variantPayloadSchema).min(1),
  image_urls: z.array(z.string()),
}).passthrough();

type StoredPayload = z.infer<typeof payloadSchema>;

/** 404 rather than 403 when the row belongs to another store — no enumeration. */
async function ownRowOr404(id: string, storeId: string) {
  const row = await prisma.partnerProductImportDuplicate.findUnique({ where: { id } });
  return row && row.store_id === storeId ? row : null;
}

// ─── GET / ─────────────────────────────────────────────

const listQuerySchema = z.object({
  status: z.enum(['pending', 'created', 'dismissed', 'all']).optional(),
}).passthrough();

router.get('/', asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return error(res, parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '), 422);
  }
  const status = parsed.data.status ?? 'pending';

  const where: Prisma.PartnerProductImportDuplicateWhereInput = { store_id: storeId };
  if (status !== 'all') where.status = status;

  const rows = await prisma.partnerProductImportDuplicate.findMany({
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
      // Live snapshot so the card can show the current product beside the
      // incoming row. Null once the match is deleted (FK is SET NULL) — the
      // stored matched_product_name keeps the card readable.
      matched_product: {
        select: {
          id: true, name_es: true, name_en: true, brand: true, origin: true,
          is_active: true,
          images: { where: { is_primary: true }, select: { url: true }, take: 1 },
          _count: { select: { variants: true } },
        },
      },
      job: { select: { id: true, filename: true, created_at: true } },
    },
  });

  return success(res, { items: rows, total: rows.length });
}));

// ─── POST /:id/create ──────────────────────────────────
// Partner overrides the duplicate guard for this row.

router.post('/:id/create', asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const row = await ownRowOr404(req.params.id, storeId);
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

  // category_id is NOT NULL on products. The partner importer fails a row
  // outright when its category cannot be resolved, so this should be
  // unreachable — but refuse cleanly rather than surfacing an FK error.
  if (!payload.category_id) {
    return error(
      res,
      'This row was queued before its category could be resolved. Dismiss it and re-import.',
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
          // From the JWT, never the payload. A tampered stored payload must
          // not be able to place a product in another store.
          store_id: storeId,
          is_active: payload.is_active,
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
      await tx.partnerProductImportDuplicate.update({
        where: { id: row.id },
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
// Soft — the row stays for audit, out of future 'pending' listings.

const dismissSchema = z.object({}).passthrough();
router.post('/:id/dismiss', validate(dismissSchema), asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const row = await ownRowOr404(req.params.id, storeId);
  if (!row) return error(res, 'Import duplicate not found.', 404);
  if (row.status !== 'pending') {
    return error(res, `Row already ${row.status}. Nothing to dismiss.`, 409);
  }
  await prisma.partnerProductImportDuplicate.update({
    where: { id: row.id },
    data: { status: 'dismissed', resolved_at: new Date() },
  });
  return success(res, { id: row.id, dismissed: true });
}));

// ─── POST /dismiss-all ─────────────────────────────────
// After a re-upload, dozens of rows can queue at once. `store_id` is in the
// WHERE clause as well as the id filter, so a supplied id belonging to
// another store simply matches nothing.

const dismissAllSchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
});
router.post('/dismiss-all', validate(dismissAllSchema), asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;
  const { ids } = req.body as z.infer<typeof dismissAllSchema>;
  const where: Prisma.PartnerProductImportDuplicateWhereInput = {
    store_id: storeId,
    status: 'pending',
  };
  if (ids && ids.length > 0) where.id = { in: ids };

  const result = await prisma.partnerProductImportDuplicate.updateMany({
    where,
    data: { status: 'dismissed', resolved_at: new Date() },
  });
  return success(res, { dismissed: result.count });
}));

export default router;
