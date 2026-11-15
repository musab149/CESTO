import { useEffect, useRef, useState } from 'react';

/**
 * A line of text that rolls when it changes, the way a counter does.
 *
 * It exists because the alternative is a spinner, and a spinner next to a
 * figure says "this number is unknown right now" — which is never true here.
 * The last count is still the right answer until the next one lands, so it
 * stays on screen and is replaced rather than cleared. Showing the old value
 * and rolling to the new one is both calmer and more honest than blanking.
 *
 * The outgoing text is positioned absolutely so it cannot affect the width
 * while it leaves; the box takes its size from whatever is current.
 */
export default function RollingText({
  value, className = '',
}: {
  /** Rendered as-is. Changing it is what triggers the roll. */
  value: string;
  className?: string;
}) {
  const [current, setCurrent] = useState(value);
  const [previous, setPrevious] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value === current) return;
    setPrevious(current);
    setCurrent(value);
    // Dropped once it has finished leaving. Kept any longer it would sit
    // invisible on top of the new value and swallow its clicks.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPrevious(null), 240);
  }, [value, current]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <span className={`relative inline-block overflow-hidden align-bottom ${className}`}>
      {previous !== null && (
        <span
          key={`out-${previous}`}
          aria-hidden="true"
          className="animate-roll-out absolute inset-x-0 top-0 whitespace-nowrap"
        >
          {previous}
        </span>
      )}
      <span
        key={`in-${current}`}
        className={`block whitespace-nowrap ${previous !== null ? 'animate-roll-in' : ''}`}
      >
        {current}
      </span>
    </span>
  );
}
