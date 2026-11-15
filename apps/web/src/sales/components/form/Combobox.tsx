import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ChevronDown, Search } from 'lucide-react';

// A themed select-style dropdown that renders its own popover instead of the
// browser's native <select> menu. Same value/onChange contract, so it drops
// into places a native <select> lived — but the menu picks up our tokens
// (rounded-lg, shadow-float, brand hover/selected states, etc.) instead of
// looking OS-default.
//
// Deliberately dependency-free. Keyboard nav: ↑/↓, Home/End, Enter, Esc,
// and type-ahead ("g" jumps to the first option whose label starts with g).

export type ComboboxOption =
  | ({ kind?: 'default'; value: string; label: string; disabled?: boolean; icon?: ReactNode; hint?: string })
  | { kind: 'warning'; value: string; label: string; disabled?: boolean; icon?: ReactNode; hint?: string }
  | { kind: 'action'; value: string; label: string; icon?: ReactNode; hint?: string }
  | { kind: 'separator' };

export interface ComboboxProps {
  value: string;
  onChange: (next: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  /** Sets aria-label on the trigger — pair with a visible <label htmlFor>. */
  ariaLabel?: string;
  /** Optional id for association with an external <label htmlFor>. */
  id?: string;
  /** Cap the menu height (default 320px). Scrolls beyond that. */
  maxMenuHeight?: number;
  /** Show a search input above the options and filter by label. */
  searchable?: boolean;
  /** Placeholder for the search input, when `searchable` is set. */
  searchPlaceholder?: string;
  /**
   * Render the menu into document.body with fixed positioning instead of
   * absolutely inside the trigger. Needed when an ancestor has overflow
   * hidden/auto — e.g. the bulk-edit grid's scroll container, which would
   * otherwise clip the menu to the cell. Opt-in so existing usages are
   * unaffected.
   */
  menuPortal?: boolean;
  /** Floor for the menu width. Without it a narrow trigger gives a narrow menu. */
  menuMinWidth?: number;
}

/** Fixed-position coords for a portalled menu, clamped to the viewport. */
function portalPosition(
  a: { top: number; bottom: number; left: number; width: number },
  placement: 'below' | 'above',
  minWidth?: number,
): CSSProperties {
  const width = Math.max(a.width, minWidth ?? 0);
  // Keep the menu on screen when the trigger sits near the right edge.
  const left = Math.min(a.left, Math.max(8, window.innerWidth - width - 8));
  return placement === 'below'
    ? { top: a.bottom + 6, left, width }
    : { bottom: window.innerHeight - a.top + 6, left, width };
}

function isSelectable(o: ComboboxOption): o is Exclude<ComboboxOption, { kind: 'separator' }> {
  if (o.kind === 'separator') return false;
  if ('disabled' in o && o.disabled) return false;
  return true;
}

// Trigger styling matches the existing `inputClass` used elsewhere in the
// admin (h-11 · rounded-lg · bg-surface-cream · border · font-display).
const TRIGGER_CLASS =
  'w-full h-11 flex items-center justify-between gap-2 bg-surface-cream border rounded-lg pl-4 pr-3 text-sm font-display text-ink text-left transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60';

export default function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled,
  invalid,
  className,
  ariaLabel,
  id,
  maxMenuHeight = 320,
  searchable = false,
  searchPlaceholder = 'Buscar…',
  menuPortal = false,
  menuMinWidth,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [placement, setPlacement] = useState<'below' | 'above'>('below');
  const [anchor, setAnchor] = useState<{ top: number; bottom: number; left: number; width: number } | null>(null);
  const [query, setQuery] = useState('');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const typeaheadRef = useRef<{ query: string; timer: number | null }>({ query: '', timer: null });

