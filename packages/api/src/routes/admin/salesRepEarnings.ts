import { Router, type Request, type Response } from 'express';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/async';
import { requireRole } from '../../middleware/adminAuth';
import { notifyRepEarning } from '../../lib/notifications';
import {
  EarningError, changedSinceApproval, adjustmentSchema, entryDetail, historyFor, openOrdersFor, payoutSchema, reconcileRep, recordAdjustment,
  recordPayout, totalsFor, voidPayout, voidSchema,
} from '../../lib/repEarnings';

/**
 * A sales rep's earnings, from the admin's side (lib/repEarnings). Mounted
 * under /api/admin/sales-reps/:userId/earnings. Each order's earning is
 * approved on the order (routes/admin/orders); this is the rep's balance,
 * its history, and the payments and adjustments that move it.
 *
 * Reading is any admin's, as the rep profile it sits on is; writing is a
 * super admin's, like hiring and assigning shops — it decides what someone
 * is paid.
 */

const router = Router({ mergeParams: true });

const repIdOf = (req: Request) => (req.params as { userId: string }).userId;
const adminIdOf = (req: Request) => req.admin?.adminId ?? null;

async function repOf(userId: string) {
  return prisma.salesRep.findUnique({
    where: { user_id: userId },
    select: { user_id: true, commission_pct: true },
  });
}

function refuse(res: Response, e: unknown) {
  if (e instanceof EarningError) return error(res, e.message, e.status);
  throw e;
}

// ─── GET / — the balance, the history, and the orders on their way ──
router.get('/', asyncHandler(async (req, res) => {
  const rep = await repOf(repIdOf(req));
  if (!rep) return error(res, 'Sales rep not found.', 404);
  // Anything cancelled or deleted without its entry is recorded first.
  const events = await reconcileRep(rep.user_id);
  for (const e of events) void notifyRepEarning(e);

  const open = await openOrdersFor(rep.user_id, rep.commission_pct);
  const row = ({ o, status, figures }: (typeof open)[number]) => ({
    id: o.id,
    order_number: o.order_number,
    client_name: o.user?.business_profile?.company ?? o.user?.name ?? '',
    status,
    order_status: o.status,
    delivered_at: o.delivered_at?.toISOString() ?? null,
    created_at: o.created_at.toISOString(),
    sales: figures.sales.toFixed(2),
    earning: figures.earning.toFixed(2),
    approved_earning: o.rep_earning?.approved_earning?.toFixed(2) ?? null,
    lines_without_cost: o.items.filter((i) => i.unit_cost.lte(0)).length,
  });
  const notApproved = open.filter((x) => x.status !== 'approved');
  // Approved, but a buying price, an expense, the % or a profit set by hand changed since.
  const changed = open.filter((x) => x.status === 'approved' && changedSinceApproval(x.figures, x.o.rep_earning));

  return success(res, {
    commission_pct: rep.commission_pct?.toFixed(2) ?? null,
    totals: await totalsFor(rep.user_id, notApproved.map((x) => ({ status: x.status, earning: x.figures.earning.toFixed(2) }))),
    to_approve: notApproved.filter((x) => x.status === 'awaiting_approval').map(row),
    changed: changed.map(row),
    expected: notApproved.filter((x) => x.status === 'expected').map(row),
    history: await historyFor(rep.user_id),
  });
}));

// ─── GET /entries/:entryId — one line of the history, and what it came from ──
router.get('/entries/:entryId', asyncHandler(async (req, res) => {
  const rep = await repOf(repIdOf(req));
  if (!rep) return error(res, 'Sales rep not found.', 404);
  const detail = await entryDetail(rep.user_id, req.params.entryId, 'admin');
  if (!detail) return error(res, 'Entry not found.', 404);
  return success(res, detail);
}));

// ─── POST /payouts — money paid to the rep ──────────────
router.post('/payouts', requireRole('super_admin'), validate(payoutSchema), asyncHandler(async (req, res) => {
  const rep = await repOf(repIdOf(req));
  if (!rep) return error(res, 'Sales rep not found.', 404);
  const entry = await recordPayout(rep.user_id, req.body, adminIdOf(req));
  void notifyRepEarning({ kind: 'payout', repId: rep.user_id, amount: entry.amount.negated(), paidOn: entry.occurred_on.toISOString().slice(0, 10) });
  return success(res, { id: entry.id }, 201);
}));

// ─── POST /payouts/:entryId/void — a payment recorded by mistake ──
router.post('/payouts/:entryId/void', requireRole('super_admin'), validate(voidSchema), asyncHandler(async (req, res) => {
  const rep = await repOf(repIdOf(req));
  if (!rep) return error(res, 'Sales rep not found.', 404);
  try {
    const r = await voidPayout(rep.user_id, req.params.entryId, req.body.reason, adminIdOf(req));
    void notifyRepEarning({ kind: 'payout_void', repId: rep.user_id, amount: r.amount, note: req.body.reason ?? null });
    return success(res, { voided: true });
  } catch (e) { return refuse(res, e); }
}));

// ─── POST /adjustments — a bonus (+) or a deduction (−) ──
router.post('/adjustments', requireRole('super_admin'), validate(adjustmentSchema), asyncHandler(async (req, res) => {
  const rep = await repOf(repIdOf(req));
  if (!rep) return error(res, 'Sales rep not found.', 404);
  const entry = await recordAdjustment(rep.user_id, req.body, adminIdOf(req));
  void notifyRepEarning({ kind: 'adjustment', repId: rep.user_id, amount: entry.amount, note: entry.note });
  return success(res, { id: entry.id }, 201);
}));

export default router;
