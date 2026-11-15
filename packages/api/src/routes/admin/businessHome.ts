import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/adminAuth';
import { readBusinessHome } from '../../lib/businessHome';
import { businessHomeSchema } from '../../validators/businessHome';
import { BUSINESS_HOME_KEY, DEFAULT_BUSINESS_HOME } from '../../lib/businessHomeDefaults';

/** Admin → Business home: the content of a business's panel home (see lib/businessHomeDefaults). */
const router = Router();

/** GET /api/admin/business-home — everything, switched-off and past items too. */
router.get('/', asyncHandler(async (_req, res) => {
  return success(res, await readBusinessHome());
}));

/**
 * PUT /api/admin/business-home
 *
 * The whole object, as App content saves: the editor always holds a complete
 * copy, and merging partials from two open tabs is how admins overwrite each other.
 */
router.put('/', validate(businessHomeSchema), asyncHandler(async (req, res) => {
  const config = req.body as Prisma.InputJsonValue;
  const row = await prisma.appSetting.upsert({
    where: { key: BUSINESS_HOME_KEY },
    create: { key: BUSINESS_HOME_KEY, config },
    update: { config },
  });
  return success(res, row.config);
}));

/** POST /api/admin/business-home/reset — back to the shipped copy. super_admin only: it discards the team's work with no undo. */
router.post('/reset', requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const config = DEFAULT_BUSINESS_HOME as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: BUSINESS_HOME_KEY },
    create: { key: BUSINESS_HOME_KEY, config },
    update: { config },
  });
  return success(res, DEFAULT_BUSINESS_HOME);
}));

export default router;
