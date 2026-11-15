import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { verifyAccessToken, TokenPayload } from '../lib/jwt';
import { error } from '../lib/response';
import { REP_STORE_SELECT, repStoreFrom, type RepStore } from '../lib/repStore';

/**
 * Sales rep middleware, built the same way as partnerAuth.
 *
 * A rep is a regular customer User carrying a SalesRep row. They authenticate
 * with the ORDINARY customer JWT — the same secret and shape as any other
 * user request — and the role is looked up on top. There is no rep login, no
 * rep token and no rep password, for the same reason there is no partner one
 * any more: a person who is a rep AND a customer AND runs a shop is one
 * account with three roles, not three accounts.
 *
 * That is also what makes the planned rep tablet app cheap. It signs in
 * through `/api/auth/login-email` like everything else and calls
 * `/api/sales/*` with the token it already has.
 *
 * SCOPE IS THE SECURITY BOUNDARY, not the UI. A rep's restrictions come from
 * `/api/sales/*` exposing only what a rep may do — there is no product
 * deletion or payout endpoint there to reach. Nothing is enforced by hiding a
 * button, which is exactly the trap the admin panel is in: 177 endpoints
 * behind 11 role guards.
 */

export interface SalesRepContext {
  user: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    avatar_url: string | null;
    preferred_language: 'es' | 'en';
    password_is_temp: boolean;
  };
  rep: {
    code: string | null;
    granted_at: Date;
    /** The shops they sell from, resolved once here (lib/repStore). */
    store: RepStore;
  };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      salesRep?: SalesRepContext;
    }
  }
}

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  avatar_url: true,
  preferred_language: true,
  password_is_temp: true,
  status: true,
} as const;

/**
 * Authenticate, then require an ACTIVE sales rep role.
 *
 * Revoking a rep is `is_active = false` rather than deleting the row, so the
 * orders and accounts they created still resolve. This is where that takes
 * effect: an inactive rep authenticates fine as a customer and is refused
 * here, which is the right shape — they have not lost their account, only the
 * job.
 */
export function requireSalesRep() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      error(res, 'Authentication required.', 401);
      return;
    }
    let payload: TokenPayload;
    try {
      payload = verifyAccessToken(header.slice(7));
    } catch {
      error(res, 'Invalid or expired token.', 401);
      return;
    }

    // Caught and handed on: Express 4 does not catch a rejected async
    // middleware, so a database error here — a blip, or the API deployed
    // before its migration ran, as on staging 2026-10-26 — crashed the whole
    // API for everyone instead of failing this request.
    let user;
    try {
      user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          ...USER_SELECT,
          sales_rep_profile: {
            select: { code: true, is_active: true, granted_at: true, ...REP_STORE_SELECT },
          },
        },
      });
    } catch (err) {
      next(err);
      return;
    }

    // A blocked account is refused before the role is even considered: the
    // reason they cannot work is that they cannot log in, not that they are
    // not a rep, and the message should not imply otherwise.
    if (!user || user.status !== 'active') {
      error(res, 'Account is inactive.', 401);
      return;
    }

    const profile = user.sales_rep_profile;
    if (!profile || !profile.is_active) {
      error(res, 'This account is not an active sales rep.', 403);
      return;
    }

    req.salesRep = {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatar_url: user.avatar_url,
        preferred_language: (user.preferred_language ?? 'es') as 'es' | 'en',
        password_is_temp: user.password_is_temp,
      },
      rep: { code: profile.code, granted_at: profile.granted_at, store: repStoreFrom(profile) },
    };
    next();
  };
}
