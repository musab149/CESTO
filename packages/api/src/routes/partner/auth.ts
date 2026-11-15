import { Router, Request, Response } from 'express';
import { error } from '../../lib/response';

/**
 * The dedicated partner auth surface was retired in the unified-identity
 * rework. Partners now log in via the customer auth endpoints
 * (`/api/auth/login-email`, `/api/auth/refresh-token`, etc.) and the same
 * JWT is used to access `/api/partner/*` routes.
 *
 * We keep this router mounted at `/api/partner/auth` and return 410 Gone
 * so any stale admin bundle mid-deploy sees a legible error instead of
 * a 404 that reads as "site is broken". Removed in a follow-up slice.
 */

const router = Router();

function gone(_req: Request, res: Response): void {
  error(res, 'This endpoint has moved. Partners now log in via /api/auth/login-email.', 410);
}

router.post('/login',           gone);
router.post('/refresh-token',   gone);
router.post('/change-password', gone);
router.post('/logout',          gone);

export default router;
