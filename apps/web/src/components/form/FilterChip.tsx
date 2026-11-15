import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';

export interface FilterChipOption {
  value: string;
  label: string;
}

export interface FilterChipProps {
  icon: LucideIcon;
  /** Shown while nothing is chosen, and used as the control's aria-label. */
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: FilterChipOption[];
  /**
   * Show the search box. Defaults to true past 8 options — below that the
   * whole list is visible at once and a search field is furniture.
   */
  searchable?: boolean;
  /** Cap the option list height. Scrolls beyond it. */
  maxMenuHeight?: number;
}

/** Accent- and case-insensitive, so "espana" finds "España". */
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const MENU_MIN_WIDTH = 240;
const MENU_MAX_WIDTH = 340;

/**
 * Filter chip — icon + label + chevron, opening a searchable, scrollable
 * option list.
 *
 * This was a native `<select>` laid over the chip at opacity-0. That got brand
 * styling on the trigger for free, but the menu belonged to the OS: it could
 * not be searched, could not be height-capped, and grew to whatever the
 * platform felt like for a 900-brand list. So the menu is ours now.
 *
 * **The menu renders in a portal, and that is load-bearing.** Both callers put
 * their chips in an `overflow-x-auto` row so the filters scroll on narrow
 * screens — and an absolutely-positioned child of a scroll container is
 * clipped by it. Portalling to `document.body` with fixed coordinates is what
 * lets the menu escape. It is repositioned on scroll and resize, since fixed
 * coordinates go stale the moment anything moves.
 *
 * Not the partner app's `Combobox`, which solves the same problem for a
 * different control: that one's trigger is a full-width `h-11` form field and
 * its list is navigated by type-ahead rather than a search box. Worth merging
 * the two behind one primitive with a swappable trigger if a third appears;
 * two is not yet enough to design that abstraction around.
 */
export default function FilterChip({
  icon: Icon, label, value, onChange, options,
  searchable, maxMenuHeight = 280,
}: FilterChipProps) {
  const { lang } = useLanguageStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; flip: boolean } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value);
  const active = value !== '';
  const showSearch = searchable ?? options.length > 8;

  const filtered = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return options;
    return options.filter((o) => fold(o.label).includes(q));
  }, [options, query]);

  const position = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Reserve room for the search box on top of the capped list.
    const needed = maxMenuHeight + (showSearch ? 56 : 0) + 12;
    const spaceBelow = window.innerHeight - r.bottom;
    const flip = spaceBelow < needed && r.top > spaceBelow;
    const width = Math.min(MENU_MAX_WIDTH, Math.max(MENU_MIN_WIDTH, r.width));
    // Keep the menu on screen when the chip sits near the right edge.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setRect({ top: flip ? r.top : r.bottom, left, width, flip });
  }, [maxMenuHeight, showSearch]);

  useLayoutEffect(() => { if (open) position(); }, [open, position]);

  // Fixed coordinates go stale as soon as anything scrolls — including the
  // chip's own horizontal scroller — so recompute rather than close. `true`
  // captures scrolls on ancestor containers, not just the window.
  useEffect(() => {
    if (!open) return;
    const onMove = () => position();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  // Typing narrows the list, so the highlight has to come back to the top or
  // it points at a row that is no longer in the results. Done here rather
  // than in an effect on `query`: an effect would also fire when openMenu
  // clears a stale query, clobbering the highlight it had just put on the
  // selected option — and it costs a second render pass every keystroke.
  const search = (next: string) => {
    setQuery(next);
    setActiveIndex(0);
  };

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const openMenu = () => {
    setQuery('');
    const idx = options.findIndex((o) => o.value === value);
    setActiveIndex(idx >= 0 ? idx : 0);
    setOpen(true);
  };

  const commit = (opt: FilterChipOption | undefined) => {
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'Escape':    e.preventDefault(); setOpen(false); triggerRef.current?.focus(); return;
      case 'ArrowDown': e.preventDefault(); setActiveIndex((i) => (i + 1) % Math.max(filtered.length, 1)); return;
      case 'ArrowUp':   e.preventDefault(); setActiveIndex((i) => (i - 1 + filtered.length) % Math.max(filtered.length, 1)); return;
      case 'Home':      e.preventDefault(); setActiveIndex(0); return;
      case 'End':       e.preventDefault(); setActiveIndex(Math.max(filtered.length - 1, 0)); return;
      case 'Enter':     e.preventDefault(); commit(filtered[activeIndex]); return;
      case 'Tab':       setOpen(false); return;
      default:
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (!open && ['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openMenu(); }
        }}
        className={`relative inline-flex items-center gap-2 h-11 pl-3.5 pr-2.5 rounded-xl border transition-colors cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-mist ${
          active
            ? 'border-brand bg-brand-mist/50 text-brand-ink'
            : 'border-border bg-card text-gray hover:text-ink hover:border-ink/25'
        } ${open ? 'border-brand ring-2 ring-brand-mist' : ''}`}
      >
        <Icon size={15} strokeWidth={1.75} className={`shrink-0 ${active ? 'text-brand' : 'text-muted'}`} />
        <span className="text-[12.5px] font-ui font-semibold whitespace-nowrap">
          {active ? selected?.label ?? label : label}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          className={`shrink-0 transition-transform ${active ? 'text-brand' : 'text-muted'} ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && rect && createPortal(
        <div
          ref={(el) => {
            menuRef.current = el;
            // The search box takes focus itself via autoFocus. Without one,
            // focus has to land here or the arrow keys handled below never
            // fire — the trigger would still hold it.
            if (el && !showSearch) el.focus();
          }}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onKey}
          style={{
            position: 'fixed',
            left: rect.left,
            width: rect.width,
            ...(rect.flip
              ? { bottom: window.innerHeight - rect.top + 6 }
              : { top: rect.top + 6 }),
          }}
          className="z-[80] bg-card rounded-xl border border-border/70 shadow-float overflow-hidden outline-none"
        >
          {showSearch && (
            <div className="p-2 border-b border-border/60">
              <div className="relative">
                <Search size={14} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => search(e.target.value)}
                  placeholder={lang === 'en' ? `Search ${label.toLowerCase()}` : 'Buscar'}
                  aria-label={lang === 'en' ? `Search ${label.toLowerCase()}` : 'Buscar'}
                  className="w-full h-9 pl-8 pr-3 rounded-lg border border-border bg-surface-linen text-[13px] font-ui text-ink placeholder:text-muted focus:outline-none focus:border-brand focus:bg-card transition-colors"
                />
              </div>
            </div>
          )}

          <ul
            ref={listRef}
            className="overflow-y-auto py-1 outline-none"
            style={{ maxHeight: maxMenuHeight }}
            tabIndex={-1}
          >
            {filtered.map((o, i) => {
              const isSelected = o.value === value;
              const isActive = i === activeIndex;
              return (
                <li
                  key={o.value}
                  data-idx={i}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => commit(o)}
                  className={`px-3 py-2 mx-1 rounded-lg text-[13px] font-ui flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-brand-mist text-brand-ink font-semibold'
                      : isActive
                        ? 'bg-surface-linen text-ink'
                        : 'text-ink hover:bg-surface-linen'
                  }`}
                >
                  <span className="truncate">{o.label}</span>
                  {isSelected && <Check size={14} strokeWidth={2.25} className="text-brand shrink-0" />}
                </li>
              );
            })}

            {filtered.length === 0 && (
              <li className="px-3 py-6 text-center text-[12.5px] text-muted font-body">
                {lang === 'en' ? 'No matches' : 'Sin resultados'}
              </li>
            )}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}