  // With search active, filter down to matching options — dropping any
  // separator that would otherwise end up leading, trailing, or doubled up
  // once the options around it are filtered out.
  const filteredOptions = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    const result: ComboboxOption[] = [];
    for (const o of options) {
      if (o.kind === 'separator') {
        if (result.length > 0 && result[result.length - 1].kind !== 'separator') {
          result.push(o);
        }
        continue;
      }
      if (o.label.toLowerCase().includes(q)) result.push(o);
    }
    while (result.length > 0 && result[result.length - 1].kind === 'separator') result.pop();
    return result;
  }, [options, query, searchable]);

  const selectable = useMemo(
    () => filteredOptions
      .map((o, i) => ({ opt: o, index: i }))
      .filter((x) => isSelectable(x.opt)),
    [filteredOptions],
  );

  const selectedOption = useMemo(() => {
    for (const o of options) {
      if (o.kind === 'separator') continue;
      if (o.value === value) return o;
    }
    return null;
  }, [options, value]);

  const openMenu = useCallback(() => {
    if (disabled) return;
    setQuery('');
    setOpen(true);
    // Focus first selectable option matching current value, else the first.
    const selectableList = selectable;
    const currentIdx = selectableList.findIndex((x) => {
      const o = x.opt;
      return o.kind !== 'separator' && o.value === value;
    });
    setActiveIndex(currentIdx >= 0 ? currentIdx : 0);
  }, [disabled, selectable, value]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    triggerRef.current?.focus();
  }, []);

  // Autofocus the search input as soon as the menu opens.
  useEffect(() => {
    if (open && searchable) searchInputRef.current?.focus();
  }, [open, searchable]);

  // Click-outside dismiss.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
      setActiveIndex(-1);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  // Decide whether to flip above the trigger when there isn't room below —
  // avoids the menu getting cut off at the bottom of the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setPlacement(spaceBelow < 240 && spaceAbove > spaceBelow ? 'above' : 'below');
  }, [open]);

  // Portal mode: track the trigger in viewport coords, and follow it while any
  // ancestor scrolls (capture phase — scroll doesn't bubble).
  useLayoutEffect(() => {
    if (!open || !menuPortal) return;
    const reposition = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (r) setAnchor({ top: r.top, bottom: r.bottom, left: r.left, width: r.width });
    };
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, menuPortal]);

  // Auto-scroll the active option into view when it changes.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const menu = menuRef.current;
    if (!menu) return;
    const el = menu.querySelector<HTMLElement>(`[data-option-index="${selectable[activeIndex]?.index}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, selectable]);

  function commit(index: number) {
    const item = selectable[index];
    if (!item) return;
    const opt = item.opt;
    if (opt.kind === 'separator') return;
    onChange(opt.value);
    setOpen(false);
    setActiveIndex(-1);
    triggerRef.current?.focus();
  }

  function moveActive(delta: number) {
    if (selectable.length === 0) return;
    setActiveIndex((prev) => {
      const next = prev + delta;
      if (next < 0) return selectable.length - 1;
      if (next >= selectable.length) return 0;
      return next;
    });
  }

  function typeahead(char: string) {
    const ta = typeaheadRef.current;
    ta.query = (ta.query + char).toLowerCase();
    if (ta.timer !== null) window.clearTimeout(ta.timer);
    ta.timer = window.setTimeout(() => { ta.query = ''; }, 500);
    const startIdx = Math.max(0, activeIndex);
    const search = (from: number) => {
      for (let i = 0; i < selectable.length; i++) {
        const idx = (from + i) % selectable.length;
        const o = selectable[idx].opt;
        if (o.kind === 'separator') continue;
        if (o.label.toLowerCase().startsWith(ta.query)) return idx;
      }
      return -1;
    };
    const found = search(startIdx);
    if (found >= 0) setActiveIndex(found);
  }

  function onTriggerKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      openMenu();
      return;
    }
    if (e.key.length === 1 && /\S/.test(e.key)) {
      openMenu();
      // Searchable menus route typing into the search input instead —
      // it grabs focus on open, so there's no buffer to seed here.
      if (!searchable) typeahead(e.key);
    }
  }

  // Navigation keys are intercepted; everything else (letters, backspace,
  // paste) falls through to normal text-input behavior for filtering.
  function onSearchInputKey(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        closeMenu();
        return;
      case 'ArrowDown':
        e.preventDefault();
        moveActive(1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(-1);
        return;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0) commit(activeIndex);
        return;
      case 'Tab':
        closeMenu();
        return;
      default:
    }
  }

  function onMenuKey(e: KeyboardEvent<HTMLDivElement>) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        closeMenu();
        return;
      case 'ArrowDown':
        e.preventDefault();
        moveActive(1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        moveActive(-1);
        return;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        return;
      case 'End':
        e.preventDefault();
        setActiveIndex(selectable.length - 1);
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (activeIndex >= 0) commit(activeIndex);
        return;
      case 'Tab':
        closeMenu();
        return;
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) {
          typeahead(e.key);
        }
    }
  }

  const borderRing = invalid
    ? 'border-danger focus-visible:ring-2 focus-visible:ring-danger/25 focus-visible:border-danger'
    : open
      ? 'border-brand ring-2 ring-brand/25'
      : 'border-border hover:border-brand/40 focus-visible:ring-2 focus-visible:ring-brand/25 focus-visible:border-brand';

  const renderMenu = (menu: ReactNode) =>
    menuPortal ? createPortal(<div className="sales-app">{menu}</div>, document.body) : menu;

  return (
    <div className={`relative ${className ?? ''}`}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-controls={id ? `${id}-menu` : undefined}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onTriggerKey}
        className={`${TRIGGER_CLASS} ${borderRing} focus:outline-none`}
      >
        <span className="flex-1 min-w-0 truncate">
          {selectedOption ? (
            <span className={renderValueClass(selectedOption)}>
              {selectedOption.kind === 'warning' && (
                <AlertTriangle size={13} strokeWidth={2} className="inline-block mr-1 text-amber-deep -mt-0.5" />
              )}
              {selectedOption.label}
            </span>
          ) : (
            <span className="text-muted">{placeholder}</span>
          )}
        </span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          className={`text-ink/45 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && renderMenu(
        <div
          ref={menuRef}
          id={id ? `${id}-menu` : undefined}
          role="listbox"
          tabIndex={-1}
          onKeyDown={onMenuKey}
          className={[
            'bg-card rounded-xl border border-border/70 shadow-float overflow-hidden',
            menuPortal
              ? 'fixed z-60'
              : `absolute left-0 right-0 z-40 ${placement === 'below' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'}`,
          ].join(' ')}
          style={{
            maxHeight: maxMenuHeight,
            ...(menuMinWidth ? { minWidth: menuMinWidth } : {}),
            ...(menuPortal && anchor ? portalPosition(anchor, placement, menuMinWidth) : {}),
          }}
        >
          {searchable && (
            <div className="sticky top-0 z-10 bg-card border-b border-border/60 p-2">
              <div className="relative">
                <Search
                  size={14}
                  strokeWidth={2}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/40"
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
                  onKeyDown={onSearchInputKey}
                  placeholder={searchPlaceholder}
                  className="w-full h-9 pl-8 pr-3 rounded-md border border-border bg-surface-linen text-[13px] font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand"
                />
              </div>
            </div>
          )}
          <ul
            className="overflow-y-auto py-1 outline-none"
            style={{ maxHeight: searchable ? maxMenuHeight - 52 : maxMenuHeight }}
            // Focus the ul on open so arrow/enter land here after the click
            // that opened us — searchable menus focus the search input
            // instead (see the effect above), so skip stealing it back.
            ref={(el) => { if (!searchable) el?.focus(); }}
            tabIndex={-1}
          >
            {filteredOptions.map((opt, i) => {
              if (opt.kind === 'separator') {
                return (
                  <li key={`sep-${i}`} className="my-1 h-px bg-border/60 mx-2" role="separator" />
                );
              }
              const selectableIdx = selectable.findIndex((x) => x.index === i);
              const isActive = selectableIdx === activeIndex;
              const isSelected = opt.value === value;
              return (
                <li
                  key={`${opt.value}-${i}`}
                  data-option-index={i}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={'disabled' in opt && opt.disabled ? true : undefined}
                  onMouseEnter={() => selectableIdx >= 0 && setActiveIndex(selectableIdx)}
                  onClick={() => selectableIdx >= 0 && commit(selectableIdx)}
                  className={renderOptionClass(opt, isActive, isSelected)}
                >
                  <span className="flex items-center gap-2 min-w-0 flex-1">
                    {opt.kind === 'warning' && (
                      <AlertTriangle size={13} strokeWidth={2} className="text-amber-deep shrink-0" />
                    )}
                    {'icon' in opt && opt.icon}
                    <span className="truncate">{opt.label}</span>
                  </span>
                  {isSelected && opt.kind !== 'action' && (
                    <Check size={14} strokeWidth={2.25} className="text-brand shrink-0" />
                  )}
                </li>
              );
            })}
            {selectable.length === 0 && (
              <li className="px-3 py-2.5 text-[13px] text-muted font-body italic">
                {searchable && query.trim() ? 'Sin resultados.' : 'Nothing to choose from.'}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function renderValueClass(opt: Exclude<ComboboxOption, { kind: 'separator' }>): string {
  if (opt.kind === 'warning') return 'text-amber-deep font-semibold';
  if (opt.kind === 'action') return 'text-brand font-semibold';
  return 'text-ink';
}

function renderOptionClass(
  opt: Exclude<ComboboxOption, { kind: 'separator' }>,
  isActive: boolean,
  isSelected: boolean,
): string {
  const base = 'px-3 py-2 mx-1 rounded-md text-[13.5px] font-display flex items-center justify-between gap-2 cursor-pointer transition-colors';
  const disabled = 'disabled' in opt && opt.disabled;
  if (disabled) return `${base} text-muted/70 cursor-not-allowed opacity-60`;
  if (opt.kind === 'action') {
    return `${base} text-brand font-semibold ${isActive ? 'bg-brand-mist' : 'hover:bg-brand-mist'}`;
  }
  if (opt.kind === 'warning') {
    return `${base} text-amber-deep ${isActive ? 'bg-amber-mist' : 'hover:bg-amber-mist'} font-semibold`;
  }
  if (isSelected) {
    return `${base} bg-brand-mist text-brand-ink font-semibold ${isActive ? 'ring-1 ring-brand/25' : ''}`;
  }
  if (isActive) return `${base} bg-surface-linen text-ink`;
  return `${base} text-ink hover:bg-surface-linen`;
}
