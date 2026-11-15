import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { normaliseEmail, sameEmail, findUserByEmail, findUserByEmailToCheckPassword } from '../lib/userEmail';
import { generateAccessToken } from '../lib/jwt';
import {
  issueUserRefreshToken,
  rotateUserRefreshToken,
  revokeUserRefreshToken,
} from '../lib/refreshTokens';
import { generateOTP, storeOTP, verifyOTP, checkSendLimit } from '../lib/otp';
import {
  issueResetToken,
  findValidResetToken,
  checkResetRateLimit,
} from '../lib/passwordReset';
import { sendPasswordResetEmail, sendWelcomeEmail, resolveEmailLang } from '../lib/mailer';
import { notifyAdminNewCustomer } from '../lib/notifications';
import { resolveGoogleAccessToken } from '../lib/googleOAuth';
import { verifyAppleIdentityToken } from '../lib/appleAuth';
import { rememberAppleToken } from '../lib/appleTokens';
import { success, error } from '../lib/response';
import { ACCOUNT_BLOCKED } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  authLoginLimiter,
  authRefreshLimiter,
  authRegisterLimiter,
  otpLimiter,
  passwordResetLimiter,
} from '../middleware/rateLimit';

// Cached bcrypt hash of a random string. Used to spend the same CPU on a
// login attempt for an unknown email as for a known one, so response time
// doesn't leak whether an account exists.
const TIMING_SAFE_DUMMY_HASH = bcrypt.hashSync('__timing_safe_placeholder__', 12);
import {
  sendOtpSchema,
  verifyOtpSchema,
  registerEmailSchema,
  loginEmailSchema,
  forgotPasswordSchema,
  googleSignInSchema,
  appleSignInSchema,
  refreshTokenSchema,
  completeProfileSchema,
  changePasswordSchema,
  resetPasswordSchema,
} from '../validators/auth';

const router = Router();

// ─── POST /api/auth/send-otp ───────────────────────────

