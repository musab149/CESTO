import { Router } from 'express';
import { success } from '../lib/response';
import { asyncHandler } from '../lib/async';
import { readAppContent } from '../lib/appContent';

const router = Router();

/**
 * GET /api/app-content
 *
 * Editorial copy for the apps: onboarding, About, the Rashan landing page and
 * the home value ribbon. Never 404s and never returns a partial object — an
 * unset key or a row saved before a section existed both come back filled from
 * the defaults, because the caller is often a phone that cannot be hotfixed.
 */
router.get('/', asyncHandler(async (_req, res) => {
  return success(res, await readAppContent());
}));

export default router;
