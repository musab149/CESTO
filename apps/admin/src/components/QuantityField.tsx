import { useRef, useState } from 'react';
import { MAX_LINE_QUANTITY } from '@grocery-app/shared';

/**
 * The number between − and +, and you can type into it.
 *
 * Admin's copy of apps/web/src/components/QuantityField.tsx — the apps do not
 * share components. Quantities in the order builder were a stepper alone, one
 * unit per tap, so a wholesale line of 500 meant five hundred clicks. Tap the number, type, press Enter or
 * tap away. The − and + beside it stay as they were.
 *
 * Committed on blur or Enter, not per keystroke: typing "500" must not set
 * 5, then 50, then 500, each a cart write. Escape puts the old number back,
 * and so does leaving it empty or 0 — removing a line is the bin's job, not a
 * typo's. A number over `max` (the stock, or a backorder cap) or over
 * MAX_LINE_QUANTITY is lowered to the most allowed, and `onCapped` says so,
 * so the screen can tell the shopper in its own words.
 *
 * Styled by the caller: it inherits colour and font, and sizes itself to the
 * number. On a touch screen the text is at least 16px, or iOS zooms the page
 * when the field is focused (`.qty-field` in app.css).
 */
export default function QuantityField({ value, max, onChange, onCapped, className = '', label }: {
  value: number;
  /** The most this line can hold: stock, or a backorder cap. */
  max: number;
  onChange: (n: number) => void;
  /** Called with the number it was lowered to, when it was. */
  onCapped?: (limit: number) => void;
  className?: string;
  /** What this is the quantity of, for screen readers. */
  label?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const ceiling = Math.max(1, Math.min(max, MAX_LINE_QUANTITY));
  const shown = draft ?? String(value);

  const commit = (raw: string | null) => {
    if (raw === null) return;
    const typed = parseInt(raw, 10);
    if (!Number.isFinite(typed) || typed < 1) return;
    const next = Math.min(typed, ceiling);
    if (next < typed) onCapped?.(next);
    if (next !== value) onChange(next);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      aria-label={label}
      value={shown}
      size={Math.max(2, shown.length)}
      style={{ width: `${Math.max(2, shown.length) + 1}ch` }}
      onFocus={(e) => {
        cancelled.current = false;
        setDraft(String(value));
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 6))}
      onBlur={() => {
        const raw = cancelled.current ? null : draft;
        setDraft(null);
        commit(raw);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); }
      }}
      // Inside product cards that open the product on click.
      onClick={(e) => e.stopPropagation()}
      className={`qty-field bg-transparent text-center tabular-nums outline-none rounded-md focus:bg-card focus:text-ink focus:ring-2 focus:ring-brand/40 ${className}`}
    />
  );
}
