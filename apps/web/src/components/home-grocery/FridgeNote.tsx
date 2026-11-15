import { useEffect, useRef, useState } from 'react';
import { Check, ShoppingBasket } from 'lucide-react';
import type { HomeGroceryCopy } from './copy';

/**
 * The page's closing picture: the list that lives on the fridge. Once it
 * scrolls into view each line is crossed off in turn and a stamp lands on
 * it — the household stops keeping the list, we keep it. With reduced
 * motion it arrives already crossed off.
 *
 * Read as one image: the heading beside it says the same thing in words.
 */
/**
 * THE NOTE LOOPS once it has been seen: crossed off and stamped, held, then
 * the marks fade, the sheet is clean for a moment, and it is crossed off
 * again. It used to play once and stop, which on a phone was easy to miss.
 * With reduced motion it is simply done, as before.
 */
type Phase = 'idle' | 'on' | 'clearing' | 'off';
const HOLD_AFTER_STAMP_MS = 2600;
const CLEAR_MS = 450;
const BLANK_MS = 300;

export default function FridgeNote({ c }: { c: HomeGroceryCopy }) {
  const ref = useRef<HTMLDivElement>(null);
  // Without an observer there is nothing to wait for — show it done.
  const [phase, setPhase] = useState<Phase>(() => (typeof IntersectionObserver === 'undefined' ? 'on' : 'idle'));
  const on = phase === 'on' || phase === 'clearing';
  const setOn = (v: boolean) => { if (v) setPhase((p) => (p === 'idle' ? 'on' : p)); };

  useEffect(() => {
    if (phase === 'idle') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    // Last stamp lands at n × 0.3s + 0.35s, and takes 0.5s.
    const doneMs = c.noteItems.length * 300 + 350 + 500;
    const next: Record<Exclude<Phase, 'idle'>, [Phase, number]> = {
      on: ['clearing', doneMs + HOLD_AFTER_STAMP_MS],
      clearing: ['off', CLEAR_MS],
      off: ['on', BLANK_MS],
    };
    const [to, ms] = next[phase];
    const t = window.setTimeout(() => setPhase(to), ms);
    return () => window.clearTimeout(t);
  }, [phase, c.noteItems.length]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={c.noteLabel}
      className={`hg-note keep-light relative w-full max-w-[360px] mx-auto pt-6 ${on ? 'is-on' : ''} ${phase === 'clearing' ? 'is-clearing' : ''}`}
      style={{ '--n': c.noteItems.length } as React.CSSProperties}
    >
      {/* The next sheet of the pad, peeking out behind. */}
      <span aria-hidden="true" className="hg-sheet absolute inset-x-4 top-10 -bottom-3 bg-brand-soft rounded-b-md -rotate-[5deg]" />

      <div className="relative rotate-[2deg] [filter:drop-shadow(0_20px_32px_rgba(2,43,145,0.38))]">
        <div className="hg-sheet bg-card rounded-b-md px-7 pt-10 pb-9">
          <p className="text-[19px] font-bold text-ink tracking-[-0.01em]">{c.noteTitle}</p>
          <ul className="mt-3">
            {c.noteItems.map((item, i) => (
              <li
                key={i}
                className="flex items-center gap-3 h-11 border-b border-[#E3EBFC]"
                style={{ '--i': i } as React.CSSProperties}
              >
                <span className="relative w-5 h-5 rounded-[5px] border-2 border-[#CBD5E1] shrink-0">
                  <span className="hg-check absolute -inset-0.5 rounded-[5px] bg-amber-deep flex items-center justify-center">
                    <Check size={13} strokeWidth={3.5} className="text-white" />
                  </span>
                </span>
                <span className="relative text-[16px] font-medium text-ink">
                  <span className="hg-line">{item}</span>
                  {/* A pen stroke, not text-decoration, so it can be drawn. */}
                  <span className="hg-strike absolute -left-1 -right-1.5 top-1/2 h-[2.5px] -mt-px rounded-full bg-brand" />
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* The magnet holding it to the door. */}
        <span className="absolute left-1/2 -top-5 -translate-x-1/2 w-12 h-12 rounded-full bg-amber shadow-[inset_0_-3px_0_rgba(0,0,0,0.12),0_6px_14px_rgba(2,43,145,0.35)] flex items-center justify-center">
          <ShoppingBasket size={21} strokeWidth={1.75} className="text-white" />
        </span>

        <span className="hg-stamp absolute -right-4 bottom-5 inline-flex items-center gap-1.5 rounded-lg border-[2.5px] border-amber-deep bg-white/90 px-3 py-1.5 text-[13px] font-extrabold uppercase tracking-[0.08em] text-amber-deep">
          <Check size={15} strokeWidth={3.5} />
          {c.noteStamp}
        </span>
      </div>
    </div>
  );
}
