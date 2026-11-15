import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { B2bPriceRequired, assertB2bPriced } from '../../lib/audience';
import { moveRepAssignments } from '../../lib/repStore';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';

/**
 * Partner-scoped duplicate detection + resolve + merge.
 *
 * Mirrors admin's `/api/admin/products/duplicates` implementation but with
 * two hard guarantees:
 *   1. Every DB read is scoped to `store_id = req.partnerRole.store.id`, so
 *      a partner only ever sees duplicates within their own catalogue.
 *   2. Every resolve / merge target ID is re-checked against store ownership
 *      before we mutate — a partner cannot pass an ID belonging to another
 *      store's product, even if they somehow discover it.
 *
 * Cross-store detection is intentionally dropped — everything on the partner
 * side is single-store, so a `is_cross_store` flag would always be false, and
 * `multi_store_listings` (which admin returns) can never be non-empty here.
 * Rashan pre-checks are dropped too: rashan packs are curated by Cesto admins
 * and never reference partner-created products directly. If that ever
 * changes we'll add the check back.
 *
 * Detection is IDENTITY-BASED, matching admin as of 2026-07-24. It replaced a
 * union-find over loose signals (same name OR same brand+variant OR same
 * image), which over-grouped: two genuinely different products sharing a
 * placeholder image were merged into one "duplicate" group, and a partner
 * acting on that would delete real inventory.
 */

const router = Router();

// ─── GET /api/partner/products/duplicates ───────────────

router.get('/', asyncHandler(async (req, res) => {
  const storeId = req.partnerRole!.store.id;

  const rows = await prisma.product.findMany({
    where: { store_id: storeId },
    select: {
      id: true,
      name_es: true,
      name_en: true,
      brand: true,
      origin: true,
      is_active: true,
      created_at: true,
      category_id: true,
      subcategory_id: true,
      product_type_id: true,
      store_id: true,
      store: { select: { id: true, slug: true, name: true } },
      _count: { select: { variants: true, images: true } },
      variants: {
        orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
        select: {
          id: true, name_es: true, name_en: true, price: true,
          compare_at_price: true, b2b_price: true, stock_quantity: true,
          sku: true, is_default: true, is_active: true,
        },
      },
      images: {
        orderBy: [{ is_primary: 'desc' }, { sort_order: 'asc' }],
        take: 1,
        select: { url: true },
      },
    },
    orderBy: { created_at: 'asc' },
  });

  // NFKD → strip combining marks → collapse whitespace. Groups
  // "Aceite Oliva" with "Acéite Oliva ".
  const normalize = (s: string) =>
    s.trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ');

  // Identity fingerprint — the WHAT-IS-THIS-PRODUCT signature, byte-identical
  // to admin's. Two rows with the same fingerprint are the same product
  // regardless of variant pack sizes, prices or stock: a partner who imported
  // "Arroz Tilda 1kg" and "Arroz Tilda 5kg" as separate products has ONE
  // product with two pack sizes.
  //
  // Descriptions and images are deliberately excluded. Real imports carry
  // small text drift and different image URLs for the same product, and
  // treating those as identity would hide real duplicates — while treating a
  // shared image as PROOF of duplication (as the old union-find did) invents
  // false ones.
  const fingerprintOf = (p: typeof rows[number]): string => JSON.stringify([
    normalize(p.name_es),
    normalize(p.name_en),
    normalize(p.brand ?? ''),
    normalize(p.origin ?? ''),
    p.category_id ?? '',
    p.subcategory_id ?? '',
    p.product_type_id ?? '',
  ]);

  const byFingerprint = new Map<string, typeof rows>();
  for (const p of rows) {
    const fp = fingerprintOf(p);
    const bucket = byFingerprint.get(fp);
    if (bucket) bucket.push(p);
    else byFingerprint.set(fp, [p]);
  }

  // Every row here is already scoped to one store, so a bucket of >= 2 is a
  // real duplicate group. No same-store partitioning to do, and no
  // multi-store listings to separate out.
  const duplicateGroups = [...byFingerprint.values()].filter((g) => g.length >= 2);

  // Bulk order-item counts so the UI can flag "cannot hard-delete, has X orders".
  const productIds = duplicateGroups.flatMap((g) => g.map((p) => p.id));
  const orderCountRows = productIds.length === 0
    ? []
    : await prisma.orderItem.groupBy({
        by: ['product_id'],
        where: { product_id: { in: productIds } },
        _count: { _all: true },
      });
  const orderCountByProduct = new Map<string, number>();
  for (const row of orderCountRows) orderCountByProduct.set(row.product_id, row._count._all);

  const result = duplicateGroups.map((group) => {
    const products = group.map((p) => ({
      id: p.id,
      name_es: p.name_es,
      name_en: p.name_en,
      brand: p.brand,
      is_active: p.is_active,
      category_id: p.category_id,
      created_at: p.created_at,
      variant_count: p._count.variants,
      image_count: p._count.images,
      order_item_count: orderCountByProduct.get(p.id) ?? 0,
      // Empty — kept for API shape parity with admin's response so the
      // shared frontend can consume either. Rashan is admin-only.
      rashan_pack_names: [] as string[],
      primary_image_url: (p.images[0]?.url ?? '').trim() || null,
      first_variant_name: normalize(p.variants[0]?.name_es ?? '') || null,
      store_id: p.store_id,
      store: p.store ?? null,
      variants: p.variants.map((v) => ({
        id: v.id,
        name_es: v.name_es,
        name_en: v.name_en,
        price: v.price.toString(),
        compare_at_price: v.compare_at_price ? v.compare_at_price.toString() : null,
        b2b_price: v.b2b_price ? v.b2b_price.toString() : null,
        stock_quantity: v.stock_quantity,
        sku: v.sku,
        is_default: v.is_default,
        is_active: v.is_active,
      })),
    }));

    // Stable key = earliest product's id. Label = its display name: identity
    // forces every name in the group to match after normalise, so the oldest
    // row's original casing is the natural canonical. (The old code took a
    // majority vote over normalised names, which was only necessary because
    // union-find could group rows whose names differed.)
    const sortedByAge = [...group].sort(
      (a, b) => a.created_at.getTime() - b.created_at.getTime(),
    );

    return {
      key: sortedByAge[0].id,
      label: sortedByAge[0].name_es,
      // Always false in the partner scope — one store, so it can't be
      // cross-store. Kept so the shared response type stays identical.
      is_cross_store: false,
      products,
    };
  });

  return success(res, {
    groups: result,
    // Present and always empty: a partner sees one store, so the same identity
    // cannot span two. Included so the response shape stays identical to
    // admin's and the frontend types are shared rather than forked.
    multi_store_listings: [],
    total_groups: result.length,
    total_duplicate_products: result.reduce((n, g) => n + g.products.length, 0),
    total_multi_store_groups: 0,
    total_multi_store_products: 0,
  });
}));

