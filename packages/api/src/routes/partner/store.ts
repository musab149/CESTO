import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { assertPartnerMayPublish, isGoingLive, StoreNotPublishableError } from '../../lib/store-publish';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';

const router = Router();

// Fields a partner may edit on their own store. Deliberately excludes:
//   · slug, sort_order        — global taxonomy, admin-only
//   · is_active, is_verified  — trust signals, admin-only
//   · is_test, source         — internal flags
//   · deletion_*              — 3-stage soft-delete is admin-only
//   · rating, rating_count    — customer-authored
// `status` is allowed but RESTRICTED to the self-serve transitions the
// partner is authorised for — 'live' and 'paused'. Admin retains full
// control of draft/live/paused/suspended via routes/admin/stores.ts.
// See [[store-soft-delete-pattern]] + Slice 3 roadmap.
const patchStoreSchema = z.object({
  name:            z.string().min(2).max(80).optional(),
  tagline_es:      z.string().max(160).nullable().optional(),
  tagline_en:      z.string().max(160).nullable().optional(),
  description_es:  z.string().max(2000).nullable().optional(),
  description_en:  z.string().max(2000).nullable().optional(),
  logo_url:        z.string().nullable().optional(),
  logo_bg:         z.string().optional(),
  cover_url:       z.string().nullable().optional(),
  contact_email:   z.string().email().nullable().optional(),
  contact_phone:   z.string().max(40).nullable().optional(),
  website_url:     z.string().url().nullable().optional(),
  origin:          z.string().max(60).nullable().optional(),
  // Where the shop physically trades. `country` is the market it sells in;
  // `origin` (above) is the heritage of the goods — a Pakistani grocer in
  // Madrid is country ES, origin Pakistan.
  country:         z.string().regex(/^[A-Za-z]{2}$/, 'Use a 2-letter country code.').optional(),
  address:         z.string().max(200).nullable().optional(),
  fast_delivery:   z.boolean().optional(),
  // Partner-controlled visibility. 'paused' hides the store from customer
  // surfaces while keeping the partner logged in so they can un-pause.
  // 'live' is accepted here only to un-pause: the handler below rejects it
  // from any state other than `paused`, so a partner cannot publish a draft
  // or reinstate a suspension. draft/suspended remain admin-only values.
  status:          z.enum(['live', 'paused']).optional(),
  // shop_hours is a JSON blob shaped like { mon: {open, close}, tue: ... }.
  // We accept whatever the admin StoreFormPage sends today and store it as-is.
  shop_hours:      z.record(z.string(), z.any()).nullable().optional(),
});

const STORE_SELECT = {
  id: true, slug: true, name: true,
  tagline_es: true, tagline_en: true,
  description_es: true, description_en: true,
  logo_url: true, logo_bg: true, cover_url: true,
  contact_email: true, contact_phone: true, website_url: true,
  origin: true, country: true, address: true,
  fast_delivery: true, shop_hours: true,
  is_active: true, is_verified: true, status: true,
  rating: true, rating_count: true,
  sort_order: true, source: true, is_test: true,
  created_at: true, updated_at: true,
  _count: { select: { products: true } },
} as const;

router.get('/', asyncHandler(async (req, res) => {
  const store = await prisma.store.findUnique({
    where: { id: req.partnerRole!.store.id },
    select: STORE_SELECT,
  });
  if (!store) return error(res, 'Store not found.', 404);
  return success(res, store);
}));

router.patch('/', validate(patchStoreSchema), asyncHandler(async (req, res) => {
  const patch = req.body as z.infer<typeof patchStoreSchema>;

  // Go-live gate. A partner may only reach `live` by un-pausing a store
  // Cesto already approved — `draft → live` is the approval itself and is
  // admin-only. Only a transition INTO live is checked, so editing other
  // fields on an already-live store keeps working.
  if (isGoingLive(patch.status)) {
    try {
      await assertPartnerMayPublish(req.partnerRole!.store.id);
    } catch (e) {
      if (e instanceof StoreNotPublishableError) {
        return error(
          res,
          e.currentStatus === 'suspended'
            ? 'This store has been suspended by Cesto. Contact support to have it reinstated.'
            : 'Your store is waiting for approval from Cesto. We will publish it once the review is complete.',
          422,
        );
      }
      throw e;
    }
  }

  // Prisma types JSON columns strictly — `null` needs to be `Prisma.JsonNull`.
  const { shop_hours, ...rest } = patch;
  const data: Prisma.StoreUpdateInput = {
    ...rest,
    ...(shop_hours === undefined
      ? {}
      : { shop_hours: shop_hours === null ? Prisma.JsonNull : (shop_hours as Prisma.InputJsonValue) }),
  };
  const store = await prisma.store.update({
    where: { id: req.partnerRole!.store.id },
    data,
    select: STORE_SELECT,
  });
  return success(res, store);
}));

export default router;
