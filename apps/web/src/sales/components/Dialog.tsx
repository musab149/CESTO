import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useSalesT } from '../lib/i18n';

/*
 * The rep panel's dialogs, sheets and side panels — one shell for all of them
 * (redesign, 2026-10-27; they had grown ten different overlays, corners,
 * headers and close buttons).
 *
 *   center  — a dialog in the middle of a desk; a bottom sheet on a phone
 *   side    — a panel from the right on a desk; a bottom sheet on a phone
 *   popover — hangs under the top bar's right end on a desk (the account and
 *             the bell); a bottom sheet on a phone
 *
 * Every one: a soft navy veil, a header with its icon on a tinted tile, the
 * title and a line under it, a round close button; a body that scrolls; and
 * an optional footer strip for its actions. Rendered into <body> inside a
 * `.sales-app` wrapper — the panel's palette is scoped to that class, and a
 * dialog inside the sticky header or a card would sit in their stacking
 * contexts. Escape closes, the page under it stops scrolling, and focus goes
 * back where it was.
 */

type Tone = 'brand' | 'danger' | 'success' | 'warning';
const TILE: Record<Tone, string> = {
  brand: 'bg-brand-whisper text-brand',
  danger: 'bg-danger-bg text-danger',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
};
const WIDTH = { sm: 'lg:w-[420px]', md: 'lg:w-[500px]', lg: 'lg:w-[600px]', xl: 'lg:w-[820px]' } as const;

export function Dialog({
  onClose, title, subtitle, icon: Icon, leading, tone = 'brand', variant = 'center', size = 'md',
  headerAction, footer, children, bodyClassName = 'px-5 py-4', ariaLabel, layer = 'z-50', closeLabel,
}: {
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** The header's icon, drawn on a tile in `tone`. */
  icon?: React.ElementType;
  /** Something of its own in the icon's place — an avatar. */
  leading?: React.ReactNode;
  tone?: Tone;
  variant?: 'center' | 'side' | 'popover';
  size?: keyof typeof WIDTH;
  /** Beside the close button — "mark all read". */
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  /** Needed when `title` is not plain text. */
  ariaLabel?: string;
  /** Raise it over another panel (the builder's product drawer). */
  layer?: 'z-50' | 'z-[58]';
  closeLabel?: string;
}) {
  const t = useSalesT();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  // The latest onClose, read by the effect below without being its
  // dependency: callers pass inline arrows, and re-running it on every parent
  // render handed focus back to the trigger mid-typing.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Escape, the page held still, and focus handed back on the way out — once,
  // for the dialog's life. An Escape something inside already used (an open
  // Combobox menu) is left to it.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Into the dialog unless something in it asked for focus itself.
    if (panelRef.current && !panelRef.current.contains(document.activeElement)) panelRef.current.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      before?.focus?.({ preventScroll: true });
    };
  }, []);

  const close = closeLabel ?? t('sales.port.common.close');
  const place = variant === 'center'
    ? `flex items-end lg:items-center justify-center lg:p-6`
    : variant === 'side'
      ? 'flex items-end lg:items-stretch justify-end'
      : 'flex items-end lg:items-start justify-end lg:pt-[60px] lg:pr-4';
  const shape = variant === 'side'
    ? 'lg:h-full lg:max-h-none lg:rounded-none lg:rounded-l-3xl lg:w-[480px] sales-side'
    : `${WIDTH[variant === 'popover' ? 'sm' : size]} lg:max-h-[min(86vh,760px)] lg:rounded-2xl sales-pop`;

  return createPortal(
    <div className="sales-app">
      <div className={`fixed inset-0 ${layer} ${place}`} role="dialog" aria-modal="true" aria-labelledby={ariaLabel ? undefined : titleId} aria-label={ariaLabel}>
        {/* The veil closes it on a tap. Not a button: the round × is the one
            "close" a screen reader should meet, with Escape beside it. */}
        <div
          aria-hidden="true"
          onClick={onClose}
          className={`absolute inset-0 animate-fade-in ${variant === 'popover' ? 'bg-veil/35 lg:bg-veil/10' : 'bg-veil/40'} backdrop-blur-[2px]`}
        />
        <div
          ref={panelRef}
          tabIndex={-1}
          className={`sales-sheet relative w-full max-h-[92vh] flex flex-col overflow-hidden bg-card rounded-t-3xl shadow-modal outline-none ${shape}`}
        >
          {/* The grip a phone's sheet is pulled by. */}
          <div className="lg:hidden flex justify-center pt-2.5 shrink-0" aria-hidden="true">
            <span className="w-10 h-1 rounded-full bg-border" />
          </div>

          <div className="shrink-0 flex items-start gap-3 px-5 pt-3 lg:pt-5 pb-4 border-b border-border">
            {leading ?? (Icon && (
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${TILE[tone]}`}>
                <Icon size={19} strokeWidth={1.75} />
              </span>
            ))}
            {/* As tall as the tile at least, so a title alone sits level with it. */}
            <div className="min-w-0 flex-1 min-h-10 flex flex-col justify-center">
              <h2 id={titleId} className="text-[17px] font-semibold font-display text-ink leading-snug break-words">{title}</h2>
              {subtitle && <p className="mt-0.5 text-[13px] text-gray leading-snug">{subtitle}</p>}
            </div>
            {headerAction}
            <button
              type="button"
              onClick={onClose}
              aria-label={close}
              className="w-9 h-9 -mr-1 rounded-full bg-surface-cream hover:bg-surface-sand text-gray hover:text-ink flex items-center justify-center shrink-0 transition-colors"
            >
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${bodyClassName}`}>
            {children}
          </div>

          {footer ? (
            <div className="shrink-0 border-t border-border bg-surface-cream/70 px-5 pt-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          ) : (
            // The home indicator's room, on top of the body's own padding —
            // as a class on the body it replaced that padding instead.
            <div aria-hidden className="shrink-0 h-[env(safe-area-inset-bottom)]" />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A dialog's buttons — the same four everywhere. */
export function Button({ variant = 'primary', className = '', children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
}) {
  const look = {
    primary: 'bg-brand hover:bg-brand-mid text-white shadow-[0_8px_18px_-10px_rgba(5,78,232,0.7)]',
    secondary: 'bg-card border border-border hover:border-ink/20 text-ink',
    danger: 'bg-danger hover:bg-danger/90 text-white',
    ghost: 'text-gray hover:text-ink hover:bg-surface-cream',
  }[variant];
  return (
    <button
      type="button"
      {...rest}
      className={`min-h-[48px] px-5 rounded-xl text-[14.5px] font-semibold font-display inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${look} ${className}`}
    >
      {children}
    </button>
  );
}