// Shared body shape for /resolve + /merge — same as admin's.
const resolveDuplicatesSchema = z.object({
  groups: z.array(z.object({
    keep_id:    z.string().uuid(),
    remove_ids: z.array(z.string().uuid()).min(1),
  })).min(1).max(500),
});

/**
 * Every product ID in the payload must belong to this partner's store.
 * Returns the offending ID on failure so the caller can 404 without leaking
 * whether the ID exists at all.
 */
async function assertGroupsBelongToStore(
  groups: z.infer<typeof resolveDuplicatesSchema>['groups'],
  storeId: string,
): Promise<{ ok: true } | { ok: false; badId: string }> {
  const allIds = new Set<string>();
  for (const g of groups) {
    allIds.add(g.keep_id);
    for (const rid of g.remove_ids) allIds.add(rid);
  }
  if (allIds.size === 0) return { ok: true };
  const rows = await prisma.product.findMany({
    where: { id: { in: [...allIds] } },
    select: { id: true, store_id: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r.store_id] as const));
  for (const id of allIds) {
    if (byId.get(id) !== storeId) return { ok: false, badId: id };
  }
  return { ok: true };
}

// ─── POST /api/partner/products/duplicates/resolve ──────

router.post('/resolve', validate(resolveDuplicatesSchema), asyncHandler(async (req, res) => {
  const { groups } = req.body as z.infer<typeof resolveDuplicatesSchema>;
  const storeId = req.partnerRole!.store.id;

  const check = await assertGroupsBelongToStore(groups, storeId);
  if (!check.ok) return error(res, 'One or more products not found.', 404);

  const removeIds = groups.flatMap((g) => g.remove_ids);
  if (removeIds.length === 0) {
    return success(res, {
      groups_processed: groups.length,
      deactivated: 0, deleted: 0,
      skipped: [], failed: [],
    });
  }

  // Split into deactivate vs. hard-delete based on OrderItem history. Any
  // product with a past order gets soft-deleted so we don't break history.
  const withOrders = await prisma.orderItem.groupBy({
    by: ['product_id'],
    where: { product_id: { in: removeIds } },
    _count: { _all: true },
  });
  const withOrdersSet = new Set(withOrders.map((r) => r.product_id));

  const toDeactivate = removeIds.filter((id) => withOrdersSet.has(id));
  const toDelete     = removeIds.filter((id) => !withOrdersSet.has(id));

  // A sales rep a duplicate was assigned to keeps selling the one kept
  // (lib/repStore): copied before the duplicates go or switch off.
  for (const g of groups) {
    for (const id of g.remove_ids) await moveRepAssignments(prisma, id, g.keep_id);
  }

  let deactivated = 0;
  if (toDeactivate.length > 0) {
    const r = await prisma.product.updateMany({
      where: { id: { in: toDeactivate }, store_id: storeId },
      data: { is_active: false },
    });
    deactivated = r.count;
  }

  const failed: Array<{ id: string; error: string }> = [];
  let deleted = 0;
  for (const id of toDelete) {
    try {
      // Belt + suspenders — store_id filter on the delete itself, so even
      // if assertGroupsBelongToStore had a race, this still can't touch
      // another partner's product.
      const r = await prisma.product.deleteMany({ where: { id, store_id: storeId } });
      deleted += r.count;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn(`[partner:duplicates:resolve] failed to hard-delete ${id}: ${message}`);
      failed.push({ id, error: message });
    }
  }

  return success(res, {
    groups_processed: groups.length,
    deactivated,
    deleted,
    // Kept for shape parity with admin's response.
    skipped: [] as Array<{ id: string; reason: string }>,
    failed,
  });
}));

