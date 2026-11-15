import { Router, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { linkPartner, issuePartnerCredentials, PartnerAccessError } from '../../lib/partnerAccess';

/**
 * Partners the office makes (2026-10-31): giving somebody a store, and their
 * login again. See lib/partnerAccess for the rules; this file only checks the
 * shape of what came in and says what went wrong.
 *
 * Mounted at /api/admin/partners, behind requireAdmin like every admin route —
 * any admin, as approving an application is. Taking a store AWAY stays
 * super_admin-only (POST /api/admin/stores/:id/unlink-partner).
 */
const router = Router();

function refuse(res: Response, e: unknown) {
  if (e instanceof PartnerAccessError) return error(res, e.message, e.status);
  // The email was free when looked up and taken by the time of the insert.
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    return error(res, 'An account with that email was created a moment ago. Try again — it will be linked.', 409);
  }
  throw e;
}

const linkSchema = z.object({
  user: z.object({
    // Optional for somebody who already has an account (theirs stands).
    name: z.string().trim().max(200).default(''),
    email: z.string().trim().email().max(255),
  }),
  store_id: z.string().uuid().optional(),
  store: z.object({
    name: z.string().trim().min(1).max(200),
    contact_email: z.string().trim().email().max(255).nullable().optional(),
    contact_phone: z.string().trim().max(50).nullable().optional(),
  }).optional(),
  send_email: z.boolean().default(true),
}).strict().refine(
  (d) => !!d.store_id !== !!d.store,
  { message: 'Give exactly one of store_id (an existing store) or store (a new one).' },
);

// ─── POST /api/admin/partners ───────────────────────────
// Make somebody the partner of a store — an existing one with no partner, or
// a new draft store made for them.
router.post('/', validate(linkSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof linkSchema>;
  try {
    const result = await linkPartner({
      user: body.user,
      storeId: body.store_id,
      store: body.store,
      sendEmail: body.send_email,
      adminId: req.admin?.adminId ?? null,
    });
    return success(res, result, 201);
  } catch (e) {
    return refuse(res, e);
  }
}));

const credentialsSchema = z.object({ send_email: z.boolean().default(true) }).strict();

// ─── POST /api/admin/partners/:userId/credentials ───────
// Their login again: a new temporary password, signed out everywhere, and the
// partner mail naming their stores. Answers the shape the client and rep
// resend routes do.
router.post('/:userId/credentials', validate(credentialsSchema), asyncHandler(async (req, res) => {
  const { send_email: sendEmail } = req.body as z.infer<typeof credentialsSchema>;
  if (!z.string().uuid().safeParse(req.params.userId).success) return error(res, 'Account not found.', 404);
  try {
    return success(res, await issuePartnerCredentials(req.params.userId, sendEmail));
  } catch (e) {
    return refuse(res, e);
  }
}));

export default router;
