import { Request, Response, NextFunction } from 'express';
import type { AdminRole } from '@prisma/client';
import { verifyAdminAccessToken, AdminTokenPayload } from '../lib/jwt';
import { error } from '../lib/response';

declare global {
  namespace Express {
    interface Request {
      admin?: AdminTokenPayload;
    }
  }
}

/** Requires a valid admin JWT. Rejects with 401 if missing or invalid. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    error(res, 'Admin authentication required.', 401);
    return;
  }
  try {
    req.admin = verifyAdminAccessToken(header.slice(7));
    next();
  } catch {
    error(res, 'Invalid or expired admin token.', 401);
  }
}

/**
 * A temporary password is changed before anything else is done with it.
 *
 * The password was chosen by whoever created or reset the account, so until its
 * owner picks their own, two people can sign in as them. The way out,
 * /api/admin/auth/change-password, is mounted ahead of this with sign-in and /me.
 * Use after requireAdmin.
 */
export function requireOwnPassword(req: Request, res: Response, next: NextFunction): void {
  if (req.admin?.mustChange) {
    error(res, 'Choose your own password before continuing.', 403, { code: 'password_change_required' });
    return;
  }
  next();
}

/**
 * A lawyer reaches the document archive and nothing else.
 *
 * In one place and deny by default, rather than a role check on each of the
 * hundred-odd admin routes: most have none, because every other role may read
 * them, so a new route is open to a lawyer unless this says otherwise. Their
 * own sign-in and `/me` live under /api/admin/auth, ahead of this. Use after
 * requireAdmin; `req.path` is relative to the /api/admin mount.
 */
export function confineLawyers(req: Request, res: Response, next: NextFunction): void {
  if (req.admin?.role === 'lawyer' && req.path !== '/documents' && !req.path.startsWith('/documents/')) {
    error(res, 'You do not have permission to perform this action.', 403);
    return;
  }
  next();
}

/** Restricts a route to specific admin roles. Use after requireAdmin. */
export function requireRole(...roles: AdminRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      error(res, 'Admin authentication required.', 401);
      return;
    }
    if (req.admin.role !== 'super_admin' && !roles.includes(req.admin.role)) {
      error(res, 'You do not have permission to perform this action.', 403);
      return;
    }
    next();
  };
}
