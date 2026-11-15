import { Router } from 'express';
import { success } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { publishedBusinessHome, readBusinessHome } from '../../lib/businessHome';

/**
 * GET /api/business/home — the content of the panel's home (2026-10-31): the
 * intro, promotions, Cesto logistics, the banners and Cesto's
 * announcements, as the team wrote them in Admin → Business home. Only what is
 * live goes out (lib/businessHome publishedBusinessHome). Behind
 * requireBusiness rather than public, since B2B offers are for businesses.
 */
const router = Router();

router.get('/', asyncHandler(async (_req, res) => {
  return success(res, publishedBusinessHome(await readBusinessHome()));
}));

export default router;
