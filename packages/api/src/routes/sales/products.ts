import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { invalidateCountCache } from '../../lib/count-cache';
import { resolveProductRefs } from '../../lib/product-refs';
import {
  HOUSE_STORE_ID, REP_NO_STORE, REP_OUTSIDE_STORE, REP_PICK_STORE, hasShop, noStoreMessage, sellableShopIds, sellsFrom,
} from '../../lib/repStore';

/**
 * A rep adds something the catalogue does not have.
 *
 * The admin route this mirrors (POST /api/admin/products/quick) was written
 * for exactly this person — "a rep is holding a product that is not in the
 * catalogue and has about twenty seconds" — it just could not be reached from
 * the rep surface. The row it creates is real and immediately sellable, and
 * flagged `review_needed` so a catalogue admin fills in images, descriptions
 * and taxonomy later.
 *
 * TWO DIFFERENCES FROM THE ADMIN ROUTE, both narrowing:
 *
 *   · `store_id` may only name one of the rep's own shops (lib/repStore) —
 *     'cesto' for Cesto's own — so they can sell the new row straight away.
 *     A rep with one need not send it; one with several must say which. A rep
 *     with none cannot quick-add.
 *
 *   · `b2b_price` is not accepted either. Trade pricing is a margin decision,
 *     and twenty seconds at a counter is not when it gets made. A wholesale
 *     client buying this before an admin reviews it pays the one price that
 *     was entered, which is the honest outcome — not a guess at a discount.
 *
 * Attribution is the point of the new column. A quick-created row is the
 * lowest-quality data in the catalogue by design, and whoever works the review
 * queue needs to know who to ask about a line that makes no sense.
 */

const router = Router();

const quickProductSchema = z.object({
  name_es: z.string().trim().min(1).max(200),
  name_en: z.string().trim().min(1).max(200),
  category_id: z.string().uuid(),
  brand: z.string().trim().max(120).optional(),
  /**
   * Required, with no default, on purpose.
   *
   * Every other path leaves this on the `reduced` (10%) default with
   * vat_category_reviewed false, which is the data problem the invoicing
   * phases have to clean up. This is the one moment the answer is cheap — a
   * human is holding the product — so it is asked, and the answer is trusted.
   */
  vat_category: z.enum(['zero', 'super_reduced', 'reduced', 'general']),
  price: z.number().positive().max(100000),
  stock_quantity: z.number().int().min(0).max(100000).default(0),
  sku: z.string().trim().max(60).optional(),
  image_url: z.string().trim().min(1).optional(),
  /** Which of the rep's shops it goes into — see above. */
  store_id: z.union([z.literal(HOUSE_STORE_ID), z.string().uuid()]).optional(),
  /** Declared so a caller that sends it hears about it rather than having it
   *  silently stripped. Not a rep's to decide — see above. */
  b2b_price: z.undefined(),
});

router.post('/quick', validate(quickProductSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof quickProductSchema>;
  const repId = req.salesRep!.user.id;

  // Filed under one of the rep's shops (lib/repStore, user decisions
  // 2026-10-25/26), so they can sell it straight away; none, nothing to file
  // it under. Products assigned by hand are not a shop — a rep selling only
  // those has nowhere to put a new one.
  const shop = req.salesRep!.rep.store;
  if (!hasShop(shop)) {
    return error(res, sellsFrom(shop)
      ? 'Adding a product puts it in one of your shops, and you have none. Ask an admin to assign you one.'
      : noStoreMessage(shop), 422, { code: REP_NO_STORE });
  }
  const theirs = [...(shop.house ? [HOUSE_STORE_ID] : []), ...sellableShopIds(shop)];
  const into = body.store_id ?? (theirs.length === 1 ? theirs[0] : null);
  if (!into) return error(res, 'Pick which of your shops it goes into.', 422, { code: REP_PICK_STORE });
  if (!theirs.includes(into)) return error(res, 'That shop is not one of yours.', 422, { code: REP_OUTSIDE_STORE });

  const category = await prisma.category.findUnique({
    where: { id: body.category_id },
    select: { id: true, is_active: true, approval_status: true },
  });
  // Active and approved, matching what the rep's own category list offers —
  // otherwise the one dropdown they can pick from and the one check that runs
  // disagree.
  if (!category || !category.is_active || category.approval_status !== 'approved') {
    return error(res, 'That category no longer exists.', 422);
  }

  const refs = await resolveProductRefs(body.brand ?? null, null);

  const product = await prisma.product.create({
    data: {
      name_es: body.name_es,
      name_en: body.name_en,
      category_id: body.category_id,
      brand: body.brand ?? null,
      brand_id: refs.brand_id,
      // The rep's shop — null for Cesto's own. The order it goes on is still
      // Cesto's (lib/createOrder).
      store_id: into === HOUSE_STORE_ID ? null : into,
      vat_category: body.vat_category,
      // A human just answered the question, so this is genuinely reviewed —
      // unlike the schema default, which nobody has ever confirmed.
      vat_category_reviewed: true,
      is_active: true,
      // Every promo flag stays false. A product described in twenty seconds
      // must not land on a storefront rail.
      is_featured: false,
      is_new_arrival: false,
      is_top_seller: false,
      is_sponsored: false,
      is_quotation_enabled: false,
      created_source: 'quick_create',
      created_by_sales_rep_id: repId,
      review_needed: true,
      variants: {
        create: [{
          name_es: 'Unidad',
          name_en: 'Unit',
          price: body.price,
          b2b_price: null,
          stock_quantity: body.stock_quantity,
          sku: body.sku ?? null,
          is_default: true,
          is_active: true,
        }],
      },
      ...(body.image_url
        ? { images: { create: [{ url: body.image_url, alt_text: body.name_es, sort_order: 0, is_primary: true }] } }
        : {}),
    },
    include: { variants: true, images: true, store: { select: { id: true, name: true } } },
  });

  invalidateCountCache();
  return success(res, product, 201);
}));

export default router;
