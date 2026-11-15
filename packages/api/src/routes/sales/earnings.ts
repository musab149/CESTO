import { Router } from 'express';
import prisma from '../../lib/prisma';
import { success, error } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { notifyRepEarning } from '../../lib/notifications';
import { entryDetail, historyFor, monthFor, openOrdersFor, reconcileRep, totalsFor } from '../../lib/repEarnings';

/**
 * A rep's own earnings (lib/repEarnings): what is owed to them, what has been
 * paid, the history behind both, and their orders still on the way to an
 * earning. Read-only — approving, paying and adjusting are an admin's. Never a
 * buying price: an order's figures here are its products and its earning.
 */

const router = Router();

router.get('/', asyncHandler(async (req, res) => {
  const repId = req.salesRep!.user.id;
  const rep = await prisma.salesRep.findUnique({ where: { user_id: repId }, select: { commission_pct: true } });
  // Anything cancelled or deleted without its entry is recorded first.
  const events = await reconcileRep(repId);
  for (const e of events) void notifyRepEarning(e);

  const open = (await openOrdersFor(repId, rep?.commission_pct ?? null)).filter((x) => x.status !== 'approved');
  return success(res, {
    commission_pct: rep?.commission_pct?.toFixed(2) ?? null,
    totals: await totalsFor(repId, open.map((x) => ({ status: x.status, earning: x.figures.earning.toFixed(2) }))),
    /** This month's expenses and net profit, beside the sales card (/sales/me). */
    month: await monthFor(repId, rep?.commission_pct ?? null),
    // Delivered and waiting for approval first, then the ones on their way.
    pending: [...open.filter((x) => x.status === 'awaiting_approval'), ...open.filter((x) => x.status === 'expected')]
      .map(({ o, status, figures }) => ({
        id: o.id,
        order_number: o.order_number,
        client_name: o.user?.business_profile?.company ?? o.user?.name ?? '',
        status,
        delivered_at: o.delivered_at?.toISOString() ?? null,
        created_at: o.created_at.toISOString(),
        sales: figures.sales.toFixed(2),
        earning: figures.earning.toFixed(2),
      })),
    history: await historyFor(repId),
  });
}));

// One line of their history, opened: what it came from, never a buying price.
router.get('/entries/:id', asyncHandler(async (req, res) => {
  const detail = await entryDetail(req.salesRep!.user.id, req.params.id, 'rep');
  // Another rep's line is not found, not forbidden.
  if (!detail) return error(res, 'Entry not found.', 404);
  return success(res, detail);
}));

export default router;