// ─── POST /api/partner/products/duplicates/merge ────────
// Reassigns variants + images from remove_ids INTO keep_id, then deletes
// the now-empty shell products. Variant IDs are preserved so every
// OrderItem.variant_id FK still resolves to a live row.

const mergeDuplicatesSchema = resolveDuplicatesSchema;
router.post('/merge', validate(mergeDuplicatesSchema), asyncHandler(async (req, res) => {
  const { groups } = req.body as z.infer<typeof mergeDuplicatesSchema>;
  const storeId = req.partnerRole!.store.id;

  const check = await assertGroupsBelongToStore(groups, storeId);
  if (!check.ok) return error(res, 'One or more products not found.', 404);

  const removeIds = groups.flatMap((g) => g.remove_ids);
  if (removeIds.length === 0) {
    return success(res, {
      groups_processed: groups.length,
      merged_variants: 0, merged_images: 0, deleted: 0,
      skipped: [], failed: [],
    });
  }

  const failed: Array<{ id: string; error: string }> = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  let mergedVariants = 0;
  let mergedImages   = 0;
  let deletedCount   = 0;

  for (const g of groups) {
    for (const removeId of g.remove_ids) {
      try {
        const moved = await prisma.$transaction(async (tx) => {
          // Re-check inside the tx so a concurrent delete/move can't
          // sneak a non-owned product into the merge.
          const inSameStore = await tx.product.findFirst({
            where: { id: removeId, store_id: storeId },
            select: { id: true },
          });
          if (!inSameStore) throw new Error('Product no longer in this store');

          const v = await tx.productVariant.updateMany({
            where: { product_id: removeId },
            data:  { product_id: g.keep_id },
          });

          const img = await tx.productImage.updateMany({
            where: { product_id: removeId },
            data:  { product_id: g.keep_id },
          });

          // A sales rep it was assigned to keeps it as the kept one (lib/repStore).
          await moveRepAssignments(tx, removeId, g.keep_id);
          await tx.product.delete({ where: { id: removeId } });
          // Cesto may show the kept product to B2B only; then every size it
          // sells needs a B2B price (lib/audience), arriving ones included.
          await assertB2bPriced(tx, g.keep_id);
          return { variants: v.count, images: img.count };
        });
        // Counted once it has committed — a merge rolled back moved nothing,
        // and the page reports these as "variants moved".
        mergedVariants += moved.variants;
        mergedImages += moved.images;
        deletedCount += 1;
      } catch (err) {
        if (err instanceof B2bPriceRequired) {
          skipped.push({ id: removeId, reason: 'The product kept is shown to B2B only, and this one has a size without a B2B price. Give it one before merging.' });
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn(`[partner:duplicates:merge] failed for ${removeId}: ${message}`);
        failed.push({ id: removeId, error: message });
      }
    }
  }

  return success(res, {
    groups_processed: groups.length,
    merged_variants: mergedVariants,
    merged_images:   mergedImages,
    deleted:         deletedCount,
    skipped,
    failed,
  });
}));

export default router;
