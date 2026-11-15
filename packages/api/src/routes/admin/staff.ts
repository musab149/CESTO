import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { requireRole } from '../../middleware/adminAuth';
import { parsePage, paged } from '../../lib/pagination';
import { generateTempPassword } from '../../lib/credentials';

const router = Router();

/**
 * Staff accounts — the people who log into this panel.
 *
 * EVERY ROUTE IS super_admin. These rows are the panel's own access control:
 * an ops admin who could create a super_admin, or flip their own role, would
 * make the role column decorative. The guard is per-route rather than
 * router-wide so each one says so where it is read.
 *
 * `password_hash` is never selected, anywhere, including by id.
 */
const SAFE_SELECT = {
  id: true, name: true, email: true, role: true, is_active: true,
  last_login_at: true, password_changed_at: true, created_at: true,
} as const;

// ─── GET /api/admin/staff ───────────────────────────────

router.get('/', requireRole('super_admin'), asyncHandler(async (req, res) => {
  const params = parsePage(req.query, 20, 100);
  const { q, role, status } = req.query as Record<string, string | undefined>;

  const where: Prisma.AdminWhereInput = {};
  if (role === 'super_admin' || role === 'ops' || role === 'catalog' || role === 'lawyer') where.role = role;
  if (status === 'active') where.is_active = true;
  if (status === 'disabled') where.is_active = false;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.admin.findMany({
      where,
      select: SAFE_SELECT,
      orderBy: [{ is_active: 'desc' }, { created_at: 'desc' }],
      skip: params.skip,
      take: params.limit,
    }),
    prisma.admin.count({ where }),
  ]);

  return success(res, paged(items, total, params));
}));

// ─── POST /api/admin/staff ──────────────────────────────

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  role: z.enum(['super_admin', 'ops', 'catalog', 'lawyer']),
}).strict();

router.post('/', requireRole('super_admin'), validate(createSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof createSchema>;
  const email = body.email.toLowerCase();

  // Generated, never chosen by the creator. A password someone else picked is
  // one they also know, and `password_changed_at: null` is already the signal
  // the login flow uses to force a rotation on first use.
  const tempPassword = generateTempPassword(14);

  try {
    const admin = await prisma.admin.create({
      data: {
        name: body.name,
        email,
        role: body.role,
        password_hash: await bcrypt.hash(tempPassword, 12),
        password_changed_at: null,
      },
      select: SAFE_SELECT,
    });
    // Returned ONCE, in the create response, because there is no mail path for
    // staff and the super admin has to be able to hand it over.
    return success(res, { admin, temp_password: tempPassword }, 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return error(res, 'A staff account with that email already exists.', 409);
    }
    throw err;
  }
}));

// ─── PUT /api/admin/staff/:id ───────────────────────────

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(['super_admin', 'ops', 'catalog', 'lawyer']).optional(),
  is_active: z.boolean().optional(),
}).strict();

/**
 * Email is absent on purpose: it is the login identity, and changing it is
 * indistinguishable from handing the account to someone else. Create a new
 * account and disable this one.
 */
router.put('/:id', requireRole('super_admin'), validate(updateSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof updateSchema>;
  const self = req.admin?.adminId;

  // You cannot demote or disable yourself. Not paternalism: there may be one
  // super admin, and locking the last one out of the panel is unrecoverable
  // from inside it.
  if (self === req.params.id) {
    if (body.role && body.role !== 'super_admin') {
      return error(res, 'You cannot change your own role.', 409);
    }
    if (body.is_active === false) {
      return error(res, 'You cannot disable your own account.', 409);
    }
  }

  // The same applies to the last one standing, whoever is asking.
  if (body.role !== undefined || body.is_active === false) {
    const target = await prisma.admin.findUnique({
      where: { id: req.params.id },
      select: { role: true, is_active: true },
    });
    if (!target) return error(res, 'Staff account not found.', 404);

    const losingTheLastSuperAdmin = target.role === 'super_admin' && target.is_active
      && ((body.role !== undefined && body.role !== 'super_admin') || body.is_active === false);
    if (losingTheLastSuperAdmin) {
      const others = await prisma.admin.count({
        where: { role: 'super_admin', is_active: true, id: { not: req.params.id } },
      });
      if (others === 0) {
        return error(res, 'This is the only active super admin. Promote someone else first.', 409);
      }
    }
  }

  try {
    const admin = await prisma.admin.update({
      where: { id: req.params.id },
      data: body,
      select: SAFE_SELECT,
    });
    return success(res, admin);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return error(res, 'Staff account not found.', 404);
    }
    throw err;
  }
}));

// ─── POST /api/admin/staff/:id/reset-password ───────────

router.post('/:id/reset-password', requireRole('super_admin'), asyncHandler(async (req, res) => {
  const tempPassword = generateTempPassword(14);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.admin.update({
        where: { id: req.params.id },
        data: {
          password_hash: await bcrypt.hash(tempPassword, 12),
          // Forces a rotation at next login, same as a seeded row.
          password_changed_at: null,
        },
      });
      // Every existing session dies with the password. Leaving them live would
      // mean a reset locks nobody out, which is the point of resetting.
      await tx.adminRefreshToken.deleteMany({ where: { admin_id: req.params.id } });
    });
    return success(res, { temp_password: tempPassword });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return error(res, 'Staff account not found.', 404);
    }
    throw err;
  }
}));

export default router;
