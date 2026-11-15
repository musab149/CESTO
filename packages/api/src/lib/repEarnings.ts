import { Prisma, type OrderStatus, type SalesRepLedgerKind } from '@prisma/client';
import { z } from 'zod';
import prisma from './prisma';

/**
 * A sales rep's earnings, order by order (2026-10-28, user: "Now the earnings
 * of the reps will be calculated from the orders. In every order we will add
 * the expenses of that order, the net profit after calculation based on the
 * commission percentage of that rep... If any order is cancelled then the
 * earnings should be reverted and recorded... Within earnings we need to have
 * the history maintained about owed amount and paid amount"). It replaced the
 * period statements of 2026-10-26, whose published and paid rows the
 * migration copied into the ledger.
 *
 * The user's decisions (asked 2026-10-28):
 *   · net profit = the products after discounts (IVA in, delivery fee out)
 *     − their buying prices − the order's expenses; the rep earns their % of
 *     it, and an order at a loss earns 0 — it takes nothing back.
 *   · owed only once the order is DELIVERED and an admin APPROVES it.
 *   · the rep sees the whole breakdown on their order, never a buying price.
 *
 * An admin may also type an order's profit in by hand (2026-10-28, user: "admin
 * should be able to edit the profits himself on orders if he want to that will
 * be recorded against that order"), and chooses which (asked: "Either one"):
 *   · the GROSS profit, in place of products − buying prices — the order's
 *     expenses still come off it;
 *   · the NET profit itself — buying prices and expenses are not counted.
 * Who set it and when is kept on the order; an approval stores which it was.
 *
 * The figures are worked out live from the order until it is approved. An
 * approval stores them (what the rep then sees) and writes the earning to
 * the rep's ledger. A change afterwards — a buying price corrected, an
 * expense added — shows as "changed since approval" until an admin approves
 * again, which writes the difference. The % follows the rep's usual one until
 * the first approval fixes it on the order.
 *
 * The ledger is the history and the balance: what is owed is the sum of its
 * entries. Nothing in it is edited or deleted; a mistake is answered by
 * another entry. An order cancelled or deleted is recorded too — taken back
 * when it had been approved, "not earned" with what it was expected to earn
 * when it had not.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = D(0);

// ─── Dates: Spanish calendar days ──────────────────────

function madridOffsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', timeZoneName: 'shortOffset' })
    .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+1';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!m) return 60;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** 00:00 in Madrid on a calendar date ('2026-10-26'), as the instant it is. */
export function madridDayStart(iso: string): Date {
  const utcMidnight = new Date(`${iso}T00:00:00Z`);
  return new Date(utcMidnight.getTime() - madridOffsetMinutes(utcMidnight) * 60_000);
}

/** A DATE column as its calendar day. */
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** The calendar day an instant falls on in Madrid. */
export function madridToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const dateColumn = (iso: string) => new Date(`${iso}T00:00:00Z`);

// ─── One order's figures ───────────────────────────────

/** Which profit an admin typed in by hand: the gross (expenses still off) or the net. */
export type ProfitBasis = 'gross' | 'net';
export type SetProfit = { basis: ProfitBasis; amount: Prisma.Decimal } | null;

export interface Figures {
  sales: Prisma.Decimal;
  buying: Prisma.Decimal;
  /** Products less buying prices — or the gross profit an admin set. */
  gross: Prisma.Decimal;
  /** The order's expenses as listed. Not counted when the net profit is set by hand. */
  expenses: Prisma.Decimal;
  net: Prisma.Decimal;
  pct: Prisma.Decimal | null;
  earning: Prisma.Decimal;
  /** Which profit an admin set by hand, if one is. */
  basis: ProfitBasis | null;
}

/**
 * products − buying = gross; gross − expenses = net; the rep's % of the net,
 * to the cent, 0 at a loss or without a %. A profit set by hand stands in for
 * the gross (the expenses still come off) or for the net (nothing comes off).
 */
export function figuresFor(input: {
  subtotal: Prisma.Decimal;
  items: { quantity: number; unit_cost: Prisma.Decimal }[];
  expenses: { amount: Prisma.Decimal }[];
  pct: Prisma.Decimal | null;
  profit?: SetProfit;
}): Figures {
  const buying = input.items.reduce((s, i) => s.plus(D(i.unit_cost).times(i.quantity)), ZERO);
  const expenses = input.expenses.reduce((s, e) => s.plus(e.amount), ZERO);
  const set = input.profit ?? null;
  const gross = set?.basis === 'gross' ? D(set.amount) : D(input.subtotal).minus(buying);
  const net = set?.basis === 'net' ? D(set.amount) : gross.minus(expenses);
  return { sales: D(input.subtotal), buying, gross, expenses, net, pct: input.pct, earning: earningOf(net, input.pct), basis: set?.basis ?? null };
}

