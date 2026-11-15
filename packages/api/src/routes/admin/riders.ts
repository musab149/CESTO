import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { success } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';

const router = Router();

const riderSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(6),
  vehicle_type: z.enum(['moto', 'bicicleta', 'coche']),
  is_active: z.boolean().default(true),
});

const ACTIVE_ORDER_STATUSES = ['confirmed', 'preparing', 'on_the_way'] as const;
const ACTIVE_SUB_DELIVERY_STATUSES = ['confirmed', 'preparing', 'on_the_way'] as const;

router.get('/', asyncHandler(async (req, res) => {
  const { activeOnly } = req.query;
  const riders = await prisma.rider.findMany({
    where: activeOnly === 'true' ? { is_active: true } : undefined,
    include: {
      _count: {
        select: {
          orders: { where: { status: { in: [...ACTIVE_ORDER_STATUSES] } } },
          subscription_deliveries: {
            where: { status: { in: [...ACTIVE_SUB_DELIVERY_STATUSES] } },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  });
  return success(res, riders);
}));

// Subscription deliveries assigned to this rider — ops needs to see rashan
// assignments alongside regular orders on the rider profile.
router.get('/:id/subscription-deliveries', asyncHandler(async (req, res) => {
  const deliveries = await prisma.subscriptionDelivery.findMany({
    where: { rider_id: req.params.id },
    orderBy: { scheduled_date: 'desc' },
    take: 20,
    include: {
      subscription: {
        select: {
          id: true,
          pack: { select: { name_es: true, name_en: true, slug: true } },
          user: { select: { id: true, name: true, phone: true } },
          address: { select: { street_line_1: true, city: true } },
        },
      },
      order: { select: { id: true, order_number: true, status: true } },
    },
  });
  return success(res, deliveries);
}));

router.post('/', validate(riderSchema), asyncHandler(async (req, res) => {
  const created = await prisma.rider.create({ data: req.body });
  return success(res, created, 201);
}));

router.put('/:id', validate(riderSchema), asyncHandler(async (req, res) => {
  const updated = await prisma.rider.update({ where: { id: req.params.id }, data: req.body });
  return success(res, updated);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.rider.update({ where: { id: req.params.id }, data: { is_active: false } });
  return success(res, { message: 'Rider deactivated.' });
}));

export default router;
