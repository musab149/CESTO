import { ArrowRight } from 'lucide-react';
import { Skeleton } from './Skeleton';
import { Card, CardHeader } from './ui';

/*
 * The rep's counts in ONE card (2026-10-28, user: "on mobile res we show
 * those 4 cards like this one card that have sections for each and on web
 * it will one card and all 4 sections will be in it just like a row", then
 * "try better design for these", then "bring it in the rep design style as
 * we have other stuff").
 *
 * The four are two pairs: what happened TODAY (orders, sold) and what has
 * built up SINCE THEY STARTED (orders, clients). So the card is two bands,
 * each opened by the panel's own card header — icon tile, title, the line
 * both its figures share — and each figure carries the round arrow the
 * panel's tiles use to say "this opens something".
 *
 * Each section is a tile in its own tint (user: "these four sections inside
 * can have there own backgrounds"), washed the way the month's money cards
 * above them are: soft → soft-2, a ring, the arrow in the tint's tile colour.
 *
 * Phone: the bands stacked, two sections side by side in each. From md: the
 * bands side by side — one row of four.
 */

const TONES = {
  sky: {
    tile: 'bg-gradient-to-br from-st-sky-soft to-st-sky-soft-2 ring-st-sky-ring',
    arrow: 'bg-st-sky-tile text-st-sky-fg group-hover:bg-st-sky-fg',
  },
  blue: {
    tile: 'bg-gradient-to-br from-st-blue-soft to-st-blue-soft-2 ring-st-blue-ring',
    arrow: 'bg-st-blue-tile text-st-blue-fg group-hover:bg-st-blue-fg',
  },
  violet: {
    tile: 'bg-gradient-to-br from-st-violet-soft to-st-violet-soft-2 ring-st-violet-ring',
    arrow: 'bg-st-violet-tile text-st-violet-fg group-hover:bg-st-violet-fg',
  },
  amber: {
    tile: 'bg-gradient-to-br from-st-amber-soft to-st-amber-soft-2 ring-st-amber-ring',
    arrow: 'bg-st-amber-tile text-st-amber-fg group-hover:bg-st-amber-fg',
  },
} as const;

export type StatsCardTone = keyof typeof TONES;

export interface StatsCardItem {
  key: string;
  label: string;
  value: string;
  /** Its tint: each of the four has its own. */
  tone: StatsCardTone;
  /** A line of data under the figure — not a repeat of the band's line. */
  sub?: string;
  /** Where the section goes; without one it is not a button. */
  onClick?: () => void;
}

export interface StatsCardGroup {
  key: string;
  title: string;
  icon: React.ElementType;
  /** What both of its figures share: "desde las 00:00". Both bands have one, so they stand level. */
  note: string;
  items: StatsCardItem[];
}

export function StatsCard({ groups, loading = false, label, className = '' }: {
  groups: StatsCardGroup[]; loading?: boolean; label: string; className?: string;
}) {
  return (
    <Card className={`overflow-hidden grid ${groups.length > 1 ? 'md:grid-cols-2' : ''} ${className}`}>
      <h2 className="sr-only">{label}</h2>
      {groups.map((g, gi) => (
        <div key={g.key} className={`min-w-0 ${gi > 0 ? 'border-t md:border-t-0 md:border-l border-border' : ''}`}>
          <CardHeader title={g.title} icon={g.icon} subtitle={g.note} divider={false} />
          <div className="grid grid-cols-2 gap-2 sm:gap-2.5 px-3 sm:px-4 pt-2.5 pb-3 sm:pb-4">
            {g.items.map((s) => {
              const c = TONES[s.tone];
              const body = (
                <>
                  <span className="text-[13px] font-semibold font-display text-charcoal truncate">{s.label}</span>
                  {/* Figure and arrow on one line, the note under them: the
                      figures of a band stay level however long a note runs. */}
                  <span className="mt-2 flex items-center justify-between gap-2">
                    {loading ? (
                      <Skeleton className="h-7 w-20" />
                    ) : (
                      <span className="min-w-0 text-[clamp(20px,6vw,26px)] md:text-[24px] xl:text-[28px] font-bold font-display text-ink tabular-nums leading-none tracking-[-0.01em] whitespace-nowrap overflow-hidden text-ellipsis">
                        {s.value}
                      </span>
                    )}
                    {s.onClick && (
                      <span
                        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-[transform,background-color,color] duration-200 group-hover:translate-x-0.5 group-hover:text-card motion-reduce:transition-none ${c.arrow}`}
                        aria-hidden="true"
                      >
                        <ArrowRight size={16} strokeWidth={2.25} />
                      </span>
                    )}
                  </span>
                  {s.sub && <span className="mt-1.5 text-[12.5px] text-gray leading-snug">{s.sub}</span>}
                </>
              );
              const cls = `group min-w-0 flex flex-col text-left rounded-xl ring-1 ring-inset px-3.5 sm:px-4 pt-3 pb-3.5 ${c.tile}`;
              return s.onClick ? (
                <button
                  key={s.key}
                  type="button"
                  onClick={s.onClick}
                  className={`${cls} transition-transform active:scale-[0.99] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand`}
                >
                  {body}
                </button>
              ) : (
                <div key={s.key} className={cls}>{body}</div>
              );
            })}
          </div>
        </div>
      ))}
    </Card>
  );
}
