import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { verifyAccessToken, TokenPayload } from '../lib/jwt';
import { error } from '../lib/response';

/**
 * Post-unified-identity partner middleware.
 *
 * A partner is a regular customer User with one or more PartnerStoreRole
 * rows attached. We authenticate via the standard customer JWT (same
 * secret, same shape as any other user request), then load the user's
 * active partner roles. If they have none, the request is rejected as
 * "not a partner" (403).
 *
 * The middleware attaches `req.partnerRole` with the resolved user,
 * their active role for the target store, and the store row. A
 * downstream route handler can trust these are all live.
 *
 * When a store_id is supplied (via req.params, req.body, or by the
 * caller wiring `requirePartnerRole('owner', () => storeId)`), the
 * middleware also enforces that the role belongs to THAT store —
 * critical so a manager for store A can't hit endpoints scoped to
 * store B just because they have the JWT.
 */

export interface PartnerRoleContext {
  user: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    avatar_url: string | null;
    preferred_language: 'es' | 'en';
    password_is_temp: boolean;
  };
  role: 'owner' | 'manager';
  store: {
    id: string;
    slug: string;
    name: string;
    logo_url: string | null;
    logo_bg: string | null;
    is_verified: boolean;
    status: 'draft' | 'live' | 'paused' | 'suspended';
    contact_email: string | null;
    contact_phone: string | null;
  };
}

declare global {
  namespace Express {
    interface Request {
      partnerRole?: PartnerRoleContext;
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

const STORE_SELECT = {
  id: true,
  slug: true,
  name: true,
  logo_url: true,
  logo_bg: true,
  is_verified: true,
  status: true,
  contact_email: true,
  contact_phone: true,
  deleted_at: true,
  deletion_scheduled_at: true,
} as const;

/**
 * Authenticate + verify partner role. If `storeIdResolver` is supplied,
 * the resolved role must belong to that store. Otherwise the middleware
 * picks the user's FIRST active partner role (order not guaranteed —
 * meaningful only when the user has exactly one partner store, which is
 * the Slice 2 assumption; multi-store support comes in a later slice).
 */
export function requirePartnerRole(
  requiredRole: 'owner' | 'manager' | null = null,
  storeIdResolver?: (req: Request) => string | undefined,
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // 1. Verify the customer JWT.
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

    // 2. Load the user + all their active partner roles in one query.
    //    Caught and handed on: Express 4 does not catch a rejected async
    //    middleware, so a database error here (a blip, or a deploy whose
    //    migration has not run yet) crashed the whole API for everyone.
    let user;
    try {
      user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          ...USER_SELECT,
          partner_roles: {
            where: { is_active: true },
            select: {
              role:     true,
              store_id: true,
              store: { select: STORE_SELECT },
            },
          },
        },
      });
    } catch (err) {
      next(err);
      return;
    }

    if (!user || user.status !== 'active') {
      error(res, 'Account is inactive.', 401);
      return;
    }
    const rolesRaw = user.partner_roles;
    if (rolesRaw.length === 0) {
      error(res, 'No partner store linked to this account.', 403);
      return;
    }

    // 3. Pick the target role — either the one matching storeIdResolver's
    //    output, or the first role if the caller didn't specify.
    const targetStoreId = storeIdResolver?.(req);
    const chosen = targetStoreId
      ? rolesRaw.find((r) => r.store_id === targetStoreId)
      : rolesRaw[0];
    if (!chosen) {
      error(res, 'You are not a partner for this store.', 403);
      return;
    }
    if (requiredRole && chosen.role !== requiredRole && chosen.role !== 'owner') {
      error(res, `This action requires the ${requiredRole} role.`, 403);
      return;
    }

    // 4. Reject suspended / soft-deleted stores. Draft is allowed so a
    //    newly-approved partner can still see their dashboard.
    if (chosen.store.deleted_at) {
      error(res, 'Store no longer exists.', 401);
      return;
    }
    if (chosen.store.status === 'suspended') {
      error(res, 'Store is suspended. Contact support.', 403);
      return;
    }

    // Strip the fields we don't want to leak downstream.
    const { deleted_at: _d, deletion_scheduled_at: _ds, ...safeStore } = chosen.store;
    const { status: _s, ...safeUser } = user;

    req.partnerRole = {
      user:  safeUser,
      role:  chosen.role,
      store: safeStore,
    };
    next();
  };
}

/**
 * Assertion helper for partner-scoped mutation endpoints. Call after fetching
 * the resource by id — throws E_FORBIDDEN when its store_id doesn't match the
 * partner's own store. Prevents ID-tampering attacks where a partner sends
 * a PATCH for a resource that isn't theirs.
 *
 * Throws a plain error the route's outer catch can convert to 404 (we return
 * 404 rather than 403 so the partner can't enumerate other stores' resources).
 */
export class ForbiddenResourceError extends Error {
  constructor() { super('E_FORBIDDEN'); this.name = 'ForbiddenResourceError'; }
}

export function assertOwnStore(
  resource: { store_id: string | null | undefined } | null,
  partnerStoreId: string,
): void {
  if (!resource || resource.store_id !== partnerStoreId) {
    throw new ForbiddenResourceError();
  }
}
