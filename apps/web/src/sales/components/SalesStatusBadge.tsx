import { useSalesT } from '../lib/i18n';

/**
 * An order's status pill: a dot and the word on a tint of the same hue.
 *
 * Redesigned 2026-10-26 with the rep panel's palette — every tint shares one
 * lightness, so a column of statuses reads as one family rather than a row of
 * competing colours. The WORDS come from the sales dictionary; the map below
 * is colours only, so no caller can render a status without going near i18n.
 *
 * Exported as `statusConfig` too — the order detail page tints the disc behind
 * its header icon with the status's own colours.
 */
export const TONE: Record<string, { bg: string; text: string; dot: string }> = {
  pending: { bg: 'bg-st-amber-bg', text: 'text-st-amber-fg', dot: 'bg-st-amber-dot' },
  confirmed: { bg: 'bg-st-blue-bg', text: 'text-st-blue-fg', dot: 'bg-st-blue-dot' },
  preparing: { bg: 'bg-st-violet-bg', text: 'text-st-violet-fg', dot: 'bg-st-violet-dot' },
  on_the_way: { bg: 'bg-st-sky-bg', text: 'text-st-sky-fg', dot: 'bg-st-sky-dot' },
  delivered: { bg: 'bg-st-emerald-bg', text: 'text-st-emerald-fg', dot: 'bg-st-emerald-dot' },
  cancelled: { bg: 'bg-st-rose-bg', text: 'text-st-rose-fg', dot: 'bg-st-rose-dot' },
  partially_completed: { bg: 'bg-st-amber-bg', text: 'text-st-amber-fg', dot: 'bg-st-amber-dot' },
  // Neutral, not a warning: an unconfirmed order is a normal thing for a rep
  // to have parked, not a problem to clear.
  draft: { bg: 'bg-st-slate-bg', text: 'text-st-slate-fg', dot: 'bg-st-slate-dot' },
};

export { TONE as statusConfig };

export default function SalesStatusBadge({ status }: { status: string }) {
  const t = useSalesT();
  // An unknown status still renders legibly rather than unstyled — the API can
  // grow a state before this app is redeployed.
  const tone = TONE[status] ?? TONE.draft;
  return (
    <span className={`inline-flex items-center gap-1.5 h-6 pl-2 pr-2.5 rounded-full text-[12px] font-semibold font-display whitespace-nowrap ${tone.bg} ${tone.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`} aria-hidden="true" />
      {t(`sales.status.${status}`)}
    </span>
  );
}
