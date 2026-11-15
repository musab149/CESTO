import { ArrowDownLeft, ArrowUpRight, Ban, CircleDashed, Clock, Minus, Undo2, type LucideIcon } from 'lucide-react';
import type { RepLedgerTone } from '@grocery-app/shared';

/**
 * How each state of a history line is painted (2026-10-28, user: "add the
 * green subtle color in the background of the row that says payment
 * received... and similarly add the relevant color background for other
 * states"). Which state a line is in is decided in shared/repLedger.
 *
 * The panel's one tint family (components/SalesStatusBadge). The lines that
 * need the eye get a wash and a stripe down their left edge: a payment green,
 * what is still to be paid amber, what was taken back or deducted rose, an
 * undone payment slate. A line that is settled, or moves nothing, stays white
 * and says where it stands in its tag alone.
 *
 * Green is a payment's alone. An earning that payments have covered is "Ganado"
 * in the brand blue of "Tu ganancia" — money added to their balance — not the
 * payment's green, which read as a second payment (user, 2026-10-28).
 */
export const LEDGER_TONE: Record<RepLedgerTone, {
  /** The row's wash, its hover, and the stripe (a ::before). */
  row: string;
  /** The icon's tile on a phone. */
  tile: string;
  icon: LucideIcon;
  /** The tag's colours, when the state has a tag. */
  chip: { bg: string; text: string; dot: string } | null;
  amount: string;
}> = {
  paid: {
    row: 'bg-st-emerald-wash hover:bg-st-emerald-wash-2 active:bg-st-emerald-wash-2 before:bg-st-emerald-dot',
    tile: 'bg-st-emerald-bg text-st-emerald-fg',
    icon: ArrowDownLeft,
    chip: { bg: 'bg-st-emerald-bg', text: 'text-st-emerald-fg', dot: 'bg-st-emerald-dot' },
    amount: 'text-st-emerald-fg',
  },
  settled: {
    row: 'hover:bg-surface-cream active:bg-surface-cream before:hidden',
    tile: 'bg-brand-whisper text-brand',
    icon: ArrowUpRight,
    chip: { bg: 'bg-brand-whisper', text: 'text-brand', dot: 'bg-brand' },
    amount: 'text-ink',
  },
  outstanding: {
    row: 'bg-st-amber-wash hover:bg-st-amber-wash-2 active:bg-st-amber-wash-2 before:bg-st-amber-dot',
    tile: 'bg-st-amber-bg text-st-amber-fg',
    icon: Clock,
    chip: { bg: 'bg-st-amber-bg', text: 'text-st-amber-fg', dot: 'bg-st-amber-dot' },
    amount: 'text-ink',
  },
  taken_back: {
    row: 'hover:bg-surface-cream active:bg-surface-cream before:hidden',
    tile: 'bg-st-rose-bg text-st-rose-fg',
    icon: Undo2,
    chip: { bg: 'bg-st-rose-bg', text: 'text-st-rose-fg', dot: 'bg-st-rose-dot' },
    amount: 'text-muted line-through',
  },
  reversed: {
    row: 'bg-st-rose-wash hover:bg-st-rose-wash-2 active:bg-st-rose-wash-2 before:bg-st-rose-dot',
    tile: 'bg-st-rose-bg text-st-rose-fg',
    icon: Undo2,
    chip: null,
    amount: 'text-st-rose-fg',
  },
  deduction: {
    row: 'bg-st-rose-wash hover:bg-st-rose-wash-2 active:bg-st-rose-wash-2 before:bg-st-rose-dot',
    tile: 'bg-st-rose-bg text-st-rose-fg',
    icon: Minus,
    chip: null,
    amount: 'text-st-rose-fg',
  },
  voided: {
    row: 'bg-st-slate-wash hover:bg-st-slate-bg active:bg-st-slate-bg before:bg-st-slate-dot',
    tile: 'bg-st-slate-bg text-st-slate-fg',
    icon: Ban,
    chip: { bg: 'bg-st-slate-chip', text: 'text-st-slate-fg', dot: 'bg-st-slate-dot' },
    amount: 'text-muted',
  },
  none: {
    row: 'hover:bg-surface-cream active:bg-surface-cream before:hidden',
    tile: 'bg-surface-sand text-muted',
    icon: CircleDashed,
    chip: null,
    amount: 'text-muted',
  },
};
