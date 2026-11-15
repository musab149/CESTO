import { Router } from 'express';
import prisma from '../../lib/prisma';
import { success } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { validate } from '../../middleware/validate';
import { requireRole } from '../../middleware/adminAuth';
import { readAppContent } from '../../lib/appContent';
import { appContentSchema } from '../../validators/appContent';
import { APP_CONTENT_KEY, DEFAULT_APP_CONTENT } from '../../lib/appContentDefaults';
import { Prisma } from '@prisma/client';

const router = Router();

/** GET /api/admin/app-content — what the editor loads. Same shape as public. */
router.get('/', asyncHandler(async (_req, res) => {
  return success(res, await readAppContent());
}));

/**
 * PUT /api/admin/app-content
 *
 * Stores the whole object. Partial saves are deliberately not supported: the
 * editor always holds a complete copy, and merging partials from several open
 * tabs is how two admins quietly overwrite each other.
 */
router.put('/', validate(appContentSchema), asyncHandler(async (req, res) => {
  const config = req.body as Prisma.InputJsonValue;
  const row = await prisma.appSetting.upsert({
    where: { key: APP_CONTENT_KEY },
    create: { key: APP_CONTENT_KEY, config },
    update: { config },
  });
  return success(res, row.config);
}));

/**
 * POST /api/admin/app-content/reset
 *
 * Back to the shipped copy. super_admin only: this discards editorial work
 * with no undo, which is a different weight of action from saving over it.
 */
router.post('/reset', requireRole('super_admin'), asyncHandler(async (_req, res) => {
  const config = DEFAULT_APP_CONTENT as unknown as Prisma.InputJsonValue;
  await prisma.appSetting.upsert({
    where: { key: APP_CONTENT_KEY },
    create: { key: APP_CONTENT_KEY, config },
    update: { config },
  });
  return success(res, DEFAULT_APP_CONTENT);
}));

export default router;
