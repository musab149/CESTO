import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { geocodeAddress, addressToQuery } from '../lib/geocode';

const router = Router();
router.use(requireAuth);

// Postcode stays a 5-digit Spanish code, but it is no longer checked against
// anything. It used to be matched to a DeliveryZone, and an address that
// matched none was refused at checkout; coverage is not modelled any more, so
// the postcode is part of the address and nothing else.
const addressSchema = z.object({
  contact_name: z.string().min(1).max(100),
  contact_phone: z.string().min(6).max(20),
  street_line_1: z.string().min(1).max(200),
  street_line_2: z.string().max(200).optional(),
  postcode: z.string().regex(/^\d{5}$/, 'Must be a 5-digit Spanish postcode'),
  city: z.string().min(1).max(100),
  province: z.string().min(1).max(100),
  delivery_notes: z.string().max(200).optional(),
});

const addressSelect = {
  id: true, contact_name: true, contact_phone: true,
  street_line_1: true, street_line_2: true, postcode: true,
  city: true, province: true, delivery_notes: true,
  is_default: true,
};

/**
 * Resolve coordinates for an address being saved, so delivery can be priced
 * by distance from it.
 *
 * Done here rather than only at quote time so the customer waits for the
 * geocoder on the address form — where a moment's delay is expected — instead
 * of at checkout. It is only a head start, not a requirement: a null result
 * is stored as-is and the first delivery quote retries it
 * (lib/address-geocoding.ts). So a geocoder outage costs a customer the flat
 * fee at worst, and never a rejected address.
 *
 * The returned patch always sets all four columns. On an edit that matters:
 * a customer correcting their street must not keep the coordinates of the
 * old one, which is exactly the sort of silent mispricing this is meant to
 * avoid.
 */
async function geocodePatch(body: z.infer<typeof addressSchema>) {
  const point = await geocodeAddress(addressToQuery(body));
  return point
    ? {
        latitude: point.lat,
        longitude: point.lng,
        geocoded_at: new Date(),
        geocode_failed_at: null,
      }
    : {
        latitude: null,
        longitude: null,
        geocoded_at: null,
        // Left null rather than stamped: this was not the retry-limited
        // lazy path, so the next quote is free to try again immediately.
        geocode_failed_at: null,
      };
}

// ─── GET /api/users/addresses ───────────────────────────

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    const addresses = await prisma.address.findMany({
      where: { user_id: userId },
      select: addressSelect,
      orderBy: { is_default: 'desc' },
    });
    return success(res, addresses);
  } catch (err) { next(err); }
});

// ─── POST /api/users/addresses ──────────────────────────

router.post('/', validate(addressSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    // Check if user has any addresses — first one becomes default
    const count = await prisma.address.count({ where: { user_id: userId } });
    const isDefault = count === 0;

    const address = await prisma.address.create({
      data: {
        ...req.body,
        ...(await geocodePatch(req.body)),
        user_id: userId,
        is_default: isDefault,
      },
      select: addressSelect,
    });

    return success(res, address, 201);
  } catch (err) { next(err); }
});

// ─── PUT /api/users/addresses/:id ───────────────────────

router.put('/:id', validate(addressSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const address = await prisma.address.updateMany({
      where: { id: req.params.id, user_id: req.user!.userId },
      data: { ...req.body, ...(await geocodePatch(req.body)) },
    });

    if (address.count === 0) return error(res, 'Address not found.', 404);

    const updated = await prisma.address.findUnique({
      where: { id: req.params.id },
      select: addressSelect,
    });

    return success(res, updated);
  } catch (err) { next(err); }
});

// ─── DELETE /api/users/addresses/:id ────────────────────

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const address = await prisma.address.findFirst({
      where: { id: req.params.id, user_id: req.user!.userId },
    });

    if (!address) return error(res, 'Address not found.', 404);
    // A Home Grocery plan delivers here: the database would refuse the delete
    // anyway, but with a constraint name instead of something to do.
    const plan = await prisma.rashanSubscription.count({
      where: { address_id: address.id, status: { not: 'cancelled' } },
    });
    if (plan > 0) {
      return error(res, 'Your Home Grocery plan delivers to this address. Choose another address for your plan first.', 409);
    }
    if (address.is_default) {
      const otherCount = await prisma.address.count({
        where: { user_id: req.user!.userId, id: { not: req.params.id } },
      });
      if (otherCount === 0) return error(res, 'Cannot delete your only address. Add another first.', 400);
    }

    await prisma.address.delete({ where: { id: req.params.id } });

    // If deleted was default, set another as default
    if (address.is_default) {
      const next_ = await prisma.address.findFirst({ where: { user_id: req.user!.userId } });
      if (next_) await prisma.address.update({ where: { id: next_.id }, data: { is_default: true } });
    }

    return success(res, { message: 'Address deleted.' });
  } catch (err) { next(err); }
});

// ─── PUT /api/users/addresses/:id/default ───────────────

router.put('/:id/default', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const address = await prisma.address.findFirst({
      where: { id: req.params.id, user_id: userId },
    });
    if (!address) return error(res, 'Address not found.', 404);

    // Unset all defaults, then set this one
    await prisma.address.updateMany({ where: { user_id: userId }, data: { is_default: false } });
    await prisma.address.update({ where: { id: req.params.id }, data: { is_default: true } });

    return success(res, { message: 'Default address updated.' });
  } catch (err) { next(err); }
});

export default router;
