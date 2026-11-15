import type { RepLedgerEntry } from './types';

/**
 * Where each line of a rep's earnings history stands (2026-10-28, user: "it
 * should show a clear statement to the rep that this is paid and this is
 * outstanding... and similarly add the relevant color background for other
 * states of transaction").
 *
 * The ledger only keeps a running balance: a payment is a lump sum against
 * everything owed, never tied to an order. So which earnings a payment paid is
 * decided here, the way a statement of account does it — each payment (and
 * each deduction) covers the OLDEST earnings first:
 *
 *   + 13,25  statement Sep     settled      ← the payment covered it
 *   − 13,25  payment           paid
 *   +  8,75  statement Oct     outstanding  ← nothing left to cover it
 *
 * An order's own lines settle among themselves first: a re-approval that
 * lowered it trims its earning, and a reversal (the order ended) takes it back
 * whole — those earnings are 'taken_back', never "paid". A payment undone, and
 * the line undoing it, are 'voided' and cancel out. Pure, so it has a table
 * test (tests/repLedger.test.ts); the screens only paint what it says.
 */
export type RepLedgerTone =
  /** A payment received. */
  | 'paid'
  /**
   * Earned — added to their balance — and payments since cover all of it.
   * Shown as "Ganado", never as paid: the paying is the payment's line.
   */
  | 'settled'
  /** Earned, and all or part of it still to be paid (`left`). */
  | 'outstanding'
  /** An order's earning, taken back since because the order ended. */
  | 'taken_back'
  /** The line taking an earning back. */
  | 'reversed'
  /** A deduction an admin made. */
  | 'deduction'
  /** A payment undone, or the line undoing it. */
  | 'voided'
  /** Moves nothing: not earned, an earning of 0, an order's own correction. */
  | 'none';

export interface RepLedgerLineState {
  tone: RepLedgerTone;
  /** outstanding: what of the line is still to be paid, "8.75". */
  left?: string;
  /** outstanding: and part of it is paid already. */
  partial?: boolean;
}

type Line = Pick<RepLedgerEntry, 'id' | 'kind' | 'amount' | 'order' | 'voided'>;

const ORDER_KINDS = new Set(['order_earning', 'order_adjustment', 'order_reversal']);
const cents = (v: string) => Math.round(Number(v) * 100);

/** Each line's state, by id. `entries` newest first, as the API lists them. */
export function ledgerStates(entries: Line[]): Record<string, RepLedgerLineState> {
  const oldestFirst = [...entries].reverse();
  const orderOf = (e: Line) => (ORDER_KINDS.has(e.kind) ? e.order?.order_number ?? null : null);

  // What each order still earns once its own corrections and reversal are in.
  const orderLeft = new Map<string, number>();
  const ended = new Set<string>();
  for (const e of oldestFirst) {
    const o = orderOf(e);
    if (!o) continue;
    orderLeft.set(o, (orderLeft.get(o) ?? 0) + cents(e.amount));
    if (e.kind === 'order_reversal') ended.add(o);
  }

  const out: Record<string, RepLedgerLineState> = {};
  // What came off what is owed — payments still standing, and deductions —
  // and the earnings it pays, oldest first.
  let pool = 0;
  const credits: { id: string; amount: number }[] = [];
  for (const e of oldestFirst) {
    const a = cents(e.amount);
    switch (e.kind) {
      case 'payout':
        if (e.voided) out[e.id] = { tone: 'voided' };
        else { out[e.id] = { tone: 'paid' }; pool -= a; }
        break;
      case 'payout_void':
        out[e.id] = { tone: 'voided' };
        break;
      case 'adjustment':
        if (a < 0) { out[e.id] = { tone: 'deduction' }; pool -= a; }
        else if (a > 0) credits.push({ id: e.id, amount: a });
        else out[e.id] = { tone: 'none' };
        break;
      case 'legacy_statement':
        if (a > 0) credits.push({ id: e.id, amount: a });
        else out[e.id] = { tone: 'none' };
        break;
      case 'order_earning':
      case 'order_adjustment': {
        const o = orderOf(e);
        if (a <= 0 || !o) { out[e.id] = { tone: 'none' }; break; }
        // The order's earning, as far as it still stands.
        const left = Math.max(0, orderLeft.get(o) ?? 0);
        const counts = Math.min(a, left);
        orderLeft.set(o, left - counts);
        if (counts > 0) credits.push({ id: e.id, amount: counts });
        else out[e.id] = { tone: ended.has(o) ? 'taken_back' : 'none' };
        break;
      }
      case 'order_reversal':
        out[e.id] = { tone: 'reversed' };
        break;
      default:
        out[e.id] = { tone: 'none' };
    }
  }

  for (const c of credits) {
    const covered = Math.min(c.amount, Math.max(0, pool));
    pool -= covered;
    out[c.id] = covered === c.amount
      ? { tone: 'settled' }
      : { tone: 'outstanding', left: ((c.amount - covered) / 100).toFixed(2), partial: covered > 0 };
  }
  return out;
}
