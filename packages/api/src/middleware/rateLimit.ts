import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { error } from '../lib/response';

// express-rate-limit ships with its own @types/express-serve-static-core, so
// its RequestHandler is nominally different from the one our routes use.
// Handlers and keyGenerator take `any` req to sidestep the duplicated Request
// type, and we cast the final middleware to our Express RequestHandler at
// export time (same trick as the multer wrappers in uploads routes).
const asHandler = (h: unknown) => h as RequestHandler;

// All limiters key on IP. `app.set('trust proxy', 1)` in server.ts ensures
// req.ip is the real client IP behind Render's reverse proxy, not the proxy.

const jsonHandler = (message: string) => (_req: any, res: any) => {
  error(res, message, 429);
};

// Password-style endpoints: /auth/login-email, /auth/google, /admin/auth/login.
// Session renewal used to share this counter, so twenty sign-ins or renewals
// from one address in fifteen minutes — an office on one wifi, a mobile
// network putting many phones behind one IP — refused everyone's renewal,
// and a refused renewal signed them out.
export const authLoginLimiter = asHandler(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Too many attempts. Please try again in a few minutes.'),
}));

// Session renewal: /auth/refresh-token, /admin/auth/refresh-token. Its own
// counter, and a roomy one. A refresh token is a long random secret, so
// there is nothing to guess and the limit only stops flooding; every
// signed-in person renews about every quarter of an hour, and many of them
// can share one address.
export const authRefreshLimiter = asHandler(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Too many attempts. Please try again in a few minutes.'),
}));

// Registration: costlier to create accounts than to attempt login, keep tight.
export const authRegisterLimiter = asHandler(rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Too many sign-up attempts. Please try again later.'),
}));

// OTP send/verify. Also keyed by phone via `keyGenerator` when the body has
// one, so one attacker IP can't exhaust the pool for a specific phone.
export const otpLimiter = asHandler(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => {
    const body = req.body ?? {};
    const phone = typeof body.phone === 'string' ? body.phone : '';
    const cc = typeof body.countryCode === 'string' ? body.countryCode : '';
    // ipKeyGenerator handles IPv6 correctly (collapses /64).
    return `${ipKeyGenerator(req.ip ?? '')}:${cc}${phone}`;
  },
  handler: jsonHandler('Too many OTP requests. Please wait a few minutes.'),
}));

// Password reset request + submission. Tight window since a compromised email
// account can otherwise be brute-forced for a reset window.
export const passwordResetLimiter = asHandler(rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler('Too many password reset requests. Please try again later.'),
}));

// A rep finding a client by email (/api/sales/clients/find, 2026-10-28). Keyed
// by the REP, not the address: the exact-email match is what keeps a rep's
// device from reading the customer base, and this is what keeps that match
// from being tried a few thousand times. A rep looking somebody up while they
// talk to them needs a handful an hour, not thirty in a quarter.
export const repFindClientLimiter = asHandler(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => `rep-find:${req.salesRep?.user?.id ?? ipKeyGenerator(req.ip ?? '')}`,
  handler: (_req: any, res: any) => error(res, 'Too many searches. Please wait a few minutes.', 429, { code: 'rep_find_limited' }),
}));
