import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { requireAdmin } from '../../middleware/adminAuth';
import { asyncHandler } from '../../lib/async';
import { generateAdminAccessToken } from '../../lib/jwt';
import {
  issueAdminRefreshToken,
  rotateAdminRefreshToken,
} from '../../lib/refreshTokens';
import { authLoginLimiter, authRefreshLimiter } from '../../middleware/rateLimit';

/** Somebody else chose this password: a new account, a reset, a seeded row. */
const mustChange = (admin: { password_changed_at: Date | null }) => admin.password_changed_at === null;

const router = Router();

// Cached bcrypt hash used to spend the same CPU on unknown-email as on a real
// admin login, keeping the response time uniform. See routes/auth.ts.
const TIMING_SAFE_DUMMY_HASH = bcrypt.hashSync('__timing_safe_placeholder__', 12);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', authLoginLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // The hash, by name: no other read gets it (lib/prisma.ts).
  const admin = await prisma.admin.findUnique({ where: { email }, omit: { password_hash: false } });
  if (!admin) {
    await bcrypt.compare(password, TIMING_SAFE_DUMMY_HASH);
    return error(res, 'Invalid email or password.', 401);
  }
  if (!admin.is_active) return error(res, 'This admin account is disabled.', 403);

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) return error(res, 'Invalid email or password.', 401);

  await prisma.admin.update({ where: { id: admin.id }, data: { last_login_at: new Date() } });

  const accessToken = generateAdminAccessToken({
    adminId: admin.id, email: admin.email, role: admin.role, mustChange: mustChange(admin),
  });
  const refreshToken = await issueAdminRefreshToken(admin.id);
  return success(res, {
    accessToken,
    refreshToken,
    admin: {
      id: admin.id, name: admin.name, email: admin.email, role: admin.role,
      must_change_password: mustChange(admin),
    },
  });
}));

router.post('/refresh-token', authRefreshLimiter, validate(z.object({ refreshToken: z.string() })), asyncHandler(async (req, res) => {
  let adminId: string;
  let newRefreshToken: string;
  try {
    const result = await rotateAdminRefreshToken(req.body.refreshToken);
    adminId = result.adminId;
    newRefreshToken = result.newToken;
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }

  const admin = await prisma.admin.findUnique({ where: { id: adminId } });
  if (!admin || !admin.is_active) return error(res, 'Admin account is no longer active.', 403);

  // Read again rather than carried over, so a change of role or a reset counts
  // from the next renewal.
  const accessToken = generateAdminAccessToken({
    adminId: admin.id, email: admin.email, role: admin.role, mustChange: mustChange(admin),
  });
  return success(res, {
    accessToken,
    refreshToken: newRefreshToken,
  });
}));

router.get('/me', requireAdmin, asyncHandler(async (req, res) => {
  const admin = await prisma.admin.findUnique({
    where: { id: req.admin!.adminId },
    select: { id: true, name: true, email: true, role: true, last_login_at: true, password_changed_at: true },
  });
  if (!admin) return error(res, 'Admin not found.', 404);
  const { password_changed_at: _changed, ...shown } = admin;
  return success(res, { ...shown, must_change_password: mustChange(admin) });
}));

// ─── POST /api/admin/auth/change-password ───────────────
//
// Any staff member, their own password, by knowing the current one. The way out
// of a temporary password, and the only route a token holding one may use.
//
// Every other session ends with it: whoever knew the old password, including the
// person who handed out a temporary one, is signed out. This session carries on
// with fresh tokens, which are in the answer.
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string()
    .min(8, 'Use at least 8 characters.')
    .regex(/[a-z]/, 'Include a lowercase letter.')
    .regex(/[A-Z]/, 'Include an uppercase letter.')
    .regex(/[0-9]/, 'Include a number.'),
});

router.post('/change-password', requireAdmin, authLoginLimiter, validate(changePasswordSchema), asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;

  // The hash, by name: no other read gets it (lib/prisma.ts).
  const admin = await prisma.admin.findUnique({ where: { id: req.admin!.adminId }, omit: { password_hash: false } });
  if (!admin || !admin.is_active) return error(res, 'This admin account is disabled.', 403);

  // 400, never 401: a 401 makes the client renew the session and then sign the
  // person out, so a mistyped password would end in the login screen.
  if (!(await bcrypt.compare(currentPassword, admin.password_hash))) {
    return error(res, 'Current password is incorrect.', 400, { code: 'wrong_current_password' });
  }
  if (await bcrypt.compare(newPassword, admin.password_hash)) {
    return error(res, 'Choose a password different from the current one.', 400, { code: 'same_password' });
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.adminRefreshToken.deleteMany({ where: { admin_id: admin.id } });
    return tx.admin.update({
      where: { id: admin.id },
      data: { password_hash: await bcrypt.hash(newPassword, 12), password_changed_at: new Date() },
      select: { id: true, name: true, email: true, role: true, last_login_at: true },
    });
  });

  const accessToken = generateAdminAccessToken({
    adminId: updated.id, email: updated.email, role: updated.role, mustChange: false,
  });
  const refreshToken = await issueAdminRefreshToken(updated.id);
  return success(res, { accessToken, refreshToken, admin: { ...updated, must_change_password: false } });
}));

export default router;
