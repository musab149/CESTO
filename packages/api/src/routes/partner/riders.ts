import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { assertOwnStore, ForbiddenResourceError } from '../../middleware/partnerAuth';

const router = Router();

// Same shape as admin's riderSchema. store_id + is_test are model-level
// fields the partner never sets by hand — forced from the JWT + defaults.
// Slice 6 adds SMS-invite → rider app onboarding; here it's a bare
// "add rider row" so the store can start assigning deliveries.
const riderSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(6),
  vehicle_type: z.enum(['moto', 'bicicleta', 'coche']),
  is_active: z.boolean().default(true),
});

const ACTIVE_ORDER_STATUSES = ['confirmed', 'preparing', 'on_the_way'] as const;

router.get('/', asyncHandler(async (req, res) => {
  const { activeOnly } = req.query;
  const where = {
    store_id: req.partnerRole!.store.id,
    ...(activeOnly === 'true' ? { is_active: true } : {}),
  };
  const riders = await prisma.rider.findMany({
    where,
    include: {
      _count: {
        select: {
          orders: { where: { status: { in: [...ACTIVE_ORDER_STATUSES] } } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });
  return success(res, riders);
}));

router.post('/', validate(riderSchema), asyncHandler(async (req, res) => {
  const created = await prisma.rider.create({
    data: {
      ...(req.body as z.infer<typeof riderSchema>),
      store_id: req.partnerRole!.store.id,
      // Slice 7 cleanup marker — partner-created rows are is_test until we
      // remove the flag (or the partner flips to live via admin).
      is_test:  true,
    },
  });
  return success(res, created, 201);
}));

router.put('/:id', validate(riderSchema), asyncHandler(async (req, res) => {
  const existing = await prisma.rider.findUnique({
    where: { id: req.params.id }, select: { store_id: true },
  });
  try {
    assertOwnStore(existing, req.partnerRole!.store.id);
  } catch (e) {
    if (e instanceof ForbiddenResourceError) return error(res, 'Rider not found.', 404);
    throw e;
  }
  // store_id NOT in the update — can't reassign to another store.
  const updated = await prisma.rider.update({ where: { id: req.params.id }, data: req.body });
  return success(res, updated);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.rider.findUnique({
    where: { id: req.params.id }, select: { store_id: true },
  });
  try {
    assertOwnStore(existing, req.partnerRole!.store.id);
  } catch (e) {
    if (e instanceof ForbiddenResourceError) return error(res, 'Rider not found.', 404);
    throw e;
  }
  await prisma.rider.update({ where: { id: req.params.id }, data: { is_active: false } });
  return success(res, { message: 'Rider deactivated.' });
}));

export default router;
