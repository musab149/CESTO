import { Router } from 'express';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { asyncHandler } from '../lib/async';
import { defaultFor, HOME_SECTION_KEYS, type HomeSectionKey } from '../lib/homeSectionsDefaults';

const router = Router();

function isValidKey(key: string): key is HomeSectionKey {
  return (HOME_SECTION_KEYS as readonly string[]).includes(key);
}

/**
 * GET /api/home-sections/:key
 * Returns the JSON config for one section. Falls back to the baked-in
 * defaults if no row exists yet — clients never get a 404 here.
 */
router.get('/:key', asyncHandler(async (req, res) => {
  const key = req.params.key;
  if (!isValidKey(key)) {
    return error(res, `Unknown home section: ${key}`, 404);
  }
  const row = await prisma.homeSection.findUnique({ where: { key } });
  if (row) {
    return success(res, {
      ...(row.config as Record<string, unknown>),
      updated_at: row.updated_at.toISOString(),
    });
  }
  return success(res, defaultFor(key));
}));

export default router;
