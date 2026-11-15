import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { success } from '../lib/response';

const router = Router();

// ─── GET /api/banners?zone= ─────────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();

    const banners = await prisma.banner.findMany({
      where: {
        is_active: true,
        OR: [
          { active_from: null, active_until: null },
          { active_from: { lte: now }, active_until: { gte: now } },
          { active_from: { lte: now }, active_until: null },
          { active_from: null, active_until: { gte: now } },
        ],
      },
      orderBy: { display_order: 'asc' },
    });

    return success(res, banners);
  } catch (err) { next(err); }
});

export default router;
