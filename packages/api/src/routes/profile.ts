import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { eraseUser, UserErasureError } from '../lib/eraseUser';

const router = Router();
router.use(requireAuth);

// ─── GET /api/users/me ──────────────────────────────────

router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true, name: true, email: true, phone: true,
        avatar_url: true, preferred_language: true, status: true, created_at: true,
        password_is_temp: true,
        // B2B business account. `is_business` drives whether the price
        // toggle renders at all; `pricing_mode` is which side it's on.
        is_business: true,
        pricing_mode: true,
        // The partner's own application, so /partner/* can show them what they
        // submitted. Separate from business_profile — that marks a wholesale
        // BUYER and drives b2b pricing; this marks a seller and drives nothing.
        partner_profile: {
          select: {
            company: true, business_type: true, location: true, website: true,
            registration_no: true, contact_phone: true, approved_at: true,
            linked_existing: true,
            linked_store: { select: { id: true, slug: true, name: true } },
          },
        },
        business_profile: {
          select: {
            company: true, business_type: true, location: true,
            website: true, registration_no: true, contact_phone: true,
            approved_at: true,
          },
        },
        // Post-unified-identity: surface every store the user manages so the
        // customer web can render the "Manage store" pill and the admin
        // shell knows where to route. Only active roles + non-tombstoned
        // stores are returned.
        partner_roles: {
          where: { is_active: true, store: { deleted_at: null } },
          select: {
            role: true,
            store: { select: { id: true, slug: true, name: true } },
          },
        },
        // Same idea for the sales-rep role: the web app needs to know whether
        // to offer /sales/* at all, and asking a second endpoint just to
        // decide whether to render is what partner auth was retired for.
        // `is_active` is in the WHERE, not the payload — a revoked rep is
        // simply not one, and a flag saying "rep, but inactive" would be a
        // second thing for every caller to get right.
        sales_rep_profile: {
          where: { is_active: true },
          select: { code: true, granted_at: true },
        },
      },
    });
    if (!user) return error(res, 'User not found.', 404);

    // Business accounts can no longer switch to retail themselves (the web
    // toggle sends them to a customer login instead) — retail can only be
    // stored here as a leftover from before that gate existed. Self-heal it
    // on every profile fetch so a business account always lands on b2b.
    let pricing_mode = user.pricing_mode;
    if (user.is_business && pricing_mode !== 'b2b') {
      await prisma.user.update({ where: { id: user.id }, data: { pricing_mode: 'b2b' } });
      pricing_mode = 'b2b';
    }

    const { partner_roles, sales_rep_profile, ...rest } = user;
    return success(res, {
      ...rest,
      pricing_mode,
      partner_roles: partner_roles.map((r) => ({
        store_id:   r.store.id,
        store_slug: r.store.slug,
        store_name: r.store.name,
        role:       r.role,
      })),
      is_sales_rep: sales_rep_profile !== null,
      sales_rep_code: sales_rep_profile?.code ?? null,
    });
  } catch (err) { next(err); }
});

// ─── PATCH /api/users/me/pricing-mode ───────────────────
// Flips the storefront between retail and wholesale pricing for an approved
// business customer. Persisted server-side rather than held in the client
// because order totals are recomputed from it at checkout — a client-only
// flag would let anyone award themselves wholesale prices from devtools.
//
// Non-business users get a 403 rather than a silent no-op so the frontend
// can tell "not entitled" from "saved".

const pricingModeSchema = z.object({
  mode: z.enum(['retail', 'b2b']),
});

router.patch('/me/pricing-mode', validate(pricingModeSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { mode } = req.body as z.infer<typeof pricingModeSchema>;
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { is_business: true },
    });
    if (!user) return error(res, 'User not found.', 404);
    if (!user.is_business && mode === 'b2b') {
      return error(res, 'This account is not approved for business pricing.', 403);
    }
    const updated = await prisma.user.update({
      where: { id: req.user!.userId },
      data: { pricing_mode: mode },
      select: { pricing_mode: true, is_business: true },
    });
    return success(res, updated);
  } catch (err) { next(err); }
});

// There is no PATCH /api/users/me/location. It used to persist the postcode
// a customer browsed as, so the catalogue could be narrowed to stores whose
// delivery zones reached them. Coverage is no longer modelled — every live
// store sells everywhere — so there is nothing for a browse location to
// filter and nothing to store.

// ─── GET /api/users/me/followed-stores ──────────────────
// Every store the current user follows. Enables a future "My stores" tab and
// primes the storefront follow state so the button doesn't flicker on load.

router.get('/me/followed-stores', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.storeFollow.findMany({
      where: { user_id: req.user!.userId },
      orderBy: { created_at: 'desc' },
      include: { store: true },
    });
    return success(res, rows.map((r) => r.store));
  } catch (err) { next(err); }
});

// ─── PUT /api/users/me ──────────────────────────────────

const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  dateOfBirth: z.string().optional(),
});

router.put('/me', validate(updateProfileSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: { ...(name && { name }), ...(email && { email }) },
      select: {
        id: true, name: true, email: true, phone: true,
        avatar_url: true, preferred_language: true,
      },
    });
    return success(res, user);
  } catch (err) { next(err); }
});

// ─── POST /api/users/me/avatar ──────────────────────────

router.post('/me/avatar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Accepts a URL only. The bytes go up via POST /api/uploads/avatar, which
    // stores to Bunny (or local disk) and hands back the URL to send here.
    const { avatar_url } = req.body;
    if (!avatar_url) return error(res, 'avatar_url is required.', 400);

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: { avatar_url },
      select: { id: true, avatar_url: true },
    });
    return success(res, user);
  } catch (err) { next(err); }
});

// ─── DELETE /api/users/me ───────────────────────────────

// All the rules live in lib/eraseUser, shared with the admin action that
// honours emailed requests. Response shape is unchanged: { message, mode }.
router.delete('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const outcome = await eraseUser(req.user!.userId, 'self');
    return success(res, { message: 'Account deleted.', ...outcome });
  } catch (err) {
    if (err instanceof UserErasureError) return error(res, err.message, err.status);
    next(err);
  }
});

// ─── POST /api/users/fcm-token ──────────────────────────

const fcmSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['web', 'ios', 'android']),
});

router.post('/fcm-token', validate(fcmSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { fcm_token: req.body.token },
    });
    return success(res, { message: 'FCM token saved.' });
  } catch (err) { next(err); }
});

// ─── DELETE /api/users/fcm-token ────────────────────────

router.delete('/fcm-token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { fcm_token: null },
    });
    return success(res, { message: 'FCM token removed.' });
  } catch (err) { next(err); }
});

export default router;
