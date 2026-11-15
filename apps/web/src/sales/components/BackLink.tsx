import { useEffect, useMemo, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useBackLinkSlot } from './BackLinkSlot';

/**
 * The way back, said out loud.
 *
 * Ported verbatim from apps/admin/src/components/BackLink.tsx — including
 * the slot handoff, so a rep's create screens carry the way back in exactly
 * the place an admin's do: inline above the title on a phone, in the top bar
 * from lg.
 *
 * Admin had four of these: a bordered square, a cream square, a white square
 * and, on four pages, a text link — all icon-only except the last, all
 * slightly different sizes. An unlabelled arrow is the worst of them on a
 * phone, where there is no page chrome around it to say what it goes back to
 * and no hover to reveal a title.
 *
 * So: one component, always labelled. The label is the destination, not the
 * word "back" — "Volver a clientes" tells you where you land, which is the
 * only thing worth the horizontal space it costs.
 *
 * WHERE IT DRAWS: in the layout's top bar, at every width (see BackLinkSlot).
 * On a phone that bar is the app's — the arrow and this screen's title, as
 * every app has (2026-10-26). The button below is kept, hidden, so the call
 * sites stay one line each and an older layout would still have one to show.
 */
export default function BackLink({
  label, onClick, className = '', onDark = false, title,
}: {
  label: string;
  onClick: () => void;
  /** Drawn beside the link in the layout bar. See BackTarget.title. */
  title?: string;
  /** Spacing only — callers own the gap to whatever follows. */
  className?: string;
  /**
   * Sitting on a coloured bar rather than on the page. Muted grey on brand
   * blue fails contrast and reads as disabled, so the link inverts instead.
   */
  onDark?: boolean;
}) {
  const { claim, release } = useBackLinkSlot();
  // Identity for this instance, so a sibling's unmount cannot clear it.
  const owner = useMemo(() => Symbol('back-link'), []);

  // The handler is almost always an inline arrow, so a new identity every
  // render. Holding it in a ref keeps the effect keyed on the label alone,
  // instead of registering and unregistering on every parent render.
  const handler = useRef(onClick);
  handler.current = onClick;

  useEffect(() => {
    claim(owner, { label, title, onClick: () => handler.current() });
    return () => release(owner);
  }, [label, title, claim, release, owner]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`hidden items-center gap-1.5 text-[13px] font-semibold transition-colors ${
        onDark ? 'text-white/85 hover:text-white' : 'text-muted hover:text-brand'
      } ${className}`}
    >
      <ArrowLeft className="w-4 h-4 shrink-0" strokeWidth={2} />
      <span className="truncate">{label}</span>
    </button>
  );
}
