import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../lib/jwt';
import { error } from '../lib/response';
import prisma from '../lib/prisma';

/**
 * Sent to a client that must end its session and explain why. A plain 403
 * is indistinguishable from "you cannot do that particular thing", which is
 * why blocking someone used to leave them browsing normally until their
 * access token expired, with nothing on screen to say what had happened.
 */
export const ACCOUNT_BLOCKED = 'account_blocked';

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * Requires a valid JWT, and an account that is still allowed to use it.
 *
 * The status check costs one primary-key read per authenticated request. It
 * is worth it: a JWT is a bearer token with a 15-minute life, so without this
 * a blocked customer keeps shopping — and checking out — for up to fifteen
 * minutes after an admin blocks them. Refresh already refused them, which
 * only meant the session died quietly later with no explanation.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
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

  try {
    const account = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { status: true, blocked_reason: true },
    });

    // A token for a user row that no longer exists — erased account, restored
    // database. Treat as signed out rather than 500.
    if (!account) {
      error(res, 'Authentication required.', 401);
      return;
    }

    if (account.status === 'blocked') {
      error(res, 'Your account has been blocked.', 403, {
        code: ACCOUNT_BLOCKED,
        reason: account.blocked_reason,
      });
      return;
    }
  } catch {
    // The database is unreachable. Failing closed would sign every customer
    // out over a blip; the token is still cryptographically valid, so let it
    // through and let the route's own query surface the outage.
    req.user = payload;
    next();
    return;
  }

  req.user = payload;
  next();
}

/** Attaches user to req if token present, but doesn't reject. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      req.user = verifyAccessToken(header.slice(7));
    } catch {
      // ignore invalid tokens for optional auth
    }
  }
  next();
}