router.post('/send-otp', otpLimiter, validate(sendOtpSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone, countryCode } = req.body;
    const fullPhone = `${countryCode}${phone}`;

    const limit = checkSendLimit(fullPhone);
    if (!limit.allowed) return error(res, limit.error!, 429);

    const otp = generateOTP();
    storeOTP(fullPhone, otp);

    // MVP: log OTP to console for local development only. Prod must go
    // through an SMS provider — never log OTPs to Render / hosting logs.
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[OTP] ${fullPhone}: ${otp}`);
    }

    return success(res, { message: 'OTP sent successfully.', phone: fullPhone });
  } catch (err) { next(err); }
});

// ─── POST /api/auth/verify-otp ─────────────────────────

router.post('/verify-otp', otpLimiter, validate(verifyOtpSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phone, countryCode, otp } = req.body;
    const fullPhone = `${countryCode}${phone}`;

    const result = verifyOTP(fullPhone, otp);
    if (!result.valid) return error(res, result.error!, 400);

    // Find or create user
    let user = await prisma.user.findUnique({ where: { phone: fullPhone } });
    const isNewUser = !user;

    if (!user) {
      user = await prisma.user.create({
        data: { name: '', phone: fullPhone, phone_country_code: countryCode },
      });
      void notifyAdminNewCustomer({ userId: user.id, name: user.phone ?? '' });
    }

    const accessToken = generateAccessToken({ userId: user.id, phone: user.phone ?? undefined });
    const refreshToken = await issueUserRefreshToken(user.id);

    return success(res, { accessToken, refreshToken, isNewUser });
  } catch (err) { next(err); }
});

// ─── POST /api/auth/register-email ─────────────────────

router.post('/register-email', authRegisterLimiter, validate(registerEmailSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, password } = req.body;
    // Asked case-insensitively and stored lowercase: an exact-match check let
    // the same person sign up twice with different capitals, and two of those
    // pairs exist on production.
    const stored = normaliseEmail(email);

    const existing = await prisma.user.findFirst({ where: sameEmail(email) });
    if (existing) return error(res, 'An account with this email already exists.', 409);

    const password_hash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email: stored, password_hash },
    });
    void notifyAdminNewCustomer({ userId: user.id, name: user.name });
    void sendWelcomeEmail({
      to: user.email!,
      name: user.name,
      lang: resolveEmailLang(user.preferred_language),
      webUrl: process.env.WEB_URL ?? 'http://localhost:5199',
    }).catch((err) => console.error('[mail:welcome] send failed', err));

    const accessToken = generateAccessToken({ userId: user.id, email: user.email ?? undefined });
    const refreshToken = await issueUserRefreshToken(user.id);

    return success(res, { accessToken, refreshToken, isNewUser: true }, 201);
  } catch (err) { next(err); }
});

// ─── POST /api/auth/login-email ────────────────────────

router.post('/login-email', authLoginLimiter, validate(loginEmailSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;

    // Exactly as typed first, then any case-variant — see findUserByEmail.
    const user = await findUserByEmailToCheckPassword(email);
    // Spend the same CPU on unknown-email as on known-email so response time
    // doesn't leak account existence. Return the same 401 in both cases.
    if (!user || !user.password_hash) {
      await bcrypt.compare(password, TIMING_SAFE_DUMMY_HASH);
      return error(res, 'Invalid email or password.', 401);
    }
    if (user.status === 'blocked') {
      // The reason travels with the refusal so the login screen can say
      // WHY, instead of a bare "blocked" the customer cannot act on.
      return error(res, 'Your account has been blocked.', 403, {
        code: ACCOUNT_BLOCKED,
        reason: user.blocked_reason,
      });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return error(res, 'Invalid email or password.', 401);

    const accessToken = generateAccessToken({ userId: user.id, email: user.email ?? undefined });
    const refreshToken = await issueUserRefreshToken(user.id);

    return success(res, {
      accessToken,
      refreshToken,
      isNewUser: false,
      // Set true when an admin-issued temp password hasn't been rotated
      // yet (partner approval, admin-created accounts). Client uses this
      // to force the change-password screen after login.
      must_change_password: user.password_is_temp === true,
    });
  } catch (err) { next(err); }
});

// ─── POST /api/auth/google ─────────────────────────────
// One endpoint for both sign-in and sign-up. The client sends the Google ID
// token; we verify it, then:
//   - match by google_id → log in
//   - else match by email → link the google_id to the existing account
//   - else create a new user from the Google profile
// Email/password accounts that get linked keep their existing password.

router.post('/google', authLoginLimiter, validate(googleSignInSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { accessToken: googleAccessToken } = req.body;

    let profile;
    try {
      profile = await resolveGoogleAccessToken(googleAccessToken);
    } catch (err: any) {
      return error(res, err?.message ?? 'Invalid Google credential.', err?.status ?? 401);
    }

    if (!profile.emailVerified) {
      return error(res, 'Your Google email is not verified.', 400);
    }

    let user = await prisma.user.findUnique({ where: { google_id: profile.googleId } });
    let isNewUser = false;

    if (!user) {
      // Google hands back whatever Google holds; the account here may be
      // stored in another case. Linking must not miss it and make a second one.
      const byEmail = await findUserByEmail(profile.email);
      if (byEmail) {
        // Link Google to the existing email-based account.
        user = await prisma.user.update({
          where: { id: byEmail.id },
          data: {
            google_id: profile.googleId,
            ...(byEmail.avatar_url ? {} : { avatar_url: profile.picture ?? undefined }),
          },
        });
      } else {
        isNewUser = true;
        user = await prisma.user.create({
          data: {
            name: profile.name ?? profile.email.split('@')[0],
            email: normaliseEmail(profile.email),
            google_id: profile.googleId,
            avatar_url: profile.picture ?? undefined,
          },
        });
        void notifyAdminNewCustomer({ userId: user.id, name: user.name });
        void sendWelcomeEmail({
          to: user.email!,
          name: user.name,
          lang: resolveEmailLang(user.preferred_language),
          webUrl: process.env.WEB_URL ?? 'http://localhost:5199',
        }).catch((err) => console.error('[mail:welcome] send failed', err));
      }
    }

    if (user.status === 'blocked') {
      // The reason travels with the refusal so the login screen can say
      // WHY, instead of a bare "blocked" the customer cannot act on.
      return error(res, 'Your account has been blocked.', 403, {
        code: ACCOUNT_BLOCKED,
        reason: user.blocked_reason,
      });
    }

    // A temporary password is there to prove, at first sign-in, that the
    // person holds the inbox it was emailed to — which is why the partner,
    // rep and B2B screens make them replace it before anything else. Signing
    // in with Google has just proved the same thing, so the temporary
    // password has done its job: retire it, rather than hold them on a screen
    // asking for a password they may never have opened. Left in place it
    // would also stay valid, sitting in an email, for as long as they kept
    // using Google. "Forgot password" sets one of their own whenever they
    // want one.
    if (user.password_is_temp) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { password_hash: null, password_is_temp: false },
      });
    }

    const accessToken = generateAccessToken({ userId: user.id, email: user.email ?? undefined });
    const refreshToken = await issueUserRefreshToken(user.id);

    return success(res, { accessToken, refreshToken, isNewUser });
  } catch (err) { next(err); }
});

// ─── POST /api/auth/apple ──────────────────────────────
// Sign in with Apple, from the iOS app. Same shape as /google: the client
// sends Apple's identity token (plus the raw nonce it was minted for); we
// verify it ourselves (lib/appleAuth.ts), then
//   - match by apple_id → log in
//   - else match by a verified email → link the apple_id to that account
//   - else create a new user.
// A "Hide My Email" relay address never matches an existing account, so those
// users get a new one — Apple's choice, not ours.

router.post('/apple', authLoginLimiter, validate(appleSignInSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { identityToken, nonce, givenName, familyName, authorizationCode } = req.body;

    let profile;
    try {
      profile = await verifyAppleIdentityToken(identityToken, nonce);
    } catch (err: any) {
      return error(res, err?.message ?? 'Invalid Apple credential.', err?.status ?? 401);
    }

    let user = await prisma.user.findUnique({ where: { apple_id: profile.appleId } });
    let isNewUser = false;

    if (!user) {
      const linkable = profile.email && profile.emailVerified ? await findUserByEmail(profile.email) : null;
      if (linkable) {
        user = await prisma.user.update({ where: { id: linkable.id }, data: { apple_id: profile.appleId } });
      } else {
        isNewUser = true;
        // Apple sends the name once, on the first authorization; without it
        // the account gets a placeholder the customer can edit in their profile.
        const name = [givenName, familyName].filter(Boolean).join(' ').trim() || 'Cliente Cesto';
        user = await prisma.user.create({
          data: {
            name,
            email: profile.email ? normaliseEmail(profile.email) : null,
            apple_id: profile.appleId,
          },
        });
        void notifyAdminNewCustomer({ userId: user.id, name: user.name });
        if (user.email) {
          void sendWelcomeEmail({
            to: user.email,
            name: user.name,
            lang: resolveEmailLang(user.preferred_language),
            webUrl: process.env.WEB_URL ?? 'http://localhost:5199',
          }).catch((err) => console.error('[mail:welcome] send failed', err));
        }
      }
    }

    if (user.status === 'blocked') {
      return error(res, 'Your account has been blocked.', 403, {
        code: ACCOUNT_BLOCKED,
        reason: user.blocked_reason,
      });
    }

    // Off the sign-in's critical path: Apple's token endpoint is one more
    // round trip, and a failure only means this sign-in can't be revoked.
    if (authorizationCode) void rememberAppleToken(user.id, authorizationCode, profile.clientId);

    const accessToken = generateAccessToken({ userId: user.id, email: user.email ?? undefined });
    const refreshToken = await issueUserRefreshToken(user.id);

    return success(res, { accessToken, refreshToken, isNewUser });
  } catch (err) { next(err); }
});

// ─── POST /api/auth/forgot-password ────────────────────
// Issues a single-use reset token (15-min TTL) for the user matching `email`
// and delivers a reset link out-of-band. Returns 404 when the email isn't
// registered (product chose explicit feedback over anti-enumeration; the
// per-IP rate limit bounds how fast an attacker could probe).

router.post('/forgot-password', passwordResetLimiter, validate(forgotPasswordSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';

    const rate = checkResetRateLimit(email, ip);
    if (!rate.allowed) {
      return error(res, 'Too many reset requests. Please try again in a few minutes.', 429);
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return error(res, 'No account is associated with this email.', 404);
    }

    const { token, expiresAt } = await issueResetToken(user.id);
    const baseUrl = process.env.WEB_URL ?? 'http://localhost:5199';
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;
    await sendPasswordResetEmail({
      to: email,
      resetUrl,
      expiresAt,
      lang: resolveEmailLang(user.preferred_language),
    });

    return success(res, { message: 'Reset link sent.' });
  } catch (err) { next(err); }
});

// ─── POST /api/auth/reset-password ─────────────────────
// Consumes a reset token in the same transaction that updates the password,
// so a token can never be used twice even under concurrent requests.

router.post('/reset-password', passwordResetLimiter, validate(resetPasswordSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token, newPassword } = req.body;
    const record = await findValidResetToken(token);
    if (!record) {
      return error(res, 'This reset link is invalid or has expired.', 400);
    }

    const password_hash = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction(async (tx) => {
      // Mark the token used first; if another request beat us to it the
      // updateMany returns 0 rows and we treat the token as already consumed.
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, used_at: null },
        data: { used_at: new Date() },
      });
      if (consumed.count === 0) {
        throw Object.assign(new Error('This reset link has already been used.'), { status: 400 });
      }
      await tx.user.update({
        where: { id: record.user_id },
        data: { password_hash, password_is_temp: false },
      });
      // Invalidate any sibling reset tokens for the same user.
      await tx.passwordResetToken.updateMany({
        where: { user_id: record.user_id, used_at: null },
        data: { used_at: new Date() },
      });
    });

    return success(res, { message: 'Password reset successfully. You can now sign in.' });
  } catch (err: any) {
    if (err?.status) return error(res, err.message, err.status);
    next(err);
  }
});

// ─── POST /api/auth/change-password ────────────────────

router.post('/change-password', requireAuth, validate(changePasswordSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user!.userId;

    // The hash, by name: no other read gets it (lib/prisma.ts).
    const user = await prisma.user.findUnique({ where: { id: userId }, omit: { password_hash: false } });
    if (!user) return error(res, 'User not found.', 404);
    if (!user.password_hash) {
      return error(res, 'No password is set on this account. Use the forgot-password flow to set one.', 400);
    }

    // 400, never 401. A 401 means "you are not signed in", and the web client
    // answers one by refreshing the session and, when the retry fails again,
    // signing the person out. So a mistyped current password logged them out
    // instead of saying it was wrong — and a partner or rep held on the
    // forced-rotation screen signed back in, landed on it again, and went
    // round in a loop.
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return error(res, 'Current password is incorrect.', 400, { code: 'wrong_current_password' });

    if (currentPassword === newPassword) {
      return error(res, 'New password must be different from the current one.', 400);
    }

    const password_hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { password_hash, password_is_temp: false },
    });

    return success(res, { message: 'Password updated successfully.' });
  } catch (err) { next(err); }
});

// ─── POST /api/auth/refresh-token ──────────────────────
// Presenting a refresh token rotates it: the old row is revoked and a fresh
// token is issued. Presenting a token that's already been revoked (rotated
// previously, or issued to a session that was logged out) is treated as a
// theft signal — all live refresh tokens for that user are revoked.

router.post('/refresh-token', authRefreshLimiter, validate(refreshTokenSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;

    let userId: string;
    let newRefreshToken: string;
    try {
      const result = await rotateUserRefreshToken(refreshToken);
      userId = result.userId;
      newRefreshToken = result.newToken;
    } catch (e: any) {
      if (e?.status) return error(res, e.message, e.status);
      throw e;
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return error(res, 'User not found.', 404);
    if (user.status === 'blocked') {
      // The reason travels with the refusal so the login screen can say
      // WHY, instead of a bare "blocked" the customer cannot act on.
      return error(res, 'Your account has been blocked.', 403, {
        code: ACCOUNT_BLOCKED,
        reason: user.blocked_reason,
      });
    }

    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
    });

    return success(res, { accessToken, refreshToken: newRefreshToken });
  } catch (err) { next(err); }
});

// ─── POST /api/auth/logout ─────────────────────────────
// Best-effort revoke: clients can send `{ refreshToken }` in the body so the
// row is revoked server-side. Older clients that don't send it still succeed
// — the refresh will die on next rotate anyway (max 30d).

router.post('/logout', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bodyRefresh = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
    if (bodyRefresh) {
      await revokeUserRefreshToken(bodyRefresh).catch((err) => console.error('[auth:logout] refresh revoke failed', err));
    }

    // Clear FCM token on logout
    await prisma.user.update({
      where: { id: req.user!.userId },
      data: { fcm_token: null },
    });

    return success(res, { message: 'Logged out successfully.' });
  } catch (err) { next(err); }
});

// ─── PUT /api/auth/complete-profile ────────────────────

router.put('/complete-profile', requireAuth, validate(completeProfileSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email } = req.body;

    // Load prior state so we can detect a first-time email set and fire the
    // welcome email — OTP signups arrive with no email; this is when they get one.
    const before = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { email: true },
    });

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: { name, ...(email && { email }) },
      select: { id: true, name: true, email: true, phone: true, preferred_language: true, avatar_url: true },
    });

    if (!before?.email && user.email) {
      void sendWelcomeEmail({
        to: user.email,
        name: user.name,
        lang: resolveEmailLang(user.preferred_language),
        webUrl: process.env.WEB_URL ?? 'http://localhost:5199',
      }).catch((err) => console.error('[mail:welcome] send failed', err));
    }

    return success(res, user);
  } catch (err) { next(err); }
});

// Cross-app SSO handoff (/handoff + /redeem) was removed after partner
// dashboard moved into apps/web — same origin now, no need to trade a
// one-time code between apps. The AuthHandoffToken table stays in the
// schema as a safety net; a follow-up migration will drop it once the
// rework is verified in production.

export default router;
