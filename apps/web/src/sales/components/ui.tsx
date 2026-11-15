import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Building2, ChevronRight, Search, X } from 'lucide-react';
import { Skeleton } from './Skeleton';

/*
 * The rep panel's building blocks (redesign, 2026-10-26).
 *
 * Every section is a white card on the porcelain canvas with its heading
 * INSIDE it, so a screen reads as a set of bento tiles rather than headings
 * floating over boxes. Lists carry their own filters in their header.
 */

/** A white card on the canvas. */
export function Card({ className = '', children, as: Tag = 'section' }: {
  className?: string; children: React.ReactNode; as?: 'section' | 'div' | 'ul' | 'aside';
}) {
  return <Tag className={`bg-card rounded-2xl border border-border shadow-card ${className}`}>{children}</Tag>;
}

/** A card's own heading row: its title, an optional icon and line, and its action. */
export function CardHeader({ title, icon: Icon, subtitle, action, divider = true, wrap = false, className = '' }: {
  title: string;
  icon?: React.ElementType;
  subtitle?: string;
  action?: React.ReactNode;
  divider?: boolean;
  /** Let the line under the title wrap — a form's explanation, not a list's caption. */
  wrap?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 sm:px-5 pt-4 ${divider ? 'pb-3.5 border-b border-border' : 'pb-1'} ${className}`}>
      {Icon && (
        <span className="w-9 h-9 rounded-xl bg-brand-whisper text-brand flex items-center justify-center shrink-0">
          <Icon size={18} strokeWidth={1.75} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="text-[15.5px] font-semibold font-display text-ink leading-tight truncate">{title}</h2>
        {subtitle && <p className={`text-[12.5px] text-muted mt-0.5 ${wrap ? 'leading-snug' : 'truncate'}`}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * The same heading for a card that pads itself (`p-5`): it reaches out to the
 * card's edges so its rule runs the full width, as CardHeader's does.
 */
export function SectionTitle({ title, icon: Icon, action }: {
  title: string; icon?: React.ElementType; action?: React.ReactNode;
}) {
  return (
    <div className="-mx-5 -mt-1 px-5 pb-3.5 mb-4 border-b border-border flex items-center gap-3">
      {Icon && (
        <span className="w-9 h-9 rounded-xl bg-brand-whisper text-brand flex items-center justify-center shrink-0">
          <Icon size={18} strokeWidth={1.75} />
        </span>
      )}
      <h2 className="min-w-0 flex-1 text-[15.5px] font-semibold font-display text-ink leading-tight truncate">{title}</h2>
      {action}
    </div>
  );
}

/** The quiet link a card header carries: "Ver todos ›". */
export function CardLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group shrink-0 inline-flex items-center gap-0.5 h-8 pl-2.5 pr-1.5 -mr-1.5 rounded-lg text-[13.5px] font-semibold font-display text-brand hover:bg-brand-whisper transition-colors"
    >
      {children}
      <ChevronRight size={16} strokeWidth={2} className="transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

/**
 * A page's title row: the heading, an optional count and a line under it, and
 * its actions on the right.
 */
export function PageHeader({ title, count, subtitle, actions, className = '' }: {
  title: string; count?: number; subtitle?: string; actions?: React.ReactNode; className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 mb-3 lg:mb-4 ${className}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[26px] lg:text-[28px] font-bold font-display text-ink leading-tight tracking-[-0.02em]">{title}</h1>
          {count !== undefined && (
            <span className="inline-flex items-center justify-center h-7 min-w-[28px] px-2.5 rounded-full bg-card border border-border text-gray text-[13px] font-semibold font-display tabular-nums">
              {count}
            </span>
          )}
        </div>
        {subtitle && <p className="mt-1 text-[14px] text-gray leading-snug max-w-2xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

/**
 * A segmented filter: one well, the chosen option lifted out of it in white.
 * Scrolls sideways when there are more options than width.
 */
export function Segmented<V extends string>({ options, value, onChange, label, className = '' }: {
  options: { value: V; label: string }[]; value: V; onChange: (v: V) => void; label: string; className?: string;
}) {
  return (
    <div className={`min-w-0 overflow-x-auto hide-scrollbar ${className}`}>
      <div role="group" aria-label={label} className="inline-flex items-center gap-0.5 p-1 rounded-xl bg-surface-sand min-w-max">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={on}
              className={`h-8 px-3 rounded-lg text-[13px] font-semibold font-display whitespace-nowrap transition-colors ${
                on ? 'bg-card text-ink shadow-card' : 'text-gray hover:text-ink'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder, className = '', autoFocus = false }: {
  value: string; onChange: (v: string) => void; placeholder: string; className?: string; autoFocus?: boolean;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search size={17} strokeWidth={1.75} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        className="w-full h-11 lg:h-10 bg-surface-cream border border-border rounded-xl pl-10 pr-10 text-[15px] lg:text-sm text-ink placeholder:text-muted focus:outline-none focus:bg-card focus:ring-2 focus:ring-brand/25 focus:border-brand transition [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="×"
          className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center text-muted hover:text-ink"
        >
          <X size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

/** A client's round mark: a building for a business, initials for a person. Soft, so a list is not a wall of blue. */
export function Avatar({ name, business = false, size = 'md' }: { name: string; business?: boolean; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'w-9 h-9 text-[12px]' : 'w-10 h-10 sm:w-11 sm:h-11 text-[13px]';
  const initials = (name || '?').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return (
    <span className={`${box} rounded-full flex items-center justify-center shrink-0 font-bold font-display ${business ? 'bg-brand-whisper text-brand ring-1 ring-inset ring-brand-mist' : 'bg-surface-sand text-charcoal'}`}>
      {business ? <Building2 size={size === 'sm' ? 16 : 19} strokeWidth={1.75} /> : initials}
    </span>
  );
}

/**
 * A KPI tile's colour, from one cool family that sits beside the brand blue —
 * indigo, teal, sky, navy — deep enough for white type once it is lit.
 * `ink` is the hue at rest (icon, arrow); `fill` the gradient it lights up
 * with. Whole class strings, so Tailwind can see them.
 */
const TILE_TONES = {
  blue: {
    fill: 'from-[#2F6EF0] via-brand to-brand-deepest',
    ink: 'text-brand',
    rest: 'ring-brand/15',
    lit: 'hover:shadow-[0_18px_34px_-14px_rgba(5,78,232,0.6)] active:shadow-[0_18px_34px_-14px_rgba(5,78,232,0.6)] focus-visible:shadow-[0_18px_34px_-14px_rgba(5,78,232,0.6)]',
  },
  indigo: {
    fill: 'from-[#6A63F0] via-[#5146E0] to-[#3A30B5]',
    ink: 'text-[#4F46E5]',
    rest: 'ring-[#4F46E5]/15',
    lit: 'hover:shadow-[0_18px_34px_-14px_rgba(81,70,224,0.6)] active:shadow-[0_18px_34px_-14px_rgba(81,70,224,0.6)] focus-visible:shadow-[0_18px_34px_-14px_rgba(81,70,224,0.6)]',
  },
  teal: {
    fill: 'from-[#14A699] via-[#0E8D82] to-[#09685F]',
    ink: 'text-[#0E8274]',
    rest: 'ring-[#0E8D82]/15',
    lit: 'hover:shadow-[0_18px_34px_-14px_rgba(14,141,130,0.6)] active:shadow-[0_18px_34px_-14px_rgba(14,141,130,0.6)] focus-visible:shadow-[0_18px_34px_-14px_rgba(14,141,130,0.6)]',
  },
  sky: {
    fill: 'from-[#22A0E4] via-[#0B84C6] to-[#07639D]',
    ink: 'text-[#0779B5]',
    rest: 'ring-[#0B84C6]/15',
    lit: 'hover:shadow-[0_18px_34px_-14px_rgba(11,132,198,0.6)] active:shadow-[0_18px_34px_-14px_rgba(11,132,198,0.6)] focus-visible:shadow-[0_18px_34px_-14px_rgba(11,132,198,0.6)]',
  },
  navy: {
    fill: 'from-[#36538F] via-[#243C70] to-[#14254A]',
    ink: 'text-[#243C70]',
    rest: 'ring-[#243C70]/15',
    lit: 'hover:shadow-[0_18px_34px_-14px_rgba(20,37,74,0.6)] active:shadow-[0_18px_34px_-14px_rgba(20,37,74,0.6)] focus-visible:shadow-[0_18px_34px_-14px_rgba(20,37,74,0.6)]',
  },
} as const;
export type TileTone = keyof typeof TILE_TONES;

/**
 * What changes when a tile lights up — on hover (a desk), while pressed (a
 * phone, which has no hover) and on keyboard focus. Written once, in full,
 * for each state, so Tailwind can see every class.
 */
const LIT = {
  fill: 'group-hover:opacity-100 group-active:opacity-100 group-focus-visible:opacity-100',
  pattern: 'group-hover:text-white group-hover:opacity-40 group-hover:scale-110 group-active:text-white group-active:opacity-40 group-active:scale-110 group-focus-visible:text-white group-focus-visible:opacity-40 group-focus-visible:scale-110',
  icon: 'group-hover:bg-white/15 group-hover:text-white group-hover:ring-white/25 group-active:bg-white/15 group-active:text-white group-active:ring-white/25 group-focus-visible:bg-white/15 group-focus-visible:text-white group-focus-visible:ring-white/25',
  label: 'group-hover:text-white group-active:text-white group-focus-visible:text-white',
  value: 'group-hover:text-white group-active:text-white group-focus-visible:text-white',
  sub: 'group-hover:text-white/75 group-active:text-white/75 group-focus-visible:text-white/75',
} as const;

function prefersLessMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The number counts up from 0 the first time it arrives — once, in 700ms,
 * easing out — and is simply there for someone who asked for less motion.
 * `null` when not animating, so the caller shows the real value.
 */
function useCountUp(target: number | undefined, enabled: boolean): number | null {
  // Decided once, at mount: a tile that loads without animating never starts.
  const [animates] = useState(() => enabled && !prefersLessMotion());
  const pending = useRef(animates);
  const [anim, setAnim] = useState<number | null>(animates ? 0 : null);
  useEffect(() => {
    if (target === undefined || !pending.current) return;
    pending.current = false;
    let finished = false;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      // A frame's timestamp can be from just before t0 was read; never below 0.
      const p = Math.max(0, Math.min(1, (now - t0) / 700));
      if (p >= 1) { finished = true; setAnim(null); return; }
      setAnim(target * (1 - (1 - p) ** 3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Cut short (a refetch mid-count, or React's dev double mount): run again
    // next time rather than leave a half-counted number on screen.
    return () => {
      cancelAnimationFrame(raf);
      if (!finished) pending.current = true;
    };
  }, [target]);
  return anim;
}

export type TilePatternKind = 'rings' | 'dial' | 'waves' | 'dots' | 'network';

/**
 * Each tile's own minimal pattern — hairlines and points in a 176-unit box
 * whose centre sits just inside the tile's top corner (the user asked for one
 * each, 2026-10-26). Each hints at what its tile counts:
 *   dial    — a clock face: today, since midnight
 *   waves   — a banknote's engraved lines: money in
 *   dots    — a grid of points: things adding up
 *   network — joined dots: people, connected
 *   rings   — a ripple: the default
 */
function TilePattern({ kind }: { kind: TilePatternKind }) {
  const line = { stroke: 'currentColor', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const };
  switch (kind) {
    case 'dial':
      return (
        <>
          <circle cx="88" cy="88" r="56" {...line} />
          {/* The hour marks inside the rim, longer at 12, 3, 6 and 9 — ticks
              outside it read as a sun. */}
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * Math.PI) / 6;
            const r1 = i % 3 === 0 ? 41 : 45;
            return (
              <line key={i} x1={88 + r1 * Math.sin(a)} y1={88 - r1 * Math.cos(a)} x2={88 + 50 * Math.sin(a)} y2={88 - 50 * Math.cos(a)} {...line} />
            );
          })}
          {/* The hands: ten to twelve. */}
          <line x1="88" y1="88" x2="88" y2="56" {...line} />
          <line x1="88" y1="88" x2="69" y2="77" {...line} />
          <circle cx="88" cy="88" r="2.5" fill="currentColor" />
        </>
      );
    case 'waves':
      return (
        <>
          {[60, 76, 92, 108, 124].map((y) => (
            <path key={y} d={`M -10 ${y} C 20 ${y - 14}, 50 ${y + 14}, 80 ${y} S 140 ${y - 14}, 186 ${y}`} {...line} />
          ))}
        </>
      );
    case 'dots':
      return (
        <>
          {Array.from({ length: 10 }, (_, row) => Array.from({ length: 10 }, (_, col) => {
            const x = 16 + col * 16;
            const y = 16 + row * 16;
            // Densest at the corner, thinning towards the tile.
            const fade = Math.max(0, 1 - Math.hypot(x - 120, y - 56) / 120);
            return fade > 0.05 ? <circle key={`${row}-${col}`} cx={x} cy={y} r="1.8" fill="currentColor" fillOpacity={fade} /> : null;
          }))}
        </>
      );
    case 'network': {
      const nodes: [number, number][] = [[52, 112], [84, 76], [122, 100], [96, 138], [140, 58], [58, 152], [32, 82], [104, 40]];
      const edges: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0], [1, 4], [2, 4], [0, 6], [3, 5], [0, 5], [1, 7], [4, 7], [6, 1]];
      return (
        <>
          {edges.map(([a, b]) => (
            <line key={`${a}-${b}`} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} {...line} />
          ))}
          {nodes.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3.2" fill="currentColor" />)}
        </>
      );
    }
    default:
      return (
        <>
          {[26, 48, 70].map((r) => <circle key={r} cx="88" cy="88" r={r} {...line} />)}
        </>
      );
  }
}

/**
 * A KPI tile, shaped like the dashboard's sales card: icon and label on top,
 * the figure, then a line about it beside a round white arrow — and its own
 * minimal pattern off the top corner (see TilePattern; the sales card's filled
 * circles repeated on these read as one pattern copied, 2026-10-26).
 *
 * At rest it is DIFFUSED — its gradient at a whisper over white, the icon and
 * arrow in its colour, dark type. When it is pointed at, pressed (a phone has
 * no hover) or focused, the gradient comes up to full and the type turns
 * white: it takes on its colours (the user's brief, 2026-10-26, after a full
 * colour row read as off the path and white tiles read as boring). A tile with
 * nowhere to go stays diffused. Pass `count` + `format` and the number counts
 * up when it first loads.
 */
export function StatTile({
  icon: Icon, label, value, sub, onClick, loading = false, className = '', tone = 'blue', pattern = 'rings', count, format,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  onClick?: () => void;
  loading?: boolean;
  className?: string;
  tone?: TileTone;
  /** Its own hairline pattern, off the top corner. */
  pattern?: TilePatternKind;
  /** The figure as a number, to count up to; `format` prints each step. */
  count?: number;
  format?: (n: number) => string;
}) {
  const tt = TILE_TONES[tone];
  // Wanted whenever a format is given — the count itself is still loading on
  // the first render, so it cannot be what decides.
  const anim = useCountUp(loading ? undefined : count, !!format);
  const shown = anim !== null && format && count !== undefined ? format(anim) : value;
  const live = !!onClick;
  const ease = 'transition-[color,background-color,box-shadow,opacity] duration-300 ease-out motion-reduce:transition-none';
  const body = (
    <>
      {/* The colour and the rings, in a clip of their own so the corners
          stay round without clipping the tile's shadow. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 [clip-path:inset(0_round_1rem)]">
        <span className={`absolute inset-0 bg-gradient-to-br ${tt.fill} opacity-[0.13] ${ease} ${live ? LIT.fill : ''}`} />
        {/* The tile's own hairline pattern off the top corner. It turns white
            and opens out a little when the tile lights. */}
        <svg
          viewBox="0 0 176 176"
          fill="none"
          className={`absolute -right-14 -top-14 w-28 h-28 md:-right-12 md:-top-12 md:w-44 md:h-44 opacity-25 ${tt.ink} transition-[color,opacity,transform] duration-500 ease-out motion-reduce:transition-none ${live ? LIT.pattern : ''}`}
        >
          <TilePattern kind={pattern} />
        </svg>
      </span>

      <span className="relative flex items-center gap-2.5 min-w-0">
        <span className={`w-9 h-9 rounded-xl bg-white/80 ring-1 ring-inset ring-white flex items-center justify-center shrink-0 shadow-[0_1px_2px_rgba(13,27,46,0.06)] ${tt.ink} ${ease} ${live ? LIT.icon : ''}`}>
          <Icon size={18} strokeWidth={1.9} />
        </span>
        <span className={`min-w-0 text-[14px] font-semibold font-display text-charcoal leading-snug ${ease} ${live ? LIT.label : ''}`}>{label}</span>
      </span>

      {loading ? (
        <span className="relative block mt-auto pt-5"><span className="skeleton block h-8 w-24" /></span>
      ) : (
        <span className={`relative block mt-auto pt-5 text-[clamp(24px,6.6vw,28px)] lg:text-[30px] font-bold font-display text-ink tabular-nums leading-none whitespace-nowrap overflow-hidden text-ellipsis ${ease} ${live ? LIT.value : ''}`}>
          {shown}
        </span>
      )}

      <span className="relative mt-2 flex items-end justify-between gap-3">
        <span className={`min-w-0 text-[12.5px] text-gray leading-snug line-clamp-2 ${ease} ${live ? LIT.sub : ''}`}>{sub}</span>
        {live && (
          <span className={`w-9 h-9 rounded-full bg-card flex items-center justify-center shrink-0 shadow-[0_2px_6px_rgba(13,27,46,0.12)] ${tt.ink} transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none`} aria-hidden="true">
            <ArrowRight size={17} strokeWidth={2.25} />
          </span>
        )}
      </span>
    </>
  );
  const cls = `group relative overflow-hidden min-w-0 text-left rounded-2xl ring-1 ring-inset ${tt.rest} bg-card shadow-card p-4 lg:p-5 min-h-[150px] lg:min-h-[164px] flex flex-col ${className}`;
  return live ? (
    <button
      type="button"
      onClick={onClick}
      className={`${cls} ${tt.lit} transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-1 active:translate-y-0 active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100`}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Rows of a list, shimmering while they load. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 sm:px-5 py-3.5 flex items-center gap-3">
          <Skeleton className="w-11 h-11 rounded-full" />
          <div className="flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56" /></div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}
