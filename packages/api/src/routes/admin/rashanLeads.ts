import { Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { validate } from '../../middleware/validate';
import {
  patchRashanLeadSchema,
  approveRashanLeadSchema,
  rejectRashanLeadSchema,
  rashanLeadStatusEnum,
  rashanLeadFrequencyEnum,
  type ApproveRashanLeadPayload,
} from '../../validators/rashanLeads';
import {
  OPEN_REQUEST,
  HomeGroceryError,
  approveRequest,
  rejectRequest,
  matchAccounts,
  type RequestAccount,
} from '../../lib/homeGrocery';

const router = Router();

/**
 * The account a request maps to, as the admin sees it. Tells the approve
 * dialog whether approving LINKS an account (password untouched) or OPENS
 * one (credentials emailed), and whether it still needs an address.
 */
function accountView(a: RequestAccount | null | undefined) {
  if (!a) return null;
  return {
    id: a.id,
    name: a.name,
    email: a.email,
    is_business: a.is_business,
    blocked: a.status === 'blocked',
    has_address: a._count.addresses > 0,
  };
}

/**
 * GET /api/admin/rashan-leads
 * Home Grocery requests (the /rashan form).
 *
 *   ?open=true     only requests still waiting on a decision — what the Home
 *                  Grocery tab pins above its subscribers
 *   ?approval=pending_review|approved|rejected
 *   ?status=new|contacted|qualified|converted|closed|archived
 *   ?frequency=weekly|biweekly|every_3_weeks|monthly
 *   ?q=substring  (matches name, phone, email, postcode, city)
 *   ?page=1&limit=50
 *
 * Each item carries `account`: the user it maps to, or null.
 */
router.get('/', asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
  const skip  = (page - 1) * limit;

  const where: Prisma.RashanLeadWhereInput = {};
  // Every clause that needs its own OR goes on AND — the open filter, the
  // search and any later one would otherwise overwrite each other's `OR`.
  const and: Prisma.RashanLeadWhereInput[] = [];
  if (req.query.open === 'true') and.push(OPEN_REQUEST);
  const approval = req.query.approval;
  if (approval === 'pending_review' || approval === 'approved' || approval === 'rejected') {
    where.approval_status = approval;
  }
  const status = req.query.status;
  if (typeof status === 'string' && rashanLeadStatusEnum.safeParse(status).success) {
    where.status = status as Prisma.RashanLeadWhereInput['status'];
  }
  const frequency = req.query.frequency;
  if (typeof frequency === 'string' && rashanLeadFrequencyEnum.safeParse(frequency).success) {
    where.frequency = frequency as Prisma.RashanLeadWhereInput['frequency'];
  }
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q) {
    and.push({
      OR: [
        { name:     { contains: q, mode: 'insensitive' } },
        { phone:    { contains: q, mode: 'insensitive' } },
        { email:    { contains: q, mode: 'insensitive' } },
        { postcode: { contains: q, mode: 'insensitive' } },
        { city:     { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  if (and.length) where.AND = and;

  const [items, total, statusCounts] = await Promise.all([
    prisma.rashanLead.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
    }),
    prisma.rashanLead.count({ where }),
    // Whole-table counts (ignore the active filter) so the status tabs always
    // show the size of the real queue, not the filtered slice.
    prisma.rashanLead.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const counts = statusCounts.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});

  const accounts = await matchAccounts(items);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return success(res, {
    items: items.map((l) => ({ ...l, account: accountView(accounts.get(l.id)) })),
    total, page, limit, totalPages, counts,
  });
}));

/** GET /api/admin/rashan-leads/:id */
router.get('/:id', asyncHandler(async (req, res) => {
  const row = await prisma.rashanLead.findUnique({ where: { id: req.params.id } });
  if (!row) return error(res, 'Rashan lead not found', 404);
  const accounts = await matchAccounts([row]);
  return success(res, { ...row, account: accountView(accounts.get(row.id)) });
}));

/**
 * POST /api/admin/rashan-leads/:id/approve
 * Makes the household a Home Grocery subscriber. Links the account they
 * already have (password untouched) or opens one and emails the login.
 */
router.post('/:id/approve', validate(approveRashanLeadSchema), asyncHandler(async (req, res) => {
  try {
    const result = await approveRequest(
      req.params.id,
      req.body as ApproveRashanLeadPayload,
      req.admin?.adminId ?? null,
    );
    return success(res, result);
  } catch (e) {
    if (e instanceof HomeGroceryError) return error(res, e.message, e.status);
    throw e;
  }
}));

/**
 * POST /api/admin/rashan-leads/:id/reject
 * Turns the request down. The reason reaches the household — in-app when
 * they have an account, by email when they gave one.
 */
router.post('/:id/reject', validate(rejectRashanLeadSchema), asyncHandler(async (req, res) => {
  try {
    const { reason } = req.body as { reason: string };
    const result = await rejectRequest(req.params.id, reason, req.admin?.adminId ?? null);
    return success(res, result);
  } catch (e) {
    if (e instanceof HomeGroceryError) return error(res, e.message, e.status);
    throw e;
  }
}));

/**
 * PATCH /api/admin/rashan-leads/:id — status and/or notes.
 * Moving to `converted` stamps converted_at so the ops report can measure
 * form→subscription lag without a separate audit table. Moving back off
 * `converted` clears it, so a mis-click doesn't leave a phantom timestamp.
 */
router.patch('/:id', validate(patchRashanLeadSchema), asyncHandler(async (req, res) => {
  const exists = await prisma.rashanLead.findUnique({ where: { id: req.params.id } });
  if (!exists) return error(res, 'Rashan lead not found', 404);

  const body = req.body as { status?: string; notes?: string | null };
  const data: Prisma.RashanLeadUpdateInput = {};
  if (body.status !== undefined) {
    data.status = body.status as Prisma.RashanLeadUpdateInput['status'];
    if (body.status === 'converted' && !exists.converted_at) {
      data.converted_at = new Date();
    } else if (body.status !== 'converted' && exists.converted_at) {
      data.converted_at = null;
    }
  }
  if (body.notes !== undefined) data.notes = body.notes;

  const row = await prisma.rashanLead.update({ where: { id: req.params.id }, data });
  return success(res, row);
}));

export default router;
