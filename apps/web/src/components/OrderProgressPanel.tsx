import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import {
  orderProgressModel, orderProgressNote, useOrderProgress,
  type OrderProgressKind, type OrderProgressPhase,
} from '@grocery-app/shared';

/** Quick operations finish before this and never show the panel at all. */
const SHOW_AFTER_MS = 1_500;

/**
 * What a big order operation is doing, while it does it.
 *
 * Placing a 1,000-product order took about 20 seconds on production
 * (2026-10-19) behind a button that just said "Placing order…". This shows
 * the real steps — the server reports where it has got to under
 * `progressKey` — with a bar, the time so far, and a line saying not to leave.
 *
 * Mount it while the operation runs, keyed by the attempt, and unmount it
 * when it ends: its clock starts at mount.
 */
export default function OrderProgressPanel({
  kind, phase, progressKey, lang, detail, withBasket, withOpening, note, scope = 'user', onVisible,
}: {
  kind: OrderProgressKind;
  /** 'before' = the page's own first step, 'server' = the request is running. */
  phase: OrderProgressPhase;
  /** The key the request was sent with; null polls nothing and eases on time alone. */
  progressKey: string | null;
  lang: 'es' | 'en';
  /** What the page already knows, until the server says more. */
  detail?: { lines?: number; shops?: number };
  withBasket?: boolean;
  withOpening?: boolean;
  /** Replaces the standard "keep this page open" line, e.g. a slow-connection hint. */
  note?: string;
  scope?: 'user' | 'admin';
  /**
   * Called once, when the panel first shows. A confirm box still open under
   * it steps aside then rather than at the click: for the first 1.5s its own
   * "Cancelling…" button is the only sign anything is happening.
   */
  onVisible?: () => void;
}) {
  // Started at mount, not at the first tick: a page busy with a 1,000-line
  // basket can hold that tick back, and the wait would add to the 1.5s.
  const [clock, setClock] = useState(() => {
    const now = Date.now();
    return { start: now, now, phase, phaseAt: now };
  });
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      setClock((c) => (c.phase === phase ? { ...c, now } : { ...c, now, phase, phaseAt: now }));
    };
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [phase]);

  const { data: view } = useOrderProgress(phase === 'server' ? progressKey : null, scope);

  const visible = clock.now - clock.start >= SHOW_AFTER_MS;
  useEffect(() => {
    if (visible) onVisible?.();
    // Once per mount, as the clock only moves forward. A caller's inline arrow
    // is a new function every render and must not re-fire it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  const model = orderProgressModel({
    kind, lang, phase, view: view ?? null,
    // The render right after a phase change still carries the old phase's
    // start until the next tick, which drew the new step 2.5s along and then
    // pulled the bar back (23% → 15%, staging checkout, 2026-10-21).
    phaseElapsedMs: clock.phase === phase ? clock.now - clock.phaseAt : 0,
    detail, withBasket, withOpening,
  });
  const seconds = Math.floor((clock.now - clock.start) / 1000);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-veil/30 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-progress-title"
    >
      <div className="w-full max-w-md rounded-lg bg-surface-cream shadow-card p-6" role="status" aria-live="polite">
        <div className="flex items-baseline justify-between gap-3 mb-4">
          <h2 id="order-progress-title" className="font-display text-lg font-bold text-ink">{model.title}</h2>
          <span className="font-ui text-xs text-muted tabular-nums shrink-0">{seconds} s</span>
        </div>

        <div
          className="h-2 rounded-full bg-border/60 overflow-hidden mb-5"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={model.percent}
          aria-label={model.title}
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out"
            style={{ width: `${model.percent}%` }}
          />
        </div>

        <ol className="space-y-2.5">
          {model.steps.map((s) => (
            <li key={s.id} className="flex items-center gap-3">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                  s.state === 'done' ? 'bg-brand text-white' : s.state === 'active' ? 'bg-brand/10 text-brand' : 'bg-border/50 text-muted'
                }`}
                aria-hidden="true"
              >
                {s.state === 'done'
                  ? <Check size={14} strokeWidth={1.75} />
                  : s.state === 'active'
                    ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />
                    : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
              </span>
              <span className={`text-sm font-ui ${s.state === 'todo' ? 'text-muted' : 'text-ink'} ${s.state === 'active' ? 'font-semibold' : ''}`}>
                {s.label}
                {s.state === 'done' && <span className="sr-only"> ✓</span>}
              </span>
            </li>
          ))}
        </ol>

        <p className="mt-5 text-xs font-body text-muted leading-relaxed">{note ?? orderProgressNote(lang)}</p>
      </div>
    </div>
  );
}
