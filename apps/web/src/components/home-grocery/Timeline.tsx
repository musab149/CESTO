import { Check } from 'lucide-react';

export type TimelineStep = {
  label: string;
  /** done = happened; current = happening now; todo = still to come. */
  state: 'done' | 'current' | 'todo';
  meta?: string;
};

/**
 * Where a request is, as a short vertical sequence. Used right after sending
 * and on the "in review" status, so the household sees the same three steps
 * both times and knows which one they are on.
 */
export default function Timeline({ steps, lang }: { steps: TimelineStep[]; lang: 'es' | 'en' }) {
  const sr = lang === 'en' ? { done: ' (done)', now: ' (now)' } : { done: ' (hecho)', now: ' (ahora)' };
  return (
    <ol className="relative">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={s.label} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && (
              <span
                aria-hidden="true"
                className={`absolute left-[11px] top-6 bottom-0 w-0.5 rounded-full ${
                  s.state === 'done' ? 'bg-amber-deep' : 'bg-border'
                }`}
              />
            )}
            <span
              aria-hidden="true"
              className={`relative z-[1] w-6 h-6 rounded-full shrink-0 flex items-center justify-center ${
                s.state === 'done'
                  ? 'bg-amber-deep'
                  : s.state === 'current'
                    ? 'bg-brand-mist ring-4 ring-brand-whisper'
                    : 'bg-surface-cream border-2 border-border'
              }`}
            >
              {s.state === 'done' && <Check size={13} strokeWidth={3} className="text-white" />}
              {s.state === 'current' && <span className="w-2 h-2 rounded-full bg-brand motion-safe:animate-pulse" />}
            </span>
            <span className="min-w-0 pt-0.5">
              <span
                className={`block text-[15px] leading-tight ${
                  s.state === 'todo' ? 'text-gray font-medium' : 'text-ink font-semibold'
                }`}
              >
                {s.label}
                <span className="sr-only">
                  {s.state === 'done' ? sr.done : s.state === 'current' ? sr.now : ''}
                </span>
              </span>
              {s.meta && <span className="block text-[13px] text-gray mt-0.5">{s.meta}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