/** The rep's % of a net profit, to the cent, half up; 0 at a loss or without a %. */
function earningOf(net: Prisma.Decimal, pct: Prisma.Decimal | null) {
  return !pct || net.lte(0) ? ZERO : net.times(pct).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** The profit an admin set on an order, if one is. */
export function setProfitOf(row: { profit_basis: ProfitBasis | null; profit_override: Prisma.Decimal | null } | null | undefined): SetProfit {
  return row?.profit_basis && row.profit_override != null ? { basis: row.profit_basis, amount: D(row.profit_override) } : null;
}

/** What an order is read with to work its earning out. */
export const EARNING_ORDER_SELECT = {
  id: true,
  order_number: true,
  status: true,
  deleted_at: true,
  delivered_at: true,
  created_at: true,
  updated_at: true,
  subtotal: true,
  created_by_sales_rep_id: true,
  // The buying price is left out of every read unless asked for (lib/prisma).
  items: { select: { quantity: true, unit_cost: true } },
  rep_earning: {
    include: {
      expenses: { orderBy: [{ sort_order: 'asc' as const }, { id: 'asc' as const }] },
      profit_set_by: { select: { name: true } },
    },
  },
} satisfies Prisma.OrderSelect;

export type EarningOrder = Prisma.OrderGetPayload<{ select: typeof EARNING_ORDER_SELECT }>;

/**
 * Where an order's earning stands:
 *   draft — a parked basket, not a sale;
 *   expected — placed, not delivered yet;
 *   awaiting_approval — delivered, an admin has not approved it;
 *   approved — owed (until paid);
 *   not_earned — cancelled or deleted before it was approved;
 *   reversed — approved, then cancelled or deleted, and taken back.
 */
export type EarningStatus = 'draft' | 'expected' | 'awaiting_approval' | 'approved' | 'not_earned' | 'reversed';

const ended = (o: { status: OrderStatus; deleted_at: Date | null }) => !!o.deleted_at || o.status === 'cancelled';

export function statusOf(o: EarningOrder): EarningStatus {
  const row = o.rep_earning;
  if (row?.approved_at) return row.reversed_at || ended(o) ? 'reversed' : 'approved';
  if (ended(o)) return 'not_earned';
  if (o.status === 'draft') return 'draft';
  if (o.status === 'delivered') return 'awaiting_approval';
  return 'expected';
}

/** The order's own %, else the rep's usual one, else none. */
export function pctOf(o: EarningOrder, repPct: Prisma.Decimal | null) {
  const own = o.rep_earning?.commission_pct ?? null;
  return { pct: own ?? repPct, source: own != null ? 'order' as const : repPct != null ? 'rep' as const : 'none' as const };
}

export function liveFigures(o: EarningOrder, repPct: Prisma.Decimal | null): Figures {
  return figuresFor({
    subtotal: o.subtotal, items: o.items, expenses: o.rep_earning?.expenses ?? [], pct: pctOf(o, repPct).pct,
    profit: setProfitOf(o.rep_earning),
  });
}

type EarningRow = NonNullable<EarningOrder['rep_earning']>;

/** The figures as approved — what the rep sees, and what the ledger holds. */
function approvedFigures(row: EarningRow) {
  const sales = D(row.approved_sales ?? 0);
  const buying = D(row.approved_buying ?? 0);
  const expenses = D(row.approved_expenses ?? 0);
  const basis = row.approved_profit != null ? row.approved_profit_basis ?? null : null;
  const gross = basis === 'gross' ? D(row.approved_profit!) : sales.minus(buying);
  const net = basis === 'net' ? D(row.approved_profit!) : gross.minus(expenses);
  return { sales, buying, gross, expenses, net, basis };
}

/**
 * Approved, and the figures moved since: a buying price, an expense, the %,
 * the products, or a profit set by hand — so it needs approving again.
 */
export function changedSinceApproval(f: Figures, row: EarningRow | null | undefined): boolean {
  if (!row?.approved_at || row.approved_earning == null) return false;
  const a = approvedFigures(row);
  return !f.earning.equals(row.approved_earning)
    || !f.sales.equals(a.sales)
    || !f.buying.equals(a.buying)
    || !f.expenses.equals(a.expenses)
    || !(f.pct ?? ZERO).equals(row.approved_pct ?? 0)
    || f.basis !== a.basis
    || !f.net.equals(a.net);
}

const money = (d: Prisma.Decimal) => d.toFixed(2);
const pctText = (d: Prisma.Decimal | null) => (d == null ? null : d.toFixed(2));

type ExpenseItem = { label: string; amount: string };

function approvedItems(json: Prisma.JsonValue | null | undefined): ExpenseItem[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((e) => (e && typeof e === 'object' && !Array.isArray(e) && 'label' in e && 'amount' in e
    ? [{ label: String(e.label), amount: D(String(e.amount)).toFixed(2) }]
    : []));
}

/**
 * What the REP sees on their order: the whole breakdown except the buying
 * prices (user: "Rep will not be able to see the buying prices"). As
 * approved once it is; live before.
 */
export function repEarningView(o: EarningOrder, repPct: Prisma.Decimal | null) {
  const status = statusOf(o);
  const row = o.rep_earning;
  if (row?.approved_at && row.approved_earning != null) {
    const a = approvedFigures(row);
    return {
      status,
      sales: money(a.sales),
      /** Products less their buying cost — before the order's expenses. */
      gross_profit: money(a.gross),
      expenses: approvedItems(row.approved_expense_items),
      expenses_total: money(a.expenses),
      /** After the expenses: what the rep's % is taken of. */
      net_profit: money(a.net),
      /** A profit the office set by hand: which one. Never who. */
      profit_basis: a.basis,
      percentage: pctText(row.approved_pct),
      earning: money(row.approved_earning),
      approved_at: row.approved_at.toISOString(),
      reversed_at: row.reversed_at?.toISOString() ?? null,
    };
  }
  const f = liveFigures(o, repPct);
  return {
    status,
    sales: money(f.sales),
    gross_profit: money(f.gross),
    expenses: (row?.expenses ?? []).map((e) => ({ label: e.label, amount: money(e.amount) })),
    expenses_total: money(f.expenses),
    net_profit: money(f.net),
    profit_basis: f.basis,
    percentage: pctText(f.pct),
    earning: money(f.earning),
    approved_at: null,
    reversed_at: null,
  };
}

/** What an ADMIN sees: the live figures with the buying total, and the approved ones beside them. */
export function adminEarningView(o: EarningOrder, rep: { user_id: string; name: string; commission_pct: Prisma.Decimal | null }) {
  const status = statusOf(o);
  const row = o.rep_earning;
  const f = liveFigures(o, rep.commission_pct);
  const { source } = pctOf(o, rep.commission_pct);
  const a = row?.approved_at && row.approved_earning != null ? approvedFigures(row) : null;
  const approved = a && row?.approved_at && row.approved_earning != null
    ? {
      at: row.approved_at.toISOString(),
      sales: money(a.sales),
      buying: money(a.buying),
      gross_profit: money(a.gross),
      expenses: approvedItems(row.approved_expense_items),
      expenses_total: money(a.expenses),
      net_profit: money(a.net),
      profit_basis: a.basis,
      percentage: pctText(row.approved_pct),
      earning: money(row.approved_earning),
    }
    : null;
  const changed = !!approved && status === 'approved' && changedSinceApproval(f, row);
  const blocker = approveBlocker(o, f);
  return {
    status,
    rep: { user_id: rep.user_id, name: rep.name },
    sales: money(f.sales),
    buying: money(f.buying),
    /** Lines whose buying price is still 0 — likely not entered yet. */
    lines_without_cost: o.items.filter((i) => D(i.unit_cost).lte(0)).length,
    /** Products less their buying cost — before the order's expenses — or as set by hand. */
    gross_profit: money(f.gross),
    expenses: (row?.expenses ?? []).map((e) => ({ id: e.id, label: e.label, amount: money(e.amount) })),
    expenses_total: money(f.expenses),
    net_profit: money(f.net),
    profit_basis: f.basis,
    /** The profit typed in by hand, and who did it and when — recorded against the order. */
    profit_set: row?.profit_basis && row.profit_override != null
      ? {
        basis: row.profit_basis,
        amount: money(row.profit_override),
        at: row.profit_set_at?.toISOString() ?? null,
        by: row.profit_set_by?.name ?? null,
      }
      : null,
    percentage: pctText(f.pct),
    pct_source: source,
    order_pct: pctText(row?.commission_pct ?? null),
    rep_pct: pctText(rep.commission_pct),
    earning: money(f.earning),
    approved,
    changed_since_approval: changed,
    reversed_at: row?.reversed_at?.toISOString() ?? null,
    can_approve: !blocker && (status === 'awaiting_approval' || changed),
    approve_blocker: blocker,
  };
}

/** Why this order cannot be approved now, if it cannot. */
function approveBlocker(o: EarningOrder, f: Figures): string | null {
  if (!o.created_by_sales_rep_id) return 'not_rep_order';
  if (o.deleted_at) return 'deleted';
  if (o.status === 'cancelled') return 'cancelled';
  if (o.rep_earning?.reversed_at) return 'reversed';
  if (o.status !== 'delivered') return 'not_delivered';
  if (f.pct == null) return 'no_percentage';
  return null;
}

// ─── The ledger ─────────────────────────────────────────

type Tx = Prisma.TransactionClient;

/** One request at a time per order: approving, taking back and editing it. */
async function lockOrder(tx: Tx, orderId: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`rep-earning:${orderId}`}))) l`;
}

/** Writes an entry; false when its dedupe key says it is already there. */
async function post(tx: Tx, entry: Prisma.SalesRepLedgerEntryCreateManyInput): Promise<boolean> {
  const r = await tx.salesRepLedgerEntry.createMany({ data: [entry], skipDuplicates: true });
  return r.count === 1;
}

export type EarningEvent =
  | { kind: 'approved'; repId: string; orderId: string; orderNumber: string; amount: Prisma.Decimal }
  | { kind: 'updated'; repId: string; orderId: string; orderNumber: string; amount: Prisma.Decimal; delta: Prisma.Decimal }
  | { kind: 'reversed'; repId: string; orderId: string; orderNumber: string; amount: Prisma.Decimal };

async function loadForEarning(tx: Tx, orderId: string) {
  const o = await tx.order.findUnique({ where: { id: orderId }, select: EARNING_ORDER_SELECT });
  if (!o?.created_by_sales_rep_id) return null;
  const rep = await tx.salesRep.findUnique({ where: { user_id: o.created_by_sales_rep_id }, select: { user_id: true, commission_pct: true } });
  if (!rep) return null;
  return { o, rep };
}

export class EarningError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

/**
 * Approve an order's earning, or approve it again after its figures changed.
 * The first approval writes the earning; a later one writes the difference.
 */
export async function approveOrderEarning(orderId: string, adminId: string | null): Promise<EarningEvent | null> {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const loaded = await loadForEarning(tx, orderId);
    if (!loaded) throw new EarningError(404, 'This order was not built by a sales rep.');
    const { o, rep } = loaded;
    const f = liveFigures(o, rep.commission_pct);
    const blocker = approveBlocker(o, f);
    if (blocker) {
      const why: Record<string, string> = {
        deleted: 'This order was deleted, so it earns nothing.',
        cancelled: 'This order was cancelled, so it earns nothing.',
        reversed: 'This order\'s earning was taken back when it was cancelled.',
        not_delivered: 'An order\'s earning is approved once it has been delivered.',
        no_percentage: 'Set the rep\'s percentage, or one for this order, before approving.',
        not_rep_order: 'This order was not built by a sales rep.',
      };
      throw new EarningError(422, why[blocker] ?? 'This order cannot be approved.', blocker);
    }
    const row = o.rep_earning;
    const before = row?.approved_at ? D(row.approved_earning ?? 0) : null;
    const snapshot = {
      commission_pct: f.pct,
      approved_at: new Date(),
      approved_by_admin_id: adminId,
      approved_sales: f.sales,
      approved_buying: f.buying,
      approved_expenses: f.expenses,
      approved_expense_items: (row?.expenses ?? []).map((e) => ({ label: e.label, amount: e.amount.toFixed(2) })),
      approved_pct: f.pct,
      approved_earning: f.earning,
      approved_profit_basis: f.basis,
      approved_profit: f.basis === 'gross' ? f.gross : f.basis === 'net' ? f.net : null,
    };
    await tx.salesRepOrderEarning.upsert({
      where: { order_id: o.id },
      create: { order_id: o.id, sales_rep_id: rep.user_id, ...snapshot },
      update: snapshot,
    });
    const base = { sales_rep_id: rep.user_id, order_id: o.id, order_number: o.order_number, occurred_on: dateColumn(madridToday()), created_by_admin_id: adminId };
    if (before == null) {
      await post(tx, { ...base, kind: 'order_earning', amount: f.earning, dedupe_key: `earning:${o.id}` });
      return { kind: 'approved', repId: rep.user_id, orderId: o.id, orderNumber: o.order_number, amount: f.earning };
    }
    const delta = f.earning.minus(before);
    if (delta.isZero()) return null;
    await post(tx, { ...base, kind: 'order_adjustment', amount: delta });
    return { kind: 'updated', repId: rep.user_id, orderId: o.id, orderNumber: o.order_number, amount: f.earning, delta };
  });
}

export const earningInputSchema = z.object({
  /** This order's own %; null = the rep's usual one. */
  commission_pct: z.number().min(0).max(100).nullable(),
  /** The whole list; what is sent replaces what was there. */
  expenses: z.array(z.object({
    label: z.string().trim().min(1).max(120),
    amount: z.number().min(0).max(100_000_000),
  }).strict()).max(50),
  /**
   * A profit typed in by hand: the gross (expenses still come off) or the net
   * (nothing comes off). Null = worked out again. Left out = as it was, which
   * is what a screen from before 2026-10-28 sends.
   */
  profit: z.object({
    basis: z.enum(['gross', 'net']),
    amount: z.number().min(-100_000_000).max(100_000_000),
  }).strict().nullable().optional(),
}).strict();

/**
 * The order's expenses, its own % and a profit set by hand. Allowed while the
 * order can still earn. A profit set (or changed) records the admin and the
 * moment; one left as it was keeps who set it.
 */
export async function saveOrderEarningInputs(orderId: string, body: z.infer<typeof earningInputSchema>, adminId: string | null = null) {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const loaded = await loadForEarning(tx, orderId);
    if (!loaded) throw new EarningError(404, 'This order was not built by a sales rep.');
    const { o, rep } = loaded;
    if (o.deleted_at) throw new EarningError(422, 'This order was deleted, so it earns nothing.', 'deleted');
    if (o.status === 'cancelled') throw new EarningError(422, 'This order was cancelled, so it earns nothing.', 'cancelled');
    if (o.rep_earning?.reversed_at) throw new EarningError(422, 'This order\'s earning was taken back.', 'reversed');
    const row = o.rep_earning;
    const set = body.profit;
    const amount = set ? D(set.amount.toFixed(2)) : null;
    const profit = set === undefined ? {}
      : set === null ? { profit_basis: null, profit_override: null, profit_set_by_admin_id: null, profit_set_at: null }
        : row?.profit_basis === set.basis && row.profit_override != null && D(row.profit_override).equals(amount!) ? {}
          : { profit_basis: set.basis, profit_override: amount, profit_set_by_admin_id: adminId, profit_set_at: new Date() };
    await tx.salesRepOrderEarning.upsert({
      where: { order_id: o.id },
      create: { order_id: o.id, sales_rep_id: rep.user_id, commission_pct: body.commission_pct, ...profit },
      update: { commission_pct: body.commission_pct, ...profit },
    });
    await tx.salesRepOrderExpense.deleteMany({ where: { order_id: o.id } });
    if (body.expenses.length > 0) {
      await tx.salesRepOrderExpense.createMany({
        data: body.expenses.map((e, i) => ({ order_id: o.id, label: e.label, amount: D(e.amount.toFixed(2)), sort_order: i })),
      });
    }
  });
}

/**
 * An order a rep built was cancelled or deleted: record it. Approved, its
 * earning is taken back; not approved, it is noted as not earned with what
 * it was expected to earn. Once per order — safe to call from every path
 * that ends one, and again when nothing happened. `at` dates an entry
 * written after the fact (see reconcileRep).
 */
export async function endOrderEarning(orderId: string, at?: Date): Promise<EarningEvent | null> {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const loaded = await loadForEarning(tx, orderId);
    if (!loaded) return null;
    const { o, rep } = loaded;
    if (!ended(o)) return null;
    const row = o.rep_earning;
    const when = at ?? new Date();
    const base = {
      sales_rep_id: rep.user_id, order_id: o.id, order_number: o.order_number,
      occurred_on: dateColumn(madridToday(when)), created_at: when,
    };
    if (row?.approved_at) {
      if (row.reversed_at) return null;
      const amount = D(row.approved_earning ?? 0);
      const wrote = await post(tx, {
        ...base, kind: 'order_reversal', amount: amount.negated(), dedupe_key: `reversal:${o.id}`,
      });
      await tx.salesRepOrderEarning.update({ where: { order_id: o.id }, data: { reversed_at: when } });
      return wrote ? { kind: 'reversed', repId: rep.user_id, orderId: o.id, orderNumber: o.order_number, amount } : null;
    }
    // A basket parked and thrown away was never a sale.
    if (o.status === 'draft') return null;
    await post(tx, {
      ...base, kind: 'order_not_earned', amount: ZERO, reference_amount: liveFigures(o, rep.commission_pct).earning,
      dedupe_key: `not-earned:${o.id}`,
    });
    return null;
  });
}

/**
 * For the routes that cancel or delete an order: record it on its rep's
 * earnings and tell them when money moved. Never throws — a miss is caught
 * by reconcileRep the next time the rep's earnings are read.
 */
export async function settleRepEarning(orderId: string): Promise<void> {
  try {
    const event = await endOrderEarning(orderId);
    if (event) {
      const { notifyRepEarning } = await import('./notifications');
      await notifyRepEarning(event);
    }
  } catch (err) {
    console.error('[repEarnings] could not record an ended order', orderId, err);
  }
}

/**
 * Records every order of the rep's that ended without its entry — a path
 * that cancels or deletes and did not call endOrderEarning, a request that
 * died half way. Run before the rep's earnings are read, so the history and
 * the balance never miss one.
 */
export async function reconcileRep(repId: string): Promise<EarningEvent[]> {
  const missing = await prisma.$queryRaw<{ id: string; at: Date }[]>`
    SELECT o.id, COALESCE(o.deleted_at, o.updated_at) AS at
    FROM orders o
    LEFT JOIN sales_rep_order_earnings e ON e.order_id = o.id
    WHERE o.created_by_sales_rep_id = ${repId}::uuid
      AND (o.deleted_at IS NOT NULL OR o.status = 'cancelled')
      AND NOT (o.status = 'draft' AND e.approved_at IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM sales_rep_ledger_entries l
        WHERE l.order_id = o.id AND l.kind IN ('order_reversal', 'order_not_earned')
      )
    ORDER BY at ASC
    LIMIT 500`;
  const events: EarningEvent[] = [];
  for (const m of missing) {
    const e = await endOrderEarning(m.id, m.at);
    if (e) events.push(e);
  }
  return events;
}

// ─── Payouts and adjustments ────────────────────────────

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date like 2026-10-28');

export const payoutSchema = z.object({
  amount: z.number().positive().max(100_000_000),
  /** The day it was paid; today when not given. */
  paid_on: isoDate.optional(),
  note: z.string().trim().max(500).nullable().optional(),
}).strict();

export const voidSchema = z.object({ reason: z.string().trim().max(500).nullable().optional() }).strict();

export const adjustmentSchema = z.object({
  /** + a bonus, − a deduction. */
  amount: z.number().min(-100_000_000).max(100_000_000).refine((v) => v !== 0, 'An adjustment of 0 changes nothing.'),
  note: z.string().trim().min(1, 'Say what it is for — the rep reads it.').max(500),
}).strict();

export async function recordPayout(repId: string, body: z.infer<typeof payoutSchema>, adminId: string | null) {
  const paidOn = body.paid_on ?? madridToday();
  return prisma.salesRepLedgerEntry.create({
    data: {
      sales_rep_id: repId, kind: 'payout', amount: D(body.amount.toFixed(2)).negated(),
      occurred_on: dateColumn(paidOn), note: body.note || null, created_by_admin_id: adminId,
    },
  });
}

/** Undo a payout recorded by mistake: an entry that gives it back. Once. */
export async function voidPayout(repId: string, entryId: string, reason: string | null | undefined, adminId: string | null) {
  return prisma.$transaction(async (tx) => {
    const payout = await tx.salesRepLedgerEntry.findFirst({ where: { id: entryId, sales_rep_id: repId } });
    if (!payout) throw new EarningError(404, 'Payment not found.');
    if (payout.kind !== 'payout') throw new EarningError(422, 'Only a payment can be voided.');
    const wrote = await post(tx, {
      sales_rep_id: repId, kind: 'payout_void', amount: D(payout.amount).negated(),
      occurred_on: dateColumn(madridToday()), voids_entry_id: payout.id, dedupe_key: `void:${payout.id}`,
      note: reason || null, created_by_admin_id: adminId,
    });
    if (!wrote) throw new EarningError(409, 'That payment was already voided.');
    return { amount: D(payout.amount).negated() };
  });
}

export async function recordAdjustment(repId: string, body: z.infer<typeof adjustmentSchema>, adminId: string | null) {
  return prisma.salesRepLedgerEntry.create({
    data: {
      sales_rep_id: repId, kind: 'adjustment', amount: D(body.amount.toFixed(2)),
      occurred_on: dateColumn(madridToday()), note: body.note, created_by_admin_id: adminId,
    },
  });
}

// ─── Reading a rep's earnings ───────────────────────────

const PAYOUT_KINDS: SalesRepLedgerKind[] = ['payout', 'payout_void'];

/** The balance and what makes it up, plus what is still on its way. */
export async function totalsFor(repId: string, open: { status: EarningStatus; earning: string }[]) {
  const sums = await prisma.salesRepLedgerEntry.groupBy({ by: ['kind'], where: { sales_rep_id: repId }, _sum: { amount: true } });
  const of = (pick: (k: SalesRepLedgerKind) => boolean) =>
    sums.filter((s) => pick(s.kind)).reduce((a, s) => a.plus(s._sum.amount ?? 0), ZERO);
  const owed = of(() => true);
  const paid = of((k) => PAYOUT_KINDS.includes(k)).negated();
  const monthStart = dateColumn(`${madridToday().slice(0, 7)}-01`);
  const month = await prisma.salesRepLedgerEntry.aggregate({
    where: { sales_rep_id: repId, kind: { notIn: PAYOUT_KINDS }, occurred_on: { gte: monthStart } },
    _sum: { amount: true },
  });
  const sum = (s: EarningStatus) => open.filter((o) => o.status === s).reduce((a, o) => a.plus(o.earning), ZERO);
  return {
    /** What is owed to them now: everything earned less everything paid. Negative = paid ahead. */
    owed: money(owed),
    /** Everything earned, after reversals and adjustments. */
    earned: money(owed.plus(paid)),
    paid: money(paid),
    /** Earned (approved, adjusted) this calendar month in Madrid. */
    this_month: money(D(month._sum.amount ?? 0)),
    awaiting_approval: money(sum('awaiting_approval')),
    awaiting_count: open.filter((o) => o.status === 'awaiting_approval').length,
    expected: money(sum('expected')),
    expected_count: open.filter((o) => o.status === 'expected').length,
  };
}

/** The ledger, newest first, each entry with the balance after it. */
export async function historyFor(repId: string) {
  const rows = await prisma.salesRepLedgerEntry.findMany({
    where: { sales_rep_id: repId },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: {
      id: true, kind: true, amount: true, reference_amount: true, order_id: true, order_number: true,
      occurred_on: true, note: true, voids_entry_id: true, created_at: true,
      order: { select: { deleted_at: true } },
    },
  });
  const voided = new Set(rows.filter((r) => r.voids_entry_id).map((r) => r.voids_entry_id!));
  let balance = ZERO;
  const out = rows.map((r) => {
    balance = balance.plus(r.amount);
    return {
      id: r.id,
      kind: r.kind,
      amount: money(r.amount),
      reference_amount: r.reference_amount ? money(r.reference_amount) : null,
      balance: money(balance),
      // `id` only while the order can still be opened — not once it is deleted.
      order: r.order_number ? { id: r.order && !r.order.deleted_at ? r.order_id : null, order_number: r.order_number } : null,
      occurred_on: isoDay(r.occurred_on),
      created_at: r.created_at.toISOString(),
      note: r.note,
      voided: r.kind === 'payout' && voided.has(r.id),
      voids_entry_id: r.voids_entry_id,
    };
  });
  return out.reverse();
}

/**
 * One line of the history, opened (2026-10-28, user: "in history when we
 * click upon any row then we need to show the breakdown of the profits...
 * the complete thing other then buying prices"): the entry as the history
 * lists it, and what it came from — the order's breakdown (as approved; live
 * when it ended before approval), or the period statement a carried-over
 * line was. The rep's view of an order never carries a buying price; the
 * admin's does. A payment or an adjustment has neither, only itself.
 */
export async function entryDetail(repId: string, entryId: string, view: 'rep' | 'admin') {
  const entry = (await historyFor(repId)).find((h) => h.id === entryId);
  if (!entry) return null;
  const raw = await prisma.salesRepLedgerEntry.findUnique({ where: { id: entryId }, select: { order_id: true, dedupe_key: true } });

  let order = null;
  if (raw?.order_id) {
    const o = await prisma.order.findUnique({
      where: { id: raw.order_id },
      select: { ...EARNING_ORDER_SELECT, user: { select: { name: true, business_profile: { select: { company: true } } } } },
    });
    const rep = await prisma.salesRep.findUnique({
      where: { user_id: repId },
      select: { commission_pct: true, user: { select: { name: true } } },
    });
    if (o) {
      order = {
        // Not a way in once it is deleted.
        id: o.deleted_at ? null : o.id,
        order_number: o.order_number,
        client_name: o.user?.business_profile?.company ?? o.user?.name ?? '',
        order_status: o.status,
        deleted: !!o.deleted_at,
        delivered_at: o.delivered_at?.toISOString() ?? null,
        earning: view === 'admin'
          ? adminEarningView(o, { user_id: repId, name: rep?.user.name ?? '', commission_pct: rep?.commission_pct ?? null })
          : repEarningView(o, rep?.commission_pct ?? null),
      };
    }
  }

  // A line carried over from a period statement: that statement's figures.
  let statement = null;
  const legacyId = raw?.dedupe_key?.match(/^legacy(?:-paid)?:(.+)$/)?.[1];
  if (legacyId) {
    const st = await prisma.salesRepStatement.findUnique({
      where: { id: legacyId },
      include: { expenses: { orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] } },
    });
    if (st) {
      const expenses = st.expenses.reduce((s, e) => s.plus(e.amount), ZERO);
      const net = st.profit.minus(expenses);
      statement = {
        period_from: isoDay(st.period_from),
        period_to: isoDay(st.period_to),
        /** What the admin entered as the period's profit — before expenses. */
        gross_profit: money(st.profit),
        expenses: st.expenses.map((e) => ({ label: e.label, amount: money(e.amount) })),
        expenses_total: money(expenses),
        net_profit: money(net),
        percentage: pctText(st.percentage),
        earning: money(net.lte(0) ? ZERO : net.times(st.percentage).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)),
        notes: st.notes,
      };
    }
  }
  return { entry, order, statement };
}

/**
 * This calendar month's expenses and net profit (2026-10-28, user: "these
 * three cards sales, expenses, and net profit are monthly based"), over the
 * same orders the dashboard's sales card counts: the rep's orders placed this
 * month in Madrid, drafts and cancelled ones not being money. Each order as
 * the rep sees it — its approved figures once approved, live before.
 */
export async function monthFor(repId: string, repPct: Prisma.Decimal | null) {
  const start = madridDayStart(`${madridToday().slice(0, 7)}-01`);
  const rows = await prisma.order.findMany({
    where: {
      created_by_sales_rep_id: repId,
      deleted_at: null,
      status: { notIn: ['cancelled', 'draft'] },
      created_at: { gte: start },
    },
    select: EARNING_ORDER_SELECT,
  });
  let expenses = ZERO;
  let net = ZERO;
  for (const o of rows) {
    const row = o.rep_earning;
    if (row?.approved_at && !row.reversed_at) {
      const a = approvedFigures(row);
      expenses = expenses.plus(a.expenses);
      net = net.plus(a.net);
    } else {
      const f = liveFigures(o, repPct);
      expenses = expenses.plus(f.expenses);
      net = net.plus(f.net);
    }
  }
  return { orders: rows.length, expenses: money(expenses), net_profit: money(net) };
}

/**
 * The rep's orders still on their way to an earning — not approved, not
 * ended — and the approved ones whose figures changed since, with what each
 * is worth now.
 */
export async function openOrdersFor(repId: string, repPct: Prisma.Decimal | null) {
  const rows = await prisma.order.findMany({
    where: {
      created_by_sales_rep_id: repId,
      deleted_at: null,
      status: { notIn: ['cancelled', 'draft'] },
      OR: [{ rep_earning: null }, { rep_earning: { approved_at: null } }, { rep_earning: { reversed_at: null } }],
    },
    select: { ...EARNING_ORDER_SELECT, user: { select: { name: true, business_profile: { select: { company: true } } } } },
    orderBy: { created_at: 'desc' },
    take: 1000,
  });
  return rows.map((o) => ({ o, status: statusOf(o), figures: liveFigures(o, repPct) }));
}
