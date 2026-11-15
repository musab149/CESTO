import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { validate } from '../../middleware/validate';
import { patchTicketSchema, ticketStatusEnum } from '../../validators/support';

const router = Router();

/**
 * GET /api/admin/support
 * Paginated list with filters. Defaults: 50 per page, newest first.
 *
 *   ?status=new|in_progress|resolved|archived
 *   ?q=substring  (matches name, email, subject, body)
 *   ?page=1
 *   ?limit=50
 *
 * Response also includes per-status counts across the WHOLE table (ignoring
 * the active filter) so the inbox tabs show the global queue size.
 */
router.get('/', asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
  const skip  = (page - 1) * limit;

  const where: Prisma.SupportTicketWhereInput = {};
  const status = req.query.status;
  if (typeof status === 'string' && ticketStatusEnum.safeParse(status).success) {
    where.status = status;
  }
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q) {
    where.OR = [
      { name:    { contains: q, mode: 'insensitive' } },
      { email:   { contains: q, mode: 'insensitive' } },
      { subject: { contains: q, mode: 'insensitive' } },
      { body:    { contains: q, mode: 'insensitive' } },
    ];
  }

  const [items, total, statusCounts] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
    }),
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
  ]);

  const counts = statusCounts.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});

  const totalPages = Math.max(1, Math.ceil(total / limit));
  return success(res, { items, total, page, limit, totalPages, counts });
}));

/** GET /api/admin/support/:id */
router.get('/:id', asyncHandler(async (req, res) => {
  const row = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if (!row) return error(res, 'Ticket not found', 404);
  return success(res, row);
}));

/** PATCH /api/admin/support/:id — update status and/or admin_notes. */
router.patch('/:id', validate(patchTicketSchema), asyncHandler(async (req, res) => {
  const exists = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if (!exists) return error(res, 'Ticket not found', 404);
  const row = await prisma.supportTicket.update({
    where: { id: req.params.id },
    data: req.body as { status?: string; admin_notes?: string | null },
  });
  return success(res, row);
}));

export default router;
